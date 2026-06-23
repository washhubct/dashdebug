# WhatsApp Cloud API — Runbook attivazione

> Tutto il codice è già in `main` (commits 11f5996, 35af428, 74b5f73, 061ddc5).
> Questo doc è il checklist operativo per accendere il canale.

## Prerequisiti

- App Meta Developer su https://developers.facebook.com/apps
- Numero di telefono dedicato (non già su WhatsApp consumer / Business app)
- Account FB Business Manager verificato (per uscire dal sandbox 1000 msg/mese)

---

## 1. Setup Meta Developer (manuale, ~20 min)

1. https://developers.facebook.com/apps → **Create App** → tipo **Business**
2. Add product → **WhatsApp** → Get started
3. Setup phone number:
   - Sandbox iniziale: Meta fornisce numero test (5 destinatari max)
   - Produzione: aggiungi numero proprietario (richiede SMS verify + Business verification)
4. Annota:
   - **Phone Number ID** (es. `123456789012345`) → finirà in `META_PHONE_NUMBER_ID`
   - **WhatsApp Business Account ID** (per template approval)
5. Permanent token:
   - Business Settings → Users → **System Users** → Add → ruolo Admin
   - Generate Token → app = la tua → permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
   - Token = lunga stringa che NON scade → finirà in `META_WHATSAPP_TOKEN`
6. App Secret:
   - App Dashboard → Settings → Basic → **App Secret** (Show) → copia
   - Finirà in `META_APP_SECRET`
7. Verify Token webhook:
   - Stringa random a tua scelta (es. `washhub-wa-verify-2026-xyz`)
   - Finirà in `META_WEBHOOK_VERIFY_TOKEN`
   - La userai sia su Meta che come secret Firebase (devono combaciare)

## 2. Imposta secrets Firebase

```bash
firebase use dashboard-washhub
cd functions

# Permanent token Meta (lungo, sensibile)
firebase functions:secrets:set META_WHATSAPP_TOKEN
# incolla quando chiede

firebase functions:secrets:set META_PHONE_NUMBER_ID
# incolla Phone Number ID

firebase functions:secrets:set META_WEBHOOK_VERIFY_TOKEN
# incolla la stringa random scelta al punto 1.7

firebase functions:secrets:set META_APP_SECRET
# incolla App Secret Meta
```

Verifica:
```bash
firebase functions:secrets:list
```

## 3. Deploy Cloud Functions

```bash
cd /Users/macia/Progetti/dashdebug
firebase deploy --only functions:whatsappWebhook,functions:whatsappSend,functions:whatsappSendBulk --project dashboard-washhub
```

Annota l'URL deployato di `whatsappWebhook`, sarà tipo:
```
https://europe-west1-dashboard-washhub.cloudfunctions.net/whatsappWebhook
```

## 4. Configura webhook su Meta

1. App Dashboard → WhatsApp → Configuration → **Webhook** → Edit
2. **Callback URL**: l'URL del punto 3
3. **Verify Token**: la stessa stringa usata in `META_WEBHOOK_VERIFY_TOKEN`
4. Verify and Save (Meta fa GET di verifica → la function risponde 200 col challenge)
5. **Webhook fields** → subscribe a: `messages`, `message_status`

Test rapido: dal tuo cellulare invia un messaggio al numero business → deve apparire entro 1-2 secondi nella UI gestionale (pagina Messaggi).

## 5. Approvazione template Meta

I 4 template usati dal composer richiedono approvazione (1-24h):

| ID interno | Nome Meta | Categoria |
|---|---|---|
| `conferma_prenotazione` | `conferma_prenotazione` | UTILITY |
| `reminder_prenotazione` | `reminder_prenotazione` | UTILITY |
| `grazie_pagamento` | `grazie_pagamento` | MARKETING |
| `benvenuto_nuovo_cliente` | `benvenuto_nuovo_cliente` | MARKETING |

Crea su: Business Manager → WhatsApp Manager → Message Templates → New.

**Nota:** se i template hanno variabili `{{1}}` `{{2}}`, va aggiornato `messaggi.js` per
passare `components` con i parametri runtime. Per ora il composer invia solo template
**senza variabili** (testo statico).

## 6. Smoke test E2E

1. Apri https://dashboard.washhub.it → pagina **Messaggi**
2. Da WhatsApp personale invia "test" al numero business
3. Verifica:
   - Comparsa chat in lista < 2s
   - Bubble inbound visibile
   - Badge nav incrementato
   - Notifica browser (se permessa)
   - Click sulla chat azzera badge
4. Rispondi dal composer (finestra 24h aperta) → bubble outbound + status ✓ → ✓✓
5. Aspetta >24h o forza windowExpiresAt indietro → composer disabilitato, solo template

---

## Cosa NON è ancora implementato (roadmap)

- **Template con variabili**: serve UI per compilare `{{1}}` `{{2}}` runtime
- **Bulk send**: `whatsappSendBulk` è stub. Per broadcast a N clienti serve
  batching + rate limit Meta (max ~80 msg/s) + log invii
- **Auto-template post-prenotazione**: trigger Firestore su `prenotazioni` create
  che manda automaticamente `conferma_prenotazione` (analogo SMS reminder Twilio)
- **Reazioni / media**: webhook ignora image/audio/document (loggati come `[type]`)
- **Multi-operatore typing indicator**: nice-to-have, non critico

## Costi

- Inbound: **gratis**
- Outbound conversation-initiated (24h window): **gratis** se reply a inbound
- Template utility (notifiche): **~€0.024/msg** (Italia)
- Template marketing: **~€0.057/msg** (Italia)
- Free tier: 1000 conversazioni service-initiated/mese
