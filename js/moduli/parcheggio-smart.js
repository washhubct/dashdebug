// ═══════════════════════════════════════════════════════════════
// PARCHEGGIO SMART — codici di accesso a tempo per il cancello
// (terminali Hikvision DS-K1T805MX, entrata + uscita)
//
// Flusso:
//  - Sito wash-hub.it → SumUp → Cloud Function `parcheggioSmart` crea il doc
//    in `codiciParcheggio` (stato 'attivo', sync pending) + riga `giornalieri`.
//  - Banco (questa pagina) → richiediPagamento (cassa VNE / POS) → stesso doc.
//  - Il Pi al Wash Hub (cancello-sync) legge i doc con sync pending, crea
//    l'utente temporaneo sui due terminali via ISAPI e aggiorna `sync`,
//    poi registra gli eventi di passaggio in `eventi[]`.
//
// Tariffa = listino parcheggio a ore del gestionale (giornalieri.js):
//   ≤6h: €2/h max €8 · ≤24h: €8 + €2/h oltre le 6, max €15. Minimo 2h.
// ═══════════════════════════════════════════════════════════════
import { db, fsCollection, fsAddDoc, fsGetDocs, fsUpdateDoc, fsDoc, fsGetDoc, fsSetDoc } from '../firebase-config.js';
import { query, where } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { state } from '../state.js';
import { fEur, esc, fmtDI, formatPhoneForWA } from '../utils.js';
import { isAdmin } from './auth.js';
import { richiediPagamento } from './cassa-automatica.js';
import { logDelete } from './log.js';
import { renderGiornalieri } from './giornalieri.js';

const COLL = 'codiciParcheggio';
const SEDE = 'lungomare';   // il cancello con i tastierini esiste solo al Lungomare
const CONFIG_DOC = 'parcheggioSmart';

let codici = [];          // doc della sede attiva
let tab = 'attivi';       // attivi | oggi | tutti
let config = { attivo: true, minOre: 2, maxOre: 24 };

// ── Tariffa (identica a calcPrezzoGiornaliero per durate intere) ──
export function prezzoParcheggioOre(ore) {
    ore = Math.max(0, Math.ceil(Number(ore) || 0));
    if (ore <= 0) return 0;
    if (ore <= 6) return Math.min(ore * 2, 8);
    if (ore <= 24) return Math.min(8 + (ore - 6) * 2, 15);
    const extra = ore - 24;
    return 15 + Math.floor(extra / 24) * 12 + (extra % 24) * 2;
}

// ── Helpers data/ora ──
const pad = n => String(n).padStart(2, '0');
const isoLocal = d => `${fmtDI(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;   // YYYY-MM-DDTHH:mm (ora locale)
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtIt = ms => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hhmm(d)}`; };

function generaCodice() {
    const usati = new Set(codici.filter(c => c.stato === 'attivo').map(c => c.codice));
    for (let i = 0; i < 50; i++) {
        const c = String(100000 + Math.floor(Math.random() * 900000));
        if (!usati.has(c) && !/(\d)\1{3}/.test(c)) return c;   // niente 4 cifre uguali di fila
    }
    return String(100000 + Math.floor(Math.random() * 900000));
}

// Stato mostrato (il campo `stato` resta la verità: attivo/revocato/in_pagamento/scaduto)
function statoUI(c) {
    const now = Date.now();
    if (c.stato === 'revocato') return ['r', 'REVOCATO'];
    if (c.stato === 'in_pagamento') return ['a', 'IN PAGAMENTO'];
    if (c.stato === 'scaduto' || now > c.fineTs) return ['', 'SCADUTO'];
    if (now < c.inizioTs) return ['b', 'PROGRAMMATO'];
    return ['g', 'IN CORSO'];
}

function syncBadge(c, k) {
    const s = c.sync?.[k] || 'pending';
    const cls = s === 'ok' ? 'g' : s === 'errore' ? 'r' : 'a';
    const ico = s === 'ok' ? '✓' : s === 'errore' ? '✕' : '⏳';
    const title = s === 'errore' ? (c.syncErrore || 'errore sync') : s === 'ok' ? 'caricato sul terminale' : 'in attesa del Pi';
    return `<span class="badge ${cls}" title="${esc(title)}" style="padding:2px 7px">${ico} ${k.toUpperCase()}</span>`;
}

export function testoWhatsApp(c) {
    return `Ciao! Il tuo codice parcheggio WASH HUB è *${c.codice}*.\n` +
        `Valido dal ${fmtIt(c.inizioTs)} alle ${fmtIt(c.fineTs)} (${c.ore}h).\n` +
        `Digita il codice sul tastierino all'ingresso e all'uscita.\n` +
        `Via Anfuso 35, Catania. Buona sosta!`;
}

// ── Init ──
export function initParcheggioSmart() {
    const page = document.getElementById('page-parchsmart');
    if (!page) return;

    page.querySelectorAll('.ps-tab').forEach(b => b.addEventListener('click', () => {
        tab = b.dataset.tab;
        page.querySelectorAll('.ps-tab').forEach(x => x.classList.toggle('on', x === b));
        renderTabella();
    }));

    const inizioSel = document.getElementById('psInizioMode');
    inizioSel?.addEventListener('change', () => {
        document.getElementById('psInizio').style.display = inizioSel.value === 'custom' ? '' : 'none';
        aggiornaPreview();
    });
    ['psOre', 'psInizio'].forEach(id => document.getElementById(id)?.addEventListener('input', aggiornaPreview));
    document.getElementById('psVendi')?.addEventListener('click', vendiAlBanco);
    document.getElementById('psRefresh')?.addEventListener('click', renderParcheggioSmart);
    document.getElementById('psCfgSave')?.addEventListener('click', salvaConfig);

    document.getElementById('psTb')?.addEventListener('click', e => {
        const b = e.target.closest('button[data-act]'); if (!b) return;
        const c = codici.find(x => x._id === b.dataset.id); if (!c) return;
        if (b.dataset.act === 'wa') apriWhatsApp(c);
        if (b.dataset.act === 'copy') navigator.clipboard?.writeText(c.codice).then(() => toast(`Codice ${c.codice} copiato`));
        if (b.dataset.act === 'revoca') revoca(c);
        if (b.dataset.act === 'resync') resync(c);
    });
}

async function caricaConfig() {
    try {
        const snap = await fsGetDoc(fsDoc(db, 'config', CONFIG_DOC));
        if (snap.exists()) config = { ...config, ...snap.data() };
    } catch (e) { console.warn('config parcheggioSmart:', e.message); }
    const on = document.getElementById('psCfgAttivo'); if (on) on.checked = config.attivo !== false;
    const mn = document.getElementById('psCfgMin'); if (mn) mn.value = config.minOre ?? 2;
    const mx = document.getElementById('psCfgMax'); if (mx) mx.value = config.maxOre ?? 24;
    const ore = document.getElementById('psOre'); if (ore) { ore.min = config.minOre ?? 2; ore.max = config.maxOre ?? 24; if (!ore.value) ore.value = config.minOre ?? 2; }
}

async function salvaConfig() {
    if (!isAdmin()) return;
    const nuovo = {
        attivo: document.getElementById('psCfgAttivo').checked,
        minOre: Math.max(1, parseInt(document.getElementById('psCfgMin').value) || 2),
        maxOre: Math.min(72, parseInt(document.getElementById('psCfgMax').value) || 24),
        aggiornato: Date.now(),
    };
    try {
        await fsSetDoc(fsDoc(db, 'config', CONFIG_DOC), nuovo, { merge: true });
        config = { ...config, ...nuovo };
        toast('Configurazione salvata');
    } catch (e) { alert('Errore salvataggio config: ' + e.message); }
}

async function caricaCodici() {
    codici = [];
    try {
        const snap = await fsGetDocs(query(fsCollection(db, COLL), where('sedeId', '==', SEDE)));
        snap.forEach(d => codici.push({ _id: d.id, ...d.data() }));
        codici.sort((a, b) => (b.creatoTs || 0) - (a.creatoTs || 0));
    } catch (e) { console.warn('codiciParcheggio non disponibili:', e.message); }
}

export async function renderParcheggioSmart() {
    await Promise.all([caricaConfig(), caricaCodici()]);
    document.getElementById('psCfgPanel')?.classList.toggle('show', isAdmin());
    aggiornaPreview();
    renderKpi();
    renderTabella();
}

function renderKpi() {
    const now = Date.now(), oggi = fmtDI(new Date());
    const inCorso = codici.filter(c => c.stato === 'attivo' && c.inizioTs <= now && c.fineTs >= now).length;
    const vOggi = codici.filter(c => c.dataISO === oggi && c.stato !== 'in_pagamento');
    const incOggi = vOggi.reduce((s, c) => s + (Number(c.prezzo) || 0), 0);
    const pend = codici.filter(c => c.stato === 'attivo' && c.fineTs >= now && (c.sync?.est !== 'ok' || c.sync?.int !== 'ok')).length;
    const err = codici.filter(c => c.sync?.est === 'errore' || c.sync?.int === 'errore').length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('psKpiCorso', inCorso);
    set('psKpiOggi', vOggi.length);
    set('psKpiIncasso', fEur(incOggi));
    set('psKpiSync', err ? `${err} errori` : pend ? `${pend} in attesa` : 'OK');
    const k = document.getElementById('psKpiSyncBox'); if (k) k.style.borderColor = err ? 'var(--red)' : pend ? 'var(--amb)' : 'var(--grn)';
}

function renderTabella() {
    const tb = document.getElementById('psTb'); if (!tb) return;
    const now = Date.now(), oggi = fmtDI(new Date()), cut30 = now - 30 * 864e5;
    let lista = codici;
    if (tab === 'attivi') lista = codici.filter(c => c.stato === 'attivo' && c.fineTs >= now);
    else if (tab === 'oggi') lista = codici.filter(c => c.dataISO === oggi);
    else lista = codici.filter(c => (c.creatoTs || 0) >= cut30);

    if (!lista.length) { tb.innerHTML = '<tr><td colspan="9" class="empty">Nessun codice</td></tr>'; return; }

    tb.innerHTML = lista.map(c => {
        const [cls, lbl] = statoUI(c);
        const attivo = c.stato === 'attivo' && c.fineTs >= now;
        const ultimo = (c.eventi || []).slice(-1)[0];
        const evHtml = ultimo
            ? `<span style="font:500 11px var(--mono)">${ultimo.tipo === 'uscita' ? '🚗⬅' : '🚗➡'} ${fmtIt(ultimo.ts)}</span><span style="color:var(--tx3);font-size:10px"> (${(c.eventi || []).length})</span>`
            : '<span style="color:var(--tx3)">—</span>';
        const origine = c.origine === 'sito' ? '🌐 Sito' : '🏪 Banco';
        const pag = c.pagamento === 'CONTANTI' ? '<span class="badge g">CONTANTI</span>' : c.pagamento === 'POS' ? '<span class="badge b">POS</span>' : c.pagamento === 'SUMUP' ? '<span class="badge b">SUMUP</span>' : `<span class="badge">${esc(c.pagamento || '—')}</span>`;
        const codiceHtml = attivo ? `<strong style="font:700 16px var(--mono);letter-spacing:2px">${esc(c.codice)}</strong>` : `<span style="font:500 13px var(--mono);color:var(--tx3);letter-spacing:1px">${esc(c.codice || '······')}</span>`;
        return `<tr ${attivo ? '' : 'style="opacity:.6"'}>
            <td>${codiceHtml}</td>
            <td><strong>${esc(c.targa || '')}</strong>${c.vettura ? `<div style="font-size:11px;color:var(--tx3)">${esc(c.vettura)}</div>` : ''}</td>
            <td style="font-size:11px">${esc(c.telefono || '')}${c.nome ? `<div style="color:var(--tx3)">${esc(c.nome)}</div>` : ''}</td>
            <td style="font:500 11px var(--mono)">${fmtIt(c.inizioTs)} → ${fmtIt(c.fineTs)}<div style="color:var(--tx3)">${c.ore}h · ${fEur(Number(c.prezzo) || 0)}</div></td>
            <td style="font-size:11px">${origine}<div>${pag}</div></td>
            <td><span class="badge ${cls}">${lbl}</span></td>
            <td style="white-space:nowrap">${c.stato === 'attivo' ? syncBadge(c, 'est') + ' ' + syncBadge(c, 'int') : '<span style="color:var(--tx3)">—</span>'}</td>
            <td>${evHtml}</td>
            <td style="white-space:nowrap">
                ${attivo ? `<button class="act-btn" data-act="wa" data-id="${c._id}" title="Invia su WhatsApp">💬</button>
                <button class="act-btn" data-act="copy" data-id="${c._id}" title="Copia codice">📋</button>
                ${(c.sync?.est === 'errore' || c.sync?.int === 'errore') ? `<button class="act-btn" data-act="resync" data-id="${c._id}" title="Riprova sync">↻</button>` : ''}
                <button class="act-btn del" data-act="revoca" data-id="${c._id}" title="Revoca codice">✕</button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

// ── Vendita al banco ──
function leggiForm() {
    const targa = (document.getElementById('psTarga')?.value || '').trim().toUpperCase().replace(/\s+/g, '');
    const telefono = (document.getElementById('psTel')?.value || '').trim();
    const vettura = (document.getElementById('psVettura')?.value || '').trim().toUpperCase();
    const ore = Math.max(config.minOre ?? 2, Math.min(config.maxOre ?? 24, parseInt(document.getElementById('psOre')?.value) || 0));
    const mode = document.getElementById('psInizioMode')?.value || 'now';
    let inizio = new Date();
    if (mode === 'custom') {
        const v = document.getElementById('psInizio')?.value;
        if (v) inizio = new Date(v);
    }
    inizio.setSeconds(0, 0);
    const fine = new Date(inizio.getTime() + ore * 3600e3);
    return { targa, telefono, vettura, ore, inizio, fine, prezzo: prezzoParcheggioOre(ore) };
}

function aggiornaPreview() {
    const f = leggiForm();
    const el = document.getElementById('psPreview'); if (!el) return;
    el.innerHTML = f.ore > 0
        ? `<strong style="font:700 18px var(--f)">${fEur(f.prezzo)}</strong> <span style="color:var(--tx2)">· ${f.ore}h · dal ${fmtIt(f.inizio.getTime())} alle ${fmtIt(f.fine.getTime())}</span>`
        : '';
}

async function vendiAlBanco() {
    const msg = document.getElementById('psMsg');
    const f = leggiForm();
    if (!f.targa || !f.telefono) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Targa e telefono sono obbligatori'; return; }
    if (f.fine.getTime() < Date.now()) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ La validità è già scaduta, controlla l\'orario di inizio'; return; }
    msg.textContent = '';

    const pag = await richiediPagamento(f.prezzo, `Parcheggio ${f.targa} ${f.ore}h`, null);
    if (!pag) return;

    const now = new Date();
    const codice = generaCodice();
    const inizioValid = new Date(f.inizio.getTime() - 5 * 60e3);   // 5 min di tolleranza sull'orologio del terminale
    const docCodice = {
        codice, targa: f.targa, telefono: f.telefono, vettura: f.vettura || '', nome: '',
        ore: f.ore, prezzo: pag.prezzoFinale,
        inizio: isoLocal(inizioValid), fine: isoLocal(f.fine),
        inizioTs: inizioValid.getTime(), fineTs: f.fine.getTime(),
        dataISO: fmtDI(now), creatoTs: now.getTime(), creatoDa: state.currentUser?.user || 'Staff',
        origine: 'banco', pagamento: pag.mod, ...(pag.meta || {}),
        stato: 'attivo', sync: { est: 'pending', int: 'pending' }, syncErrore: null, eventi: [],
        sedeId: SEDE,
    };
    try {
        const ref = await fsAddDoc(fsCollection(db, COLL), docCodice);
        // Riga contabile: parcheggio a ore già chiuso (OUT) → cassa/report/chiusura la contano sul giorno di incasso
        const g = {
            dataIn: fmtDI(f.inizio), orarioIn: hhmm(f.inizio),
            vettura: f.vettura || 'PARCHEGGIO SMART', targa: f.targa, telefono: f.telefono,
            status: 'OUT', pagamento: pag.mod, dataOut: fmtDI(now), orarioOut: hhmm(f.fine),
            prezzoFinale: pag.prezzoFinale, ...(pag.meta || {}),
            origine: 'PARCHEGGIO_SMART', codiceParcheggioId: ref.id, sedeId: SEDE,
        };
        const gref = await fsAddDoc(fsCollection(db, 'giornalieri'), g);
        await fsUpdateDoc(fsDoc(db, COLL, ref.id), { giornalieroId: gref.id });
        state.giornDB.push({ ...g, _id: gref.id });
        codici.unshift({ _id: ref.id, ...docCodice, giornalieroId: gref.id });

        ['psTarga', 'psTel', 'psVettura'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        renderKpi(); renderTabella(); renderGiornalieri();
        mostraCodice({ _id: ref.id, ...docCodice });
    } catch (e) { console.error(e); alert('Errore salvataggio codice: ' + e.message); }
}

function mostraCodice(c) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = `
      <div style="background:var(--bg2);border-radius:var(--r);padding:26px;width:100%;max-width:360px;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.5)">
        <div style="font:600 11px var(--f);color:var(--tx3);letter-spacing:1.5px;text-transform:uppercase">Codice parcheggio</div>
        <div style="font:800 44px var(--mono);letter-spacing:8px;margin:10px 0 6px;color:var(--gold)">${esc(c.codice)}</div>
        <div style="font:400 12px var(--f);color:var(--tx2);margin-bottom:18px"><strong>${esc(c.targa)}</strong> · ${c.ore}h<br>dal ${fmtIt(c.inizioTs)} alle ${fmtIt(c.fineTs)}</div>
        <div style="display:flex;gap:8px">
          <button id="_psWa" class="btn btn-primary" style="flex:2">💬 Invia su WhatsApp</button>
          <button id="_psOk" class="btn" style="flex:1">Chiudi</button>
        </div>
        <div style="font:400 11px var(--f);color:var(--tx3);margin-top:12px">Il codice si attiva sui tastierini entro 1 minuto.</div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_psWa').addEventListener('click', () => apriWhatsApp(c));
    ov.querySelector('#_psOk').addEventListener('click', () => ov.remove());
}

function apriWhatsApp(c) {
    const num = formatPhoneForWA(c.telefono);
    const txt = encodeURIComponent(testoWhatsApp(c));
    window.open(num ? `https://wa.me/${num}?text=${txt}` : `https://wa.me/?text=${txt}`, '_blank');
}

async function revoca(c) {
    const motivo = prompt(`Revocare il codice ${c.codice} (${c.targa})?\nIl cancello smetterà di accettarlo entro 1 minuto.\nMotivo (obbligatorio):`);
    if (!motivo || !motivo.trim()) return;
    try {
        await fsUpdateDoc(fsDoc(db, COLL, c._id), { stato: 'revocato', revocatoTs: Date.now(), revocaMotivo: motivo.trim(), sync: { est: 'pending', int: 'pending' } });
        await logDelete('PARCHEGGIO SMART', `Codice ${c.codice} - Targa ${c.targa} - ${c.ore}h`, motivo.trim());
        Object.assign(c, { stato: 'revocato', sync: { est: 'pending', int: 'pending' } });
        renderKpi(); renderTabella();
    } catch (e) { alert('Errore revoca: ' + e.message); }
}

async function resync(c) {
    try {
        await fsUpdateDoc(fsDoc(db, COLL, c._id), { sync: { est: 'pending', int: 'pending' }, syncErrore: null });
        c.sync = { est: 'pending', int: 'pending' }; c.syncErrore = null;
        renderKpi(); renderTabella();
    } catch (e) { alert('Errore: ' + e.message); }
}

function toast(txt) {
    const t = document.createElement('div');
    t.textContent = txt;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--tx);color:var(--bg);padding:10px 18px;border-radius:20px;font:500 13px var(--f);z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
}
