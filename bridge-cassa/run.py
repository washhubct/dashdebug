"""Entry point production del bridge.

Modalità di servizio:
- **TLS self-signed (LAN-only)**: se esistono `tls/cert.pem` + `tls/key.pem`
  nella cartella del bridge, parte cheroot in HTTPS legato a 0.0.0.0.
  Adatto al setup Pi Zero W in WiFi sul Wash Hub.
- **HTTP loopback (con tunnel)**: se i cert non ci sono, parte waitress
  in HTTP legato a 127.0.0.1. Adatto al setup con Cloudflare Tunnel.

Rilevazione automatica via presenza file. Per generare i cert sul Pi:
    bash init-tls.sh
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

load_dotenv()

from app import app, BRIDGE_TOKEN, PORT, VNE_URL, jlog  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CERT_PATH = os.path.join(HERE, "tls", "cert.pem")
KEY_PATH = os.path.join(HERE, "tls", "key.pem")


def serve_https_lan() -> None:
    """Serve via cheroot HTTPS legato a 0.0.0.0 (raggiungibile in LAN)."""
    from cheroot.wsgi import Server as WSGIServer
    from cheroot.ssl.builtin import BuiltinSSLAdapter

    server = WSGIServer(
        bind_addr=("0.0.0.0", PORT),
        wsgi_app=app,
        numthreads=4,
        server_name="washhub-cassa-bridge",
    )
    server.ssl_adapter = BuiltinSSLAdapter(
        certificate=CERT_PATH,
        private_key=KEY_PATH,
    )
    jlog("startup", port=PORT, vne_url=VNE_URL, mode="https-lan", bind="0.0.0.0")
    try:
        server.start()
    except KeyboardInterrupt:
        server.stop()


def serve_http_loopback() -> None:
    """Serve via waitress HTTP legato a 127.0.0.1 (per Cloudflare Tunnel)."""
    from waitress import serve

    jlog("startup", port=PORT, vne_url=VNE_URL, mode="http-loopback", bind="127.0.0.1")
    serve(app, host="127.0.0.1", port=PORT, threads=8, ident="washhub-bridge")


if __name__ == "__main__":
    if not BRIDGE_TOKEN or BRIDGE_TOKEN.startswith("GENERA"):
        print("[FATAL] BRIDGE_TOKEN non valido in .env", file=sys.stderr)
        sys.exit(1)

    if os.path.isfile(CERT_PATH) and os.path.isfile(KEY_PATH):
        serve_https_lan()
    else:
        serve_http_loopback()
