// ─── ⚡ PRIORITY — impostazioni (13/10/2026) ───
// Pannello solo admin per config/priority, letta dalla Cloud Function `priority`:
// ora calda = ≥ soglia auto nell'ora → il sito vende maxPerOra posti a +supplemento € (pagati online).
import { db, auth, onAuthStateChanged, fsDoc, fsGetDoc, fsSetDoc } from '../firebase-config.js';
import { isAdmin } from './auth.js';

export function initPriorityConfig() {
    const btn = document.getElementById('priorityCfgBtn');
    if (!btn) return;
    // init gira prima del login: il pulsante si mostra solo quando l'utente admin è noto
    btn.style.display = 'none';
    onAuthStateChanged(auth, () => { btn.style.display = isAdmin() ? '' : 'none'; });
    btn.addEventListener('click', () => { if (isAdmin()) apri(); });
}

async function apri() {
    let c = { attivo: true, soglia: 3, maxPerOra: 1, supplemento: 5 };
    try { const s = await fsGetDoc(fsDoc(db, 'config', 'priority')); if (s.exists()) c = { ...c, ...s.data() }; } catch (e) { /* default */ }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10002;display:flex;align-items:flex-start;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);overflow-y:auto';
    const campo = (id, label, val, hint) => `<label style="display:block;margin:12px 0 0;font-size:12px;color:var(--tx2)">${label}
        <input id="${id}" type="number" min="0" value="${val}" style="display:block;width:100%;margin-top:4px;background:var(--bg3);border:1px solid var(--brd);color:var(--tx);border-radius:var(--r2);padding:8px;font:400 14px var(--mono)">
        <span style="font-size:11px;color:var(--tx3)">${hint}</span></label>`;
    overlay.innerHTML = `<div style="background:var(--bg2);border-radius:var(--r);padding:22px 20px;max-width:440px;width:100%;box-shadow:var(--shadow-xl);margin-top:10px">
        <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">⚡ Priority sul sito</h3><button class="btn" id="pcClose">✕</button></div>
        <label style="display:flex;gap:8px;align-items:center;margin-top:14px;font-size:13px"><input type="checkbox" id="pcAttivo" ${c.attivo !== false ? 'checked' : ''}> Attivo</label>
        ${campo('pcSoglia', 'Ora calda da', c.soglia, 'auto già in quell’ora (prenotate + inserite in cassa)')}
        ${campo('pcMax', 'Posti Priority per ora', c.maxPerOra, 'quanti posti si vendono in un’ora calda (0 = nessuno)')}
        ${campo('pcSupp', 'Supplemento €', c.supplemento, 'pagato subito online con SumUp')}
        <button class="btn btn-primary" id="pcSalva" style="width:100%;margin-top:16px">Salva</button>
        <p id="pcEsito" style="font-size:12px;margin:8px 0 0;color:var(--tx3)"></p></div>`;
    document.body.appendChild(overlay);
    const chiudi = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) chiudi(); });
    overlay.querySelector('#pcClose').onclick = chiudi;
    overlay.querySelector('#pcSalva').onclick = async () => {
        const n = id => Math.max(0, Math.round(Number(overlay.querySelector(id).value) || 0));
        const nuovo = { attivo: overlay.querySelector('#pcAttivo').checked, soglia: Math.max(1, n('#pcSoglia')), maxPerOra: n('#pcMax'), supplemento: Math.max(1, n('#pcSupp')) };
        try { await fsSetDoc(fsDoc(db, 'config', 'priority'), nuovo, { merge: true }); overlay.querySelector('#pcEsito').textContent = '✓ Salvato: vale subito sul sito.'; }
        catch (e) { overlay.querySelector('#pcEsito').textContent = 'Errore: ' + (e?.message || e); }
    };
}
