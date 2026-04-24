"""Mock VNE per sviluppo senza cassa fisica.

Avvio:
    python test_mock.py        # ascolta su http://localhost:9999/selfcashapi/

Uso col bridge:
    Imposta in .env:
        VNE_HOST=localhost:9999
        VNE_PROTOCOL=http
    Poi avvia il bridge normalmente: python run.py
"""

from __future__ import annotations

import time
import uuid
from typing import Any

from flask import Flask, jsonify, request

mock = Flask("vne-mock")

# Stato in-memory delle "transazioni"
_TX: dict[str, dict[str, Any]] = {}


def _new_tx() -> str:
    return f"MOCK-{uuid.uuid4().hex[:10].upper()}"


@mock.post("/selfcashapi/")
def handler():
    body = request.get_json(silent=True) or {}
    tipo = body.get("tipo")

    # tipo=1 — pagamento: registra e restituisce id
    if tipo == 1:
        tx_id = _new_tx()
        _TX[tx_id] = {
            "importo": body.get("importo", 0),
            "inserito": 0,
            "resto": 0,
            "status": "pending",
            "started": time.time(),
        }
        return jsonify({"req_status": 0, "id": tx_id, "mess": 0})

    # tipo=2 — polling pagamento: simula avanzamento
    if tipo == 2:
        tx_id = body.get("id")
        tx = _TX.get(tx_id)
        if not tx:
            return jsonify({"req_status": 1, "mess": 100})  # id sconosciuto
        elapsed = time.time() - tx["started"]
        if elapsed < 3:
            tx["inserito"] = int(tx["importo"] * 0.5)
            tx["status"] = "in_progress"
        elif elapsed < 6:
            tx["inserito"] = tx["importo"]
            tx["resto"] = 0
            tx["status"] = "completed"
        return jsonify(
            {
                "req_status": 0,
                "id": tx_id,
                "status": tx["status"],
                "importo_richiesto": tx["importo"],
                "importo_inserito": tx["inserito"],
                "resto": tx["resto"],
            }
        )

    # tipo=3 — annulla
    if tipo == 3:
        tx_id = body.get("id")
        tx = _TX.get(tx_id)
        if tx:
            tx["status"] = "deleted" if body.get("tipo_annullamento") == 2 else "partial"
        return jsonify({"req_status": 0, "id": tx_id, "mess": 0})

    # tipo=20 — stato macchina
    if tipo == 20:
        return jsonify(
            {
                "req_status": 0,
                "recyclerOk": True,
                "hopperOk": True,
                "totalContent": 12345,  # in centesimi
                "alerts": [],
            }
        )

    # tipo=65 — rimborso
    if tipo == 65:
        return jsonify({"req_status": 0, "id": body.get("id"), "mess": 0})

    # tipo=66 — polling rimborso
    if tipo == 66:
        return jsonify({"req_status": 0, "id": body.get("id"), "status": "completed"})

    # tipo=60 — chiusura cassa
    if tipo == 60:
        return jsonify(
            {
                "req_status": 0,
                "totalContent": 12345,
                "totalIn": 23400,
                "totalOut": 11055,
                "operations": 17,
            }
        )

    # tipo=82 — versione protocollo
    if tipo == 82:
        return jsonify({"req_status": 0, "version": "3.05", "model": "MOCK-VNE"})

    return jsonify({"req_status": 1, "mess": 999, "echo": body})


if __name__ == "__main__":
    print("[MOCK VNE] http://localhost:9999/selfcashapi/")
    mock.run(host="127.0.0.1", port=9999, debug=False)
