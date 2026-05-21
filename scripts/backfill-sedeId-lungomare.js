/**
 * backfill-sedeId-lungomare.js
 *
 * Aggiunge sedeId: "lungomare" a tutti i documenti che non ce l'hanno.
 * Da eseguire UNA SOLA VOLTA prima dell'apertura di Paesi Etnei.
 *
 * Pre-requisiti:
 *   1. Export Firestore PRIMA di eseguire (vedi istruzioni sotto)
 *   2. Service account JSON di Firebase
 *      export GOOGLE_APPLICATION_CREDENTIALS="/percorso/sa.json"
 *   3. npm install firebase-admin (se non già installato)
 *
 * Export backup (eseguire PRIMA):
 *   firebase firestore:export gs://dashboard-washhub.firebasestorage.app/backups/pre-multisede-$(date +%Y%m%d) --project dashboard-washhub
 *
 * Uso:
 *   node scripts/backfill-sedeId-lungomare.js           ← dry-run (solo conta)
 *   node scripts/backfill-sedeId-lungomare.js --write   ← scrittura reale
 *   node scripts/backfill-sedeId-lungomare.js --coll uscite --write  ← solo una collection
 */

const admin = require('firebase-admin');

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--write');
const SINGLE_COLL = (() => { const i = argv.indexOf('--coll'); return i !== -1 ? argv[i + 1] : null; })();

const COLLECTIONS = [
  'prenotazioni',
  'tappezzeria',
  'abbonamenti',
  'giornalieri',
  'uscite',
  'presenzeDipendenti',
  'storico',
];

const SEDE_ID = 'lungomare';
const BATCH_SIZE = 400; // Firestore max 500 per batch, usiamo 400 per sicurezza

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'dashboard-washhub',
});

const db = admin.firestore();

async function backfillCollection(collName) {
  console.log(`\n── ${collName} ──`);
  const snap = await db.collection(collName).get();

  const toUpdate = snap.docs.filter(d => !d.data().sedeId);
  const alreadySet = snap.docs.length - toUpdate.length;

  console.log(`  totale: ${snap.docs.length} | già con sedeId: ${alreadySet} | da aggiornare: ${toUpdate.length}`);

  if (toUpdate.length === 0) {
    console.log('  niente da fare.');
    return { total: snap.docs.length, updated: 0, skipped: alreadySet };
  }

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] verrebbero aggiornati ${toUpdate.length} documenti.`);
    return { total: snap.docs.length, updated: 0, skipped: alreadySet };
  }

  // Scrivi in batch da BATCH_SIZE
  let written = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach(doc => batch.update(doc.ref, { sedeId: SEDE_ID }));
    await batch.commit();
    written += chunk.length;
    console.log(`  scritti ${written}/${toUpdate.length}...`);
  }

  console.log(`  ✓ ${written} documenti aggiornati con sedeId: "${SEDE_ID}"`);
  return { total: snap.docs.length, updated: written, skipped: alreadySet };
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log(`  Backfill sedeId → "${SEDE_ID}"`);
  console.log(`  Progetto: dashboard-washhub`);
  console.log(`  Modalità: ${DRY_RUN ? 'DRY-RUN (nessuna scrittura)' : '⚠️  SCRITTURA REALE'}`);
  if (SINGLE_COLL) console.log(`  Collection: solo ${SINGLE_COLL}`);
  console.log('═══════════════════════════════════════════');

  if (!DRY_RUN) {
    console.log('\n  Hai 5 secondi per annullare (Ctrl+C)...');
    await new Promise(r => setTimeout(r, 5000));
  }

  const targets = SINGLE_COLL ? [SINGLE_COLL] : COLLECTIONS;
  const results = {};

  for (const coll of targets) {
    try {
      results[coll] = await backfillCollection(coll);
    } catch (err) {
      console.error(`  ERRORE su ${coll}:`, err.message);
      results[coll] = { error: err.message };
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('  RIEPILOGO');
  console.log('═══════════════════════════════════════════');
  let totalUpdated = 0;
  for (const [coll, r] of Object.entries(results)) {
    if (r.error) {
      console.log(`  ${coll}: ERRORE — ${r.error}`);
    } else {
      console.log(`  ${coll}: ${r.updated} aggiornati, ${r.skipped} già ok, ${r.total} totali`);
      totalUpdated += r.updated;
    }
  }
  console.log(`\n  Totale documenti aggiornati: ${totalUpdated}`);
  if (DRY_RUN) {
    console.log('\n  Era un DRY-RUN. Per scrivere: aggiungere --write');
  }
  console.log('═══════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(err => {
  console.error('Errore fatale:', err);
  process.exit(1);
});
