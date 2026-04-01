import { state } from '../state.js';
import { fEur, esc, pDate } from '../utils.js';
import { renderCassa } from './cassa.js';

// Carica lo stato dei sospesi pagati dal localStorage (chiamata da main.js)
export async function loadSospesiPagati() {
    try {
        const saved = JSON.parse(localStorage.getItem('wh_sosp_paid') || '{}');
        state.localSosp.forEach(s => { 
            if(saved[s._sid]) { 
                s._pagato = true; 
                s._modPag = saved[s._sid].mod; 
                s._dataPag = saved[s._sid].data; 
            }
        });
    } catch(e) { console.warn('Errore caricamento sospesi pagati:', e); }
}

let _sospesiInitialized = false;

export function initSospesi() {
    // Ricostruiamo l'array locale dei sospesi (Storico + Prenotazioni + Tappezzeria)
    buildSospesiArray();

    // Registra i listener solo la prima volta
    if(_sospesiInitialized) return;
    _sospesiInitialized = true;

    // Filtri (Aperti / Pagati)
    const filterBtns = document.querySelectorAll('#page-sospesi .qbtn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
            
            const txt = btn.textContent.toLowerCase();
            if(txt.includes('aperti')) state.sospFilter = 'tutti';
            else if(txt.includes('pagati')) state.sospFilter = 'pagati';
            
            renderSospPage();
        });
    });

    // Ricerca
    const sospSrch = document.getElementById('sospSrch');
    if(sospSrch) sospSrch.addEventListener('input', renderSospPage);
}

// Funzione fondamentale che "raccoglie" i debiti sparsi per l'app
export function buildSospesiArray() {
    // Partiamo dai sospesi già caricati da Firebase (se ci sono), altrimenti dallo storico
    const firebaseSosp = state.localSosp.filter(s => s._sid && !s._sid.startsWith('PREN-') && !s._sid.startsWith('TAP-'));
    
    if(firebaseSosp.length > 0) {
        // Firebase ha dei dati: usiamo quelli come base
        state.localSosp = [...firebaseSosp];
    } else {
        // Nessun dato Firebase: usiamo lo storico iniziale hardcoded
        state.localSosp = [...state.storicoSospesi]; 
    }
    
    // Peschiamo dalle prenotazioni lavaggio
    for(const[date, entries] of Object.entries(state.prenDB)) {
        entries.filter(e => e.saldo === 'SOSPESO').forEach(e => {
            let nomeCliente = e.cliente || 'DA PRENOTAZIONI';
            state.localSosp.push({
                cliente: nomeCliente, data: date.split('-').reverse().join('/'), vettura: e.vettura,
                importo: parseFloat(e.prezzo)||0, note: e.note||'', dataPagamento: '', _sid: 'PREN-'+e._pid
            });
        });
    }
    
    // Peschiamo dalla tappezzeria
    state.tapDB.filter(t => t.status === 'OUT' && t.pagamento === 'SOSPESO').forEach(t => {
        state.localSosp.push({
            cliente: t.cliente ? t.cliente.toUpperCase() : 'DA TAPPEZZERIA',
            data: t.dataOut || t.dataIn, vettura: 'TAPPEZZERIA ' + (t.modello || ''),
            importo: parseFloat(t.prezzo) || 0, note: 'Tappezzeria', dataPagamento: '', _sid: 'TAP-' + t._id
        });
    });
    
    // Recuperiamo i pagamenti già fatti e salvati nel browser
    try {
        const saved = JSON.parse(localStorage.getItem('wh_sosp_paid') || '{}');
        state.localSosp.forEach(s => { 
            if(saved[s._sid]) { 
                s._pagato = true; 
                s._modPag = saved[s._sid].mod; 
                s._dataPag = saved[s._sid].data; 
            }
        });
    } catch(e) {}
    
    updateSospBadge();
}

function saveSospState() {
    const paid = {};
    state.localSosp.filter(s => s._pagato).forEach(s => { 
        paid[s._sid] = { mod: s._modPag || '', data: s._dataPag || '' }; 
    });
    try { localStorage.setItem('wh_sosp_paid', JSON.stringify(paid)); } catch(e) {}
}

export function updateSospBadge() {
    const open = state.localSosp.filter(s => !s._pagato); 
    const badge = document.getElementById('navSospBadge');
    if(badge) {
        if(open.length > 0) {
            badge.textContent = open.length;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }
}

export function renderSospPage() {
    const srch = (document.getElementById('sospSrch')?.value || '').toLowerCase();
    const open = state.localSosp.filter(s => !s._pagato);
    const totDaInc = open.reduce((s,r) => s + r.importo, 0);
    
    // Aggiorna KPI in alto
    const kpiTot = document.getElementById('sospKpiTot');
    const kpiCli = document.getElementById('sospKpiCli');
    const kpiLav = document.getElementById('sospKpiLav');
    const totBadge = document.getElementById('sospTotBadge');
    
    if(kpiTot) kpiTot.textContent = fEur(totDaInc);
    if(kpiCli) kpiCli.textContent = [...new Set(open.map(s => s.cliente))].length;
    if(kpiLav) kpiLav.textContent = open.length;
    if(totBadge) totBadge.textContent = fEur(totDaInc);
    
    const byClient = {};
    const showPaid = state.sospFilter === 'pagati';
    const items = showPaid ? state.localSosp.filter(s => s._pagato) : open;
    
    items.forEach(s => {
        if(srch && !(s.cliente||'').toLowerCase().includes(srch) && !(s.vettura||'').toLowerCase().includes(srch)) return;
        if(!byClient[s.cliente]) byClient[s.cliente] = { records: [], total: 0 };
        byClient[s.cliente].records.push(s); 
        byClient[s.cliente].total += s.importo;
    });
    
    const container = document.getElementById('sospCards');
    if(!container) return;

    if(Object.keys(byClient).length === 0) { 
        container.innerHTML = '<div class="empty" style="padding:40px;background:var(--bg3);border:1px solid var(--brd);border-radius:var(--r)">Nessun sospeso trovato</div>'; 
        return; 
    }
    
    container.innerHTML = Object.entries(byClient).sort((a,b) => b[1].total - a[1].total).map(([cliente, data]) => {
        const rows = data.records.sort((a,b) => (pDate(a.data)||0) - (pDate(b.data)||0));
        
        let btnClienteHtml = '';
        if(!showPaid) {
            btnClienteHtml = `<div style="padding:8px 14px;border-bottom:1px solid var(--brd);display:flex;gap:6px">
                <button class="btn btn-salda-cli" data-cli="${esc(cliente)}" data-mod="CONTANTI" style="font-size:10px;padding:3px 10px">💵 Salda Tutto Contanti</button>
                <button class="btn btn-salda-cli" data-cli="${esc(cliente)}" data-mod="POS" style="font-size:10px;padding:3px 10px">💳 Salda Tutto POS</button>
                <button class="btn btn-salda-cli" data-cli="${esc(cliente)}" data-mod="FATTURA" style="font-size:10px;padding:3px 10px">📄 Segna Fatturato</button>
            </div>`;
        }

        let trHtml = rows.map(r => {
            let azioniHtml = '';
            if(showPaid) {
                azioniHtml = `<td><span class="badge g">${r._modPag||'SI'}</span></td>`;
            } else {
                azioniHtml = `<td style="white-space:nowrap">
                    <button class="act-btn btn-salda-singolo" data-sid="${r._sid}" data-mod="CONTANTI" title="Contanti">💵</button>
                    <button class="act-btn btn-salda-singolo" data-sid="${r._sid}" data-mod="POS" title="POS">💳</button>
                    <button class="act-btn btn-salda-singolo" data-sid="${r._sid}" data-mod="FATTURA" title="Fattura">📄</button>
                </td>`;
            }

            return `<tr>
                <td style="font:400 10px var(--mono)">${r.data||'-'}</td>
                <td>${esc(r.vettura)}</td>
                <td style="font-weight:600">€${r.importo}</td>
                <td style="font-size:11px;color:var(--tx2)">${esc(r.note)}</td>
                ${azioniHtml}
            </tr>`;
        }).join('');

        return `<div class="tbl-wrap" style="margin-bottom:14px">
            <div style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--brd);background:var(--bg4)">
                <div><strong>${esc(cliente)}</strong> <span class="badge a">${rows.length} lav.</span></div>
                <div style="font:700 16px var(--f);color:var(--amb)">${fEur(data.total)}</div>
            </div>
            ${btnClienteHtml}
            <table class="tbl">
                <thead><tr><th>Data</th><th>Vettura/Lavorazione</th><th style="width:80px">Importo</th><th>Note</th>${showPaid ? '<th>Pagato</th>' : '<th style="width:140px">Azioni</th>'}</tr></thead>
                <tbody>${trHtml}</tbody>
            </table>
        </div>`;
    }).join('');
    
    // Ascoltatori per i bottoni "Salda" appena generati
    container.querySelectorAll('.btn-salda-cli').forEach(btn => {
        btn.addEventListener('click', () => { saldaCliente(btn.dataset.cli, btn.dataset.mod); });
    });
    container.querySelectorAll('.btn-salda-singolo').forEach(btn => {
        btn.addEventListener('click', () => { saldaSingolo(btn.dataset.sid, btn.dataset.mod); });
    });
}

function saldaSingolo(sid, mod) {
    const r = state.localSosp.find(s => s._sid === sid); 
    if(!r) return;
    r._pagato = true; 
    r._modPag = mod; 
    r._dataPag = new Date().toLocaleDateString('it-IT');
    saveSospState(); 
    renderSospPage(); 
    updateSospBadge(); 
    renderCassa(); // Trasferiamo i soldi in cassa!
}

function saldaCliente(cliente, mod) {
    if(!confirm(`Saldare TUTTI i sospesi di ${cliente} come ${mod}?`)) return;
    const oggi = new Date().toLocaleDateString('it-IT');
    state.localSosp.filter(s => s.cliente === cliente && !s._pagato).forEach(s => {
        s._pagato = true;
        s._modPag = mod;
        s._dataPag = oggi;
    });
    saveSospState();
    renderSospPage();
    updateSospBadge(); 
    renderCassa(); // Trasferiamo i soldi in cassa!
}
