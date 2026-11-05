/**
 * ficProxy — accesso di Jarvis a Fatture in Cloud (5/11/2026).
 *
 * Le credenziali FIC restano qui (secrets/fic): Jarvis ha solo un token di
 * servizio (secret JARVIS_FIC_TOKEN, header Authorization: Bearer) e vede solo:
 *   GET  /azienda                              → quale azienda FIC (nome, id): mai i token
 *   GET  /clienti?q=nome                       → anagrafiche (id, nome, P.IVA)
 *   GET  /documenti?cliente=|nome=&tipo=&da=&a= → fatture emesse di un cliente (id FIC, o nome sul documento
 *                                                se fatturato senza salvarlo in anagrafica)
 *   GET  /documento/:id                        → una fattura con righe e scadenze
 *   POST /fattura                              → nuova fattura COPIATA da una precedente
 *
 * POST /fattura: { sorgente, data, righe: [{name, description}], scadenze: [YYYY-MM-DD], chiave }
 * Si cambiano solo date e testi delle righe: importi, IVA, cliente e pagamento
 * sono quelli della sorgente (Jarvis non può inventare un importo). La fattura
 * nasce su FIC col prossimo numero (FIC non ha bozze via API) e NON va allo SDI:
 * l'invio lo fa Guido (o Michela) dal pannello. `chiave` rende idempotente il
 * retry (Firestore jarvisFic/{chiave}, nessuna rule client ⇒ solo admin SDK).
 */

import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { timingSafeEqual } from 'crypto'
import { fic } from './fic'

const REGION = 'europe-west1'
const JARVIS_FIC_TOKEN = defineSecret('JARVIS_FIC_TOKEN')
const TIPI = ['invoice', 'credit_note', 'proforma', 'receipt']
const giorno = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null
const quota = (s: string) => s.replace(/'/g, "\\'")

function autorizzato(header: unknown): boolean {
  const atteso = Buffer.from(JARVIS_FIC_TOKEN.value() || '')
  const dato = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''))
  return atteso.length >= 32 && dato.length === atteso.length && timingSafeEqual(dato, atteso)
}

// Solo i campi che servono per rifare la stessa fattura: niente id, numero,
// stato SDI, allegati o pagamenti già incassati della sorgente.
const CAMPI_DOC = ['entity', 'numeration', 'subject', 'visible_subject', 'currency', 'language', 'use_gross_prices',
  'use_split_payment', 'e_invoice', 'payment_method', 'notes', 'rivalsa', 'cassa', 'cassa2', 'withholding_tax',
  'withholding_tax_taxable', 'other_withholding_tax', 'stamp_duty', 'global_cassa_taxable', 'show_payment_method',
  'show_payments', 'show_totals']
const CAMPI_RIGA = ['product_id', 'code', 'name', 'description', 'qty', 'measure', 'net_price', 'gross_price', 'vat',
  'discount', 'discount_highlight', 'not_taxable', 'apply_withholding_taxes', 'category']
const CAMPI_EI = ['payment_method', 'vat_kind', 'bank_name', 'bank_iban', 'bank_beneficiary']
const scegli = (o: Record<string, any>, campi: string[]) => Object.fromEntries(campi.filter((k) => o?.[k] !== undefined && o?.[k] !== null).map((k) => [k, o[k]]))

/** Il corpo della nuova fattura: la sorgente con nuove date e testi delle righe. Puro, testabile. */
export function copiaFattura(src: Record<string, any>, { data, righe = [], scadenze = [] }: { data: string; righe?: { name?: string; description?: string }[]; scadenze?: string[] }) {
  if (src?.type !== 'invoice') throw new Error('la sorgente non è una fattura')
  const items = src.items_list || []; const pays = src.payments_list || []
  if (righe.length && righe.length !== items.length) throw new Error(`righe: ne servono ${items.length}, arrivate ${righe.length}`)
  if (scadenze.length && scadenze.length !== pays.length) throw new Error(`scadenze: ne servono ${pays.length}, arrivate ${scadenze.length}`)
  return {
    type: 'invoice',
    ...scegli(src, CAMPI_DOC),
    ...(src.ei_data ? { ei_data: scegli(src.ei_data, CAMPI_EI) } : {}),
    date: data,
    items_list: items.map((it: any, i: number) => ({ ...scegli(it, CAMPI_RIGA), ...(righe[i]?.name !== undefined ? { name: String(righe[i].name) } : {}), ...(righe[i]?.description !== undefined ? { description: String(righe[i].description) } : {}) })),
    payments_list: pays.map((p: any, i: number) => ({ amount: p.amount, due_date: scadenze[i] || data, status: 'not_paid' })),
  }
}

const riassunto = (d: any) => ({ id: d.id, tipo: d.type, numero: d.number ?? null, numerazione: d.numeration || '', data: d.date, cliente: d.entity?.name || '', cliente_id: d.entity?.id ?? null, imponibile: d.amount_net ?? null, iva: d.amount_vat ?? null, totale: d.amount_gross ?? null, oggetto: d.visible_subject || d.subject || '', url: d.url || null })

export const ficProxy = onRequest({ region: REGION, secrets: [JARVIS_FIC_TOKEN], cors: false, maxInstances: 2 }, async (req, res) => {
  if (!autorizzato(req.headers.authorization)) { res.status(401).json({ errore: 'non autorizzato' }); return }
  const [, rotta, id] = req.path.split('/')
  try {
    if (req.method === 'GET' && rotta === 'azienda') {
      const s = (await getFirestore().doc('secrets/fic').get()).data()
      res.json({ azienda: { nome: s?.companyName || null, id: s?.companyId || null, collegata: !!s?.refreshToken } }); return
    }
    if (req.method === 'GET' && rotta === 'clienti') {
      const q = String(req.query.q || '').trim()
      if (q.length < 2) { res.status(400).json({ errore: 'q: almeno 2 lettere' }); return }
      const d = await fic(`/entities/clients?fieldset=detailed&per_page=20&q=${encodeURIComponent(`name contains '${quota(q)}'`)}`)
      res.json({ clienti: (d?.data || []).map((c: any) => ({ id: c.id, nome: c.name, piva: c.vat_number || '', cf: c.tax_code || '', citta: c.address_city || '' })) }); return
    }
    if (req.method === 'GET' && rotta === 'documenti') {
      const cliente = Number(req.query.cliente); const nome = String(req.query.nome || '').trim(); const tipo = String(req.query.tipo || 'invoice')
      if (!cliente && nome.length < 3) { res.status(400).json({ errore: 'cliente (id FIC) o nome (almeno 3 lettere)' }); return }
      if (!TIPI.includes(tipo)) { res.status(400).json({ errore: `tipo: uno di ${TIPI.join(', ')}` }); return }
      const filtri = [cliente ? `entity.id = ${cliente}` : `entity.name contains '${quota(nome)}'`]; const da = giorno(req.query.da); const a = giorno(req.query.a)
      if (da) filtri.push(`date >= '${da}'`); if (a) filtri.push(`date <= '${a}'`)
      const d = await fic(`/issued_documents?type=${tipo}&sort=-date&per_page=50&q=${encodeURIComponent(filtri.join(' and '))}`)
      res.json({ documenti: (d?.data || []).map(riassunto) }); return
    }
    if (req.method === 'GET' && rotta === 'documento' && Number(id)) {
      const d = (await fic(`/issued_documents/${Number(id)}?fieldset=detailed`))?.data
      res.json({ documento: { ...riassunto(d), scadenza: d.next_due_date || null, ei_status: d.ei_status || null, metodo_pagamento: d.ei_data?.payment_method || null,
        righe: (d.items_list || []).map((it: any) => ({ name: it.name || '', description: it.description || '', qty: it.qty, net_price: it.net_price, gross_price: it.gross_price, iva: it.vat?.value ?? null, iva_id: it.vat?.id ?? null })),
        scadenze: (d.payments_list || []).map((p: any) => ({ amount: p.amount, due_date: p.due_date, status: p.status })) } }); return
    }
    if (req.method === 'POST' && rotta === 'fattura') {
      const b = req.body || {}; const data = giorno(b.data); const chiave = String(b.chiave || '').replace(/[^\w-]/g, '').slice(0, 80)
      if (!Number(b.sorgente) || !data || !chiave) { res.status(400).json({ errore: 'servono sorgente, data (YYYY-MM-DD) e chiave' }); return }
      const ref = getFirestore().collection('jarvisFic').doc(chiave); const gia = (await ref.get()).data()
      if (gia?.documento) { res.json({ documento: gia.documento, gia_creata: true }); return }
      // lucchetto: due chiamate uguali in parallelo non creano due fatture
      try { await ref.create({ stato: 'in_corso', dal: FieldValue.serverTimestamp() }) } catch { res.status(409).json({ errore: 'creazione già in corso per questa chiave' }); return }
      let nuova: any
      try {
        const scadenze = Array.isArray(b.scadenze) ? b.scadenze.map(giorno) : []
        if (scadenze.some((s: string | null) => !s)) throw new Error('scadenze: date YYYY-MM-DD')
        const src = (await fic(`/issued_documents/${Number(b.sorgente)}?fieldset=detailed`))?.data
        const corpo = copiaFattura(src, { data, righe: Array.isArray(b.righe) ? b.righe : [], scadenze })
        nuova = (await fic('/issued_documents', { method: 'POST', body: { data: corpo } }))?.data // nessun e_invoice/send: lo SDI resta a Guido
      } catch (e) { await ref.delete(); throw e }
      const documento = riassunto(nuova)
      await ref.set({ documento, sorgente: Number(b.sorgente), creato: FieldValue.serverTimestamp() })
      res.json({ documento, gia_creata: false }); return
    }
    res.status(404).json({ errore: 'rotta sconosciuta' })
  } catch (e: any) {
    console.error('[ficProxy]', req.method, req.path, e?.message)
    res.status(502).json({ errore: String(e?.message || e).slice(0, 300) })
  }
})
