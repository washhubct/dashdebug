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
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

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

async function callFidelai(path: string, body: Record<string, unknown>): Promise<any> {
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
  return res.json().catch(() => ({}))
}

// Invito card dopo il pagamento (dal 07/10/2026, spento finché config/fidelity.invitoAttivo != true).
// Una sola volta per numero (fidelityInviti/{tel}); il messaggio parte dal worker WhatsApp Web del
// Mac Mini (whatsappCoda, priorità alta). La card la attiva il cliente: qui si manda solo il link,
// e i punti di questo lavaggio restano in sospeso su FidelAI finché non la attiva.
const TESTO_INVITO_DEFAULT = 'Ciao {nome} 👋 grazie per essere passato al Wash Hub!\n\nCon la card fedeltà accumuli punti a ogni lavaggio e li trasformi in premi. I punti del lavaggio di oggi te li abbiamo già messi da parte: attiva la card qui e li trovi caricati 👇\n{link}\n\nA presto,\nStaff Wash Hub'

async function invitaCard(collection: string, docId: string, data: AnyDoc, phone: string): Promise<void> {
  const db = getFirestore()
  const cfg = (await db.doc('config/fidelity').get()).data() || {}
  if (cfg.invitoAttivo !== true) return
  const test: string[] = Array.isArray(cfg.numeriTest) ? cfg.numeriTest.map((t: string) => String(t).replace(/\D/g, '').slice(-10)) : []
  if (cfg.soloTest === true && !test.includes(phone.slice(-10))) return
  const invRef = db.doc(`fidelityInviti/${phone}`)
  if ((await invRef.get()).exists && cfg.soloTest !== true) return
  const nomeRaw = String(data.cliente || data['NOME E COGNOME'] || '').trim()
  const primo = nomeRaw.split(/\s+/)[0] || ''
  const nome = primo ? primo[0].toUpperCase() + primo.slice(1).toLowerCase() : ''
  const link = `https://card.washhub.it/?c=${phone}`
  const testo = String(cfg.testoInvito || TESTO_INVITO_DEFAULT).replace(/\{nome\}/g, nome).replace(/\{link\}/g, link).replace(/Ciao\s+👋/, 'Ciao 👋')
  await db.collection('whatsappCoda').add({
    telefono: phone, clienteId: null, nome: nomeRaw, testo, stato: 'in_coda', priorita: 10,
    tipo: 'fidelity', campagnaId: 'fidelity-invito', segmento: 'fidelity', template: 'invito-card',
    operatore: 'sistema', refId: `${collection}:${docId}`, creato: Date.now(), sedeId: data.sedeId || 'lungomare',
  })
  await invRef.set({ telefono: phone, nome: nomeRaw, refId: `${collection}:${docId}`, invitatoAt: FieldValue.serverTimestamp(), test: cfg.soloTest === true })
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

  const r = await callFidelai('externalRecordTransaction', {
    merchant: FIDELAI_MERCHANT.value(),
    customerId: phone,
    amount,
    type: 'earn',
    sedeId: data.sedeId || null,
    refId: `${collection}:${docId}`,
    notes: collection,
  })
  // Senza card attiva: punti messi da parte su FidelAI → invito a attivarla (se acceso)
  if (r?.skipped && collection !== 'abbonamenti') {
    try { await invitaCard(collection, docId, data, phone) } catch (e) { console.error('[fidelai] invito card', docId, e) }
  }
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
