// Unifica i duplicati del CRM `clienti` (01/10/2026).
//   node scripts/crm-dedup.mjs            → solo analisi (stampa i gruppi)
//   node scripts/crm-dedup.mjs --apply    → backup in ~/Archivio-WashHub/backup-clienti-<data>.json + merge
// Criteri di unione AUTOMATICA (sicuri):
//   A) stesso telefono valido (≥9 cifre, non placeholder)
//   B) nome identico a meno di maiuscole/accenti/punteggiatura/spazi
//   C) stesse parole in ordine diverso ("ROSSI MARIO" / "MARIO ROSSI")
// I simili "fuzzy" (nameSimilarity ≥ 0.85) vengono solo elencati: li decide Guido.
// Master = chi ha più lavaggi, poi chi ha telefono/dati fiscali, poi il più vecchio.
// Lo storico (prenotazioni/tappezzeria/sospesi) col nome del duplicato viene rinominato
// al nome del master, così le statistiche CRM non perdono nulla. Stessa logica di
// mergeClienti() in js/moduli/clienti.js.
import admin from 'firebase-admin';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { nameSimilarity } from '../js/utils.js';

admin.initializeApp({ projectId: 'dashboard-washhub' });
const db = admin.firestore();
const APPLY = process.argv.includes('--apply');
// --solo-telefono: unisce SOLO chi ha lo stesso numero (anche con nomi diversi), ignora i criteri sul nome
// (decisione Guido 01/10/2026: i nomi simili senza numero in comune restano separati)
const SOLO_TEL = process.argv.includes('--solo-telefono');

const norm = s => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
const key = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tokKey = s => key(s).split(' ').filter(Boolean).sort().join(' ');
const telKey = t => { const d = String(t || '').replace(/\D/g, '').replace(/^0039/, '').replace(/^39(?=3\d{8,9}$)/, ''); return /^3\d{8,9}$/.test(d) ? d : ''; };
const PLACEHOLDER = /^(0+|1+|123456789|000000000)$/;

const [cliSnap, prenSnap, tapSnap, sospSnap] = await Promise.all([
  db.collection('clienti').get(), db.collection('prenotazioni').get(), db.collection('tappezzeria').get(), db.collection('sospesi').get()
]);
const clienti = cliSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
const pren = prenSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
const tap = tapSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
const sosp = sospSnap.docs.map(d => ({ _id: d.id, ...d.data() }));

// lavaggi per nome (per scegliere il master)
const lav = {};
for (const p of pren) { const k = key(p.cliente); if (k) lav[k] = (lav[k] || 0) + 1; }
for (const t of tap) { const k = key(t.cliente); if (k) lav[k] = (lav[k] || 0) + 1; }
const nLav = c => lav[key(c.nome)] || 0;
const hasFisc = c => !!(c.piva || c.codiceFiscale || c.denominazione || c.codDestinatario || c.pec);

// union-find sui criteri A/B/C
const parent = new Map(clienti.map(c => [c._id, c._id]));
const find = x => parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x));
const union = (a, b) => parent.set(find(a), find(b));
const byTel = {}, byKey = {}, byTok = {};
for (const c of clienti) {
  const t = telKey(c.telefono); if (t && !PLACEHOLDER.test(t)) (byTel[t] ||= []).push(c);
  const k = key(c.nome); if (k.length >= 3) (byKey[k] ||= []).push(c);
  const tk = tokKey(c.nome); if (tk.split(' ').length >= 2) (byTok[tk] ||= []).push(c);
}
// A) stesso telefono: unisce solo se i nomi si somigliano (≥0.4) o condividono una parola ≥3 lettere;
//    altrimenti (familiari con lo stesso numero? errore?) finisce nella lista "da decidere"
const tokens = s => new Set(key(s).split(' ').filter(w => w.length >= 3));
const nomiAffini = (a, b) => nameSimilarity(a.nome, b.nome) >= 0.4 || [...tokens(a.nome)].some(t => tokens(b.nome).has(t));
const telDubbi = [];
for (const g of Object.values(byTel)) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
  if (SOLO_TEL || nomiAffini(g[i], g[j])) union(g[i]._id, g[j]._id); else telDubbi.push([g[i], g[j]]);
}
if (!SOLO_TEL) for (const g of [...Object.values(byKey), ...Object.values(byTok)]) for (let i = 1; i < g.length; i++) union(g[0]._id, g[i]._id);

const gruppi = {};
for (const c of clienti) (gruppi[find(c._id)] ||= []).push(c);
const daUnire = Object.values(gruppi).filter(g => g.length > 1);

const scegliMaster = g => [...g].sort((a, b) => nLav(b) - nLav(a) || (telKey(b.telefono) ? 1 : 0) - (telKey(a.telefono) ? 1 : 0) || (hasFisc(b) ? 1 : 0) - (hasFisc(a) ? 1 : 0) || (a.timestamp || 0) - (b.timestamp || 0))[0];

console.log(`Clienti: ${clienti.length} — gruppi da unire: ${daUnire.length} (${daUnire.reduce((s, g) => s + g.length - 1, 0)} doc in meno)\n`);
for (const g of daUnire) {
  const m = scegliMaster(g);
  console.log(`★ ${m.nome} [${nLav(m)} lav, tel ${m.telefono || '-'}]  ←  ` + g.filter(x => x !== m).map(x => `${x.nome} [${nLav(x)} lav, tel ${x.telefono || '-'}]`).join(' + '));
}

console.log(`\nSTESSO TELEFONO, NOMI DIVERSI (non uniti, da decidere): ${telDubbi.filter(([a, b]) => find(a._id) !== find(b._id)).length}`);
for (const [a, b] of telDubbi) if (find(a._id) !== find(b._id)) console.log(`  ${a.telefono}  ${a.nome} [${nLav(a)}]  ~  ${b.nome} [${nLav(b)}]`);

// fuzzy: solo report
const inGruppo = new Set(daUnire.flat().map(c => c._id));
const fuzzy = [];
for (let i = 0; i < clienti.length; i++) for (let j = i + 1; j < clienti.length; j++) {
  const a = clienti[i], b = clienti[j];
  if (find(a._id) === find(b._id)) continue;
  const s = nameSimilarity(a.nome, b.nome);
  if (s >= 0.85) fuzzy.push([s, a, b]);
}
fuzzy.sort((x, y) => y[0] - x[0]);
console.log(`\nSIMILI (non uniti, da decidere): ${fuzzy.length}`);
for (const [s, a, b] of fuzzy.slice(0, 80)) console.log(`  ${Math.round(s * 100)}%  ${a.nome} [${nLav(a)}, ${a.telefono || '-'}]  ~  ${b.nome} [${nLav(b)}, ${b.telefono || '-'}]`);

if (!APPLY) { console.log('\n(analisi: rilancia con --apply per unire i gruppi ★)'); process.exit(0); }

// ── APPLY ──
const bk = path.join(os.homedir(), 'Archivio-WashHub', `backup-clienti-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(bk, JSON.stringify(Object.fromEntries(clienti.map(c => [c._id, c])), null, 1));
console.log('\nBackup:', bk);

const FISC = ['piva', 'codiceFiscale', 'denominazione', 'codDestinatario', 'pec', 'sedeLegale', 'via', 'cap', 'citta', 'provincia', 'email', 'tipo'];
let rin = { pren: 0, tap: 0, sosp: 0 }, eliminati = 0;
for (const g of daUnire) {
  const m = scegliMaster(g);
  const dups = g.filter(x => x !== m);
  const vett = [...(m.vetture || [])];
  const vk = v => `${norm(v.modello)}|${norm(v.targa)}`;
  const upd = {};
  for (const d of dups) {
    for (const v of d.vetture || []) if (!vett.some(x => vk(x) === vk(v))) vett.push(v);
    if (!telKey(m.telefono) && telKey(d.telefono)) { m.telefono = d.telefono; upd.telefono = d.telefono; }
    for (const f of FISC) if ((m[f] == null || m[f] === '' || (f === 'tipo' && m[f] === 'privato')) && d[f]) { m[f] = d[f]; upd[f] = d[f]; }
    if (Number(d.prezzoVip) > Number(m.prezzoVip || 0)) { m.prezzoVip = d.prezzoVip; upd.prezzoVip = d.prezzoVip; }
    const note = [m.note, d.note].filter(Boolean).join(' | '); if (note !== (m.note || '')) { m.note = note; upd.note = note; }
    if ((d.timestamp || Infinity) < (m.timestamp || Infinity)) { upd.timestamp = d.timestamp; m.timestamp = d.timestamp; }
  }
  upd.vetture = vett;
  upd.unitiDa = [...(m.unitiDa || []), ...dups.map(d => d.nome)];
  await db.collection('clienti').doc(m._id).update(upd);

  for (const d of dups) {
    if (key(d.nome) !== key(m.nome)) {
      const kd = key(d.nome);
      for (const p of pren) if (key(p.cliente) === kd) { await db.collection('prenotazioni').doc(p._id).update({ cliente: m.nome }); rin.pren++; }
      for (const t of tap) if (key(t.cliente) === kd) { await db.collection('tappezzeria').doc(t._id).update({ cliente: m.nome }); rin.tap++; }
      for (const s of sosp) if (key(s.cliente) === kd) { await db.collection('sospesi').doc(s._id).update({ cliente: m.nome }); rin.sosp++; }
    }
    await db.collection('clienti').doc(d._id).delete(); eliminati++;
  }
}
console.log(`Uniti: ${daUnire.length} gruppi, ${eliminati} doc eliminati, rinominati pren ${rin.pren} / tap ${rin.tap} / sosp ${rin.sosp}`);
