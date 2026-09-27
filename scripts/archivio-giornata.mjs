// ─── Archivio serale della giornata (Mac Mini) ───
// Salva in ~/Archivio-WashHub/AAAA/MM/AAAA-MM-GG.{pdf,html,csv} TUTTI i movimenti del giorno (contanti compresi),
// per entrambe le sedi. È l'unico posto dove i contanti dei giorni conclusi restano consultabili
// (in dashboard spariscono dal giorno dopo: js/moduli/contanti-passati.js).
//
// Uso:  node scripts/archivio-giornata.mjs                 → oggi
//       node scripts/archivio-giornata.mjs 2026-09-26      → giorno specifico
//       node scripts/archivio-giornata.mjs --recupera       → oggi + ultimi 7 giorni senza archivio
// Richiede GOOGLE_APPLICATION_CREDENTIALS (chiave SA in ~/.config/gcloud-keys/). Lanciato ogni sera alle 21:30
// da launchd (~/Library/LaunchAgents/it.washhub.archivio-giornata.plist).
import admin from 'firebase-admin'
import { mkdirSync, existsSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = join(homedir(), 'Archivio-WashHub')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SEDI = { lungomare: 'Wash Hub Lungomare', 'paesi-etnei': 'Wash Hub Paesi Etnei' }

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'dashboard-washhub' })
const db = admin.firestore()

const pad = (n) => String(n).padStart(2, '0')
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const itaOf = (iso) => iso.split('-').reverse().join('/')
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n }
const eur = (n) => '€ ' + n.toFixed(2).replace('.', ',')
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const log = (m) => { const line = `${new Date().toISOString()} ${m}`; console.log(line); mkdirSync(ROOT, { recursive: true }); appendFileSync(join(ROOT, 'archivio.log'), line + '\n') }

async function caricaGiorno(iso) {
  const ita = itaOf(iso)
  const get = async (coll, field, value) => (await db.collection(coll).where(field, '==', value).get()).docs.map((d) => ({ _id: d.id, ...d.data() }))
  const [pren, tap, giorn, uscite, incassi, pn] = await Promise.all([
    get('prenotazioni', 'dataPren', iso), get('tappezzeria', 'dataOut', ita), get('giornalieri', 'dataOut', iso),
    get('uscite', 'data', iso), get('incassiManuali', 'dataISO', iso), get('primaNota', 'dataISO', iso),
  ])
  return { iso, ita, pren, tap: tap.filter((t) => t.status === 'OUT'), giorn: giorn.filter((g) => g.status === 'OUT'), uscite, incassi, pn }
}

// Movimenti normalizzati (per CSV e totali)
function movimenti(g) {
  const out = []
  for (const p of g.pren) out.push({ sede: p.sedeId || 'lungomare', tipo: 'LAVAGGIO', orario: p.orario || '', chi: p.cliente || '', cosa: p.vettura || '', importo: num(p.prezzo), metodo: p.saldo === 'SOSPESO' ? 'SOSPESO' : (p.saldato === 'SI' ? (p.saldo || '') : 'NON PAGATO'), note: p.note || '', id: p._id })
  for (const t of g.tap) out.push({ sede: t.sedeId || 'lungomare', tipo: 'TAPPEZZERIA', orario: '', chi: t.cliente || '', cosa: `${t.modello || ''} ${t.targa || ''}`.trim(), importo: num(t.prezzo), metodo: (t.pagamento || '').toUpperCase(), note: t.note || '', id: t._id })
  for (const x of g.giorn) out.push({ sede: x.sedeId || 'lungomare', tipo: 'PARCHEGGIO ORE', orario: `${x.orarioIn || ''}→${x.orarioOut || ''}`, chi: x.telefono || '', cosa: `${x.vettura || ''} ${x.targa || ''}`.trim(), importo: num(x.prezzoFinale), metodo: (x.pagamento || '').toUpperCase() + (x.pagamentoVia ? ` (${x.pagamentoVia})` : ''), note: x.origine || '', id: x._id })
  for (const i of g.incassi) out.push({ sede: i.sedeId || 'lungomare', tipo: 'INCASSO MANUALE', orario: i.orario || '', chi: '', cosa: i.categoria || '', importo: num(i.importo), metodo: (i.metodo || '').toUpperCase(), note: '', id: i._id })
  for (const u of g.uscite) out.push({ sede: u.sedeId || 'lungomare', tipo: 'USCITA', orario: u.orario || '', chi: '', cosa: u.descrizione || '', importo: -num(u.importo), metodo: (u.metodo || '').toUpperCase(), note: u.categoria || '', id: u._id })
  return out.sort((a, b) => a.sede.localeCompare(b.sede) || a.orario.localeCompare(b.orario))
}

function totali(movs) {
  const t = { CONTANTI: 0, POS: 0, BONIFICO: 0, SOSPESO: 0, USCITE_CONTANTI: 0, USCITE_ALTRO: 0 }
  for (const m of movs) {
    const k = m.metodo.split(' ')[0]
    if (m.tipo === 'USCITA') { if (k === 'CONTANTI') t.USCITE_CONTANTI += -m.importo; else t.USCITE_ALTRO += -m.importo; continue }
    if (k in t) t[k] += m.importo
  }
  return t
}

function html(g, movs) {
  const sedi = [...new Set([...movs.map((m) => m.sede), ...g.pn.map((r) => r.sedeId || 'lungomare')])].sort()
  const riga = (m) => `<tr class="${m.metodo.startsWith('CONTANTI') ? 'cash' : ''}"><td>${esc(m.orario)}</td><td>${esc(m.tipo)}</td><td>${esc(m.chi)}</td><td>${esc(m.cosa)}</td><td class="n">${eur(m.importo)}</td><td>${esc(m.metodo)}</td><td class="note">${esc(m.note)}</td></tr>`
  const pnRiga = (r) => `<tr class="${String(r["MODALITA'"] || '').toUpperCase() === 'CONTANTI' ? 'cash' : ''}"><td>${esc(r.Categoria || r['CENTRO DI COSTO'] || '')}</td><td>${esc(r.Descrizione || r['PRIMANOTA CLIENTI/FORNITORI'] || '')}</td><td class="n">${num(r.ENTRATA) ? eur(num(r.ENTRATA)) : ''}</td><td class="n">${num(r.USCITE) ? eur(num(r.USCITE)) : ''}</td><td class="n">${num(r.SOSPESO) ? eur(num(r.SOSPESO)) : ''}</td><td>${esc(r["MODALITA'"] || '')}</td></tr>`
  let body = ''
  for (const sede of sedi) {
    const ms = movs.filter((m) => m.sede === sede), t = totali(ms), pn = g.pn.filter((r) => (r.sedeId || 'lungomare') === sede)
    const pnT = pn.reduce((a, r) => { const mod = String(r["MODALITA'"] || '').toUpperCase(); a.entrate += num(r.ENTRATA); a.uscite += num(r.USCITE); a.sospesi += num(r.SOSPESO); if (mod === 'CONTANTI') a.contanti += num(r.ENTRATA) - num(r.USCITE); return a }, { entrate: 0, uscite: 0, sospesi: 0, contanti: 0 })
    body += `<h2>${esc(SEDI[sede] || sede)}</h2>
    <div class="kpi"><div><b>Contanti</b>${eur(t.CONTANTI)}</div><div><b>POS</b>${eur(t.POS)}</div><div><b>Bonifico</b>${eur(t.BONIFICO)}</div><div><b>Sospesi</b>${eur(t.SOSPESO)}</div><div><b>Uscite contanti</b>${eur(t.USCITE_CONTANTI)}</div><div class="hl"><b>Cassa contanti netta</b>${eur(t.CONTANTI - t.USCITE_CONTANTI)}</div></div>
    <h3>Movimenti (${ms.length})</h3>
    <table><thead><tr><th>Ora</th><th>Tipo</th><th>Cliente</th><th>Dettaglio</th><th class="n">Importo</th><th>Metodo</th><th>Note</th></tr></thead><tbody>${ms.map(riga).join('') || '<tr><td colspan="7" class="empty">Nessun movimento</td></tr>'}</tbody></table>
    <h3>Prima Nota (${pn.length}) — entrate ${eur(pnT.entrate)} · uscite ${eur(pnT.uscite)} · sospesi ${eur(pnT.sospesi)} · di cui contanti netti ${eur(pnT.contanti)}</h3>
    <table><thead><tr><th>Categoria</th><th>Descrizione</th><th class="n">Entrata</th><th class="n">Uscita</th><th class="n">Sospeso</th><th>Modalità</th></tr></thead><tbody>${pn.map(pnRiga).join('') || '<tr><td colspan="6" class="empty">Nessuna riga</td></tr>'}</tbody></table>`
  }
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Wash Hub · ${g.ita}</title><style>
  body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #C8A84E;padding-bottom:4px}h3{font-size:12px;margin:14px 0 6px;color:#444}
  .sub{color:#666;margin-bottom:10px}table{width:100%;border-collapse:collapse;margin-bottom:8px}th,td{border-bottom:1px solid #e5e5e5;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f5f5f2;font-size:10px;text-transform:uppercase;letter-spacing:.4px}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.note{color:#666}tr.cash td{background:#fff8e6}.empty{color:#999;text-align:center}
  .kpi{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px}.kpi div{border:1px solid #e5e5e5;border-radius:8px;padding:6px 10px;min-width:100px}.kpi b{display:block;font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.4px}.kpi .hl{border-color:#C8A84E;background:#fffbf0}
  @page{size:A4;margin:14mm}</style></head><body>
  <h1>WASH HUB · Archivio giornata ${g.ita}</h1><div class="sub">Generato ${new Date().toLocaleString('it-IT')} · righe evidenziate = contanti · fonte Firestore (prenotazioni, tappezzeria, giornalieri, incassi manuali, uscite, Prima Nota)</div>
  ${body}</body></html>`
}

function csv(movs, iso) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return ['data;sede;tipo;orario;cliente;dettaglio;importo;metodo;note;id', ...movs.map((m) => [iso, m.sede, m.tipo, m.orario, m.chi, m.cosa, m.importo.toFixed(2).replace('.', ','), m.metodo, m.note, m.id].map(q).join(';'))].join('\n') + '\n'
}

async function archivia(iso) {
  const [y, m] = iso.split('-')
  const dir = join(ROOT, y, m); mkdirSync(dir, { recursive: true })
  const g = await caricaGiorno(iso), movs = movimenti(g)
  const base = join(dir, iso)
  writeFileSync(base + '.html', html(g, movs)); writeFileSync(base + '.csv', csv(movs, iso))
  let pdf = 'no-chrome'
  if (existsSync(CHROME)) {
    try { execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${base}.pdf`, `file://${base}.html`], { stdio: 'ignore', timeout: 60000 }); pdf = 'pdf ok' } catch (e) { pdf = 'pdf ERRORE ' + e.message.slice(0, 80) }
  }
  log(`${iso}: ${movs.length} movimenti, ${g.pn.length} righe Prima Nota → ${base}.{html,csv} ${pdf}`)
}

const args = process.argv.slice(2)
const oggi = isoOf(new Date())
const giorni = []
const esplicito = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
if (esplicito) giorni.push(esplicito)
else {
  giorni.push(oggi)
  if (args.includes('--recupera')) for (let i = 1; i <= 7; i++) { const d = new Date(); d.setDate(d.getDate() - i); const iso = isoOf(d); const [y, m] = iso.split('-'); if (!existsSync(join(ROOT, y, m, iso + '.html'))) giorni.push(iso) }
}
for (const iso of giorni) { try { await archivia(iso) } catch (e) { log(`${iso}: ERRORE ${e.message}`) } }
process.exit(0)
