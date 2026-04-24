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
                                       │  PC Wash Hub (Win10)     │
                                       │  127.0.0.1:8765 / NSSM   │
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

- **Bridge Python** in `bridge-cassa/` — guida installazione passo-passo:
  [`bridge-cassa/install-windows.md`](bridge-cassa/install-windows.md).
- **Modulo client** `js/moduli/cassa-automatica.js` — modale + polling +
  mappatura errori.
- **Widget admin dashboard** `js/moduli/cassa-stato.js` — stato VNE in tempo
  reale (refresh 30s).
- **Config Firestore**: doc `config/cassaAutomatica` (vedi
  `scripts/setup-cassa-config.js`).
- **Note protocollo**: [`bridge-cassa/PROTOCOLLO-VNE-NOTES.md`](bridge-cassa/PROTOCOLLO-VNE-NOTES.md).

### Checklist installazione

- [ ] DNS: migrare `washhub.it` su Cloudflare (oggi è su GoDaddy
      ns81/ns82.domaincontrol.com).
- [ ] Installare bridge sul PC di Sebastiano (`bridge-cassa/install-windows.md`).
- [ ] Configurare Cloudflare Tunnel `cassa.washhub.it → 127.0.0.1:8765`.
- [ ] Eseguire `node scripts/setup-cassa-config.js --token <TOKEN>`
      per scrivere il doc `config/cassaAutomatica`.
- [ ] Deploy regole Firestore: `firebase deploy --only firestore:rules --project dashboard-washhub`.
- [ ] Test pagamento reale su una prenotazione finta.
- [ ] Abilitare: `node scripts/setup-cassa-config.js --enable`.

### Flag operativo

Il pulsante 🏧 CASSA AUTO compare nella tabella prenotazioni **solo** se
`config/cassaAutomatica.enabled === true`. Spegnere ⇒ `--disable`.
