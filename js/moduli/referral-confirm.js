// Conferma/rollback di un referral quando la prenotazione associata
// viene saldata (o ri-aperta). Aggiorna gli aggregati su /referral/{code}:
//   - confermaReferral:  inAttesa--, confermati++
//   - rollbackReferral:  confermati--, inAttesa++
//
// Il referrer (chi possiede il codice) maturare lo sconto è una decisione
// di prodotto separata: qui registriamo solo lo stato del conteggio.

import { db, fsDoc } from '../firebase-config.js';
import { setDoc, increment, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { creaVoucherReferral } from './vouchers.js';

function getCode(entry) {
    const raw = entry?.referral;
    if (!raw || typeof raw !== 'string') return null;
    const code = raw.trim().toUpperCase();
    return code.length >= 4 ? code : null;
}

export async function confermaReferral(entry) {
    const code = getCode(entry);
    if (!code) return;
    if (entry.referralConfermato === true) return; // idempotente
    try {
        await setDoc(fsDoc(db, 'referral', code), {
            inAttesa: increment(-1),
            confermati: increment(1),
            ultimaConferma: serverTimestamp()
        }, { merge: true });
        entry.referralConfermato = true;
    } catch (e) {
        console.warn('[referral-confirm] errore conferma', code, e?.message);
    }

    // Genera il voucher per il referrer (best-effort, non blocca il saldo)
    try {
        const codiceVoucher = await creaVoucherReferral(entry);
        if (codiceVoucher) entry.voucherEmesso = codiceVoucher;
    } catch (e) {
        console.warn('[referral-confirm] errore voucher', code, e?.message);
    }
}

export async function rollbackReferral(entry) {
    const code = getCode(entry);
    if (!code) return;
    if (entry.referralConfermato !== true) return;
    try {
        await setDoc(fsDoc(db, 'referral', code), {
            confermati: increment(-1),
            inAttesa: increment(1),
            ultimaConferma: serverTimestamp()
        }, { merge: true });
        entry.referralConfermato = false;
    } catch (e) {
        console.warn('[referral-confirm] errore rollback', code, e?.message);
    }
}

// Usato quando una prenotazione con referral viene cancellata PRIMA del saldo.
// Decrementa totale e inAttesa (annulla l'incremento fatto dal sito al booking).
export async function rollbackReferralNonConfermato(entry) {
    const code = getCode(entry);
    if (!code) return;
    if (entry.referralConfermato === true) return; // se confermato, NON rollback (vedi delPren)
    try {
        await setDoc(fsDoc(db, 'referral', code), {
            totale: increment(-1),
            inAttesa: increment(-1)
        }, { merge: true });
    } catch (e) {
        console.warn('[referral-confirm] errore rollback non-confermato', code, e?.message);
    }
}
