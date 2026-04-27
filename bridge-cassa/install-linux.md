# Installazione bridge cassa VNE — Raspberry Pi Zero W (modalità LAN-only)

> Setup del bridge sul **Raspberry Pi Zero W** del Wash Hub. Niente
> Cloudflare Tunnel: il Pi serve HTTPS self-signed direttamente in LAN, e
> il PC di Sebastiano (sempre lo stesso) lo raggiunge via mDNS o IP statico.

---

## 0. Architettura

```
PC Sebastiano                         Raspberry Pi Zero W
(Wi-Fi Wash Hub)                      (Wi-Fi Wash Hub)
     │                                       │
     │  HTTPS self-signed                    │
     │  (eccezione cert salvata              │
     │   nel browser una volta)              │
     ▼                                       ▼
https://washhub-cassa.local:8765 ──▶ Bridge Python (cheroot TLS)
                                              │
                                              │ HTTPS self-signed
                                              ▼
                                      Cassa VNE (LAN, IP statico)
```

Vincoli:
- Pi e PC sulla **stessa rete Wi-Fi/LAN**.
- PC con **Bonjour** (Windows 10/11 o macOS o Linux con avahi).
- Sebastiano deve cliccare "Procedi comunque" sul warning certificato la
  prima volta dal suo browser. Una sola volta per browser/profilo.

---

## 1. Flash microSD (sul Mac, già fatto)

Pi OS Lite **32-bit** (ARMv6 obbligatorio per Pi Zero 1).
Hostname: `washhub-cassa`. SSH abilitato, Wi-Fi configurato in Imager.

## 2. Primo boot

2.1. Inserisci microSD nel Pi Zero.
2.2. Collega l'alimentazione (cavo USB micro su porta "PWR IN").
   *Attenzione: il Pi Zero ha 2 porte micro-USB; quella di alimentazione
   è la più esterna, marcata "PWR IN".*
2.3. Aspetta 2-3 minuti (primo boot lento, espande il filesystem).
2.4. Dal Mac:
```bash
ping -c 3 washhub-cassa.local
```
Se risponde, sei a posto.
2.5. SSH:
```bash
ssh washhub@washhub-cassa.local
# password che hai messo in Imager
```

> **Se `washhub-cassa.local` non risolve:** trova l'IP del Pi dal pannello
> del router (sezione "Connected devices") oppure:
> ```bash
> arp -a | grep -i b8:27   # MAC prefix Raspberry Foundation
> ```
> e poi `ssh washhub@<ip>`.

## 3. Setup base sistema

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git python3-venv python3-pip openssl avahi-daemon ufw
sudo timedatectl set-timezone Europe/Rome
```

`avahi-daemon` annuncia `washhub-cassa.local` agli altri device della LAN
(Bonjour). Su Pi OS è già attivo, ma confermiamo.

## 4. Hardening minimo

```bash
# Firewall: SSH dalla LAN + bridge HTTPS (8765) dalla LAN
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp
sudo ufw allow from 192.168.0.0/16 to any port 8765 proto tcp
sudo ufw --force enable
sudo ufw status
```

> Aggiusta le subnet (`192.168.0.0/16`) se la tua LAN usa range diversi
> (es. `10.0.0.0/8`).

## 5. IP statico (fortemente consigliato)

Il Pi Zero in DHCP può cambiare IP a ogni reboot del router → cert e
config Firestore vanno fuori sync. Fissa un IP via DHCP reservation **sul
router** (cerca "DHCP reservation" o "Static IP" nel pannello router; serve
il MAC del Pi che vedi con `ip link show wlan0 | awk '/ether/{print $2}'`).

Annota l'IP scelto, es. `192.168.1.42`. Lo userai allo step 8.

## 6. Clona il progetto

```bash
cd ~
git clone https://github.com/washhubct/dashdebug.git
cd dashdebug/bridge-cassa
```

## 7. Crea venv e installa dipendenze

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
```

> Tempo: ~5-10 minuti su Pi Zero (compilazione cffi/cryptography).

## 8. Genera certificato TLS self-signed

Sostituisci `192.168.1.42` con l'IP statico che hai assegnato allo step 5:

```bash
./init-tls.sh 192.168.1.42
```

Output: crea `tls/cert.pem` e `tls/key.pem`. Validità 10 anni.

> Il cert include come SAN: `washhub-cassa.local`, `washhub-cassa`,
> `localhost`, `127.0.0.1` e l'IP LAN che hai passato.

## 9. Genera bridge token

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

**Salva la stringa generata** (1Password). La incollerai allo step 10
(`.env`) e poi nel doc Firestore (vedi guida principale README).

## 10. Configura `.env`

```bash
cp .env.example .env
nano .env
```

Compila:
```env
VNE_HOST=192.168.1.50           # IP della cassa VNE — verifica con ping
VNE_PROTOCOL=https
BRIDGE_TOKEN=<stringa-step-9>
OP_NAME=dashdebug
PORT=8765
```

Salva (`Ctrl+O Enter Ctrl+X`).

Test connettività cassa:
```bash
ping -c 3 192.168.1.50
```

## 11. Test smoke

```bash
source venv/bin/activate
python run.py
```

Output atteso (presenza cert → modalità HTTPS LAN):
```json
{"ts":"...","event":"startup","port":8765,"vne_url":"...","mode":"https-lan","bind":"0.0.0.0"}
```

Da un'altra finestra SSH:
```bash
curl -k https://washhub-cassa.local:8765/health
# `-k` ignora cert self-signed lato curl
```

Da Mac:
```bash
curl -k https://washhub-cassa.local:8765/health
curl -k https://192.168.1.42:8765/health   # IP statico
```

`Ctrl+C` per fermare.

## 12. Servizio systemd

```bash
sudo tee /etc/systemd/system/washhub-cassa-bridge.service > /dev/null <<'EOF'
[Unit]
Description=Wash Hub - Bridge Cassa VNE (LAN HTTPS)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=washhub
WorkingDirectory=/home/washhub/dashdebug/bridge-cassa
EnvironmentFile=/home/washhub/dashdebug/bridge-cassa/.env
ExecStart=/home/washhub/dashdebug/bridge-cassa/venv/bin/python /home/washhub/dashdebug/bridge-cassa/run.py
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/washhub-cassa-bridge.log
StandardError=append:/var/log/washhub-cassa-bridge.log

[Install]
WantedBy=multi-user.target
EOF

sudo touch /var/log/washhub-cassa-bridge.log
sudo chown washhub:washhub /var/log/washhub-cassa-bridge.log

sudo systemctl daemon-reload
sudo systemctl enable washhub-cassa-bridge
sudo systemctl start washhub-cassa-bridge
sudo systemctl status washhub-cassa-bridge
```

Deve mostrare `Active: active (running)`. Verifica:
```bash
curl -k https://washhub-cassa.local:8765/health
tail -f /var/log/washhub-cassa-bridge.log
```

## 13. Test dal PC di Sebastiano (Windows)

13.1. Verifica che Bonjour sia attivo: apri PowerShell e digita
```powershell
ping washhub-cassa.local
```
Se non risolve → installa **Apple Bonjour for Windows** (incluso con iTunes
o standalone https://support.apple.com/kb/dl999).
In alternativa usa direttamente l'IP statico (es. `192.168.1.42`).

13.2. Apri il browser di Sebastiano → vai a:
```
https://washhub-cassa.local:8765/health
```
Il browser mostra warning certificato (atteso). Click **"Avanzate"** →
**"Procedi comunque su washhub-cassa.local (non sicuro)"**.

Vedrai JSON tipo:
```json
{"ok": true, "version": "1.0.0", "vne_reachable": true, ...}
```

Da quel momento il browser ricorda l'eccezione: il modulo cassa nel
gestionale `dashboard.washhub.it` può chiamare il bridge senza errori.

> Se Sebastiano cambia browser/profilo, va rifatto. Per Chrome aziendale
> esiste `chrome://flags/#allow-insecure-localhost` ma non serve in LAN.

## 14. Reboot e verifica autostart

```bash
sudo reboot
# Attendi 1-2 min poi:
ssh washhub@washhub-cassa.local
sudo systemctl status washhub-cassa-bridge
curl -k https://washhub-cassa.local:8765/health
```

Servizio deve essere `active (running)`.

## 15. Update futuri del bridge

Quando esce un commit nuovo:
```bash
cd ~/dashdebug
git pull
cd bridge-cassa
source venv/bin/activate
pip install -r requirements.txt
deactivate
sudo systemctl restart washhub-cassa-bridge
```

I cert restano (sono in `tls/` esclusi da git).

## 16. Configurazione Firestore (sul Mac)

Allinea il doc `config/cassaAutomatica` col Pi:

```bash
cd ~/Progetti/dashdebug
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/secrets/dashboard-washhub-sa.json"

# Sostituisci IP/hostname e token reali
node scripts/setup-cassa-config.js \
    --token "<TOKEN-GENERATO-STEP-9>" \
    --url "https://washhub-cassa.local:8765"
```

Se il PC di Sebastiano non risolve `.local`, usa l'IP:
```bash
node scripts/setup-cassa-config.js --url "https://192.168.1.42:8765"
```

Poi deploy delle rules (una sola volta):
```bash
firebase deploy --only firestore:rules --project dashboard-washhub
```

E quando hai testato un pagamento reale:
```bash
node scripts/setup-cassa-config.js --enable
```

---

## Checklist finale

- [ ] `systemctl status washhub-cassa-bridge` → active
- [ ] `curl -k https://washhub-cassa.local:8765/health` da Pi → `vne_reachable: true`
- [ ] Stesso URL aperto nel browser di Sebastiano → JSON visibile dopo eccezione cert
- [ ] IP statico assegnato sul router al Pi
- [ ] Doc Firestore `config/cassaAutomatica` con `bridgeUrl` e `bridgeToken` corretti
- [ ] `enabled: true` solo dopo test pagamento reale

---

## Troubleshooting

| Sintomo | Causa | Fix |
|---|---|---|
| `washhub-cassa.local` non risolve dal PC | Bonjour mancante su Win | Installa Apple Bonjour, oppure usa IP statico in `bridgeUrl` |
| Browser dice "ERR_CERT_COMMON_NAME_INVALID" | Certificato senza il SAN giusto | Rigenera con `./init-tls.sh <IP-LAN-CORRETTO>` e riavvia il servizio |
| Pulsante 🏧 cliccato → "Failed to fetch" | Eccezione cert non ancora salvata nel browser | Apri `https://...:8765/health` manualmente, accetta cert, ricarica |
| `vne_reachable: false` | IP cassa errato o cassa spenta | `ping VNE_HOST`, controlla cavo cassa-router |
| 502/504 ricorrente | Cassa firmware bloccato | Spegni-riaccendi cassa fisicamente |
| Bridge muore al boot | venv path errato in `.service` | Verifica `EnvironmentFile=` e `ExecStart=` |
| WiFi del Pi cade spesso | Segnale Wi-Fi debole | Avvicina al router o usa dongle USB-WiFi esterno |

Log:
```bash
tail -f /var/log/washhub-cassa-bridge.log
sudo journalctl -u washhub-cassa-bridge -f
```

## Operatività

- Consumo: ~1-2W (Pi Zero W).
- Posizionamento: dentro armadietto/box vicino alla cassa, alimentato da
  presa stabile, segnale Wi-Fi forte.
- Etichetta fisica con: `washhub-cassa`, IP statico, scopo, contatto.
- Backup config periodico:
```bash
sudo tar czf ~/backup-cassa-$(date +%F).tgz /home/washhub/dashdebug/bridge-cassa/.env /home/washhub/dashdebug/bridge-cassa/tls /etc/systemd/system/washhub-cassa-bridge.service
scp ~/backup-cassa-*.tgz utente@mac:~/backup/
```
