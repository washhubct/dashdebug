import { db, fsCollection, fsAddDoc, fsGetDocs, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI, pDate } from '../utils.js';

// ─── DATABASE CLIENTI IN MEMORIA ───
let clientiDB = [];

// ─── INIT ───
export function initClienti() {
    document.getElementById('addClienteBtn')?.addEventListener('click', showClienteForm);
    document.getElementById('clienteSaveBtn')?.addEventListener('click', salvaCliente);
    document.getElementById('clienteAnnullaBtn')?.addEventListener('click', hideClienteForm);
    document.getElementById('clienteSrch')?.addEventListener('input', renderClienti);
    document.getElementById('addVetturaBtn')?.addEventListener('click', aggiungiCampoVettura);

    // Inizializza autocompletamento sui campi prenotazioni
    initAutocompletamento();
}

// ─── CARICA CLIENTI DA FIRESTORE ───
export async function caricaClienti() {
    try {
        const snap = await fsGetDocs(fsCollection(db, 'clienti'));
        clientiDB = [];
        snap.forEach(docSnap => {
            const d = docSnap.data();
            d._id = docSnap.id;
            clientiDB.push(d);
        });
        state.clientiDB = clientiDB;
    } catch (e) {
        console.warn('Errore caricamento clienti:', e);
    }
}

// ─── RENDER LISTA CLIENTI ───
export function renderClienti() {
    const tb = document.getElementById('clientiTb');
    if (!tb) return;

    const srch = (document.getElementById('clienteSrch')?.value || '').toLowerCase();
    let filtered = [...clientiDB];

    if (srch) {
        filtered = filtered.filter(c =>
            (c.nome || '').toLowerCase().includes(srch) ||
            (c.telefono || '').toLowerCase().includes(srch) ||
            (c.vetture || []).some(v => (v.modello || '').toLowerCase().includes(srch) || (v.targa || '').toLowerCase().includes(srch))
        );
    }

    // Arricchisci con dati operativi
    filtered.forEach(c => {
        const stats = calcolaStatsCliente(c.nome);
        c._numLavaggi = stats.numLavaggi;
        c._ultimaVisita = stats.ultimaVisita;
        c._spesaTotale = stats.spesaTotale;
        c._giorniDaUltimaVisita = stats.giorniDaUltimaVisita;
    });

    // Ordina per ultima visita (più recenti prima)
    filtered.sort((a, b) => (b._numLavaggi || 0) - (a._numLavaggi || 0));

    const cntEl = document.getElementById('clientiCnt');
    if (cntEl) cntEl.textContent = clientiDB.length + ' clienti';

    if (!filtered.length) {
        tb.innerHTML = '<tr><td colspan="7" class="empty">Nessun cliente trovato</td></tr>';
        return;
    }

    tb.innerHTML = filtered.map(c => {
        const vetture = (c.vetture || []).map(v => `${v.modello || ''} ${v.targa || ''}`).join(', ') || '—';
        const isVip = c.prezzoVip && c.prezzoVip > 0;
        const alertClass = c._giorniDaUltimaVisita > 90 ? 'r' : c._giorniDaUltimaVisita > 60 ? 'a' : c._giorniDaUltimaVisita > 30 ? 'a' : 'g';

        return `<tr>
            <td><strong>${esc(c.nome || '')}</strong>${isVip ? ' <span class="badge b" style="font-size:8px">VIP</span>' : ''}</td>
            <td style="font-size:11px">${esc(c.telefono || '—')}</td>
            <td style="font-size:10px;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${esc(vetture)}">${esc(vetture)}</td>
            <td style="text-align:center;font:600 12px var(--mono)">${c._numLavaggi || 0}</td>
            <td>${c._ultimaVisita ? `<span class="badge ${alertClass}">${c._ultimaVisita}</span>` : '—'}</td>
            <td style="font-weight:600">${c._spesaTotale > 0 ? fEur(c._spesaTotale) : '—'}</td>
            <td style="white-space:nowrap">
                <button class="act-btn edit-cli" data-id="${c._id}" title="Modifica">✎</button>
                <button class="act-btn del del-cli" data-id="${c._id}" title="Elimina">✕</button>
            </td>
        </tr>`;
    }).join('');

    // Event listeners
    tb.querySelectorAll('.edit-cli').forEach(btn => btn.addEventListener('click', () => editCliente(btn.dataset.id)));
    tb.querySelectorAll('.del-cli').forEach(btn => btn.addEventListener('click', () => deleteCliente(btn.dataset.id)));
}

// ─── CALCOLA STATISTICHE CLIENTE ───
function calcolaStatsCliente(nomeCliente) {
    if (!nomeCliente) return { numLavaggi: 0, ultimaVisita: null, spesaTotale: 0, giorniDaUltimaVisita: 999 };

    const nomeUp = nomeCliente.toUpperCase();
    let numLavaggi = 0, spesaTotale = 0, ultimaData = null;

    // Dalle prenotazioni
    for (const [date, entries] of Object.entries(state.prenDB || {})) {
        entries.forEach(p => {
            if ((p.cliente || '').toUpperCase() === nomeUp) {
                numLavaggi++;
                if (p.saldato === 'SI') spesaTotale += pNum(p.prezzo);
                const d = new Date(date);
                if (!ultimaData || d > ultimaData) ultimaData = d;
            }
        });
    }

    // Dalla tappezzeria
    (state.tapDB || []).forEach(t => {
        if ((t.cliente || '').toUpperCase() === nomeUp) {
            numLavaggi++;
            if (t.status === 'OUT' && t.pagamento !== 'SOSPESO') spesaTotale += pNum(t.prezzo);
            const d = pDate(t.dataIn);
            if (d && (!ultimaData || d > ultimaData)) ultimaData = d;
        }
    });

    const oggi = new Date();
    const giorniDa = ultimaData ? Math.floor((oggi - ultimaData) / 864e5) : 999;
    const ultimaVisita = ultimaData ? `${ultimaData.getDate()}/${ultimaData.getMonth() + 1}/${ultimaData.getFullYear()}` : null;

    return { numLavaggi, ultimaVisita, spesaTotale, giorniDaUltimaVisita: giorniDa };
}

// ─── FORM CLIENTE ───
function showClienteForm(data) {
    const form = document.getElementById('clienteForm');
    if (!form) return;
    form.classList.add('show');
    document.getElementById('addClienteBtn').style.display = 'none';

    if (data && data._id) {
        document.getElementById('clienteFTitle').textContent = 'Modifica Cliente';
        document.getElementById('clienteSaveBtn').textContent = 'Aggiorna';
        state.clienteEditId = data._id;
        document.getElementById('cNome').value = data.nome || '';
        document.getElementById('cTel').value = data.telefono || '';
        document.getElementById('cNote').value = data.note || '';
        document.getElementById('cPrezzoVip').value = data.prezzoVip || '';

        // Popola vetture
        const container = document.getElementById('vettureContainer');
        container.innerHTML = '';
        (data.vetture || []).forEach(v => aggiungiCampoVettura(v));
    } else {
        document.getElementById('clienteFTitle').textContent = 'Nuovo Cliente';
        document.getElementById('clienteSaveBtn').textContent = 'Salva';
        state.clienteEditId = null;
        document.getElementById('cNome').value = '';
        document.getElementById('cTel').value = '';
        document.getElementById('cNote').value = '';
        document.getElementById('cPrezzoVip').value = '';
        document.getElementById('vettureContainer').innerHTML = '';
        aggiungiCampoVettura();
    }
}

function hideClienteForm() {
    document.getElementById('clienteForm')?.classList.remove('show');
    document.getElementById('addClienteBtn').style.display = '';
    state.clienteEditId = null;
}

function aggiungiCampoVettura(data) {
    const container = document.getElementById('vettureContainer');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'vettura-row';
    div.style.cssText = 'display:flex;gap:8px;align-items:flex-end;margin-bottom:6px';
    div.innerHTML = `
        <div class="ff" style="flex:1;min-width:120px"><label>Modello</label><input class="v-modello" value="${esc((data?.modello) || '')}" placeholder="Es: FIAT 500"></div>
        <div class="ff" style="width:100px"><label>Targa</label><input class="v-targa" value="${esc((data?.targa) || '')}" style="text-transform:uppercase" placeholder="AA000BB"></div>
        <div class="ff" style="width:80px"><label>Prezzo €</label><input class="v-prezzo" type="number" step="1" value="${data?.prezzo || ''}" placeholder="—"></div>
        <button type="button" class="act-btn del" style="height:37px;margin-bottom:2px" title="Rimuovi vettura">✕</button>
    `;
    div.querySelector('.del').addEventListener('click', () => div.remove());
    container.appendChild(div);
}

// ─── SALVA CLIENTE ───
async function salvaCliente() {
    const msg = document.getElementById('clienteMsg');
    const nome = document.getElementById('cNome').value.trim().toUpperCase();
    const telefono = document.getElementById('cTel').value.trim();
    const note = document.getElementById('cNote').value.trim();
    const prezzoVip = parseFloat(document.getElementById('cPrezzoVip').value) || 0;

    if (!nome) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Inserisci il nome!'; } return; }

    // Raccogli vetture
    const vetture = [];
    document.querySelectorAll('.vettura-row').forEach(row => {
        const modello = row.querySelector('.v-modello')?.value.trim().toUpperCase() || '';
        const targa = row.querySelector('.v-targa')?.value.trim().toUpperCase() || '';
        const prezzo = parseFloat(row.querySelector('.v-prezzo')?.value) || 0;
        if (modello || targa) vetture.push({ modello, targa, prezzo });
    });

    const record = { nome, telefono, vetture, note, prezzoVip, timestamp: Date.now() };

    try {
        if (state.clienteEditId) {
            await fsUpdateDoc(fsDoc(db, 'clienti', state.clienteEditId), record);
            const idx = clientiDB.findIndex(c => c._id === state.clienteEditId);
            if (idx >= 0) { record._id = state.clienteEditId; clientiDB[idx] = record; }
            if (msg) { msg.style.color = 'var(--grn)'; msg.textContent = '✅ Cliente aggiornato!'; }
        } else {
            // Controlla duplicati
            const duplicato = clientiDB.find(c => c.nome === nome);
            if (duplicato && !confirm(`Esiste già un cliente "${nome}". Vuoi aggiungerlo comunque?`)) return;

            const ref = await fsAddDoc(fsCollection(db, 'clienti'), record);
            record._id = ref.id;
            clientiDB.push(record);
            if (msg) { msg.style.color = 'var(--grn)'; msg.textContent = '✅ Cliente salvato!'; }
        }

        state.clientiDB = clientiDB;
        setTimeout(() => { hideClienteForm(); renderClienti(); }, 600);
    } catch (e) {
        console.error('Errore salvataggio cliente:', e);
        if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Errore salvataggio!'; }
    }
}

function editCliente(id) {
    const c = clientiDB.find(x => x._id === id);
    if (c) showClienteForm(c);
}

async function deleteCliente(id) {
    const c = clientiDB.find(x => x._id === id);
    if (!c) return;
    if (!confirm(`Eliminare il cliente ${c.nome}?`)) return;
    try {
        await fsDeleteDoc(fsDoc(db, 'clienti', id));
        clientiDB = clientiDB.filter(x => x._id !== id);
        state.clientiDB = clientiDB;
        renderClienti();
    } catch (e) {
        console.error('Errore eliminazione cliente:', e);
    }
}

// ═══════════════════════════════════════════════════════════════════
// AUTOCOMPLETAMENTO SUI CAMPI PRENOTAZIONI
// ═══════════════════════════════════════════════════════════════════
function initAutocompletamento() {
    // Campo nominativo prenotazioni
    setupAutocomplete('pCliente', (query) => {
        return clientiDB.filter(c =>
            (c.nome || '').toLowerCase().includes(query) ||
            (c.telefono || '').includes(query)
        ).slice(0, 6);
    }, onSelectCliente);

    // Campo cliente tappezzeria
    setupAutocomplete('tCliente', (query) => {
        return clientiDB.filter(c =>
            (c.nome || '').toLowerCase().includes(query) ||
            (c.telefono || '').includes(query)
        ).slice(0, 6);
    }, onSelectClienteTap);
}

function setupAutocomplete(inputId, searchFn, onSelectFn) {
    const input = document.getElementById(inputId);
    if (!input) return;

    // Crea dropdown
    let dropdown = document.getElementById(inputId + '_ac');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = inputId + '_ac';
        dropdown.className = 'ac-dropdown';
        dropdown.style.cssText = 'position:absolute;z-index:999;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r2);box-shadow:0 4px 16px rgba(0,0,0,.15);max-height:240px;overflow-y:auto;display:none;width:100%;left:0;top:100%';
        input.parentElement.style.position = 'relative';
        input.parentElement.appendChild(dropdown);
    }

    let debounceTimer;
    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const query = input.value.trim().toLowerCase();
            if (query.length < 2) { dropdown.style.display = 'none'; return; }

            const results = searchFn(query);
            if (!results.length) { dropdown.style.display = 'none'; return; }

            dropdown.innerHTML = results.map(c => {
                const vetture = (c.vetture || []).map(v => v.modello).filter(Boolean).join(', ');
                const isVip = c.prezzoVip > 0;
                return `<div class="ac-item" data-id="${c._id}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--brd);transition:background .15s">
                    <div style="font:600 13px var(--f);color:var(--tx)">${esc(c.nome)} ${isVip ? '<span style="color:var(--blu);font-size:10px">⭐ VIP</span>' : ''}</div>
                    <div style="font:400 11px var(--f);color:var(--tx2)">${esc(c.telefono || '—')} ${vetture ? '· ' + esc(vetture) : ''}</div>
                </div>`;
            }).join('');

            dropdown.style.display = 'block';

            // Hover effect
            dropdown.querySelectorAll('.ac-item').forEach(item => {
                item.addEventListener('mouseenter', () => item.style.background = 'var(--bg3)');
                item.addEventListener('mouseleave', () => item.style.background = '');
                item.addEventListener('click', () => {
                    const cliente = clientiDB.find(c => c._id === item.dataset.id);
                    if (cliente) onSelectFn(cliente);
                    dropdown.style.display = 'none';
                });
            });
        }, 200);
    });

    // Chiudi dropdown quando clicchi fuori
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
}

// ─── SELEZIONE CLIENTE → AUTOCOMPILA PRENOTAZIONE ───
function onSelectCliente(cliente) {
    const inputCliente = document.getElementById('pCliente');
    if (inputCliente) inputCliente.value = cliente.nome;

    // Se ha vetture, mostra selezione vettura
    if (cliente.vetture && cliente.vetture.length > 0) {
        const inputVettura = document.getElementById('pVettura');
        const inputPrezzo = document.getElementById('pPrezzo');

        if (cliente.vetture.length === 1) {
            // Una sola vettura: autocompila
            const v = cliente.vetture[0];
            if (inputVettura) inputVettura.value = (v.modello || '') + (v.targa ? ' ' + v.targa : '');
            // Prezzo: usa prezzo vettura > prezzo VIP > vuoto
            const prezzo = v.prezzo || cliente.prezzoVip || '';
            if (inputPrezzo && prezzo) inputPrezzo.value = prezzo;
        } else {
            // Più vetture: mostra dropdown per scegliere
            mostraSelettoreVettura(cliente, 'pVettura', 'pPrezzo');
        }
    } else {
        // Nessuna vettura, metti solo il prezzo VIP se c'è
        if (cliente.prezzoVip > 0) {
            const inputPrezzo = document.getElementById('pPrezzo');
            if (inputPrezzo) inputPrezzo.value = cliente.prezzoVip;
        }
    }

    // Note con telefono se presente
    const inputNote = document.getElementById('pNote');
    if (inputNote && cliente.telefono && !inputNote.value) {
        inputNote.value = 'Tel: ' + cliente.telefono;
    }
}

// ─── SELEZIONE CLIENTE → AUTOCOMPILA TAPPEZZERIA ───
function onSelectClienteTap(cliente) {
    const inputCliente = document.getElementById('tCliente');
    if (inputCliente) inputCliente.value = cliente.nome;

    if (cliente.vetture && cliente.vetture.length > 0) {
        if (cliente.vetture.length === 1) {
            const v = cliente.vetture[0];
            const inputModello = document.getElementById('tModello');
            const inputTarga = document.getElementById('tTarga');
            const inputPrezzo = document.getElementById('tPrezzo');
            if (inputModello) inputModello.value = v.modello || '';
            if (inputTarga) inputTarga.value = v.targa || '';
            const prezzo = v.prezzo || cliente.prezzoVip || '';
            if (inputPrezzo && prezzo) inputPrezzo.value = prezzo;
        } else {
            mostraSelettoreVetturaTap(cliente);
        }
    }
}

// ─── SELETTORE VETTURA (dropdown per prenotazioni) ───
function mostraSelettoreVettura(cliente, vetturaId, prezzoId) {
    const inputVettura = document.getElementById(vetturaId);
    if (!inputVettura) return;

    // Rimuovi vecchio selettore se esiste
    const oldSel = document.getElementById('vetturaSel');
    if (oldSel) oldSel.remove();

    const sel = document.createElement('div');
    sel.id = 'vetturaSel';
    sel.style.cssText = 'position:absolute;z-index:999;background:var(--bg);border:1px solid var(--blu);border-radius:var(--r2);box-shadow:0 4px 16px rgba(37,99,235,.2);max-height:200px;overflow-y:auto;width:100%;left:0;top:100%';
    
    sel.innerHTML = `<div style="padding:6px 12px;font:600 10px var(--mono);color:var(--tx3);text-transform:uppercase;border-bottom:1px solid var(--brd)">Scegli vettura di ${esc(cliente.nome)}</div>` +
        cliente.vetture.map((v, i) => {
            const prezzoLabel = v.prezzo ? ` · €${v.prezzo}` : '';
            return `<div class="vet-opt" data-idx="${i}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--brd);transition:background .15s">
                <span style="font:600 12px var(--f)">${esc(v.modello || '—')}</span>
                <span style="font:400 10px var(--mono);color:var(--tx2);margin-left:6px">${esc(v.targa || '')}${prezzoLabel}</span>
            </div>`;
        }).join('') +
        `<div class="vet-opt" data-idx="-1" style="padding:10px 14px;cursor:pointer;color:var(--blu);font:500 12px var(--f)">+ Nuova vettura</div>`;

    inputVettura.parentElement.style.position = 'relative';
    inputVettura.parentElement.appendChild(sel);

    sel.querySelectorAll('.vet-opt').forEach(opt => {
        opt.addEventListener('mouseenter', () => opt.style.background = 'var(--bg3)');
        opt.addEventListener('mouseleave', () => opt.style.background = '');
        opt.addEventListener('click', () => {
            const idx = parseInt(opt.dataset.idx);
            if (idx >= 0) {
                const v = cliente.vetture[idx];
                inputVettura.value = (v.modello || '') + (v.targa ? ' ' + v.targa : '');
                const inputPrezzo = document.getElementById(prezzoId);
                const prezzo = v.prezzo || cliente.prezzoVip || '';
                if (inputPrezzo && prezzo) inputPrezzo.value = prezzo;
            } else {
                inputVettura.value = '';
                inputVettura.focus();
            }
            sel.remove();
        });
    });

    document.addEventListener('click', function handler(e) {
        if (!sel.contains(e.target) && e.target !== inputVettura) {
            sel.remove();
            document.removeEventListener('click', handler);
        }
    });
}

// ─── SELETTORE VETTURA (per tappezzeria) ───
function mostraSelettoreVetturaTap(cliente) {
    const inputModello = document.getElementById('tModello');
    if (!inputModello) return;

    const oldSel = document.getElementById('vetturaSel');
    if (oldSel) oldSel.remove();

    const sel = document.createElement('div');
    sel.id = 'vetturaSel';
    sel.style.cssText = 'position:absolute;z-index:999;background:var(--bg);border:1px solid var(--blu);border-radius:var(--r2);box-shadow:0 4px 16px rgba(37,99,235,.2);max-height:200px;overflow-y:auto;width:100%;left:0;top:100%';

    sel.innerHTML = `<div style="padding:6px 12px;font:600 10px var(--mono);color:var(--tx3);text-transform:uppercase;border-bottom:1px solid var(--brd)">Scegli vettura di ${esc(cliente.nome)}</div>` +
        cliente.vetture.map((v, i) =>
            `<div class="vet-opt" data-idx="${i}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--brd);transition:background .15s">
                <span style="font:600 12px var(--f)">${esc(v.modello || '—')}</span>
                <span style="font:400 10px var(--mono);color:var(--tx2);margin-left:6px">${esc(v.targa || '')}</span>
            </div>`
        ).join('') +
        `<div class="vet-opt" data-idx="-1" style="padding:10px 14px;cursor:pointer;color:var(--blu);font:500 12px var(--f)">+ Nuova vettura</div>`;

    inputModello.parentElement.style.position = 'relative';
    inputModello.parentElement.appendChild(sel);

    sel.querySelectorAll('.vet-opt').forEach(opt => {
        opt.addEventListener('mouseenter', () => opt.style.background = 'var(--bg3)');
        opt.addEventListener('mouseleave', () => opt.style.background = '');
        opt.addEventListener('click', () => {
            const idx = parseInt(opt.dataset.idx);
            if (idx >= 0) {
                const v = cliente.vetture[idx];
                inputModello.value = v.modello || '';
                const inputTarga = document.getElementById('tTarga');
                if (inputTarga) inputTarga.value = v.targa || '';
                const inputPrezzo = document.getElementById('tPrezzo');
                const prezzo = v.prezzo || cliente.prezzoVip || '';
                if (inputPrezzo && prezzo) inputPrezzo.value = prezzo;
            } else {
                inputModello.value = '';
                inputModello.focus();
            }
            sel.remove();
        });
    });

    document.addEventListener('click', function handler(e) {
        if (!sel.contains(e.target) && e.target !== inputModello) {
            sel.remove();
            document.removeEventListener('click', handler);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-CREAZIONE CLIENTE DA PRENOTAZIONE
// Se Sebastiano inserisce un cliente nuovo, lo salva automaticamente
// ═══════════════════════════════════════════════════════════════════
export function autoSalvaCliente(nome, vettura, targa, telefono) {
    if (!nome || nome.length < 2) return;
    const nomeUp = nome.toUpperCase();

    // Cerca se esiste già
    const esistente = clientiDB.find(c => c.nome === nomeUp);
    if (esistente) {
        // Aggiungi vettura se nuova
        if (vettura && !esistente.vetture?.some(v => v.modello === vettura.toUpperCase())) {
            const nuovaVettura = { modello: vettura.toUpperCase(), targa: (targa || '').toUpperCase(), prezzo: 0 };
            const vetture = [...(esistente.vetture || []), nuovaVettura];
            fsUpdateDoc(fsDoc(db, 'clienti', esistente._id), { vetture }).catch(e => console.warn('Auto-update vettura:', e));
            esistente.vetture = vetture;
        }
        // Aggiorna telefono se mancante
        if (telefono && !esistente.telefono) {
            fsUpdateDoc(fsDoc(db, 'clienti', esistente._id), { telefono }).catch(e => console.warn('Auto-update tel:', e));
            esistente.telefono = telefono;
        }
        return;
    }

    // Crea nuovo cliente automaticamente
    const record = {
        nome: nomeUp,
        telefono: telefono || '',
        vetture: vettura ? [{ modello: vettura.toUpperCase(), targa: (targa || '').toUpperCase(), prezzo: 0 }] : [],
        note: '',
        prezzoVip: 0,
        timestamp: Date.now()
    };

    fsAddDoc(fsCollection(db, 'clienti'), record).then(ref => {
        record._id = ref.id;
        clientiDB.push(record);
        state.clientiDB = clientiDB;
    }).catch(e => console.warn('Auto-creazione cliente:', e));
}
