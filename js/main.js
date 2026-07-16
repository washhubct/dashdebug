import { state, CONFIG } from './state.js';
import { fmtDI } from './utils.js';
// LE IMPORTAZIONI ESATTE SONO QUI:
import { auth, fsGetDocs, fsGetDoc, fsCollection, fsDoc, db } from './firebase-config.js';
import { query, where } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

import { initAuth, isAdmin } from './moduli/auth.js';
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
import { initServiziAggiuntivi } from './moduli/servizi-aggiuntivi.js';
import { initMarketing, renderMarketing } from './moduli/marketing.js';
import { initReferralDash, renderReferralDash } from './moduli/referral-dash.js';
import { initIncassiManuali } from './moduli/incassi-manuali.js';
import { initVouchers, renderVouchers } from './moduli/vouchers.js';
import { initMessaggi } from './moduli/messaggi.js';
import { initFidelai } from './moduli/fidelai.js';

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
    initMarketing();
    initReferralDash();
    initVouchers();
    initIncassiManuali();
    initMessaggi();
    initFidelai();
    initDashDates();
});

document.addEventListener('authSuccess', async () => {
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

    await caricaSedePermesse();

    initCassaAutomatica();
    if (state.currentUser?.role === 'admin') initServiziAggiuntivi();
    initSelezioneSedeUI();
    initFirebaseData();
});

async function caricaSedePermesse() {
    if (state.currentUser?.role === 'admin') {
        state.sedePermesse = ['lungomare', 'paesi-etnei'];
    } else {
        try {
            const uid = auth.currentUser?.uid;
            const snap = uid ? await fsGetDoc(fsDoc(db, 'utenti', uid)) : null;
            state.sedePermesse = (snap?.exists() && Array.isArray(snap.data().sedi))
                ? snap.data().sedi
                : ['lungomare'];
        } catch {
            state.sedePermesse = ['lungomare'];
        }
    }
    // Correggi sedeAttiva se non è tra quelle permesse
    if (!state.sedePermesse.includes(state.sedeAttiva)) {
        state.sedeAttiva = state.sedePermesse[0];
        localStorage.setItem('sedeAttiva', state.sedeAttiva);
    }
}

function initSelezioneSedeUI() {
    const wrapper = document.getElementById('sbSede');
    if (!wrapper) return;

    // Nasconde i bottoni delle sedi non permesse
    wrapper.querySelectorAll('.sb-sede-btn').forEach(btn => {
        btn.style.display = state.sedePermesse.includes(btn.dataset.sede) ? '' : 'none';
    });

    // Marca sempre il body con la sede attiva (serve al CSS per nascondere/mostrare sezioni)
    document.body.dataset.sede = state.sedeAttiva;

    // Mostra il selettore solo se l'utente ha accesso a più di una sede
    if (state.sedePermesse.length < 2) return;
    wrapper.style.display = 'block';

    function aggiornaBtns() {
        wrapper.querySelectorAll('.sb-sede-btn').forEach(btn => {
            btn.classList.toggle('on', btn.dataset.sede === state.sedeAttiva);
        });
        document.body.dataset.sede = state.sedeAttiva;
    }
    aggiornaBtns();

    wrapper.addEventListener('click', async (e) => {
        const btn = e.target.closest('.sb-sede-btn');
        if (!btn || btn.dataset.sede === state.sedeAttiva) return;

        state.sedeAttiva = btn.dataset.sede;
        localStorage.setItem('sedeAttiva', state.sedeAttiva);
        aggiornaBtns();

        state._historicalLoaded = false;
        await initFirebaseData();

        const pageAttiva = document.querySelector('.page.show');
        let pageId = pageAttiva ? pageAttiva.id.replace('page-', '') : null;

        // A Paesi Etnei alcune pagine sono nascoste: redirigi a Cassa
        const HIDDEN_PE = ['prenotazioni', 'abbonamenti', 'giornalieri', 'sospesi', 'clienti', 'servizi', 'marketing', 'referral', 'vouchers'];
        if (state.sedeAttiva === 'paesi-etnei' && HIDDEN_PE.includes(pageId)) {
            goPage('cassa');
            return;
        }

        if (pageId) {
            document.dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId } }));
        }
    });
}

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
    if(id === 'marketing') renderMarketing();
    if(id === 'referral') renderReferralDash();
    if(id === 'vouchers') renderVouchers();
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
    const sede = state.sedeAttiva;
    const [snapRecenti, snapSosp, snapFatt] = await Promise.all([
        fsGetDocs(query(fsCollection(db, "prenotazioni"), where("sedeId", "==", sede), where("dataPren", ">=", cutoff))),
        fsGetDocs(query(fsCollection(db, "prenotazioni"), where("sedeId", "==", sede), where("saldo", "==", "SOSPESO"))),
        fsGetDocs(query(fsCollection(db, "prenotazioni"), where("sedeId", "==", sede), where("saldo", "==", "FATTURATO"))),
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
    const sede = state.sedeAttiva;
    const snapPN = await fsGetDocs(query(fsCollection(db, "primaNota"), where("sedeId", "==", sede), where("dataISO", ">=", cutoff)));
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
        const sede = state.sedeAttiva;
        // Prima Nota storica: leggibile solo dall'admin (rules limitano l'operatore
        // a oggi). Per l'operatore la query fallirebbe e trascinerebbe giù anche le
        // prenotazioni nel Promise.all → carichiamo la Prima Nota storica solo se admin.
        const admin = isAdmin();
        const [snapPren, snapPN] = await Promise.all([
            fsGetDocs(query(fsCollection(db, "prenotazioni"), where("sedeId", "==", sede))),
            admin ? fsGetDocs(query(fsCollection(db, "primaNota"), where("sedeId", "==", sede))) : Promise.resolve(null),
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
        if (snapPN) {
            const pnRows = [];
            snapPN.forEach(docSnap => pnRows.push(docSnap.data()));
            state.rawData = { primaNota: { rows: pnRows } };
            console.log(`Storico completo caricato: primaNota ${pnRows.length}`);
        }
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
    // Prima Nota: gli operatori possono leggere per rules SOLO i record di oggi
    // (separazione operatore/admin). Se interrogassimo 400 giorni, la query
    // conterrebbe record vecchi vietati e Firestore rifiuterebbe TUTTA la query
    // (permission-denied) → l'operatore non vedrebbe alcun incasso. Quindi per
    // gli operatori il cutoff Prima Nota è oggi; l'admin mantiene lo storico.
    const pnCutoff = isAdmin() ? cutoff : fmtDI(new Date());
    state._historicalLoaded = false;

    try {
        // Tutte le collezioni in parallelo. Ogni task gestisce le sue eccezioni.
        const tasks = [
            loadPrenotazioniFast(cutoff).catch(e => { console.error("Prenotazioni non caricate:", e.message); state.prenDB = {}; }),

            fsGetDocs(query(fsCollection(db, "tappezzeria"), where("sedeId", "==", state.sedeAttiva))).then(snap => {
                state.tapDB = [];
                snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.tapDB.push(d); });
            }).catch(e => { console.warn("Tappezzeria non disponibile:", e.message); state.tapDB = []; }),

            fsGetDocs(query(fsCollection(db, "giornalieri"), where("sedeId", "==", state.sedeAttiva))).then(snap => {
                state.giornDB = [];
                snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.giornDB.push(d); });
            }).catch(e => { console.warn("Giornalieri non disponibili:", e.message); state.giornDB = []; }),

            // Log cancellazioni: solo admin (rules). Per operator l'errore è atteso.
            (async () => {
                state.logDB = [];
                try {
                    const snap = await fsGetDocs(query(fsCollection(db, "cancellazioni"), where("sedeId", "==", state.sedeAttiva)));
                    snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.logDB.push(d); });
                } catch (logErr) {
                    console.warn("Log cancellazioni non accessibile (permessi):", logErr.message);
                }
            })(),

            fsGetDocs(query(fsCollection(db, "uscite"), where("sedeId", "==", state.sedeAttiva))).then(snap => {
                state.usciteDB = [];
                snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.usciteDB.push(d); });
            }).catch(e => { console.warn("Uscite non disponibili:", e.message); state.usciteDB = []; }),

            fsGetDocs(query(fsCollection(db, "incassiManuali"), where("sedeId", "==", state.sedeAttiva))).then(snap => {
                state.incassiManualiDB = [];
                snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.incassiManualiDB.push(d); });
            }).catch(e => { console.warn("Incassi manuali non disponibili:", e.message); state.incassiManualiDB = []; }),

            fsGetDocs(query(fsCollection(db, "sospesi"), where("sedeId", "==", state.sedeAttiva))).then(snap => {
                state.localSosp = [];
                snap.forEach(docSnap => {
                    let d = docSnap.data();
                    d._sid = docSnap.id;
                    if (d.fatturato) { d._fatturato = true; d._dataFatt = d.dataFattura || ''; }
                    if (d.pagato) { d._pagato = true; d._modPag = d.modPagamento || ''; d._dataPag = d.dataPagamento || ''; }
                    state.localSosp.push(d);
                });
            }).catch(e => { console.warn("Sospesi non disponibili:", e.message); state.localSosp = []; }),

            fsGetDocs(query(fsCollection(db, "abbonamenti"), where("sedeId", "==", state.sedeAttiva))).then(snap => {
                state.localAbb = [];
                snap.forEach(docSnap => { let d = docSnap.data(); d._id = docSnap.id; state.localAbb.push(d); });
            }).catch(e => { console.warn("Abbonamenti non disponibili:", e.message); state.localAbb = []; }),

            loadPrimaNotaFast(pnCutoff).catch(pnErr => {
                console.warn("Prima Nota Firebase non disponibile:", pnErr.message);
                if (!state.rawData) state.rawData = { primaNota: { rows: [] } };
            }),

            (async () => {
                try {
                    const snap = await fsGetDocs(query(fsCollection(db, "presenzeDipendenti"), where("sedeId", "==", state.sedeAttiva)));
                    state.presenzeDB = [];
                    snap.forEach(docSnap => state.presenzeDB.push(docSnap.data()));
                    console.log(`Presenze caricate: ${state.presenzeDB.length} record`);
                } catch (presErr) {
                    console.warn("Presenze non disponibili:", presErr.message);
                }
            })(),

            caricaClienti().catch(e => { console.warn("Clienti non disponibili:", e.message); }),
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

    // Chiusura giornate: server-side, Cloud Function `chiusuraGiornaliera`
    // (ore 21:00 Europe/Rome). Rimossa dal client il 16/07/2026: eseguirla
    // qui dipendeva dal login e dalla versione JS in cache — fonte dei bug
    // di duplicazione Prima Nota di luglio 2026.
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

