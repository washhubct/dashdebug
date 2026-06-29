/**
 * Bridge dashdebug → FidelAI external API.
 *
 * Trigger Firestore che registrano transazioni di fedeltà su `fideliai-app`
 * ogni volta che una prenotazione/tappezzeria/abbonamento viene saldata.
 *
 * Regola: i clienti FidelAI esistono SOLO se hanno attivato la card via
 * card.washhub.it con consenso esplicito. Questo bridge NON crea customer
 * automaticamente — chiama solo externalRecordTransaction, che skippa
 * silenziosamente se il customer non esiste o non ha cardAttivata=true.
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

async function recordEarn(collection: string, docId: string, data: AnyDoc): Promise<void> {
  const phone = normalizePhone(data.telefono)
  if (!phone) return
  const amount = getAmount(data)
  if (amount <= 0) return

  await callFidelai('externalRecordTransaction', {
    merchant: FIDELAI_MERCHANT.value(),
    customerId: phone,
    amount,
    type: 'earn',
    sedeId: data.sedeId || null,
    refId: `${collection}:${docId}`,
    notes: collection,
  })
}

function paymentUpdatedTrigger(collection: string) {
  return onDocumentUpdated(
    { document: `${collection}/{id}`, ...baseOpts },
    async (event) => {
      const before = event.data?.before.data()
      const after = event.data?.after.data()
      if (!after) return
      if (isPaid(before) || !isPaid(after)) return // solo transizione → pagato

      try {
        await recordEarn(collection, event.params.id, after)
      } catch (err) {
        console.error(`[fidelai] ${collection} payment trigger failed`, event.params.id, err)
      }
    }
  )
}

function paymentCreatedTrigger(collection: string) {
  return onDocumentCreated(
    { document: `${collection}/{id}`, ...baseOpts },
    async (event) => {
      const after = event.data?.data()
      if (!after || !isPaid(after)) return

      try {
        await recordEarn(collection, event.params.id, after)
      } catch (err) {
        console.error(`[fidelai] ${collection} create trigger failed`, event.params.id, err)
      }
    }
  )
}

export const fidelaiPrenotazioneUpdated = paymentUpdatedTrigger('prenotazioni')
export const fidelaiPrenotazioneCreated = paymentCreatedTrigger('prenotazioni')
export const fidelaiTappezzeriaUpdated = paymentUpdatedTrigger('tappezzeria')
export const fidelaiTappezzeriaCreated = paymentCreatedTrigger('tappezzeria')
export const fidelaiAbbonamentoUpdated = paymentUpdatedTrigger('abbonamenti')
export const fidelaiAbbonamentoCreated = paymentCreatedTrigger('abbonamenti')
