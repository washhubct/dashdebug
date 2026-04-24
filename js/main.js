import { state, CONFIG } from './state.js';
import { fmtDI } from './utils.js';
// LE IMPORTAZIONI ESATTE SONO QUI:
import { fsGetDocs, fsCollection, fsAddDoc, fsDeleteDoc, fsDoc, db } from './firebase-config.js';
import { query, where } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

import { initAuth } from './moduli/auth.js';
import { initNavigazione, goPage } from './moduli/navigazione.js';
import { initCassa, renderCassa } from './moduli/cassa.js';
import { initLog, renderCancellazioni } from './moduli/log.js';
import { initGiornalieri, renderGiornalieri } from './moduli/giornalieri.js';
import { initPrenotazioni, renderPren, renderTap } from './moduli/prenotazioni.js';
import { initAbbonamenti, renderAbb } from './moduli/abbonamenti.js';
import { initSospesi, renderSospPage, buildSospesiArray, loadSospesiPagati } from './moduli/sospesi.js';
import { initReport, renderReport, renderDash } from './moduli/report.js';
import { initPresenze, renderPresenze } from './moduli/presenze.js';
import { initClienti, caricaClienti, renderClienti } from './moduli/clienti.js';
import { initCassaAutomatica } from './moduli/cassa-automatica.js';
import { initCassaStato } from './moduli/cassa-stato.js';

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initNavigazione();
    initCassa();
    initLog();
    initGiornalieri();
    initPrenotazioni();
    initAbbonamenti();
    initReport();
    initPresenze();
    initClienti();
    initCassaStato();
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

    initCassaAutomatica();
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
    if(id === 'presenze') renderPresenze();
    if(id === 'clienti') renderClienti();
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

function needsHistorical(dateFrom) {
    if (!dateFrom) return false;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 400);
    return dateFrom < cutoff;
}

async function onDateChg() {
    const f = document.getElementById('dtFrom').value;
    const t = document.getElementById('dtTo').value;
    if(f) state.dateFrom = new Date(f);
    if(t) state.dateTo = new Date(t);
    document.querySelectorAll('#page-dashboard .qbtn').forEach(b => b.classList.remove('on'));
    if (needsHistorical(state.dateFrom)) await loadHistoricalData();
    renderDash();
}

async function qp(days, btn) {
    const n = new Date();
    state.dateTo = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    state.dateFrom = days === 0 ? new Date(2024, 0, 1) : new Date(n.getTime() - days * 864e5);

    document.getElementById('dtFrom').value = fmtDI(state.dateFrom);
    document.getElementById('dtTo').value = fmtDI(state.dateTo);

    document.querySelectorAll('#page-dashboard .qbtn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    if (needsHistorical(state.dateFrom)) await loadHistoricalData();
    renderDash();
}

// Cutoff per fast-load: solo ultimi ~13 mesi su prenotazioni + primaNota.
// Storico pieno disponibile on-demand via loadHistoricalData().
function getCutoffISO(days = 400) {
    const d = new Date(); d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function loadPrenotazioniFast(cutoff) {
    // Due query parallele: recenti (per calendario/cassa) + tutti i SOSPESO/FATTURATO (per pagina Sospesi anche storici)
    const [snapRecenti, snapSosp, snapFatt] = await Promise.all([
        fsGetDocs(query(fsCollection(db, "prenotazioni"), where("dataPren", ">=", cutoff))),
        fsGetDocs(query(fsCollection(db, "prenotazioni"), where("saldo", "==", "SOSPESO"))),
        fsGetDocs(query(fsCollection(db, "prenotazioni"), where("saldo", "==", "FATTURATO"))),
    ]);
    state.prenDB = {};
    const seen = new Set();
    const addDoc = docSnap => {
        if (seen.has(docSnap.id)) return;
        seen.add(docSnap.id);
        const d = docSnap.data(); d._pid = docSnap.id;
        if (!state.prenDB[d.dataPren]) state.prenDB[d.dataPren] = [];
        state.prenDB[d.dataPren].push(d);
    };
    snapRecenti.forEach(addDoc);
    snapSosp.forEach(addDoc);
    snapFatt.forEach(addDoc);
}

async function loadPrimaNotaFast(cutoff) {
    const snapPN = await fsGetDocs(query(fsCollection(db, "primaNota"), where("dataISO", ">=", cutoff)));
    const pnRows = [];
    snapPN.forEach(docSnap => pnRows.push(docSnap.data()));
    state.rawData = { primaNota: { rows: pnRows } };
    console.log(`Prima Nota (ultimi 13m): ${pnRows.length} record`);
}

// Carica lo storico completo on-demand quando l'utente richiede range oltre cutoff
export async function loadHistoricalData() {
    if (state._historicalLoaded) return;
    state._historicalLoaded = true;
    try {
        const [snapPren, snapPN] = await Promise.all([
            fsGetDocs(fsCollection(db, "prenotazioni")),
            fsGetDocs(fsCollection(db, "primaNota")),
        ]);
        // Merge prenotazioni mancanti
        const seen = new Set();
        for (const entries of Object.values(state.prenDB)) entries.forEach(e => seen.add(e._pid));
        snapPren.forEach(docSnap => {
            if (seen.has(docSnap.id)) return;
            const d = docSnap.data(); d._pid = docSnap.id;
            if (!state.prenDB[d.dataPren]) state.prenDB[d.dataPren] = [];
            state.prenDB[d.dataPren].push(d);
        });
        const pnRows = [];
        snapPN.forEach(docSnap => pnRows.push(docSnap.data()));
        state.rawData = { primaNota: { rows: pnRows } };
        console.log(`Storico completo caricato: primaNota ${pnRows.length}`);
    } catch (e) {
        console.warn("Errore caricamento storico:", e.message);
        state._historicalLoaded = false;
    }
}

async function initFirebaseData() {
    const ld = document.getElementById('loader');
    const upd = document.getElementById('lastUpd');

    if (ld) { ld.style.display = 'flex'; ld.classList.remove('out'); }
    if (upd) upd.textContent = 'Sincronizzazione...';

    const cutoff = getCutoffISO(400);
    state._historicalLoaded = false;

    try {
        // Tutte le collezioni in parallelo. Ogni task gestisce le sue eccezioni.
        const tasks = [
            loadPrenotazioniFast(cutoff),

            fsGetDocs(fsCollection(db, "tappezzeria")).then(snap => {
                state.tapDB = [];
                snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.tapDB.push(d); });
            }),

            fsGetDocs(fsCollection(db, "giornalieri")).then(snap => {
                state.giornDB = [];
                snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.giornDB.push(d); });
            }),

            // Log cancellazioni: solo admin (rules). Per operator l'errore è atteso.
            (async () => {
                state.logDB = [];
                try {
                    const snap = await fsGetDocs(fsCollection(db, "cancellazioni"));
                    snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.logDB.push(d); });
                } catch (logErr) {
                    console.warn("Log cancellazioni non accessibile (permessi):", logErr.message);
                }
            })(),

            fsGetDocs(fsCollection(db, "uscite")).then(snap => {
                state.usciteDB = [];
                snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.usciteDB.push(d); });
            }),

            fsGetDocs(fsCollection(db, "sospesi")).then(snap => {
                state.localSosp = [];
                snap.forEach(docSnap => {
                    let d = docSnap.data();
                    d._sid = docSnap.id;
                    if (d.fatturato) { d._fatturato = true; d._dataFatt = d.dataFattura || ''; }
                    if (d.pagato) { d._pagato = true; d._modPag = d.modPagamento || ''; d._dataPag = d.dataPagamento || ''; }
                    state.localSosp.push(d);
                });
            }),

            fsGetDocs(fsCollection(db, "abbonamenti")).then(snap => {
                state.localAbb = [];
                snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.localAbb.push(d); });
            }),

            loadPrimaNotaFast(cutoff).catch(pnErr => {
                console.warn("Prima Nota Firebase non disponibile:", pnErr.message);
                if (!state.rawData) state.rawData = { primaNota: { rows: [] } };
            }),

            (async () => {
                try {
                    const snap = await fsGetDocs(fsCollection(db, "presenzeDipendenti"));
                    state.presenzeDB = [];
                    snap.forEach(docSnap => state.presenzeDB.push(docSnap.data()));
                    console.log(`Presenze caricate: ${state.presenzeDB.length} record`);
                } catch (presErr) {
                    console.warn("Presenze non disponibili:", presErr.message);
                }
            })(),

            caricaClienti(),
        ];

        await Promise.all(tasks);
        await loadSospesiPagati();

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

    // Chiusura automatica giornate precedenti (lun-sab)
    await autoChiusuraGiornate();
    
    // Timer: controlla ogni minuto se sono le 20:00 per chiudere la giornata corrente
    avviaTimerChiusura();
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

// ═══════════════════════════════════════════════════════════════════
// TIMER CHIUSURA GIORNATA ALLE 20:00
// Controlla ogni minuto — se sono le 20:00+ e oggi non è stata
// chiusa, chiude la giornata corrente
// ═══════════════════════════════════════════════════════════════════
let chiusuraOggiEseguita = false;

function avviaTimerChiusura() {
    // Controlla subito se sono già passate le 20:00
    checkChiusuraOre20();
    // Poi controlla ogni 60 secondi
    setInterval(checkChiusuraOre20, 60000);
}

async function checkChiusuraOre20() {
    if (chiusuraOggiEseguita) return;
    
    const now = new Date();
    const ora = now.getHours();
    const giorno = now.getDay(); // 0=dom
    
    // Solo lun-sab (1-6) e dopo le 20:00
    if (giorno === 0 || ora < 20) return;
    
    const oggi = fmtDI(now);
    
    // Verifica se già chiusa
    try {
        const snapChiuse = await fsGetDocs(fsCollection(db, "giornateChiuse"));
        let giaChiusa = false;
        snapChiuse.forEach(docSnap => {
            if (docSnap.data().data === oggi) giaChiusa = true;
        });
        
        if (giaChiusa) {
            chiusuraOggiEseguita = true;
            return;
        }
        
        // Chiudi la giornata di oggi
        const dIta = oggi.split('-').reverse().join('/');
        
        // Lavaggi
        const prenOggi = state.prenDB[oggi] || [];
        let lavContanti = 0, lavPos = 0;
        prenOggi.forEach(p => {
            if (p.saldato === 'SI') {
                const imp = parseFloat(p.prezzo) || 0;
                if (p.saldo === 'CONTANTI') lavContanti += imp;
                else if (p.saldo === 'POS') lavPos += imp;
            }
        });

        // Tappezzeria
        let tapContanti = 0, tapPos = 0;
        state.tapDB.forEach(t => {
            if (t.status === 'OUT' && t.dataOut === dIta && t.pagamento !== 'SOSPESO') {
                const imp = parseFloat(t.prezzo) || 0;
                const mod = (t.pagamento || '').toUpperCase();
                if (mod === 'CONTANTI') tapContanti += imp;
                else if (mod === 'POS') tapPos += imp;
            }
        });

        // Parcheggio ad ore
        let parContanti = 0, parPos = 0;
        state.giornDB.forEach(g => {
            if (g.status === 'OUT' && g.dataOut === oggi) {
                const imp = parseFloat(g.prezzoFinale) || 0;
                if (g.pagamento === 'CONTANTI') parContanti += imp;
                else if (g.pagamento === 'POS') parPos += imp;
            }
        });

        // Uscite
        let uscContanti = 0, uscPos = 0;
        state.usciteDB.filter(u => u.data === oggi).forEach(u => {
            const imp = parseFloat(u.importo) || 0;
            if (u.metodo === 'CONTANTI') uscContanti += imp;
            else if (u.metodo === 'POS') uscPos += imp;
        });

        const totLav = lavContanti + lavPos + tapContanti + tapPos;
        const totPar = parContanti + parPos;
        const totUsc = uscContanti + uscPos;

        if (totLav === 0 && totPar === 0 && totUsc === 0) {
            await fsAddDoc(fsCollection(db, "giornateChiuse"), { data: oggi, timestamp: Date.now(), note: 'Nessun movimento' });
            chiusuraOggiEseguita = true;
            return;
        }

        // Scrivi in Prima Nota
        const righe = [];
        if (lavContanti > 0) righe.push({ DATA: dIta, dataISO: oggi, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'INCASSO CASH', Descrizione: 'INCASSO CASH', ENTRATA: lavContanti, Entrata: lavContanti, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'CONTANTI', timestamp: Date.now() });
        if (lavPos > 0) righe.push({ DATA: dIta, dataISO: oggi, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'INCASSO POS', Descrizione: 'INCASSO POS', ENTRATA: lavPos, Entrata: lavPos, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'POS', timestamp: Date.now() });
        if (tapContanti > 0) righe.push({ DATA: dIta, dataISO: oggi, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'TAPPEZZERIA CASH', Descrizione: 'TAPPEZZERIA CASH', ENTRATA: tapContanti, Entrata: tapContanti, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'CONTANTI', timestamp: Date.now() });
        if (tapPos > 0) righe.push({ DATA: dIta, dataISO: oggi, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'TAPPEZZERIA POS', Descrizione: 'TAPPEZZERIA POS', ENTRATA: tapPos, Entrata: tapPos, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'POS', timestamp: Date.now() });
        if (parContanti > 0) righe.push({ DATA: dIta, dataISO: oggi, 'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'AD ORE', Descrizione: 'PARCHEGGIO AD ORE CASH', ENTRATA: parContanti, Entrata: parContanti, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'CONTANTI', timestamp: Date.now() });
        if (parPos > 0) righe.push({ DATA: dIta, dataISO: oggi, 'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'AD ORE', Descrizione: 'PARCHEGGIO AD ORE POS', ENTRATA: parPos, Entrata: parPos, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'POS', timestamp: Date.now() });
        if (uscContanti > 0) righe.push({ DATA: dIta, dataISO: oggi, 'CENTRO DI COSTO': 'VARIE', Categoria: 'VARIE', 'PRIMANOTA CLIENTI/FORNITORI': 'USCITE GIORNATA', Descrizione: 'USCITE GIORNATA CASH', ENTRATA: 0, Entrata: 0, USCITE: uscContanti, Uscite: uscContanti, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'CONTANTI', timestamp: Date.now() });
        if (uscPos > 0) righe.push({ DATA: dIta, dataISO: oggi, 'CENTRO DI COSTO': 'VARIE', Categoria: 'VARIE', 'PRIMANOTA CLIENTI/FORNITORI': 'USCITE GIORNATA', Descrizione: 'USCITE GIORNATA POS', ENTRATA: 0, Entrata: 0, USCITE: uscPos, Uscite: uscPos, SOSPESO: 0, Sospeso: 0, "MODALITA'": 'POS', timestamp: Date.now() });

        for (const riga of righe) {
            await fsAddDoc(fsCollection(db, "primaNota"), riga);
        }

        await fsAddDoc(fsCollection(db, "giornateChiuse"), {
            data: oggi, timestamp: Date.now(),
            lavContanti, lavPos, tapContanti, tapPos,
            parContanti, parPos, uscContanti, uscPos,
            totaleEntrate: totLav + totPar, totaleUscite: totUsc
        });

        chiusuraOggiEseguita = true;
        console.log(`✅ Giornata ${dIta} chiusa alle 20:00 — Lav: €${totLav} | Par: €${totPar} | Usc: €${totUsc}`);
        
    } catch (e) {
        console.warn('Errore chiusura ore 20:', e.message);
    }
}
