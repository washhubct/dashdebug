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
  personale: { min: number; max: number; capacitaPercentile: number; giorniStorico: number; oreTappezzeriaGiorno: number; oreGiornata: number; giorniLavorativiMese: number; fissi: { nome: string; sedeId: string; costoMese: number; dal: string }[] }
}
const CFG_DEFAULT: Cfg = {
  sedi: {
    lungomare: { nome: 'Lungomare', lat: 37.5275, lon: 15.1145, attivo: true },
    'paesi-etnei': { nome: 'Paesi Etnei', lat: 37.5665, lon: 15.1002, attivo: true },   // Via Galileo Galilei 28 (Lukoil), San Giovanni La Punta
  },
  oraApertura: 7, oraChiusura: 19,
  soglie: { rosso: { mm: 8, ore: 8 }, arancio: { mm: 2, ore: 4 }, giallo: { mm: 0.1, ore: 1, nuvole: 70, dopoMm: 2 } },
  telegram: { chatProposta: '', chatDipendenti: '', inviaDipendenti: false },
  // Consiglio personale: capacità = auto/persona all'80° percentile delle giornate asciutte ("quanto lava una persona quando c'è lavoro")
  // Tappezzeria: ogni lavoro in lavorazione occupa una persona ~2.5 h/giorno (stima da tarare: nei dati i giorni con
  // tappezzerie hanno 1 persona in più; ogni lavoro dura 3 giorni mediani)
  // Fissi: dipendenti a stipendio mensile, sempre presenti anche se non registrati nelle presenze giornaliere
  // (Sony, subordinato, €1.700/mese, da settembre 2026 non più nelle presenze). Turno unico: tutti iniziano insieme.
  personale: { min: 2, max: 7, capacitaPercentile: 0.8, giorniStorico: 365, oreTappezzeriaGiorno: 2.5, oreGiornata: 8, giorniLavorativiMese: 26, fissi: [{ nome: 'SONY', sedeId: 'lungomare', costoMese: 1700, dal: '2026-09-01' }] },
}

async function getCfg(): Promise<Cfg> {
  const db = getFirestore()
  const ref = db.doc('config/meteo')
  const snap = await ref.get()
  if (!snap.exists) { await ref.set(CFG_DEFAULT); return CFG_DEFAULT }
  const d = snap.data() as Partial<Cfg>
  return { ...CFG_DEFAULT, ...d, sedi: { ...CFG_DEFAULT.sedi, ...(d.sedi || {}) }, soglie: { ...CFG_DEFAULT.soglie, ...(d.soglie || {}) }, telegram: { ...CFG_DEFAULT.telegram, ...(d.telegram || {}) }, personale: { ...CFG_DEFAULT.personale, ...(d.personale || {}) } }
}

const giornoRome = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: TZ })
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
const fmtData = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); return `${GIORNI[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}` }
const isDomenica = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay() === 0

interface Ora { h: number; mm: number; prob: number | null; nuvole: number; wc: number; temp: number; vento: number }
interface Sintesi {
  data: string; mm: number; ore: number; probMax: number; probMedia: number; nuvole: number; tmax: number; ventoMax: number
  mmGiorno: number; dopoMm: number; dopoOre: number; orePioggia: number[]; orario: Ora[]; wcPrevalente: number
}

// ── Fonti: più modelli indipendenti, mai un solo meteo (Guido 27/09). Tutte gratuite, senza chiave. ──
type FonteId = 'best_match' | 'italia_meteo_arpae_icon_2i' | 'ecmwf_ifs025' | 'icon_seamless' | 'gfs_seamless' | 'meteofrance_seamless' | 'metno'
// 3B Meteo/ilMeteo non hanno API gratuite: ItaliaMeteo ICON-2I (ARPAE, 2 km) è il modello ufficiale italiano.
const FONTI: Record<FonteId, string> = { best_match: 'Open-Meteo', italia_meteo_arpae_icon_2i: 'ItaliaMeteo', ecmwf_ifs025: 'ECMWF', icon_seamless: 'ICON', gfs_seamless: 'GFS', meteofrance_seamless: 'MétéoFr', metno: 'MET.no' }
const OM_MODELS: FonteId[] = ['best_match', 'italia_meteo_arpae_icon_2i', 'ecmwf_ifs025', 'icon_seamless', 'gfs_seamless', 'meteofrance_seamless']

const r1 = (n: number) => Math.round(n * 10) / 10
const mediana = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0 }

function sintesi(data: string, cfg: Cfg, giorno: Ora[], dopo: Ora[]): Sintesi {
  const orario = giorno.filter(o => o.h >= cfg.oraApertura && o.h < cfg.oraChiusura)
  const conProb = orario.filter(o => o.prob != null)
  const wcCount: Record<number, number> = {}; orario.forEach(o => { wcCount[o.wc] = (wcCount[o.wc] || 0) + 1 })
  return {
    data,
    mm: r1(orario.reduce((s, o) => s + o.mm, 0)),
    ore: orario.filter(o => o.mm >= 0.1).length,
    probMax: conProb.length ? Math.max(...conProb.map(o => o.prob as number)) : 0,
    probMedia: conProb.length ? Math.round(conProb.reduce((s, o) => s + (o.prob as number), 0) / conProb.length) : 0,
    nuvole: Math.round(orario.reduce((s, o) => s + o.nuvole, 0) / (orario.length || 1)),
    tmax: Math.round(Math.max(-99, ...orario.map(o => o.temp))),
    ventoMax: Math.round(Math.max(0, ...orario.map(o => o.vento))),
    mmGiorno: r1(giorno.reduce((s, o) => s + o.mm, 0)),
    dopoMm: r1(dopo.reduce((s, o) => s + o.mm, 0)),
    dopoOre: dopo.filter(o => o.mm >= 0.1).length,
    orePioggia: orario.filter(o => o.mm >= 0.1).map(o => o.h),
    orario,
    wcPrevalente: Number(Object.entries(wcCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0),
  }
}

const giornoDopo = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }

// Open-Meteo: un'unica chiamata con più modelli (variabili suffissate _modello). reale=true → analisi dei giorni passati
async function fontiOpenMeteo(sede: SedeCfg, cfg: Cfg, data: string, reale = false): Promise<Partial<Record<FonteId, Sintesi>>> {
  const models = reale ? ['best_match'] : OM_MODELS
  const p = new URLSearchParams({
    latitude: String(sede.lat), longitude: String(sede.lon), timezone: TZ, models: models.join(','),
    hourly: 'precipitation,precipitation_probability,cloud_cover,weather_code,temperature_2m,wind_speed_10m',
    ...(reale ? { past_days: '2', forecast_days: '1' } : { forecast_days: '4' }),
  })
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`)
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`)
  const H: any = ((await r.json()) as any).hourly
  const out: Partial<Record<FonteId, Sintesi>> = {}
  const dopoIso = giornoDopo(data)
  for (const m of models) {
    const v = (name: string, i: number) => { const k = models.length > 1 ? `${name}_${m}` : name; const x = H[k]?.[i]; return x == null ? null : Number(x) }
    const ore = (iso: string): Ora[] => H.time.map((t: string, i: number) => ({ t, i })).filter(({ t }: { t: string }) => t.startsWith(iso))
      .map(({ t, i }: { t: string; i: number }) => ({ h: Number(t.slice(11, 13)), mm: v('precipitation', i) ?? NaN, prob: v('precipitation_probability', i), nuvole: v('cloud_cover', i) ?? 0, wc: v('weather_code', i) ?? 0, temp: v('temperature_2m', i) ?? 0, vento: v('wind_speed_10m', i) ?? 0 }))
    const giorno = ore(data), dopo = ore(dopoIso).filter(o => !isNaN(o.mm))
    if (!giorno.length || giorno.some(o => isNaN(o.mm))) { console.warn(`fonte ${m}: dati incompleti per ${data}`); continue }
    out[m as FonteId] = sintesi(data, cfg, giorno, dopo)
  }
  return out
}

// MET Norway (yr.no): orario per ~48h, poi a blocchi di 6h (spalmati). Orari UTC → ora di Roma.
async function fonteMetNo(sede: SedeCfg, cfg: Cfg, data: string): Promise<Sintesi | null> {
  const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${sede.lat.toFixed(4)}&lon=${sede.lon.toFixed(4)}`, { headers: { 'User-Agent': 'washhub-meteo/1.0 info@washhub.it' } })
  if (!r.ok) throw new Error(`MET.no HTTP ${r.status}`)
  const j: any = await r.json()
  const perOra = new Map<string, Ora>()   // 'YYYY-MM-DDTHH' locale
  const localKey = (d: Date) => { const s = d.toLocaleString('en-CA', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }); return s.replace(', ', 'T').replace(/T24/, 'T00') }
  const SYM: [RegExp, number][] = [[/heavyrain|heavysleet/, 65], [/thunder/, 95], [/lightrain|lightsleet|drizzle/, 61], [/rain|sleet|snow/, 63], [/fog/, 45], [/cloudy/, 3], [/partlycloudy/, 2], [/fair/, 1], [/clearsky/, 0]]
  for (const ts of j.properties?.timeseries || []) {
    const t0 = new Date(ts.time), inst = ts.data?.instant?.details || {}
    const blocco = ts.data?.next_1_hours ? { n: 1, d: ts.data.next_1_hours } : ts.data?.next_6_hours ? { n: 6, d: ts.data.next_6_hours } : null
    if (!blocco) continue
    const sym = String(blocco.d.summary?.symbol_code || '')
    const wc = SYM.find(([re]) => re.test(sym))?.[1] ?? 2
    for (let k = 0; k < blocco.n; k++) {
      const d = new Date(t0.getTime() + k * 3600e3), key = localKey(d)
      if (perOra.has(key) && blocco.n > 1) continue   // non sovrascrivere un dato orario con uno spalmato
      perOra.set(key, { h: Number(key.slice(11, 13)), mm: (Number(blocco.d.details?.precipitation_amount) || 0) / blocco.n, prob: blocco.d.details?.probability_of_precipitation ?? null, nuvole: Number(inst.cloud_area_fraction) || 0, wc, temp: Number(inst.air_temperature) || 0, vento: Math.round((Number(inst.wind_speed) || 0) * 3.6) })
    }
  }
  const ore = (iso: string) => [...perOra.entries()].filter(([k]) => k.startsWith(iso)).map(([, o]) => o).sort((a, b) => a.h - b.h)
  const giorno = ore(data)
  if (giorno.length < 20) { console.warn(`MET.no: solo ${giorno.length} ore per ${data}`); return null }
  return sintesi(data, cfg, giorno, ore(giornoDopo(data)))
}

interface Previsione { ensemble: Sintesi; fonti: Partial<Record<FonteId, Sintesi>> }
async function previsioneMultiFonte(sede: SedeCfg, cfg: Cfg, data: string): Promise<Previsione> {
  const fonti: Partial<Record<FonteId, Sintesi>> = {}
  const [om, met] = await Promise.allSettled([fontiOpenMeteo(sede, cfg, data), fonteMetNo(sede, cfg, data)])
  if (om.status === 'fulfilled') Object.assign(fonti, om.value); else console.error('Open-Meteo:', om.reason?.message)
  if (met.status === 'fulfilled' && met.value) fonti.metno = met.value; else if (met.status === 'rejected') console.error('MET.no:', met.reason?.message)
  const list = Object.values(fonti) as Sintesi[]
  if (!list.length) throw new Error('nessuna fonte meteo disponibile')
  // Ensemble = mediana delle fonti; ore di pioggia = ore in cui almeno metà delle fonti prevede pioggia
  const ore = Array.from({ length: cfg.oraChiusura - cfg.oraApertura }, (_, i) => cfg.oraApertura + i)
  const orePioggia = ore.filter(h => list.filter(s => s.orePioggia.includes(h)).length * 2 >= list.length)
  const base = fonti.best_match || list[0]
  const ensemble: Sintesi = {
    data, mm: r1(mediana(list.map(s => s.mm))), ore: Math.round(mediana(list.map(s => s.ore))),
    probMax: Math.max(...list.map(s => s.probMax)), probMedia: Math.round(mediana(list.map(s => s.probMedia))),
    nuvole: Math.round(mediana(list.map(s => s.nuvole))), tmax: Math.round(mediana(list.map(s => s.tmax))), ventoMax: Math.round(mediana(list.map(s => s.ventoMax))),
    mmGiorno: r1(mediana(list.map(s => s.mmGiorno))), dopoMm: r1(mediana(list.map(s => s.dopoMm))), dopoOre: Math.round(mediana(list.map(s => s.dopoOre))),
    orePioggia, orario: base.orario, wcPrevalente: base.wcPrevalente,
  }
  return { ensemble, fonti }
}

// Pioggia reale (analisi Open-Meteo dei giorni passati)
async function realeOpenMeteo(sede: SedeCfg, cfg: Cfg, data: string): Promise<Sintesi> {
  const f = await fontiOpenMeteo(sede, cfg, data, true)
  if (!f.best_match) throw new Error('reale non disponibile')
  return f.best_match
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

// Solo le fonti che NON sono d'accordo con il semaforo (Guido: troppi bollini)
function rigaFonti(fonti: Partial<Record<FonteId, Sintesi>>, cfg: Cfg, lv: Livello): string {
  const diverse = (Object.keys(FONTI) as FonteId[]).filter(k => fonti[k] && livello(fonti[k] as Sintesi, cfg).livello !== lv)
  return diverse.length ? 'dissenso: ' + diverse.map(k => { const f = fonti[k] as Sintesi; return `${FONTI[k]} ${EMOJI[livello(f, cfg).livello]} ${f.mm}mm/${f.ore}h` }).join(', ') : 'tutte d\'accordo'
}

// ── Quante persone domani? auto attese (storico stesso giorno della settimana × stesso livello meteo, con le
// prenotazioni già in calendario come minimo) diviso quante auto lava una persona. Impara ogni sera dalla verifica.
interface Consiglio { personale: number; fissi: number; attese: number; prenotate: number; capacita: number; base: string; nota: string | null; tappezzerie: number; caricoTappezzeria: number }
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0 }
async function consiglioPersonale(sedeId: string, data: string, lv: Livello, cfg: Cfg): Promise<Consiglio | null> {
  const db = getFirestore()
  const da = new Date(data + 'T12:00:00Z'); da.setUTCDate(da.getUTCDate() - cfg.personale.giorniStorico)
  // Solo filtro su sedeId (niente indice composito): le date si filtrano in memoria, sono poche centinaia di doc per sede
  const daIso = da.toISOString().slice(0, 10)
  const snap = await db.collection('meteoGiornata').where('sedeId', '==', sedeId).get()
  const rows = snap.docs.map(d => d.data()).filter(x => x.data >= daIso && x.data < data && x.reale && ((x.presenze?.dipendenti > 0) || x.incasso > 0))
  const conAuto = rows.filter(x => Number(x.auto) > 0)
  if (conAuto.length < 30) return null   // sede senza storico prenotazioni (Paesi Etnei self-service)
  const wd = new Date(data + 'T12:00:00Z').getUTCDay()
  const wdOf = (x: any) => new Date(x.data + 'T12:00:00Z').getUTCDay()
  const verdi = conAuto.filter(x => x.reale.livello === 'VERDE' && x.presenze?.dipendenti > 0)
  const capacita = Math.max(3, pct(verdi.map(x => Number(x.auto) / x.presenze.dipendenti), cfg.personale.capacitaPercentile) || 6)
  const stessoGiorno = conAuto.filter(x => x.reale.livello === lv && wdOf(x) === wd).map(x => Number(x.auto))
  let attese: number, base: string
  if (stessoGiorno.length >= 6) { attese = pct(stessoGiorno, 0.5); base = `${stessoGiorno.length} ${GIORNI[wd]} ${LABEL[lv].toLowerCase()}` }
  else {
    const livelloTutti = conAuto.filter(x => x.reale.livello === lv).map(x => Number(x.auto))
    const verdiWd = verdi.filter(x => wdOf(x) === wd).map(x => Number(x.auto)), verdiAll = verdi.map(x => Number(x.auto))
    const fattoreWd = verdiWd.length >= 5 && pct(verdiAll, 0.5) ? pct(verdiWd, 0.5) / pct(verdiAll, 0.5) : 1
    attese = Math.round((pct(livelloTutti, 0.5) || 0) * fattoreWd); base = `${livelloTutti.length} giorni ${LABEL[lv].toLowerCase()} × ${GIORNI[wd]}`
  }
  const prenSnap = await db.collection('prenotazioni').where('dataPren', '==', data).get()
  const prenotate = prenSnap.docs.filter(d => (d.data().sedeId || 'lungomare') === sedeId).length
  attese = Math.max(attese, prenotate)
  // Tappezzerie in lavorazione (status IN nella dash): carico in persone-giorno
  const tapSnap = await db.collection('tappezzeria').where('status', '==', 'IN').get()
  const tappezzerie = tapSnap.docs.filter(d => (d.data().sedeId || 'lungomare') === sedeId).length
  const caricoTappezzeria = Math.round(tappezzerie * cfg.personale.oreTappezzeriaGiorno / cfg.personale.oreGiornata * 10) / 10
  let personale = Math.min(cfg.personale.max, Math.max(cfg.personale.min, Math.ceil(attese / capacita + caricoTappezzeria)))
  let nota: string | null = null
  if (lv === 'ROSSO') { personale = Math.min(personale, Math.max(cfg.personale.min, Math.ceil(caricoTappezzeria))); nota = 'valutare chiusura' + (tappezzerie ? ', le tappezzerie si lavorano al coperto' : '') }
  const fissi = cfg.personale.fissi.filter(f => f.sedeId === sedeId && data >= f.dal).length
  personale = Math.max(personale, fissi)
  return { personale, fissi, attese, prenotate, capacita: Math.round(capacita * 10) / 10, base, nota, tappezzerie, caricoTappezzeria }
}

function bloccoSede(sedeNome: string, s: Sintesi, lv: { livello: Livello; motivo: string }, cfg: Cfg, fonti: Partial<Record<FonteId, Sintesi>>, consiglio: Consiglio | null, precedente?: Livello): string {
  const ore = s.orePioggia.length ? s.orePioggia.map(h => String(h).padStart(2, '0')).join(' ') : 'nessuna'
  const n = Object.keys(fonti).length, accordo = Object.values(fonti).filter(f => livello(f as Sintesi, cfg).livello === lv.livello).length
  const incerto = s.mm >= 0.1 && s.probMax < 50 ? '\n⚠️ probabilità bassa: previsione incerta' : ''
  const cambio = precedente && precedente !== lv.livello ? ` (ieri sera ${EMOJI[precedente]})` : ''
  return `${EMOJI[lv.livello]} <b>${sedeNome} — ${LABEL[lv.livello]}</b>${cambio}
${lv.motivo}
${WC[s.wcPrevalente] || 'variabile'}, prob. max ${s.probMax}%, nuvole ${s.nuvole}%, max ${s.tmax}°, vento ${s.ventoMax} km/h
Ore con pioggia: ${ore} · dopodomani ${s.dopoMm} mm${incerto}
Fonti ${accordo}/${n} · ${rigaFonti(fonti, cfg, lv.livello)}${consiglio ? `
👥 <b>Personale consigliato: ${consiglio.personale}</b>${consiglio.fissi ? ` (${consiglio.fissi} fiss${consiglio.fissi === 1 ? 'o' : 'i'} + ${consiglio.personale - consiglio.fissi} a giornata)` : ''} · attese ~${consiglio.attese} auto (${consiglio.prenotate} già prenotate) · ~${consiglio.capacita} auto a persona${consiglio.tappezzerie ? ` · ${consiglio.tappezzerie} tappezzeri${consiglio.tappezzerie === 1 ? 'a' : 'e'} in lavorazione (+${String(consiglio.caricoTappezzeria).replace('.', ',')} persona)` : ''}${consiglio.nota ? ` · ${consiglio.nota}` : ''}` : ''}`
}

function messaggioUnico(data: string, tipo: 'sera' | 'mattina', cfg: Cfg, blocchi: string[], nFonti: number): string {
  return `<b>${tipo === 'sera' ? 'DOMANI' : 'OGGI'} ${fmtData(data)}</b> · fascia ${String(cfg.oraApertura).padStart(2, '0')}–${cfg.oraChiusura}

${blocchi.join('\n\n')}

<i>Mediana di ${nFonti} modelli. Previsione automatica in taratura, non è una decisione.</i>`
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
  const blocchi: string[] = [], refs: FirebaseFirestore.DocumentReference[] = []
  let cambiato = false, nFonti = 0
  for (const [sedeId, sede] of Object.entries(cfg.sedi)) {
    if (!sede.attivo) continue
    try {
      const { ensemble: s, fonti } = await previsioneMultiFonte(sede, cfg, data)
      const lv = livello(s, cfg)
      const ref = db.doc(`meteoGiornata/${sedeId}_${data}`)
      const prev = (await ref.get()).data()
      const precedente: Livello | undefined = prev?.livello
      const fontiDoc: Record<string, unknown> = {}
      for (const [k, f] of Object.entries(fonti) as [FonteId, Sintesi][]) fontiDoc[k] = { nome: FONTI[k], mm: f.mm, ore: f.ore, nuvole: f.nuvole, probMax: f.probMax, mmGiorno: f.mmGiorno, dopoMm: f.dopoMm, orePioggia: f.orePioggia, livello: livello(f, cfg).livello }
      await ref.set({
        ...s, sedeId, tipo, livello: lv.livello, motivo: lv.motivo, nFonti: Object.keys(fonti).length,
        ...(tipo === 'sera' ? { fontiSera: fontiDoc } : { fontiMattina: fontiDoc }),
        aggiornatoTs: Date.now(), ...(tipo === 'sera' || !prev ? { livelloSera: lv.livello, seraTs: Date.now() } : { livelloMattina: lv.livello, mattinaTs: Date.now() }),
        storia: FieldValue.arrayUnion({ tipo, ts: Date.now(), livello: lv.livello, mm: s.mm, ore: s.ore, probMax: s.probMax }),
      }, { merge: true })
      let consiglio: Consiglio | null = null
      try { consiglio = await consiglioPersonale(sedeId, data, lv.livello, cfg) } catch (e: any) { console.warn('consiglio personale:', e.message) }
      if (consiglio) await ref.set({ consiglio: { ...consiglio, tipo, ts: Date.now() } }, { merge: true })
      console.log(`${tipo} ${sedeId} ${data}: ${lv.livello} — ${lv.motivo} (${Object.keys(fonti).length} fonti)${consiglio ? ` · personale ${consiglio.personale} per ~${consiglio.attese} auto` : ''}`)
      if (!precedente || precedente !== lv.livello) cambiato = true
      nFonti = Math.max(nFonti, Object.keys(fonti).length)
      blocchi.push(bloccoSede(sede.nome, s, lv, cfg, fonti, consiglio, tipo === 'mattina' ? precedente : undefined))
      refs.push(ref)
    } catch (e: any) { console.error(`meteo ${tipo} ${sedeId}:`, e.message) }
  }
  // UN SOLO messaggio nel gruppo (Guido 27/09): la sera sempre, la mattina solo se almeno una sede cambia livello
  if (blocchi.length && (tipo === 'sera' || cambiato)) {
    const ok = await telegram(cfg.telegram.chatProposta, messaggioUnico(data, tipo, cfg, blocchi, nFonti))
    for (const ref of refs) await ref.set({ [`telegram${tipo === 'sera' ? 'Sera' : 'Mattina'}`]: ok ? Date.now() : null }, { merge: true })
  }
}

export const meteoSera = onSchedule({ schedule: '30 22 * * *', timeZone: TZ, region: REGION, secrets: [TELEGRAM_BOT_TOKEN] }, () => previsione('sera'))
export const meteoMattina = onSchedule({ schedule: '0 6 * * *', timeZone: TZ, region: REGION, secrets: [TELEGRAM_BOT_TOKEN] }, () => previsione('mattina'))

// Incasso del giorno da Prima Nota, spaccato per categoria (stessa logica di scripts/backfill-meteo-storico.mjs)
export function incassoDaPN(rows: any[]) {
  const r = { totale: 0, lavaggi: 0, parcheggio: 0, altro: 0 }
  for (const x of rows) {
    const e = Number(x.ENTRATA ?? x.Entrata ?? 0) || 0
    if (!e) continue
    const cat = String(x.Categoria || x['CENTRO DI COSTO'] || '').toUpperCase()
    r.totale += e
    if (/LAVAGG|TAPPEZZ/.test(cat)) r.lavaggi += e
    else if (/PARCHEGG|ABBONAM|GIORNAL/.test(cat)) r.parcheggio += e
    else r.altro += e
  }
  for (const k of Object.keys(r) as (keyof typeof r)[]) r[k] = Math.round(r[k] * 100) / 100
  return r
}

// Presenze del giorno: doc presenzeDipendenti {dettaglio: {NOME: costo}, costoTotale}. Dipendente presente = costo > 0
export function presenzeDaDocs(docs: any[], cfg?: Cfg, sedeId?: string, data?: string) {
  const nomi: string[] = []; let costo = 0
  for (const d of docs) {
    for (const [nome, c] of Object.entries(d.dettaglio || {})) if (Number(c) > 0 && !nomi.includes(nome)) nomi.push(nome)
    costo += Number(d.costoTotale) || 0
  }
  // Fissi a stipendio: presenti sempre, costo = quota giornaliera del mensile
  const fissi: string[] = []
  for (const f of cfg?.personale.fissi || []) {
    if (f.sedeId !== sedeId || !data || data < f.dal) continue
    if (!nomi.includes(f.nome)) nomi.push(f.nome)
    fissi.push(f.nome)
    costo += f.costoMese / (cfg?.personale.giorniLavorativiMese || 26)
  }
  return { dipendenti: nomi.length, nomi, fissi, costo: Math.round(costo * 100) / 100 }
}

// 21:05 (dopo la chiusura contabile): com'è andata davvero? pioggia reale + incasso + presenze → taratura
export const meteoVerifica = onSchedule({ schedule: '5 21 * * *', timeZone: TZ, region: REGION }, async () => {
  const db = getFirestore()
  const cfg = await getCfg()
  const data = giornoRome(0)
  for (const [sedeId, sede] of Object.entries(cfg.sedi)) {
    if (!sede.attivo) continue
    try {
      const reale = await realeOpenMeteo(sede, cfg, data)
      const lvReale = livello(reale, cfg)
      const [pn, pres, prenSnap] = await Promise.all([
        db.collection('primaNota').where('sedeId', '==', sedeId).where('dataISO', '==', data).get(),
        db.collection('presenzeDipendenti').where('sedeId', '==', sedeId).where('dataISO', '==', data).get(),
        db.collection('prenotazioni').where('dataPren', '==', data).get(),
      ])
      const prenSede = prenSnap.docs.map(d => d.data()).filter(p => (p.sedeId || 'lungomare') === sedeId)
      const auto = prenSede.length
      const oreAuto = [...new Set(prenSede.map(p => Number(String(p.orario || '').slice(0, 2))).filter(h => h >= 0))].sort((a, b) => a - b)
      const oreVuote = oreAuto.length ? Array.from({ length: cfg.oraChiusura - cfg.oraApertura }, (_, i) => cfg.oraApertura + i).filter(h => !oreAuto.includes(h) && h !== 13) : []
      const profilo = { primaAuto: oreAuto[0] ?? null, ultimaAuto: oreAuto.at(-1) ?? null, oreVuote }
      const dataIta = data.split('-').reverse().join('/')
      const tapSnap = await db.collection('tappezzeria').get()
      const tapDocs = tapSnap.docs.map(d => d.data()).filter(t => (t.sedeId || 'lungomare') === sedeId)
      const toIso = (ita: string) => { const [g, m, a] = String(ita || '').split('/'); return a ? `${a}-${m}-${g}` : '' }
      const tappezzerie = { consegnate: tapDocs.filter(t => t.status === 'OUT' && t.dataOut === dataIta).length, inLavorazione: tapDocs.filter(t => toIso(t.dataIn) <= data && (t.status === 'IN' || toIso(t.dataOut) > data)).length }
      const inc = incassoDaPN(pn.docs.map(d => d.data()))
      const presenze = presenzeDaDocs(pres.docs.map(d => d.data()), cfg, sedeId, data)
      const ref = db.doc(`meteoGiornata/${sedeId}_${data}`)
      const prev = (await ref.get()).data()
      await ref.set({
        sedeId, data, reale: { mm: reale.mm, ore: reale.ore, mmGiorno: reale.mmGiorno, nuvole: reale.nuvole, tmax: reale.tmax, livello: lvReale.livello, orePioggia: reale.orePioggia },
        incasso: inc.totale, incassoLavaggi: inc.lavaggi, incassoParcheggio: inc.parcheggio, incassoAltro: inc.altro,
        auto, profilo, tappezzerie, autoPerDipendente: presenze.dipendenti ? Math.round(auto / presenze.dipendenti * 10) / 10 : null,
        consiglioEsito: prev?.consiglio ? { personaleConsigliato: prev.consiglio.personale, personaleReale: presenze.dipendenti, autoAttese: prev.consiglio.attese, autoReali: auto } : null,
        presenze, incassoPerDipendente: presenze.dipendenti ? Math.round(inc.totale / presenze.dipendenti * 100) / 100 : null,
        margineLordo: Math.round((inc.totale - presenze.costo) * 100) / 100,
        verificaTs: Date.now(),
        esito: prev?.livelloSera ? (prev.livelloSera === lvReale.livello ? 'ok' : 'diverso') : 'nessuna_previsione',
        erroreMm: prev?.mm != null ? r1(Math.abs(Number(prev.mm) - reale.mm)) : null,
        // Affidabilità per fonte (previsione della sera prima vs reale)
        fontiEsito: Object.fromEntries(Object.entries((prev?.fontiSera || {}) as Record<string, any>).map(([k, f]) => [k, { erroreMm: r1(Math.abs(Number(f.mm) - reale.mm)), erroreOre: Math.abs(Number(f.ore) - reale.ore), livelloOk: f.livello === lvReale.livello }])),
      }, { merge: true })
      console.log(`verifica ${sedeId} ${data}: previsto ${prev?.livelloSera || '-'} reale ${lvReale.livello} auto ${auto} incasso €${inc.totale} dipendenti ${presenze.dipendenti} (costo €${presenze.costo})${prev?.consiglio ? ` consigliati ${prev.consiglio.personale}` : ''}`)
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
    const snap = await db.collection('meteoGiornata').where('sedeId', '==', sedeId).get()   // date filtrate in memoria: niente indice composito
    return { giorni: snap.docs.filter(d => d.data().data >= da).sort((a, b) => String(b.data().data).localeCompare(String(a.data().data))).map(d => { const x = d.data(); return { data: x.data, livello: x.livello, livelloSera: x.livelloSera, livelloMattina: x.livelloMattina, motivo: x.motivo, mm: x.mm, ore: x.ore, probMax: x.probMax, nuvole: x.nuvole, tmax: x.tmax, orePioggia: x.orePioggia, dopoMm: x.dopoMm, reale: x.reale || null, incasso: x.incasso ?? null, incassoLavaggi: x.incassoLavaggi ?? null, presenze: x.presenze || null, incassoPerDipendente: x.incassoPerDipendente ?? null, margineLordo: x.margineLordo ?? null, esito: x.esito || null, storico: !!x.storico, auto: x.auto ?? null, tappezzerie: x.tappezzerie || null, consiglio: x.consiglio || null, consiglioEsito: x.consiglioEsito || null, nFonti: x.nFonti ?? null, fontiSera: x.fontiSera || null, fontiEsito: x.fontiEsito || null, erroreMm: x.erroreMm ?? null, aggiornatoTs: x.aggiornatoTs } }) }
  }
  if (action === 'config') return await getCfg()
  if (action === 'testOra') {   // admin: forza la previsione di stasera adesso (taratura)
    await previsione('sera'); return { ok: true }
  }
  throw new HttpsError('invalid-argument', 'azione sconosciuta')
})
