import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret, defineString } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

// ═══════════════════════════════════════════════════════════════════
// ⚡ PRIORITY (13/10/2026) — "salti la coda" a pagamento nelle ore calde
//
// Ora calda = ora in cui risultano già ≥ `soglia` auto (prenotate online
// + registrate in cassa, NO_SHOW esclusi). In un'ora calda il sito non
// vende più il posto normale: vende `maxPerOra` posti Priority a
// +`supplemento` € pagati subito online (SumUp hosted checkout, stesso
// account del Parcheggio Smart). È "live": si basa sulla dashboard.
//
// Contabilità: il lavaggio si paga in sede come sempre (prezzo variabile);
// il supplemento sta in `priorityOrdini` (stato 'pagato') e la chiusura
// delle 21:00 lo somma a LAVAGGIO POS del giorno del lavaggio.
//
// Endpoint (https://europe-west1-dashboard-washhub.cloudfunctions.net/priority):
//   GET  /disponibilita?data=YYYY-MM-DD → { attivo, supplemento, priority:[orari], bloccati:[orari] }
//   POST /checkout   → crea priorityOrdini (in_pagamento) + checkout SumUp → { id, url }
//   POST /webhook    → return_url di SumUp: verifica via API e finalizza
//   GET  /stato?id=  → stato per la pagina di conferma (verifica SumUp se ancora in pagamento)
// Mai esposti al pubblico conteggi o nomi: solo l'elenco degli orari Priority.
// Config: config/priority { attivo, soglia, maxPerOra, supplemento } (pannello in dashboard, solo admin)
// ═══════════════════════════════════════════════════════════════════

const SUMUP_API_KEY = defineSecret('SUMUP_API_KEY')
const SUMUP_MERCHANT_CODE = defineString('SUMUP_MERCHANT_CODE')

const REGION = 'europe-west1'
const SITE_URL = 'https://wash-hub.it'
const SELF_URL = `https://${REGION}-dashboard-washhub.cloudfunctions.net/priority`
const SEDE = 'lungomare'
const ALLOWED_ORIGINS = ['https://wash-hub.it', 'https://www.wash-hub.it', 'http://localhost:3000', 'http://localhost:4174']
const PENDING_MS = 15 * 60e3   // un checkout aperto tiene il posto 15 minuti

// Stessi orari del sito (src/lib/firebase-booking.ts)
const SLOTS = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00',
  '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00']
// Stessi giorni chiusi del sito: tenerli allineati (difesa in profondità, il sito li nasconde già)
const GIORNI_CHIUSI = ['2026-06-02', '2026-08-15', '2026-09-26', '2026-10-10', '2026-12-25', '2026-12-26', '2026-01-01']

async function getConfig() {
  const snap = await getFirestore().collection('config').doc('priority').get()
  const c = snap.exists ? snap.data()! : {}
  return {
    attivo: c.attivo !== false,
    soglia: Math.max(1, Number(c.soglia) || 3),
    maxPerOra: Math.max(0, Number.isFinite(Number(c.maxPerOra)) ? Number(c.maxPerOra) : 1),
    supplemento: Math.max(1, Number(c.supplemento) || 5),
  }
}

// ── Ora locale Europe/Rome ──
function romeNow() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }) // 'YYYY-MM-DD HH:mm:ss'
  return { data: s.slice(0, 10), hhmm: s.slice(11, 16) }
}
const isDomenica = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0
const ora = (slot: string) => slot.slice(0, 2)

// Calcolo disponibilità Priority per una data (stessa logica in checkout e finalizzazione)
async function calcola(data: string) {
  const cfg = await getConfig()
  const out = { attivo: cfg.attivo, supplemento: cfg.supplemento, priority: [] as string[], bloccati: [] as string[] }
  if (!cfg.attivo || cfg.maxPerOra === 0 || GIORNI_CHIUSI.includes(data) || isDomenica(data)) return out
  const db = getFirestore()
  const [pren, ord] = await Promise.all([
    db.collection('prenotazioni').where('dataPren', '==', data).get(),
    db.collection('priorityOrdini').where('dataPren', '==', data).get(),
  ])
  const carico: Record<string, number> = {}
  pren.forEach(d => {
    const v = d.data()
    if ((v.sedeId || SEDE) !== SEDE || v.stato === 'NO_SHOW' || !v.orario) return
    carico[ora(v.orario)] = (carico[ora(v.orario)] || 0) + 1
  })
  const venduti: Record<string, number> = {}
  const now = Date.now()
  ord.forEach(d => {
    const v = d.data()
    const vivo = v.stato === 'pagato' || (v.stato === 'in_pagamento' && now - (v.creatoTs || 0) < PENDING_MS)
    if (vivo) venduti[ora(v.orario)] = (venduti[ora(v.orario)] || 0) + 1
  })
  const { data: oggi, hhmm } = romeNow()
  for (const slot of SLOTS) {
    if (data === oggi && slot <= hhmm) continue          // orario già passato
    const h = ora(slot)
    // le prenotazioni Priority già finalizzate sono anche in `prenotazioni`: non contarle due volte nel carico
    const caldo = (carico[h] || 0) >= cfg.soglia
    if (!caldo) continue
    if ((venduti[h] || 0) < cfg.maxPerOra) out.priority.push(slot)
    else out.bloccati.push(slot)
  }
  return out
}

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

function cors(req: Request, res: Response) {
  const origin = String(req.headers.origin || '')
  if (ALLOWED_ORIGINS.includes(origin)) res.set('Access-Control-Allow-Origin', origin)
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  res.set('Access-Control-Max-Age', '3600')
}

// Codice amico valido = esiste, ha il telefono del titolare, non è il proprio (come validaCodiceAmico del sito)
async function referralValido(codice: string, telefono: string): Promise<string> {
  const c = codice.trim().toUpperCase()
  if (c.length < 4) return ''
  const snap = await getFirestore().collection('referral').doc(c).get()
  const tel = String(snap.data()?.telefono || '')
  if (!tel || tel === telefono.replace(/\D/g, '').slice(-9)) return ''
  return c
}

// Pagato → crea la prenotazione (non saldata: il lavaggio si paga in sede) con i campi Priority
async function finalizza(docId: string, pagamentoInfo: Record<string, unknown>) {
  const db = getFirestore()
  const ref = db.collection('priorityOrdini').doc(docId)
  const ok = await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists || snap.data()!.stato !== 'in_pagamento') return false
    tx.update(ref, { stato: 'pagato', pagatoTs: Date.now(), ...pagamentoInfo })
    return true
  })
  if (!ok) return
  const d = (await ref.get()).data()!
  const noteExtra = [d.targa ? `Targa: ${d.targa}` : '', d.referral ? `Referral: ${d.referral}` : '', d.voucher ? `Voucher: ${d.voucher}` : ''].filter(Boolean).join(' | ')
  const pref = db.collection('prenotazioni').doc(`prio_${docId}`)   // ID deterministico: mai doppia
  await pref.create({
    dataPren: d.dataPren, orario: d.orario,
    cliente: String(d.cliente).toUpperCase(), vettura: String(d.vettura).toUpperCase(), telefono: d.telefono,
    prezzo: d.prezzo || '',
    note: `[WEB ⚡ PRIORITY +€${d.supplemento} pagato online] Servizio: ${d.servizio} | Tel: ${d.telefono}${noteExtra ? ' | ' + noteExtra : ''}`,
    saldo: '', saldato: '', sedeId: SEDE,
    priority: true, prioritySupplemento: d.supplemento, priorityOrdineId: docId, priorityPagatoVia: 'SUMUP_ONLINE',
    ...(d.referral ? { referral: d.referral } : {}),
    ...(d.voucher ? { voucherCodice: d.voucher } : {}),
  }).catch((e: any) => { if (e?.code !== 6) throw e })    // 6 = ALREADY_EXISTS
  await ref.update({ prenotazioneId: pref.id })
  if (d.referral) {
    await db.collection('referral').doc(d.referral).set({ totale: FieldValue.increment(1), inAttesa: FieldValue.increment(1), ultimoAggiornamento: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {})
  }
  console.log(`⚡ priority ${docId} pagato: ${d.dataPren} ${d.orario} ${d.cliente} +€${d.supplemento}`)
}

async function verificaEFinalizza(docId: string, checkoutId: string): Promise<string> {
  const ck = await sumup(`/checkouts/${encodeURIComponent(checkoutId)}`)
  const status = String(ck?.status || '')
  if (status === 'PAID') {
    const tr = Array.isArray(ck.transactions) ? ck.transactions.find((t: any) => t.status === 'SUCCESSFUL') || ck.transactions[0] : null
    await finalizza(docId, { sumupStatus: status, sumupTransactionCode: tr?.transaction_code || null, sumupTransactionId: tr?.id || null })
  } else if (status === 'FAILED' || status === 'EXPIRED') {
    await getFirestore().collection('priorityOrdini').doc(docId).update({ stato: 'fallito', sumupStatus: status })
  }
  return status
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/
const TEL_RE = /^\+?[0-9 ]{8,16}$/

export const priority = onRequest({ region: REGION, secrets: [SUMUP_API_KEY], cors: false, maxInstances: 10 }, async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  const db = getFirestore()
  const path = (req.path || '/').replace(/\/+$/, '') || '/'
  try {
    // ── GET /disponibilita?data= ──
    if (req.method === 'GET' && path === '/disponibilita') {
      const data = String(req.query.data || '')
      if (!DATA_RE.test(data)) { res.status(400).json({ error: 'data non valida' }); return }
      res.set('Cache-Control', 'no-store')
      res.json(await calcola(data))
      return
    }

    // ── POST /checkout ──
    if (req.method === 'POST' && path === '/checkout') {
      const b = (req.body || {}) as Record<string, unknown>
      const dataPren = String(b.dataPren || '')
      const orario = String(b.orario || '')
      const cliente = String(b.cliente || '').trim().slice(0, 60)
      const telefono = String(b.telefono || '').trim()
      const vettura = String(b.vettura || '').trim().slice(0, 40)
      const servizio = String(b.servizio || '').trim().slice(0, 60)
      const targa = String(b.targa || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
      const prezzo = /^\d{1,3}$/.test(String(b.prezzo || '')) ? String(b.prezzo) : ''
      const voucher = String(b.voucher || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20)
      if (!DATA_RE.test(dataPren) || !SLOTS.includes(orario)) { res.status(400).json({ error: 'Data o orario non validi' }); return }
      if (cliente.length < 2 || !vettura || !servizio) { res.status(400).json({ error: 'Compila tutti i campi obbligatori' }); return }
      if (!TEL_RE.test(telefono)) { res.status(400).json({ error: 'Telefono non valido' }); return }
      const disp = await calcola(dataPren)
      if (!disp.priority.includes(orario)) { res.status(409).json({ error: 'Il posto Priority per questo orario non è più disponibile. Scegli un altro orario.' }); return }
      const referral = b.referral ? await referralValido(String(b.referral), telefono).catch(() => '') : ''

      const ref = db.collection('priorityOrdini').doc()
      const now = Date.now()
      await ref.set({
        dataPren, orario, cliente, telefono, vettura, servizio, targa, prezzo, referral, voucher,
        supplemento: disp.supplemento, stato: 'in_pagamento', creatoTs: now, sedeId: SEDE, sumupCheckoutId: null,
        ua: String(req.headers['user-agent'] || '').slice(0, 200),
      })
      const ck = await sumup('/checkouts', { method: 'POST', body: {
        checkout_reference: ref.id,
        amount: disp.supplemento, currency: 'EUR',
        merchant_code: SUMUP_MERCHANT_CODE.value(),
        description: `WASH HUB Priority · ${dataPren.split('-').reverse().join('/')} ${orario}`,
        return_url: `${SELF_URL}/webhook`,
        redirect_url: `${SITE_URL}/prenota/priority/?id=${ref.id}`,
        hosted_checkout: { enabled: true },
      } })
      const url = ck?.hosted_checkout_url
      if (!ck?.id || !url) throw new Error('SumUp: risposta senza hosted_checkout_url: ' + JSON.stringify(ck).slice(0, 300))
      await ref.update({ sumupCheckoutId: ck.id })
      res.json({ id: ref.id, url, supplemento: disp.supplemento })
      return
    }

    // ── POST /webhook (SumUp return_url) ──
    if (req.method === 'POST' && path === '/webhook') {
      const checkoutId = String((req.body as any)?.id || '')
      console.log('SumUp webhook priority', JSON.stringify(req.body || {}).slice(0, 300))
      if (!checkoutId) { res.status(400).send('missing id'); return }
      const q = await db.collection('priorityOrdini').where('sumupCheckoutId', '==', checkoutId).limit(1).get()
      if (q.empty) { res.status(200).send('unknown checkout'); return }
      if (q.docs[0].data().stato === 'in_pagamento') await verificaEFinalizza(q.docs[0].id, checkoutId)
      res.status(200).send('ok')
      return
    }

    // ── GET /stato?id= ──
    if (req.method === 'GET' && path === '/stato') {
      const id = String(req.query.id || '')
      if (!/^[A-Za-z0-9]{15,30}$/.test(id)) { res.status(400).json({ error: 'id non valido' }); return }
      const ref = db.collection('priorityOrdini').doc(id)
      let d = (await ref.get()).data()
      if (!d) { res.status(404).json({ error: 'non trovato' }); return }
      if (d.stato === 'in_pagamento' && d.sumupCheckoutId) {
        try { await verificaEFinalizza(id, d.sumupCheckoutId) } catch (e: any) { console.warn('verifica SumUp:', e.message) }
        d = (await ref.get()).data()!
      }
      res.set('Cache-Control', 'no-store')
      res.json({ stato: d.stato, dataPren: d.dataPren, orario: d.orario, servizio: d.servizio, supplemento: d.supplemento })
      return
    }

    res.status(404).json({ error: 'not found' })
  } catch (e: any) {
    console.error('priority error', e)
    res.status(500).json({ error: 'Errore temporaneo, riprova tra poco' })
  }
})
