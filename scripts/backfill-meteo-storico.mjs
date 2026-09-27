// Popola meteoGiornata con lo STORICO: meteo reale (archivio Open-Meteo, fascia di apertura) + incasso Prima Nota
// per categoria + presenze dipendenti, per sede e giorno (no domeniche). Idempotente: non tocca i giorni che hanno
// già `reale` (scritti dalla verifica serale). Stesse soglie e stessa aggregazione di functions/src/meteo.ts.
// Uso: GOOGLE_APPLICATION_CREDENTIALS=... node scripts/backfill-meteo-storico.mjs [da=2025-08-01] [a=ieri]
import admin from 'firebase-admin'
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'dashboard-washhub' })
const db = admin.firestore()
const TZ = 'Europe/Rome'
const iso = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const DA = process.argv[2] || '2025-08-01'
const A = process.argv[3] || iso(new Date(Date.now() - 86400000))

const cfg = (await db.doc('config/meteo').get()).data()
const S = cfg.soglie, H0 = cfg.oraApertura, H1 = cfg.oraChiusura
const r1 = (n) => Math.round(n * 10) / 10
function livello(s) {
  const mm = Math.max(s.mm, s.mmGiorno * 0.8)
  if (mm >= S.rosso.mm || s.ore >= S.rosso.ore) return 'ROSSO'
  if (mm >= S.arancio.mm || s.ore >= S.arancio.ore) return 'ARANCIO'
  if (s.mm >= S.giallo.mm || s.ore >= S.giallo.ore || s.nuvole >= S.giallo.nuvole) return 'GIALLO'
  return 'VERDE'
}
function incassoDaPN(rows) {
  const r = { totale: 0, lavaggi: 0, parcheggio: 0, altro: 0 }
  for (const x of rows) { const e = Number(x.ENTRATA ?? x.Entrata ?? 0) || 0; if (!e) continue; const cat = String(x.Categoria || x['CENTRO DI COSTO'] || '').toUpperCase(); r.totale += e; if (/LAVAGG|TAPPEZZ/.test(cat)) r.lavaggi += e; else if (/PARCHEGG|ABBONAM|GIORNAL/.test(cat)) r.parcheggio += e; else r.altro += e }
  for (const k of Object.keys(r)) r[k] = Math.round(r[k] * 100) / 100
  return r
}
function presenzeDaDocs(docs) {
  const nomi = []; let costo = 0
  for (const d of docs) { for (const [n, c] of Object.entries(d.dettaglio || {})) if (Number(c) > 0 && !nomi.includes(n)) nomi.push(n); costo += Number(d.costoTotale) || 0 }
  return { dipendenti: nomi.length, nomi, costo: Math.round(costo * 100) / 100 }
}

// Prima Nota e presenze di tutto il periodo, raggruppate per sede|data
const pn = {}, pres = {}
;(await db.collection('primaNota').where('dataISO', '>=', DA).where('dataISO', '<=', A).get()).forEach(d => { const x = d.data(); const k = `${x.sedeId || 'lungomare'}|${x.dataISO}`; (pn[k] ||= []).push(x) })
;(await db.collection('presenzeDipendenti').where('dataISO', '>=', DA).where('dataISO', '<=', A).get()).forEach(d => { const x = d.data(); const k = `${x.sedeId || 'lungomare'}|${x.dataISO}`; (pres[k] ||= []).push(x) })
const auto = {}
;(await db.collection('prenotazioni').where('dataPren', '>=', DA).where('dataPren', '<=', A).get()).forEach(d => { const x = d.data(); const k = `${x.sedeId || 'lungomare'}|${x.dataPren}`; auto[k] = (auto[k] || 0) + 1 })
const esistenti = new Set(); (await db.collection('meteoGiornata').get()).forEach(d => { if (d.data().reale) esistenti.add(d.id) })

let scritti = 0
for (const [sedeId, sede] of Object.entries(cfg.sedi)) {
  const p = new URLSearchParams({ latitude: sede.lat, longitude: sede.lon, timezone: TZ, start_date: DA, end_date: A, hourly: 'precipitation,cloud_cover,weather_code,temperature_2m' })
  const j = await (await fetch(`https://archive-api.open-meteo.com/v1/archive?${p}`)).json()
  if (!j.hourly) { console.log(sedeId, 'archivio KO', JSON.stringify(j).slice(0, 200)); continue }
  const H = j.hourly, byDay = {}
  H.time.forEach((t, i) => { const d = t.slice(0, 10); const h = Number(t.slice(11, 13)); (byDay[d] ||= { tutte: [], ap: [] }); const o = { h, mm: H.precipitation[i] ?? 0, nuvole: H.cloud_cover[i] ?? 0, wc: H.weather_code[i] ?? 0, temp: H.temperature_2m[i] ?? 0 }; byDay[d].tutte.push(o); if (h >= H0 && h < H1) byDay[d].ap.push(o) })
  let batch = db.batch(), n = 0
  for (const [data, g] of Object.entries(byDay)) {
    if (new Date(data + 'T12:00:00Z').getUTCDay() === 0) continue
    if (esistenti.has(`${sedeId}_${data}`)) continue
    if (g.ap.some(o => o.mm == null) || !g.ap.length) continue
    const s = { mm: r1(g.ap.reduce((a, o) => a + o.mm, 0)), ore: g.ap.filter(o => o.mm >= 0.1).length, nuvole: Math.round(g.ap.reduce((a, o) => a + o.nuvole, 0) / g.ap.length), tmax: Math.round(Math.max(...g.ap.map(o => o.temp))), mmGiorno: r1(g.tutte.reduce((a, o) => a + o.mm, 0)), orePioggia: g.ap.filter(o => o.mm >= 0.1).map(o => o.h) }
    const inc = incassoDaPN(pn[`${sedeId}|${data}`] || []), pz = presenzeDaDocs(pres[`${sedeId}|${data}`] || [])
    if (!inc.totale && !pz.dipendenti && sedeId === 'paesi-etnei') continue   // sede non ancora aperta
    batch.set(db.doc(`meteoGiornata/${sedeId}_${data}`), {
      sedeId, data, storico: true, reale: { ...s, livello: livello(s) },
      incasso: inc.totale, incassoLavaggi: inc.lavaggi, incassoParcheggio: inc.parcheggio, incassoAltro: inc.altro,
      auto: auto[`${sedeId}|${data}`] || 0, presenze: pz, incassoPerDipendente: pz.dipendenti ? Math.round(inc.totale / pz.dipendenti * 100) / 100 : null,
      margineLordo: Math.round((inc.totale - pz.costo) * 100) / 100, esito: 'nessuna_previsione', verificaTs: Date.now(),
    }, { merge: true })
    n++; scritti++
    if (n % 400 === 0) { await batch.commit(); batch = db.batch() }
  }
  await batch.commit()
  console.log(sedeId, 'giorni scritti:', n)
}
console.log('totale', scritti)
process.exit(0)
