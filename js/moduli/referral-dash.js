import { db, fsCollection, fsGetDocs } from '../firebase-config.js';
import { esc } from '../utils.js';

let referralData = [];

export function initReferralDash() {
    const page = document.getElementById('page-referral');
    if (!page) return;
    const refreshBtn = document.getElementById('btnRfReferral');
    if (refreshBtn) refreshBtn.addEventListener('click', renderReferralDash);
}

export async function renderReferralDash() {
    const kpis = document.getElementById('refKpis');
    const tb = document.getElementById('refTb');
    if (kpis) kpis.innerHTML = '<div style="color:var(--tx3);font-size:12px">Caricamento…</div>';

    try {
        const snap = await fsGetDocs(fsCollection(db, 'referral'));
        referralData = [];
        snap.forEach(d => referralData.push({ _id: d.id, ...d.data() }));
    } catch (e) {
        console.warn('referral non disponibile:', e.message);
        referralData = [];
    }

    const totCodici = referralData.length;
    const totReferral = referralData.reduce((s, r) => s + (r.totale || 0), 0);
    const totInAttesa = referralData.reduce((s, r) => s + (r.inAttesa || 0), 0);
    const totConfermati = referralData.reduce((s, r) => s + (r.confermati || 0), 0);

    if (kpis) {
        kpis.innerHTML = `
            <div class="kpi-card"><div class="kv">${totCodici}</div><div class="kl">Codici attivi</div></div>
            <div class="kpi-card"><div class="kv">${totReferral}</div><div class="kl">Referral totali</div></div>
            <div class="kpi-card"><div class="kv">${totConfermati}</div><div class="kl">Confermati</div></div>
            <div class="kpi-card"><div class="kv">${totInAttesa}</div><div class="kl">In attesa conferma</div></div>
        `;
    }

    if (!tb) return;
    if (!referralData.length) {
        tb.innerHTML = '<tr><td colspan="5" class="empty">Nessun referral registrato ancora — viene creato quando un cliente inserisce un codice amico prenotando su wash-hub.it</td></tr>';
        return;
    }

    const sorted = [...referralData].sort((a, b) => (b.totale || 0) - (a.totale || 0));
    let html = '';
    sorted.forEach(r => {
        html += `<tr>
            <td><code style="font:700 12px var(--mono);color:var(--gold)">${esc(r._id)}</code></td>
            <td>${esc(r.telefono || '—')}</td>
            <td><strong>${r.totale || 0}</strong></td>
            <td style="color:var(--grn)">${r.confermati || 0}</td>
            <td style="color:var(--amb)">${r.inAttesa || 0}</td>
        </tr>`;
    });
    tb.innerHTML = html;
}
