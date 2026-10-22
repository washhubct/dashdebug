// Reset pagamenti dipendenti Lungomare — richiesta Guido 22/10/2026.
//  • XXX, CUMAR, MENTA: giornate fino al 11/10/2026 → pagate
//  • HAPPY: giornate fino al 11/11/2026 → pagate (anticipato)
//  • acconti dei 4 azzerati (erano il "pagato" tenuto a mano): nota con il vecchio importo
//  • SONY (fisso): stipendio settembre 2026 pagato → acconti/lungomare_SONY.stipendiPagati
// Uso: GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud-keys/dashboard-washhub-claude-cli.json node scripts/reset-pagamenti-20261022.mjs [--apply]
import admin from 'firebase-admin';
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'dashboard-washhub' });
const db = admin.firestore();
const APPLY = process.argv.includes('--apply');
const OGGI = '22/10/2026';
const FINO = { XXX: '2026-10-11', CUMAR: '2026-10-11', MENTA: '2026-10-11', HAPPY: '2026-11-11' };

const snap = await db.collection('presenzeDipendenti').where('sedeId', '==', 'lungomare').get();
let batch = db.batch(), n = 0, ops = 0;
const tot = {};
for (const d of snap.docs) {
  const p = d.data();
  const pagati = { ...(p.pagati || {}) };
  let touched = false;
  for (const [nome, fino] of Object.entries(FINO)) {
    if (!(+p.dettaglio?.[nome] > 0) || pagati[nome] || p.dataISO > fino) continue;
    pagati[nome] = OGGI; touched = true;
    tot[nome] = (tot[nome] || 0) + +p.dettaglio[nome];
  }
  if (!touched) continue;
  n++; ops++;
  batch.update(d.ref, { pagati });
  if (ops === 400) { if (APPLY) await batch.commit(); batch = db.batch(); ops = 0; }
}
for (const nome of Object.keys(FINO)) {
  const ref = db.doc(`acconti/lungomare_${nome}`);
  const cur = (await ref.get()).data() || {};
  const fino = FINO[nome].split('-').reverse().join('/');
  batch.set(ref, {
    nome, sedeId: 'lungomare', importo: 0, aggiornato: OGGI,
    nota: `${OGGI}: reset pagamenti (Guido) — giornate fino al ${fino} segnate pagate; acconto azzerato (era €${cur.importo ?? 0}${cur.nota ? ' · ' + cur.nota : ''})`,
  }, { merge: true });
  console.log(`acconto ${nome}: €${cur.importo ?? 0} → 0`);
}
batch.set(db.doc('acconti/lungomare_SONY'), {
  nome: 'SONY', sedeId: 'lungomare', importo: 0, aggiornato: OGGI,
  stipendiPagati: { '2026-09': { importo: 1700, data: OGGI, nota: 'Stipendio settembre 2026 pagato (Guido 22/10)' } },
}, { merge: true });
if (APPLY) await batch.commit();
console.log(`${APPLY ? 'APPLICATO' : 'DRY-RUN'}: ${n} documenti presenze aggiornati`, tot);
