import { db, fsCollection, fsGetDocs } from '../firebase-config.js';
import { query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { esc } from '../utils.js';

let smsData = [];

export function initMarketing() {
    const page = document.getElementById('page-marketing');
    if (!page) return;
    const refreshBtn = document.getElementById('btnRfMarketing');
    if (refreshBtn) refreshBtn.addEventListener('click', renderMarketing);
}

export async function renderMarketing() {
    const tb = document.getElementById('smsTb');
    const kpis = document.getElementById('mktKpis');
    if (kpis) kpis.innerHTML = '<div style="color:var(--tx3);font-size:12px">Caricamento…</div>';

    try {
        const snap = await fsGetDocs(query(
            fsCollection(db, 'smsLog'),
            orderBy('timestamp', 'desc'),
            limit(300)
        ));
        smsData = [];
        snap.forEach(d => smsData.push({ _id: d.id, ...d.data() }));
    } catch (e) {
        console.warn('smsLog non disponibile:', e.message);
        smsData = [];
    }

    const oggi = new Date().toISOString().slice(0, 10);
    const settimanaFa = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const meseFa = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

    const totale = smsData.length;
    const oggiCount = smsData.filter(s => s.data === oggi).length;
    const settCount = smsData.filter(s => (s.data || '') >= settimanaFa).length;
    const meseCount = smsData.filter(s => (s.data || '') >= meseFa).length;

    if (kpis) {
        kpis.innerHTML = `
            <div class="kpi-card"><div class="kv">${totale}</div><div class="kl">SMS totali</div></div>
            <div class="kpi-card"><div class="kv">${oggiCount}</div><div class="kl">Oggi</div></div>
            <div class="kpi-card"><div class="kv">${settCount}</div><div class="kl">Ultimi 7 gg</div></div>
            <div class="kpi-card"><div class="kv">${meseCount}</div><div class="kl">Ultimi 30 gg</div></div>
        `;
    }

    if (!tb) return;
    if (!smsData.length) {
        tb.innerHTML = '<tr><td colspan="4" class="empty">Nessun SMS inviato ancora — la Cloud Function gira ogni mattina alle 09:00</td></tr>';
        return;
    }

    let html = '';
    smsData.forEach(s => {
        const ts = s.timestamp?.toDate
            ? s.timestamp.toDate().toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
            : (s.data || '—');
        html += `<tr>
            <td style="font:400 11px var(--mono);white-space:nowrap">${esc(ts)}</td>
            <td>${esc(s.telefono || '—')}</td>
            <td><span class="badge a">${esc(s.tipo || 'reminder')}</span></td>
            <td style="font:400 11px var(--f);color:var(--tx3)">${esc(s.data || '—')}</td>
        </tr>`;
    });
    tb.innerHTML = html;
}
