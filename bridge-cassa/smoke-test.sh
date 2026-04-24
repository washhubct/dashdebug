#!/usr/bin/env bash
# Smoke-test end-to-end del bridge contro il mock VNE.
# Avvia mock + bridge in background, esercita tutti gli endpoint, ferma tutto.
#
# Uso:  cd bridge-cassa && ./smoke-test.sh
# Pre:  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -d .venv ]]; then
    echo "❌ .venv mancante. Esegui: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
    exit 1
fi

TOKEN="smoke-$(date +%s)-$RANDOM"
cat > .env <<EOF
VNE_HOST=localhost:9999
VNE_PROTOCOL=http
BRIDGE_TOKEN=$TOKEN
OP_NAME=dashdebug
PORT=8765
EOF

cleanup() {
    [[ -n "${MOCK_PID:-}" ]] && kill "$MOCK_PID" 2>/dev/null || true
    [[ -n "${BRIDGE_PID:-}" ]] && kill "$BRIDGE_PID" 2>/dev/null || true
    rm -f .env
}
trap cleanup EXIT

.venv/bin/python test_mock.py >/tmp/wh-mock.log 2>&1 &
MOCK_PID=$!
sleep 1
.venv/bin/python run.py >/tmp/wh-bridge.log 2>&1 &
BRIDGE_PID=$!
sleep 2

A="Authorization: Bearer $TOKEN"
J="Content-Type: application/json"
B=http://127.0.0.1:8765

echo "▶ /health"; curl -fsS $B/health >/dev/null && echo "  OK"
echo "▶ /stato senza token (401 atteso)"
code=$(curl -s -o /dev/null -w "%{http_code}" $B/stato)
[[ "$code" == "401" ]] && echo "  OK ($code)" || { echo "  FAIL ($code)"; exit 1; }

echo "▶ /stato"; curl -fsS -H "$A" $B/stato >/dev/null && echo "  OK"
echo "▶ /versione"; curl -fsS -H "$A" $B/versione >/dev/null && echo "  OK"

echo "▶ /paga 590c"
ID=$(curl -fsS -H "$A" -H "$J" -d '{"importo":590}' $B/paga | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
echo "  id=$ID"

echo "▶ /polling fino a completed (max 10s)"
for i in $(seq 1 10); do
    sleep 1
    s=$(curl -fsS -H "$A" "$B/polling/$ID" | python3 -c "import json,sys;print(json.load(sys.stdin).get('status',''))")
    echo "  [${i}s] status=$s"
    [[ "$s" == "completed" ]] && break
done
[[ "$s" == "completed" ]] || { echo "  FAIL: status finale $s"; exit 1; }

echo "▶ /chiusura"; curl -fsS -H "$A" -X POST $B/chiusura >/dev/null && echo "  OK"

echo "▶ /rimborso + polling-rimborso"
curl -fsS -H "$A" -H "$J" -X POST -d '{}' "$B/rimborso/$ID" >/dev/null
curl -fsS -H "$A" "$B/polling-rimborso/$ID" >/dev/null && echo "  OK"

echo
echo "✅ Tutti i test passati."
