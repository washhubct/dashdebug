// ─── MAGAZZINO CONSUMABILI (06/11/2026) ───
// Shampoo, cere, profumi, panni… tutto ciò che si ordina. Il carico si fa dalla
// FOTO della fattura: la function magazzinoApi la fa leggere a Claude e torna
// una proposta (fornitore, righe, abbinamento al catalogo, variazione prezzo)
// che l'operatore controlla e conferma. Nessuna conta fisica: i consumi si
// ricavano dagli ordini stessi. Se riordini un prodotto, quello comprato prima
// è (più o meno) finito: consumo = quantità degli ordini precedenti / giorni
// dal primo all'ultimo ordine. La giacenza è stimata: ultimo ordine − consumo
// × giorni passati. Dal consumo: copertura e ordini da fare.
// Dati: prodotti, acquisti, fornitori — scritti solo dalla function, qui solo lettura.
import { db, fsCollection, fsGetDocs, magazzinoCall } from '../firebase-config.js';
import { query, where } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { state } from '../state.js';
import { fEur, esc } from '../utils.js';

const COPERTURA_MIN = 14;   // giorni: sotto → da ordinare
const COPERTURA_ORDINE = 30; // giorni di scorta che un ordine deve coprire
const ORDINI_STORICO = 6;    // ultimi ordini usati per il consumo (segue la stagione)

let prodotti = [], acquisti = [];
const call = (action, data = {}) => magazzinoCall(action, { ...data, sedeId: state.sedeAttiva });
let filtroCat = '', cerca = '';

export function initMagazzino() {
    document.addEventListener('pageChanged', e => { if (e.detail?.pageId === 'magazzino') carica(); });
    document.getElementById('magFotoBtn')?.addEventListener('click', () => document.getElementById('magFile')?.click());
    document.getElementById('magFile')?.addEventListener('change', e => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) leggiFattura(f); });
    document.getElementById('magRefreshBtn')?.addEventListener('click', carica);
    document.getElementById('magCat')?.addEventListener('change', e => { filtroCat = e.target.value; render(); });
    document.getElementById('magCerca')?.addEventListener('input', e => { cerca = e.target.value.toLowerCase(); render(); });
}

async function carica() {
    const sede = state.sedeAttiva;
    try {
        const [p, a] = await Promise.all([
            fsGetDocs(fsCollection(db, 'prodotti')),
            fsGetDocs(query(fsCollection(db, 'acquisti'), where('sedeId', '==', sede))),
        ]);
        prodotti = p.docs.map(d => ({ _id: d.id, ...d.data() })).sort((x, y) => (x.nome || '').localeCompare(y.nome || ''));
        acquisti = a.docs.map(d => ({ _id: d.id, ...d.data() })).sort((x, y) => (y.dataISO || '').localeCompare(x.dataISO || ''));
    } catch (e) {
        console.warn('Magazzino non disponibile:', e.message);
        const el = document.getElementById('magProdotti');
        if (el) el.innerHTML = `<div class="empty">Magazzino non disponibile: ${esc(e.message)}</div>`;
        return;
    }
    render();
}

// ─── CONSUMI (dagli ordini) ───
// Ordini della sede per il prodotto, raggruppati per giorno, nella stessa unità.
function ordini(p) {
    const perGiorno = {};
    acquisti.forEach(a => (a.righe || []).forEach(r => {
        if (r.prodottoId !== p._id || (p.unita && r.unita && r.unita !== p.unita)) return;
        perGiorno[a.dataISO] = (perGiorno[a.dataISO] || 0) + (Number(r.quantita) || 0);
    }));
    return Object.entries(perGiorno).filter(([d, q]) => d && q > 0).sort(([x], [y]) => x.localeCompare(y)).map(([dataISO, q]) => ({ dataISO, q }));
}

// Il riordino dice che lo stock precedente è finito: tutto ciò che è stato
// comprato prima dell'ultimo ordine è stato consumato tra il primo e l'ultimo.
function consumo(ord) {
    const o = ord.slice(-ORDINI_STORICO);
    if (o.length < 2) return null;
    const giorni = (new Date(o[o.length - 1].dataISO) - new Date(o[0].dataISO)) / 864e5;
    if (giorni < 3) return null;
    const usato = o.slice(0, -1).reduce((s, x) => s + x.q, 0);
    return { giorno: usato / giorni, ordini: o.length };
}

function statoProdotto(p) {
    const ord = ordini(p);
    const ultimo = ord[ord.length - 1];
    const c = consumo(ord);
    const giorniDaUltimo = ultimo ? Math.max(0, (Date.now() - new Date(ultimo.dataISO)) / 864e5) : 0;
    // senza consumo noto la stima è l'ultimo ordine intero
    const g = ultimo ? Math.max(0, ultimo.q - (c ? c.giorno * giorniDaUltimo : 0)) : 0;
    const copertura = c ? g / c.giorno : null;
    const min = Number(p.scortaMin?.[state.sedeAttiva]) || 0;
    const daOrdinare = (copertura !== null && copertura < COPERTURA_MIN) || (min > 0 && g <= min);
    const qOrdine = c ? Math.max(1, Math.ceil(c.giorno * COPERTURA_ORDINE - g)) : (daOrdinare ? Math.max(1, Math.ceil(min * 2 - g)) : 0);
    return { g, c, copertura, daOrdinare, qOrdine };
}

// ─── RENDER ───
function render() {
    const sel = document.getElementById('magCat');
    if (sel && sel.options.length <= 1) {
        const cats = [...new Set(prodotti.map(p => p.categoria).filter(Boolean))].sort();
        sel.innerHTML = '<option value="">Tutte le categorie</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    }
    const stati = new Map(prodotti.map(p => [p._id, statoProdotto(p)]));
    const ym = new Date().toISOString().slice(0, 7);
    const speseMese = acquisti.filter(a => (a.dataISO || '').startsWith(ym)).reduce((s, a) => s + (Number(a.imponibile) || (a.righe || []).reduce((t, r) => t + (Number(r.totaleRiga) || 0), 0)), 0);
    const aumenti = acquisti.slice(0, 20).flatMap(a => (a.righe || []).filter(r => r.variazionePct > 0));
    const kpi = document.getElementById('magKpis');
    if (kpi) kpi.innerHTML = `
        <div class="kpi"><div class="kpi-label">Prodotti</div><div class="kpi-val">${prodotti.length}</div></div>
        <div class="kpi ${[...stati.values()].some(s => s.daOrdinare) ? 'r' : 'g'}"><div class="kpi-label">Da ordinare</div><div class="kpi-val">${[...stati.values()].filter(s => s.daOrdinare).length}</div></div>
        <div class="kpi"><div class="kpi-label">Acquisti del mese</div><div class="kpi-val">${fEur(speseMese)}</div></div>
        <div class="kpi ${aumenti.length ? 'r' : ''}"><div class="kpi-label">Rincari recenti</div><div class="kpi-val">${aumenti.length}</div></div>`;

    renderOrdini(stati);

    const lista = prodotti.filter(p => (!filtroCat || p.categoria === filtroCat) && (!cerca || `${p.nome} ${p.fornitoreNome}`.toLowerCase().includes(cerca)));
    const el = document.getElementById('magProdotti');
    if (el) el.innerHTML = !prodotti.length
        ? '<div class="empty">Nessun prodotto: carica la prima fattura con 📷 e il catalogo si crea da solo.</div>'
        : `<table><thead><tr><th>Prodotto</th><th>Fornitore</th><th style="text-align:right" title="Stimata: ultimo ordine meno il consumo dei giorni passati">Giacenza stimata</th><th style="text-align:right">Consumo</th><th style="text-align:right">Copertura</th><th style="text-align:right">Ultimo prezzo</th><th>Ultimo acquisto</th></tr></thead><tbody>${lista.map(p => {
            const s = stati.get(p._id);
            const ult = ultimaVariazione(p._id);
            return `<tr${s.daOrdinare ? ' style="background:var(--red1)"' : ''}>
                <td><b>${esc(p.nome)}</b><div style="font:400 10px var(--mono);color:var(--tx3)">${esc(p.categoria || '')}</div></td>
                <td style="font-size:12px">${esc(p.fornitoreNome || '')}</td>
                <td style="text-align:right;font:600 13px var(--mono)">${fmtQ(s.g)} ${esc(p.unita || '')}</td>
                <td style="text-align:right;font:400 12px var(--mono)">${s.c ? `${fmtQ(s.c.giorno * 7)}/sett` : '<span style="color:var(--tx3)" title="Dal secondo ordine di questo prodotto calcolo il consumo">in apprendimento</span>'}</td>
                <td style="text-align:right;font:600 12px var(--mono);color:${s.daOrdinare ? 'var(--red)' : 'var(--tx)'}">${s.copertura !== null ? Math.floor(s.copertura) + ' gg' : '—'}</td>
                <td style="text-align:right;font:400 12px var(--mono)">${p.ultimoPrezzo != null ? fEur(p.ultimoPrezzo) : '—'} ${badgeVar(ult)}</td>
                <td style="font:400 11px var(--mono);color:var(--tx2)">${p.ultimoAcquistoISO ? p.ultimoAcquistoISO.split('-').reverse().join('/') : '—'}</td></tr>`;
        }).join('')}</tbody></table>`;

    const ea = document.getElementById('magAcquisti');
    if (ea) ea.innerHTML = !acquisti.length ? '<div class="empty">Nessun acquisto caricato per questa sede.</div>'
        : acquisti.slice(0, 15).map(a => {
            const rinc = (a.righe || []).filter(r => r.variazionePct);
            return `<div style="padding:10px 12px;border:1px solid var(--brd);border-radius:var(--r2);margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(a.fornitoreNome)}</b><span style="font:600 13px var(--mono)">${a.totale != null ? fEur(a.totale) : ''}</span></div>
                <div style="font:400 11px var(--mono);color:var(--tx2)">${esc(a.tipoDocumento || 'fattura')} ${esc(a.numero || '')} del ${(a.dataISO || '').split('-').reverse().join('/')} · ${(a.righe || []).filter(r => r.isProdotto).length} prodotti</div>
                ${rinc.length ? `<div style="margin-top:6px;font-size:12px">${rinc.map(r => `${esc(r.nomeProdotto || r.descrizione)} ${badgeVar(r)}`).join(' · ')}</div>` : ''}</div>`;
        }).join('');
}

function renderOrdini(stati) {
    const el = document.getElementById('magOrdini');
    if (!el) return;
    const daOrd = prodotti.filter(p => stati.get(p._id).daOrdinare);
    if (!daOrd.length) {
        const imparati = prodotti.filter(p => stati.get(p._id).c).length;
        el.innerHTML = `<div style="font-size:12px;color:var(--tx2)">${imparati
            ? '✓ Nessun ordine da fare: tutte le scorte coprono almeno ' + COPERTURA_MIN + ' giorni.'
            : '🧠 Sto imparando i consumi dagli ordini: dal secondo ordine di un prodotto calcolo quanto ne usate, quanto ne resta e quando riordinare.'}</div>`;
        return;
    }
    const perForn = {};
    daOrd.forEach(p => (perForn[p.fornitoreNome || 'Senza fornitore'] ||= []).push(p));
    el.innerHTML = Object.entries(perForn).map(([f, ps]) => `<div style="margin-bottom:10px"><b>🛒 ${esc(f)}</b><ul style="margin:4px 0 0 18px;font-size:13px">${ps.map(p => {
        const s = stati.get(p._id);
        return `<li>${esc(p.nome)}: ordina <b>${fmtQ(s.qOrdine)} ${esc(p.unita || '')}</b> <span style="color:var(--tx3)">(hai ${fmtQ(s.g)}${s.copertura !== null ? `, ${Math.floor(s.copertura)} gg` : ''})</span></li>`;
    }).join('')}</ul></div>`).join('');
}

function ultimaVariazione(prodottoId) {
    for (const a of acquisti) { const r = (a.righe || []).find(r => r.prodottoId === prodottoId); if (r) return r; }
    return null;
}
function badgeVar(r) {
    const v = r?.variazionePct;
    if (!v) return '';
    return `<span class="badge ${v > 0 ? 'r' : 'g'}" title="Prima ${fEur(r.prezzoPrec)}">${v > 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
}
const fmtQ = n => (Math.round(n * 10) / 10).toLocaleString('it-IT');

// ─── CARICO DA FOTO ───
async function comprimi(file) {
    if (file.type === 'application/pdf') {
        if (file.size > 8e6) throw new Error('PDF troppo grande (max 8 MB)');
        return { base64: await b64(file), mediaType: 'application/pdf' };
    }
    const img = await createImageBitmap(file).catch(() => { throw new Error(`Formato non supportato: ${file.name}`); });
    const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return { base64: await b64(blob), mediaType: 'image/jpeg' };
}
const b64 = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(blob); });

function overlayBase(html) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10002;display:flex;align-items:flex-start;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);overflow-y:auto';
    ov.innerHTML = `<div style="background:var(--bg2);border-radius:var(--r);padding:20px;max-width:920px;width:100%;box-shadow:var(--shadow-xl);margin-top:10px">${html}</div>`;
    document.body.appendChild(ov);
    return ov;
}

async function leggiFattura(files) {
    const ov = overlayBase(`<h3 style="margin:0 0 8px">📷 Lettura fattura…</h3><p style="font-size:13px;color:var(--tx2);margin:0">Sto leggendo ${files.length > 1 ? files.length + ' pagine' : 'il documento'}: di solito 20-40 secondi.</p>`);
    try {
        const payload = await Promise.all(files.map(comprimi));
        const { proposta } = await call('leggiFattura', { files: payload });
        ov.remove();
        revisione(proposta);
    } catch (e) {
        ov.firstElementChild.innerHTML = `<h3 style="margin:0 0 8px">⚠️ Lettura non riuscita</h3><p style="font-size:13px">${esc(e.message || e)}</p><button class="btn" id="magErrOk">Chiudi</button>`;
        ov.querySelector('#magErrOk').onclick = () => ov.remove();
    }
}

function revisione(p) {
    const opzProd = sel => `<option value="">➕ Nuovo prodotto</option>` + prodotti.map(x => `<option value="${x._id}" ${x._id === sel ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');
    const sommaRighe = p.righe.reduce((s, r) => s + (Number(r.totaleRiga) || r.quantita * r.prezzoUnitario || 0), 0);
    const quadra = p.imponibile == null || Math.abs(sommaRighe - p.imponibile) < 0.05 * Math.max(1, p.imponibile);
    const inp = 'background:var(--bg3);border:1px solid var(--brd);color:var(--tx);border-radius:6px;padding:5px 6px;font:400 12px var(--mono);width:100%';
    const ov = overlayBase(`
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">Controlla e conferma</h3><button class="btn" id="magRevClose">✕</button></div>
        ${p.giaCaricata ? '<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--red1);color:var(--red);font-size:13px">⛔ Questo documento risulta già caricato.</div>' : ''}
        <div style="margin-top:10px;font-size:13px"><b>${esc(p.fornitore.ragioneSociale)}</b> ${p.fornitoreNuovo ? '<span class="badge b">nuovo fornitore</span>' : ''}
            <div style="font:400 11px var(--mono);color:var(--tx2)">P.IVA ${esc(p.fornitore.piva || '—')} · ${esc(p.tipoDocumento)} ${esc(p.numero || 's.n.')} del ${(p.data || '').split('-').reverse().join('/') || '—'} · imponibile ${p.imponibile != null ? fEur(p.imponibile) : '—'} · totale ${p.totale != null ? fEur(p.totale) : '—'}</div></div>
        ${(p.avvisi || []).length ? `<div style="margin-top:8px;font-size:12px;color:var(--amb)">⚠️ ${p.avvisi.map(esc).join('<br>⚠️ ')}</div>` : ''}
        ${!quadra ? `<div style="margin-top:8px;font-size:12px;color:var(--amb)">⚠️ La somma delle righe (${fEur(sommaRighe)}) non torna con l'imponibile: controlla quantità e prezzi.</div>` : ''}
        <div style="overflow-x:auto;margin-top:12px"><table><thead><tr><th>Carica</th><th>Riga in fattura</th><th>Prodotto a magazzino</th><th>Q.tà</th><th>Unità</th><th>€ unit.</th><th>Prezzo</th></tr></thead><tbody>
        ${p.righe.map((r, i) => `<tr data-i="${i}">
            <td><input type="checkbox" class="mr-ok" ${r.isProdotto ? 'checked' : ''}></td>
            <td style="font-size:11px;max-width:220px">${esc(r.descrizione)}${r.codice ? `<div style="color:var(--tx3)">cod. ${esc(r.codice)}</div>` : ''}</td>
            <td style="min-width:200px"><select class="mr-prod" style="${inp}">${opzProd(r.prodottoId)}</select><input class="mr-nome" value="${esc(r.nomeProdotto)}" style="${inp};margin-top:4px;${r.prodottoId ? 'display:none' : ''}" placeholder="Nome prodotto"></td>
            <td style="width:70px"><input class="mr-q" type="number" step="any" value="${r.quantita}" style="${inp}"></td>
            <td style="width:70px"><input class="mr-u" value="${esc(r.unita)}" style="${inp}"></td>
            <td style="width:90px"><input class="mr-p" type="number" step="any" value="${r.prezzoUnitario}" style="${inp}"></td>
            <td class="mr-var" style="white-space:nowrap">${badgeVar(r) || (r.prodottoId ? '<span style="font-size:11px;color:var(--tx3)">=</span>' : '')}</td></tr>`).join('')}
        </tbody></table></div>
        <button class="btn btn-primary" id="magConferma" style="width:100%;margin-top:14px" ${p.giaCaricata ? 'disabled' : ''}>✓ Carica in magazzino (${esc(state.sedeAttiva)})</button>
        <p id="magEsito" style="font-size:12px;margin:8px 0 0;color:var(--tx3)"></p>`);
    const chiudi = () => ov.remove();
    ov.querySelector('#magRevClose').onclick = chiudi;

    const aggiornaVar = tr => {
        const r = p.righe[tr.dataset.i];
        const prod = prodotti.find(x => x._id === tr.querySelector('.mr-prod').value);
        tr.querySelector('.mr-nome').style.display = prod ? 'none' : '';
        const prezzo = Number(tr.querySelector('.mr-p').value);
        const prec = prod && (prod.unita || '').toLowerCase() === tr.querySelector('.mr-u').value.trim().toLowerCase() ? Number(prod.ultimoPrezzo) : null;
        r.prezzoPrec = prec || null;
        r.variazionePct = prec ? Math.round((prezzo - prec) / prec * 10000) / 100 : null;
        tr.querySelector('.mr-var').innerHTML = badgeVar(r) || (prod ? '<span style="font-size:11px;color:var(--tx3)">=</span>' : '');
    };
    ov.querySelectorAll('tbody tr').forEach(tr => tr.querySelectorAll('.mr-prod,.mr-p,.mr-u').forEach(x => x.addEventListener('change', () => aggiornaVar(tr))));

    ov.querySelector('#magConferma').onclick = async () => {
        const btn = ov.querySelector('#magConferma');
        ov.querySelectorAll('tbody tr').forEach(tr => {
            const r = p.righe[tr.dataset.i];
            r.isProdotto = tr.querySelector('.mr-ok').checked;
            r.prodottoId = tr.querySelector('.mr-prod').value || null;
            r.nomeProdotto = tr.querySelector('.mr-nome').value.trim() || r.nomeProdotto;
            r.quantita = Number(tr.querySelector('.mr-q').value) || 0;
            r.unita = tr.querySelector('.mr-u').value.trim() || 'pz';
            r.prezzoUnitario = Number(tr.querySelector('.mr-p').value) || 0;
        });
        btn.disabled = true; btn.textContent = 'Salvataggio…';
        try {
            await call('salvaCarico', { proposta: p });
            chiudi();
            carica();
        } catch (e) {
            btn.disabled = false; btn.textContent = '✓ Carica in magazzino';
            ov.querySelector('#magEsito').textContent = 'Errore: ' + (e.message || e);
        }
    };
}
