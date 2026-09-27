// ─── Card "Meteo → semaforo" nella pagina Cassa ───
// Fonte: callable meteoApi (functions/src/meteo.ts). Fase di taratura: solo visualizzazione,
// nessun blocco e nessun avviso ai dipendenti. Mostra domani/oggi + storico previsto vs reale vs incasso.
import { meteoCall } from '../firebase-config.js';
import { state } from '../state.js';
import { esc, fEur } from '../utils.js';

const EMOJI = { VERDE: '🟢', GIALLO: '🟡', ARANCIO: '🟠', ROSSO: '🔴' };
const LABEL = { VERDE: 'Normale', GIALLO: 'Ridotto leggero', ARANCIO: 'Ridotto', ROSSO: 'Chiuso' };
const GG = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const fmtD = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return `${GG[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`; };
const oggiISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
let aperto = false;

export function initMeteo() {
    renderMeteo();
    document.addEventListener('pageChanged', (e) => { if (e.detail?.pageId === 'page-cassa') renderMeteo(); });
}

export async function renderMeteo() {
    const el = document.getElementById('meteoCard'); if (!el) return;
    let giorni = [];
    try { ({ giorni } = await meteoCall({ action: 'ultimi', sedeId: state.sedeAttiva || 'lungomare', giorni: 14 })); }
    catch (e) { el.innerHTML = `<div style="font-size:11px;color:var(--tx3)">🌦️ Meteo non disponibile (${esc(e.message || '')})</div>`; return; }
    const oggi = oggiISO();
    const prossimo = giorni.find(g => g.data > oggi) || giorni.find(g => g.data === oggi);
    if (!prossimo && !giorni.length) { el.innerHTML = '<div style="font-size:11px;color:var(--tx3)">🌦️ Semaforo meteo: prima previsione stasera alle 22:30</div>'; return; }
    const head = prossimo ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:22px">${EMOJI[prossimo.livello] || '⚪'}</span>
        <div><div style="font:700 13px var(--f)">${prossimo.data > oggi ? 'Domani' : 'Oggi'} ${fmtD(prossimo.data)} · ${LABEL[prossimo.livello] || prossimo.livello}</div>
        <div style="font-size:11px;color:var(--tx2)">${esc(prossimo.motivo || '')} · prob. max ${prossimo.probMax ?? '–'}% · nuvole ${prossimo.nuvole ?? '–'}% · max ${prossimo.tmax ?? '–'}°${prossimo.orePioggia?.length ? ` · pioggia alle ${prossimo.orePioggia.map(h => String(h).padStart(2, '0')).join(' ')}` : ''}</div></div>
        <button class="btn" id="meteoToggle" style="margin-left:auto;font-size:10px;padding:3px 10px">${aperto ? 'Nascondi storico' : 'Storico taratura'}</button>
        <span style="font-size:10px;color:var(--tx3)">${prossimo.nFonti ? `mediana di ${prossimo.nFonti} modelli · ` : ''}in taratura · nessun blocco automatico</span></div>` : '';
    const passati = giorni.filter(g => g.data <= oggi);
    const rows = passati.map(g => {
        const r = g.reale;
        const ok = g.esito === 'ok' ? '✅' : g.esito === 'diverso' ? '❌' : '·';
        return `<tr><td style="font:500 11px var(--mono)">${fmtD(g.data)}</td>
            <td>${EMOJI[g.livelloSera || g.livello] || '·'} <span style="font-size:10px;color:var(--tx2)">${g.mm ?? '–'} mm / ${g.ore ?? '–'} h</span></td>
            <td>${g.livelloMattina ? EMOJI[g.livelloMattina] : '·'}</td>
            <td>${r ? `${EMOJI[r.livello] || '·'} <span style="font-size:10px;color:var(--tx2)">${r.mm} mm / ${r.ore} h</span>` : '·'}</td>
            <td style="font:600 11px var(--mono)">${g.incasso != null ? fEur(g.incasso) : '·'}</td>
            <td style="font:500 11px var(--mono)" title="${esc((g.presenze?.nomi || []).join(', '))}">${g.presenze ? `${g.presenze.dipendenti} <span style="color:var(--tx3)">(${fEur(g.presenze.costo)})</span>` : '·'}</td>
            <td style="font:500 11px var(--mono)">${g.incassoPerDipendente != null ? fEur(g.incassoPerDipendente) : '·'}</td><td>${g.storico ? '' : ok}</td></tr>`;
    }).join('');
    const storico = aperto ? `<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Giorno</th><th>Previsto (sera)</th><th>Mattina</th><th>Reale</th><th>Incasso</th><th>Dipendenti (costo)</th><th>€/dip.</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="empty">Ancora nessuna giornata verificata</td></tr>'}</tbody></table>
        <div style="font-size:10px;color:var(--tx3);margin-top:4px">Soglie: 🔴 ≥8 mm o ≥8 h · 🟠 ≥2 mm o ≥4 h · 🟡 pioggia debole, nuvole ≥70% o dopodomani ≥2 mm. Dati storici Lungomare: con 2–8 mm l'incasso scende al 28%, sopra 8 mm al 15%.</div></div>` : '';
    // Affidabilità per fonte: quante volte il livello previsto la sera coincide con il reale
    const acc = {};
    passati.forEach(g => Object.entries(g.fontiEsito || {}).forEach(([k, e]) => { acc[k] ||= { ok: 0, n: 0, err: 0, nome: g.fontiSera?.[k]?.nome || k }; acc[k].n++; if (e.livelloOk) acc[k].ok++; acc[k].err += Number(e.erroreMm) || 0; }));
    const affid = Object.values(acc).length && aperto ? `<div style="font-size:10px;color:var(--tx2);margin-top:6px">Affidabilità fonti (livello indovinato · errore medio mm): ${Object.values(acc).sort((a, b) => b.ok / b.n - a.ok / a.n).map(a => `<b>${esc(a.nome)}</b> ${a.ok}/${a.n} · ${(a.err / a.n).toFixed(1)}`).join(' &nbsp;·&nbsp; ')}</div>` : '';
    el.innerHTML = `<div class="sec" style="padding:12px 14px">${head}${storico}${affid}</div>`;
    document.getElementById('meteoToggle')?.addEventListener('click', () => { aperto = !aperto; renderMeteo(); });
}
