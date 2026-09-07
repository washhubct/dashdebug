/**
 * Integrazione Fatture in Cloud (API v2) — fatturazione sospesi + anagrafica.
 *
 * Credenziali e token OAuth vivono in Firestore `secrets/fic` (nessuna rule
 * client la matcha ⇒ deny; solo admin SDK). Campi del doc:
 *   clientId, clientSecret        — app registrata su developers.fattureincloud.it
 *   accessToken, refreshToken     — scritti da ficOauthCallback, ruotati dal refresh
 *   expiresAt (ms), companyId     — companyId scelto al primo collegamento
 *
 * Flusso setup: deploy → registrare l'app FIC con redirect ficOauthCallback →
 * scrivere clientId/clientSecret nel doc → aprire l'URL di authorize → callback
 * salva i token. Da lì ficApi è operativa.
 *
 * Le fatture vengono create su FIC e inviate subito a SDI (richiesta titolare
 * 30/07). Se l'invio fallisce la fattura resta su FIC, da inviare dal pannello.
 */

import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

const REGION = 'europe-west1'
const FIC_API = 'https://api-v2.fattureincloud.it'
const OAUTH_SCOPE = 'entity.clients:a issued_documents.invoices:a settings:r'

const secretsRef = () => getFirestore().doc('secrets/fic')

// ───────────────────────── token helpers ─────────────────────────

async function exchangeToken(body: Record<string, string>): Promise<Record<string, any>> {
  const res = await fetch(`${FIC_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`oauth/token HTTP ${res.status}: ${JSON.stringify(data)}`)
  return data
}

/** Access token valido, rinnovato via refresh se scaduto (o quasi). */
async function getAccessToken(): Promise<{ token: string; companyId: number }> {
  const snap = await secretsRef().get()
  const s = snap.data()
  if (!s?.refreshToken) throw new HttpsError('failed-precondition', 'Fatture in Cloud non collegato: completare OAuth')

  if (s.accessToken && Date.now() < (s.expiresAt || 0) - 60_000) {
    return { token: s.accessToken, companyId: s.companyId }
  }

  const data = await exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: s.refreshToken,
    client_id: s.clientId,
    client_secret: s.clientSecret,
  })
  await secretsRef().set({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || s.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 86400) * 1000,
  }, { merge: true })
  return { token: data.access_token, companyId: s.companyId }
}

async function fic(path: string, opts: { method?: string; body?: unknown } = {}): Promise<any> {
  const { token, companyId } = await getAccessToken()
  const res = await fetch(`${FIC_API}/c/${companyId}${path}`, {
    method: opts.method || 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpsError('internal', erroreFicLeggibile(path, res.status, data))
  return data
}

/** Errore FIC in italiano leggibile da chi sta in cassa (non JSON grezzo). */
function erroreFicLeggibile(path: string, status: number, data: any): string {
  const xml: string[] = data?.error?.validation_result?.xml_errors || []
  if (xml.length) return `SDI ha rifiutato la fattura: ${xml.join(' · ')}`
  const msg = data?.error?.message || data?.message
  if (typeof msg === 'string' && msg && msg !== 'Validation XML') return `Fatture in Cloud: ${msg}`
  return `Fatture in Cloud: errore ${status} su ${path}`
}

// ───────────────────────── OAuth callback ─────────────────────────

export const ficOauthCallback = onRequest({ region: REGION }, async (req, res) => {
  try {
    const s = (await secretsRef().get()).data()
    if (!s?.clientId || !s?.clientSecret) { res.status(500).send('clientId/clientSecret non configurati in secrets/fic'); return }

    const redirectUri = `https://${REGION}-dashboard-washhub.cloudfunctions.net/ficOauthCallback`

    // Senza ?code: avvia il flusso, redirect alla pagina di autorizzazione FIC
    const code = String(req.query.code || '')
    if (!code) {
      const authUrl = `${FIC_API}/oauth/authorize?response_type=code&client_id=${encodeURIComponent(s.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(OAUTH_SCOPE)}&state=washhub`
      res.redirect(authUrl)
      return
    }
    const data = await exchangeToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: s.clientId,
      client_secret: s.clientSecret,
    })

    // Prima azienda dell'account (P.IVA unica): companyId fissato qui
    const compRes = await fetch(`${FIC_API}/user/companies`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    const comp = await compRes.json().catch(() => ({}))
    const companies = comp?.data?.companies || []
    const companyId = companies[0]?.id

    await secretsRef().set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 86400) * 1000,
      companyId: companyId || null,
      companyName: companies[0]?.name || '',
      collegatoIl: new Date().toISOString(),
    }, { merge: true })

    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding-top:60px">
      <h2>✅ Fatture in Cloud collegato</h2>
      <p>Azienda: <strong>${companies[0]?.name || companyId || '?'}</strong></p>
      <p>Puoi chiudere questa pagina.</p></body></html>`)
  } catch (e: any) {
    console.error('[fic] oauth callback', e)
    res.status(500).send('Errore OAuth: ' + e.message)
  }
})

// ───────────────────────── API callable ─────────────────────────

/** Cache aliquota 22% per companyId (l'id vat_type cambia da azienda ad azienda). */
const vat22ByCompany: Record<number, number> = {}
async function getVat22(): Promise<number> {
  const { companyId } = await getAccessToken()
  if (vat22ByCompany[companyId] !== undefined) return vat22ByCompany[companyId]
  const data = await fic('/info/vat_types')
  const v22 = (data?.data || []).find((v: any) => v.value === 22)
  if (!v22) throw new HttpsError('internal', 'Aliquota IVA 22% non trovata tra le vat_types FIC')
  vat22ByCompany[companyId] = v22.id
  return v22.id
}

/**
 * Cerca il cliente su FIC per P.IVA (match esatto) o nome; se assente lo crea
 * coi dati del CRM dashboard. Ritorna { id, name, creato }.
 */
// "Via Taormina 13/C, 95027 San Gregorio di Catania (CT)" → componenti SDI.
// Il CAP a 5 cifre fa da separatore; la provincia è l'eventuale (XX) finale.
// La provincia è OBBLIGATORIA in FatturaPA ma nel CRM manca quasi sempre
// (visto 28/08: 10 fatture bloccate): se assente la deduciamo dal CAP.
const PROV_DA_CAP: Record<string, string> = {
  '90': 'PA', '91': 'TP', '92': 'AG', '93': 'CL', '94': 'EN', '95': 'CT', '96': 'SR', '97': 'RG', '98': 'ME',
  '00': 'RM', '20': 'MI', '80': 'NA', '89': 'RC',
}
export function parseIndirizzo(raw: unknown): { street?: string; cap?: string; city?: string; prov?: string } {
  const s = String(raw || '').trim()
  if (!s) return {}
  // "..., 95027 San Gregorio di Catania (CT)" | "... 95127 CATANIA CT" | "... 95127 CATANIA"
  const m = s.match(/^(.*?)[,\s]+(\d{5})\s+(.+?)(?:\s*\(([A-Za-z]{2})\)|\s+([A-Za-z]{2}))?$/)
  if (!m) return { street: s }
  const prov = (m[4] || m[5])?.toUpperCase() || PROV_DA_CAP[m[2].slice(0, 2)]
  return { street: m[1].replace(/,$/, '').trim(), cap: m[2], city: m[3].trim(), prov }
}

/** Checksum P.IVA italiana (Luhn-like). Nel CRM sono arrivate P.IVA con typo (28/08). */
export function pivaValida(p: string): boolean {
  if (!/^\d{11}$/.test(p)) return false
  const d = p.split('').map(Number)
  let sum = 0
  for (let i = 0; i < 10; i++) {
    if (i % 2 === 0) sum += d[i]
    else { const y = d[i] * 2; sum += y > 9 ? y - 9 : y }
  }
  return (10 - (sum % 10)) % 10 === d[10]
}

/** Cosa manca perché SDI accetti la fattura. Vuoto = ok. */
function problemiAnagrafica(e: Record<string, any>): string[] {
  const out: string[] = []
  if (!e.vat_number && !e.tax_code) out.push('P.IVA/CF mancante')
  else if (e.vat_number && !pivaValida(String(e.vat_number))) out.push(`P.IVA ${e.vat_number} non valida (cifra di controllo errata)`)
  if (!e.address_street) out.push('via mancante')
  if (!e.address_postal_code) out.push('CAP mancante o non a 5 cifre')
  if (!e.address_city) out.push('città mancante')
  if (!e.address_province) out.push('provincia mancante (sigla 2 lettere)')
  if (!e.ei_code && !e.certified_email) out.push('codice SDI o PEC mancante')
  if (e.ei_code === '0000000' && !e.certified_email) out.push('con SDI 0000000 serve la PEC')
  return out
}

/** Conti FIC per il pagato: cerca per nome (CASSA/CONTANTI, POS/CARTA, BANCO/BONIFICO), fallback primo. */
const paByCompany: Record<number, any[]> = {}
async function paymentAccountId(modalita: string): Promise<number | undefined> {
  const { companyId } = await getAccessToken()
  if (!paByCompany[companyId]) paByCompany[companyId] = ((await fic('/info/payment_accounts'))?.data || [])
  const list = paByCompany[companyId]
  const pref: Record<string, RegExp> = { CONTANTI: /cassa|contant/i, POS: /\bpos\b|bancomat/i, BONIFICO: /banco|banca|bonifico|iban/i }
  const rx = pref[modalita] || /./
  return (list.find((a: any) => rx.test(a.name)) || list[0])?.id
}

// Anagrafica da denormalizzare nel documento: FIC NON copia P.IVA/CF/SDI
// dall'anagrafica clienti — nel doc finisce solo ciò che passi in `entity`.
// Passare solo {id, name} produce fatture senza dati fiscali (bug visto 24/08).
// I campi formattati male fanno rifiutare l'XML a SDI (visto 24/08: provincia
// per esteso, CAP a 6 cifre, codici SDI monchi): meglio ometterli che passarli.
function entityDoc(id: number, name: string, e: Record<string, any>) {
  const cap = String(e.address_postal_code || '').trim()
  const prov = String(e.address_province || '').trim().toUpperCase()
  const sdi = String(e.ei_code || '').trim().toUpperCase()
  return {
    id,
    name,
    vat_number: e.vat_number || undefined,
    // CF solo se distinto dalla P.IVA: per ditte individuali (e alcune società
    // storiche) CF ≠ P.IVA e SDI scarta con errore 00324 se non corrispondono.
    // La sola P.IVA è sufficiente per FatturaPA.
    tax_code: e.tax_code && e.tax_code !== e.vat_number ? e.tax_code : undefined,
    address_street: e.address_street || undefined,
    address_postal_code: /^\d{5}$/.test(cap) ? cap : undefined,
    address_city: e.address_city || undefined,
    address_province: /^[A-Z]{2}$/.test(prov) ? prov : undefined,
    country: e.country || 'Italia',
    ei_code: /^[A-Z0-9]{6,7}$/.test(sdi) ? sdi : undefined,
    certified_email: e.certified_email || undefined,
  }
}

async function upsertClienteFIC(c: Record<string, any>): Promise<{ id: number; name: string; creato: boolean; haFiscali: boolean; entity: Record<string, any> }> {
  const piva = String(c.piva || '').replace(/\s/g, '')
  const cf = String(c.cf || '').replace(/\s/g, '')
  const addr = parseIndirizzo(c.indirizzo)
  let q = piva ? `vat_number = '${piva}'` : `name contains '${String(c.nome).replace(/'/g, "\\'")}'`
  // fieldset=detailed: servono anche indirizzo/SDI/PEC per denormalizzarli nel doc
  const found = await fic(`/entities/clients?fieldset=detailed&q=${encodeURIComponent(q)}`)
  const match = (found?.data || [])[0]
  if (match) {
    // Entity esistente ma anagrafica monca: integra dal CRM (fonte unica).
    // Senza P.IVA/CF sull'entity l'invio SDI viene rifiutato (visto 03/08).
    const patch: Record<string, unknown> = {}
    if (piva && !match.vat_number) patch.vat_number = piva
    if ((cf || piva) && !match.tax_code) patch.tax_code = cf || piva
    // SDI: FIC mette '0000000' di default alle anagrafiche create senza codice,
    // quindi "vuoto" include anche quello. Se il CRM ha un codice vero e FIC
    // ne ha uno diverso, vince il CRM (fonte unica) — visto 07/09: COMIS con
    // KRRH6B9 nel CRM bloccato da "con SDI 0000000 serve la PEC".
    const sdiCrm = String(c.sdi || '').trim().toUpperCase()
    const sdiFicVuoto = !match.ei_code || match.ei_code === '0000000'
    if (/^[A-Z0-9]{6,7}$/.test(sdiCrm) && sdiCrm !== '0000000' && (sdiFicVuoto || match.ei_code !== sdiCrm)) patch.ei_code = sdiCrm
    else if (sdiCrm === '0000000' && !match.ei_code) patch.ei_code = sdiCrm
    if (c.pec && !match.certified_email) patch.certified_email = c.pec
    if (addr.street && !match.address_street) {
      patch.address_street = addr.street
      if (addr.cap) patch.address_postal_code = addr.cap
      if (addr.city) patch.address_city = addr.city
      if (addr.prov) patch.address_province = addr.prov
    } else if (!match.address_province) {
      const prov = addr.prov || PROV_DA_CAP[String(match.address_postal_code || '').slice(0, 2)]
      if (prov) patch.address_province = prov
    }
    if (Object.keys(patch).length > 0) {
      await fic(`/entities/clients/${match.id}`, { method: 'PUT', body: { data: patch } })
    }
    const haFiscali = !!(match.vat_number || match.tax_code || patch.vat_number || patch.tax_code)
    return { id: match.id, name: match.name, creato: false, haFiscali, entity: entityDoc(match.id, match.name, { ...match, ...patch }) }
  }

  const body = {
    data: {
      name: c.nome,
      vat_number: piva || undefined,
      tax_code: cf || piva || undefined, // per le aziende il CF coincide con la P.IVA
      address_street: addr.street || undefined,
      address_postal_code: addr.cap || c.cap || undefined,
      address_city: addr.city || c.citta || undefined,
      address_province: addr.prov || c.provincia || undefined,
      country: 'Italia',
      ei_code: c.sdi || undefined,       // codice destinatario SDI
      certified_email: c.pec || undefined,
      type: piva ? 'company' : 'person',
    },
  }
  const created = await fic('/entities/clients', { method: 'POST', body })
  const nc = created?.data
  if (!nc?.id) throw new HttpsError('internal', 'Creazione cliente FIC fallita')
  return { id: nc.id, name: nc.name, creato: true, haFiscali: !!(piva || cf), entity: entityDoc(nc.id, nc.name, { ...body.data, ...nc }) }
}

export const ficApi = onCall({ region: REGION }, async (request) => {
  // Fatturazione aperta a tutti gli utenti autenticati del gestionale
  // (operatore compreso, richiesta del titolare 30/07).
  const email = (request.auth?.token?.email || '').toLowerCase()
  if (!email) throw new HttpsError('unauthenticated', 'Login richiesto')

  const { action, payload = {} } = request.data || {}

  switch (action) {
    case 'status': {
      const s = (await secretsRef().get()).data()
      return { collegato: !!s?.refreshToken, company: s?.companyName || null, companyId: s?.companyId || null }
    }

    case 'searchCliente': {
      const q = String(payload.nome || '').trim()
      if (!q) throw new HttpsError('invalid-argument', 'nome mancante')
      const data = await fic(`/entities/clients?q=${encodeURIComponent(`name contains '${q.replace(/'/g, "\\'")}'`)}`)
      return { clienti: (data?.data || []).map((c: any) => ({ id: c.id, nome: c.name, piva: c.vat_number || '', cf: c.tax_code || '' })) }
    }

    case 'fatturaSospesi': {
      // payload: { cliente: {nome, piva?, cf?, indirizzo?, cap?, citta?, provincia?, sdi?, pec?},
      //            righe: [{descrizione, importo}], note?, metodoPagamento? }
      // Il cliente viene cercato su FIC per P.IVA (o nome) e creato coi dati
      // del CRM se assente: la dashboard è la fonte dell'anagrafica.
      // metodoPagamento: codice SDI (MP01 contanti, MP05 bonifico, MP08 carta) —
      // obbligatorio nella fattura elettronica; default MP05 (sospesi a rimessa).
      // pagata: true → la fattura nasce già saldata su FIC (contanti/POS incassati
      // in dashboard); modalita (CONTANTI/POS/BONIFICO) sceglie il conto FIC.
      const { cliente, righe, note, metodoPagamento, pagata, modalita } = payload
      const mp = ['MP01', 'MP05', 'MP08'].includes(metodoPagamento) ? metodoPagamento : 'MP05'
      if (!cliente?.nome || !Array.isArray(righe) || righe.length === 0) {
        throw new HttpsError('invalid-argument', 'cliente.nome e righe richiesti')
      }
      const entity = await upsertClienteFIC(cliente)
      // Senza P.IVA/CF la fattura si creerebbe ma SDI la rifiuterebbe:
      // meglio bloccare subito con un messaggio actionable.
      if (!entity.haFiscali) {
        throw new HttpsError('failed-precondition',
          `Il cliente "${entity.name}" non ha P.IVA né Codice Fiscale (né su FIC né nel CRM). Completa l'anagrafica in Clienti/CRM e riprova.`)
      }
      // Controllo completo PRIMA di creare il documento: una fattura creata e
      // rifiutata da SDI resta su FIC col numero bruciato (28/08: 11 casi).
      const problemi = problemiAnagrafica(entity.entity)
      if (problemi.length) {
        throw new HttpsError('failed-precondition',
          `Anagrafica di "${entity.name}" incompleta per SDI: ${problemi.join(', ')}. Correggi in Clienti/CRM (o su FIC) e riprova.`)
      }
      const vatId = await getVat22()
      const items = righe.map((r: any) => ({
        name: String(r.descrizione || 'Lavaggio'),
        qty: 1,
        gross_price: Number(r.importo) || 0,
        vat: { id: vatId },
      }))
      const totale = Math.round(righe.reduce((s: number, r: any) => s + (Number(r.importo) || 0), 0) * 100) / 100
      const oggi = new Date().toISOString().slice(0, 10)
      const body = {
        data: {
          type: 'invoice',
          entity: entity.entity,
          date: oggi,
          use_gross_prices: true,
          items_list: items,
          payments_list: [pagata
            ? { amount: totale, due_date: oggi, paid_date: oggi, status: 'paid', payment_account: { id: await paymentAccountId(String(modalita || '').toUpperCase()) } }
            : { amount: totale, due_date: oggi, status: 'not_paid' }],
          visible_subject: note || 'Servizi autolavaggio — sospesi',
          e_invoice: true,
          ei_data: { payment_method: mp },
        },
      }
      const data = await fic('/issued_documents', { method: 'POST', body })
      const doc = data?.data

      // Invio immediato a SDI (richiesta titolare 30/07: niente approvazione
      // una a una). Se fallisce la fattura resta creata su FIC, da inviare da lì.
      let inviata = false
      let invioErrore: string | null = null
      try {
        await fic(`/issued_documents/${doc.id}/e_invoice/send`, { method: 'POST' })
        inviata = true
      } catch (e: any) {
        invioErrore = String(e.message || e).slice(0, 300)
        console.error('[fic] invio SDI fallito per doc', doc?.id, invioErrore)
      }

      return { ok: true, ficDocId: doc?.id, numero: doc?.number ?? null, totale: doc?.amount_gross ?? null, clienteFicId: entity.id, clienteCreato: entity.creato, inviata, invioErrore }
    }

    case 'inviaSdi': {
      // Reinvio a SDI di una fattura rimasta not_sent (dopo correzione anagrafica)
      const id = Number(payload.ficDocId)
      if (!id) throw new HttpsError('invalid-argument', 'ficDocId mancante')
      try {
        await fic(`/issued_documents/${id}/e_invoice/send`, { method: 'POST' })
        return { inviata: true, invioErrore: null }
      } catch (e: any) {
        return { inviata: false, invioErrore: String(e.message || e).slice(0, 300) }
      }
    }

    case 'segnaPagata': {
      // Incasso in dashboard (contanti/POS/bonifico) → pagamento saldato anche su FIC
      const id = Number(payload.ficDocId)
      if (!id) throw new HttpsError('invalid-argument', 'ficDocId mancante')
      const cur = (await fic(`/issued_documents/${id}?fields=id,payments_list`))?.data
      const payments = cur?.payments_list || []
      if (payments.length && payments.every((p: any) => p.status === 'paid')) return { ok: true, giaPagata: true }
      const oggi = new Date().toISOString().slice(0, 10)
      const paId = await paymentAccountId(String(payload.modalita || '').toUpperCase())
      const payments_list = payments.map((p: any) => ({ id: p.id, amount: p.amount, due_date: p.due_date, paid_date: oggi, status: 'paid', payment_account: { id: paId } }))
      await fic(`/issued_documents/${id}`, { method: 'PUT', body: { data: { payments_list } } })
      return { ok: true }
    }

    case 'statoFattura': {
      const id = Number(payload.ficDocId)
      if (!id) throw new HttpsError('invalid-argument', 'ficDocId mancante')
      const data = await fic(`/issued_documents/${id}?fields=id,number,date,amount_gross,next_due_date,payments_list`)
      const d = data?.data
      const payments = d?.payments_list || []
      const pagata = payments.length > 0 && payments.every((p: any) => p.status === 'paid')
      return { id: d?.id, numero: d?.number, totale: d?.amount_gross, pagata }
    }

    default:
      throw new HttpsError('invalid-argument', `Azione sconosciuta: ${action}`)
  }
})
