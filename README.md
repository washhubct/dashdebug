# Wash Hub Gestionale (dashdebug)

Gestionale interno di **Wash Hub Lungomare** — autolavaggio + parcheggio.

- Live: <https://dashboard.washhub.it>
- Hosting: GitHub Pages (custom domain), deploy = `git push origin main`
- Backend: Firebase (Firestore, Auth) — project `dashboard-washhub`
- Frontend: vanilla JS ES6 modules

---

## Cassa Automatica VNE

Integrazione con la cassa automatica V.N.E. (protocollo SelfCashAPI 3.05)
installata in struttura. Il pagamento contante avviene direttamente nella
cassa (banconote + monete con resto), e il gestionale lo registra.

### Architettura (modalità LAN-only)

```
PC Sebastiano                    Raspberry Pi Zero W
(stesso Wi-Fi del Wash Hub)     (IP statico LAN)
        │                                │
        │ HTTPS self-signed              │
        │ (eccezione cert salvata        │
        │  nel browser una volta)        │
        ▼                                ▼
https://washhub-cassa.local:8765 ──▶ Bridge Python (cheroot TLS)
                                         │
                                         │ HTTPS self-signed
                                         ▼
                                  Cassa VNE (LAN)
                                  protocollo 3.05
```

**Niente Cloudflare Tunnel, niente DNS pubblico**: bridge e PC di Sebastiano
sono sulla stessa rete locale, il browser apre `https://washhub-cassa.local:8765`
con cert self-signed (eccezione salvata una volta sola per browser).

> Per il setup alternativo con Cloudflare Tunnel (utile se serve raggiungere
> il bridge da fuori il Wash Hub), il bridge supporta anche modalità HTTP loopback:
> basta NON generare i cert e il `run.py` parte automaticamente in HTTP su 127.0.0.1.

### Componenti

- **Bridge Python** in `bridge-cassa/` — guida installazione:
  [`bridge-cassa/install-linux.md`](bridge-cassa/install-linux.md) (Raspberry Pi)
  oppure [`bridge-cassa/install-windows.md`](bridge-cassa/install-windows.md) (PC Win).
- **Modulo client** `js/moduli/cassa-automatica.js` — modale + polling +
  mappatura errori.
- **Widget admin dashboard** `js/moduli/cassa-stato.js` — stato VNE in tempo
  reale (refresh 30s).
- **Config Firestore**: doc `config/cassaAutomatica` (vedi
  `scripts/setup-cassa-config.js`).
- **Note protocollo**: [`bridge-cassa/PROTOCOLLO-VNE-NOTES.md`](bridge-cassa/PROTOCOLLO-VNE-NOTES.md).

### DNS

Nessun DNS pubblico necessario. `washhub.it` resta su GoDaddy senza modifiche.
Il bridge è raggiungibile in LAN tramite mDNS (`washhub-cassa.local`) o IP
statico assegnato dal router.

### Checklist installazione

- [ ] Setup Pi Zero W seguendo `bridge-cassa/install-linux.md` step 1-7.
- [ ] Genera cert self-signed: `./init-tls.sh <IP-LAN>` (step 8).
- [ ] Bridge token: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` (step 9).
- [ ] `.env` configurato con VNE_HOST + token (step 10).
- [ ] Servizio systemd `washhub-cassa-bridge` attivo (step 12).
- [ ] PC Sebastiano: cert eccezione salvata nel browser visitando l'URL bridge (step 13).
- [ ] Reboot Pi e verifica autostart (step 14).
- [ ] Doc Firestore: `node scripts/setup-cassa-config.js --token <TOKEN> --url https://washhub-cassa.local:8765`.
- [ ] Deploy regole: `firebase deploy --only firestore:rules --project dashboard-washhub`.
- [ ] Test pagamento reale su una prenotazione finta.
- [ ] Abilitare: `node scripts/setup-cassa-config.js --enable`.

### Flag operativo

Il pulsante 🏧 CASSA AUTO compare nella tabella prenotazioni **solo** se
`config/cassaAutomatica.enabled === true`. Spegnere ⇒ `--disable`.
