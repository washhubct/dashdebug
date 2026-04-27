#!/usr/bin/env bash
# Genera certificato self-signed per il bridge in modalità LAN-only.
# I file vengono creati in ./tls/cert.pem e ./tls/key.pem.
#
# Il certificato include i SAN (Subject Alternative Names) per:
#   - washhub-cassa.local        (mDNS, valido se il client supporta Bonjour)
#   - localhost
#   - 127.0.0.1
#   - IP statico LAN passato come argomento (consigliato)
#
# Uso:
#   ./init-tls.sh [IP_LAN_DEL_PI]
# Esempi:
#   ./init-tls.sh 192.168.1.42
#   ./init-tls.sh                  # senza IP (solo .local + loopback)
#
# Validità: 10 anni. Algoritmo: RSA 2048 (compatibile con Pi Zero, no ECDSA
# perché i browser più vecchi possono dare problemi).

set -euo pipefail
cd "$(dirname "$0")"

LAN_IP="${1:-}"
TLS_DIR="tls"
CERT="$TLS_DIR/cert.pem"
KEY="$TLS_DIR/key.pem"
CONF="$TLS_DIR/openssl.cnf"

mkdir -p "$TLS_DIR"
chmod 700 "$TLS_DIR"

if [[ -f "$CERT" && -f "$KEY" ]]; then
    read -p "Cert già presente. Rigenerare? [y/N] " ans
    [[ "${ans:-N}" != "y" && "${ans:-N}" != "Y" ]] && { echo "Skip."; exit 0; }
fi

# Genera config OpenSSL con SAN dinamici
cat > "$CONF" <<EOF
[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
x509_extensions    = v3_req

[dn]
C  = IT
ST = Sicilia
L  = Palermo
O  = Wash Hub Lungomare
CN = washhub-cassa.local

[v3_req]
basicConstraints = CA:FALSE
keyUsage         = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName   = @alt_names

[alt_names]
DNS.1 = washhub-cassa.local
DNS.2 = washhub-cassa
DNS.3 = localhost
IP.1  = 127.0.0.1
EOF

if [[ -n "$LAN_IP" ]]; then
    echo "IP.2  = $LAN_IP" >> "$CONF"
fi

openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$KEY" \
    -out "$CERT" \
    -days 3650 \
    -config "$CONF"

chmod 600 "$KEY"
chmod 644 "$CERT"

echo
echo "✅ Cert creato: $CERT"
echo "   Validità: 10 anni"
echo "   SAN inclusi:"
openssl x509 -in "$CERT" -noout -ext subjectAltName | sed 's/^/     /'
echo
echo "Ora riavvia il bridge:"
echo "   sudo systemctl restart washhub-cassa-bridge"
