/**
 * Bridge dashdebug → FidelAI external API.
 *
 * Triggers Firestore che sincronizzano clienti e registrano transazioni di
 * fedeltà su `fideliai-app` ogni volta che una prenotazione/tappezzeria/
 * abbonamento viene saldata.
 *
 * Config:
 *   FIDELAI_API_BASE (param)  — es. https://europe-west1-fideliai-app.cloudfunctions.net
 *   FIDELAI_MERCHANT (param)  — slug merchant, default 'washhub'
 *   FIDELAI_BRIDGE_SECRET (secret) — bearer token shared con fideliai-app
 */

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { defineString, defineSecret } from 'firebase-functions/params'

const FIDELAI_API_BASE = defineString('FIDELAI_API_BASE', {
  default: 'https://europe-west1-fideliai-app.cloudfunctions.net',
})
const FIDELAI_MERCHANT = defineString('FIDELAI_MERCHANT', { default: 'washhub' })
const FIDELAI_BRIDGE_SECRET = defineSecret('FIDELAI_BRIDGE_SECRET')

const REGION = 'europe-west1'

type AnyDoc = Record<string, any>

function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  return digits.startsWith('39') && digits.length > 10 ? digits.slice(2) : digits
}

async function callFidelai(path: string, body: Record<string, unknown>): Promise<void> {
  const url = `${FIDELAI_API_BASE.value()}/${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FIDELAI_BRIDGE_SECRET.value()}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`FidelAI ${path} HTTP ${res.status}: ${txt}`)
  }
}

async function syncCustomerFromDoc(data: AnyDoc): Promise<string | null> {
  const phone = normalizePhone(data.telefono)
  if (!phone) return null
  const name = (data.nome || data.cliente || '').toString().trim()
  if (!name) return null
  await callFidelai('externalSyncCustomer', {
    merchant: FIDELAI_MERCHANT.value(),
    customerId: phone,
    name,
    phone,
    sedeId: data.sedeId || null,
    vetture: Array.isArray(data.vetture) ? data.vetture : undefined,
  })
  return phone
}

function getAmount(data: AnyDoc): number {
  const candidates = [data.prezzo, data.importo, data.totale, data.amount]
  for (const c of candidates) {
    const n = Number(c)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

function isPaid(data: AnyDoc | undefined): boolean {
  if (!data) return false
  if (data.saldato === 'SI' || data.saldato === true) return true
  if (data.stato === 'PAGATO' || data.stato === 'pagato') return true
  if (data.saldo === 'pagato') return true
  return false
}

const baseOpts = {
  region: REGION,
  secrets: [FIDELAI_BRIDGE_SECRET],
}

// Sync clienti — onCreate nuovo cliente CRM
export const fidelaiSyncCliente = onDocumentCreated(
  { document: 'clienti/{id}', ...baseOpts },
  async (event) => {
    const data = event.data?.data()
    if (!data) return
    try {
      await syncCustomerFromDoc(data)
    } catch (err) {
      console.error('[fidelai] syncCliente failed', event.params.id, err)
    }
  }
)

// Helper per i 3 trigger di pagamento (prenotazioni, tappezzeria, abbonamenti)
function paymentTrigger(collection: string) {
  return onDocumentUpdated(
    { document: `${collection}/{id}`, ...baseOpts },
    async (event) => {
      const before = event.data?.before.data()
      const after = event.data?.after.data()
      if (!after) return
      if (isPaid(before) || !isPaid(after)) return // ci interessa solo la transizione → pagato

      const amount = getAmount(after)
      if (amount <= 0) return

      try {
        const cid = await syncCustomerFromDoc(after) // upsert difensivo
        if (!cid) return
        await callFidelai('externalRecordTransaction', {
          merchant: FIDELAI_MERCHANT.value(),
          customerId: cid,
          amount,
          type: 'earn',
          sedeId: after.sedeId || null,
          refId: `${collection}:${event.params.id}`,
          notes: collection,
        })
      } catch (err) {
        console.error(`[fidelai] ${collection} payment trigger failed`, event.params.id, err)
      }
    }
  )
}

// Stesso pattern: onCreate, nel caso una prenotazione/abbonamento/tappezzeria
// venga inserita già saldata (es. pagamento immediato in cassa).
function paymentCreateTrigger(collection: string) {
  return onDocumentCreated(
    { document: `${collection}/{id}`, ...baseOpts },
    async (event) => {
      const after = event.data?.data()
      if (!after || !isPaid(after)) return

      const amount = getAmount(after)
      if (amount <= 0) return

      try {
        const cid = await syncCustomerFromDoc(after)
        if (!cid) return
        await callFidelai('externalRecordTransaction', {
          merchant: FIDELAI_MERCHANT.value(),
          customerId: cid,
          amount,
          type: 'earn',
          sedeId: after.sedeId || null,
          refId: `${collection}:${event.params.id}`,
          notes: collection,
        })
      } catch (err) {
        console.error(`[fidelai] ${collection} create trigger failed`, event.params.id, err)
      }
    }
  )
}

export const fidelaiPrenotazioneUpdated = paymentTrigger('prenotazioni')
export const fidelaiPrenotazioneCreated = paymentCreateTrigger('prenotazioni')
export const fidelaiTappezzeriaUpdated = paymentTrigger('tappezzeria')
export const fidelaiTappezzeriaCreated = paymentCreateTrigger('tappezzeria')
export const fidelaiAbbonamentoUpdated = paymentTrigger('abbonamenti')
export const fidelaiAbbonamentoCreated = paymentCreateTrigger('abbonamenti')
