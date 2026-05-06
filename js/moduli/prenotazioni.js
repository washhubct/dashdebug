import { db, fsCollection, fsAddDoc, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI, normalizeName, nameSimilarity } from '../utils.js';
import { logDelete } from './log.js';
import { renderCassa } from './cassa.js';
import { autoSalvaCliente, checkClienteDuplicato, showThankYouToast, showConfirmPrenToast, showWelcomePrenToast, showWelcomeToast } from './clienti.js';
import { avviaPagamento, healthBridge } from './cassa-automatica.js';
import { loadServiziAttivi } from './servizi-aggiuntivi.js';

const PREN_SLOTS = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00'];

// Ritorna true se il telefono ha almeno 9 cifre (ignora spazi, +, -)
function validaTelefono(tel) {
    return (tel.replace(/[\s\-\+\.]/g, '').match(/\d/g) || []).length >= 9;
}

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
        try {
            const mod = btn.dataset.mod;
            const serviziExtra = mod !== 'SOSPESO' ? await mostraModalServizi(date, id) : [];
            await markPaid(date, id, mod, serviziExtra);
        } finally { btn.disabled = false; }
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
    const inputNome = document.getElementById('pCliente').value;
    const telefono = document.getElementById('pTelefono')?.value.trim() || '';
    const inputVett = document.getElementById('pVettura').value;
    const prezzoRaw = document.getElementById('pPrezzo').value.trim();
    const msg = document.getElementById('prenMsg');

    const showErr = (text, focusId) => {
        if (msg) { msg.style.color = 'var(--red)'; msg.textContent = text; }
        document.getElementById(focusId)?.focus();
    };

    if (!inputNome.trim()) return showErr('⚠️ Inserisci il nominativo', 'pCliente');
    if (!telefono) return showErr('⚠️ Il numero di telefono è obbligatorio', 'pTelefono');
    if (!validaTelefono(telefono)) return showErr('⚠️ Telefono non valido — inserisci almeno 9 cifre (es. 333 1234567)', 'pTelefono');
    if (!inputVett.trim()) return showErr('⚠️ Inserisci il modello vettura', 'pVettura');
    if (!prezzoRaw) return showErr('⚠️ Inserisci il prezzo', 'pPrezzo');

    const prezzoNum = parseFloat(prezzoRaw.replace(',', '.'));
    if (isNaN(prezzoNum) || prezzoNum < 0) return showErr('⚠️ Prezzo non valido (es. 25 oppure 25,50)', 'pPrezzo');

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
        
        // Auto-salva cliente nel CRM con telefono; isNew = true se creato ora
        const isNewClient = await autoSalvaCliente(obj.cliente, obj.vettura, '', obj.telefono);

        renderPren();
        ['pCliente','pTelefono','pVettura','pPrezzo','pNote'].forEach(id => document.getElementById(id).value = '');
        if (msg) msg.textContent = '';

        // UN SOLO toast a seconda che il cliente sia nuovo o già conosciuto.
        // Nuovo → benvenuto + conferma prenotazione in unico messaggio (con IG).
        // Esistente → solo conferma prenotazione (promemoria).
        const [y, m, d] = (date || '').split('-');
        const dataIta = d && m && y ? `${d}/${m}/${y}` : date;
        if (isNewClient) {
            showWelcomePrenToast(obj.cliente, dataIta, obj.orario);
        } else {
            showConfirmPrenToast(obj.cliente, dataIta, obj.orario);
        }
    } catch(e) { console.error(e); }
}

// Wrappa avviaPagamento in Promise per uso await
function avviaPagamentoPromise(importoCent, idRef) {
    return new Promise(resolve => {
        avviaPagamento(importoCent, idRef, resolve);
    });
}

// Se la cassa automatica è abilitata e raggiungibile, attiva la VNE per
// il pagamento contanti e ritorna i metadati VNE. Se è offline chiede
// conferma per fallback manuale. Ritorna:
//   { manuale: true }                → procedi col flusso manuale (no metadati)
//   { ok: true, meta, effettivo? }   → cassa ha incassato, salva con metadati
//   { abort: true }                  → pagamento annullato/fallito, non salvare
async function gestisciCassaContanti(prezzoEur, refId) {
    if (!state.cassaAuto?.enabled) return { manuale: true };
    if (!prezzoEur || prezzoEur <= 0) return { manuale: true };

    const h = await healthBridge();
    if (!h?.ok || !h?.vne_reachable) {
        const motivo = !h?.ok ? 'bridge offline' : 'cassa scollegata';
        const fallback = confirm(`⚠️ Cassa automatica non raggiungibile (${motivo}).\n\nVuoi salvare manualmente come pagamento contanti?`);
        return fallback ? { manuale: true } : { abort: true };
    }

    const importoCent = Math.round(prezzoEur * 100);
    const res = await avviaPagamentoPromise(importoCent, refId);

    if (res.status === 'completed') {
        return {
            ok: true,
            meta: { pagamentoVia: 'CASSA_AUTO', idVNE: res.idVNE, vneInserito: res.inserito, vneResto: res.resto },
        };
    }
    if (res.status === 'partial') {
        const ok = confirm(`Cliente ha inserito €${(res.inserito||0).toFixed(2)} ma il totale era €${prezzoEur.toFixed(2)}.\nAccettare pagamento parziale?`);
        if (!ok) return { abort: true };
        return {
            ok: true,
            effettivo: res.inserito,
            meta: { pagamentoVia: 'CASSA_AUTO', idVNE: res.idVNE, vneStatus: 'partial', vneInserito: res.inserito, vneResto: res.resto },
        };
    }
    if (res.status === 'error') alert('Errore cassa: ' + (res.error || 'sconosciuto'));
    return { abort: true };
}

async function mostraModalServizi(date, pid) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return [];

    const servizi = await loadServiziAttivi();
    if (servizi.length === 0) return [];

    return new Promise(resolve => {
        const base = pNum(entry.prezzo);
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

        overlay.innerHTML = `
            <div style="background:var(--bg2);border-radius:var(--r);padding:24px;width:100%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.4)">
                <h3 style="font:700 15px var(--f);margin-bottom:4px">🛍️ Servizi Aggiuntivi</h3>
                <div style="font:400 12px var(--f);color:var(--tx2);margin-bottom:16px">${esc(entry.cliente)} — lavaggio: <strong>€${base.toFixed(2)}</strong></div>
                <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
                    ${servizi.map(s => `
                        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border-radius:var(--r2);border:1px solid var(--brd);cursor:pointer">
                            <input type="checkbox" class="sa-item" data-nome="${esc(s.nome)}" data-prezzo="${s.prezzo}" style="width:17px;height:17px;cursor:pointer;flex-shrink:0">
                            <span style="flex:1;font:500 13px var(--f)">${esc(s.nome)}</span>
                            <span style="font:600 13px var(--mono);color:var(--grn)">+€${s.prezzo.toFixed(2)}</span>
                        </label>
                    `).join('')}
                </div>
                <div style="text-align:center;padding:10px;background:var(--bg4);border-radius:var(--r2);margin-bottom:16px;font:600 14px var(--f)">
                    Totale: <span id="saTot" style="font-size:20px;color:var(--grn)">€${base.toFixed(2)}</span>
                </div>
                <div style="display:flex;gap:8px">
                    <button id="saSkip" class="btn" style="flex:1">Salta</button>
                    <button id="saOk" class="btn btn-primary" style="flex:2">Procedi →</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        overlay.querySelectorAll('.sa-item').forEach(chk => {
            chk.addEventListener('change', () => {
                let tot = base;
                overlay.querySelectorAll('.sa-item:checked').forEach(c => tot += parseFloat(c.dataset.prezzo));
                overlay.querySelector('#saTot').textContent = '€' + tot.toFixed(2);
            });
        });

        const close = (selected) => { document.body.removeChild(overlay); resolve(selected); };

        overlay.querySelector('#saSkip').addEventListener('click', () => close([]));
        overlay.querySelector('#saOk').addEventListener('click', () => {
            const sel = [];
            overlay.querySelectorAll('.sa-item:checked').forEach(c => sel.push({ nome: c.dataset.nome, prezzo: parseFloat(c.dataset.prezzo) }));
            close(sel);
        });
    });
}

async function markPaid(date, pid, mod, serviziExtra = []) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return;

    let extraMeta = {};
    let prezzoFinaleStr = entry.prezzo;

    if (serviziExtra && serviziExtra.length > 0) {
        const totale = pNum(entry.prezzo) + serviziExtra.reduce((s, x) => s + x.prezzo, 0);
        prezzoFinaleStr = String(totale);
        extraMeta.serviziAggiuntivi = serviziExtra;
        extraMeta.prezzoLavaggio = entry.prezzo;
    }

    if (mod === 'CONTANTI') {
        const prezzoEur = pNum(prezzoFinaleStr);
        const r = await gestisciCassaContanti(prezzoEur, pid);
        if (r.abort) return;
        if (r.ok) {
            extraMeta = { ...extraMeta, ...r.meta };
            if (r.effettivo) prezzoFinaleStr = String(r.effettivo);
        }
    }

    try {
        const upd = { saldato: 'SI', saldo: mod, ...extraMeta };
        if (prezzoFinaleStr !== entry.prezzo) upd.prezzo = prezzoFinaleStr;
        await fsUpdateDoc(fsDoc(db, "prenotazioni", pid), upd);
        Object.assign(entry, upd);
        renderPren();
        showThankYouToast(entry.cliente, pNum(prezzoFinaleStr));
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

    const targaRaw = document.getElementById('tTarga').value.trim();
    if(!inputNome.trim() || !modelloRaw.trim() || !prezzoRaw || !targaRaw) {
        if(msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Compila Cliente, Modello, Targa e Prezzo!'; }
        if(!targaRaw) document.getElementById('tTarga').focus();
        return;
    }

    // Hard autocomplete: scelta obbligata se ci sono simili
    const clienteFinale = await checkClienteDuplicato(inputNome);
    if (clienteFinale === null) return;

    const telefono = (document.getElementById('tTelefono')?.value || '').trim();
    if (telefono && !validaTelefono(telefono)) {
        if(msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Telefono non valido — inserisci almeno 9 cifre'; }
        document.getElementById('tTelefono')?.focus();
        return;
    }
    const obj = {
        dataIn: new Date().toLocaleDateString('it-IT'),
        cliente: clienteFinale,
        modello: normalizeName(modelloRaw),
        targa: normalizeName(document.getElementById('tTarga').value),
        telefono,
        prezzo: prezzoRaw,
        status: 'IN', pagamento: '', dataOut: ''
    };
    try {
        const ref = await fsAddDoc(fsCollection(db, "tappezzeria"), obj);
        obj._id = ref.id;
        state.tapDB.push(obj);
        
        // Auto-salva cliente nel CRM. Tappezzeria non raccoglie tel:
        // se il cliente era già nel CRM con tel noto, il toast benvenuto può
        // comunque scattare (in caso di prima interazione con noi).
        const isNewClient = await autoSalvaCliente(obj.cliente, obj.modello, obj.targa, '');

        renderTap();
        ['tCliente','tModello','tTarga','tTelefono','tPrezzo'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });

        // Se è un nuovo cliente con telefono valido nel CRM, propone benvenuto
        if (isNewClient) showWelcomeToast(obj.cliente);
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

            let extraMeta = {};
            let prezzoFinaleStr = t.prezzo;

            if (modUp === 'CONTANTI') {
                const prezzoEur = parseFloat(t.prezzo) || 0;
                const r = await gestisciCassaContanti(prezzoEur, 'TAP-' + id);
                if (r.abort) return;
                if (r.ok) {
                    extraMeta = r.meta;
                    if (r.effettivo) prezzoFinaleStr = String(r.effettivo);
                }
            }

            const dataOut = new Date().toLocaleDateString('it-IT');
            const dataISO = fmtDI(new Date());
            const upd = { status: 'OUT', pagamento: modUp, dataOut: dataOut, ...extraMeta };
            if (prezzoFinaleStr !== t.prezzo) upd.prezzo = prezzoFinaleStr;
            await fsUpdateDoc(fsDoc(db, "tappezzeria", id), upd);
            Object.assign(t, upd);

            // Scrivi in Prima Nota se non è sospeso
            if (modUp !== 'SOSPESO') {
                if (modUp !== 'FATTURATO') showThankYouToast(t.cliente, parseFloat(prezzoFinaleStr) || 0);
                try {
                    const imp = parseFloat(prezzoFinaleStr) || 0;
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
