import { db, fsCollection, fsAddDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI } from '../utils.js';
import { logDelete } from './log.js';
import { renderCassa } from './cassa.js';

// Categorie disponibili (label visualizzata + valore salvato in DB)
const CATEGORIE = [
    { val: 'SELF_SERVICE', label: 'Self-Service', icon: '🚿' },
    { val: 'LAVAGGIO_MANO', label: 'Lavaggio a Mano', icon: '🧽' }
];

export function initIncassiManuali() {
    const addBtn = document.getElementById('imAddBtn');
    if (addBtn) addBtn.addEventListener('click', addIncasso);

    const tb = document.getElementById('imTb');
    if (tb) {
        tb.addEventListener('click', (e) => {
            const btn = e.target.closest('.del');
            if (btn) {
                const id = btn.getAttribute('data-id');
                if (id) delIncasso(id);
            }
        });
    }
}

// Render solo della tabella + form (visibile solo a paesi-etnei via CSS .pe-only)
export function renderIncassiManuali() {
    const cassaDataEl = document.getElementById('cassaData');
    if (!cassaDataEl) return;
    if (!cassaDataEl.value) cassaDataEl.value = fmtDI(new Date());
    const dStr = cassaDataEl.value;

    const tb = document.getElementById('imTb');
    if (!tb) return;

    const lista = (state.incassiManualiDB || [])
        .filter(i => i.dataISO === dStr)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (lista.length === 0) {
        tb.innerHTML = '<tr><td colspan="5" class="empty">Nessun incasso registrato oggi</td></tr>';
    } else {
        tb.innerHTML = lista.map(i => {
            const cat = CATEGORIE.find(c => c.val === i.categoria);
            const catLabel = cat ? `${cat.icon} ${cat.label}` : i.categoria;
            const badgeCls = i.metodo === 'POS' ? 'b' : 'g';
            return `<tr>
                <td style="font:400 11px var(--mono)">${esc(i.orario || '')}</td>
                <td><strong>${catLabel}</strong></td>
                <td><span class="badge ${badgeCls}">${esc(i.metodo)}</span></td>
                <td style="font-weight:600;color:var(--grn)">€${pNum(i.importo)}</td>
                <td><button class="act-btn del" data-id="${i._id}">✕</button></td>
            </tr>`;
        }).join('');
    }
}

async function addIncasso() {
    const cassaData = document.getElementById('cassaData');
    const categoria = document.getElementById('imCategoria')?.value;
    const metodo = document.getElementById('imMetodo')?.value;
    const importoRaw = document.getElementById('imImporto')?.value.trim();

    if (!cassaData?.value || !categoria || !metodo || !importoRaw) {
        alert('Compila tutti i campi!');
        return;
    }
    const importo = parseFloat(importoRaw.replace(',', '.'));
    if (!importo || importo <= 0) { alert('Importo non valido'); return; }

    const dStr = cassaData.value;
    const dIta = dStr.split('-').reverse().join('/');
    const now = new Date();
    const orario = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    const obj = {
        dataISO: dStr,
        data: dIta,
        orario,
        timestamp: now.getTime(),
        categoria,
        metodo,
        importo,
        sedeId: state.sedeAttiva
    };

    try {
        const ref = await fsAddDoc(fsCollection(db, 'incassiManuali'), obj);
        obj._id = ref.id;
        state.incassiManualiDB.push(obj);

        // Scrivi anche in Prima Nota per coerenza con il resto dei flussi
        try {
            const catLabel = CATEGORIE.find(c => c.val === categoria)?.label || categoria;
            await fsAddDoc(fsCollection(db, 'primaNota'), {
                DATA: dIta, dataISO: dStr,
                'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO',
                'PRIMANOTA CLIENTI/FORNITORI': `Incasso ${catLabel}`,
                Descrizione: `Incasso manuale ${catLabel}`,
                ENTRATA: importo, Entrata: importo,
                USCITE: 0, Uscite: 0,
                SOSPESO: 0, Sospeso: 0,
                "MODALITA'": metodo, timestamp: now.getTime(),
                sedeId: state.sedeAttiva
            });
        } catch (e) { console.warn('Errore Prima Nota incasso manuale:', e); }

        const importoEl = document.getElementById('imImporto');
        if (importoEl) importoEl.value = '';

        renderIncassiManuali();
        renderCassa();
    } catch (e) {
        console.error('Errore salvataggio incasso manuale:', e);
        alert('Errore Cloud');
    }
}

async function delIncasso(id) {
    const inc = state.incassiManualiDB.find(x => x._id === id);
    if (!inc) return;
    const motivazione = prompt(`Eliminare incasso di €${pNum(inc.importo)} (${inc.categoria})?\nMotivo (OBBLIGATORIO):`);
    if (!motivazione) return;
    try {
        await logDelete('INCASSI MANUALI', `${inc.categoria} ${inc.metodo} €${pNum(inc.importo)} del ${inc.data}`, motivazione.trim());
        await fsDeleteDoc(fsDoc(db, 'incassiManuali', id));
        state.incassiManualiDB = state.incassiManualiDB.filter(x => x._id !== id);
        renderIncassiManuali();
        renderCassa();
    } catch (e) {
        console.error('Errore eliminazione incasso manuale:', e);
        alert('Errore Cloud');
    }
}
