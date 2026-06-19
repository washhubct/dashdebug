import { db, fsCollection, fsAddDoc, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { state, CONFIG } from '../state.js';
import { pNum, fEur, esc, fmtDI, d2s, dBetween, pDate } from '../utils.js';
import { logDelete } from './log.js';
import { renderCassa } from './cassa.js';
import { showThankYouToast } from './clienti.js';
import { richiediPagamento, avviaPagamento, healthBridge } from './cassa-automatica.js';

// Guardia anti doppio-submit: impedisce che un click ripetuto su Salva/Paga/Rinnova
// registri lo stesso incasso più volte mentre l'operazione async è in corso.
let _abbBusy = false;

let _abbonamentiInitialized = false;

export function initAbbonamenti() {
    if (_abbonamentiInitialized) return;
    _abbonamentiInitialized = true;

    const addAbbBtn = document.getElementById('addAbbBtn');
    if(addAbbBtn) addAbbBtn.addEventListener('click', () => showAbbF());

    const abbSaveBtn = document.getElementById('abbSaveBtn');
    if(abbSaveBtn) abbSaveBtn.addEventListener('click', saveAbb);
    
    const closeBtns = document.querySelectorAll('#abbForm .btn:not(.btn-primary)');
    closeBtns.forEach(btn => btn.addEventListener('click', hideAbbF));

    const abbSrch = document.getElementById('abbSrch');
    if(abbSrch) abbSrch.addEventListener('input', renderAbb);

    const filterBtns = document.querySelectorAll('#page-abbonamenti .filters .qbtn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
            const txt = btn.textContent.toLowerCase();
            if(txt.includes('tutti')) state.abbFilter = 'tutti';
            else if(txt.includes('non pagati')) state.abbFilter = 'nonpagato';
            else if(txt.includes('pagati')) state.abbFilter = 'pagato';
            else if(txt.includes('scadenza')) state.abbFilter = 'inscad';
            else if(txt.includes('notte')) state.abbFilter = 'notte';
            renderAbb();
        });
    });

    const tb = document.getElementById('abbTb');
    if(tb) {
        tb.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if(!btn) return;
            const id = btn.dataset.id;
            if(btn.classList.contains('edit-abb')) editAbb(id);
            else if(btn.classList.contains('renew-abb')) renewAbb(id);
            else if(btn.classList.contains('pay-abb')) pagaAbb(id);
            else if(btn.classList.contains('del-abb')) deleteAbb(id);
        });
    }

    const fDurata = document.getElementById('fDurata');
    const fInizio = document.getElementById('fInizio');
    if(fDurata) fDurata.addEventListener('change', calcScad);
    if(fInizio) fInizio.addEventListener('change', calcScad);
}

export function renderAbb() {
    const tb = document.getElementById('abbTb');
    if(!tb) return;

    const now = new Date();
    const srch = (document.getElementById('abbSrch')?.value || '').toLowerCase();
    let rows = [...state.localAbb];

    if(state.abbFilter === 'pagato') rows = rows.filter(r => r.PAGAMENTO === 'SI');
    else if(state.abbFilter === 'nonpagato') rows = rows.filter(r => r.PAGAMENTO !== 'SI');
    else if(state.abbFilter === 'inscad') rows = rows.filter(r => { const s = pDate(r['SCADENZA ABBONAMENTO']); return s && dBetween(now, s) <= 7 && dBetween(now, s) >= -7; });
    else if(state.abbFilter === 'notte') rows = rows.filter(r => r.NOTTE === 'SI');

    if(srch) {
        rows = rows.filter(r =>
            (r['NOME E COGNOME'] || '').toLowerCase().includes(srch) ||
            (r.TARGA || '').toLowerCase().includes(srch) ||
            (r['MODELLO VETTURA'] || '').toLowerCase().includes(srch)
        );
    }

    const scaduti = state.localAbb.filter(r => { const s = pDate(r['SCADENZA ABBONAMENTO']); return s && dBetween(now, s) < 0; });
    const inScad  = state.localAbb.filter(r => { const s = pDate(r['SCADENZA ABBONAMENTO']); return s && dBetween(now, s) >= 0 && dBetween(now, s) <= 7; });

    const cntEl = document.getElementById('abbCnt');
    if(cntEl) cntEl.textContent = state.localAbb.length + ' totali';

    // KPI in alto: totale abbonati + fatturato abbonamenti (somma importi dei pagati)
    const pagati = state.localAbb.filter(r => r.PAGAMENTO === 'SI');
    const fatturatoAbb = pagati.reduce((s, r) => s + pNum(r.IMPORTO), 0);
    const kpiEl = document.getElementById('abbKpis');
    if(kpiEl) {
        kpiEl.innerHTML = `
            <div class="kpi b">
                <div class="kpi-label">Abbonati Totali</div>
                <div class="kpi-val">${state.localAbb.length}</div>
                <div class="kpi-sub">${pagati.length} pagati · ${state.localAbb.length - pagati.length} non pagati</div>
            </div>
            <div class="kpi g">
                <div class="kpi-label">Fatturato Abbonamenti</div>
                <div class="kpi-val">${fEur(fatturatoAbb)}</div>
                <div class="kpi-sub">Somma importi degli abbonati pagati</div>
            </div>`;
    }

    const navBadge = document.getElementById('navScadBadge');
    const alertCount = scaduti.length + inScad.length;
    if(navBadge) {
        if(alertCount > 0) { navBadge.textContent = alertCount; navBadge.style.display = ''; }
        else { navBadge.style.display = 'none'; }
    }

    // Scaduti alert bar
    const alertEl = document.getElementById('abbScadAlert');
    if(alertEl) {
        if(scaduti.length || inScad.length) {
            const parts = [];
            if(scaduti.length) parts.push(`<span style="color:var(--red);font-weight:700">${scaduti.length} scaduti</span>`);
            if(inScad.length) parts.push(`<span style="color:var(--gold);font-weight:700">${inScad.length} in scadenza</span>`);
            alertEl.style.display = '';
            alertEl.innerHTML = `<span style="font:600 12px var(--f)">⚠️ ${parts.join(' · ')}</span>`;
        } else {
            alertEl.style.display = 'none';
        }
    }

    if(!rows.length) { tb.innerHTML = '<tr><td colspan="5" class="empty">Nessun risultato</td></tr>'; return; }

    rows.sort((a,b) => { const da = pDate(a['SCADENZA ABBONAMENTO']), db2 = pDate(b['SCADENZA ABBONAMENTO']); return (da||0) - (db2||0); });

    let html = '';
    rows.forEach(r => {
        const id = r._id;
        const nome = r['NOME E COGNOME'] || '-';
        const mod = r['MODELLO VETTURA'] || '';
        const targa = r.TARGA || '-';
        const cell = r['NUMERO CELL.'] || '';
        const sca = r['SCADENZA ABBONAMENTO'] || '-';
        const imp = pNum(r.IMPORTO);
        const pag = r.PAGAMENTO || '';
        const modal = r["MODALITA'"] || '';
        const note = r.NOTE || '';
        const notte = r.NOTTE === 'SI';

        const sd = pDate(sca);
        const days = sd ? dBetween(now, sd) : 999;

        let bc = 'g';
        let bl = sca;
        if(days < 0) { bc = 'r'; bl = sca + ' (' + Math.abs(days) + 'gg fa)'; }
        else if(days <= 7) { bc = 'a'; bl = sca + ' (' + days + 'gg)'; }

        let pagB = '';
        if(pag === 'SI') pagB = `<span class="badge g">SI</span>${modal ? `<br><span style="font-size:10px;color:var(--tx3)">${esc(modal)}</span>` : ''}`;
        else pagB = `<span class="badge r">NO</span>`;

        const noteDisp = note ? `<span title="${esc(note)}" style="cursor:help;margin-left:4px">📝</span>` : '';
        const notteDisp = notte ? `<span title="Notte" style="font-size:10px;color:var(--tx3)"> 🌙</span>` : '';

        html += `<tr>
            <td>
                <strong>${esc(nome)}</strong>${notteDisp}${noteDisp}
                ${mod ? `<br><span style="font:400 10px var(--f);color:var(--tx3)">${esc(mod)}${cell ? ' · ' + esc(cell) : ''}</span>` : ''}
            </td>
            <td style="font:500 11px var(--mono)">${esc(targa)}</td>
            <td><span class="badge ${bc}">${bl}</span></td>
            <td style="font-weight:600">€${imp}</td>
            <td style="white-space:nowrap">
                <button class="act-btn edit-abb" data-id="${id}" title="Modifica">✎</button>
                <button class="act-btn renew-abb" data-id="${id}" title="Rinnova">↻</button>
                ${pag !== 'SI' ? `<button class="act-btn pay-abb" data-id="${id}" title="Registra pagamento" style="color:var(--grn)">💰</button>` : ''}
                <button class="act-btn del del-abb" data-id="${id}" title="Elimina">✕</button>
            </td>
        </tr>`;
    });
    tb.innerHTML = html;
}

function showAbbF(data) {
    document.getElementById('abbForm').classList.add('show');
    document.getElementById('addAbbBtn').style.display = 'none';
    if(data) {
        document.getElementById('abbFTitle').textContent = 'Modifica Abbonamento';
        document.getElementById('abbSaveBtn').textContent = 'Aggiorna';
        state.abbEditId = data._id;
        document.getElementById('fNome').value = data['NOME E COGNOME'] || '';
        document.getElementById('fCell').value = data['NUMERO CELL.'] || '';
        document.getElementById('fModello').value = data['MODELLO VETTURA'] || '';
        document.getElementById('fTarga').value = data.TARGA || '';
        document.getElementById('fProv').value = data.PROVENIENZA || '';
        document.getElementById('fCodice').value = data['CODICE CANCELLO'] || '';
        document.getElementById('fDurata').value = data['DURATA ABB.'] || '1 MESE';
        document.getElementById('fImporto').value = pNum(data.IMPORTO);
        document.getElementById('fNotte').value = data.NOTTE || 'SI';
        document.getElementById('fPag').value = data.PAGAMENTO || '';
        document.getElementById('fMod').value = data["MODALITA'"] || '';
        document.getElementById('fChiavi').value = data['CHIAVI/CODICE'] || 'CODICE';
        document.getElementById('fNote').value = data.NOTE || '';
        const setD = (id, v) => { if(!v) return; const p = v.split('/'); if(p.length === 3) document.getElementById(id).value = p[2] + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0'); };
        setD('fInizio', data['INIZIO ABBONAMENTO']); setD('fScadenza', data['SCADENZA ABBONAMENTO']); setD('fDataPag', data['DATA PAGAMENTO']);
    } else {
        document.getElementById('abbFTitle').textContent = 'Nuovo Abbonamento';
        document.getElementById('abbSaveBtn').textContent = 'Salva';
        state.abbEditId = null;
        ['fNome','fCell','fModello','fTarga','fProv','fCodice','fImporto','fNote'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('fDurata').value = '1 MESE';
        document.getElementById('fNotte').value = 'SI';
        document.getElementById('fPag').value = '';
        document.getElementById('fMod').value = '';
        document.getElementById('fChiavi').value = 'CODICE';
        document.getElementById('fInizio').value = fmtDI(new Date());
        document.getElementById('fDataPag').value = '';
        calcScad();
    }
    document.getElementById('abbForm').scrollIntoView({behavior:'smooth'});
}

function hideAbbF() {
    document.getElementById('abbForm').classList.remove('show');
    document.getElementById('addAbbBtn').style.display = '';
    state.abbEditId = null;
    document.getElementById('abbMsg').textContent = '';
}

function calcScad() {
    const d = document.getElementById('fDurata'), i = document.getElementById('fInizio'), s = document.getElementById('fScadenza');
    if(!i.value) return;
    const dt = new Date(i.value);
    const t = d.value;
    if(t.includes('ANNO')) dt.setFullYear(dt.getFullYear() + 1);
    else if(t.includes('8')) dt.setMonth(dt.getMonth() + 8);
    else if(t.includes('6')) dt.setMonth(dt.getMonth() + 6);
    else if(t.includes('3')) dt.setMonth(dt.getMonth() + 3);
    else dt.setMonth(dt.getMonth() + 1);
    s.value = fmtDI(dt);
}

async function saveAbb() {
    if (_abbBusy) return;
    _abbBusy = true;
    try {
    const msg = document.getElementById('abbMsg');
    const nome = document.getElementById('fNome').value.trim();
    const targa = document.getElementById('fTarga').value.trim().toUpperCase();
    const ini = document.getElementById('fInizio').value;
    const sca = document.getElementById('fScadenza').value;
    const imp = parseFloat(document.getElementById('fImporto').value) || 0;
    
    if(!nome || !targa || !ini || !sca || !imp) { msg.style.color = 'var(--red)'; msg.textContent = 'Compila i campi obbligatori (*)'; return; }
    
    const pagamento = document.getElementById('fPag').value;
    const modalita = document.getElementById('fMod').value;
    const dataPag = document.getElementById('fDataPag').value;

    // Pagamento SI senza data → l'abbonamento sparirebbe da Report e Cassa (filtrano per DATA PAGAMENTO).
    // Blocca e chiedi di inserirla a mano.
    if(pagamento === 'SI' && !dataPag) {
        msg.style.color = 'var(--red)';
        msg.textContent = '⚠️ Pagamento = SI: inserisci a mano la Data Pagamento (senza, non compare nel report finanziario).';
        document.getElementById('fDataPag')?.focus();
        return;
    }

    const rec = {
        'MODELLO VETTURA': document.getElementById('fModello').value.trim(),
        'PROVENIENZA': document.getElementById('fProv').value.trim(),
        'TARGA': targa,
        'CODICE CANCELLO': document.getElementById('fCodice').value.trim(),
        'INIZIO ABBONAMENTO': d2s(ini),
        'SCADENZA ABBONAMENTO': d2s(sca),
        'NOME E COGNOME': nome,
        'NUMERO CELL.': document.getElementById('fCell').value.trim(),
        'DURATA ABB.': document.getElementById('fDurata').value,
        'IMPORTO': String(imp),
        'NOTTE': document.getElementById('fNotte').value,
        'PAGAMENTO': pagamento,
        "MODALITA'": modalita,
        'DATA PAGAMENTO': d2s(dataPag),
        'CHIAVI/CODICE': document.getElementById('fChiavi').value,
        'NOTE': document.getElementById('fNote').value.trim(),
        sedeId: state.sedeAttiva
    };

    const isUpdate = !!state.abbEditId;
    // Stato pagamento PRECEDENTE: se l'abbonamento era già registrato come pagato,
    // un nuovo salvataggio NON deve riscrivere la Prima Nota (causerebbe un doppio incasso).
    const giaRegistratoPagato = isUpdate && (state.localAbb.find(r => r._id === state.abbEditId)?.PAGAMENTO === 'SI');

    // CONTANTI su pagamento NUOVO → deve passare dalla cassa VNE (come i lavaggi).
    // Se la VNE non completa l'incasso, NON salviamo nulla.
    let vneMeta = null;
    if (pagamento === 'SI' && !giaRegistratoPagato && (modalita || '').toUpperCase() === 'CONTANTI' && state.cassaAuto?.enabled) {
        const h = await healthBridge();
        if (!h?.ok || !h?.vne_reachable) {
            if (!confirm('⚠️ Cassa VNE non raggiungibile. Registrare comunque come contanti manuale?')) {
                msg.style.color = 'var(--red)'; msg.textContent = 'Annullato: cassa VNE non raggiungibile.'; return;
            }
        } else {
            const res = await new Promise(resolve => avviaPagamento(Math.round(imp * 100), 'ABB-' + (state.abbEditId || targa), resolve));
            if (res.status === 'completed') {
                vneMeta = { pagamentoVia: 'CASSA_AUTO', idVNE: res.idVNE };
            } else if (res.status === 'partial') {
                if (!confirm(`Inseriti €${(res.inserito || 0).toFixed(2)} su €${imp.toFixed(2)}. Accettare pagamento parziale?`)) {
                    msg.style.color = 'var(--red)'; msg.textContent = 'Annullato.'; return;
                }
                vneMeta = { pagamentoVia: 'CASSA_AUTO', idVNE: res.idVNE, vneStatus: 'partial' };
            } else {
                msg.style.color = 'var(--red)'; msg.textContent = 'Pagamento VNE non completato — abbonamento NON salvato.'; return;
            }
        }
    }

    try {
        if(isUpdate) {
            await setDoc(fsDoc(db, "abbonamenti", state.abbEditId), rec, { merge: true });
            const idx = state.localAbb.findIndex(r => r._id === state.abbEditId);
            if(idx >= 0) { rec._id = state.abbEditId; state.localAbb[idx] = rec; }
            msg.style.color = 'var(--grn)'; msg.textContent = 'Aggiornato!';
        } else {
            const docRef = await fsAddDoc(fsCollection(db, "abbonamenti"), rec);
            rec._id = docRef.id;
            state.localAbb.push(rec);
            msg.style.color = 'var(--grn)'; msg.textContent = 'Salvato!';
        }
    } catch(e) {
        console.error("Errore salvataggio Firebase abbonamento:", e);
        msg.style.color = 'var(--red)'; msg.textContent = 'Errore salvataggio!';
        return;
    }

    syncAbbToSheet(rec, isUpdate);
    
    // Scrivi in Prima Nota su Firestore SOLO se è un pagamento NUOVO (non già registrato):
    // evita il doppio incasso quando si ri-salva un abbonamento già pagato.
    if(pagamento === 'SI' && !giaRegistratoPagato) {
        // Ringraziamento WhatsApp al salvataggio abbonamento pagato
        showThankYouToast(nome, imp);
        try {
            const dataPN = dataPag ? d2s(dataPag) : new Date().toLocaleDateString('it-IT');
            const dataISO = dataPag || fmtDI(new Date());
            const pnRow = {
                DATA: dataPN, dataISO: dataISO,
                'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO',
                'PRIMANOTA CLIENTI/FORNITORI': 'ABBONAMENTO ' + nome + ' (' + targa + ')',
                Descrizione: 'ABBONAMENTO ' + nome + ' (' + targa + ') - ' + modalita,
                ENTRATA: imp, Entrata: imp,
                USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0,
                "MODALITA'": modalita, timestamp: Date.now(),
                sedeId: state.sedeAttiva,
                ...(vneMeta || {})
            };
            await fsAddDoc(fsCollection(db, "primaNota"), pnRow);
            state.rawData?.primaNota?.rows?.push(pnRow);
        } catch(e) { console.error("Errore salvataggio Prima Nota:", e); }
    }

    setTimeout(() => { hideAbbF(); renderAbb(); renderCassa(); }, 600);
    } finally { _abbBusy = false; }
}

function editAbb(id) {
    const r = state.localAbb.find(x => x._id === id);
    if(r) showAbbF(r);
}

async function renewAbb(id) {
    const r = state.localAbb.find(x => x._id === id); if(!r) return;
    const _oggi = new Date().toLocaleDateString('it-IT');
    if (r.PAGAMENTO === 'SI' && r['DATA PAGAMENTO'] === _oggi && !confirm('⚠️ Questo abbonamento risulta GIÀ pagato oggi. Procedere comunque con un rinnovo/incasso?')) return;
    const dur = r['DURATA ABB.'] || '1 MESE';
    const imp = pNum(r.IMPORTO);
    const old = pDate(r['SCADENZA ABBONAMENTO']); if(!old) return;

    const ns = new Date(old);
    if(dur.includes('ANNO')) ns.setFullYear(ns.getFullYear() + 1);
    else if(dur.includes('8')) ns.setMonth(ns.getMonth() + 8);
    else if(dur.includes('6')) ns.setMonth(ns.getMonth() + 6);
    else if(dur.includes('3')) ns.setMonth(ns.getMonth() + 3);
    else ns.setMonth(ns.getMonth() + 1);

    const scelta = await _mostraModalRinnovo(r, old, ns);
    if(!scelta) return;

    let modalita = '';
    let dataPag = '';
    let prezzoFinale = imp;

    if(scelta.pagare) {
        const pag = await richiediPagamento(imp, r['NOME E COGNOME'] + ' — ' + (r.TARGA || ''), id, { addBonifico: true });
        if(!pag) return;
        modalita = pag.mod;
        prezzoFinale = pag.prezzoFinale;
        dataPag = new Date().toLocaleDateString('it-IT');
    }

    r['INIZIO ABBONAMENTO'] = d2s(fmtDI(old));
    r['SCADENZA ABBONAMENTO'] = d2s(fmtDI(ns));
    r.PAGAMENTO = scelta.pagare ? 'SI' : '';
    r["MODALITA'"] = modalita;
    r['DATA PAGAMENTO'] = dataPag;

    try {
        await setDoc(fsDoc(db, "abbonamenti", id), {
            'INIZIO ABBONAMENTO': r['INIZIO ABBONAMENTO'],
            'SCADENZA ABBONAMENTO': r['SCADENZA ABBONAMENTO'],
            'PAGAMENTO': r.PAGAMENTO,
            "MODALITA'": r["MODALITA'"],
            'DATA PAGAMENTO': r['DATA PAGAMENTO']
        }, { merge: true });
    } catch(e) { console.error("Errore rinnovo Firebase:", e); }

    if(scelta.pagare && prezzoFinale > 0) {
        showThankYouToast(r['NOME E COGNOME'] || '', prezzoFinale);
        try {
            const nome = r['NOME E COGNOME'] || '';
            const targa = r.TARGA || '';
            const pnRow = {
                DATA: dataPag, dataISO: fmtDI(new Date()),
                'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO',
                'PRIMANOTA CLIENTI/FORNITORI': 'RINNOVO ABB. ' + nome + ' (' + targa + ')',
                Descrizione: 'RINNOVO ABB. ' + nome + ' (' + targa + ') - ' + modalita,
                ENTRATA: prezzoFinale, Entrata: prezzoFinale,
                USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0,
                "MODALITA'": modalita, timestamp: Date.now(),
                sedeId: state.sedeAttiva
            };
            await fsAddDoc(fsCollection(db, "primaNota"), pnRow);
            state.rawData?.primaNota?.rows?.push(pnRow);
        } catch(e) { console.warn("Errore Prima Nota rinnovo:", e); }
    }

    syncAbbToSheet(r, true);
    renderAbb();
    renderCassa();
}

async function pagaAbb(id) {
    const r = state.localAbb.find(x => x._id === id); if(!r) return;
    const _oggi = new Date().toLocaleDateString('it-IT');
    if (r.PAGAMENTO === 'SI' && r['DATA PAGAMENTO'] === _oggi && !confirm('⚠️ Questo abbonamento risulta GIÀ pagato oggi. Registrare un SECONDO incasso?')) return;
    const imp = pNum(r.IMPORTO);
    const pag = await richiediPagamento(imp, r['NOME E COGNOME'] + ' — ' + (r.TARGA || ''), id, { addBonifico: true });
    if(!pag) return;

    const dataPag = new Date().toLocaleDateString('it-IT');
    r.PAGAMENTO = 'SI';
    r["MODALITA'"] = pag.mod;
    r['DATA PAGAMENTO'] = dataPag;

    try {
        await setDoc(fsDoc(db, "abbonamenti", id), {
            'PAGAMENTO': 'SI',
            "MODALITA'": pag.mod,
            'DATA PAGAMENTO': dataPag
        }, { merge: true });
    } catch(e) { console.error("Errore pagamento abbonamento:", e); return; }

    showThankYouToast(r['NOME E COGNOME'] || '', pag.prezzoFinale);
    try {
        const nome = r['NOME E COGNOME'] || '';
        const targa = r.TARGA || '';
        const pnRow = {
            DATA: dataPag, dataISO: fmtDI(new Date()),
            'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO',
            'PRIMANOTA CLIENTI/FORNITORI': 'ABBONAMENTO ' + nome + ' (' + targa + ')',
            Descrizione: 'ABBONAMENTO ' + nome + ' (' + targa + ') - ' + pag.mod,
            ENTRATA: pag.prezzoFinale, Entrata: pag.prezzoFinale,
            USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0,
            "MODALITA'": pag.mod, timestamp: Date.now(),
            sedeId: state.sedeAttiva
        };
        await fsAddDoc(fsCollection(db, "primaNota"), pnRow);
        state.rawData?.primaNota?.rows?.push(pnRow);
    } catch(e) { console.warn("Errore Prima Nota:", e); }

    syncAbbToSheet(r, true);
    renderAbb();
    renderCassa();
}

function _mostraModalRinnovo(r, oldDate, newDate) {
    return new Promise(resolve => {
        const nome = r['NOME E COGNOME'] || '-';
        const targa = r.TARGA || '-';
        const dur = r['DURATA ABB.'] || '1 MESE';
        const imp = pNum(r.IMPORTO);
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px';
        overlay.innerHTML = `
            <div style="background:var(--bg2);border-radius:var(--r);padding:20px;width:100%;max-width:360px;box-shadow:0 12px 40px rgba(0,0,0,.5)">
                <div style="font:700 15px var(--f);margin-bottom:4px">↻ Rinnovo Abbonamento</div>
                <div style="font:400 12px var(--f);color:var(--tx2);margin-bottom:14px"><strong>${esc(nome)}</strong> — ${esc(targa)}</div>
                <div style="background:var(--bg3);border-radius:var(--r2);padding:12px;margin-bottom:16px">
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;font:400 12px var(--f)">
                        <span style="color:var(--tx3)">Periodo</span>
                        <span style="font:500 11px var(--mono)">${d2s(fmtDI(oldDate))} → ${d2s(fmtDI(newDate))}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;font:400 12px var(--f)">
                        <span style="color:var(--tx3)">Durata</span><span>${esc(dur)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;font:400 12px var(--f)">
                        <span style="color:var(--tx3)">Importo</span>
                        <span style="font:700 15px var(--mono)">€${imp}</span>
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px">
                    <button id="_rnPaga" class="btn btn-primary">💰 Incassa €${imp}</button>
                    <button id="_rnAnn" class="btn" style="color:var(--tx3);font-size:11px">Annulla</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#_rnPaga').addEventListener('click', () => { overlay.remove(); resolve({ pagare: true }); });
        overlay.querySelector('#_rnAnn').addEventListener('click', () => { overlay.remove(); resolve(null); });
    });
}

async function deleteAbb(id) {
    const r = state.localAbb.find(x => x._id === id); if(!r) return;
    const motivazione = prompt(`⚠️ Stai per ELIMINARE l'abbonamento di ${r['NOME E COGNOME']} (Targa: ${r.TARGA}).\nInserisci il MOTIVO della cancellazione (OBBLIGATORIO):`);
    if(motivazione === null || motivazione.trim() === '') { alert("❌ Cancellazione annullata: motivazione mancante."); return; }

    try {
        // Prima elimina su Firestore (log + delete), poi aggiorna lo stato locale
        await logDelete('ABBONAMENTI', `Cliente: ${r['NOME E COGNOME']} - Targa: ${r.TARGA}`, motivazione.trim());
        await fsDeleteDoc(fsDoc(db, "abbonamenti", id));
        // Solo ora rimuoviamo dallo state locale: se arrivi qui la cancellazione cloud è andata
        state.localAbb = state.localAbb.filter(x => x._id !== id);
        renderAbb();
        // Sync Sheets in fire-and-forget (non compromette lo stato se fallisce)
        fetch(CONFIG.GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'deleteAbbonamento', id: id })
        }).catch(e => console.warn('Sync Sheets fallita (non bloccante):', e));
    } catch(e) {
        console.error('Errore cancellazione abbonamento:', e);
        alert('❌ Errore durante la cancellazione. Il record NON è stato rimosso — riprova.');
    }
}

async function syncAbbToSheet(rec, isUpdate) {
    try {
        await fetch(CONFIG.GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: isUpdate ? 'updateAbbonamento' : 'addAbbonamento', 
                id: rec._id, 
                data: {
                    modelloVettura: rec['MODELLO VETTURA'], provenienza: rec.PROVENIENZA, targa: rec.TARGA,
                    codiceCancello: rec['CODICE CANCELLO'], inizioAbbonamento: rec['INIZIO ABBONAMENTO'],
                    scadenzaAbbonamento: rec['SCADENZA ABBONAMENTO'], nomeECognome: rec['NOME E COGNOME'],
                    numeroCellulare: rec['NUMERO CELL.'], durataAbb: rec['DURATA ABB.'], importo: rec.IMPORTO,
                    notte: rec.NOTTE, pagamento: rec.PAGAMENTO, modalita: rec["MODALITA'"],
                    dataPagamento: rec['DATA PAGAMENTO'], chiaviCodice: rec['CHIAVI/CODICE'], note: rec.NOTE
                }
            })
        });
    } catch(e) { console.warn('Sync error:', e); }
}
