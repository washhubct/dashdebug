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
// riepilogo per sede e livello (solo giorni con incasso > 0 o dipendenti > 0)
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0 }
for (const sede of [...new Set(rows.map(r => r.sedeId))]) {
  console.log(`\n== ${sede} ==`)
  for (const lv of ['VERDE', 'GIALLO', 'ARANCIO', 'ROSSO']) {
    const g = rows.filter(r => r.sedeId === sede && r.reale.livello === lv && (r.incasso > 0 || r.presenze?.dipendenti > 0))
    if (!g.length) continue
    const conPres = g.filter(r => r.presenze?.dipendenti > 0)
    console.log(`${lv.padEnd(8)} n=${String(g.length).padStart(3)}  incasso mediano €${med(g.map(r => r.incasso)).toFixed(0).padStart(5)}  dipendenti mediani ${med(conPres.map(r => r.presenze.dipendenti))}  €/dip. mediano €${med(conPres.filter(r => r.incassoPerDipendente != null).map(r => r.incassoPerDipendente)).toFixed(0)}  margine mediano €${med(conPres.map(r => r.margineLordo)).toFixed(0)}  giorni a 0€: ${g.filter(r => !r.incasso).length}`)
  }
}
process.exit(0)
