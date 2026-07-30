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
 * Le fatture vengono create come BOZZE in FIC: revisione e invio SDI restano
 * manuali sul pannello FIC (scelta deliberata, niente invii fiscali automatici).
 */

import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

const REGION = 'europe-west1'
const FIC_API = 'https://api-v2.fattureincloud.it'
const OAUTH_SCOPE = 'entity.clients:a issued_documents.invoices:a'
const ADMIN_EMAILS = ['amministrazione@avrlogisticarl.com', 'michela@avrlogisticarl.com']

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
  if (!res.ok) throw new HttpsError('internal', `FIC ${path} HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`)
  return data
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

/** Cache aliquota 22% (id vat_type della company). */
let vat22Id: number | null = null
async function getVat22(): Promise<number> {
  if (vat22Id !== null) return vat22Id
  const data = await fic('/info/vat_types')
  const v22 = (data?.data || []).find((v: any) => v.value === 22)
  if (!v22) throw new HttpsError('internal', 'Aliquota IVA 22% non trovata tra le vat_types FIC')
  vat22Id = v22.id
  return v22.id
}

export const ficApi = onCall({ region: REGION }, async (request) => {
  const email = (request.auth?.token?.email || '').toLowerCase()
  if (!email) throw new HttpsError('unauthenticated', 'Login richiesto')
  if (!ADMIN_EMAILS.includes(email)) throw new HttpsError('permission-denied', 'Solo admin')

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
      // payload: { clienteFicId, righe: [{descrizione, importo}], note? }
      const { clienteFicId, righe, note } = payload
      if (!clienteFicId || !Array.isArray(righe) || righe.length === 0) {
        throw new HttpsError('invalid-argument', 'clienteFicId e righe richiesti')
      }
      const vatId = await getVat22()
      const items = righe.map((r: any) => ({
        name: String(r.descrizione || 'Lavaggio'),
        qty: 1,
        gross_price: Number(r.importo) || 0,
        vat: { id: vatId },
      }))
      const body = {
        data: {
          type: 'invoice',
          entity: { id: clienteFicId },
          date: new Date().toISOString().slice(0, 10),
          items_list: items,
          visible_subject: note || 'Servizi autolavaggio — sospesi',
          e_invoice: false, // bozza: revisione e invio SDI dal pannello FIC
        },
      }
      const data = await fic('/issued_documents', { method: 'POST', body })
      const doc = data?.data
      return { ok: true, ficDocId: doc?.id, numero: doc?.number ?? null, totale: doc?.amount_gross ?? null, url: doc?.url ?? null }
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
