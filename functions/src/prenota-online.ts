import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret, defineString } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { romeToEpoch } from './parcheggio-smart'
import { getConfigGaranzia } from './garanzia-stripe'

// ═══════════════════════════════════════════════════════════════════
// PRENOTAZIONI ONLINE — caparra anti no-show + disdetta (13/10/2026)
//
// Caparra (decisione Guido 13/10): solo chi ha già un NO_SHOW negli ultimi
// `mesi` mesi (stesso telefono, ultime 9 cifre) paga `importo` € online
// (SumUp hosted checkout) per prenotare; si scala dal lavaggio in sede.
// Disdetta online gratuita fino a `oreDisdetta` ore prima → caparra (e
// supplemento Priority) rimborsati via SumUp. Dopo, o se non si presenta,
// la caparra resta incassata (la chiusura 21:00 la somma a LAVAGGIO POS).
// Consenso esplicito (spunta) obbligatorio: salvato sull'ordine con testo e ora.
//
// Endpoint (https://europe-west1-dashboard-washhub.cloudfunctions.net/prenotaOnline):
//   POST /verifica         { telefono }                 → { caparra: 0 | € }
//   POST /caparra/checkout { dati prenotazione, consenso } → { id, url }
//   POST /caparra/webhook  (return_url SumUp)
//   GET  /caparra/stato?id=
//   POST /disdici          { telefono, nome, dataPren } → { disdette, troppoTardi, rimborsi }
// Config: config/caparra { attivo, importo, mesi, oreDisdetta }
// ═══════════════════════════════════════════════════════════════════

const SUMUP_API_KEY = defineSecret('SUMUP_API_KEY')
const SUMUP_MERCHANT_CODE = defineString('SUMUP_MERCHANT_CODE')

const REGION = 'europe-west1'
const SITE_URL = 'https://wash-hub.it'
const SELF_URL = `https://${REGION}-dashboard-washhub.cloudfunctions.net/prenotaOnline`
const SEDE = 'lungomare'
const ALLOWED_ORIGINS = ['https://wash-hub.it', 'https://www.wash-hub.it', 'http://localhost:3000', 'http://localhost:4174']
const SLOTS = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00',
  '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00']

export const TESTO_CONSENSO_CAPARRA = (imp: number, ore: number) =>
  `Accetto di versare una caparra di €${imp} a garanzia della prenotazione, scalata dal prezzo del lavaggio. ` +
  `Posso disdire gratis fino a ${ore} ore prima su wash-hub.it/disdici e la caparra mi viene restituita. ` +
  `Se non mi presento o disdico più tardi, la caparra viene trattenuta.`

async function getConfig() {
  const snap = await getFirestore().collection('config').doc('caparra').get()
  const c = snap.exists ? snap.data()! : {}
  return {
    attivo: c.attivo !== false,
    importo: Math.max(1, Number(c.importo) || 10),
    mesi: Math.max(1, Number(c.mesi) || 12),
    oreDisdetta: Math.max(0, Number.isFinite(Number(c.oreDisdetta)) ? Number(c.oreDisdetta) : 2),
    // Guido 13/10/2026: caparra per TUTTE le prenotazioni online (non solo chi ha un no-show)
    perTutti: c.perTutti === true,
  }
}

const tel9 = (t: unknown) => String(t || '').replace(/\D/g, '').slice(-9)

// Caparra dovuta? Solo se c'è un NO_SHOW recente con lo stesso telefono.
async function caparraDovuta(telefono: string): Promise<number> {
  const cfg = await getConfig()
  const t = tel9(telefono)
  if (!cfg.attivo || t.length < 9) return 0
  if (cfg.perTutti) return cfg.importo
  const limite = new Date(Date.now() - cfg.mesi * 30 * 864e5).toISOString().slice(0, 10)
  const ns = await getFirestore().collection('prenotazioni').where('stato', '==', 'NO_SHOW').get()
  const trovato = ns.docs.some(d => { const v = d.data(); return tel9(v.telefono) === t && String(v.dataPren || '') >= limite })
  return trovato ? cfg.importo : 0
}

// ── SumUp ──
const SUMUP = 'https://api.sumup.com/v0.1'
async function sumup(path: string, init: { method?: string; body?: unknown } = {}) {
  const r = await fetch(SUMUP + path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${SUMUP_API_KEY.value()}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const txt = await r.text()
  let data: any = null
  try { data = txt ? JSON.parse(txt) : null } catch { data = { raw: txt } }
  if (!r.ok) throw new Error(`SumUp ${init.method || 'GET'} ${path} → ${r.status}: ${txt.slice(0, 300)}`)
  return data
}
async function rimborsa(transactionId: string, amount: number) {
  await sumup(`/me/refund/${encodeURIComponent(transactionId)}`, { method: 'POST', body: { amount } })
}

function cors(req: Request, res: Response) {
  const origin = String(req.headers.origin || '')
  if (ALLOWED_ORIGINS.includes(origin)) res.set('Access-Control-Allow-Origin', origin)
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  res.set('Access-Control-Max-Age', '3600')
}

async function referralValido(codice: string, telefono: string): Promise<string> {
  const c = codice.trim().toUpperCase()
  if (c.length < 4) return ''
  const snap = await getFirestore().collection('referral').doc(c).get()
  const t = String(snap.data()?.telefono || '')
  return !t || t === tel9(telefono) ? '' : c
}

// Caparra pagata → crea la prenotazione (non saldata) con i campi caparra
async function finalizza(docId: string, info: Record<string, unknown>) {
  const db = getFirestore()
  const ref = db.collection('caparraOrdini').doc(docId)
  const ok = await db.runTransaction(async tx => {
    const s = await tx.get(ref)
    if (!s.exists || s.data()!.stato !== 'in_pagamento') return false
    tx.update(ref, { stato: 'pagata', pagatoTs: Date.now(), ...info })
    return true
  })
  if (!ok) return
  const d = (await ref.get()).data()!
  const extra = [d.targa ? `Targa: ${d.targa}` : '', d.referral ? `Referral: ${d.referral}` : '', d.voucher ? `Voucher: ${d.voucher}` : ''].filter(Boolean).join(' | ')
  const pref = db.collection('prenotazioni').doc(`cap_${docId}`)
  await pref.create({
    dataPren: d.dataPren, orario: d.orario,
    cliente: String(d.cliente).toUpperCase(), vettura: String(d.vettura).toUpperCase(), telefono: d.telefono,
    prezzo: d.prezzo || '',
    note: `[WEB 💳 caparra €${d.importo} pagata online] Servizio: ${d.servizio} | Tel: ${d.telefono}${extra ? ' | ' + extra : ''}`,
    saldo: '', saldato: '', sedeId: SEDE,
    caparraImporto: d.importo, caparraOrdineId: docId, caparraPagataVia: 'SUMUP_ONLINE',
    ...(d.referral ? { referral: d.referral } : {}),
    ...(d.voucher ? { voucherCodice: d.voucher } : {}),
  }).catch((e: any) => { if (e?.code !== 6) throw e })
  await ref.update({ prenotazioneId: pref.id })
  if (d.referral) await db.collection('referral').doc(d.referral).set({ totale: FieldValue.increment(1), inAttesa: FieldValue.increment(1), ultimoAggiornamento: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
  console.log(`💳 caparra ${docId} pagata: ${d.dataPren} ${d.orario} ${d.cliente} €${d.importo}`)
}

async function verificaEFinalizza(docId: string, checkoutId: string) {
  const ck = await sumup(`/checkouts/${encodeURIComponent(checkoutId)}`)
  const status = String(ck?.status || '')
  if (status === 'PAID') {
    const tr = Array.isArray(ck.transactions) ? ck.transactions.find((t: any) => t.status === 'SUCCESSFUL') || ck.transactions[0] : null
    await finalizza(docId, { sumupStatus: status, sumupTransactionCode: tr?.transaction_code || null, sumupTransactionId: tr?.id || null })
  } else if (status === 'FAILED' || status === 'EXPIRED') {
    await getFirestore().collection('caparraOrdini').doc(docId).update({ stato: 'fallita', sumupStatus: status })
  }
}

// Rimborso di un ordine online collegato alla prenotazione (caparra o Priority)
async function rimborsaOrdine(col: 'caparraOrdini' | 'priorityOrdini', id: string): Promise<{ tipo: string; importo: number; ok: boolean }> {
  const ref = getFirestore().collection(col).doc(id)
  const d = (await ref.get()).data()
  const tipo = col === 'caparraOrdini' ? 'caparra' : 'priority'
  const importo = Number(col === 'caparraOrdini' ? d?.importo : d?.supplemento) || 0
  const pagato = col === 'caparraOrdini' ? d?.stato === 'pagata' : d?.stato === 'pagato'
  if (!d || !pagato || !d.sumupTransactionId) return { tipo, importo, ok: false }
  try {
    await rimborsa(d.sumupTransactionId, importo)
    await ref.update({ stato: col === 'caparraOrdini' ? 'rimborsata' : 'rimborsato', rimborsoTs: Date.now(), rimborsoVia: 'disdetta-online' })
    return { tipo, importo, ok: true }
  } catch (e: any) {
    console.error(`rimborso ${col}/${id} fallito:`, e.message)
    await ref.update({ rimborsoDaFare: true, rimborsoErrore: String(e.message).slice(0, 300) })
    return { tipo, importo, ok: false }
  }
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/
const TEL_RE = /^\+?[0-9 ]{8,16}$/

export const prenotaOnline = onRequest({ region: REGION, secrets: [SUMUP_API_KEY], cors: false, maxInstances: 10 }, async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  const db = getFirestore()
  const path = (req.path || '/').replace(/\/+$/, '') || '/'
  res.set('Cache-Control', 'no-store')
  try {
    // ── POST /verifica ──
    if (req.method === 'POST' && path === '/verifica') {
      const telefono = String((req.body as any)?.telefono || '')
      const cfg = await getConfig()
      // Carta a garanzia Stripe attiva → vale per tutti e sostituisce la caparra SumUp
      const g = await getConfigGaranzia()
      if (g.attivo) { res.json({ caparra: 0, garanzia: g.importo, oreDisdetta: g.oreDisdetta, perTutti: true }); return }
      res.json({ caparra: await caparraDovuta(telefono), garanzia: 0, oreDisdetta: cfg.oreDisdetta, perTutti: cfg.perTutti })
      return
    }

    // ── POST /caparra/checkout ──
    if (req.method === 'POST' && path === '/caparra/checkout') {
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
      if (b.consenso !== true) { res.status(400).json({ error: 'Per prenotare devi accettare le condizioni della caparra' }); return }
      const cfg = await getConfig()
      const importo = await caparraDovuta(telefono)
      if (!importo) { res.status(409).json({ error: 'Per questo numero la caparra non serve: ricarica la pagina e prenota normalmente.' }); return }
      // Orario ancora libero? (stessa regola del sito: un orario con una prenotazione è occupato)
      const occ = await db.collection('prenotazioni').where('dataPren', '==', dataPren).get()
      if (occ.docs.some(d => d.data().orario === orario && d.data().stato !== 'DISDETTA')) { res.status(409).json({ error: 'Questo orario è appena stato preso. Scegline un altro.' }); return }
      const referral = b.referral ? await referralValido(String(b.referral), telefono).catch(() => '') : ''
      const ref = db.collection('caparraOrdini').doc()
      await ref.set({
        dataPren, orario, cliente, telefono, vettura, servizio, targa, prezzo, referral, voucher,
        importo, stato: 'in_pagamento', creatoTs: Date.now(), sedeId: SEDE, sumupCheckoutId: null,
        consenso: { testo: TESTO_CONSENSO_CAPARRA(importo, cfg.oreDisdetta), ts: Date.now(), ua: String(req.headers['user-agent'] || '').slice(0, 200) },
      })
      const ck = await sumup('/checkouts', { method: 'POST', body: {
        checkout_reference: ref.id, amount: importo, currency: 'EUR', merchant_code: SUMUP_MERCHANT_CODE.value(),
        description: `WASH HUB caparra prenotazione · ${dataPren.split('-').reverse().join('/')} ${orario}`,
        return_url: `${SELF_URL}/caparra/webhook`,
        redirect_url: `${SITE_URL}/prenota/caparra/?id=${ref.id}`,
        hosted_checkout: { enabled: true },
      } })
      if (!ck?.id || !ck?.hosted_checkout_url) throw new Error('SumUp: risposta senza hosted_checkout_url')
      await ref.update({ sumupCheckoutId: ck.id })
      res.json({ id: ref.id, url: ck.hosted_checkout_url, importo })
      return
    }

    // ── POST /caparra/webhook ──
    if (req.method === 'POST' && path === '/caparra/webhook') {
      const checkoutId = String((req.body as any)?.id || '')
      if (!checkoutId) { res.status(400).send('missing id'); return }
      const q = await db.collection('caparraOrdini').where('sumupCheckoutId', '==', checkoutId).limit(1).get()
      if (!q.empty && q.docs[0].data().stato === 'in_pagamento') await verificaEFinalizza(q.docs[0].id, checkoutId)
      res.status(200).send('ok')
      return
    }

    // ── GET /caparra/stato?id= ──
    if (req.method === 'GET' && path === '/caparra/stato') {
      const id = String(req.query.id || '')
      if (!/^[A-Za-z0-9]{15,30}$/.test(id)) { res.status(400).json({ error: 'id non valido' }); return }
      const ref = db.collection('caparraOrdini').doc(id)
      let d = (await ref.get()).data()
      if (!d) { res.status(404).json({ error: 'non trovato' }); return }
      if (d.stato === 'in_pagamento' && d.sumupCheckoutId) {
        try { await verificaEFinalizza(id, d.sumupCheckoutId) } catch (e: any) { console.warn('verifica SumUp:', e.message) }
        d = (await ref.get()).data()!
      }
      const cfg = await getConfig()
      res.json({ stato: d.stato, dataPren: d.dataPren, orario: d.orario, servizio: d.servizio, importo: d.importo, oreDisdetta: cfg.oreDisdetta })
      return
    }

    // ── POST /disdici ──
    if (req.method === 'POST' && path === '/disdici') {
      const b = (req.body || {}) as Record<string, unknown>
      const t = tel9(b.telefono)
      const nome = String(b.nome || '').trim().toUpperCase()
      const dataPren = String(b.dataPren || '')
      if (t.length < 9 || nome.length < 3 || !DATA_RE.test(dataPren)) { res.status(400).json({ error: 'Inserisci telefono, nome e giorno della prenotazione' }); return }
      const cfg = await getConfig()
      const snap = await db.collection('prenotazioni').where('dataPren', '==', dataPren).get()
      const mie = snap.docs.filter(d => {
        const v = d.data()
        return tel9(v.telefono) === t && String(v.cliente || '').toUpperCase().includes(nome)
          && v.saldato !== 'SI' && v.stato !== 'NO_SHOW' && v.stato !== 'DISDETTA'
      })
      if (!mie.length) { res.status(404).json({ error: 'Nessuna prenotazione trovata con questi dati per quel giorno.' }); return }
      const disdette: string[] = [], troppoTardi: string[] = [], rimborsi: { tipo: string; importo: number; ok: boolean }[] = []
      for (const d of mie) {
        const v = d.data()
        const inizio = romeToEpoch(`${dataPren}T${v.orario || '00:00'}`)
        if (inizio - Date.now() < cfg.oreDisdetta * 3600e3) { troppoTardi.push(v.orario); continue }
        await d.ref.update({ stato: 'DISDETTA', disdettaTs: Date.now(), disdettaVia: 'sito' })
        disdette.push(v.orario)
        if (v.caparraOrdineId) rimborsi.push(await rimborsaOrdine('caparraOrdini', v.caparraOrdineId))
        if (v.priorityOrdineId) rimborsi.push(await rimborsaOrdine('priorityOrdini', v.priorityOrdineId))
        const mieiRimborsi = rimborsi.slice(-((v.caparraOrdineId ? 1 : 0) + (v.priorityOrdineId ? 1 : 0)) || rimborsi.length)
        if (v.caparraOrdineId || v.priorityOrdineId) await d.ref.update({ rimborsoEsito: mieiRimborsi.every(x => x.ok) ? 'ok' : 'da_fare' })
        if (v.referral && v.referralConfermato !== true) {
          await db.collection('referral').doc(String(v.referral)).set({ totale: FieldValue.increment(-1), inAttesa: FieldValue.increment(-1) }, { merge: true }).catch(() => {})
        }
      }
      console.log(`❌ disdetta online ${dataPren} tel …${t.slice(-3)}: ${disdette.join(',')} | tardi ${troppoTardi.join(',')}`)
      res.json({ disdette, troppoTardi, rimborsi, oreDisdetta: cfg.oreDisdetta })
      return
    }

    res.status(404).json({ error: 'not found' })
  } catch (e: any) {
    console.error('prenotaOnline error', e)
    res.status(500).json({ error: 'Errore temporaneo, riprova tra poco' })
  }
})
