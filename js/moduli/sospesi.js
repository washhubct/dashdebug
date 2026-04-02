import { state } from '../state.js';
import { fEur, esc, pDate } from '../utils.js';
import { renderCassa } from './cassa.js';
import { fsUpdateDoc, fsDoc, fsAddDoc, fsCollection, db } from '../firebase-config.js';

// ─── CARICA STATO SOSPESI DA FIRESTORE ───────────────────────────
export async function loadSospesiPagati() {
    // Lo stato (_pagato, _fatturato, _modPag, _dataPag, _dataFatt) è nei documenti Firestore
}

let _sospesiInitialized = false;

export function initSospesi() {
    buildSospesiArray();

    if (_sospesiInitialized) return;
    _sospesiInitialized = true;

    const filterBtns = document.querySelectorAll('#page-sospesi .qbtn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
            const txt = btn.textContent.toLowerCase();
            if (txt.includes('aperti')) state.sospFilter = 'aperti';
            else if (txt.includes('fatturati')) state.sospFilter = 'fatturati';
            else if (txt.includes('pagati')) state.sospFilter = 'pagati';
            renderSospPage();
        });
    });

    const sospSrch = document.getElementById('sospSrch');
    if (sospSrch) sospSrch.addEventListener('input', renderSospPage);
}

// ─── RACCOGLIE TUTTI I SOSPESI ───
export function buildSospesiArray() {
    const firebaseSosp = state.localSosp.filter(s => s._sid && !s._sid.startsWith('PREN-') && !s._sid.startsWith('TAP-'));

    if (firebaseSosp.length > 0) {
        state.localSosp = [...firebaseSosp];
    } else {
        state.localSosp = [...(state.storicoSospesi || [])];
    }

    for (const [date, entries] of Object.entries(state.prenDB || {})) {
        entries.forEach(e => {
            if (e.saldo !== 'SOSPESO' && e.saldo !== 'FATTURATO') return;
            const sid = 'PREN-' + e._pid;
            if (state.localSosp.find(s => s._sid === sid)) return;
            const obj = {
                cliente: (e.cliente || 'DA PRENOTAZIONI').toUpperCase(),
                data: date.split('-').reverse().join('/'),
                vettura: e.vettura || '',
                importo: parseFloat(e.prezzo) || 0,
                note: e.note || '',
                dataPagamento: '',
                _sid: sid
            };
            if (e.saldo === 'FATTURATO') { obj._fatturato = true; obj._dataFatt = ''; }
            state.localSosp.push(obj);
        });
    }

    (state.tapDB || []).filter(t => t.status === 'OUT' && (t.pagamento === 'SOSPESO' || t.pagamento === 'FATTURATO')).forEach(t => {
        const sid = 'TAP-' + t._id;
        if (state.localSosp.find(s => s._sid === sid)) return;
        const obj = {
            cliente: (t.cliente || 'DA TAPPEZZERIA').toUpperCase(),
            data: t.dataOut || t.dataIn,
            vettura: 'TAPPEZZERIA ' + (t.modello || ''),
            importo: parseFloat(t.prezzo) || 0,
            note: 'Tappezzeria',
            dataPagamento: '',
            _sid: sid
        };
        if (t.pagamento === 'FATTURATO') { obj._fatturato = true; obj._dataFatt = ''; }
        state.localSosp.push(obj);
    });

    updateSospBadge();
}

// ─── HELPERS ───
function getMeseAnno(dataStr) {
    if (!dataStr) return 'Senza data';
    const d = pDate(dataStr);
    if (!d || isNaN(d.getTime())) return 'Senza data';
    const mesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
        'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    return `${mesi[d.getMonth()]} ${d.getFullYear()}`;
}

async function salvaSospesoFirestore(sospeso) {
    try {
        if (!sospeso._sid) return;
        
        // Sospeso da PRENOTAZIONE → aggiorna il record prenotazione originale
        if (sospeso._sid.startsWith('PREN-')) {
            const prenId = sospeso._sid.replace('PREN-', '');
            const updateData = {};
            if (sospeso._pagato) {
                updateData.saldato = 'SI';
                updateData.saldo = sospeso._modPag || 'CONTANTI';
            } else if (sospeso._fatturato) {
                updateData.saldo = 'FATTURATO';
            }
            await fsUpdateDoc(fsDoc(db, 'prenotazioni', prenId), updateData);
            // Aggiorna anche lo state locale
            for (const [date, entries] of Object.entries(state.prenDB || {})) {
                const entry = entries.find(e => e._pid === prenId);
                if (entry) {
                    if (sospeso._pagato) { entry.saldato = 'SI'; entry.saldo = sospeso._modPag || 'CONTANTI'; }
                    else if (sospeso._fatturato) { entry.saldo = 'FATTURATO'; }
                    break;
                }
            }
            return;
        }
        
        // Sospeso da TAPPEZZERIA → aggiorna il record tappezzeria originale
        if (sospeso._sid.startsWith('TAP-')) {
            const tapId = sospeso._sid.replace('TAP-', '');
            const updateData = {};
            if (sospeso._pagato) {
                updateData.pagamento = sospeso._modPag || 'CONTANTI';
            } else if (sospeso._fatturato) {
                updateData.pagamento = 'FATTURATO';
            }
            await fsUpdateDoc(fsDoc(db, 'tappezzeria', tapId), updateData);
            // Aggiorna anche lo state locale
            const tap = (state.tapDB || []).find(t => t._id === tapId);
            if (tap) {
                if (sospeso._pagato) tap.pagamento = sospeso._modPag || 'CONTANTI';
                else if (sospeso._fatturato) tap.pagamento = 'FATTURATO';
            }
            return;
        }
        
        // Sospeso nativo Firestore → aggiorna direttamente
        const ref = fsDoc(db, 'sospesi', sospeso._sid);
        const updateData = {};
        if (sospeso._fatturato) {
            updateData.fatturato = true;
            updateData.dataFattura = sospeso._dataFatt || '';
        }
        if (sospeso._pagato) {
            updateData.pagato = true;
            updateData.modPagamento = sospeso._modPag || '';
            updateData.dataPagamento = sospeso._dataPag || '';
        }
        await fsUpdateDoc(ref, updateData);
    } catch (e) {
        console.warn('Errore salvataggio sospeso Firestore:', sospeso._sid, e.message);
    }
}

async function scriviPrimaNota(cliente, totale, mod, meseRif) {
    try {
        await fsAddDoc(fsCollection(db, 'primaNota'), {
            data: new Date().toLocaleDateString('it-IT'),
            descrizione: `Incasso sospesi ${cliente} — ${meseRif}`,
            importo: totale,
            tipo: 'ENTRATA',
            categoria: 'LAVAGGIO',
            modalita: mod,
            centro: 'Lavaggio',
            timestamp: Date.now()
        });
    } catch (e) {
        console.error('Errore scrittura Prima Nota:', e);
    }
}

// ─── BADGE NAV ───
export function updateSospBadge() {
    const open = state.localSosp.filter(s => !s._pagato && !s._fatturato);
    const badge = document.getElementById('navSospBadge');
    if (badge) {
        if (open.length > 0) {
            badge.textContent = open.length;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }
}

// ─── RENDER PAGINA SOSPESI ───
export function renderSospPage() {
    const srch = (document.getElementById('sospSrch')?.value || '').toLowerCase();
    const filter = state.sospFilter || 'aperti';

    const aperti = state.localSosp.filter(s => !s._pagato && !s._fatturato);
    const fatturati = state.localSosp.filter(s => s._fatturato && !s._pagato);
    const totDaInc = aperti.reduce((s, r) => s + r.importo, 0) + fatturati.reduce((s, r) => s + r.importo, 0);

    const kpiTot = document.getElementById('sospKpiTot');
    const kpiCli = document.getElementById('sospKpiCli');
    const kpiLav = document.getElementById('sospKpiLav');
    const totBadge = document.getElementById('sospTotBadge');

    if (kpiTot) kpiTot.textContent = fEur(totDaInc);
    if (kpiCli) kpiCli.textContent = [...new Set([...aperti, ...fatturati].map(s => s.cliente))].length;
    if (kpiLav) kpiLav.textContent = aperti.length + fatturati.length;
    if (totBadge) totBadge.textContent = fEur(totDaInc);

    let items;
    if (filter === 'fatturati') items = fatturati;
    else if (filter === 'pagati') items = state.localSosp.filter(s => s._pagato);
    else items = aperti;

    if (srch) {
        items = items.filter(s =>
            (s.cliente || '').toLowerCase().includes(srch) ||
            (s.vettura || '').toLowerCase().includes(srch)
        );
    }

    const byClient = {};
    items.forEach(s => {
        if (!byClient[s.cliente]) byClient[s.cliente] = { records: [], total: 0 };
        byClient[s.cliente].records.push(s);
        byClient[s.cliente].total += s.importo;
    });

    const container = document.getElementById('sospCards');
    if (!container) return;

    if (Object.keys(byClient).length === 0) {
        const msgMap = { aperti: 'Nessun sospeso aperto', fatturati: 'Nessun sospeso fatturato in attesa', pagati: 'Nessun sospeso pagato trovato' };
        container.innerHTML = `<div class="empty" style="padding:40px;background:var(--bg3);border:1px solid var(--brd);border-radius:var(--r)">${msgMap[filter] || 'Nessun risultato'}</div>`;
        return;
    }

    container.innerHTML = Object.entries(byClient)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([cliente, data]) => {
            const rows = data.records.sort((a, b) => (pDate(a.data) || 0) - (pDate(b.data) || 0));

            let btnClienteHtml = '';
            if (filter === 'aperti') {
                btnClienteHtml = `<div style="padding:8px 14px;border-bottom:1px solid var(--brd);display:flex;gap:6px;flex-wrap:wrap">
                    <button class="btn btn-salda-cli" data-cli="${esc(cliente)}" data-mod="CONTANTI" style="font-size:10px;padding:3px 10px" title="Salda TUTTI i sospesi di questo cliente in CONTANTI e registra l'incasso">💵 Salda Tutto Contanti</button>
                    <button class="btn btn-salda-cli" data-cli="${esc(cliente)}" data-mod="POS" style="font-size:10px;padding:3px 10px" title="Salda TUTTI i sospesi di questo cliente con POS e registra l'incasso">💳 Salda Tutto POS</button>
                    <button class="btn btn-fatt-cli" data-cli="${esc(cliente)}" style="font-size:10px;padding:3px 10px;border-color:var(--amb);color:var(--amb)" title="Segna TUTTI come FATTURATI — restano in attesa di pagamento nella tab Fatturati">📄 Segna Fatturato</button>
                </div>`;
            } else if (filter === 'fatturati') {
                const mesi = {};
                rows.forEach(r => { const m = getMeseAnno(r.data); if (!mesi[m]) mesi[m] = 0; mesi[m] += r.importo; });
                const mesiInfo = Object.entries(mesi).map(([m, t]) => `${m}: ${fEur(t)}`).join(' · ');
                btnClienteHtml = `<div style="padding:8px 14px;border-bottom:1px solid var(--brd);display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                    <button class="btn btn-pagato-cli" data-cli="${esc(cliente)}" data-mod="CONTANTI" style="font-size:10px;padding:3px 10px;background:var(--grn1);border-color:var(--grn);color:var(--grn)" title="Il cliente ha PAGATO in contanti — registra incasso in Prima Nota">✅ Pagato Contanti</button>
                    <button class="btn btn-pagato-cli" data-cli="${esc(cliente)}" data-mod="POS" style="font-size:10px;padding:3px 10px;background:var(--grn1);border-color:var(--grn);color:var(--grn)" title="Il cliente ha PAGATO con POS — registra incasso in Prima Nota">✅ Pagato POS</button>
                    <button class="btn btn-pagato-cli" data-cli="${esc(cliente)}" data-mod="BONIFICO" style="font-size:10px;padding:3px 10px;background:var(--grn1);border-color:var(--grn);color:var(--grn)" title="Il cliente ha PAGATO con bonifico — registra incasso in Prima Nota">✅ Pagato Bonifico</button>
                    <span style="font:400 10px var(--mono);color:var(--tx2);margin-left:auto">${mesiInfo}</span>
                </div>`;
            }

            let trHtml = '';
            if (filter === 'fatturati') {
                const byMese = {};
                rows.forEach(r => { const m = getMeseAnno(r.data); if (!byMese[m]) byMese[m] = []; byMese[m].push(r); });
                for (const [mese, recs] of Object.entries(byMese)) {
                    const totMese = recs.reduce((s, r) => s + r.importo, 0);
                    trHtml += `<tr style="background:var(--amb1)">
                        <td colspan="4" style="font:600 11px var(--f);color:var(--amb);padding:6px 10px">📅 ${mese} — ${recs.length} lav. — ${fEur(totMese)}</td>
                        <td style="text-align:right;padding-right:10px">
                            <button class="btn btn-pagato-mese" data-cli="${esc(cliente)}" data-mese="${esc(mese)}" data-mod="BONIFICO" style="font-size:9px;padding:2px 8px;background:var(--grn1);border-color:var(--grn);color:var(--grn)" title="Conferma pagamento solo per ${mese}">✅ Pagato</button>
                        </td>
                    </tr>`;
                    recs.forEach(r => {
                        trHtml += `<tr>
                            <td style="font:400 10px var(--mono)">${r.data || '-'}</td>
                            <td>${esc(r.vettura)}</td>
                            <td style="font-weight:600">€${r.importo}</td>
                            <td style="font-size:11px;color:var(--tx2)">${esc(r.note)}</td>
                            <td></td>
                        </tr>`;
                    });
                }
            } else {
                rows.forEach(r => {
                    let azioniHtml = '';
                    if (filter === 'pagati') {
                        azioniHtml = `<td><span class="badge g">${r._modPag || 'SI'}</span><br><span style="font:400 9px var(--mono);color:var(--tx3)">${r._dataPag || ''}</span></td>`;
                    } else {
                        azioniHtml = `<td style="white-space:nowrap">
                            <button class="act-btn btn-salda-singolo" data-sid="${r._sid}" data-mod="CONTANTI" title="Segna PAGATO in contanti — registra subito l'incasso">💵</button>
                            <button class="act-btn btn-salda-singolo" data-sid="${r._sid}" data-mod="POS" title="Segna PAGATO con POS — registra subito l'incasso">💳</button>
                            <button class="act-btn btn-fatt-singolo" data-sid="${r._sid}" title="Segna FATTURATO — resta in attesa di pagamento" style="color:var(--amb)">📄</button>
                        </td>`;
                    }
                    trHtml += `<tr>
                        <td style="font:400 10px var(--mono)">${r.data || '-'}</td>
                        <td>${esc(r.vettura)}</td>
                        <td style="font-weight:600">€${r.importo}</td>
                        <td style="font-size:11px;color:var(--tx2)">${esc(r.note)}</td>
                        ${azioniHtml}
                    </tr>`;
                });
            }

            const thAzioni = filter === 'pagati' ? '<th>Pagato</th>' : (filter === 'fatturati' ? '<th style="width:100px"></th>' : '<th style="width:140px">Azioni</th>');

            return `<div class="tbl-wrap" style="margin-bottom:14px">
                <div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--brd);background:var(--bg4)">
                    <div><strong>${esc(cliente)}</strong> <span class="badge a">${rows.length} lav.</span></div>
                    <div style="font:700 16px var(--f);color:var(--amb)">${fEur(data.total)}</div>
                </div>
                ${btnClienteHtml}
                <table class="tbl">
                    <thead><tr><th>Data</th><th>Vettura/Lavorazione</th><th style="width:80px">Importo</th><th>Note</th>${thAzioni}</tr></thead>
                    <tbody>${trHtml}</tbody>
                </table>
            </div>`;
        }).join('');

    // ─── EVENT LISTENERS ───
    container.querySelectorAll('.btn-salda-singolo').forEach(btn => {
        btn.addEventListener('click', () => saldaSingolo(btn.dataset.sid, btn.dataset.mod));
    });
    container.querySelectorAll('.btn-salda-cli').forEach(btn => {
        btn.addEventListener('click', () => saldaCliente(btn.dataset.cli, btn.dataset.mod));
    });
    container.querySelectorAll('.btn-fatt-singolo').forEach(btn => {
        btn.addEventListener('click', () => segnaFatturatoSingolo(btn.dataset.sid));
    });
    container.querySelectorAll('.btn-fatt-cli').forEach(btn => {
        btn.addEventListener('click', () => segnaFatturatoCliente(btn.dataset.cli));
    });
    container.querySelectorAll('.btn-pagato-cli').forEach(btn => {
        btn.addEventListener('click', () => segnaPagatoCliente(btn.dataset.cli, btn.dataset.mod));
    });
    container.querySelectorAll('.btn-pagato-mese').forEach(btn => {
        btn.addEventListener('click', () => segnaPagatoMese(btn.dataset.cli, btn.dataset.mese, btn.dataset.mod));
    });
}

// ════════════════════════════════════════════════════════════════════
// AZIONI
// ════════════════════════════════════════════════════════════════════

function saldaSingolo(sid, mod) {
    const r = state.localSosp.find(s => s._sid === sid);
    if (!r) return;
    r._pagato = true;
    r._modPag = mod;
    r._dataPag = new Date().toLocaleDateString('it-IT');
    salvaSospesoFirestore(r);
    scriviPrimaNota(r.cliente, r.importo, mod, getMeseAnno(r.data));
    renderSospPage();
    updateSospBadge();
    renderCassa();
}

function saldaCliente(cliente, mod) {
    const aperti = state.localSosp.filter(s => s.cliente === cliente && !s._pagato && !s._fatturato);
    if (!aperti.length) return;
    if (!confirm(`Saldare ${aperti.length} sospesi di ${cliente} come ${mod}?\nTotale: ${fEur(aperti.reduce((s, r) => s + r.importo, 0))}`)) return;

    const oggi = new Date().toLocaleDateString('it-IT');
    const totale = aperti.reduce((s, r) => s + r.importo, 0);
    aperti.forEach(s => {
        s._pagato = true;
        s._modPag = mod;
        s._dataPag = oggi;
        salvaSospesoFirestore(s);
    });
    scriviPrimaNota(cliente, totale, mod, 'Saldo completo');
    renderSospPage();
    updateSospBadge();
    renderCassa();
}

function segnaFatturatoSingolo(sid) {
    const r = state.localSosp.find(s => s._sid === sid);
    if (!r) return;
    r._fatturato = true;
    r._dataFatt = new Date().toLocaleDateString('it-IT');
    salvaSospesoFirestore(r);
    renderSospPage();
    updateSospBadge();
}

function segnaFatturatoCliente(cliente) {
    const aperti = state.localSosp.filter(s => s.cliente === cliente && !s._pagato && !s._fatturato);
    if (!aperti.length) return;
    if (!confirm(`Segnare come FATTURATI tutti i ${aperti.length} sospesi di ${cliente}?`)) return;

    const oggi = new Date().toLocaleDateString('it-IT');
    aperti.forEach(s => {
        s._fatturato = true;
        s._dataFatt = oggi;
        salvaSospesoFirestore(s);
    });
    renderSospPage();
    updateSospBadge();
}

function segnaPagatoCliente(cliente, mod) {
    const fatturati = state.localSosp.filter(s => s.cliente === cliente && s._fatturato && !s._pagato);
    if (!fatturati.length) return;
    const totale = fatturati.reduce((s, r) => s + r.importo, 0);
    if (!confirm(`Confermi PAGAMENTO di ${fatturati.length} sospesi fatturati di ${cliente}?\nTotale: ${fEur(totale)} — Metodo: ${mod}`)) return;

    const oggi = new Date().toLocaleDateString('it-IT');
    fatturati.forEach(s => {
        s._pagato = true;
        s._modPag = mod;
        s._dataPag = oggi;
        salvaSospesoFirestore(s);
    });
    scriviPrimaNota(cliente, totale, mod, 'Fatture saldate');
    renderSospPage();
    updateSospBadge();
    renderCassa();
}

function segnaPagatoMese(cliente, mese, mod) {
    const items = state.localSosp.filter(s =>
        s.cliente === cliente && s._fatturato && !s._pagato && getMeseAnno(s.data) === mese
    );
    if (!items.length) return;
    const totale = items.reduce((s, r) => s + r.importo, 0);
    if (!confirm(`Confermi PAGAMENTO sospesi ${cliente} di ${mese}?\n${items.length} lavaggi — ${fEur(totale)} — ${mod}`)) return;

    const oggi = new Date().toLocaleDateString('it-IT');
    items.forEach(s => {
        s._pagato = true;
        s._modPag = mod;
        s._dataPag = oggi;
        salvaSospesoFirestore(s);
    });
    scriviPrimaNota(cliente, totale, mod, mese);
    renderSospPage();
    updateSospBadge();
    renderCassa();
}
