import { db, fsCollection, fsAddDoc, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI, normalizeName, nameSimilarity } from '../utils.js';
import { logDelete } from './log.js';
import { renderCassa } from './cassa.js';
import { autoSalvaCliente, checkClienteDuplicato, showThankYouToast } from './clienti.js';

const PREN_SLOTS = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00'];

export function initPrenotazioni() {
    const prenData = document.getElementById('prenData');
    if (prenData) {
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

function moveDate(days) {
    const prenData = document.getElementById('prenData');
    let d = new Date(prenData.value);
    if (isNaN(d.getTime())) d = new Date();
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
    if (btn.disabled) return;
    const id = btn.dataset.id;
    const date = document.getElementById('prenData').value;

    if (btn.classList.contains('quick-add')) {
        document.getElementById('pOrario').value = btn.dataset.slot;
        document.getElementById('pCliente').focus();
    } else if (btn.classList.contains('pay-btn')) {
        btn.disabled = true;
        try { await markPaid(date, id, btn.dataset.mod); } finally { btn.disabled = false; }
    } else if (btn.classList.contains('undo-pay')) {
        btn.disabled = true;
        try { await unmarkPaid(date, id); } finally { btn.disabled = false; }
    } else if (btn.classList.contains('del-pren')) {
        await delPren(date, id);
    } else if (btn.classList.contains('edit-pren')) {
        await editPren(date, id);
    }
}

async function addPren() {
    const date = document.getElementById('prenData').value;
    const telefono = document.getElementById('pTelefono')?.value.trim() || '';
    const prezzoRaw = document.getElementById('pPrezzo').value.trim();
    const inputNome = document.getElementById('pCliente').value;
    const inputVett = document.getElementById('pVettura').value;

    if (!inputNome.trim() || !inputVett.trim() || !prezzoRaw || !telefono) return alert("Compila i campi obbligatori (Nominativo, Telefono, Vettura, Prezzo)!");
    const prezzoNum = parseFloat(prezzoRaw.replace(',', '.'));
    if (isNaN(prezzoNum) || prezzoNum < 0) return alert("⚠️ Prezzo non valido! Inserisci un numero (es. 25 oppure 25,50).");

    // Hard autocomplete: se esistono clienti simili, forza scelta o conferma "nuovo"
    const clienteFinale = await checkClienteDuplicato(inputNome);
    if (clienteFinale === null) return; // utente ha annullato

    const obj = {
        dataPren: date,
        orario: document.getElementById('pOrario').value,
        cliente: clienteFinale,
        telefono: telefono,
        vettura: normalizeName(inputVett),
        prezzo: prezzoRaw,
        note: document.getElementById('pNote').value.trim(),
        saldo: '', saldato: ''
    };

    try {
        const ref = await fsAddDoc(fsCollection(db, "prenotazioni"), obj);
        obj._pid = ref.id;
        if (!state.prenDB[date]) state.prenDB[date] = [];
        state.prenDB[date].push(obj);
        
        // Auto-salva cliente nel CRM con telefono
        await autoSalvaCliente(obj.cliente, obj.vettura, '', obj.telefono);

        renderPren();
        ['pCliente','pTelefono','pVettura','pPrezzo','pNote'].forEach(id => document.getElementById(id).value = '');
    } catch(e) { console.error(e); }
}

async function markPaid(date, pid, mod) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return;
    try {
        await fsUpdateDoc(fsDoc(db, "prenotazioni", pid), { saldato: 'SI', saldo: mod });
        entry.saldato = 'SI'; entry.saldo = mod;
        renderPren();
        // Trigger ringraziamento WhatsApp (non blocking)
        showThankYouToast(entry.cliente, pNum(entry.prezzo));
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
    // Validazione numerica (accetta "25", "25,50", "25.50")
    const prezzoTrim = nuovoPrezzo.trim();
    const prezzoNum = parseFloat(prezzoTrim.replace(',', '.'));
    if (prezzoTrim && (isNaN(prezzoNum) || prezzoNum < 0)) {
        alert("⚠️ Prezzo non valido! Usa un numero (es. 25 oppure 25,50).");
        return;
    }
    const nuoveNote = prompt('Note:', entry.note || '');
    if (nuoveNote === null) return;

    const updates = {
        cliente: normalizeName(nuovoCliente),
        vettura: normalizeName(nuovaVettura),
        prezzo: prezzoTrim,
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

    const inLav = state.tapDB.filter(t => t.status === 'IN');
    const oggi = new Date().toLocaleDateString('it-IT');
    const outOggi = state.tapDB.filter(t => t.status === 'OUT' && t.dataOut === oggi);

    let html = '';
    if (inLav.length === 0) {
        html = '<tr><td colspan="7" class="empty">Nessuna tappezzeria in lavorazione</td></tr>';
    } else {
        inLav.forEach(t => {
            html += `<tr>
                <td>${t.dataIn}</td>
                <td><strong>${esc(t.cliente)}</strong></td>
                <td>${esc(t.modello)}</td>
                <td>${esc(t.targa)}</td>
                <td style="font-weight:600">€${pNum(t.prezzo)}</td>
                <td><span class="badge g status-tap" style="cursor:pointer" data-id="${t._id}">IN (In lav.)</span></td>
                <td><button class="act-btn del del-tap" data-id="${t._id}">✕</button></td></tr>`;
        });
    }
    tb.innerHTML = html;

    // Sezione completate oggi
    let outSection = document.getElementById('tapOutSection');
    if (!outSection) {
        outSection = document.createElement('div');
        outSection.id = 'tapOutSection';
        tb.closest('.tbl-wrap')?.after(outSection);
    }

    if (outOggi.length > 0) {
        let outHtml = `<div style="margin-top:14px;margin-bottom:6px;font:600 11px var(--mono);color:var(--tx3);text-transform:uppercase;letter-spacing:0.5px">✅ Completate Oggi</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Entrata</th><th>Uscita</th><th>Cliente</th><th>Modello</th><th>Targa</th><th>Prezzo</th><th>Pagamento</th></tr></thead><tbody>`;
        outOggi.forEach(t => {
            outHtml += `<tr style="opacity:0.6">
                <td>${t.dataIn}</td>
                <td>${t.dataOut || '—'}</td>
                <td>${esc(t.cliente)}</td>
                <td>${esc(t.modello)}</td>
                <td>${esc(t.targa)}</td>
                <td style="font-weight:600">€${pNum(t.prezzo)}</td>
                <td><span class="badge ${t.pagamento === 'SOSPESO' ? 'a' : 'b'}">${t.pagamento || '—'}</span></td>
            </tr>`;
        });
        outHtml += '</tbody></table></div>';
        outSection.innerHTML = outHtml;
    } else {
        outSection.innerHTML = '';
    }
}

async function addTap() {
    const msg = document.getElementById('tapMsg');
    const inputNome = document.getElementById('tCliente').value;
    const modelloRaw = document.getElementById('tModello').value;
    const prezzoRaw = document.getElementById('tPrezzo').value.trim();

    if(!inputNome.trim() || !modelloRaw.trim() || !prezzoRaw) {
        if(msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Compila Cliente, Modello e Prezzo!'; }
        return;
    }

    // Hard autocomplete: scelta obbligata se ci sono simili
    const clienteFinale = await checkClienteDuplicato(inputNome);
    if (clienteFinale === null) return;

    const obj = {
        dataIn: new Date().toLocaleDateString('it-IT'),
        cliente: clienteFinale,
        modello: normalizeName(modelloRaw),
        targa: normalizeName(document.getElementById('tTarga').value),
        prezzo: prezzoRaw,
        status: 'IN', pagamento: '', dataOut: ''
    };
    try {
        const ref = await fsAddDoc(fsCollection(db, "tappezzeria"), obj);
        obj._id = ref.id;
        state.tapDB.push(obj);
        
        // Auto-salva cliente nel CRM
        await autoSalvaCliente(obj.cliente, obj.modello, obj.targa, '');

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
            const modUp = mod.toUpperCase();
            const dataOut = new Date().toLocaleDateString('it-IT');
            const dataISO = fmtDI(new Date());
            await fsUpdateDoc(fsDoc(db, "tappezzeria", id), { status: 'OUT', pagamento: modUp, dataOut: dataOut });
            t.status = 'OUT'; t.pagamento = modUp; t.dataOut = dataOut;
            
            // Scrivi in Prima Nota se non è sospeso
            if (modUp !== 'SOSPESO') {
                // Ringraziamento WhatsApp (post saldo, non per sospesi/fatturati)
                if (modUp !== 'FATTURATO') showThankYouToast(t.cliente, parseFloat(t.prezzo) || 0);
                try {
                    const imp = parseFloat(t.prezzo) || 0;
                    await fsAddDoc(fsCollection(db, "primaNota"), {
                        DATA: dataOut, dataISO: dataISO,
                        'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO',
                        'PRIMANOTA CLIENTI/FORNITORI': 'TAPPEZZERIA ' + (t.cliente || '') + ' ' + (t.modello || ''),
                        Descrizione: 'TAPPEZZERIA ' + (t.cliente || '') + ' ' + (t.modello || ''),
                        ENTRATA: imp, Entrata: imp,
                        USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0,
                        "MODALITA'": modUp, timestamp: Date.now()
                    });
                } catch(e) { console.warn("Errore Prima Nota tappezzeria:", e); }
            }
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
