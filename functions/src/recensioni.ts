import { onRequest } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

// ═══════════════════════════════════════════════════════════════════
// ⭐ RECENSIONI GOOGLE (15/11/2026) — voto e recensioni per il sito wash-hub.it
//
// Il sito è statico: a ogni build (push + giro giornaliero di GitHub Actions) lo script
// scripts/fetch-reviews.mjs legge questo endpoint e rigenera src/data/reviews.json.
// Qui si chiama Places API (New) con il token del service account della function:
// nessuna API key da custodire, né qui né su GitHub.
//
// Endpoint: GET https://europe-west1-dashboard-washhub.cloudfunctions.net/recensioniGoogle
//   → { placeId, placeName, rating, totalRatings, updatedAt, reviews:[{ name, avatar, rating, text, date, time }] }
// Cache in `cache/recensioniGoogle` (solo admin SDK): Google viene chiamato al massimo ogni 12 ore,
// anche se l'endpoint pubblico viene martellato. Se Google non risponde si serve l'ultima copia buona.
// In vetrina solo recensioni con testo e almeno 4 stelle; voto medio e numero totale sono quelli veri.
// ═══════════════════════════════════════════════════════════════════

const REGION = 'europe-west1'
const PLACE_ID = 'ChIJE7A-YnH9ExMRlssUFfIZGao' // WASH HUB Lungomare
const DOC = 'cache/recensioniGoogle'
const VALIDITA_MS = 12 * 60 * 60 * 1000
const CAMPI = 'id,displayName,rating,userRatingCount,reviews'

type Recensione = { name: string; avatar: string; rating: number; text: string; date: string; time: number }
type Recensioni = { placeId: string; placeName: string; rating: number; totalRatings: number; updatedAt: string; reviews: Recensione[] }

// Token del service account di runtime (metadata server di Cloud Run)
async function tokenRuntime(): Promise<string> {
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' },
  })
  if (!r.ok) throw new Error(`metadata token ${r.status}`)
  return String(((await r.json()) as { access_token?: string }).access_token || '')
}

async function leggiDaGoogle(): Promise<Recensioni> {
  const r = await fetch(`https://places.googleapis.com/v1/places/${PLACE_ID}?languageCode=it`, {
    headers: { Authorization: `Bearer ${await tokenRuntime()}`, 'X-Goog-FieldMask': CAMPI },
  })
  if (!r.ok) throw new Error(`Places API ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const p = (await r.json()) as any
  const rating = Number(p.rating), totalRatings = Number(p.userRatingCount)
  if (!(rating >= 1 && rating <= 5) || !(totalRatings > 0)) throw new Error('Places API: voto o numero recensioni mancanti')
  const reviews: Recensione[] = (Array.isArray(p.reviews) ? p.reviews : []).map((v: any) => ({
    name: String(v.authorAttribution?.displayName || ''),
    avatar: String(v.authorAttribution?.photoUri || ''),
    rating: Number(v.rating) || 0,
    text: String(v.text?.text || v.originalText?.text || '').trim(),
    date: String(v.relativePublishTimeDescription || ''),
    time: Math.floor(new Date(v.publishTime || 0).getTime() / 1000) || 0,
  })).filter((v: Recensione) => v.name && v.text && v.rating >= 4)
  return { placeId: PLACE_ID, placeName: String(p.displayName?.text || 'Wash Hub - Lungomare'), rating, totalRatings, updatedAt: new Date().toISOString(), reviews }
}

export const recensioniGoogle = onRequest({ region: REGION, cors: false, maxInstances: 2 }, async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'solo GET' }); return }
  const ref = getFirestore().doc(DOC)
  const salvato = (await ref.get()).data() as (Recensioni & { letto?: number }) | undefined
  let dati = salvato
  if (!salvato || Date.now() - (salvato.letto || 0) > VALIDITA_MS) {
    try {
      const nuovi = await leggiDaGoogle()
      await ref.set({ ...nuovi, letto: Date.now() })
      dati = nuovi
    } catch (e) {
      console.error('recensioniGoogle: lettura da Google fallita', e)
      // Riprova tra un'ora, non a ogni richiesta
      if (salvato) await ref.set({ letto: Date.now() - VALIDITA_MS + 60 * 60 * 1000 }, { merge: true })
    }
  }
  if (!dati) { res.status(503).json({ error: 'recensioni non disponibili' }); return }
  const { placeId, placeName, rating, totalRatings, updatedAt, reviews } = dati
  res.set('Cache-Control', 'public, max-age=3600')
  res.json({ placeId, placeName, rating, totalRatings, updatedAt, reviews })
})
