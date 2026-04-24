// ═══════════════════════════════════════════════════════════════════
// CASSA AUTOMATICA VNE — modulo client per dashdebug
// Parla col bridge Python (cassa.washhub.it) tramite bearer token.
// Centesimi ovunque verso il bridge; euro nello state e nella UI.
// ═══════════════════════════════════════════════════════════════════
import { db, fsCollection, fsDoc } from '../firebase-config.js';
import { getDoc } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { state } from '../state.js';
import { fEur, esc } from '../utils.js';

const LOG = '[CASSA-AUTO]';

// Mappatura codici mess VNE → testo italiano per l'operatore.
// Fonte: bridge-cassa/PROTOCOLLO-VNE-NOTES.md
const VNE_MESS_MAP = {
    100: 'Transazione non trovata, riprova',
    101: 'Importo non valido',
    102: 'Operatore non riconosciuto',
    105: 'Importo fuori limiti cassa',
    106: 'Taglio non disponibile in cassa, rifornire',
    110: 'Cassa occupata da altra operazione',
    111: 'Operazione non rimborsabile',
    115: 'Rimborso non possibile in questo stato',
    120: 'Token autenticazione errato',
    130: 'Comando non supportato dalla cassa',
    200: 'Erogatore monete in errore',
    210: 'Hopper monete in errore',
    220: 'Lettore banconote in errore',
    230: 'Errore hardware cassa, contattare assistenza',
};

function mapVneError(payload) {
    if (!payload) return 'Errore sconosciuto';
    if (payload.error === 'unauthorized') return 'Token autenticazione errato';
    if (payload.error === 'vne_unreachable') return 'Cassa non raggiungibile (bridge offline?)';
    if (payload.error === 'vne_timeout') return 'Timeout cassa: nessuna risposta';
    if (payload.error === 'vne_nack') {
        const m = payload.vne_mess;
        return VNE_MESS_MAP[m] || `Errore cassa (codice ${m})`;
    }
    return payload.error || 'Errore generico';
}

// ───────────────────────── State + config ─────────────────────────
state.cassaAuto = {
    enabled: false,
    bridgeUrl: '',
    bridgeToken: '',
    pollingIntervalMs: 1500,
    maxPollingMs: 180000,
    loaded: false,
};

export async function initCassaAutomatica() {
    try {
        const ref = fsDoc(db, 'config', 'cassaAutomatica');
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            console.log(LOG, 'doc config/cassaAutomatica non presente — modulo disabilitato');
            return;
        }
        const cfg = snap.data() || {};
        Object.assign(state.cassaAuto, {
            enabled: !!cfg.enabled,
            bridgeUrl: (cfg.bridgeUrl || '').replace(/\/$/, ''),
            bridgeToken: cfg.bridgeToken || '',
            pollingIntervalMs: cfg.pollingIntervalMs || 1500,
            maxPollingMs: cfg.maxPollingMs || 180000,
            loaded: true,
        });
        console.log(LOG, 'config caricato', { enabled: state.cassaAuto.enabled, url: state.cassaAuto.bridgeUrl });
    } catch (e) {
        console.warn(LOG, 'config non leggibile:', e.message);
    }
}

// ───────────────────────── HTTP helper ─────────────────────────
async function bridge(path, opts = {}) {
    const cfg = state.cassaAuto;
    if (!cfg.bridgeUrl) throw new Error('Bridge URL non configurato');
    const url = cfg.bridgeUrl + path;
    const headers = {
        'Authorization': 'Bearer ' + cfg.bridgeToken,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
    };
    const init = { method: opts.method || 'GET', headers };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    const r = await fetch(url, init);
    let data;
    try { data = await r.json(); } catch { data = { error: 'parse_error' }; }
    if (!r.ok) {
        const err = new Error(mapVneError(data));
        err.payload = data;
        err.httpStatus = r.status;
        throw err;
    }
    return data;
}

// ───────────────────────── API pubblica ─────────────────────────
/**
 * Avvia un pagamento sulla cassa VNE.
 * @param {number} importoCent  Importo in CENTESIMI (es. 590 per 5,90€)
 * @param {string} idPrenotazione  ID interno della prenotazione (loggato in UI)
 * @param {function} cb  Callback({status, importo, inserito, resto, idVNE, error})
 *                        status ∈ completed | partial | deleted | returned | error | timeout
 */
export async function avviaPagamento(importoCent, idPrenotazione, cb) {
    if (!state.cassaAuto.enabled) {
        cb({ status: 'error', error: 'Cassa automatica disabilitata' });
        return;
    }
    importoCent = Math.round(Number(importoCent) || 0);
    if (importoCent <= 0) {
        cb({ status: 'error', error: 'Importo non valido' });
        return;
    }

    const modal = openCassaModal(importoCent, idPrenotazione);
    let idVNE = null;
    let inserito = 0;
    let resto = 0;

    try {
        console.log(LOG, 'POST /paga', { importoCent, idPrenotazione });
        const res = await bridge('/paga', { method: 'POST', body: { importo: importoCent } });
        idVNE = res.id;
        modal.setIdVNE(idVNE);

        const t0 = Date.now();
        let lastStatus = 'pending';
        while (Date.now() - t0 < state.cassaAuto.maxPollingMs) {
            if (modal.aborted) {
                console.log(LOG, 'modale chiusa: abort polling');
                return;
            }
            await sleep(state.cassaAuto.pollingIntervalMs);
            try {
                const p = await bridge('/polling/' + encodeURIComponent(idVNE));
                inserito = (p.importo_inserito ?? p.inserito ?? 0);
                resto = (p.resto ?? 0);
                lastStatus = p.status || lastStatus;
                modal.update({ inserito, resto, status: lastStatus });
                if (['completed', 'partial', 'deleted', 'returned'].includes(lastStatus)) {
                    break;
                }
            } catch (pollErr) {
                console.warn(LOG, 'errore polling', pollErr.message);
            }
        }

        if (lastStatus === 'completed') {
            modal.showSuccess();
            await sleep(900);
            modal.close();
            cb({ status: 'completed', importo: importoCent / 100, inserito: inserito / 100, resto: resto / 100, idVNE });
            return;
        }
        if (lastStatus === 'partial') {
            modal.close();
            cb({ status: 'partial', importo: importoCent / 100, inserito: inserito / 100, resto: resto / 100, idVNE });
            return;
        }
        if (lastStatus === 'deleted' || lastStatus === 'returned') {
            modal.close();
            cb({ status: lastStatus, importo: importoCent / 100, inserito: inserito / 100, resto: resto / 100, idVNE });
            return;
        }
        // Esaurito timeout senza esito definitivo
        console.warn(LOG, 'timeout polling, lastStatus=', lastStatus);
        modal.showError('Timeout pagamento. Annullo e restituisco.');
        try { await annullaPagamento(idVNE, 2); } catch (_) { /* best effort */ }
        await sleep(1200);
        modal.close();
        cb({ status: 'timeout', importo: importoCent / 100, inserito: inserito / 100, resto: resto / 100, idVNE });

    } catch (e) {
        console.error(LOG, 'errore pagamento', e);
        modal.showError(e.message || 'Errore cassa');
        await sleep(1500);
        modal.close();
        cb({ status: 'error', error: e.message, idVNE });
    }
}

/**
 * Annulla un pagamento in corso.
 * @param {string} idVNE  ID transazione VNE
 * @param {number} modo   1 = accettazione parziale, 2 = restituisci tutto
 */
export async function annullaPagamento(idVNE, modo = 2) {
    if (!idVNE) throw new Error('idVNE mancante');
    return bridge('/annulla/' + encodeURIComponent(idVNE), {
        method: 'POST',
        body: { tipo_annullamento: modo },
    });
}

/** Stato cassa: ritorna oggetto pulito per il widget. */
export async function statoCassa() {
    const raw = await bridge('/stato');
    return {
        recyclerOk: raw.recyclerOk !== false,
        hopperOk: raw.hopperOk !== false,
        totalContent: (raw.totalContent || 0) / 100,
        alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
        raw,
    };
}

/** Rimborso completo. */
export async function rimborso(idVNE, cb) {
    try {
        await bridge('/rimborso/' + encodeURIComponent(idVNE), { method: 'POST', body: {} });
        const t0 = Date.now();
        while (Date.now() - t0 < state.cassaAuto.maxPollingMs) {
            await sleep(state.cassaAuto.pollingIntervalMs);
            const p = await bridge('/polling-rimborso/' + encodeURIComponent(idVNE));
            if (p.status === 'completed') { cb({ status: 'completed', idVNE }); return; }
            if (p.status === 'failed' || p.status === 'error') { cb({ status: 'error', idVNE, error: p.mess }); return; }
        }
        cb({ status: 'timeout', idVNE });
    } catch (e) {
        cb({ status: 'error', idVNE, error: e.message });
    }
}

/** Health del bridge. */
export async function healthBridge() {
    try {
        const r = await fetch(state.cassaAuto.bridgeUrl + '/health');
        return await r.json();
    } catch (e) {
        return { ok: false, vne_reachable: false, error: e.message };
    }
}

// ───────────────────────── UI modale ─────────────────────────
function openCassaModal(importoCent, idPrenotazione) {
    const importoEur = importoCent / 100;
    const overlay = document.createElement('div');
    overlay.id = 'cassaAutoOverlay';
    overlay.style.cssText = `
        position:fixed; inset:0; background:rgba(15,18,24,.78);
        display:flex; align-items:center; justify-content:center;
        z-index:9999; backdrop-filter:blur(4px);
        font-family: var(--f, 'Inter', system-ui, sans-serif);
    `;
    overlay.innerHTML = `
        <div id="cassaAutoBox" style="
            background:#fff; border-radius:18px; width:min(420px, 92vw);
            padding:28px 24px; box-shadow:0 20px 60px rgba(0,0,0,.35);
            border: 2px solid #C8A84E;">
            <div style="text-align:center; font:600 12px var(--mono, 'JetBrains Mono', monospace);
                color:#888; letter-spacing:1.5px; text-transform:uppercase">
                🏧 Cassa Automatica
            </div>
            <div id="cassaAutoImp" style="
                text-align:center; font:800 56px var(--f); color:#1a1a1a;
                margin: 14px 0 6px; letter-spacing:-1px">
                ${esc(fEur(importoEur))}
            </div>
            <div style="text-align:center; font:500 12px var(--f); color:#999; margin-bottom:18px">
                Prenotazione <span style="font-family:var(--mono)">${esc(idPrenotazione || '—')}</span>
            </div>
            <div id="cassaAutoBar" style="
                height:8px; background:#eee; border-radius:4px; overflow:hidden;
                margin-bottom:14px">
                <div id="cassaAutoFill" style="
                    height:100%; width:0%; background:#C8A84E;
                    transition:width .4s ease"></div>
            </div>
            <div id="cassaAutoStatus" style="
                text-align:center; font:500 13px var(--f); color:#444;
                margin-bottom:6px">In attesa di inserimento…</div>
            <div id="cassaAutoLine" style="
                text-align:center; font:500 12px var(--mono); color:#777;
                margin-bottom:18px">Inserito €0,00 · Resto €0,00</div>
            <div style="display:flex; flex-direction:column; gap:8px">
                <button id="cassaAutoAnn" style="
                    padding:12px; border:1px solid #d33; color:#d33;
                    background:#fff; border-radius:10px; cursor:pointer;
                    font:600 13px var(--f);">
                    Annulla con restituzione
                </button>
                <button id="cassaAutoParz" style="
                    padding:11px; border:1px solid #C8A84E; color:#8a7331;
                    background:#fff; border-radius:10px; cursor:pointer;
                    font:600 12px var(--f); display:none;">
                    Annulla con accettazione parziale
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const fill = overlay.querySelector('#cassaAutoFill');
    const statusEl = overlay.querySelector('#cassaAutoStatus');
    const lineEl = overlay.querySelector('#cassaAutoLine');
    const parzBtn = overlay.querySelector('#cassaAutoParz');
    const annBtn = overlay.querySelector('#cassaAutoAnn');

    const ctrl = {
        aborted: false,
        idVNE: null,
        setIdVNE(id) { ctrl.idVNE = id; },
        update({ inserito, resto, status }) {
            const pct = Math.min(100, Math.round((inserito / importoCent) * 100));
            fill.style.width = pct + '%';
            lineEl.textContent = `Inserito ${fEur(inserito / 100)} · Resto ${fEur(resto / 100)}`;
            const map = {
                pending: 'In attesa di inserimento…',
                in_progress: 'Pagamento in corso…',
                completed: '✓ Completato',
                partial: 'Accettazione parziale',
                deleted: 'Annullato (restituzione)',
                returned: 'Importo restituito',
            };
            statusEl.textContent = map[status] || status;
            if (inserito > 0 && status !== 'completed') {
                parzBtn.style.display = 'block';
            }
        },
        showSuccess() {
            statusEl.innerHTML = '<span style="color:#1d9b3f; font-weight:700">✓ Pagamento completato</span>';
            fill.style.background = '#1d9b3f';
            fill.style.width = '100%';
        },
        showError(msg) {
            statusEl.innerHTML = `<span style="color:#d33; font-weight:600">⚠️ ${esc(msg)}</span>`;
            fill.style.background = '#d33';
        },
        close() {
            ctrl.aborted = true;
            overlay.remove();
        },
    };

    annBtn.addEventListener('click', async () => {
        if (!ctrl.idVNE) { ctrl.close(); return; }
        annBtn.disabled = true;
        annBtn.textContent = 'Annullamento…';
        try { await annullaPagamento(ctrl.idVNE, 2); } catch (e) { console.warn(LOG, 'annulla fallito', e); }
    });
    parzBtn.addEventListener('click', async () => {
        if (!ctrl.idVNE) return;
        parzBtn.disabled = true;
        parzBtn.textContent = 'Acquisizione parziale…';
        try { await annullaPagamento(ctrl.idVNE, 1); } catch (e) { console.warn(LOG, 'annulla parziale fallito', e); }
    });

    return ctrl;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
