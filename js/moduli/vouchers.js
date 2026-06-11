// Vouchers — buoni sconto generati dai referral.
//
// Modello dati su Firestore /vouchers/{id} (id == codice):
//   codice            : "VCH-XXXX-XXXX"
//   valore            : numero (€)
//   stato             : 'attivo' | 'utilizzato' | 'scaduto'
//   telefono          : 9 cifre (ultime) — destinatario
//   referralCode      : "WHXXXX" — codice di origine
//   prenotazioneOrigine : pid della prenotazione che lo ha generato
//   sedeId            : sede della prenotazione di origine
//   dataEmissione     : serverTimestamp
//   dataScadenza      : timestamp millis (6 mesi)
//   dataUso           : timestamp | null
//   prenotazioneUso   : pid | null
//
// Note di sicurezza:
//   - read pubblico per get (validazione codice da /prenota lato sito)
//   - list/create/update sono ammessi solo ad admin (rules)

import { db, fsCollection, fsGetDoc, fsGetDocs, fsDoc } from '../firebase-config.js';
import { setDoc, serverTimestamp, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { state } from '../state.js';

export const VOUCHER_VALORE_DEFAULT = 5;
export const VOUCHER_DURATA_MESI = 6;

// Base32 senza caratteri ambigui (no 0,1,O,I)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomChunk(n) {
    let out = '';
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    for (let i = 0; i < n; i++) out += CHARS[buf[i] % CHARS.length];
    return out;
}

function generaCodiceVoucher() {
    return `VCH-${randomChunk(4)}-${randomChunk(4)}`;
}

async function codiceLibero(codice) {
    try {
        const snap = await fsGetDoc(fsDoc(db, 'vouchers', codice));
        return !snap.exists();
    } catch {
        return true; // se la read fallisce, ottimisticamente provo a scrivere; setDoc rifiuta se esiste
    }
}

/**
 * Crea un voucher per il referrer associato al codice referral della prenotazione.
 * No-op se non ci sono abbastanza dati (telefono, referral).
 */
export async function creaVoucherReferral(prenEntry) {
    const referralCode = (prenEntry?.referral || '').trim().toUpperCase();
    if (!referralCode || referralCode.length < 4) return null;

    // Recupera telefono del referrer dal doc /referral/{code}
    let telefonoRef = '';
    try {
        const refSnap = await fsGetDoc(fsDoc(db, 'referral', referralCode));
        if (refSnap.exists()) telefonoRef = String(refSnap.data().telefono || '').replace(/\D/g, '').slice(-9);
    } catch (e) {
        console.warn('[vouchers] read referral fallita', referralCode, e?.message);
    }
    if (!telefonoRef || telefonoRef.length < 9) {
        console.warn('[vouchers] no telefono referrer per', referralCode, '— skip voucher');
        return null;
    }

    // Trova codice univoco
    let codice;
    for (let i = 0; i < 5; i++) {
        codice = generaCodiceVoucher();
        if (await codiceLibero(codice)) break;
        if (i === 4) { console.warn('[vouchers] no codice libero dopo 5 tentativi'); return null; }
    }

    const now = Date.now();
    const scadenza = now + VOUCHER_DURATA_MESI * 30 * 86400000;

    const voucher = {
        codice,
        valore: VOUCHER_VALORE_DEFAULT,
        stato: 'attivo',
        telefono: telefonoRef,
        referralCode,
        prenotazioneOrigine: prenEntry._pid || null,
        sedeId: prenEntry.sedeId || state.sedeAttiva,
        dataEmissione: serverTimestamp(),
        dataEmissioneMs: now,
        dataScadenza: scadenza,
        dataUso: null,
        prenotazioneUso: null
    };

    try {
        await setDoc(fsDoc(db, 'vouchers', codice), voucher);
        // Aggiungi anche all'indice pubblico /referral/{code}.vouchersAttivi[]
        // così il sito può listarli al lookup del titolare (no rules nuove).
        try {
            await setDoc(fsDoc(db, 'referral', referralCode), { vouchersAttivi: arrayUnion(codice) }, { merge: true });
        } catch (e) {
            console.warn('[vouchers] arrayUnion referral fail', e?.message);
        }
        console.log('[vouchers] emesso', codice, 'per', telefonoRef, 'da referral', referralCode);
        return codice;
    } catch (e) {
        console.warn('[vouchers] errore creazione', codice, e?.message);
        return null;
    }
}

/**
 * Marca un voucher come "utilizzato" e lo rimuove dall'indice del referral.
 * Idempotente: se già utilizzato, non fa nulla.
 */
export async function marcaVoucherUtilizzato(codice, prenPid) {
    if (!codice) return false;
    try {
        const snap = await fsGetDoc(fsDoc(db, 'vouchers', codice));
        if (!snap.exists()) return false;
        const v = snap.data();
        if (v.stato === 'utilizzato') return true;
        await setDoc(fsDoc(db, 'vouchers', codice), {
            stato: 'utilizzato',
            dataUso: serverTimestamp(),
            dataUsoMs: Date.now(),
            prenotazioneUso: prenPid || null
        }, { merge: true });
        if (v.referralCode) {
            try {
                await setDoc(fsDoc(db, 'referral', v.referralCode), { vouchersAttivi: arrayRemove(codice) }, { merge: true });
            } catch (e) { console.warn('[vouchers] arrayRemove referral fail', e?.message); }
        }
        return true;
    } catch (e) {
        console.warn('[vouchers] marcaUtilizzato fail', codice, e?.message);
        return false;
    }
}

/**
 * Lookup pubblico singolo voucher per codice. Usato dal sito al riscatto.
 */
export async function getVoucher(codice) {
    if (!codice) return null;
    try {
        const snap = await fsGetDoc(fsDoc(db, 'vouchers', codice));
        if (!snap.exists()) return null;
        return { _id: snap.id, ...snap.data() };
    } catch {
        return null;
    }
}

// ─── Caricamento e render pagina admin ─────────────────────────
let vouchersLocali = [];

export function initVouchers() {
    const refresh = document.getElementById('vchRefreshBtn');
    if (refresh) refresh.addEventListener('click', renderVouchers);
    const search = document.getElementById('vchSearch');
    if (search) search.addEventListener('input', renderVouchersList);
    const filter = document.getElementById('vchFilter');
    if (filter) filter.addEventListener('change', renderVouchersList);
}

export async function renderVouchers() {
    try {
        const snap = await fsGetDocs(fsCollection(db, 'vouchers'));
        vouchersLocali = [];
        snap.forEach(d => vouchersLocali.push({ _id: d.id, ...d.data() }));
    } catch (e) {
        console.warn('[vouchers] read fallita', e?.message);
        vouchersLocali = [];
    }
    aggiornaScadutiClient();
    renderVouchersKpi();
    renderVouchersList();
}

// Marca come "scaduto" client-side i voucher attivi con data scaduta (no scrittura DB).
function aggiornaScadutiClient() {
    const now = Date.now();
    vouchersLocali.forEach(v => {
        if (v.stato === 'attivo' && v.dataScadenza && v.dataScadenza < now) {
            v._scadutoVista = true;
        }
    });
}

function statoEffettivo(v) {
    if (v.stato === 'utilizzato') return 'utilizzato';
    if (v.stato === 'scaduto' || v._scadutoVista) return 'scaduto';
    return 'attivo';
}

function renderVouchersKpi() {
    const el = document.getElementById('vchKpis');
    if (!el) return;
    const tot = vouchersLocali.length;
    let attivi = 0, usati = 0, scaduti = 0, valoreAttivo = 0, valoreUsato = 0;
    vouchersLocali.forEach(v => {
        const s = statoEffettivo(v);
        if (s === 'attivo') { attivi++; valoreAttivo += +v.valore || 0; }
        else if (s === 'utilizzato') { usati++; valoreUsato += +v.valore || 0; }
        else scaduti++;
    });
    const fEur = n => '€' + n.toLocaleString('it-IT');
    el.innerHTML = `
        <div class="kpi-card"><div class="kv">${tot}</div><div class="kl">Emessi totali</div></div>
        <div class="kpi-card"><div class="kv" style="color:var(--grn)">${attivi}</div><div class="kl">Attivi · ${fEur(valoreAttivo)}</div></div>
        <div class="kpi-card"><div class="kv" style="color:var(--blu)">${usati}</div><div class="kl">Utilizzati · ${fEur(valoreUsato)}</div></div>
        <div class="kpi-card"><div class="kv" style="color:var(--tx3)">${scaduti}</div><div class="kl">Scaduti</div></div>`;
}

function renderVouchersList() {
    const tb = document.getElementById('vchTb');
    if (!tb) return;

    const search = (document.getElementById('vchSearch')?.value || '').trim().toUpperCase();
    const filter = document.getElementById('vchFilter')?.value || 'tutti';

    let righe = [...vouchersLocali];
    if (filter !== 'tutti') righe = righe.filter(v => statoEffettivo(v) === filter);
    if (search) {
        righe = righe.filter(v =>
            (v._id || '').includes(search) ||
            (v.telefono || '').includes(search) ||
            (v.referralCode || '').includes(search)
        );
    }

    righe.sort((a, b) => (b.dataEmissioneMs || 0) - (a.dataEmissioneMs || 0));

    if (!righe.length) {
        tb.innerHTML = '<tr><td colspan="8" class="empty">Nessun voucher</td></tr>';
        return;
    }

    const fEur = n => '€' + n.toLocaleString('it-IT');
    const fDate = ms => ms ? new Date(ms).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
    const badge = s => s === 'attivo' ? '<span class="badge g">ATTIVO</span>'
                     : s === 'utilizzato' ? '<span class="badge b">USATO</span>'
                     : '<span class="badge" style="background:var(--bg4);color:var(--tx3)">SCADUTO</span>';

    tb.innerHTML = righe.map(v => {
        const stato = statoEffettivo(v);
        const tel = v.telefono || '';
        // Bottone WhatsApp solo per voucher attivi con telefono → notifica manuale rapida
        const waBtn = (stato === 'attivo' && tel.length >= 9)
            ? `<a class="act-btn" target="_blank" rel="noopener" title="Avvisa il cliente via WhatsApp" style="text-decoration:none" href="${waLink(tel, v._id, +v.valore || 0)}">📱</a>`
            : '';
        return `
        <tr>
            <td><code style="font:700 12px var(--mono);color:var(--gold)">${v._id}</code></td>
            <td style="font-weight:600">${fEur(+v.valore || 0)}</td>
            <td>${tel || '—'}</td>
            <td><code style="font:600 11px var(--mono);color:var(--tx2)">${v.referralCode || '—'}</code></td>
            <td>${badge(stato)}</td>
            <td style="font:400 11px var(--mono);color:var(--tx2)">${fDate(v.dataEmissioneMs)}</td>
            <td style="font:400 11px var(--mono);color:var(--tx2)">${fDate(v.dataScadenza)}</td>
            <td>${waBtn}</td>
        </tr>
        `;
    }).join('');
}

// wa.me link con messaggio pre-compilato. Telefono è di norma 9 cifre IT;
// se non inizia con prefisso lo prependiamo (+39).
function waLink(tel, codice, valore) {
    let n = String(tel).replace(/\D/g, '');
    if (n.length === 9 || n.length === 10) n = '39' + n;
    const msg = encodeURIComponent(`Ciao! 🎉 Hai un voucher WASH HUB da €${valore}: ${codice}\n\nUsalo alla prossima prenotazione su https://wash-hub.it/prenota — lo applichiamo in automatico.`);
    return `https://wa.me/${n}?text=${msg}`;
}
