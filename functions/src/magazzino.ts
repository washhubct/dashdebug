import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════════
// MAGAZZINO CONSUMABILI (dal 06/11/2026)
//
// Skippa fotografa la fattura del fornitore → `leggiFattura` la fa leggere a
// Claude (output strutturato) e restituisce una PROPOSTA: fornitore, righe,
// abbinamento ai prodotti già a catalogo e variazione di prezzo rispetto
// all'ultimo acquisto. Niente viene salvato finché l'operatore non conferma
// con `salvaCarico`. `salvaInventario` registra una conta fisica (la giacenza
// diventa quella contata): acquisti + conte = consumi reali per sede.
//
//   fornitori/{piva|slug}         anagrafica creata dai dati della fattura
//   prodotti/{id}                 catalogo condiviso tra sedi; giacenza{sedeId}
//   prodotti/{id}/prezzi/{acqId}  storico prezzi
//   acquisti/{fornitore_numero_anno}  id deterministico → niente doppioni
//   inventari/{auto}              conte fisiche per sede
// Scritture solo da qui (admin SDK); le rules danno solo la lettura.
// ═══════════════════════════════════════════════════════════════════

const REGION = 'europe-west1'
const MODEL = 'claude-opus-5-5'
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')
const ADMIN_EMAILS = ['amministrazione@avrlogisticarl.com', 'michela@avrlogisticarl.com']
const db = getFirestore()

const CATEGORIE = ['shampoo', 'cera', 'profumi', 'detergenti', 'pneumatici e cerchi', 'interni', 'panni e spugne', 'attrezzatura', 'altro'] as const

const Fattura = z.object({
  tipoDocumento: z.enum(['fattura', 'ddt', 'scontrino', 'altro']),
  numero: z.string().nullable().describe('Numero del documento come stampato'),
  data: z.string().nullable().describe('Data del documento in formato YYYY-MM-DD'),
  fornitore: z.object({
    ragioneSociale: z.string(),
    piva: z.string().nullable().describe('Partita IVA del FORNITORE (emittente), solo cifre, senza prefisso IT'),
    codiceFiscale: z.string().nullable(),
    indirizzo: z.string().nullable(),
    email: z.string().nullable(),
    telefono: z.string().nullable(),
  }),
  righe: z.array(z.object({
    descrizione: z.string().describe('Descrizione della riga come stampata'),
    codice: z.string().nullable().describe('Codice articolo del fornitore, se presente'),
    nomeProdotto: z.string().describe('Nome breve e pulito del prodotto, con formato/confezione (es. "Shampoo prelavaggio tanica 25 kg")'),
    categoria: z.enum(CATEGORIE),
    quantita: z.number(),
    unita: z.string().describe('Unità della quantità: pz, tanica, kg, L, conf, ...'),
    prezzoUnitario: z.number().describe('Prezzo unitario netto IVA esclusa, già scontato'),
    aliquotaIva: z.number().nullable(),
    totaleRiga: z.number().nullable().describe('Totale riga IVA esclusa'),
    isProdotto: z.boolean().describe('false per trasporto, spese, contributi, cauzioni, arrotondamenti'),
  })),
  imponibile: z.number().nullable(),
  iva: z.number().nullable(),
  totale: z.number().nullable(),
  avvisi: z.array(z.string()).describe('Parti illeggibili o dubbie, in italiano. Vuoto se tutto chiaro.'),
})

const ISTRUZIONI = `Leggi il documento d'acquisto di un autolavaggio (fattura, DDT o scontrino di un fornitore) ed estrai i dati.
- Il fornitore è chi EMETTE il documento, non il destinatario (il destinatario è l'autolavaggio: LAST MILE SRL / Wash Hub).
- Numeri in formato decimale (1.234,50 → 1234.5). Prezzi IVA esclusa; se la riga ha uno sconto, prezzoUnitario è il prezzo già scontato.
- Non inventare: se un dato non si legge mettilo a null e segnalalo in "avvisi".
- Includi anche le righe non prodotto (trasporto, spese) con isProdotto=false.`

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '')
const slug = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
const r2 = (n: number) => Math.round(n * 100) / 100
const oggiISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })

async function controllaAccesso(auth: { uid: string; token: { email?: string } } | undefined, sedeId: string) {
  const email = (auth?.token?.email || '').toLowerCase()
  if (!auth || !email) throw new HttpsError('unauthenticated', 'Login richiesto')
  if (!sedeId) throw new HttpsError('invalid-argument', 'sedeId mancante')
  if (ADMIN_EMAILS.includes(email)) return email
  // Stessa logica di hasSedeAccess nelle rules: senza utenti/{uid} vale solo lungomare
  const u = await db.doc(`utenti/${auth.uid}`).get()
  const sedi: string[] = u.exists ? (u.data()?.sedi || []) : ['lungomare']
  if (!sedi.includes(sedeId)) throw new HttpsError('permission-denied', 'Sede non abilitata')
  return email
}

const fornitoreId = (f: { piva?: string | null; ragioneSociale?: string }) =>
  f.piva && /^\d{11}$/.test(f.piva.replace(/\D/g, '')) ? f.piva.replace(/\D/g, '') : 'f-' + slug(f.ragioneSociale || 'sconosciuto')

/** Abbina una riga al catalogo: codice del fornitore → descrizione già vista → nome prodotto. */
function abbina(riga: { codice: string | null; descrizione: string; nomeProdotto: string }, fornId: string, prodotti: FirebaseFirestore.QueryDocumentSnapshot[]) {
  const dello = prodotti.filter(p => p.data().fornitoreId === fornId)
  if (riga.codice) {
    const c = norm(riga.codice)
    const p = dello.find(p => norm(p.data().codiceFornitore) === c)
    if (p) return p
  }
  const d = norm(riga.descrizione)
  const n = norm(riga.nomeProdotto)
  return dello.find(p => (p.data().alias || []).includes(d))
    || prodotti.find(p => (p.data().alias || []).includes(d))
    || prodotti.find(p => norm(p.data().nome) === n)
    || null
}

async function leggiFattura(data: any) {
  const files: { base64: string; mediaType: string }[] = data.files || []
  if (!files.length || files.length > 6) throw new HttpsError('invalid-argument', 'Da 1 a 6 foto/PDF')
  const content: Anthropic.Beta.BetaContentBlockParam[] = files.map(f => f.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: f.mediaType as 'image/jpeg' | 'image/png' | 'image/webp', data: f.base64 } })
  content.push({ type: 'text', text: ISTRUZIONI })

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() })
  let res
  try {
    res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
      output_config: { format: betaZodOutputFormat(Fattura) },
    })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpsError('resource-exhausted', 'Troppe letture, riprova tra un minuto')
    if (e instanceof Anthropic.BadRequestError) throw new HttpsError('invalid-argument', 'File non leggibile: ' + e.message)
    if (e instanceof Anthropic.APIError) throw new HttpsError('unavailable', `Servizio di lettura non disponibile (${e.status})`)
    throw e
  }
  if (res.stop_reason === 'refusal') throw new HttpsError('failed-precondition', 'Documento non elaborabile')
  if (res.stop_reason === 'max_tokens') throw new HttpsError('failed-precondition', 'Documento troppo lungo: carica meno pagine per volta')
  const f = res.parsed_output
  if (!f) throw new HttpsError('internal', 'Lettura non riuscita, riprova con una foto più nitida')

  const fornId = fornitoreId(f.fornitore)
  const [fornSnap, prodSnap] = await Promise.all([db.doc(`fornitori/${fornId}`).get(), db.collection('prodotti').get()])
  const anno = (f.data || oggiISO()).slice(0, 4)
  const acquistoId = f.numero ? `${fornId}_${slug(f.numero)}_${anno}` : null
  const giaCaricata = acquistoId ? (await db.doc(`acquisti/${acquistoId}`).get()).exists : false

  const righe = f.righe.map(r => {
    const p = r.isProdotto ? abbina(r, fornId, prodSnap.docs) : null
    const prec = p ? Number(p.data().ultimoPrezzo) || null : null
    const stessaUnita = p && norm(p.data().unita) === norm(r.unita)
    const variazionePct = prec && stessaUnita ? r2(((r.prezzoUnitario - prec) / prec) * 100) : null
    return { ...r, prodottoId: p?.id || null, prodottoNome: p?.data().nome || null, prezzoPrec: stessaUnita ? prec : null, variazionePct }
  })

  return {
    proposta: { ...f, righe, fornitoreId: fornId, fornitoreNuovo: !fornSnap.exists, acquistoId, giaCaricata },
    usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
  }
}

async function salvaCarico(data: any, email: string) {
  const p = data.proposta
  const sedeId = String(data.sedeId)
  if (!p?.fornitore?.ragioneSociale || !Array.isArray(p.righe)) throw new HttpsError('invalid-argument', 'Proposta non valida')
  const fornId = fornitoreId(p.fornitore)
  const dataISO = /^\d{4}-\d{2}-\d{2}$/.test(p.data || '') ? p.data : oggiISO()
  const acquistoId = p.numero ? `${fornId}_${slug(p.numero)}_${dataISO.slice(0, 4)}` : `${fornId}_${Date.now()}`
  const acqRef = db.doc(`acquisti/${acquistoId}`)

  return db.runTransaction(async tx => {
    if ((await tx.get(acqRef)).exists) throw new HttpsError('already-exists', `Documento ${p.numero} di ${p.fornitore.ragioneSociale} già caricato`)
    const prodRefs = p.righe.filter((r: any) => r.isProdotto && r.prodottoId).map((r: any) => db.doc(`prodotti/${r.prodottoId}`))
    const prodEsistenti = new Map((await Promise.all(prodRefs.map((ref: any) => tx.get(ref)))).map((s: any) => [s.id, s]))

    const fornRef = db.doc(`fornitori/${fornId}`)
    const fornSnap = await tx.get(fornRef)
    const f = p.fornitore
    tx.set(fornRef, {
      ragioneSociale: f.ragioneSociale, piva: f.piva || null, codiceFiscale: f.codiceFiscale || null,
      indirizzo: f.indirizzo || null, email: f.email || null, telefono: f.telefono || null,
      ultimoAcquistoISO: dataISO, aggiornato: FieldValue.serverTimestamp(),
      ...(fornSnap.exists ? {} : { creato: FieldValue.serverTimestamp(), creatoDa: 'fattura' }),
    }, { merge: true })

    const righe = []
    for (const r of p.righe) {
      const quantita = Number(r.quantita) || 0
      const prezzo = r2(Number(r.prezzoUnitario) || 0)
      let prodottoId: string | null = null
      if (r.isProdotto) {
        const esiste = r.prodottoId ? prodEsistenti.get(r.prodottoId) : null
        const ref = esiste?.exists ? esiste.ref : db.collection('prodotti').doc()
        prodottoId = ref.id
        const alias = FieldValue.arrayUnion(norm(r.descrizione))
        tx.set(ref, {
          ...(esiste?.exists ? {} : { nome: r.nomeProdotto || r.descrizione, categoria: r.categoria || 'altro', unita: r.unita || 'pz', creato: FieldValue.serverTimestamp(), scortaMin: {} }),
          fornitoreId: fornId, fornitoreNome: f.ragioneSociale,
          ...(r.codice ? { codiceFornitore: r.codice } : {}),
          alias, ultimoPrezzo: prezzo, ultimoAcquistoISO: dataISO,
          giacenza: { [sedeId]: FieldValue.increment(quantita) },
          aggiornato: FieldValue.serverTimestamp(),
        }, { merge: true })
        tx.set(ref.collection('prezzi').doc(acquistoId), { prezzo, unita: r.unita || 'pz', quantita, dataISO, fornitoreId: fornId, sedeId })
      }
      righe.push({
        prodottoId, descrizione: r.descrizione, nomeProdotto: r.nomeProdotto || null, codice: r.codice || null,
        categoria: r.categoria || 'altro', quantita, unita: r.unita || 'pz', prezzoUnitario: prezzo,
        aliquotaIva: r.aliquotaIva ?? null, totaleRiga: r.totaleRiga ?? r2(quantita * prezzo), isProdotto: !!r.isProdotto,
        prezzoPrec: r.prezzoPrec ?? null, variazionePct: r.variazionePct ?? null,
      })
    }
    tx.set(acqRef, {
      sedeId, fornitoreId: fornId, fornitoreNome: f.ragioneSociale, tipoDocumento: p.tipoDocumento || 'fattura',
      numero: p.numero || null, dataISO, righe,
      imponibile: p.imponibile ?? null, iva: p.iva ?? null, totale: p.totale ?? null,
      origine: 'foto', caricatoDa: email, creato: FieldValue.serverTimestamp(),
    })
    return { acquistoId, righe: righe.length }
  })
}

async function salvaInventario(data: any, email: string) {
  const sedeId = String(data.sedeId)
  const righe: { prodottoId: string; quantita: number }[] = (data.righe || []).filter((r: any) => r.prodottoId && Number.isFinite(Number(r.quantita)))
  if (!righe.length) throw new HttpsError('invalid-argument', 'Nessuna quantità inserita')
  const batch = db.batch()
  const dataISO = oggiISO()
  const snaps = await db.getAll(...righe.map(r => db.doc(`prodotti/${r.prodottoId}`)))
  const dettaglio = righe.map((r, i) => {
    const prima = Number(snaps[i].data()?.giacenza?.[sedeId]) || 0
    batch.set(snaps[i].ref, { giacenza: { [sedeId]: Number(r.quantita) }, ultimaContaISO: { [sedeId]: dataISO } }, { merge: true })
    return { prodottoId: r.prodottoId, quantita: Number(r.quantita), teorica: prima }
  })
  batch.set(db.collection('inventari').doc(), { sedeId, dataISO, righe: dettaglio, fattoDa: email, creato: FieldValue.serverTimestamp() })
  await batch.commit()
  return { ok: true, prodotti: righe.length }
}

export const magazzinoApi = onCall({ region: REGION, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  const { action, sedeId } = request.data || {}
  const email = await controllaAccesso(request.auth as any, sedeId)
  switch (action) {
    case 'leggiFattura': return leggiFattura(request.data)
    case 'salvaCarico': return salvaCarico(request.data, email)
    case 'salvaInventario': return salvaInventario(request.data, email)
    default: throw new HttpsError('invalid-argument', 'Azione sconosciuta')
  }
})
