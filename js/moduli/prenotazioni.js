import { db, fsCollection, fsAddDoc, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI } from '../utils.js';
import { logDelete } from './log.js';
import { renderCassa } from './cassa.js';

const PREN_SLOTS = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00'];

export function initPrenotazioni() {
    const prenData = document.getElementById('prenData');
    if (prenData) {
        // FIX ANTIPROIETTILE: Se la data è vuota all'avvio, forziamo "Oggi"
        if (!prenData.value) prenData.value = fmtDI(new Date());

        prenData.addEventListener('change', renderPren);
        const btns = prenData.parentElement.querySelectorAll('button');
        btns.forEach(btn => {
            if (btn.textContent.includes('Oggi')) {
                btn.addEventListener('click', () => { prenData.value = fmtDI(new Date()); renderPren(); });
            } else if (btn.textContent.includes('Ieri')) {
                btn.addEventListener('click', () => { moveDate(-1); });
            } else if (btn.textContent.includes('Domani')) {
                btn.addEventListener('click', () => { moveDate(1); });
            }
        });
    }

    const addPrenBtn = document.querySelector('#page-prenotazioni .form-panel.show:not([style*="bg4"]) .btn-primary');
    if (addPrenBtn) addPrenBtn.addEventListener('click', addPren);

    // Tappezzeria: cerchiamo il bottone "Registra IN" nel secondo form-panel
    const allPanels = document.querySelectorAll('#page-prenotazioni .form-panel');
    allPanels.forEach(panel => {
        const h3 = panel.querySelector('h3');
        if(h3 && h3.textContent.includes('Tappezzeria')) {
            const tapBtn = panel.querySelector('.btn-primary');
            if(tapBtn) tapBtn.addEventListener('click', addTap);
        }
    });

    document.getElementById('prenTb')?.addEventListener('click', handlePrenActions);
    document.getElementById('tapTb')?.addEventListener('click', handleTapActions);
}

// FIX: Ora spostare i giorni non genera più errori se il campo è vuoto
function moveDate(days) {
    const prenData = document.getElementById('prenData');
    let d = new Date(prenData.value);
    
    // Se la data calcolata non è valida (NaN), usiamo la data di oggi in automatico
    if (isNaN(d.getTime())) {
        d = new Date();
    }
    
    d.setDate(d.getDate() + days);
    prenData.value = fmtDI(d);
    renderPren();
}

export function renderPren() {
    const date = document.getElementById('prenData')?.value;
    if (!date) return;
    const dayData = state.prenDB[date] || [];
    const tb = document.getElementById('prenTb');
    if (!tb) return;

    let totCount = 0, incContanti = 0, incPos = 0, incSospesi = 0;
    let html = '';

    PREN_SLOTS.forEach(slot => {
        const isPausa = slot === '13:30';
        const entries = dayData.filter(e => e.orario === slot);

        if (isPausa && entries.length === 0) {
            html += `<tr style="background:rgba(240,165,0,.05)"><td style="font:600 11px var(--mono);color:var(--amb)">${slot}</td><td colspan="7" style="color:var(--amb);font-size:12px;font-style:italic">🍽️ Pausa pranzo (13:30 - 14:30)</td></tr>`;
            return;
        }

        if (entries.length === 0) {
            html += `<tr><td style="font:500 11px var(--mono);color:var(--tx3)">${slot}</td><td colspan="6" style="color:var(--tx3);font-size:11px">—</td><td><button class="act-btn quick-add" data-slot="${slot}" title="Aggiungi qui">+</button></td></tr>`;
        } else {
            entries.forEach((e, i) => {
                totCount++;
                const prezzo = pNum(e.prezzo);
                if (e.saldato === 'SI' && e.saldo === 'CONTANTI') incContanti += prezzo;
                else if (e.saldato === 'SI' && e.saldo === 'POS') incPos += prezzo;
                else incSospesi += prezzo;

                const isPaid = e.saldato === 'SI' && e.saldo !== 'SOSPESO';
                let pagHtml = e.saldo === 'SOSPESO' ? '<span class="badge a">SOSPESO ⏳</span>' :
                             isPaid ? '<span class="badge g">SALDATO ✓</span>' :
                             `<button class="btn pay-btn" data-id="${e._pid}" data-mod="CONTANTI">💵</button> 
                              <button class="btn pay-btn" data-id="${e._pid}" data-mod="POS">💳</button> 
                              <button class="btn pay-btn" data-id="${e._pid}" data-mod="SOSPESO" style="border-color:var(--amb);color:var(--amb)">⏳</button>`;

                html += `<tr ${isPaid ? 'style="opacity:.7"' : ''}>
                    <td style="font:500 11px var(--mono)">${i === 0 ? slot : ''}</td>
                    <td><strong>${esc(e.cliente || '')}</strong></td>
                    <td>${esc(e.vettura || '')}</td>
                    <td style="font:500 12px var(--mono)">${prezzo ? '€' + prezzo : '—'}</td>
                    <td>${pagHtml}</td>
                    <td>${e.saldo ? `<span class="badge ${e.saldo === 'SOSPESO' ? 'a' : 'b'}">${esc(e.saldo)}</span>` : '—'}</td>
                    <td style="font-size:11px;color:var(--tx2)">${esc(e.note || '')}</td>
                    <td>
                        <button class="act-btn edit-pren" data-id="${e._pid}">✎</button> 
                        ${e.saldato === 'SI' ? `<button class="act-btn undo-pay" data-id="${e._pid}">↩</button>` : `<button class="act-btn del del-pren" data-id="${e._pid}">✕</button>`}
                    </td></tr>`;
            });
        }
    });

    tb.innerHTML = html;
    document.getElementById('prenTotCount').textContent = totCount;
    document.getElementById('prenIncContanti').textContent = fEur(incContanti);
    document.getElementById('prenIncPos').textContent = fEur(incPos);
    document.getElementById('prenSospesi').textContent = fEur(incSospesi);
    renderCassa();
}

async function handlePrenActions(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    const date = document.getElementById('prenData').value;

    if (btn.classList.contains('quick-add')) {
        document.getElementById('pOrario').value = btn.dataset.slot;
        document.getElementById('pCliente').focus();
    } else if (btn.classList.contains('pay-btn')) {
        markPaid(date, id, btn.dataset.mod);
    } else if (btn.classList.contains('undo-pay')) {
        unmarkPaid(date, id);
    } else if (btn.classList.contains('del-pren')) {
        delPren(date, id);
    } else if (btn.classList.contains('edit-pren')) {
        editPren(date, id);
    }
}

async function addPren() {
    const date = document.getElementById('prenData').value;
    const obj = {
        dataPren: date,
        orario: document.getElementById('pOrario').value,
        cliente: document.getElementById('pCliente').value.trim().toUpperCase(),
        vettura: document.getElementById('pVettura').value.trim().toUpperCase(),
        prezzo: document.getElementById('pPrezzo').value.trim(),
        note: document.getElementById('pNote').value.trim(),
        saldo: '', saldato: ''
    };
    if (!obj.cliente || !obj.vettura || !obj.prezzo) return alert("Compila i campi obbligatori!");

    try {
        const ref = await fsAddDoc(fsCollection(db, "prenotazioni"), obj);
        obj._pid = ref.id;
        if (!state.prenDB[date]) state.prenDB[date] = [];
        state.prenDB[date].push(obj);
        renderPren();
        ['pCliente','pVettura','pPrezzo','pNote'].forEach(id => document.getElementById(id).value = '');
    } catch(e) { console.error(e); }
}

async function markPaid(date, pid, mod) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return;
    try {
        await fsUpdateDoc(fsDoc(db, "prenotazioni", pid), { saldato: 'SI', saldo: mod });
        entry.saldato = 'SI'; entry.saldo = mod;
        renderPren();
    } catch(e) { alert("Errore Cloud"); }
}

async function unmarkPaid(date, pid) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return;
    try {
        await fsUpdateDoc(fsDoc(db, "prenotazioni", pid), { saldato: '', saldo: '' });
        entry.saldato = ''; entry.saldo = '';
        renderPren();
    } catch(e) { alert("Errore Cloud"); }
}

async function delPren(date, pid) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return;
    const motivazione = prompt(`Motivo cancellazione per ${entry.cliente}?`);
    if (!motivazione) return;

    try {
        await logDelete('PRENOTAZIONI', `${entry.cliente} - ${entry.vettura}`, motivazione);
        await fsDeleteDoc(fsDoc(db, "prenotazioni", pid));
        state.prenDB[date] = state.prenDB[date].filter(e => e._pid !== pid);
        renderPren();
    } catch(e) { alert("Errore Cloud"); }
}

async function editPren(date, pid) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return;
    
    const nuovoCliente = prompt('Nominativo:', entry.cliente);
    if (nuovoCliente === null) return;
    const nuovaVettura = prompt('Vettura:', entry.vettura);
    if (nuovaVettura === null) return;
    const nuovoPrezzo = prompt('Prezzo €:', entry.prezzo);
    if (nuovoPrezzo === null) return;
    const nuoveNote = prompt('Note:', entry.note || '');
    if (nuoveNote === null) return;
    
    const updates = {
        cliente: nuovoCliente.trim().toUpperCase(),
        vettura: nuovaVettura.trim().toUpperCase(),
        prezzo: nuovoPrezzo.trim(),
        note: nuoveNote.trim()
    };
    
    try {
        await fsUpdateDoc(fsDoc(db, "prenotazioni", pid), updates);
        Object.assign(entry, updates);
        renderPren();
    } catch(e) { alert("Errore Cloud"); }
}

export function renderTap() {
    const tb = document.getElementById('tapTb');
    if (!tb) return;
    let html = '';
    const sorted = [...state.tapDB].sort((a,b) => (a.status === 'IN' ? -1 : 1));
    sorted.forEach(t => {
        const isOut = t.status === 'OUT';
        html += `<tr ${isOut ? 'style="opacity:0.6"' : ''}>
            <td>${t.dataIn}</td>
            <td><strong>${esc(t.cliente)}</strong></td>
            <td>${esc(t.modello)}</td>
            <td>${esc(t.targa)}</td>
            <td style="font-weight:600">€${pNum(t.prezzo)}</td>
            <td><span class="badge ${isOut ? 'r' : 'g'} status-tap" style="cursor:pointer" data-id="${t._id}">${t.status} ${isOut ? '('+t.pagamento+')' : '(In lav.)'}</span></td>
            <td><button class="act-btn del del-tap" data-id="${t._id}">✕</button></td></tr>`;
    });
    tb.innerHTML = html || '<tr><td colspan="7" class="empty">Nessuna tappezzeria</td></tr>';
}

async function addTap() {
    const msg = document.getElementById('tapMsg');
    const obj = {
        dataIn: new Date().toLocaleDateString('it-IT'),
        cliente: document.getElementById('tCliente').value.trim().toUpperCase(),
        modello: document.getElementById('tModello').value.trim().toUpperCase(),
        targa: document.getElementById('tTarga').value.trim().toUpperCase(),
        prezzo: document.getElementById('tPrezzo').value.trim(),
        status: 'IN', pagamento: '', dataOut: ''
    };
    if(!obj.cliente || !obj.modello || !obj.prezzo) {
        if(msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Compila Cliente, Modello e Prezzo!'; }
        return;
    }
    try {
        const ref = await fsAddDoc(fsCollection(db, "tappezzeria"), obj);
        obj._id = ref.id;
        state.tapDB.push(obj);
        renderTap();
        ['tCliente','tModello','tTarga','tPrezzo'].forEach(id => document.getElementById(id).value = '');
        if(msg) { msg.style.color = 'var(--grn)'; msg.textContent = 'Tappezzeria registrata!'; setTimeout(() => msg.textContent = '', 2000); }
    } catch(e) { console.error(e); if(msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Errore connessione Cloud'; } }
}

async function handleTapActions(e) {
    const id = e.target.dataset.id || e.target.closest('button')?.dataset.id;
    if (!id) return;
    if (e.target.classList.contains('status-tap')) toggleTap(id);
    else if (e.target.closest('.del-tap')) delTap(id);
}

async function toggleTap(id) {
    const t = state.tapDB.find(x => x._id === id);
    if (!t) return;
    try {
        if (t.status === 'IN') {
            const mod = prompt("Metodo pagamento (CONTANTI, POS, SOSPESO)?", "CONTANTI");
            if (!mod) return;
            const dataOut = new Date().toLocaleDateString('it-IT');
            await fsUpdateDoc(fsDoc(db, "tappezzeria", id), { status: 'OUT', pagamento: mod.toUpperCase(), dataOut: dataOut });
            t.status = 'OUT'; t.pagamento = mod.toUpperCase(); t.dataOut = dataOut;
        } else {
            await fsUpdateDoc(fsDoc(db, "tappezzeria", id), { status: 'IN', pagamento: '', dataOut: '' });
            t.status = 'IN'; t.pagamento = ''; t.dataOut = '';
        }
        renderTap();
        renderCassa();
    } catch(e) { alert("Errore Cloud"); }
}

async function delTap(id) {
    const t = state.tapDB.find(x => x._id === id);
    if (!t) return;
    const motivazione = prompt("Motivo cancellazione tappezzeria?");
    if (!motivazione || motivazione.trim() === '') { alert("❌ Cancellazione annullata: motivazione mancante."); return; }
    try {
        await logDelete('TAPPEZZERIA', `${t.cliente} - ${t.modello}`, motivazione.trim());
        await fsDeleteDoc(fsDoc(db, "tappezzeria", id));
        state.tapDB = state.tapDB.filter(x => x._id !== id);
        renderTap();
        renderCassa();
    } catch(e) { alert("Errore Cloud"); }
}
