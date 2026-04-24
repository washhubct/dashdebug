"""Bridge HTTP tra dashdebug (web) e la cassa automatica VNE.

Espone endpoint REST autenticati con bearer token. Inoltra le chiamate
alla cassa VNE che parla protocollo 3.05 via HTTPS self-signed.

L'app gira su 127.0.0.1, è esposta a Internet tramite Cloudflare Tunnel
(host: cassa.washhub.it).
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from functools import wraps
from typing import Any

import requests
import urllib3
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request

# La cassa VNE usa certificato self-signed: silenzia il warning urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

load_dotenv()

VNE_HOST: str = os.getenv("VNE_HOST", "192.168.1.50")
VNE_PROTOCOL: str = os.getenv("VNE_PROTOCOL", "https")  # mock usa http
BRIDGE_TOKEN: str = os.getenv("BRIDGE_TOKEN", "")
OP_NAME_DEFAULT: str = os.getenv("OP_NAME", "dashdebug")
PORT: int = int(os.getenv("PORT", "8765"))
VNE_TIMEOUT: float = 7.0  # protocollo 5s + 2s margine
VERSION: str = "1.0.0"

VNE_URL = f"{VNE_PROTOCOL}://{VNE_HOST}/selfcashapi/"
ALLOWED_ORIGIN = "https://dashboard.washhub.it"

# Logger JSON-strutturato
logger = logging.getLogger("bridge-cassa")
logger.setLevel(logging.INFO)
_h = logging.StreamHandler(sys.stdout)
_h.setFormatter(logging.Formatter("%(message)s"))
logger.addHandler(_h)


def jlog(event: str, **fields: Any) -> None:
    """Log strutturato JSON one-line."""
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "event": event, **fields}
    logger.info(json.dumps(rec, ensure_ascii=False))


app = Flask(__name__)


# ───────────────────────── CORS / Auth ─────────────────────────
@app.after_request
def add_cors(resp: Response) -> Response:
    origin = request.headers.get("Origin", "")
    if origin == ALLOWED_ORIGIN:
        resp.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
        resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Authorization,Content-Type"
        resp.headers["Access-Control-Max-Age"] = "600"
    return resp


@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        return ("", 204)
    # /health è pubblico (utile per probe Cloudflare); resto protetto
    if request.path == "/health":
        return None
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or auth[7:] != BRIDGE_TOKEN or not BRIDGE_TOKEN:
        jlog("auth_fail", path=request.path, ip=request.remote_addr)
        return jsonify({"error": "unauthorized"}), 401
    return None


# ───────────────────────── Helper VNE ─────────────────────────
def vne_call(payload: dict) -> tuple[Any, int, dict]:
    """Inoltra un payload alla cassa VNE.

    Ritorna (body_dict, http_status, debug_info). In caso di timeout/errore
    di rete restituisce (None, 502/504, info).
    """
    t0 = time.time()
    try:
        r = requests.post(
            VNE_URL,
            json=payload,
            timeout=VNE_TIMEOUT,
            verify=False,
        )
        latency_ms = int((time.time() - t0) * 1000)
        try:
            data = r.json()
        except ValueError:
            data = {"raw": r.text}
        jlog(
            "vne_call",
            tipo=payload.get("tipo"),
            vne_status=r.status_code,
            latency_ms=latency_ms,
        )
        return data, r.status_code, {"latency_ms": latency_ms}
    except requests.Timeout:
        jlog("vne_timeout", tipo=payload.get("tipo"))
        return None, 504, {"reason": "timeout"}
    except requests.RequestException as e:
        jlog("vne_unreachable", tipo=payload.get("tipo"), err=str(e))
        return None, 502, {"reason": "unreachable", "err": str(e)}


def op_name() -> str:
    """Estrae opName dal body o dal default."""
    body = request.get_json(silent=True) or {}
    return str(body.get("opName") or OP_NAME_DEFAULT)


def map_vne_response(data: Any, status: int) -> tuple[dict, int]:
    """Normalizza la risposta VNE per il client web."""
    if data is None:
        if status == 504:
            return {"error": "vne_timeout"}, 504
        return {"error": "vne_unreachable"}, 502
    # Risposta standard VNE: req_status 0=OK, !=0=NACK + mess
    if isinstance(data, dict) and data.get("req_status") not in (None, 0):
        return (
            {
                "error": "vne_nack",
                "vne_mess": data.get("mess"),
                "vne_status": data.get("req_status"),
                "raw": data,
            },
            400,
        )
    return data, 200


# ───────────────────────── Endpoint pubblici ─────────────────────────
@app.get("/health")
def health():
    """Heartbeat. Tenta tipo=82 per misurare reachability."""
    data, status, _ = vne_call({"tipo": 82})
    return jsonify(
        {
            "ok": True,
            "version": VERSION,
            "vne_reachable": status == 200 and data is not None,
            "vne_url": VNE_URL,
        }
    )


@app.post("/paga")
def paga():
    body = request.get_json(silent=True) or {}
    importo = body.get("importo")
    if not isinstance(importo, int) or importo <= 0:
        return jsonify({"error": "importo_invalid", "detail": "centesimi int > 0"}), 400
    payload = {
        "tipo": 1,
        "importo": importo,
        "opName": op_name(),
        "refundable": 1,
    }
    data, status, _ = vne_call(payload)
    out, code = map_vne_response(data, status)
    return jsonify(out), code


@app.get("/polling/<id_op>")
def polling(id_op: str):
    payload = {"tipo": 2, "id": id_op}
    data, status, _ = vne_call(payload)
    out, code = map_vne_response(data, status)
    return jsonify(out), code


@app.post("/annulla/<id_op>")
def annulla(id_op: str):
    body = request.get_json(silent=True) or {}
    tipo_ann = body.get("tipo_annullamento", 2)
    payload = {
        "tipo": 3,
        "id": id_op,
        "tipo_annullamento": tipo_ann,
        "opName": op_name(),
    }
    data, status, _ = vne_call(payload)
    out, code = map_vne_response(data, status)
    return jsonify(out), code


@app.get("/stato")
def stato():
    data, status, _ = vne_call({"tipo": 20})
    out, code = map_vne_response(data, status)
    return jsonify(out), code


@app.post("/rimborso/<id_op>")
def rimborso(id_op: str):
    payload = {"tipo": 65, "id": id_op, "opName": op_name()}
    data, status, _ = vne_call(payload)
    out, code = map_vne_response(data, status)
    return jsonify(out), code


@app.get("/polling-rimborso/<id_op>")
def polling_rimborso(id_op: str):
    payload = {"tipo": 66, "id": id_op}
    data, status, _ = vne_call(payload)
    out, code = map_vne_response(data, status)
    return jsonify(out), code


@app.post("/chiusura")
def chiusura():
    payload = {"tipo": 60, "opName": op_name()}
    data, status, _ = vne_call(payload)
    out, code = map_vne_response(data, status)
    return jsonify(out), code


@app.get("/versione")
def versione():
    data, status, _ = vne_call({"tipo": 82})
    out, code = map_vne_response(data, status)
    return jsonify(out), code


@app.errorhandler(404)
def not_found(_e):
    return jsonify({"error": "not_found"}), 404


if __name__ == "__main__":
    # Sviluppo: usa il dev server di Flask. Produzione: vedi run.py.
    if not BRIDGE_TOKEN:
        print("[FATAL] BRIDGE_TOKEN non impostato in .env", file=sys.stderr)
        sys.exit(1)
    jlog("startup", port=PORT, vne_url=VNE_URL, mode="dev")
    app.run(host="127.0.0.1", port=PORT, debug=False)
