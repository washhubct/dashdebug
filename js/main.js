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
    if(id === 'sospesi') renderSospPage();
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
