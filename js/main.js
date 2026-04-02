import { state, CONFIG } from './state.js';
import { fmtDI } from './utils.js';
// LE IMPORTAZIONI ESATTE SONO QUI:
import { fsGetDocs, fsCollection, fsAddDoc, fsDeleteDoc, fsDoc, db } from './firebase-config.js';

import { initAuth } from './moduli/auth.js';
import { initNavigazione, goPage } from './moduli/navigazione.js';
import { initCassa, renderCassa } from './moduli/cassa.js';
import { initLog, renderCancellazioni } from './moduli/log.js';
import { initGiornalieri, renderGiornalieri } from './moduli/giornalieri.js';
import { initPrenotazioni, renderPren, renderTap } from './moduli/prenotazioni.js';
import { initAbbonamenti, renderAbb } from './moduli/abbonamenti.js';
import { initSospesi, renderSospPage, buildSospesiArray, loadSospesiPagati } from './moduli/sospesi.js';
import { initReport, renderReport, renderDash } from './moduli/report.js';

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initNavigazione();
    initCassa();
    initLog();
    initGiornalieri();
    initPrenotazioni();
    initAbbonamenti();
    initReport();
    initDashDates();
});

document.addEventListener('authSuccess', () => {
    document.getElementById('loginScreen').classList.add('out');
    document.getElementById('app').classList.add('show');
    
    if (state.currentUser) {
        const sbName = document.getElementById('sbName');
        const sbRole = document.getElementById('sbRole');
        const sbAvatar = document.getElementById('sbAvatar');
        
        if(sbName) sbName.textContent = state.currentUser.user;
        if(sbRole) sbRole.textContent = state.currentUser.label;
        if(sbAvatar) sbAvatar.textContent = state.currentUser.user.charAt(0).toUpperCase();
        
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = state.currentUser.role === 'admin' ? '' : 'none';
        });
    }

    initFirebaseData();
});

document.addEventListener('pageChanged', (e) => {
    const id = e.detail.pageId;
    if(id === 'report' && state.currentUser?.role === 'admin') renderReport();
    if(id === 'dashboard') renderDash();
    if(id === 'cassa') renderCassa();
    if(id === 'giornalieri') renderGiornalieri();
    if(id === 'prenotazioni') { renderPren(); renderTap(); }
    if(id === 'sospesi') { buildSospesiArray(); renderSospPage(); }
    if(id === 'cancellazioni') renderCancellazioni();
});

function initDashDates() {
    const n = new Date();
    state.dateTo = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    state.dateFrom = new Date(n.getFullYear(), n.getMonth() - 3, n.getDate());
    
    const dtFrom = document.getElementById('dtFrom');
    const dtTo = document.getElementById('dtTo');
    if(dtFrom) dtFrom.value = fmtDI(state.dateFrom);
    if(dtTo) dtTo.value = fmtDI(state.dateTo);

    if(dtFrom) dtFrom.addEventListener('change', onDateChg);
    if(dtTo) dtTo.addEventListener('change', onDateChg);

    document.querySelectorAll('#page-dashboard .qbtn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const txt = btn.textContent;
            let days = 90;
            if(txt.includes('7gg')) days = 7;
            else if(txt.includes('30gg')) days = 30;
            else if(txt.includes('6 mesi')) days = 180;
            else if(txt.includes('1 anno')) days = 365;
            else if(txt.includes('Tutto')) days = 0;

            qp(days, btn);
        });
    });

    const refreshBtn = document.querySelector('.topbar-r .btn');
    if(refreshBtn) refreshBtn.addEventListener('click', () => {
        initFirebaseData();
    });
}

function onDateChg() {
    const f = document.getElementById('dtFrom').value;
    const t = document.getElementById('dtTo').value;
    if(f) state.dateFrom = new Date(f);
    if(t) state.dateTo = new Date(t);
    document.querySelectorAll('#page-dashboard .qbtn').forEach(b => b.classList.remove('on'));
    renderDash();
}

function qp(days, btn) {
    const n = new Date();
    state.dateTo = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    state.dateFrom = days === 0 ? new Date(2024, 0, 1) : new Date(n.getTime() - days * 864e5);
    
    document.getElementById('dtFrom').value = fmtDI(state.dateFrom);
    document.getElementById('dtTo').value = fmtDI(state.dateTo);
    
    document.querySelectorAll('#page-dashboard .qbtn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    renderDash();
}

async function initFirebaseData() {
    const ld = document.getElementById('loader');
    const upd = document.getElementById('lastUpd');
    
    if (ld) { ld.style.display = 'flex'; ld.classList.remove('out'); }
    if (upd) upd.textContent = 'Sincronizzazione...';

    try {
        const snapPren = await fsGetDocs(fsCollection(db, "prenotazioni"));
        state.prenDB = {};
        snapPren.forEach(docSnap => {
            let d = docSnap.data(); d._pid = docSnap.id; 
            if(!state.prenDB[d.dataPren]) state.prenDB[d.dataPren] = [];
            state.prenDB[d.dataPren].push(d);
        });

        const snapTap = await fsGetDocs(fsCollection(db, "tappezzeria"));
        state.tapDB = [];
        snapTap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.tapDB.push(d); });

        const snapGiorn = await fsGetDocs(fsCollection(db, "giornalieri"));
        state.giornDB = [];
        snapGiorn.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.giornDB.push(d); });
        
        const snapCanc = await fsGetDocs(fsCollection(db, "cancellazioni"));
        state.logDB = [];
        snapCanc.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.logDB.push(d); });
        
        const snapUsc = await fsGetDocs(fsCollection(db, "uscite"));
        state.usciteDB = [];
        snapUsc.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.usciteDB.push(d); });

        const snapSosp = await fsGetDocs(fsCollection(db, "sospesi"));
        state.localSosp = []; 
        snapSosp.forEach(docSnap => { 
            let d = docSnap.data(); 
            d._sid = docSnap.id;
            // Leggi stati fatturato/pagato dal documento Firestore
            if (d.fatturato) { d._fatturato = true; d._dataFatt = d.dataFattura || ''; }
            if (d.pagato) { d._pagato = true; d._modPag = d.modPagamento || ''; d._dataPag = d.dataPagamento || ''; }
            state.localSosp.push(d); 
        });

        const snapAbb = await fsGetDocs(fsCollection(db, "abbonamenti"));
        state.localAbb = [];
        snapAbb.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.localAbb.push(d); });

        await loadSospesiPagati();

        // Carica dati Prima Nota da Firebase per Report e Dashboard Analitica
        try {
            const snapPN = await fsGetDocs(fsCollection(db, "primaNota"));
            const pnRows = [];
            snapPN.forEach(docSnap => { pnRows.push(docSnap.data()); });
            state.rawData = { primaNota: { rows: pnRows } };
            console.log(`Prima Nota caricata: ${pnRows.length} record`);
        } catch(pnErr) {
            console.warn("Prima Nota Firebase non disponibile:", pnErr.message);
            if(!state.rawData) state.rawData = { primaNota: { rows: [] } };
        }

        // Carica Presenze Dipendenti per Dashboard Analitica (costo lavoro)
        try {
            const snapPres = await fsGetDocs(fsCollection(db, "presenzeDipendenti"));
            state.presenzeDB = [];
            snapPres.forEach(docSnap => { state.presenzeDB.push(docSnap.data()); });
            console.log(`Presenze caricate: ${state.presenzeDB.length} record`);
        } catch(presErr) {
            console.warn("Presenze non disponibili:", presErr.message);
        }

        if (upd) upd.textContent = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

    } catch(e) { 
        console.error("Errore Firebase Load", e); 
        if (upd) upd.textContent = 'Errore agg.';
    } finally {
        if (ld) {
            ld.classList.add('out');
            setTimeout(() => ld.style.display = 'none', 400);
        }
    }

    renderAbb();
    renderPren();
    renderTap();
    renderGiornalieri();
    initSospesi();
    renderCassa();
    if (document.getElementById('page-dashboard')?.classList.contains('show')) renderDash();
    
    if(!document.querySelector('.page.show') || document.querySelector('.page.show').id === 'page-dashboard') {
        goPage('cassa');
    }

    // Chiusura automatica giornate precedenti (lun-sab, dopo le 20:00)
    await autoChiusuraGiornate();
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBanner = document.getElementById('pwa-install-banner');
    if (installBanner && !localStorage.getItem('pwa_banner_dismissed')) {
        installBanner.style.display = 'block';
    }
});

document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
    const installBanner = document.getElementById('pwa-install-banner');
    if(installBanner) installBanner.style.display = 'none';
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') console.log('PWA installata');
        deferredPrompt = null;
    }
});

document.getElementById('pwa-close')?.addEventListener('click', () => {
    const installBanner = document.getElementById('pwa-install-banner');
    if(installBanner) installBanner.style.display = 'none';
    localStorage.setItem('pwa_banner_dismissed', 'true');
});

window.addEventListener('appinstalled', () => {
    const installBanner = document.getElementById('pwa-install-banner');
    if(installBanner) installBanner.style.display = 'none';
    console.log('Installazione completata');
});

// ═══════════════════════════════════════════════════════════════════
// AUTO-CHIUSURA GIORNATE — scrive totali in Prima Nota
// Controlla fino a 7 giorni indietro, solo lun-sab
// ═══════════════════════════════════════════════════════════════════
async function autoChiusuraGiornate() {
    try {
        // Carica il registro delle giornate già chiuse
        const snapChiuse = await fsGetDocs(fsCollection(db, "giornateChiuse"));
        const giornateChiuse = new Set();
        snapChiuse.forEach(docSnap => {
            const d = docSnap.data();
            if (d.data) giornateChiuse.add(d.data);
        });

        const oggi = new Date();
        
        for (let i = 1; i <= 7; i++) {
            const giorno = new Date(oggi);
            giorno.setDate(giorno.getDate() - i);
            
            // Salta la domenica (0 = domenica)
            if (giorno.getDay() === 0) continue;
            
            const dStr = fmtDI(giorno); // YYYY-MM-DD
            const dIta = dStr.split('-').reverse().join('/'); // DD/MM/YYYY
            
            if (giornateChiuse.has(dStr)) continue;
            
            // --- TOTALI LAVAGGIO (prenotazioni) ---
            const prenGiorno = state.prenDB[dStr] || [];
            let lavContanti = 0, lavPos = 0;
            prenGiorno.forEach(p => {
                if (p.saldato === 'SI') {
                    const imp = parseFloat(p.prezzo) || 0;
                    if (p.saldo === 'CONTANTI') lavContanti += imp;
                    else if (p.saldo === 'POS') lavPos += imp;
                }
            });

            // --- TOTALI TAPPEZZERIA ---
            let tapContanti = 0, tapPos = 0;
            state.tapDB.forEach(t => {
                if (t.status === 'OUT' && t.dataOut === dIta && t.pagamento !== 'SOSPESO') {
                    const imp = parseFloat(t.prezzo) || 0;
                    const mod = (t.pagamento || '').toUpperCase();
                    if (mod === 'CONTANTI') tapContanti += imp;
                    else if (mod === 'POS') tapPos += imp;
                }
            });

            // --- TOTALI PARCHEGGIO AD ORE ---
            let parContanti = 0, parPos = 0;
            state.giornDB.forEach(g => {
                if (g.status === 'OUT' && g.dataOut === dStr) {
                    const imp = parseFloat(g.prezzoFinale) || 0;
                    if (g.pagamento === 'CONTANTI') parContanti += imp;
                    else if (g.pagamento === 'POS') parPos += imp;
                }
            });

            // --- TOTALI USCITE ---
            let uscContanti = 0, uscPos = 0;
            state.usciteDB.filter(u => u.data === dStr).forEach(u => {
                const imp = parseFloat(u.importo) || 0;
                if (u.metodo === 'CONTANTI') uscContanti += imp;
                else if (u.metodo === 'POS') uscPos += imp;
            });

            const totLav = lavContanti + lavPos + tapContanti + tapPos;
            const totPar = parContanti + parPos;
            const totUsc = uscContanti + uscPos;

            // Nessun movimento? Segna chiusa e vai avanti
            if (totLav === 0 && totPar === 0 && totUsc === 0) {
                await fsAddDoc(fsCollection(db, "giornateChiuse"), { data: dStr, timestamp: Date.now(), note: 'Nessun movimento' });
                continue;
            }

            // --- SCRIVI IN PRIMA NOTA ---
            const righe = [];
            if (lavContanti > 0) righe.push({ DATA: dIta, dataISO: dStr, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'INCASSO CASH', Descrizione: 'INCASSO CASH', ENTRATA: lavContanti, Entrata: lavContanti, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'CONTANTI', timestamp: Date.now() });
            if (lavPos > 0) righe.push({ DATA: dIta, dataISO: dStr, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'INCASSO POS', Descrizione: 'INCASSO POS', ENTRATA: lavPos, Entrata: lavPos, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'POS', timestamp: Date.now() });
            if (tapContanti > 0) righe.push({ DATA: dIta, dataISO: dStr, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'TAPPEZZERIA CASH', Descrizione: 'TAPPEZZERIA CASH', ENTRATA: tapContanti, Entrata: tapContanti, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'CONTANTI', timestamp: Date.now() });
            if (tapPos > 0) righe.push({ DATA: dIta, dataISO: dStr, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'TAPPEZZERIA POS', Descrizione: 'TAPPEZZERIA POS', ENTRATA: tapPos, Entrata: tapPos, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'POS', timestamp: Date.now() });
            if (parContanti > 0) righe.push({ DATA: dIta, dataISO: dStr, 'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'AD ORE', Descrizione: 'PARCHEGGIO AD ORE CASH', ENTRATA: parContanti, Entrata: parContanti, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'CONTANTI', timestamp: Date.now() });
            if (parPos > 0) righe.push({ DATA: dIta, dataISO: dStr, 'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'AD ORE', Descrizione: 'PARCHEGGIO AD ORE POS', ENTRATA: parPos, Entrata: parPos, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'POS', timestamp: Date.now() });
            if (uscContanti > 0) righe.push({ DATA: dIta, dataISO: dStr, 'CENTRO DI COSTO': 'VARIE', Categoria: 'VARIE', 'PRIMANOTA CLIENTI/FORNITORI': 'USCITE GIORNATA', Descrizione: 'USCITE GIORNATA CASH', ENTRATA: 0, Entrata: 0, USCITE: uscContanti, Uscite: uscContanti, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'CONTANTI', timestamp: Date.now() });
            if (uscPos > 0) righe.push({ DATA: dIta, dataISO: dStr, 'CENTRO DI COSTO': 'VARIE', Categoria: 'VARIE', 'PRIMANOTA CLIENTI/FORNITORI': 'USCITE GIORNATA', Descrizione: 'USCITE GIORNATA POS', ENTRATA: 0, Entrata: 0, USCITE: uscPos, Uscite: uscPos, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'POS', timestamp: Date.now() });

            for (const riga of righe) {
                await fsAddDoc(fsCollection(db, "primaNota"), riga);
            }

            // Segna giornata chiusa
            await fsAddDoc(fsCollection(db, "giornateChiuse"), {
                data: dStr, timestamp: Date.now(),
                lavContanti, lavPos, tapContanti, tapPos,
                parContanti, parPos, uscContanti, uscPos,
                totaleEntrate: totLav + totPar, totaleUscite: totUsc
            });

            console.log(`✅ Giornata ${dIta} chiusa — Lav: €${totLav} | Par: €${totPar} | Usc: €${totUsc}`);
        }
    } catch (e) {
        console.warn('Errore auto-chiusura giornate:', e.message);
    }
}
