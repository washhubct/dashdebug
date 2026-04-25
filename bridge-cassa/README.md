# Bridge cassa automatica VNE — Wash Hub

Microservizio Python Flask che fa da ponte tra il gestionale web
(`https://dashboard.washhub.it`) e la cassa automatica VNE collegata
in LAN al PC di Sebastiano.

```
┌──────────────────┐    HTTPS+Bearer    ┌────────────────────┐
│ dashboard.washhub│ ─────────────────▶ │ cassa.washhub.it   │
│      .it (web)   │                    │ (Cloudflare Tunnel)│
└──────────────────┘                    └─────────┬──────────┘
                                                  │ http loopback
                                                  ▼
                                       ┌──────────────────────┐
                                       │ Python Flask bridge  │
                                       │ 127.0.0.1:8765       │
                                       └─────────┬────────────┘
                                                 │ HTTPS self-signed
                                                 │  (LAN)
                                                 ▼
                                       ┌──────────────────────┐
                                       │ VNE Automatic Cash   │
                                       │  protocollo 3.05     │
                                       └──────────────────────┘
```

## Endpoint

Tutti tranne `/health` richiedono `Authorization: Bearer <BRIDGE_TOKEN>`.

| Metodo | Path | Tipo VNE | Cosa fa |
|---|---|---|---|
| GET  | `/health` | 82 | Heartbeat + `vne_reachable` |
| POST | `/paga` | 1 | Avvia pagamento — body `{importo, opName?}` (centesimi) |
| GET  | `/polling/<id>` | 2 | Stato di un pagamento in corso |
| POST | `/annulla/<id>` | 3 | Annulla pagamento — body `{tipo_annullamento, opName?}` |
| GET  | `/stato` | 20 | Stato cassa (recycler/hopper/contenuto/alert) |
| POST | `/rimborso/<id>` | 65 | Rimborso completo |
| GET  | `/polling-rimborso/<id>` | 66 | Stato rimborso |
| POST | `/chiusura` | 60 | Chiusura cassa (totali sessione) |
| GET  | `/versione` | 82 | Versione protocollo VNE |

## Risposte e codici

- 200: `req_status: 0` → forwardato così com'è dalla cassa.
- 400: `{"error":"vne_nack","vne_mess":<int>,"vne_status":<int>}` → cassa ha
  rifiutato (es. `mess=106` taglio non disponibile, `mess=110` cassa occupata).
- 401: token mancante/errato.
- 502: cassa irraggiungibile (LAN/firewall/spenta).
- 504: timeout (cassa lenta a rispondere — superiore a 7s).

Vedi `PROTOCOLLO-VNE-NOTES.md` per la mappatura completa errori.

## Logging

Output JSON-strutturato su stdout. Esempio:

```json
{"ts":"2026-04-25T10:11:42","event":"vne_call","tipo":1,"vne_status":200,"latency_ms":342}
```

- **Linux/Pi:** `tail -f /var/log/washhub-cassa-bridge.log` o `journalctl -u washhub-cassa-bridge -f`
- **Windows:** file `bridge.out.log` / `bridge.err.log` (NSSM); Visualizzatore eventi → Applicazione → filtro "WashHubCassaBridge"

## Hardware target

**Raccomandato:** Raspberry Pi (4/5/Zero 2W) dedicato, sempre acceso, in cavo LAN
con la cassa VNE. Vedi `install-linux.md`.

**Alternativa:** PC Windows in struttura, vedi `install-windows.md`.

Il codice è platform-agnostic; cambia solo il supervisor (systemd vs NSSM).

## File

- `app.py` — Flask app con tutti gli endpoint
- `run.py` — entry point production con Waitress
- `test_mock.py` — emulatore VNE su porta 9999 per dev senza cassa
- `requirements.txt` — pin minori
- `.env.example` — template config
- `install-linux.md` — **guida ufficiale**: Raspberry Pi + systemd + cloudflared
- `install-windows.md` — guida alternativa: PC Windows + NSSM
- `PROTOCOLLO-VNE-NOTES.md` — mappa errori e note sul protocollo 3.05
- `smoke-test.sh` — script bash che esercita tutti gli endpoint contro il mock

## Quick start dev (Mac/Linux)

```bash
cd bridge-cassa
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edita .env, imposta VNE_PROTOCOL=http e VNE_HOST=localhost:9999
python test_mock.py &        # mock VNE su 9999
python run.py                # bridge su 8765
curl -H "Authorization: Bearer <TOKEN>" http://127.0.0.1:8765/stato
```
