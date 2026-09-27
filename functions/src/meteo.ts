import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

// ═══════════════════════════════════════════════════════════════════
// METEO → SEMAFORO GIORNATA (Guido, 27/09/2026)
//
// Un autolavaggio con la pioggia chiude o lavora ridotto. Ogni sera alle 22:30 la
// previsione Open-Meteo del giorno dopo (fascia di apertura) diventa un semaforo per
// sede, salvato in `meteoGiornata/{sede}_{data}` e mandato su Telegram al gruppo
// "Wash Hub Meteo" (Guido + Skippa). Alle 06:00 ricontrollo: avviso solo se il livello
// cambia. Alle 21:05 verifica: pioggia reale + incasso Prima Nota della giornata, per
// tarare le soglie. FASE DI TARATURA: nessun blocco prenotazioni, nessun messaggio ai
// dipendenti (config.telegram.inviaDipendenti=false) finché Guido non decide.
//
// Soglie iniziali dai dati Lungomare ago 2025–set 2026 (343 giorni feriali, incasso
// relativo alla mediana asciutta dello stesso giorno della settimana):
//   asciutto 96% · 0.1–2 mm 79% · 2–8 mm 28% · >8 mm 15%
//   ore pioggia 1–3 79% · 4–7 57% · ≥8 14% · asciutto ma domani >2 mm 80%
// ═══════════════════════════════════════════════════════════════════

const REGION = 'europe-west1'
const TZ = 'Europe/Rome'
const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN')

type Livello = 'VERDE' | 'GIALLO' | 'ARANCIO' | 'ROSSO'
const EMOJI: Record<Livello, string> = { VERDE: '🟢', GIALLO: '🟡', ARANCIO: '🟠', ROSSO: '🔴' }
const LABEL: Record<Livello, string> = { VERDE: 'NORMALE', GIALLO: 'RIDOTTO LEGGERO', ARANCIO: 'RIDOTTO', ROSSO: 'CHIUSO' }

interface SedeCfg { nome: string; lat: number; lon: number; attivo: boolean }
interface Cfg {
  sedi: Record<string, SedeCfg>
  oraApertura: number; oraChiusura: number
  soglie: { rosso: { mm: number; ore: number }; arancio: { mm: number; ore: number }; giallo: { mm: number; ore: number; nuvole: number; dopoMm: number } }
  telegram: { chatProposta: string; chatDipendenti: string; inviaDipendenti: boolean }
}
const CFG_DEFAULT: Cfg = {
  sedi: {
    lungomare: { nome: 'Lungomare', lat: 37.5275, lon: 15.1145, attivo: true },
    'paesi-etnei': { nome: 'Paesi Etnei', lat: 37.57, lon: 15.08, attivo: false },   // coordinate da confermare (indirizzo sede)
  },
  oraApertura: 7, oraChiusura: 19,
  soglie: { rosso: { mm: 8, ore: 8 }, arancio: { mm: 2, ore: 4 }, giallo: { mm: 0.1, ore: 1, nuvole: 70, dopoMm: 2 } },
  telegram: { chatProposta: '', chatDipendenti: '', inviaDipendenti: false },
}

async function getCfg(): Promise<Cfg> {
  const db = getFirestore()
  const ref = db.doc('config/meteo')
  const snap = await ref.get()
  if (!snap.exists) { await ref.set(CFG_DEFAULT); return CFG_DEFAULT }
  const d = snap.data() as Partial<Cfg>
  return { ...CFG_DEFAULT, ...d, sedi: { ...CFG_DEFAULT.sedi, ...(d.sedi || {}) }, soglie: { ...CFG_DEFAULT.soglie, ...(d.soglie || {}) }, telegram: { ...CFG_DEFAULT.telegram, ...(d.telegram || {}) } }
}

const giornoRome = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: TZ })
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
const fmtData = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); return `${GIORNI[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}` }
const isDomenica = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay() === 0

interface Ora { h: number; mm: number; prob: number; nuvole: number; wc: number; temp: number; vento: number }
interface Sintesi {
  data: string; mm: number; ore: number; probMax: number; probMedia: number; nuvole: number; tmax: number; ventoMax: number
  mmGiorno: number; dopoMm: number; dopoOre: number; orePioggia: number[]; orario: Ora[]; wcPrevalente: number
}

// Previsione (o reale con past_days) via Open-Meteo, aggregata sulla fascia di apertura di `data`
async function openMeteo(sede: SedeCfg, cfg: Cfg, data: string, reale = false): Promise<Sintesi> {
  const p = new URLSearchParams({
    latitude: String(sede.lat), longitude: String(sede.lon), timezone: TZ,
    hourly: 'precipitation,precipitation_probability,cloud_cover,weather_code,temperature_2m,wind_speed_10m',
    ...(reale ? { past_days: '2', forecast_days: '1' } : { forecast_days: '4' }),
  })
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`)
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`)
  const j: any = await r.json()
  const H = j.hourly
  const idx = (iso: string) => H.time.map((t: string, i: number) => [t, i]).filter(([t]: [string, number]) => t.startsWith(iso)).map(([, i]: [string, number]) => i)
  const ore = idx(data).filter((i: number) => { const h = Number(H.time[i].slice(11, 13)); return h >= cfg.oraApertura && h < cfg.oraChiusura })
  const orario: Ora[] = ore.map((i: number) => ({ h: Number(H.time[i].slice(11, 13)), mm: H.precipitation[i] ?? 0, prob: H.precipitation_probability?.[i] ?? 0, nuvole: H.cloud_cover[i] ?? 0, wc: H.weather_code[i] ?? 0, temp: H.temperature_2m[i] ?? 0, vento: H.wind_speed_10m[i] ?? 0 }))
  const r1 = (n: number) => Math.round(n * 10) / 10
  const dopo = new Date(data + 'T12:00:00Z'); dopo.setUTCDate(dopo.getUTCDate() + 1)
  const dopoIdx = idx(dopo.toISOString().slice(0, 10))
  const wcCount: Record<number, number> = {}; orario.forEach(o => { wcCount[o.wc] = (wcCount[o.wc] || 0) + 1 })
  return {
    data,
    mm: r1(orario.reduce((s, o) => s + o.mm, 0)),
    ore: orario.filter(o => o.mm >= 0.1).length,
    probMax: Math.max(0, ...orario.map(o => o.prob)),
    probMedia: Math.round(orario.reduce((s, o) => s + o.prob, 0) / (orario.length || 1)),
    nuvole: Math.round(orario.reduce((s, o) => s + o.nuvole, 0) / (orario.length || 1)),
    tmax: Math.round(Math.max(-99, ...orario.map(o => o.temp))),
    ventoMax: Math.round(Math.max(0, ...orario.map(o => o.vento))),
    mmGiorno: r1(idx(data).reduce((s: number, i: number) => s + (H.precipitation[i] ?? 0), 0)),
    dopoMm: r1(dopoIdx.reduce((s: number, i: number) => s + (H.precipitation[i] ?? 0), 0)),
    dopoOre: dopoIdx.filter((i: number) => (H.precipitation[i] ?? 0) >= 0.1).length,
    orePioggia: orario.filter(o => o.mm >= 0.1).map(o => o.h),
    orario,
    wcPrevalente: Number(Object.entries(wcCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0),
  }
}

function livello(s: Sintesi, cfg: Cfg): { livello: Livello; motivo: string } {
  const S = cfg.soglie
  const mm = Math.max(s.mm, s.mmGiorno * 0.8)   // pioggia notturna forte pesa comunque (strade bagnate, clienti che non vengono)
  if (mm >= S.rosso.mm || s.ore >= S.rosso.ore) return { livello: 'ROSSO', motivo: `pioggia ${s.mm} mm in ${s.ore} ore di apertura (${s.mmGiorno} mm nelle 24h)` }
  if (mm >= S.arancio.mm || s.ore >= S.arancio.ore) return { livello: 'ARANCIO', motivo: `pioggia ${s.mm} mm in ${s.ore} ore (${s.mmGiorno} mm nelle 24h)` }
  if (s.mm >= S.giallo.mm || s.ore >= S.giallo.ore) return { livello: 'GIALLO', motivo: `pioggia debole ${s.mm} mm (${s.ore} h)` }
  if (s.nuvole >= S.giallo.nuvole) return { livello: 'GIALLO', motivo: `molto nuvoloso (${s.nuvole}%)` }
  if (s.dopoMm >= S.giallo.dopoMm) return { livello: 'GIALLO', motivo: `asciutto ma dopodomani pioggia ${s.dopoMm} mm` }
  return { livello: 'VERDE', motivo: `asciutto, nuvole ${s.nuvole}%` }
}

const WC: Record<number, string> = { 0: 'sereno', 1: 'poco nuvoloso', 2: 'nuvoloso', 3: 'coperto', 45: 'nebbia', 48: 'nebbia', 51: 'pioviggine', 53: 'pioviggine', 55: 'pioviggine', 61: 'pioggia debole', 63: 'pioggia', 65: 'pioggia forte', 80: 'rovesci', 81: 'rovesci', 82: 'rovesci forti', 95: 'temporale', 96: 'temporale', 99: 'temporale' }

function messaggio(sedeNome: string, s: Sintesi, lv: { livello: Livello; motivo: string }, tipo: 'sera' | 'mattina', cfg: Cfg, precedente?: Livello): string {
  const ore = s.orePioggia.length ? s.orePioggia.map(h => String(h).padStart(2, '0')).join(' ') : 'nessuna'
  const incerto = s.mm >= 0.1 && s.probMax < 50 ? '\n⚠️ probabilità bassa: previsione incerta' : ''
  const cambio = precedente && precedente !== lv.livello ? `\n↪️ ieri sera era ${EMOJI[precedente]} ${LABEL[precedente]}` : ''
  return `${EMOJI[lv.livello]} <b>${tipo === 'sera' ? 'DOMANI' : 'OGGI'} ${fmtData(s.data)} · ${sedeNome} — ${LABEL[lv.livello]}</b>${cambio}
${lv.motivo}
Fascia ${String(cfg.oraApertura).padStart(2, '0')}–${cfg.oraChiusura}: ${WC[s.wcPrevalente] || 'variabile'}, prob. max ${s.probMax}%, nuvole ${s.nuvole}%, max ${s.tmax}°, vento ${s.ventoMax} km/h
Ore con pioggia: ${ore}
Dopodomani: ${s.dopoMm} mm${incerto}
<i>Previsione automatica in taratura, non è una decisione.</i>`
}

// chatId: uno o più id separati da virgola (chat private di Guido e Skippa, o un gruppo)
async function telegram(chatId: string, text: string) {
  const token = TELEGRAM_BOT_TOKEN.value()
  const ids = String(chatId || '').split(',').map(x => x.trim()).filter(Boolean)
  if (!token || token.length < 20 || !ids.length) { console.warn('Telegram non configurato: messaggio non inviato'); return false }
  let ok = false
  for (const id of ids) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true }) })
    if (!r.ok) console.error('Telegram', id, r.status, (await r.text()).slice(0, 200)); else ok = true
  }
  return ok
}

async function previsione(tipo: 'sera' | 'mattina') {
  const db = getFirestore()
  const cfg = await getCfg()
  const data = giornoRome(tipo === 'sera' ? 1 : 0)
  if (isDomenica(data)) { console.log('domenica: chiuso, niente semaforo'); return }
  for (const [sedeId, sede] of Object.entries(cfg.sedi)) {
    if (!sede.attivo) continue
    try {
      const s = await openMeteo(sede, cfg, data)
      const lv = livello(s, cfg)
      const ref = db.doc(`meteoGiornata/${sedeId}_${data}`)
      const prev = (await ref.get()).data()
      const precedente: Livello | undefined = prev?.livello
      await ref.set({
        ...s, sedeId, tipo, livello: lv.livello, motivo: lv.motivo,
        aggiornatoTs: Date.now(), ...(tipo === 'sera' || !prev ? { livelloSera: lv.livello, seraTs: Date.now() } : { livelloMattina: lv.livello, mattinaTs: Date.now() }),
        storia: FieldValue.arrayUnion({ tipo, ts: Date.now(), livello: lv.livello, mm: s.mm, ore: s.ore, probMax: s.probMax }),
      }, { merge: true })
      console.log(`${tipo} ${sedeId} ${data}: ${lv.livello} — ${lv.motivo}`)
      const manda = tipo === 'sera' || !precedente || precedente !== lv.livello
      if (manda) {
        const ok = await telegram(cfg.telegram.chatProposta, messaggio(sede.nome, s, lv, tipo, cfg, tipo === 'mattina' ? precedente : undefined))
        await ref.set({ [`telegram${tipo === 'sera' ? 'Sera' : 'Mattina'}`]: ok ? Date.now() : null }, { merge: true })
      }
    } catch (e: any) { console.error(`meteo ${tipo} ${sedeId}:`, e.message) }
  }
}

export const meteoSera = onSchedule({ schedule: '30 22 * * *', timeZone: TZ, region: REGION, secrets: [TELEGRAM_BOT_TOKEN] }, () => previsione('sera'))
export const meteoMattina = onSchedule({ schedule: '0 6 * * *', timeZone: TZ, region: REGION, secrets: [TELEGRAM_BOT_TOKEN] }, () => previsione('mattina'))

// 21:05 (dopo la chiusura contabile): com'è andata davvero? pioggia reale + incasso → taratura
export const meteoVerifica = onSchedule({ schedule: '5 21 * * *', timeZone: TZ, region: REGION }, async () => {
  const db = getFirestore()
  const cfg = await getCfg()
  const data = giornoRome(0)
  for (const [sedeId, sede] of Object.entries(cfg.sedi)) {
    if (!sede.attivo) continue
    try {
      const reale = await openMeteo(sede, cfg, data, true)
      const lvReale = livello(reale, cfg)
      const pn = await db.collection('primaNota').where('sedeId', '==', sedeId).where('dataISO', '==', data).get()
      let incasso = 0; pn.forEach(d => { incasso += Number(d.data().ENTRATA ?? d.data().Entrata ?? 0) || 0 })
      const ref = db.doc(`meteoGiornata/${sedeId}_${data}`)
      const prev = (await ref.get()).data()
      await ref.set({
        sedeId, data, reale: { mm: reale.mm, ore: reale.ore, mmGiorno: reale.mmGiorno, nuvole: reale.nuvole, livello: lvReale.livello, orePioggia: reale.orePioggia },
        incasso: Math.round(incasso * 100) / 100, verificaTs: Date.now(),
        esito: prev?.livelloSera ? (prev.livelloSera === lvReale.livello ? 'ok' : 'diverso') : 'nessuna_previsione',
      }, { merge: true })
      console.log(`verifica ${sedeId} ${data}: previsto ${prev?.livelloSera || '-'} reale ${lvReale.livello} incasso €${incasso}`)
    } catch (e: any) { console.error(`meteo verifica ${sedeId}:`, e.message) }
  }
})

// Dash: ultimi giorni + domani (lettura via callable: nessuna modifica alle rules)
export const meteoApi = onCall({ region: REGION, secrets: [TELEGRAM_BOT_TOKEN] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'login richiesto')
  const db = getFirestore()
  const { action, sedeId = 'lungomare', giorni = 14 } = (request.data || {}) as { action: string; sedeId?: string; giorni?: number }
  if (action === 'ultimi') {
    const da = giornoRome(-Math.min(60, Number(giorni) || 14))
    const snap = await db.collection('meteoGiornata').where('sedeId', '==', sedeId).where('data', '>=', da).orderBy('data', 'desc').get()
    return { giorni: snap.docs.map(d => { const x = d.data(); return { data: x.data, livello: x.livello, livelloSera: x.livelloSera, livelloMattina: x.livelloMattina, motivo: x.motivo, mm: x.mm, ore: x.ore, probMax: x.probMax, nuvole: x.nuvole, tmax: x.tmax, orePioggia: x.orePioggia, dopoMm: x.dopoMm, reale: x.reale || null, incasso: x.incasso ?? null, esito: x.esito || null, aggiornatoTs: x.aggiornatoTs } }) }
  }
  if (action === 'config') return await getCfg()
  if (action === 'testOra') {   // admin: forza la previsione di stasera adesso (taratura)
    await previsione('sera'); return { ok: true }
  }
  throw new HttpsError('invalid-argument', 'azione sconosciuta')
})
