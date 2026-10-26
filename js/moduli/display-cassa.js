// ─── SCHERMO CASSA (tablet al bancone) — 07/10/2026 ───
// All'incasso la dashboard scrive cassaDisplay/{sede}: il tablet (display.html) mostra
// "Grazie {nome}" + QR della card fedeltà legato al telefono. Mai bloccante per l'incasso.
import { db, fsDoc, fsSetDoc } from '../firebase-config.js';
import { state } from '../state.js';

function telDaCrm(nome) {
    const n = String(nome || '').trim().toUpperCase();
    return (state.clientiDB || []).find(c => String(c.nome || '').toUpperCase() === n)?.telefono || '';
}

// Avviso all'operatore: con telefono finto/assente (es. 000000000) il tablet non mostra la card (Guido 26/10/2026)
function avvisoNumeroMancante(nome) {
    const t = document.createElement('div');
    t.setAttribute('role', 'alert');
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);max-width:min(420px,calc(100vw - 32px));background:var(--bg2);color:var(--tx);border:1.5px solid var(--red,#d33);border-left:5px solid var(--red,#d33);padding:12px 16px;border-radius:var(--r2,12px);font:500 13px var(--f);z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer';
    t.innerHTML = '<div style="font-weight:700;color:var(--red,#d33)">⚠️ Numero mancante</div><div style="margin-top:2px">Impossibile caricare la fidelity' + (nome ? ' per <b></b>' : '') + '. Chiedi il cellulare e aggiornalo in anagrafica.</div>';
    if (nome) t.querySelector('b').textContent = String(nome);
    t.addEventListener('click', () => t.remove());
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 8000);
}

export async function mostraSuDisplay({ telefono, nome, importo }) {
    try {
        const tel = String(telefono || telDaCrm(nome) || '').replace(/\D/g, '').replace(/^0039/, '').replace(/^39(?=3\d{8,9}$)/, '');
        if (!/^3\d{8,9}$/.test(tel)) { avvisoNumeroMancante(nome); return; } // senza cellulare valido niente QR
        await fsSetDoc(fsDoc(db, 'cassaDisplay', state.sedeAttiva), {
            sedeId: state.sedeAttiva, telefono: tel, nome: String(nome || ''), importo: Number(importo) || 0,
            ts: Date.now(), operatore: state.currentUser?.user || '', azione: 'grazie'
        });
    } catch (e) { console.warn('schermo cassa:', e?.message); }
}
