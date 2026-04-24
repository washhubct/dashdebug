/**
 * setup-cassa-config.js
 *
 * Crea il documento Firestore `config/cassaAutomatica` con i valori di
 * default. Esegui una sola volta dopo aver installato il bridge sul PC
 * di Sebastiano.
 *
 * Pre-requisiti:
 *   1. Service account JSON di Firebase scaricato dalla console
 *      (Project settings → Service accounts → Generate new private key).
 *   2. Salvalo in un percorso SICURO (mai committarlo).
 *   3. Esporta la variabile env:
 *        export GOOGLE_APPLICATION_CREDENTIALS="/percorso/sa.json"
 *   4. npm install firebase-admin (una tantum)
 *
 * Uso:
 *   node scripts/setup-cassa-config.js
 *
 * Per aggiornare il token dopo aver installato il bridge:
 *   node scripts/setup-cassa-config.js --token <BRIDGE_TOKEN>
 *
 * Per abilitare la cassa quando hai testato tutto:
 *   node scripts/setup-cassa-config.js --enable
 */

const admin = require('firebase-admin');

const argv = process.argv.slice(2);
function arg(name) {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
}
const flag = (name) => argv.includes(name);

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'dashboard-washhub',
});
const db = admin.firestore();

async function main() {
    const ref = db.collection('config').doc('cassaAutomatica');
    const snap = await ref.get();

    const tokenArg = arg('--token');
    const enableArg = flag('--enable');
    const disableArg = flag('--disable');

    if (!snap.exists) {
        const seed = {
            enabled: false,
            bridgeUrl: 'https://cassa.washhub.it',
            bridgeToken: tokenArg || 'DA_INSERIRE_DOPO_INSTALLAZIONE_BRIDGE',
            pollingIntervalMs: 1500,
            maxPollingMs: 180000,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (enableArg) seed.enabled = true;
        await ref.set(seed);
        console.log('✅ Doc creato: config/cassaAutomatica');
        console.log(seed);
        return;
    }

    const updates = { lastUpdated: admin.firestore.FieldValue.serverTimestamp() };
    if (tokenArg) updates.bridgeToken = tokenArg;
    if (enableArg) updates.enabled = true;
    if (disableArg) updates.enabled = false;

    if (Object.keys(updates).length === 1) {
        console.log('ℹ️  Doc già esistente. Stato attuale:');
        console.log(snap.data());
        console.log('\nFlag disponibili: --token <X>, --enable, --disable');
        return;
    }
    await ref.update(updates);
    console.log('✅ Doc aggiornato:', updates);
}

main().catch((e) => {
    console.error('❌ Errore:', e);
    process.exit(1);
});
