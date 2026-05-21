/**
 * backup-pre-multisede.js
 *
 * Salva un backup JSON locale di tutte le collection prima del backfill sedeId.
 * Output: scripts/backup-YYYYMMDD.json
 *
 * Uso:
 *   node scripts/backup-pre-multisede.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const COLLECTIONS = [
  'prenotazioni',
  'tappezzeria',
  'abbonamenti',
  'giornalieri',
  'uscite',
  'presenzeDipendenti',
  'storico',
];

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'dashboard-washhub',
});

const db = admin.firestore();

async function main() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const outFile = path.join(__dirname, `backup-${today}.json`);

  console.log(`Backup Firestore → ${outFile}`);
  const backup = {};

  for (const coll of COLLECTIONS) {
    process.stdout.write(`  ${coll}... `);
    const snap = await db.collection(coll).get();
    backup[coll] = {};
    snap.docs.forEach(doc => {
      backup[coll][doc.id] = doc.data();
    });
    console.log(`${snap.size} docs`);
  }

  fs.writeFileSync(outFile, JSON.stringify(backup, null, 2));
  const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
  console.log(`\nBackup completato: ${outFile} (${sizeMB} MB)`);
  process.exit(0);
}

main().catch(err => {
  console.error('Errore:', err);
  process.exit(1);
});
