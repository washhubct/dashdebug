// Configura (o aggiorna) LAST MILE SRL su Openapi per gli Smart Receipts (documento commerciale online).
// Uso: OPENAPI_ENV=test|prod node scripts/openapi-config-lastmile.mjs
// Legge: OPENAPI_TOKEN (firebase functions:secrets:access) e ~/.config/gcloud-keys/openapi-lastmile.env
//   (ADE_TAXCODE, ADE_PASSWORD, ADE_PIN = credenziali Fisconline di chi trasmette per Last Mile; LASTMILE_PIVA; MERCHANT_* indirizzo sede legale)
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
const env = Object.fromEntries(readFileSync(`${homedir()}/.config/gcloud-keys/openapi-lastmile.env`, 'utf8').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const token = process.env.OPENAPI_TOKEN || execSync('firebase functions:secrets:access OPENAPI_TOKEN --project dashboard-washhub', { encoding: 'utf8' }).trim()
const ENV = process.env.OPENAPI_ENV || 'test'
const base = ENV === 'prod' ? 'https://invoice.openapi.com' : 'https://test.invoice.openapi.com'
const SELF = 'https://europe-west1-dashboard-washhub.cloudfunctions.net/parcheggioSmart/scontrino-callback'
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const cb = (event) => ({ event, callback: { method: 'JSON', url: SELF, field: 'data' } })
const body = {
  fiscal_id: env.LASTMILE_PIVA, name: 'LAST MILE SRL', email: 'info@washhub.it',
  receipts: true,
  merchant_address: { street_address: env.MERCHANT_STREET, street_number: env.MERCHANT_NUMBER, zip_code: env.MERCHANT_CAP, city: env.MERCHANT_CITY, province: env.MERCHANT_PROV },
  receipts_authentication: { taxCode: env.ADE_TAXCODE, password: env.ADE_PASSWORD, pin: env.ADE_PIN },
  api_configurations: ['receipt', 'receipt-error', 'receipt-retry', 'receipt-credentials'].map(cb),
}
for (const k of ['fiscal_id', 'merchant_address.street_address', 'receipts_authentication.taxCode']) { const v = k.split('.').reduce((o, p) => o?.[p], body); if (!v) throw new Error('manca ' + k) }
let r = await fetch(`${base}/IT-configurations/${body.fiscal_id}`, { headers: H })
const exists = r.status === 200
r = await fetch(`${base}/IT-configurations${exists ? '/' + body.fiscal_id : ''}`, { method: exists ? 'PATCH' : 'POST', headers: H, body: JSON.stringify(body) })
const j = await r.json().catch(() => ({}))
const safe = JSON.parse(JSON.stringify(j)); if (safe?.data?.receipts_authentication) safe.data.receipts_authentication = '***'
console.log(ENV, exists ? 'PATCH' : 'POST', r.status, JSON.stringify(safe).slice(0, 800))
