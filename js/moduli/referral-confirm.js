// Conferma/rollback di un referral quando la prenotazione associata
// viene saldata (o ri-aperta). Aggiorna gli aggregati su /referral/{code}:
//   - confermaReferral:  inAttesa--, confermati++
//   - rollbackReferral:  confermati--, inAttesa++
//
// Il referrer (chi possiede il codice) maturare lo sconto è una decisione
// di prodotto separata: qui registriamo solo lo stato del conteggio.

import { db, fsDoc, fsCollection, fsGetDocs } from '../firebase-config.js';
import { setDoc, increment, serverTimestamp, query, where } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { state } from '../state.js';
import { creaVoucherReferral } from './vouchers.js';

const tel9 = t => String(t || '').replace(/\D/g, '').slice(-9);
// Nome normalizzato come nella function (referral-check.ts chiaveNome): parole ordinate, senza accenti
const chiaveNome = n => {
    const p = String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
        .replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
    return p.length >= 2 ? p.sort().join(' ') : '';
};

// Regola (Guido 22/10/2026): il codice amico vale SOLO se chi lo usa è un cliente NUOVO.
// Caso: Giuseppe Russo (cliente storico) ha prenotato col codice di Francesco Russo e ha
// avuto sconto + conferma referral. Qui controlliamo CRM (ultime 9 cifre) e prenotazioni/
// tappezzeria precedenti con lo stesso numero. Il sito fa lo stesso controllo via function,
// questo è la rete di sicurezza al saldo (prenotazioni vecchie o inserite a mano).
export async function amicoGiaCliente(entry) {
    const t = tel9(entry?.telefono);
    // Anagrafica: stesso telefono o stesso nome e cognome (Guido 23/10/2026)
    const kn = chiaveNome(entry?.cliente);
    if ((state.clientiDB || []).some(c => (t.length >= 9 && tel9(c.telefono) === t) || (kn && chiaveNome(c.nome) === kn))) return true;
    if (t.length < 9) return false;
    const t10 = '3' + t;
    const varianti = [...new Set([t10, t, '+39' + t10, '+39 ' + t10, '0039' + t10, '39' + t10,
        `+39 ${t10.slice(0, 3)} ${t10.slice(3)}`, `${t10.slice(0, 3)} ${t10.slice(3)}`])];
    try {
        const [pr, tp] = await Promise.all([
            fsGetDocs(query(fsCollection(db, 'prenotazioni'), where('telefono', 'in', varianti))),
            fsGetDocs(query(fsCollection(db, 'tappezzeria'), where('telefono', 'in', varianti))),
        ]);
        // Vale solo la PRIMA prenotazione del numero: conta ogni altra prenotazione non
        // disdetta precedente (data + ora), anche dello stesso giorno (caso Nicotra 23/10).
        const rif = `${entry.dataPren || ''} ${entry.orario || ''}`;
        let prima = false;
        pr.forEach(d => {
            if (d.id === entry._pid) return;
            const x = d.data();
            if (x.stato === 'DISDETTA') return;
            if (`${x.dataPren || ''} ${x.orario || ''}` < rif || (x.referral && x.referralConfermato === true)) prima = true;
        });
        if (prima) return true;
        return tp.size > 0;
    } catch (e) {
        console.warn('[referral] controllo già cliente fallito, considero valido', e?.message);
        return false;
    }
}

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
