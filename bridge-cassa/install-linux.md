# Installazione bridge cassa VNE — Raspberry Pi (Debian/Raspberry Pi OS)

> Guida operativa per installare il bridge sul Raspberry Pi dedicato
> collocato in struttura, in cavo LAN con la cassa VNE.

---

## 0. Materiale consigliato

- **Raspberry Pi 5 4GB** (o Pi 4 / Zero 2 W vanno benissimo: il bridge consuma <50MB RAM).
- Alimentatore ufficiale.
- microSD 32GB classe A1 (Sandisk/Samsung).
- Case con dissipatore.
- Cavo Ethernet RJ45 → router/switch in cavo con la cassa VNE (no Wi-Fi).

## 1. Preparazione SD card (sul Mac)

1.1. Scarica **Raspberry Pi Imager** da <https://www.raspberrypi.com/software/>.
1.2. Inserisci microSD nel Mac.
1.3. Apri Imager:
- **Device:** Raspberry Pi 5 (o quello che hai)
- **OS:** *Raspberry Pi OS Lite (64-bit)* — versione headless, senza desktop
- **Storage:** la microSD

1.4. Click **⚙️ "Edit Settings"** (rotella ingranaggio):
- **Hostname:** `washhub-cassa`
- **Username:** `washhub`
- **Password:** scegli una robusta, *salvala in 1Password*
- **Wireless LAN:** lascia vuoto (useremo cavo)
- **Locale:** Europe/Rome, IT
- **Services tab:** spunta **"Enable SSH"** → "Use password authentication"
- Salva

1.5. Click **Write** → conferma → attendi 5-10 min → estrai SD.

## 2. Primo boot Pi

2.1. Inserisci microSD nel Pi.
2.2. Collega cavo Ethernet (stessa rete della cassa VNE).
2.3. Collega alimentazione → led verde lampeggia 1-2 min.
2.4. Dal Mac trova l'IP del Pi:
```bash
ping washhub-cassa.local
# Se mDNS non risolve, scansiona la rete:
arp -a | grep -i b8:27 ; arp -a | grep -i dca6  # Pi 4 / Pi 5
```
2.5. SSH:
```bash
ssh washhub@washhub-cassa.local
# password che hai impostato in Imager
```

## 3. Setup base sistema

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git python3-venv python3-pip curl ufw fail2ban
sudo timedatectl set-timezone Europe/Rome
```

## 4. Hardening minimo (raccomandato)

```bash
# Firewall: blocca tutto in entrata tranne SSH dalla LAN
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.0.0/16 to any port 22 proto tcp
sudo ufw enable
# Verifica
sudo ufw status
```

> Il bridge ascolta su `127.0.0.1:8765` quindi non è esposto in LAN.
> L'esposizione esterna passa SOLO via Cloudflare Tunnel (uscente).

## 5. Clona il progetto

```bash
cd ~
git clone https://github.com/washhubct/dashdebug.git
cd dashdebug/bridge-cassa
```

## 6. Crea venv e installa dipendenze

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
```

## 7. Genera bridge token

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```
**Salva la stringa generata.** La metterai sia in `.env` qui sotto sia
nel doc Firestore `config/cassaAutomatica.bridgeToken`.

## 8. Configura `.env`

```bash
cp .env.example .env
nano .env
```

Compila:
```env
VNE_HOST=192.168.1.50      # IP reale della cassa VNE — verifica con ping
VNE_PROTOCOL=https
BRIDGE_TOKEN=<stringa-generata-allo-step-7>
OP_NAME=dashdebug
PORT=8765
```

`Ctrl+O` `Enter` `Ctrl+X` per salvare e uscire da nano.

Verifica connessione cassa:
```bash
ping -c 3 192.168.1.50    # deve rispondere
```

## 9. Test smoke

```bash
source venv/bin/activate
python run.py
```

In un'altra finestra SSH (`ssh washhub@washhub-cassa.local`):
```bash
curl http://127.0.0.1:8765/health
```
Deve rispondere JSON con `"vne_reachable": true`.

`Ctrl+C` per fermare.

## 10. Servizio systemd (auto-start al boot, restart su crash)

```bash
sudo tee /etc/systemd/system/washhub-cassa-bridge.service > /dev/null <<'EOF'
[Unit]
Description=Wash Hub - Bridge Cassa VNE
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
curl http://127.0.0.1:8765/health
tail -f /var/log/washhub-cassa-bridge.log
```

## 11. Cloudflare Tunnel — installazione cloudflared

```bash
# Aggiungi repo Cloudflare
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main' | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt update
sudo apt install -y cloudflared
cloudflared --version
```

> Su Pi OS 32-bit (raro) usa il binario armhf da
> <https://github.com/cloudflare/cloudflared/releases/latest>.

## 12. Login Cloudflare (una sola volta)

```bash
cloudflared tunnel login
```

Stampa un URL. **Aprilo dal Mac** (copia il link), autorizza il dominio
`washhub.it` su Cloudflare. Il `cert.pem` viene salvato sul Pi in
`~/.cloudflared/cert.pem`.

> Se non vedi `washhub.it` nella lista Cloudflare significa che il dominio
> non è ancora aggiunto come zona Cloudflare. Devi:
>
> 1. Login su <https://dash.cloudflare.com>
> 2. Click **"Add a site"** → `washhub.it` → piano **Free**.
> 3. **NON cambiare i nameserver** quando te lo chiede (continua a ignorare).
> 4. Cloudflare comunque assegna la zona; il login da Pi ora la troverà.
>
> NB: senza switch NS, alcune feature CF (proxy, WAF) non funzionano,
> ma i Tunnel funzionano benissimo.

## 13. Crea il tunnel

```bash
cloudflared tunnel create washhub-cassa
```

Output:
```
Tunnel credentials written to /home/washhub/.cloudflared/<UUID>.json
Created tunnel washhub-cassa with id <UUID>
```

**Copia l'UUID** (formato `12345678-aaaa-bbbb-cccc-1234567890ab`).
Ti serve allo step 14 e 15.

## 14. Aggiungi CNAME `cassa.washhub.it` su GoDaddy

> Solo perché `washhub.it` non ha NS Cloudflare. Se in futuro migri NS,
> il record si crea da CLI con `cloudflared tunnel route dns ...`.

1. Apri <https://account.godaddy.com> → dominio `washhub.it` → tab **DNS**.
2. Click **"Aggiungi nuovo record"**.
3. Compila:
   - **Tipo:** `CNAME`
   - **Nome:** `cassa`
   - **Dati / Punta a:** `<UUID>.cfargotunnel.com`
   - **TTL:** 1 ora
4. Salva.
5. Verifica dopo 10-30 minuti dal Mac:
```bash
nslookup cassa.washhub.it 8.8.8.8
# Deve restituire: cassa.washhub.it → <UUID>.cfargotunnel.com → IP Cloudflare
```

## 15. Configura il tunnel

```bash
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

Incolla (sostituisci `<UUID>` due volte):
```yaml
tunnel: <UUID>
credentials-file: /home/washhub/.cloudflared/<UUID>.json

ingress:
  - hostname: cassa.washhub.it
    service: http://127.0.0.1:8765
    originRequest:
      noTLSVerify: false
      connectTimeout: 10s
  - service: http_status:404
```

Salva (`Ctrl+O Ctrl+X`).

## 16. Test manuale tunnel

```bash
cloudflared tunnel run washhub-cassa
```

Da un altro device (telefono in 4G, **non WiFi locale**):
```
curl https://cassa.washhub.it/health
```
Deve rispondere JSON `{"ok": true, "vne_reachable": true, ...}`.

`Ctrl+C` sul Pi per fermare.

## 17. Cloudflared come servizio systemd

```bash
sudo cloudflared service install
# Copia config nei path di servizio
sudo cp ~/.cloudflared/config.yml /etc/cloudflared/config.yml
sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/<UUID>.json
sudo chown root:root /etc/cloudflared/*

sudo systemctl daemon-reload
sudo systemctl enable cloudflared
sudo systemctl restart cloudflared
sudo systemctl status cloudflared
```

Verifica:
```bash
sudo journalctl -u cloudflared -n 50 --no-pager
```

## 18. Reboot e verifica autostart

```bash
sudo reboot
# Dopo 1 min, dal Mac:
ssh washhub@washhub-cassa.local
sudo systemctl status washhub-cassa-bridge cloudflared
curl http://127.0.0.1:8765/health
# Da fuori rete:
curl https://cassa.washhub.it/health
```

Entrambi i servizi devono essere `active (running)`.

## 19. Update futuri

Quando esce un nuovo commit del bridge:
```bash
cd ~/dashdebug
git pull
cd bridge-cassa
source venv/bin/activate
pip install -r requirements.txt
deactivate
sudo systemctl restart washhub-cassa-bridge
```

## 20. Checklist finale

- [ ] `systemctl status washhub-cassa-bridge` → active
- [ ] `systemctl status cloudflared` → active
- [ ] `curl http://127.0.0.1:8765/health` da Pi → ok + vne_reachable=true
- [ ] `curl https://cassa.washhub.it/health` da fuori rete → ok
- [ ] Token salvato in 1Password e replicato in Firestore (vedi STEP 4 README)
- [ ] Pi alimentato in struttura, cavo LAN connesso, posizione stabile
- [ ] `enabled: true` solo dopo test pagamento reale

---

## Troubleshooting rapido

| Sintomo | Causa probabile | Fix |
|---|---|---|
| `vne_reachable: false` | LAN/IP cassa errato | `ping VNE_HOST`; controlla cavo e accensione cassa |
| 401 da web | token Firestore≠.env | rifletti la stessa stringa in entrambi |
| 502/504 ricorrente | cassa firmware bloccato | spegni e riaccendi cassa fisicamente |
| Tunnel offline dopo update | `cloudflared.service` morto | `sudo systemctl restart cloudflared` |
| Bridge non parte al boot | path .env errato | controlla `EnvironmentFile=` nel .service |

Log:
```bash
tail -f /var/log/washhub-cassa-bridge.log
sudo journalctl -u cloudflared -f
sudo journalctl -u washhub-cassa-bridge -f
```

## Specifiche operative Pi

- Consumo: ~3-5W (vs ~50-100W del PC Sebastiano)
- Posizionamento: vicino al router/switch, non vicino a fonti di calore
- Dare etichetta fisica con: hostname `washhub-cassa`, IP locale, scopo
- Backup config: `sudo tar czf ~/backup-cassa-$(date +%F).tgz /etc/cloudflared /home/washhub/dashdebug/bridge-cassa/.env /etc/systemd/system/washhub-cassa-bridge.service`
  e copialo via `scp` sul Mac periodicamente
