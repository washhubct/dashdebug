import { db, fsCollection, fsAddDoc, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { setDoc } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { state, CONFIG } from '../state.js';
import { pNum, fEur, esc, fmtDI, d2s, dBetween, pDate } from '../utils.js';
import { logDelete } from './log.js';
import { renderCassa } from './cassa.js';

export function initAbbonamenti() {
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
    
    const scad = state.localAbb.filter(r => { const s = pDate(r['SCADENZA ABBONAMENTO']); return s && dBetween(now, s) <= 7 && dBetween(now, s) >= -7; });
    const cntEl = document.getElementById('abbCnt');
    if(cntEl) cntEl.textContent = state.localAbb.length + ' totali';
    
    const navBadge = document.getElementById('navScadBadge');
    if(navBadge) {
        if(scad.length > 0) { navBadge.textContent = scad.length; navBadge.style.display = ''; } 
        else { navBadge.style.display = 'none'; }
    }

    if(!rows.length) { tb.innerHTML = '<tr><td colspan="13" class="empty">Nessun risultato</td></tr>'; return; }
    
    rows.sort((a,b) => { const da = pDate(a['SCADENZA ABBONAMENTO']), db2 = pDate(b['SCADENZA ABBONAMENTO']); return (da||0) - (db2||0); });
    
    let html = '';
    rows.forEach(r => {
        const id = r._id;
        const nome = r['NOME E COGNOME'] || '-';
        const mod = r['MODELLO VETTURA'] || '-';
        const targa = r.TARGA || '-';
        const cell = r['NUMERO CELL.'] || '-';
        const dur = r['DURATA ABB.'] || '-';
        const ini = r['INIZIO ABBONAMENTO'] || '-';
        const sca = r['SCADENZA ABBONAMENTO'] || '-';
        const imp = pNum(r.IMPORTO);
        const notte = r.NOTTE || '-';
        const pag = r.PAGAMENTO || '';
        const modal = r["MODALITA'"] || '-';
        const note = r.NOTE || '';
        
        const sd = pDate(sca);
        const days = sd ? dBetween(now, sd) : 999;
        
        let bc = 'g';
        let bl = 'OK';
        if(days < -7) { bc = 'r'; bl = 'Scaduto'; } 
        else if(days < 0) { bc = 'r'; bl = Math.abs(days) + 'gg fa'; } 
        else if(days <= 7) { bc = 'a'; bl = days + 'gg'; }
        
        let scadenzaTesto = sca;
        if(days <= 7) { scadenzaTesto += ' (' + bl + ')'; }
        
        let pagB = '<span class="badge r">NO</span>';
        if (pag === 'SI') pagB = '<span class="badge g">SI</span>';
        else if (pag === '') pagB = '<span class="badge a" title="Dato mancante">⚠️</span>';
        
        const noteDisp = note ? `<span title="${esc(note)}" style="cursor:help">📝</span>` : '';
        
        html += `<tr>
            <td><strong>${esc(nome)}</strong></td>
            <td style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis" title="${esc(mod)}">${esc(mod)}</td>
            <td style="font:400 10px var(--mono)">${esc(targa)}</td>
            <td style="font-size:11px">${esc(cell)}</td>
            <td style="font-size:11px">${esc(dur)}</td>
            <td style="font:400 10px var(--mono)">${ini}</td>
            <td><span class="badge ${bc}">${scadenzaTesto}</span></td>
            <td style="font-weight:600">€${imp}</td>
            <td>${notte}</td><td>${pagB}</td>
            <td style="font-size:11px">${esc(modal)}</td>
            <td>${noteDisp}</td>
            <td style="white-space:nowrap">
                <button class="act-btn edit-abb" data-id="${id}" title="Modifica">✎</button> 
                <button class="act-btn renew-abb" data-id="${id}" title="Rinnova">↻</button>
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
        'NOTE': document.getElementById('fNote').value.trim()
    };

    const isUpdate = !!state.abbEditId;

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
    
    // Scrivi in Prima Nota su Firestore quando pagato
    if(pagamento === 'SI') {
        try {
            const dataPN = dataPag ? d2s(dataPag) : new Date().toLocaleDateString('it-IT');
            const dataISO = dataPag || fmtDI(new Date());
            await fsAddDoc(fsCollection(db, "primaNota"), {
                DATA: dataPN, dataISO: dataISO,
                'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO',
                'PRIMANOTA CLIENTI/FORNITORI': 'ABBONAMENTO ' + nome + ' (' + targa + ')',
                Descrizione: 'ABBONAMENTO ' + nome + ' (' + targa + ') - ' + modalita,
                ENTRATA: imp, Entrata: imp,
                USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0,
                "MODALITA'": modalita, timestamp: Date.now()
            });
        } catch(e) { console.error("Errore salvataggio Prima Nota:", e); }
    }

    setTimeout(() => { hideAbbF(); renderAbb(); renderCassa(); }, 600);
}

function editAbb(id) {
    const r = state.localAbb.find(x => x._id === id);
    if(r) showAbbF(r);
}

async function renewAbb(id) {
    const r = state.localAbb.find(x => x._id === id); if(!r) return;
    const dur = r['DURATA ABB.'] || '1 MESE'; 
    const old = pDate(r['SCADENZA ABBONAMENTO']); if(!old) return;
    
    const ns = new Date(old);
    if(dur.includes('ANNO')) ns.setFullYear(ns.getFullYear() + 1);
    else if(dur.includes('8')) ns.setMonth(ns.getMonth() + 8);
    else if(dur.includes('6')) ns.setMonth(ns.getMonth() + 6);
    else if(dur.includes('3')) ns.setMonth(ns.getMonth() + 3);
    else ns.setMonth(ns.getMonth() + 1);
    
    if(!confirm(`Rinnovare ${r['NOME E COGNOME']}?\n\nNuovo: ${d2s(fmtDI(old))} → ${d2s(fmtDI(ns))}`)) return;
    
    r['INIZIO ABBONAMENTO'] = d2s(fmtDI(old));
    r['SCADENZA ABBONAMENTO'] = d2s(fmtDI(ns));
    r.PAGAMENTO = ''; r["MODALITA'"] = ''; r['DATA PAGAMENTO'] = '';
    
    try {
        await setDoc(fsDoc(db, "abbonamenti", id), {
            'INIZIO ABBONAMENTO': r['INIZIO ABBONAMENTO'],
            'SCADENZA ABBONAMENTO': r['SCADENZA ABBONAMENTO'],
            'PAGAMENTO': '', "MODALITA'": '', 'DATA PAGAMENTO': ''
        }, { merge: true });
    } catch(e) { console.error("Errore rinnovo Firebase:", e); }
    
    syncAbbToSheet(r, true);
    renderAbb();
}

async function deleteAbb(id) {
    const r = state.localAbb.find(x => x._id === id); if(!r) return;
    const motivazione = prompt(`⚠️ Stai per ELIMINARE l'abbonamento di ${r['NOME E COGNOME']} (Targa: ${r.TARGA}).\nInserisci il MOTIVO della cancellazione (OBBLIGATORIO):`);
    if(motivazione === null || motivazione.trim() === '') { alert("❌ Cancellazione annullata: motivazione mancante."); return; }
    
    state.localAbb = state.localAbb.filter(x => x._id !== id);
    renderAbb();
    
    try {
        await logDelete('ABBONAMENTI', `Cliente: ${r['NOME E COGNOME']} - Targa: ${r.TARGA}`, motivazione.trim());
        await fsDeleteDoc(fsDoc(db, "abbonamenti", id));
        await fetch(CONFIG.GAS_URL, { 
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
            body: JSON.stringify({ action: 'deleteAbbonamento', id: id }) 
        });
    } catch(e) { console.warn(e); }
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
