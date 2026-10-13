import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

// ═══════════════════════════════════════════════════════════════════
// 🛡️ CARTA A GARANZIA (Stripe, 13/10/2026) — "pre-autorizzazione a 0 €"
//
// Prenotazione online → Stripe Checkout in modalità `setup`: il cliente
// salva la carta, NON paga niente. Se non si presenta e non ha disdetto
// almeno `oreDisdetta` ore prima (wash-hub.it/disdici), dalla dashboard si
// addebitano `importo` € con un tocco (PaymentIntent off_session), SEMPRE su
// conferma dell'operatore, mai in automatico. Consenso esplicito (spunta sul
// sito + testo sulla pagina Stripe) salvato sull'ordine.
//
// Chiave: STRIPE_SECRET_KEY = chiave LIMITATA rk_live (Customers, Checkout
// Sessions, SetupIntents, PaymentIntents, PaymentMethods, Charges&Refunds).
// Niente SDK: chiamate REST form-encoded (nessuna dipendenza nuova).
//
// Endpoint (prenotaGaranzia): POST /checkout → { id, url } · GET /stato?id=
// Callable: garanziaAddebita { pid } (utente gestionale autenticato)
// Config: config/garanzia { attivo, importo, oreDisdetta }
// ═══════════════════════════════════════════════════════════════════

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const REGION = 'europe-west1'
const SITE_URL = 'https://wash-hub.it'
const SEDE = 'lungomare'
const ALLOWED_ORIGINS = ['https://wash-hub.it', 'https://www.wash-hub.it', 'http://localhost:3000', 'http://localhost:4174']
const SLOTS = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00',
  '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00']

export async function getConfigGaranzia() {
  const snap = await getFirestore().collection('config').doc('garanzia').get()
  const c = snap.exists ? snap.data()! : {}
  return {
    attivo: c.attivo === true,
    importo: Math.max(1, Number(c.importo) || 10),
    oreDisdetta: Math.max(0, Number.isFinite(Number(c.oreDisdetta)) ? Number(c.oreDisdetta) : 2),
  }
}

export const TESTO_CONSENSO_GARANZIA = (imp: number, ore: number) =>
  `Lascio la mia carta a garanzia della prenotazione: ora non pago niente. Posso disdire gratis fino a ${ore} ore prima su wash-hub.it/disdici. ` +
  `Se non mi presento o disdico più tardi, autorizzo WASH HUB ad addebitarmi una penale di €${imp}.`

// ── Stripe REST (form-encoded, oggetti annidati con la notazione a[b][c]) ──
function form(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? form(x as any, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))))
    else if (typeof v === 'object') form(v as any, key, out)
    else out.append(key, String(v))
  }
  return out
}
async function stripe(path: string, body?: Record<string, unknown>, idem?: string) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY.value()}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) },
    body: body ? form(body).toString() : undefined,
  })
  const d: any = await r.json().catch(() => ({}))
  if (!r.ok) { const e: any = new Error(d?.error?.message || `Stripe ${path} HTTP ${r.status}`); e.stripe = d?.error; throw e }
  return d
}

function cors(req: Request, res: Response) {
  const origin = String(req.headers.origin || '')
  if (ALLOWED_ORIGINS.includes(origin)) res.set('Access-Control-Allow-Origin', origin)
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  res.set('Access-Control-Max-Age', '3600')
}

const tel9 = (t: unknown) => String(t || '').replace(/\D/g, '').slice(-9)
async function referralValido(codice: string, telefono: string): Promise<string> {
  const c = codice.trim().toUpperCase()
  if (c.length < 4) return ''
  const snap = await getFirestore().collection('referral').doc(c).get()
  const t = String(snap.data()?.telefono || '')
  return !t || t === tel9(telefono) ? '' : c
}

// Sessione completata → carta salvata → crea la prenotazione gar_{id}
async function finalizza(id: string) {
  const db = getFirestore()
  const ref = db.collection('garanzieOrdini').doc(id)
  const o = (await ref.get()).data()
  if (!o || o.stato !== 'in_attesa' || !o.stripeSessionId) return o?.stato
  const s = await stripe(`checkout/sessions/${encodeURIComponent(o.stripeSessionId)}?expand[]=setup_intent`)
  if (s.status === 'expired') { await ref.update({ stato: 'scaduta' }); return 'scaduta' }
  if (s.status !== 'complete' || s.setup_intent?.status !== 'succeeded') return 'in_attesa'
  const pm = String(s.setup_intent.payment_method || '')
  const ok = await db.runTransaction(async tx => {
    const cur = (await tx.get(ref)).data()
    if (cur?.stato !== 'in_attesa') return false
    tx.update(ref, { stato: 'salvata', salvataTs: Date.now(), stripePaymentMethodId: pm, stripeSetupIntentId: s.setup_intent.id })
    return true
  })
  if (!ok) return 'salvata'
  const extra = [o.targa ? `Targa: ${o.targa}` : '', o.referral ? `Referral: ${o.referral}` : '', o.voucher ? `Voucher: ${o.voucher}` : ''].filter(Boolean).join(' | ')
  const pref = db.collection('prenotazioni').doc(`gar_${id}`)
  await pref.create({
    dataPren: o.dataPren, orario: o.orario,
    cliente: String(o.cliente).toUpperCase(), vettura: String(o.vettura).toUpperCase(), telefono: o.telefono,
    prezzo: o.prezzo || '',
    note: `[WEB 🛡️ carta a garanzia €${o.importo}] Servizio: ${o.servizio} | Tel: ${o.telefono}${extra ? ' | ' + extra : ''}`,
    saldo: '', saldato: '', sedeId: SEDE,
    garanziaImporto: o.importo, garanziaOrdineId: id, stripeCustomerId: o.stripeCustomerId, stripePaymentMethodId: pm,
    ...(o.referral ? { referral: o.referral } : {}),
    ...(o.voucher ? { voucherCodice: o.voucher } : {}),
  }).catch((e: any) => { if (e?.code !== 6) throw e })
  await ref.update({ prenotazioneId: pref.id })
  if (o.referral) await db.collection('referral').doc(o.referral).set({ totale: FieldValue.increment(1), inAttesa: FieldValue.increment(1), ultimoAggiornamento: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
  console.log(`🛡️ garanzia ${id} salvata: ${o.dataPren} ${o.orario} ${o.cliente}`)
  return 'salvata'
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/
const TEL_RE = /^\+?[0-9 ]{8,16}$/

export const prenotaGaranzia = onRequest({ region: REGION, secrets: [STRIPE_SECRET_KEY], cors: false, maxInstances: 10 }, async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  res.set('Cache-Control', 'no-store')
  const db = getFirestore()
  const path = (req.path || '/').replace(/\/+$/, '') || '/'
  try {
    if (req.method === 'POST' && path === '/checkout') {
      const cfg = await getConfigGaranzia()
      if (!cfg.attivo) { res.status(503).json({ error: 'Servizio non attivo' }); return }
      const b = (req.body || {}) as Record<string, unknown>
      const dataPren = String(b.dataPren || ''), orario = String(b.orario || '')
      const cliente = String(b.cliente || '').trim().slice(0, 60), telefono = String(b.telefono || '').trim()
      const vettura = String(b.vettura || '').trim().slice(0, 40), servizio = String(b.servizio || '').trim().slice(0, 60)
      const targa = String(b.targa || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
      const prezzo = /^\d{1,3}$/.test(String(b.prezzo || '')) ? String(b.prezzo) : ''
      const voucher = String(b.voucher || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20)
      if (!DATA_RE.test(dataPren) || !SLOTS.includes(orario)) { res.status(400).json({ error: 'Data o orario non validi' }); return }
      if (cliente.length < 2 || !vettura || !servizio) { res.status(400).json({ error: 'Compila tutti i campi obbligatori' }); return }
      if (!TEL_RE.test(telefono)) { res.status(400).json({ error: 'Telefono non valido' }); return }
      if (b.consenso !== true) { res.status(400).json({ error: 'Per prenotare devi accettare la carta a garanzia' }); return }
      const occ = await db.collection('prenotazioni').where('dataPren', '==', dataPren).get()
      if (occ.docs.some(d => d.data().orario === orario && d.data().stato !== 'DISDETTA')) { res.status(409).json({ error: 'Questo orario è appena stato preso. Scegline un altro.' }); return }
      const referral = b.referral ? await referralValido(String(b.referral), telefono).catch(() => '') : ''

      const ref = db.collection('garanzieOrdini').doc()
      const customer = await stripe('customers', {
        name: cliente, phone: telefono, description: `Prenotazione WASH HUB ${dataPren} ${orario}`,
        metadata: { telefono: tel9(telefono), ordine: ref.id, sede: SEDE },
      }, `cus_${ref.id}`)
      const giorno = dataPren.split('-').reverse().join('/')
      const session = await stripe('checkout/sessions', {
        mode: 'setup', currency: 'eur', customer: customer.id, locale: 'it',
        payment_method_types: ['card'],
        success_url: `${SITE_URL}/prenota/garanzia/?id=${ref.id}`,
        cancel_url: `${SITE_URL}/prenota/`,
        client_reference_id: ref.id,
        metadata: { ordine: ref.id, dataPren, orario },
        setup_intent_data: { description: `Garanzia prenotazione WASH HUB ${giorno} ${orario}`, metadata: { ordine: ref.id } },
        custom_text: { submit: { message: `Ora non paghi niente. Disdetta gratis fino a ${cfg.oreDisdetta} ore prima su wash-hub.it/disdici. Se non ti presenti, penale di €${cfg.importo}.` } },
      }, `ses_${ref.id}`)
      await ref.set({
        dataPren, orario, cliente, telefono, vettura, servizio, targa, prezzo, referral, voucher,
        importo: cfg.importo, stato: 'in_attesa', creatoTs: Date.now(), sedeId: SEDE,
        stripeCustomerId: customer.id, stripeSessionId: session.id,
        consenso: { testo: TESTO_CONSENSO_GARANZIA(cfg.importo, cfg.oreDisdetta), ts: Date.now(), ua: String(req.headers['user-agent'] || '').slice(0, 200) },
      })
      res.json({ id: ref.id, url: session.url })
      return
    }

    if (req.method === 'GET' && path === '/stato') {
      const id = String(req.query.id || '')
      if (!/^[A-Za-z0-9]{15,30}$/.test(id)) { res.status(400).json({ error: 'id non valido' }); return }
      const ref = db.collection('garanzieOrdini').doc(id)
      if (!(await ref.get()).exists) { res.status(404).json({ error: 'non trovato' }); return }
      try { await finalizza(id) } catch (e: any) { console.warn('garanzia finalizza:', e.message) }
      const o = (await ref.get()).data()!
      const cfg = await getConfigGaranzia()
      res.json({ stato: o.stato, dataPren: o.dataPren, orario: o.orario, servizio: o.servizio, importo: o.importo, oreDisdetta: cfg.oreDisdetta })
      return
    }

    res.status(404).json({ error: 'not found' })
  } catch (e: any) {
    console.error('prenotaGaranzia error', e?.message, e?.stripe?.code || '')
    res.status(500).json({ error: 'Errore temporaneo, riprova tra poco' })
  }
})

// Addebito no-show dalla dashboard (solo su conferma dell'operatore). Idempotente per prenotazione.
export const garanziaAddebita = onCall({ region: REGION, secrets: [STRIPE_SECRET_KEY], maxInstances: 5 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Devi essere autenticato.')
  const pid = String((req.data as any)?.pid || '')
  if (!/^gar_[A-Za-z0-9]{15,30}$/.test(pid)) throw new HttpsError('invalid-argument', 'Prenotazione non valida')
  const db = getFirestore()
  const pref = db.collection('prenotazioni').doc(pid)
  const p = (await pref.get()).data()
  if (!p) throw new HttpsError('not-found', 'Prenotazione non trovata')
  if (p.garanziaAddebitata) return { ok: true, giaFatto: true, importo: p.garanziaAddebitoImporto || p.garanziaImporto }
  if (p.stato !== 'NO_SHOW') throw new HttpsError('failed-precondition', 'Prima segna la prenotazione come non presentata')
  if (!p.stripeCustomerId || !p.stripePaymentMethodId) throw new HttpsError('failed-precondition', 'Nessuna carta salvata su questa prenotazione')
  const importo = Number(p.garanziaImporto) || 10
  try {
    const pi = await stripe('payment_intents', {
      amount: Math.round(importo * 100), currency: 'eur', customer: p.stripeCustomerId, payment_method: p.stripePaymentMethodId,
      off_session: true, confirm: true,
      description: `WASH HUB · mancata presentazione ${String(p.dataPren).split('-').reverse().join('/')} ${p.orario}`,
      metadata: { prenotazione: pid, operatore: String(req.auth.token?.email || '') },
    }, `noshow_${pid}`)
    const upd = { garanziaAddebitata: true, garanziaAddebitoImporto: importo, garanziaAddebitoTs: Date.now(), stripePaymentIntentId: pi.id, garanziaAddebitoDa: String(req.auth.token?.email || '') }
    await pref.update(upd)
    if (p.garanziaOrdineId) await db.collection('garanzieOrdini').doc(p.garanziaOrdineId).update({ stato: 'addebitata', addebitoTs: Date.now(), stripePaymentIntentId: pi.id }).catch(() => {})
    console.log(`🛡️ no-show addebitato ${pid} €${importo} (${pi.status})`)
    return { ok: true, importo, status: pi.status }
  } catch (e: any) {
    const codice = e?.stripe?.code || e?.stripe?.decline_code || ''
    await pref.update({ garanziaErrore: `${codice} ${e.message}`.trim().slice(0, 300), garanziaErroreTs: Date.now() })
    const msg = codice === 'authentication_required'
      ? 'La banca del cliente chiede una conferma che senza il cliente non si può fare: addebito non riuscito.'
      : `Addebito non riuscito: ${e.message}`
    throw new HttpsError('aborted', msg)
  }
})
