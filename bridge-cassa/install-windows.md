# Installazione bridge cassa VNE — PC Windows del Wash Hub

> ⚠️ **Guida alternativa.** La scelta operativa di Wash Hub è il
> Raspberry Pi (vedi `install-linux.md`). Questa guida resta come
> fallback se il Pi non è disponibile e si vuole usare un PC Windows
> sempre acceso in struttura.

---

## 0. Pre-requisiti

- Windows 10/11
- Cavo LAN PC↔cassa VNE attivo, IP cassa raggiungibile (di solito `192.168.1.50`).
  Verifica con `ping 192.168.1.50` da CMD.
- Account amministratore Windows (per registrare il servizio).
- Account Cloudflare con il dominio `washhub.it` già migrato (NS Cloudflare).

---

## 1. Installa Python 3.12

1. Scarica installer da <https://www.python.org/downloads/windows/>.
2. **Spunta** "Add python.exe to PATH" prima di cliccare Install.
3. Verifica in PowerShell: `python --version` → deve stampare `Python 3.12.x`.

---

## 2. Copia il bridge sul PC

Crea una cartella stabile, es. `C:\washhub\bridge-cassa\` e copia dentro
tutto il contenuto della directory `bridge-cassa/` di questa repo.

---

## 3. Crea virtualenv e installa dipendenze

Apri **PowerShell come Amministratore**:

```powershell
cd C:\washhub\bridge-cassa
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

---

## 4. Configura `.env`

```powershell
copy .env.example .env
notepad .env
```

Compila:

- `VNE_HOST` con l'IP reale della cassa (es. `192.168.1.50`).
- `BRIDGE_TOKEN` genera così:
  ```powershell
  python -c "import secrets; print(secrets.token_urlsafe(48))"
  ```
  Copia la stringa nel `.env`. **Salva anche** una copia: dovrai metterla
  nel doc Firestore `config/cassaAutomatica.bridgeToken`.
- `OP_NAME` puoi lasciarlo `dashdebug`.
- `PORT` lasciare `8765` salvo conflitti.

---

## 5. Test smoke

```powershell
python run.py
```

In un'altra finestra PowerShell:

```powershell
curl http://127.0.0.1:8765/health
```

Deve rispondere JSON con `"ok": true` e `"vne_reachable": true` se la
cassa è raggiungibile.

Test pagamento (sostituisci `<TOKEN>`):

```powershell
$h = @{ "Authorization" = "Bearer <TOKEN>"; "Content-Type" = "application/json" }
Invoke-RestMethod -Uri http://127.0.0.1:8765/stato -Headers $h
```

`Ctrl+C` per fermare.

---

## 6. Registra come servizio Windows con NSSM

1. Scarica NSSM da <https://nssm.cc/download> ed estrai `nssm.exe` in `C:\nssm\`.
2. Da PowerShell admin:

```powershell
C:\nssm\nssm.exe install WashHubCassaBridge `
    "C:\washhub\bridge-cassa\venv\Scripts\python.exe" `
    "C:\washhub\bridge-cassa\run.py"

C:\nssm\nssm.exe set WashHubCassaBridge AppDirectory "C:\washhub\bridge-cassa"
C:\nssm\nssm.exe set WashHubCassaBridge Start SERVICE_AUTO_START
C:\nssm\nssm.exe set WashHubCassaBridge AppStdout "C:\washhub\bridge-cassa\bridge.out.log"
C:\nssm\nssm.exe set WashHubCassaBridge AppStderr "C:\washhub\bridge-cassa\bridge.err.log"
C:\nssm\nssm.exe start WashHubCassaBridge
```

Verifica: `Get-Service WashHubCassaBridge` → `Status: Running`.

---

## 7. Cloudflare Tunnel — espone su `cassa.washhub.it`

> Pre-requisito: dominio `washhub.it` con NS = Cloudflare.

### 7.1 Scarica `cloudflared.exe`

<https://github.com/cloudflare/cloudflared/releases/latest> → `cloudflared-windows-amd64.exe`,
salva in `C:\cloudflared\cloudflared.exe`.

### 7.2 Login

```powershell
C:\cloudflared\cloudflared.exe tunnel login
```

Apre il browser, autorizza il dominio `washhub.it`.

### 7.3 Crea il tunnel

```powershell
C:\cloudflared\cloudflared.exe tunnel create washhub-cassa
```

Copia il **Tunnel ID** stampato (UUID). I credenziali finiscono in
`C:\Users\<user>\.cloudflared\<UUID>.json`.

### 7.4 Aggiungi CNAME su GoDaddy

> `washhub.it` resta su GoDaddy (NS `ns81/ns82.domaincontrol.com`).
> Quindi NON usare `cloudflared tunnel route dns ...` (richiede NS Cloudflare).

1. Apri <https://account.godaddy.com> → dominio `washhub.it` → tab **DNS**.
2. Click **"Aggiungi nuovo record"**.
3. Compila:
   - **Tipo:** `CNAME`
   - **Nome:** `cassa`
   - **Dati:** `<UUID>.cfargotunnel.com` (incolla l'UUID del tunnel)
   - **TTL:** 1 ora
4. Salva.
5. Verifica dopo 10-30 minuti dal Mac:
```bash
nslookup cassa.washhub.it 8.8.8.8
```

### 7.5 Crea `config.yml`

In `C:\Users\<user>\.cloudflared\config.yml`:

```yaml
tunnel: <UUID>
credentials-file: C:\Users\<user>\.cloudflared\<UUID>.json

ingress:
  - hostname: cassa.washhub.it
    service: http://127.0.0.1:8765
  - service: http_status:404
```

### 7.6 Test

```powershell
C:\cloudflared\cloudflared.exe tunnel run washhub-cassa
```

Da un altro device: `curl https://cassa.washhub.it/health` → JSON OK.

`Ctrl+C` per fermare.

### 7.7 Installa come servizio Windows

```powershell
C:\cloudflared\cloudflared.exe service install
```

Avvia: `Start-Service Cloudflared`. Riavvia il PC e verifica che torni su.

---

## 8. Checklist finale

- [ ] `Get-Service WashHubCassaBridge` → Running
- [ ] `Get-Service Cloudflared` → Running
- [ ] `curl https://cassa.washhub.it/health` da fuori rete → OK
- [ ] Token incollato nel doc Firestore `config/cassaAutomatica.bridgeToken`
- [ ] `enabled: true` nel doc Firestore (solo dopo test su prenotazione reale)

---

## Troubleshooting rapido

| Sintomo | Causa probabile | Fix |
|---|---|---|
| `health` ok ma `vne_reachable: false` | LAN/IP cassa errato | `ping VNE_HOST`; controlla cavo |
| 401 da web | token non allineato Firestore↔.env | rifletti la stessa stringa in entrambi |
| 502/504 ricorrente | cassa spenta o firmware bloccato | spegni e riaccendi cassa |
| Bridge non si avvia | Python venv guasto | rifai venv (step 3) |
| Tunnel down dopo update Win | servizio cloudflared fermo | `Start-Service Cloudflared` |

Log dettagliati: `C:\washhub\bridge-cassa\bridge.out.log` e `bridge.err.log`.
Eventi servizio: **Visualizzatore eventi → Registri di Windows → Applicazione**,
filtra per "WashHubCassaBridge".
