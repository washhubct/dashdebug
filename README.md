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

### Architettura

```
┌──────────────────────┐                ┌────────────────────────┐
│ dashboard.washhub.it │  HTTPS+Bearer  │ cassa.washhub.it       │
│  (GitHub Pages, JS)  │ ─────────────▶ │  Cloudflare Tunnel     │
└──────────────────────┘                └─────────┬──────────────┘
                                                  │ http loopback
                                                  ▼
                                       ┌──────────────────────────┐
                                       │ Bridge Python Flask      │
                                       │  Raspberry Pi (Linux)    │
                                       │  127.0.0.1:8765 / systemd│
                                       └─────────┬────────────────┘
                                                 │ HTTPS self-signed
                                                 │ LAN
                                                 ▼
                                       ┌──────────────────────────┐
                                       │ VNE Automatic Cash       │
                                       │  protocollo 3.05         │
                                       └──────────────────────────┘
```

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

`washhub.it` resta su GoDaddy (NS `ns81/ns82.domaincontrol.com`). Il
sottodominio `cassa.washhub.it` è un **CNAME manuale** verso
`<UUID>.cfargotunnel.com` aggiunto sul pannello DNS GoDaddy dopo aver
creato il tunnel — **nessuna migrazione di nameserver necessaria**.

### Checklist installazione

- [ ] Acquistare Raspberry Pi 5 4GB + alimentatore + microSD 32GB + case.
- [ ] Setup Pi seguendo `bridge-cassa/install-linux.md` step 1-9.
- [ ] Servizio systemd `washhub-cassa-bridge` attivo (step 10).
- [ ] Cloudflare Tunnel creato — annota UUID (step 11-13).
- [ ] CNAME `cassa.washhub.it` su GoDaddy DNS → `<UUID>.cfargotunnel.com` (step 14).
- [ ] `cloudflared` come servizio (step 15-17).
- [ ] Reboot Pi e verifica autostart (step 18).
- [ ] Eseguire `node scripts/setup-cassa-config.js --token <TOKEN>`.
- [ ] Deploy regole Firestore: `firebase deploy --only firestore:rules --project dashboard-washhub`.
- [ ] Test pagamento reale su una prenotazione finta.
- [ ] Abilitare: `node scripts/setup-cassa-config.js --enable`.

### Flag operativo

Il pulsante 🏧 CASSA AUTO compare nella tabella prenotazioni **solo** se
`config/cassaAutomatica.enabled === true`. Spegnere ⇒ `--disable`.
