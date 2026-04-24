// ═══════════════════════════════════════════════════════════════════
// WIDGET DASHBOARD ADMIN — Stato Cassa Automatica
// Card che mostra reachability bridge/VNE, contenuto, alert.
// Auto-refresh 30s solo quando la pagina dashboard è visibile e l'utente
// è admin. Renderizzato dentro #page-dashboard sopra ai grafici.
// ═══════════════════════════════════════════════════════════════════
import { state } from '../state.js';
import { fEur, esc } from '../utils.js';
import { healthBridge, statoCassa } from './cassa-automatica.js';

const LOG = '[CASSA-AUTO]';
const REFRESH_MS = 30000;
let timer = null;
let lastRefresh = 0;

export function initCassaStato() {
    // Crea la card e la inserisce in cima a #page-dashboard se admin + abilitato
    document.addEventListener('pageChanged', (e) => {
        if (e.detail.pageId !== 'dashboard') {
            stopAutoRefresh();
            return;
        }
        if (state.currentUser?.role !== 'admin') return;
        if (!state.cassaAuto?.enabled) return;
        ensureCard();
        refresh();
        startAutoRefresh();
    });
}

function ensureCard() {
    if (document.getElementById('cassaStatoCard')) return;
    const dash = document.getElementById('page-dashboard');
    if (!dash) return;
    const card = document.createElement('div');
    card.id = 'cassaStatoCard';
    card.style.cssText = `
        background: var(--bg3, #fff); border:1px solid var(--brd, #e6e6e8);
        border-left: 4px solid #C8A84E; border-radius: var(--r, 12px);
        padding: 14px 16px; margin-bottom: 16px;
        font-family: var(--f, 'Inter', system-ui);`;
    card.innerHTML = renderSkeleton();
    // Inserisci subito sotto la pbar
    const pbar = dash.querySelector('.pbar');
    if (pbar) pbar.after(card); else dash.prepend(card);

    card.querySelector('#cassaStatoRefresh')?.addEventListener('click', refresh);
}

function renderSkeleton() {
    return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap">
            <div style="display:flex; align-items:center; gap:10px">
                <span id="cassaStatoDot" style="width:10px; height:10px; border-radius:50%; background:#bbb; display:inline-block"></span>
                <strong style="font:600 13px var(--f)">🏧 Stato Cassa Automatica</strong>
            </div>
            <div style="display:flex; align-items:center; gap:10px; font-size:11px; color:var(--tx2, #888)">
                <span id="cassaStatoUpd">—</span>
                <button id="cassaStatoRefresh" class="btn" style="font-size:11px; padding:4px 10px">↻ Aggiorna</button>
            </div>
        </div>
        <div id="cassaStatoBody" style="margin-top:10px; font-size:12px; color:var(--tx, #1a1a1a)">
            Caricamento…
        </div>
    `;
}

function startAutoRefresh() {
    stopAutoRefresh();
    timer = setInterval(() => {
        const dash = document.getElementById('page-dashboard');
        if (dash?.classList.contains('show')) refresh();
    }, REFRESH_MS);
}

function stopAutoRefresh() {
    if (timer) { clearInterval(timer); timer = null; }
}

async function refresh() {
    const card = document.getElementById('cassaStatoCard');
    if (!card) return;
    const dot = card.querySelector('#cassaStatoDot');
    const body = card.querySelector('#cassaStatoBody');
    const upd = card.querySelector('#cassaStatoUpd');

    body.innerHTML = '<span style="color:var(--tx2, #888)">Verifica in corso…</span>';

    let hp = null, st = null;
    try { hp = await healthBridge(); } catch (e) { console.warn(LOG, 'health err', e); }
    if (hp?.vne_reachable) {
        try { st = await statoCassa(); } catch (e) { console.warn(LOG, 'stato err', e); }
    }

    lastRefresh = Date.now();
    upd.textContent = 'Agg. ' + new Date(lastRefresh).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

    if (!hp?.ok) {
        dot.style.background = '#d33';
        body.innerHTML = `<span style="color:#d33; font-weight:600">⚠️ Bridge offline</span> — controllare PC Wash Hub e Cloudflare Tunnel.`;
        return;
    }
    if (!hp.vne_reachable) {
        dot.style.background = '#e69500';
        body.innerHTML = `<span style="color:#e69500; font-weight:600">Bridge OK, cassa VNE non raggiungibile</span> — controllare cavo LAN/cassa accesa.`;
        return;
    }
    if (!st) {
        dot.style.background = '#e69500';
        body.innerHTML = `<span style="color:#e69500">Stato cassa non disponibile</span> (errore comando 20)`;
        return;
    }

    dot.style.background = '#1d9b3f';
    const alerts = (st.alerts || []).map(a => {
        const sev = (a.severity || a.level || 'warn').toLowerCase();
        const color = sev === 'error' || sev === 'critical' ? '#d33' : '#e69500';
        const bg = sev === 'error' || sev === 'critical' ? '#fde7e7' : '#fdf3df';
        return `<span style="display:inline-block; padding:2px 8px; border-radius:10px; background:${bg}; color:${color}; font-size:11px; margin-right:6px; margin-bottom:4px">${esc(a.message || a.code || JSON.stringify(a))}</span>`;
    }).join('');

    body.innerHTML = `
        <div style="display:flex; gap:18px; flex-wrap:wrap; align-items:center">
            <div>
                <div style="font:500 11px var(--mono); color:var(--tx2, #888); text-transform:uppercase; letter-spacing:.5px">Contenuto attuale</div>
                <div style="font:700 18px var(--f); color:#1d9b3f">${esc(fEur(st.totalContent))}</div>
            </div>
            <div>
                <div style="font:500 11px var(--mono); color:var(--tx2, #888); text-transform:uppercase; letter-spacing:.5px">Recycler</div>
                <div style="font:600 13px var(--f); color:${st.recyclerOk ? '#1d9b3f' : '#d33'}">${st.recyclerOk ? 'OK' : 'Errore'}</div>
            </div>
            <div>
                <div style="font:500 11px var(--mono); color:var(--tx2, #888); text-transform:uppercase; letter-spacing:.5px">Hopper</div>
                <div style="font:600 13px var(--f); color:${st.hopperOk ? '#1d9b3f' : '#d33'}">${st.hopperOk ? 'OK' : 'Errore'}</div>
            </div>
        </div>
        <div style="margin-top:8px">${alerts || '<span style="color:var(--tx2, #888); font-size:11px">Nessun alert</span>'}</div>
    `;
}
