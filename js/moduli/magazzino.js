// ─── MAGAZZINO CONSUMABILI (06/11/2026) ───
// Shampoo, cere, profumi, panni… tutto ciò che si ordina. Il carico si fa dalla
// FOTO della fattura: la function magazzinoApi la fa leggere a Claude e torna
// una proposta (fornitore, righe, abbinamento al catalogo, variazione prezzo)
// che l'operatore controlla e conferma. Nessuna conta periodica: a ogni
// riordino chiediamo quanti PEZZI restano (2 fusti, non 40 L). Tra due ordini
// consumo = rimasti + comprati al primo − rimasti al secondo. Giacenza stimata
// = rimasti + comprati all'ultimo ordine − consumo × giorni passati.
// Dal consumo: copertura e ordini da fare.
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
let filtroCat = '', filtroForn = '', cerca = '';

export function initMagazzino() {
    document.addEventListener('pageChanged', e => { if (e.detail?.pageId === 'magazzino') carica(); });
    document.getElementById('magFotoBtn')?.addEventListener('click', () => document.getElementById('magFile')?.click());
    document.getElementById('magFile')?.addEventListener('change', e => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) leggiFattura(f); });
    document.getElementById('magRefreshBtn')?.addEventListener('click', carica);
    document.getElementById('magCat')?.addEventListener('change', e => { filtroCat = e.target.value; render(); });
    document.getElementById('magForn')?.addEventListener('change', e => { filtroForn = e.target.value; render(); });
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

// ─── CONSUMI (ordini + rimanenze, in pezzi) ───
// Ordini della sede per il prodotto, raggruppati per giorno: q = pezzi
// comprati, r = pezzi che restavano al riordino (null = non indicato → 0).
// Le rilevazioni ("quanti ne restano oggi", dalla verifica) sono eventi con
// q = 0: misurano il consumo come un riordino.
function ordini(p) {
    const perGiorno = {};
    (p.rilevazioni?.[state.sedeAttiva] || []).forEach(x => { perGiorno[x.dataISO + '~'] = { dataISO: x.dataISO, q: 0, r: Number(x.pezzi) || 0, ril: true }; });
    acquisti.forEach(a => (a.righe || []).forEach(r => {
        if (r.prodottoId !== p._id || (p.unita && r.unita && r.unita !== p.unita)) return;
        const o = perGiorno[a.dataISO] ||= { dataISO: a.dataISO, q: 0, r: null };
        o.q += Number(r.quantita) || 0;
        if (r.rimanenza != null) o.r = Math.max(o.r ?? 0, Number(r.rimanenza) || 0);
    }));
    // a parità di giorno la rilevazione viene dopo l'arrivo
    return Object.entries(perGiorno).filter(([, o]) => o.dataISO && (o.q > 0 || o.ril)).sort(([x], [y]) => x.localeCompare(y)).map(([, o]) => o);
}

// Ogni coppia di ordini consecutivi è una misura del consumo in quel periodo.
function consumo(ord) {
    const o = ord.slice(-ORDINI_STORICO);
    if (o.length < 2) return null;
    const periodi = o.slice(1).map((b, i) => {
        const a = o[i];
        return { dal: a.dataISO, al: b.dataISO, giorni: Math.round((new Date(b.dataISO) - new Date(a.dataISO)) / 864e5), usati: Math.max(0, (a.r ?? 0) + a.q - (b.r ?? 0)) };
    });
    const giorni = periodi.reduce((s, x) => s + x.giorni, 0);
    if (giorni < 3) return null;
    return { giorno: periodi.reduce((s, x) => s + x.usati, 0) / giorni, periodi };
}

function statoProdotto(p) {
    const ord = ordini(p);
    const ultimo = ord[ord.length - 1];
    const c = consumo(ord);
    const giorniDaUltimo = ultimo ? Math.max(0, (Date.now() - new Date(ultimo.dataISO)) / 864e5) : 0;
    // senza consumo noto la stima è quanto c'era dopo l'ultimo ordine
    const g = ultimo ? Math.max(0, (ultimo.r ?? 0) + ultimo.q - (c ? c.giorno * giorniDaUltimo : 0)) : 0;
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
    const selF = document.getElementById('magForn');
    if (selF) {
        const forn = [...new Set(prodotti.map(p => p.fornitoreNome).filter(Boolean))].sort();
        selF.innerHTML = '<option value="">Tutti i fornitori</option>' + forn.map(f => `<option value="${esc(f)}" ${f === filtroForn ? 'selected' : ''}>${esc(f)}</option>`).join('');
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

    renderVerifica();
    renderOrdini(stati);
    renderFornitori();

    const lista = prodotti.filter(p => (!filtroCat || p.categoria === filtroCat) && (!filtroForn || p.fornitoreNome === filtroForn) && (!cerca || `${p.nome} ${p.fornitoreNome}`.toLowerCase().includes(cerca)));
    const el = document.getElementById('magProdotti');
    if (el) el.innerHTML = !prodotti.length
        ? '<div class="empty">Nessun prodotto: carica la prima fattura con 📷 e il catalogo si crea da solo.</div>'
        : `<table><thead><tr><th>Prodotto</th><th>Fornitore</th><th style="text-align:right" title="Stimata: ultimo ordine meno il consumo dei giorni passati">Giacenza stimata</th><th style="text-align:right">Consumo</th><th style="text-align:right">Copertura</th><th style="text-align:right">Ultimo prezzo</th><th>Ultimo acquisto</th></tr></thead><tbody>${lista.map(p => {
            const s = stati.get(p._id);
            const ult = ultimaVariazione(p._id);
            return `<tr${s.daOrdinare ? ' style="background:var(--red1)"' : ''}>
                <td><b>${esc(p.nome)}</b><div style="font:400 10px var(--mono);color:var(--tx3)">${esc(p.categoria || '')}</div></td>
                <td style="font-size:12px">${esc(p.fornitoreNome || '')}</td>
                <td style="text-align:right;font:600 13px var(--mono)">${fmtQ(s.g)} ${esc(p.unita || '')}${p.formato ? `<div style="font:400 10px var(--mono);color:var(--tx3)">da ${esc(p.formato)}</div>` : ''}</td>
                <td style="text-align:right;font:400 12px var(--mono)">${s.c ? `<span title="${esc(s.c.periodi.map(x => `${dmy(x.dal)}→${dmy(x.al)}: ${fmtQ(x.usati)} ${p.unita || 'pz'} in ${x.giorni} gg`).join('\n'))}" style="cursor:help;border-bottom:1px dotted var(--tx3)">${fmtQ(s.c.giorno * 7)}/sett</span>` : '<span style="color:var(--tx3)" title="Dal secondo ordine di questo prodotto calcolo il consumo">in apprendimento</span>'}</td>
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

// ─── FORNITORI ───
// Una scheda per fornitore: prodotti, spesa ultimi 30 gg, ultimo acquisto. Clic = filtro.
function renderFornitori() {
    const el = document.getElementById('magFornitori');
    if (!el) return;
    const da30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const perF = {};
    acquisti.forEach(a => {
        const f = perF[a.fornitoreNome] ||= { nome: a.fornitoreNome, spesa30: 0, ultimo: '', n: 0 };
        if ((a.dataISO || '') >= da30) f.spesa30 += Number(a.imponibile) || 0;
        if ((a.dataISO || '') > f.ultimo) f.ultimo = a.dataISO;
        f.n++;
    });
    const lista = Object.values(perF).sort((x, y) => y.spesa30 - x.spesa30);
    el.innerHTML = lista.map(f => `<button class="btn mag-forn" data-f="${esc(f.nome)}" style="text-align:left;padding:8px 12px;${filtroForn === f.nome ? 'border-color:var(--acc);background:var(--bg3)' : ''}">
        <b style="font-size:12px">${esc(f.nome)}</b><div style="font:400 11px var(--mono);color:var(--tx2)">${prodotti.filter(p => p.fornitoreNome === f.nome).length} prodotti · ${f.n} fatture · ${fEur(f.spesa30)} in 30 gg · ultima ${dmy(f.ultimo)}</div></button>`).join('');
    el.querySelectorAll('.mag-forn').forEach(b => b.onclick = () => { filtroForn = filtroForn === b.dataset.f ? '' : b.dataset.f; render(); });
}

// ─── VERIFICA (carichi importati da FIC) ───
// Pezzi/confezione/formato letti dall'XML vanno confermati da chi ha la merce
// davanti; "restano oggi" è una rilevazione che misura il consumo.
function renderVerifica() {
    const el = document.getElementById('magVerifica');
    if (!el) return;
    const daVer = acquisti.filter(a => a.daVerificare).sort((x, y) => (x.dataISO || '').localeCompare(y.dataISO || ''));
    el.style.display = daVer.length ? '' : 'none';
    if (!daVer.length) return;
    const inp = 'background:var(--bg3);border:1px solid var(--brd);color:var(--tx);border-radius:6px;padding:5px 6px;font:400 12px var(--mono);width:100%';
    const prodIds = [...new Set(daVer.flatMap(a => (a.righe || []).filter(r => r.prodottoId).map(r => r.prodottoId)))];
    el.innerHTML = `<div style="font:600 11px var(--mono);color:var(--acc);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">🔎 Da verificare</div>
        <p style="font-size:12px;color:var(--tx2);margin:0 0 10px">Fatture importate da Fatture in Cloud. <b>1)</b> Controlla i <b>pezzi</b> di ogni riga (es. 2 taniche da 25 kg, non 50). <b>2)</b> Scrivi quanti pezzi di ogni prodotto <b>restano oggi</b> in magazzino (0 se finito).</p>
        ${daVer.map(a => `<div style="margin-bottom:10px"><b style="font-size:12px">${esc(a.fornitoreNome)}</b> <span style="font:400 11px var(--mono);color:var(--tx2)">n. ${esc(a.numero || '')} del ${dmy(a.dataISO)}</span>
            <table style="margin-top:4px"><thead><tr><th>Riga in fattura</th><th>Pezzi</th><th>Confezione</th><th>Formato</th><th>€ al pezzo</th></tr></thead><tbody>
            ${(a.righe || []).map((r, i) => r.isProdotto ? `<tr data-a="${a._id}" data-i="${i}" class="vr">
                <td style="font-size:11px">${esc(r.nomeProdotto || r.descrizione)}<div style="color:var(--tx3)">${esc(r.descrizione)}</div></td>
                <td style="width:70px"><input class="vr-q" type="number" step="1" min="0" value="${r.quantita}" style="${inp}"></td>
                <td style="width:90px"><input class="vr-u" value="${esc(r.unita || '')}" style="${inp}"></td>
                <td style="width:90px"><input class="vr-f" value="${esc(r.formato || '')}" style="${inp}"></td>
                <td style="font:400 12px var(--mono)" class="vr-p">${fEur(r.prezzoUnitario)}</td></tr>` : '').join('')}
            </tbody></table></div>`).join('')}
        <div style="font:600 12px var(--f);margin:12px 0 6px">Quanti pezzi restano oggi?</div>
        <table><tbody>${prodIds.map(id => { const p = prodotti.find(x => x._id === id); return p ? `<tr><td style="font-size:12px">${esc(p.nome)}</td><td style="width:110px"><input class="vr-r" data-id="${id}" type="number" step="0.5" min="0" style="${inp}"></td><td style="font-size:11px;color:var(--tx3)">${esc(p.unita || 'pz')}</td></tr>` : ''; }).join('')}</tbody></table>
        <button class="btn btn-primary" id="magVerSalva" style="width:100%;margin-top:12px">✓ Confermo</button>
        <p id="magVerEsito" style="font-size:12px;margin:8px 0 0;color:var(--tx3)"></p>`;
    el.querySelectorAll('tr.vr').forEach(tr => tr.querySelector('.vr-q').addEventListener('input', () => {
        const r = acquisti.find(a => a._id === tr.dataset.a).righe[tr.dataset.i];
        const q = Number(tr.querySelector('.vr-q').value);
        tr.querySelector('.vr-p').textContent = q > 0 && r.totaleRiga ? fEur(r.totaleRiga / q) : '—';
    }));
    el.querySelector('#magVerSalva').onclick = async () => {
        const vuoti = [...el.querySelectorAll('.vr-r')].filter(x => x.value === '');
        el.querySelectorAll('.vr-r').forEach(x => x.style.borderColor = '');
        if (vuoti.length) { vuoti.forEach(x => x.style.borderColor = 'var(--red)'); el.querySelector('#magVerEsito').textContent = 'Scrivi quanti pezzi restano per ogni prodotto (0 se finito).'; return; }
        const perAcq = {};
        el.querySelectorAll('tr.vr').forEach(tr => (perAcq[tr.dataset.a] ||= []).push({ i: Number(tr.dataset.i), quantita: Number(tr.querySelector('.vr-q').value) || 0, unita: tr.querySelector('.vr-u').value.trim() || 'pz', formato: tr.querySelector('.vr-f').value.trim() || null }));
        const btn = el.querySelector('#magVerSalva'); btn.disabled = true; btn.textContent = 'Salvataggio…';
        try {
            await call('verificaCarichi', { acquisti: Object.entries(perAcq).map(([id, righe]) => ({ id, righe })), rilevazioni: [...el.querySelectorAll('.vr-r')].map(x => ({ prodottoId: x.dataset.id, pezzi: Number(x.value) })) });
            carica();
        } catch (e) { btn.disabled = false; btn.textContent = '✓ Confermo'; el.querySelector('#magVerEsito').textContent = 'Errore: ' + (e.message || e); }
    };
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

// Stima della giacenza attuale, come suggerimento nel campo "Restavano"
function stimaTxt(prodottoId) {
    const p = prodotti.find(x => x._id === prodottoId);
    return p ? 'stima ' + fmtQ(statoProdotto(p).g) : '';
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
const dmy = iso => (iso || '').slice(5).split('-').reverse().join('/');

// ─── CARICO DA FOTO ───
async function comprimi(file) {
    if (/\.xml$/i.test(file.name) || /xml/.test(file.type)) return { base64: await b64(file), mediaType: 'text/xml' };
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
        ${p.emessaDaNoi ? '<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--red1);color:var(--red);font-size:13px">⛔ Questa fattura l\'abbiamo emessa noi: è una vendita, non un acquisto da un fornitore.</div>' : ''}
        ${p.giaCaricata ? '<div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--red1);color:var(--red);font-size:13px">⛔ Questo documento risulta già caricato.</div>' : ''}
        <div style="margin-top:10px;font-size:13px"><b>${esc(p.fornitore.ragioneSociale)}</b> ${p.fornitoreNuovo ? '<span class="badge b">nuovo fornitore</span>' : ''}
            <div style="font:400 11px var(--mono);color:var(--tx2)">P.IVA ${esc(p.fornitore.piva || '—')} · ${esc(p.tipoDocumento)} ${esc(p.numero || 's.n.')} del ${(p.data || '').split('-').reverse().join('/') || '—'} · imponibile ${p.imponibile != null ? fEur(p.imponibile) : '—'} · totale ${p.totale != null ? fEur(p.totale) : '—'}</div></div>
        ${(p.avvisi || []).length ? `<div style="margin-top:8px;font-size:12px;color:var(--amb)">⚠️ ${p.avvisi.map(esc).join('<br>⚠️ ')}</div>` : ''}
        ${!quadra ? `<div style="margin-top:8px;font-size:12px;color:var(--amb)">⚠️ La somma delle righe (${fEur(sommaRighe)}) non torna con l'imponibile: controlla quantità e prezzi.</div>` : ''}
        <div style="overflow-x:auto;margin-top:12px"><table><thead><tr><th>Carica</th><th>Riga in fattura</th><th>Prodotto a magazzino</th><th>Pezzi</th><th>Confezione</th><th>Formato</th><th>€ al pezzo</th><th>Prezzo</th><th title="Pezzi ancora in magazzino prima di questo arrivo">Restavano</th></tr></thead><tbody>
        ${p.righe.map((r, i) => `<tr data-i="${i}">
            <td><input type="checkbox" class="mr-ok" ${r.isProdotto ? 'checked' : ''}></td>
            <td style="font-size:11px;max-width:220px">${esc(r.descrizione)}${r.codice ? `<div style="color:var(--tx3)">cod. ${esc(r.codice)}</div>` : ''}</td>
            <td style="min-width:200px"><select class="mr-prod" style="${inp}">${opzProd(r.prodottoId)}</select><input class="mr-nome" value="${esc(r.nomeProdotto)}" style="${inp};margin-top:4px;${r.prodottoId ? 'display:none' : ''}" placeholder="Nome prodotto"></td>
            <td style="width:60px"><input class="mr-q" type="number" step="1" min="0" value="${r.quantita}" style="${inp}"></td>
            <td style="width:80px"><input class="mr-u" value="${esc(r.unita)}" style="${inp}"></td>
            <td style="width:80px"><input class="mr-f" value="${esc(r.formato || '')}" placeholder="20 L" style="${inp}"></td>
            <td style="width:90px"><input class="mr-p" type="number" step="any" value="${r.prezzoUnitario}" style="${inp}"></td>
            <td class="mr-var" style="white-space:nowrap">${badgeVar(r) || (r.prodottoId ? '<span style="font-size:11px;color:var(--tx3)">=</span>' : '')}</td>
            <td style="width:80px"><input class="mr-r" type="number" step="0.5" min="0" placeholder="${r.prodottoId ? stimaTxt(r.prodottoId) : ''}" style="${inp};${r.prodottoId && r.isProdotto ? '' : 'visibility:hidden'}"></td></tr>`).join('')}
        </tbody></table></div>
        <p style="font-size:12px;color:var(--tx2);margin:10px 0 0">📦 <b>Restavano</b>: per ogni prodotto già a magazzino scrivi quanti <b>pezzi</b> c'erano ancora prima di questo arrivo (0 se finito, 1.5 se un fusto e mezzo). Il numero in grigio è la mia stima.</p>
        <button class="btn btn-primary" id="magConferma" style="width:100%;margin-top:14px" ${p.giaCaricata || p.emessaDaNoi ? 'disabled' : ''}>✓ Carica in magazzino (${esc(state.sedeAttiva)})</button>
        <p id="magEsito" style="font-size:12px;margin:8px 0 0;color:var(--tx3)"></p>`);
    const chiudi = () => ov.remove();
    ov.querySelector('#magRevClose').onclick = chiudi;

    const aggiornaVar = tr => {
        const r = p.righe[tr.dataset.i];
        const prod = prodotti.find(x => x._id === tr.querySelector('.mr-prod').value);
        tr.querySelector('.mr-nome').style.display = prod ? 'none' : '';
        const rim = tr.querySelector('.mr-r');
        rim.style.visibility = prod && tr.querySelector('.mr-ok').checked ? '' : 'hidden';
        rim.placeholder = prod ? stimaTxt(prod._id) : '';
        const prezzo = Number(tr.querySelector('.mr-p').value);
        const lc = s => (s || '').trim().toLowerCase();
        const prec = prod && lc(prod.unita) === lc(tr.querySelector('.mr-u').value) && lc(prod.formato) === lc(tr.querySelector('.mr-f').value) ? Number(prod.ultimoPrezzo) : null;
        r.prezzoPrec = prec || null;
        r.variazionePct = prec ? Math.round((prezzo - prec) / prec * 10000) / 100 : null;
        tr.querySelector('.mr-var').innerHTML = badgeVar(r) || (prod ? '<span style="font-size:11px;color:var(--tx3)">=</span>' : '');
    };
    ov.querySelectorAll('tbody tr').forEach(tr => tr.querySelectorAll('.mr-ok,.mr-prod,.mr-p,.mr-u,.mr-f').forEach(x => x.addEventListener('change', () => aggiornaVar(tr))));

    ov.querySelector('#magConferma').onclick = async () => {
        const btn = ov.querySelector('#magConferma');
        const mancano = [...ov.querySelectorAll('tbody tr')].filter(tr => tr.querySelector('.mr-ok').checked && tr.querySelector('.mr-prod').value && tr.querySelector('.mr-r').value === '');
        ov.querySelectorAll('.mr-r').forEach(x => x.style.borderColor = '');
        if (mancano.length) {
            mancano.forEach(tr => tr.querySelector('.mr-r').style.borderColor = 'var(--red)');
            ov.querySelector('#magEsito').textContent = `Scrivi quanti pezzi restavano per ${mancano.length === 1 ? 'il prodotto evidenziato' : `i ${mancano.length} prodotti evidenziati`} (0 se finiti).`;
            return;
        }
        ov.querySelectorAll('tbody tr').forEach(tr => {
            const r = p.righe[tr.dataset.i];
            r.isProdotto = tr.querySelector('.mr-ok').checked;
            r.prodottoId = tr.querySelector('.mr-prod').value || null;
            r.nomeProdotto = tr.querySelector('.mr-nome').value.trim() || r.nomeProdotto;
            r.quantita = Number(tr.querySelector('.mr-q').value) || 0;
            r.unita = tr.querySelector('.mr-u').value.trim() || 'pz';
            r.formato = tr.querySelector('.mr-f').value.trim() || null;
            r.rimanenza = r.prodottoId && tr.querySelector('.mr-r').value !== '' ? Number(tr.querySelector('.mr-r').value) : null;
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
