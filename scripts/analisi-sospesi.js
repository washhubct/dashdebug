/**
 * analisi-sospesi.js — replica il calcolo "Da incassare" della pagina Sospesi
 * e stampa il dettaglio per mese e per cliente. SOLO LETTURA, non modifica nulla.
 *
 * Uso: node scripts/analisi-sospesi.js [--sede lungomare]
 * Richiede ADC valide (gcloud auth application-default login).
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'dashboard-washhub' });
const db = admin.firestore();

const argv = process.argv.slice(2);
const SEDE = (() => { const i = argv.indexOf('--sede'); return i !== -1 ? argv[i + 1] : 'lungomare'; })();

const fEur = n => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

function meseAnno(dataStr) {
    if (!dataStr) return 'Senza data';
    // formati: DD/MM/YYYY oppure YYYY-MM-DD
    let d;
    if (/^\d{4}-\d{2}-\d{2}/.test(dataStr)) d = new Date(dataStr);
    else {
        const [gg, mm, aa] = dataStr.split('/');
        d = new Date(`${aa}-${mm}-${gg}`);
    }
    if (!d || isNaN(d.getTime())) return 'Senza data';
    const mesi = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    return `${String(d.getFullYear())}-${String(d.getMonth()+1).padStart(2,'0')} ${mesi[d.getMonth()]} ${d.getFullYear()}`;
}

(async () => {
    // 1. Collection sospesi (record storici)
    const sospSnap = await db.collection('sospesi').where('sedeId', '==', SEDE).get();
    const localSosp = [];
    const originiGiaPresenti = new Set();
    sospSnap.forEach(doc => {
        const d = doc.data(); d._sid = doc.id;
        localSosp.push(d);
        if (d.origineSid) originiGiaPresenti.add(d.origineSid);
    });

    // 2. Prenotazioni ancora SOSPESO/FATTURATO non coperte da record storico
    const prenSnap = await db.collection('prenotazioni').where('sedeId', '==', SEDE).get();
    prenSnap.forEach(doc => {
        const e = doc.data();
        if (e.saldo !== 'SOSPESO' && e.saldo !== 'FATTURATO') return;
        const sid = 'PREN-' + doc.id;
        if (originiGiaPresenti.has(sid)) return;
        localSosp.push({
            cliente: (e.cliente || 'DA PRENOTAZIONI').toUpperCase(),
            data: (e.dataPren || '').split('-').reverse().join('/'),
            importo: parseFloat(e.prezzo) || 0,
            fatturato: e.saldo === 'FATTURATO',
            pagato: false,
            _sid: sid
        });
    });

    // 3. Tappezzeria OUT ancora SOSPESO/FATTURATO
    const tapSnap = await db.collection('tappezzeria').where('sedeId', '==', SEDE).get();
    tapSnap.forEach(doc => {
        const t = doc.data();
        if (t.status !== 'OUT' || (t.pagamento !== 'SOSPESO' && t.pagamento !== 'FATTURATO')) return;
        const sid = 'TAP-' + doc.id;
        if (originiGiaPresenti.has(sid)) return;
        if (localSosp.find(s => s._sid === sid)) return;
        localSosp.push({
            cliente: (t.cliente || 'DA TAPPEZZERIA').toUpperCase(),
            data: t.dataOut || t.dataIn,
            importo: parseFloat(t.prezzo) || 0,
            fatturato: t.pagamento === 'FATTURATO',
            pagato: false,
            _sid: sid
        });
    });

    const aperti = localSosp.filter(s => !s.pagato && !s.fatturato);
    const fatturati = localSosp.filter(s => s.fatturato && !s.pagato);
    const daIncassare = [...aperti, ...fatturati];
    const tot = daIncassare.reduce((s, r) => s + (parseFloat(r.importo) || 0), 0);

    console.log(`\nSede: ${SEDE}`);
    console.log(`TOTALE DA INCASSARE: ${fEur(tot)}  (${aperti.length} aperti + ${fatturati.length} fatturati non incassati)\n`);

    // Per mese
    const perMese = {};
    daIncassare.forEach(s => {
        const m = meseAnno(s.data);
        if (!perMese[m]) perMese[m] = { n: 0, tot: 0 };
        perMese[m].n++; perMese[m].tot += parseFloat(s.importo) || 0;
    });
    console.log('── Per mese ──');
    Object.keys(perMese).sort().forEach(m => {
        console.log(`${m.replace(/^\S+ /, '').padEnd(16)} ${String(perMese[m].n).padStart(3)} lavorazioni  ${fEur(perMese[m].tot).padStart(12)}`);
    });

    // Per cliente
    const perCliente = {};
    daIncassare.forEach(s => {
        const c = s.cliente || '?';
        if (!perCliente[c]) perCliente[c] = { n: 0, tot: 0, fatt: 0 };
        perCliente[c].n++; perCliente[c].tot += parseFloat(s.importo) || 0;
        if (s.fatturato) perCliente[c].fatt++;
    });
    console.log('\n── Per cliente (ordinati per importo) ──');
    Object.entries(perCliente).sort((a, b) => b[1].tot - a[1].tot).forEach(([c, v]) => {
        const tag = v.fatt ? `  [${v.fatt} fatturati]` : '';
        console.log(`${c.padEnd(35)} ${String(v.n).padStart(3)} lav.  ${fEur(v.tot).padStart(12)}${tag}`);
    });
    console.log('');
})().catch(e => { console.error('ERRORE:', e.message); process.exit(1); });
