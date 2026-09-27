// CSV + riepilogo: incasso ↔ meteo reale ↔ presenze, da meteoGiornata. Output ~/Archivio-WashHub/analisi/meteo-fatturato.csv
import admin from 'firebase-admin'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'dashboard-washhub' })
const rows = []
;(await admin.firestore().collection('meteoGiornata').get()).forEach(d => { const x = d.data(); if (x.reale) rows.push(x) })
rows.sort((a, b) => a.sedeId.localeCompare(b.sedeId) || a.data.localeCompare(b.data))
const GG = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csv = ['sede;data;giorno;livello_reale;mm_apertura;ore_pioggia;mm_24h;nuvole;tmax;livello_previsto_sera;esito;incasso;incasso_lavaggi;incasso_parcheggio;dipendenti;nomi;costo_personale;incasso_per_dipendente;margine_lordo',
  ...rows.map(x => [x.sedeId, x.data, GG[new Date(x.data + 'T12:00:00Z').getUTCDay()], x.reale.livello, x.reale.mm, x.reale.ore, x.reale.mmGiorno, x.reale.nuvole, x.reale.tmax, x.livelloSera || '', x.esito || '', x.incasso, x.incassoLavaggi, x.incassoParcheggio, x.presenze?.dipendenti ?? '', (x.presenze?.nomi || []).join(' '), x.presenze?.costo ?? '', x.incassoPerDipendente ?? '', x.margineLordo ?? ''].map(v => q(typeof v === 'number' ? String(v).replace('.', ',') : v)).join(';'))].join('\n') + '\n'
const dir = join(homedir(), 'Archivio-WashHub', 'analisi'); mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'meteo-fatturato.csv'), csv)
console.log('CSV:', join(dir, 'meteo-fatturato.csv'), rows.length, 'righe')
// Riepilogo per sede e livello: statistiche PER GIORNATA coerenti (stesse giornate per tutte le colonne),
// solo giornate lavorate (dipendenti>0 o incasso>0), incasso SOLO lavaggi (abbonamenti e sospesi saldati non dipendono dal meteo),
// auto lavate = prenotazioni del giorno. Margine = lavaggi − costo personale.
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
const pren = await admin.firestore().collection('prenotazioni').where('dataPren', '>=', rows[0]?.data || '2025-08-01').get()
const auto = {}; pren.forEach(d => { const p = d.data(); const k = `${p.sedeId || 'lungomare'}|${p.dataPren}`; auto[k] = (auto[k] || 0) + 1 })
for (const sede of [...new Set(rows.map(r => r.sedeId))]) {
  const aperti = rows.filter(r => r.sedeId === sede && ((r.presenze?.dipendenti > 0) || r.incasso > 0))
  console.log(`\n== ${sede} — ${aperti.length} giornate lavorate (mediane per giornata) ==`)
  console.log('livello    n  auto/g  lavaggi€  dip  costo€  margine€ | media margine | giorni in perdita')
  for (const lv of ['VERDE', 'GIALLO', 'ARANCIO', 'ROSSO']) {
    const g = aperti.filter(r => r.reale.livello === lv).map(r => ({ auto: auto[`${sede}|${r.data}`] || 0, lav: r.incassoLavaggi || 0, dip: r.presenze?.dipendenti || 0, costo: r.presenze?.costo || 0, m: (r.incassoLavaggi || 0) - (r.presenze?.costo || 0) }))
    if (!g.length) continue
    console.log(`${lv.padEnd(8)} ${String(g.length).padStart(4)}  ${String(med(g.map(x => x.auto))).padStart(6)}  ${med(g.map(x => x.lav)).toFixed(0).padStart(8)}  ${String(med(g.map(x => x.dip))).padStart(3)}  ${med(g.map(x => x.costo)).toFixed(0).padStart(6)}  ${med(g.map(x => x.m)).toFixed(0).padStart(8)} | ${mean(g.map(x => x.m)).toFixed(0).padStart(6)} | ${g.filter(x => x.m < 0).length}/${g.length}`)
  }
}
process.exit(0)
