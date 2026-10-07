// ─── SCHERMO CASSA (tablet al bancone) — 07/10/2026 ───
// All'incasso la dashboard scrive cassaDisplay/{sede}: il tablet (display.html) mostra
// "Grazie {nome}" + QR della card fedeltà legato al telefono. Mai bloccante per l'incasso.
import { db, fsDoc, fsSetDoc } from '../firebase-config.js';
import { state } from '../state.js';

function telDaCrm(nome) {
    const n = String(nome || '').trim().toUpperCase();
    return (state.clientiDB || []).find(c => String(c.nome || '').toUpperCase() === n)?.telefono || '';
}

export async function mostraSuDisplay({ telefono, nome, importo }) {
    try {
        const tel = String(telefono || telDaCrm(nome) || '').replace(/\D/g, '').replace(/^0039/, '').replace(/^39(?=3\d{8,9}$)/, '');
        if (!/^3\d{8,9}$/.test(tel)) return; // senza cellulare valido il QR non serve
        await fsSetDoc(fsDoc(db, 'cassaDisplay', state.sedeAttiva), {
            sedeId: state.sedeAttiva, telefono: tel, nome: String(nome || ''), importo: Number(importo) || 0,
            ts: Date.now(), operatore: state.currentUser?.user || '', azione: 'grazie'
        });
    } catch (e) { console.warn('schermo cassa:', e?.message); }
}
