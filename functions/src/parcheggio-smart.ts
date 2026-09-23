import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret, defineString } from 'firebase-functions/params'
import { getFirestore } from 'firebase-admin/firestore'
import type { Request, Response } from 'express'

// ═══════════════════════════════════════════════════════════════════
// PARCHEGGIO SMART — vendita online di codici a tempo per il cancello
//
// Endpoint unico `parcheggioSmart` (europe-west1), route per path:
//   GET  /config          → tariffa + limiti (pubblico, letto dal sito)
//   POST /checkout        → crea doc `codiciParcheggio` (in_pagamento) +
//                           SumUp hosted checkout → { id, url }
//   POST /webhook         → return_url di SumUp: ri-verifica via API e finalizza
//   GET  /stato?id=       → stato del doc; se ancora in_pagamento ri-verifica
//                           SumUp (copre webhook persi). Restituisce il codice
//                           solo per stato 'attivo'. L'id è l'ID Firestore
//                           (20 char random): non enumerabile.
//
// Finalizzazione (idempotente, in transazione): genera PIN 6 cifre, stato
// 'attivo', sync {est,int}='pending' (il Pi del cancello li carica sui due
// terminali Hikvision) + riga `giornalieri` OUT pagamento POS /
// pagamentoVia SUMUP_ONLINE così cassa, report e chiusura la contano senza
// modifiche (SumUp online e POS SumUp finiscono sullo stesso conto).
//
// Secrets/param (firebase functions:secrets:set / .env):
//   SUMUP_API_KEY        chiave API SumUp (sup_sk_…), scope payments
//   SUMUP_MERCHANT_CODE  codice merchant (Dashboard SumUp → profilo)
// ═══════════════════════════════════════════════════════════════════

const REGION = 'europe-west1'
const SUMUP_API_KEY = defineSecret('SUMUP_API_KEY')
const SUMUP_MERCHANT_CODE = defineString('SUMUP_MERCHANT_CODE')
const SITE_URL = 'https://wash-hub.it'
const SELF_URL = `https://${REGION}-dashboard-washhub.cloudfunctions.net/parcheggioSmart`
const SEDE = 'lungomare'
const ALLOWED_ORIGINS = ['https://wash-hub.it', 'https://www.wash-hub.it', 'http://localhost:3000']

// ── Tariffa: identica a giornalieri.js / parcheggio-smart.js del gestionale ──
export function prezzoParcheggioOre(ore: number): number {
  ore = Math.max(0, Math.ceil(Number(ore) || 0))
  if (ore <= 0) return 0
  if (ore <= 6) return Math.min(ore * 2, 8)
  if (ore <= 24) return Math.min(8 + (ore - 6) * 2, 15)
  const extra = ore - 24
  return 15 + Math.floor(extra / 24) * 12 + (extra % 24) * 2
}

// ── Ora locale Europe/Rome ⇄ epoch (le Functions girano in UTC) ──
const pad = (n: number) => String(n).padStart(2, '0')
function romeParts(epoch: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(epoch))
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return { y: g('year'), m: g('month'), d: g('day'), hh: g('hour') % 24, mm: g('minute'), ss: g('second') }
}
function romeOffsetMin(epoch: number): number {
  const p = romeParts(epoch)
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - epoch) / 60000)
}
export function romeToEpoch(local: string): number {   // 'YYYY-MM-DDTHH:mm'
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) throw new Error('formato data non valido')
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  const off1 = romeOffsetMin(guess)
  const off2 = romeOffsetMin(guess - off1 * 60000)
  return guess - off2 * 60000
}
export function epochToRomeLocal(epoch: number): string {
  const p = romeParts(epoch)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`
}
const romeDateISO = (epoch: number) => epochToRomeLocal(epoch).slice(0, 10)
const romeHHMM = (epoch: number) => epochToRomeLocal(epoch).slice(11, 16)

// ── SumUp API ──
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

// ── Helpers ──
function cors(req: Request, res: Response) {
  const origin = String(req.headers.origin || '')
  if (ALLOWED_ORIGINS.includes(origin)) res.set('Access-Control-Allow-Origin', origin)
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  res.set('Access-Control-Max-Age', '3600')
}

async function getConfig() {
  const db = getFirestore()
  const snap = await db.collection('config').doc('parcheggioSmart').get()
  const c = snap.exists ? snap.data()! : {}
  return { attivo: c.attivo !== false, minOre: Number(c.minOre) || 2, maxOre: Number(c.maxOre) || 24 }
}

async function generaCodice(db: FirebaseFirestore.Firestore): Promise<string> {
  const attivi = await db.collection('codiciParcheggio').where('stato', '==', 'attivo').where('fineTs', '>=', Date.now() - 864e5).get()
  const usati = new Set(attivi.docs.map(d => d.data().codice))
  for (let i = 0; i < 100; i++) {
    const c = String(100000 + Math.floor(Math.random() * 900000))
    if (!usati.has(c) && !/(\d)\1{3}/.test(c)) return c
  }
  return String(100000 + Math.floor(Math.random() * 900000))
}

// Finalizza un doc in_pagamento → attivo (+ riga giornalieri). Idempotente.
async function finalizza(docId: string, pagamentoInfo: Record<string, unknown>) {
  const db = getFirestore()
  const ref = db.collection('codiciParcheggio').doc(docId)
  const codice = await generaCodice(db)
  const ok = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) return false
    const d = snap.data()!
    if (d.stato !== 'in_pagamento') return false
    tx.update(ref, {
      codice, stato: 'attivo', pagatoTs: Date.now(),
      sync: { est: 'pending', int: 'pending' }, syncErrore: null,
      ...pagamentoInfo,
    })
    return true
  })
  if (!ok) return
  const d = (await ref.get()).data()!
  // Riga contabile con ID deterministico: mai doppia anche se finalizza gira due volte
  const gref = db.collection('giornalieri').doc(`ps_${docId}`)
  await gref.create({
    dataIn: romeDateISO(d.inizioTs + 5 * 60e3), orarioIn: romeHHMM(d.inizioTs + 5 * 60e3),
    vettura: d.vettura || 'PARCHEGGIO SMART', targa: d.targa, telefono: d.telefono,
    status: 'OUT', pagamento: 'POS', pagamentoVia: 'SUMUP_ONLINE',
    dataOut: romeDateISO(Date.now()), orarioOut: romeHHMM(d.fineTs),
    prezzoFinale: d.prezzo, origine: 'PARCHEGGIO_SMART', codiceParcheggioId: docId, sedeId: SEDE,
    sumupCheckoutId: d.sumupCheckoutId || null,
  }).catch((e: any) => { if (e?.code !== 6) throw e })  // 6 = ALREADY_EXISTS
  await ref.update({ giornalieroId: gref.id })
  console.log(`✅ parcheggioSmart ${docId} attivo: codice ${codice} targa ${d.targa} ${d.ore}h €${d.prezzo}`)
  // TODO: invio codice via WhatsApp (functions/src/whatsapp.ts) quando i secret Meta saranno configurati.
}

// Verifica su SumUp e finalizza se pagato. Ritorna lo stato SumUp.
async function verificaEFinalizza(docId: string, checkoutId: string): Promise<string> {
  const ck = await sumup(`/checkouts/${encodeURIComponent(checkoutId)}`)
  const status = String(ck?.status || '')
  if (status === 'PAID') {
    const tr = Array.isArray(ck.transactions) ? ck.transactions.find((t: any) => t.status === 'SUCCESSFUL') || ck.transactions[0] : null
    await finalizza(docId, { pagamento: 'SUMUP', sumupStatus: status, sumupTransactionCode: tr?.transaction_code || null, sumupTransactionId: tr?.id || null })
  } else if (status === 'FAILED' || status === 'EXPIRED') {
    const db = getFirestore()
    await db.collection('codiciParcheggio').doc(docId).update({ stato: 'fallito', sumupStatus: status })
  }
  return status
}

function pubblico(d: FirebaseFirestore.DocumentData) {
  return {
    stato: d.stato, targa: d.targa, ore: d.ore, prezzo: d.prezzo,
    inizio: d.inizio, fine: d.fine, inizioTs: d.inizioTs, fineTs: d.fineTs,
    codice: d.stato === 'attivo' ? d.codice : null,
  }
}

const TARGA_RE = /^[A-Z0-9]{5,10}$/
const TEL_RE = /^\+?[0-9 ]{8,16}$/

export const parcheggioSmart = onRequest({ region: REGION, secrets: [SUMUP_API_KEY], cors: false }, async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  const db = getFirestore()
  const path = (req.path || '/').replace(/\/+$/, '') || '/'

  try {
    // ── GET /config ──
    if (req.method === 'GET' && path === '/config') {
      const cfg = await getConfig()
      res.json({ ...cfg, tariffa: { oraria: 2, max6h: 8, max24h: 15 }, sede: 'Wash Hub Lungomare, Via Anfuso 35, Catania' })
      return
    }

    // ── POST /checkout ──
    if (req.method === 'POST' && path === '/checkout') {
      const cfg = await getConfig()
      if (!cfg.attivo) { res.status(503).json({ error: 'Vendita online momentaneamente non disponibile' }); return }
      const b = (req.body || {}) as Record<string, unknown>
      const targa = String(b.targa || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      const telefono = String(b.telefono || '').trim()
      const vettura = String(b.vettura || '').trim().toUpperCase().slice(0, 40)
      const nome = String(b.nome || '').trim().slice(0, 60)
      const email = String(b.email || '').trim().toLowerCase().slice(0, 100)
      const ore = Math.ceil(Number(b.ore) || 0)
      if (!TARGA_RE.test(targa)) { res.status(400).json({ error: 'Targa non valida' }); return }
      if (!TEL_RE.test(telefono)) { res.status(400).json({ error: 'Telefono non valido' }); return }
      if (ore < cfg.minOre || ore > cfg.maxOre) { res.status(400).json({ error: `Durata tra ${cfg.minOre} e ${cfg.maxOre} ore` }); return }

      const now = Date.now()
      let inizioTs = now
      if (b.inizio && b.inizio !== 'now') {
        inizioTs = romeToEpoch(String(b.inizio))
        if (inizioTs < now - 10 * 60e3) inizioTs = now
        if (inizioTs > now + 7 * 864e5) { res.status(400).json({ error: 'Puoi prenotare al massimo con 7 giorni di anticipo' }); return }
      }
      const inizioValid = inizioTs - 5 * 60e3       // tolleranza orologio terminale
      const fineTs = inizioTs + ore * 3600e3
      const prezzo = prezzoParcheggioOre(ore)

      const ref = db.collection('codiciParcheggio').doc()
      const doc = {
        codice: null, targa, telefono, vettura, nome, email,
        ore, prezzo, inizio: epochToRomeLocal(inizioValid), fine: epochToRomeLocal(fineTs),
        inizioTs: inizioValid, fineTs, dataISO: romeDateISO(now), creatoTs: now, creatoDa: 'sito',
        origine: 'sito', pagamento: 'SUMUP', stato: 'in_pagamento',
        sync: { est: 'pending', int: 'pending' }, syncErrore: null, eventi: [],
        sedeId: SEDE, sumupCheckoutId: null,
        ua: String(req.headers['user-agent'] || '').slice(0, 200),
      }
      await ref.set(doc)

      const ck = await sumup('/checkouts', { method: 'POST', body: {
        checkout_reference: ref.id,
        amount: prezzo, currency: 'EUR',
        merchant_code: SUMUP_MERCHANT_CODE.value(),
        description: `Parcheggio Smart WASH HUB · ${targa} · ${ore}h`,
        return_url: `${SELF_URL}/webhook`,
        redirect_url: `${SITE_URL}/parcheggio-smart/conferma/?id=${ref.id}`,
        hosted_checkout: { enabled: true },
        ...(email ? { customer_email: email } : {}),
      } })
      const url = ck?.hosted_checkout_url
      if (!ck?.id || !url) throw new Error('SumUp: risposta senza hosted_checkout_url: ' + JSON.stringify(ck).slice(0, 300))
      await ref.update({ sumupCheckoutId: ck.id, sumupCreatoTs: Date.now() })
      res.json({ id: ref.id, url, prezzo, ore, inizio: doc.inizio, fine: doc.fine })
      return
    }

    // ── POST /webhook (SumUp return_url) ──
    if (req.method === 'POST' && path === '/webhook') {
      const b = (req.body || {}) as Record<string, unknown>
      const checkoutId = String(b.id || '')
      console.log('SumUp webhook', JSON.stringify(b).slice(0, 300))
      if (!checkoutId) { res.status(400).send('missing id'); return }
      const q = await db.collection('codiciParcheggio').where('sumupCheckoutId', '==', checkoutId).limit(1).get()
      if (q.empty) { res.status(200).send('unknown checkout'); return }   // 200: SumUp non deve ritentare
      const d = q.docs[0]
      if (d.data().stato === 'in_pagamento') await verificaEFinalizza(d.id, checkoutId)
      res.status(200).send('ok')
      return
    }

    // ── GET /stato?id= ──
    if (req.method === 'GET' && path === '/stato') {
      const id = String(req.query.id || '')
      if (!/^[A-Za-z0-9]{15,30}$/.test(id)) { res.status(400).json({ error: 'id non valido' }); return }
      const ref = db.collection('codiciParcheggio').doc(id)
      let snap = await ref.get()
      if (!snap.exists) { res.status(404).json({ error: 'non trovato' }); return }
      let d = snap.data()!
      if (d.stato === 'in_pagamento' && d.sumupCheckoutId) {
        try { await verificaEFinalizza(id, d.sumupCheckoutId) } catch (e: any) { console.warn('verifica SumUp:', e.message) }
        snap = await ref.get(); d = snap.data()!
      }
      res.json(pubblico(d))
      return
    }

    res.status(404).json({ error: 'not found' })
  } catch (e: any) {
    console.error('parcheggioSmart error', e)
    res.status(500).json({ error: e?.message || 'errore' })
  }
})
