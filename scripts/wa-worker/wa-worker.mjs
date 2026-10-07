// ─── WhatsApp Web worker (Mac Mini) — campagne richiamo CRM (01/10/2026) ───
// Il numero aziendale di Wash Hub è collegato come "dispositivo" (QR una volta,
// sessione in .wwebjs_auth/). La dashboard NON invia: mette i messaggi in
// `whatsappCoda` (js/moduli/campagna.js); questo processo li manda uno alla volta
// a ritmo umano e segna l'esito. Protezioni anti-ban:
//   • pausa casuale minPausaSec–maxPausaSec tra un messaggio e l'altro
//   • tetto maxGiorno al giorno, solo in orario oraInizio–oraFine
//   • verifica che il numero sia su WhatsApp prima di scrivere
//   • 3 errori consecutivi → pausa 30 min; se la sessione cade → stato offline
// Stato e limiti in `config/whatsapp` (la dash li legge per mostrare online/coda).
//   GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud-keys/dashboard-washhub-claude-cli.json node wa-worker.mjs
import pkg from 'whatsapp-web.js';
import QRCode from 'qrcode';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Client, LocalAuth } = pkg;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const QR_PNG = path.join(DIR, 'qr.png');
admin.initializeApp({ projectId: 'dashboard-washhub' });
const db = admin.firestore();
const cfgRef = db.doc('config/whatsapp');

const DEFAULT_LIMITI = { maxGiorno: 70, minPausaSec: 35, maxPausaSec: 95, oraInizio: 9, oraFine: 20 };
const TZ = 'Europe/Rome';
const oraRoma = () => new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pronto = false, erroriConsecutivi = 0, pausaFinoA = 0, inviatiOggi = 0, giorno = isoDay(oraRoma());

async function statoWorker(extra = {}) {
  await cfgRef.set({ via: 'web', worker: { online: pronto, ultimoPing: Date.now(), inviatiOggi, giorno, pausaFinoA, ...extra } }, { merge: true });
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(DIR, '.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] },
});

// Collegamento: QR (default) oppure codice di abbinamento se WA_PAIR_PHONE=39xxxxxxxxxx
// (WhatsApp → Dispositivi collegati → Collega un dispositivo → "Collega con numero di telefono")
let pairingChiesto = false;
client.on('qr', async qr => {
  await QRCode.toFile(QR_PNG, qr, { width: 420, margin: 2 });
  log('QR pronto →', QR_PNG, '(WhatsApp → Dispositivi collegati → Collega un dispositivo)');
  await statoWorker({ qrPending: true, errore: null });
  if (process.env.WA_PAIR_PHONE && !pairingChiesto) {
    pairingChiesto = true;
    try {
      const code = await client.requestPairingCode(process.env.WA_PAIR_PHONE.replace(/\D/g, ''), true);
      log('CODICE ABBINAMENTO:', code);
      fs.writeFileSync(path.join(DIR, 'pairing.txt'), code);
    } catch (e) { log('pairing code fallito:', e.message); pairingChiesto = false; }
  }
});
client.on('authenticated', () => log('autenticato'));
client.on('auth_failure', async m => { log('AUTH FAILURE', m); pronto = false; await statoWorker({ errore: 'auth failure: ' + m, qrPending: false }); });
client.on('ready', async () => {
  pronto = true; erroriConsecutivi = 0;
  const me = client.info?.wid?.user;
  log('pronto, numero collegato:', me);
  try { fs.unlinkSync(QR_PNG); } catch {}
  await statoWorker({ numero: me || null, qrPending: false, errore: null });
});
client.on('disconnected', async r => { log('DISCONNESSO', r); pronto = false; await statoWorker({ errore: 'disconnesso: ' + r }); });

// Variante leggera del testo: saluto/chiusura alternati così i messaggi non sono fotocopie
const SALUTI = ['Ciao', 'Ciao', 'Buongiorno', 'Salve'];
const CHIUSURE = ['A presto,\nStaff Wash Hub', 'Ti aspettiamo!\nStaff Wash Hub', 'A presto!\nWash Hub Lungomare', 'Buona giornata,\nStaff Wash Hub'];
function varia(testo) {
  let t = testo;
  if (/^Ciao\b/.test(t)) { const s = SALUTI[Math.floor(Math.random() * SALUTI.length)]; t = t.replace(/^Ciao\b/, s); if (s === 'Buongiorno' && oraRoma().getHours() >= 14) t = t.replace(/^Buongiorno/, 'Buonasera'); }
  if (/A presto,\nStaff\s*$/.test(t)) t = t.replace(/A presto,\nStaff\s*$/, CHIUSURE[Math.floor(Math.random() * CHIUSURE.length)]);
  return t;
}

function telefonoWA(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0039')) d = d.slice(4);
  if (/^3\d{8,9}$/.test(d)) d = '39' + d;
  return /^39\d{9,10}$/.test(d) ? d : null;
}

async function inviaUno(doc) {
  const m = doc.data();
  const tel = telefonoWA(m.telefono);
  const fallisci = async (errore) => { await doc.ref.update({ stato: 'fallito', errore, tentativi: (m.tentativi || 0) + 1, aggiornato: Date.now() }); log('FALLITO', m.nome, tel, errore); };
  if (!tel) return fallisci('telefono non valido');
  let numId;
  try { numId = await client.getNumberId(tel); } catch (e) { erroriConsecutivi++; return fallisci('verifica numero: ' + e.message); }
  if (!numId) return fallisci('numero non su WhatsApp');
  try {
    await client.sendMessage(numId._serialized, varia(m.testo));
  } catch (e) { erroriConsecutivi++; return fallisci('invio: ' + e.message); }
  erroriConsecutivi = 0; inviatiOggi++;
  await doc.ref.update({ stato: 'inviato', inviatoTs: Date.now(), aggiornato: Date.now(), errore: null });
  if (m.clienteId) {
    const ric = { data: isoDay(oraRoma()), segmento: m.segmento || 'campagna', template: m.template || 'custom', operatore: m.operatore || 'worker', via: 'whatsapp-web' };
    await db.doc(`clienti/${m.clienteId}`).set({ ultimoRichiamo: ric.data, richiami: admin.firestore.FieldValue.arrayUnion(ric) }, { merge: true });
  }
  log('inviato →', m.nome, tel, `(${inviatiOggi} oggi)`);
}

async function loop() {
  while (true) {
    try {
      const now = oraRoma();
      if (isoDay(now) !== giorno) { giorno = isoDay(now); inviatiOggi = 0; }
      const cfg = (await cfgRef.get()).data() || {};
      const lim = { ...DEFAULT_LIMITI, ...(cfg.limiti || {}) };
      await statoWorker();
      const h = now.getHours();
      const puoInviare = pronto && cfg.enabled !== false && Date.now() > pausaFinoA && h >= lim.oraInizio && h < lim.oraFine && inviatiOggi < lim.maxGiorno;
      if (puoInviare) {
        let snap = await db.collection('whatsappCoda').where('stato', '==', 'in_coda').where('priorita', '==', 10).limit(5).get();
        if (snap.empty) snap = await db.collection('whatsappCoda').where('stato', '==', 'in_coda').limit(30).get();
        // Priorità prima (inviti card dopo il pagamento = 10), poi in ordine di arrivo
        const prossimo = snap.docs.sort((a, b) => (b.data().priorita || 0) - (a.data().priorita || 0) || (a.data().creato || 0) - (b.data().creato || 0))[0];
        if (prossimo) {
          await inviaUno(prossimo);
          if (erroriConsecutivi >= 3) { pausaFinoA = Date.now() + 30 * 60e3; erroriConsecutivi = 0; log('3 errori di fila: pausa 30 min'); await statoWorker({ errore: 'pausa 30 min dopo 3 errori' }); }
          const pausa = (lim.minPausaSec + Math.random() * (lim.maxPausaSec - lim.minPausaSec)) * 1000;
          await sleep(pausa);
          continue;
        }
      }
    } catch (e) { log('loop error:', e.message); }
    await sleep(15000);
  }
}

client.initialize();
loop();
process.on('SIGTERM', async () => { pronto = false; await statoWorker({ errore: 'fermato' }); process.exit(0); });
