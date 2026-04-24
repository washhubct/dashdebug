"""Entry point production: serve l'app Flask con Waitress (Windows-friendly)."""

import os
import sys

from dotenv import load_dotenv

load_dotenv()

from app import app, BRIDGE_TOKEN, PORT, VNE_URL, jlog  # noqa: E402

if __name__ == "__main__":
    if not BRIDGE_TOKEN or BRIDGE_TOKEN.startswith("GENERA"):
        print("[FATAL] BRIDGE_TOKEN non valido in .env", file=sys.stderr)
        sys.exit(1)
    from waitress import serve

    jlog("startup", port=PORT, vne_url=VNE_URL, mode="prod-waitress")
    # Bind solo a 127.0.0.1: l'esposizione esterna passa SOLO via Cloudflare Tunnel
    serve(app, host="127.0.0.1", port=PORT, threads=8, ident="washhub-bridge")
