import { db, fsCollection, fsAddDoc, fsUpdateDoc, fsDeleteDoc, fsDoc, fsGetDocs } from '../firebase-config.js';
import { fEur } from '../utils.js';

let _servizi = [];
let _loaded = false;

export async function loadServiziAttivi() {
    if (!_loaded) await _loadFromFirestore();
    return _servizi.filter(s => s.attivo !== false);
}

async function _loadFromFirestore() {
    try {
        const snap = await fsGetDocs(fsCollection(db, 'serviziAccessori'));
        _servizi = [];
        snap.forEach(docSnap => {
            const d = docSnap.data(); d._id = docSnap.id;
            _servizi.push(d);
        });
        _loaded = true;
    } catch (e) {
        console.warn('serviziAccessori non caricati:', e.message);
    }
}

export async function initServiziAggiuntivi() {
    await _loadFromFirestore();
    renderPanel();
    wireForm();
}

function renderPanel() {
    const container = document.getElementById('serviziList');
    if (!container) return;

    if (_servizi.length === 0) {
        container.innerHTML = '<div style="color:var(--tx3);font-size:13px;padding:12px 0">Nessun servizio configurato. Aggiungine uno qui sotto.</div>';
        return;
    }

    container.innerHTML = _servizi.map(s => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border-radius:var(--r2);border:1px solid var(--brd)">
            <div style="flex:1;font:500 13px var(--f)">${_esc(s.nome)}</div>
            <div style="font:600 13px var(--mono);min-width:60px;text-align:right">${fEur(s.prezzo)}</div>
            <label style="display:flex;align-items:center;gap:5px;font:400 12px var(--f);cursor:pointer;white-space:nowrap">
                <input type="checkbox" class="sa-toggle" data-id="${s._id}" ${s.attivo !== false ? 'checked' : ''} style="cursor:pointer">
                Attivo
            </label>
            <button class="act-btn sa-edit" data-id="${s._id}" title="Modifica prezzo">✎</button>
            <button class="act-btn del sa-del" data-id="${s._id}" title="Elimina">✕</button>
        </div>
    `).join('');
}

function wireForm() {
    document.getElementById('btnSalvaServizio')?.addEventListener('click', addServizio);
    document.getElementById('sNome')?.addEventListener('keydown', e => { if (e.key === 'Enter') addServizio(); });

    const list = document.getElementById('serviziList');
    if (!list) return;

    list.addEventListener('change', async e => {
        const chk = e.target.closest('.sa-toggle');
        if (!chk) return;
        const id = chk.dataset.id;
        const attivo = chk.checked;
        try {
            await fsUpdateDoc(fsDoc(db, 'serviziAccessori', id), { attivo });
            const s = _servizi.find(x => x._id === id);
            if (s) s.attivo = attivo;
        } catch {
            alert('Errore aggiornamento');
            chk.checked = !attivo;
        }
    });

    list.addEventListener('click', async e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const id = btn.dataset.id;
        const s = _servizi.find(x => x._id === id);
        if (!s) return;

        if (btn.classList.contains('sa-edit')) {
            const val = prompt(`Nuovo prezzo per "${s.nome}":`, s.prezzo);
            if (val === null) return;
            const p = parseFloat(val.replace(',', '.'));
            if (isNaN(p) || p <= 0) return alert('Prezzo non valido');
            try {
                await fsUpdateDoc(fsDoc(db, 'serviziAccessori', id), { prezzo: p });
                s.prezzo = p;
                renderPanel();
            } catch { alert('Errore aggiornamento'); }
        }

        if (btn.classList.contains('sa-del')) {
            if (!confirm(`Eliminare "${s.nome}"?`)) return;
            try {
                await fsDeleteDoc(fsDoc(db, 'serviziAccessori', id));
                _servizi = _servizi.filter(x => x._id !== id);
                renderPanel();
            } catch { alert('Errore eliminazione'); }
        }
    });
}

async function addServizio() {
    const nomeEl = document.getElementById('sNome');
    const prezzoEl = document.getElementById('sPrezzo');
    const nome = nomeEl?.value.trim();
    const prezzo = parseFloat(prezzoEl?.value.replace(',', '.'));

    if (!nome) { nomeEl?.focus(); return alert('Inserisci il nome del servizio'); }
    if (isNaN(prezzo) || prezzo <= 0) { prezzoEl?.focus(); return alert('Inserisci un prezzo valido'); }

    try {
        const ref = await fsAddDoc(fsCollection(db, 'serviziAccessori'), { nome, prezzo, attivo: true });
        _servizi.push({ _id: ref.id, nome, prezzo, attivo: true });
        renderPanel();
        if (nomeEl) nomeEl.value = '';
        if (prezzoEl) prezzoEl.value = '';
        nomeEl?.focus();
    } catch { alert('Errore salvataggio'); }
}

function _esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
