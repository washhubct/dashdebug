// ─── 📞 CHIAMATE IN DASHBOARD (19/10/2026) ───
// Il Pi del lavaggio legge il Call Monitor del FRITZ!Box (bridge-cassa/chiamate/) e scrive:
//   chiamataLive/{sede} → riquadro "sta chiamando" con chi è (CRM + ultime visite) e "📅 Prenota" già compilato
//   chiamate/{id}       → elenco "da richiamare" (perse di oggi non ancora richiamate)
import { db, fsDoc, fsUpdateDoc, fsCollection, fsOnSnapshot } from '../firebase-config.js';
import { query, where } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { state } from '../state.js';
import { esc } from '../utils.js';
import { goPage } from './navigazione.js';

const tel9 = t => String(t || '').replace(/\D/g, '').slice(-9);
const isoOggi = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
let unsubLive = null, unsubPerse = null, perse = [], nascondiTimer = null, ultimoId = '';

export function avviaChiamate() {
    const sede = state.sedeAttiva || 'lungomare';
    unsubLive?.(); unsubPerse?.();
    unsubLive = fsOnSnapshot(fsDoc(db, 'chiamataLive', sede), snap => {
        const c = snap.exists() ? snap.data() : null;
        if (!c || c.direzione !== 'in') return;
        const fresca = Date.now() - (c.aggiornatoTs || 0) < 120000;
        if (c.stato === 'squilla' && fresca) mostra(c);
        else if (c.stato === 'in_corso' && c.chiamataId === ultimoId) etichetta('🟢 In linea');
        else if ((c.stato === 'persa' || c.stato === 'conclusa') && c.chiamataId === ultimoId) {
            etichetta(c.stato === 'persa' ? '🔴 Persa: da richiamare' : '✓ Conclusa');
            clearTimeout(nascondiTimer); nascondiTimer = setTimeout(nascondi, 20000);
        }
    }, () => {});
    unsubPerse = fsOnSnapshot(query(fsCollection(db, 'chiamate'), where('sedeId', '==', sede), where('dataISO', '==', isoOggi())), snap => {
        perse = [];
        snap.forEach(d => { const v = d.data(); if (v.direzione === 'in' && v.stato === 'persa' && v.richiamato !== true) perse.push({ ...v, _id: d.id }); });
        perse.sort((a, b) => (b.inizioTs || 0) - (a.inizioTs || 0));
        disegnaPerse();
    }, () => {});
}

// Chi è? CRM + storico prenotazioni dal telefono
function chiE(num) {
    const t = tel9(num);
    if (t.length < 9) return { nome: '', nuovo: true };
    const crm = (state.clientiDB || []).find(c => tel9(c.telefono) === t);
    let ultima = null, oggi = null, vettura = '', visite = 0, sospeso = 0;
    const oggiISO = isoOggi();
    for (const [data, arr] of Object.entries(state.prenDB || {})) {
        for (const p of arr) {
            if (tel9(p.telefono) !== t) continue;
            if (p.stato === 'NO_SHOW') continue;
            if (data === oggiISO) oggi = p;
            if (p.saldato === 'SI') { visite++; if (!ultima || data > ultima.data) { ultima = { data, p }; vettura = p.vettura || vettura; } }
            if (p.saldo === 'SOSPESO') sospeso += parseFloat(p.prezzo) || 0;
        }
    }
    const nome = crm?.nome || ultima?.p?.cliente || oggi?.cliente || '';
    const gg = ultima ? Math.round((new Date(oggiISO) - new Date(ultima.data)) / 86400000) : null;
    return { nome, vettura: vettura || oggi?.vettura || '', visite, gg, oggi, sospeso, nuovo: !nome, tier: crm?.tier || '' };
}

function box() {
    let el = document.getElementById('chiamataBox');
    if (!el) {
        el = document.createElement('div');
        el.id = 'chiamataBox';
        el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:10050;width:min(360px,calc(100vw - 32px));background:var(--bg2);border-radius:var(--r);box-shadow:var(--shadow-xl);border:2px solid #C8A84E;padding:14px 16px;font:400 13px var(--f);display:none';
        document.body.appendChild(el);
    }
    return el;
}
function etichetta(t) { const s = document.getElementById('chStato'); if (s) s.textContent = t; }
function nascondi() { const el = document.getElementById('chiamataBox'); if (el) el.style.display = 'none'; }

function mostra(c) {
    clearTimeout(nascondiTimer);
    ultimoId = c.chiamataId;
    const i = chiE(c.numero);
    const el = box();
    const dettagli = i.nuovo
        ? '<div style="color:var(--tx3)">Numero nuovo: non è nel CRM</div>'
        : `<div>${esc(i.vettura || '—')} · ${i.visite} lavagg${i.visite === 1 ? 'io' : 'i'}${i.gg != null ? ` · ultimo ${i.gg === 0 ? 'oggi' : i.gg + ' gg fa'}` : ''}</div>
           ${i.oggi ? `<div style="color:var(--grn)">📅 Prenotato oggi alle ${esc(i.oggi.orario || '')}</div>` : ''}
           ${i.sospeso > 0 ? `<div style="color:var(--amb)">⏳ Sospeso aperto €${i.sospeso}</div>` : ''}`;
    el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center">
            <span id="chStato" style="font:600 11px var(--f);color:#C8A84E">📞 Sta chiamando…</span>
            <button class="btn" id="chChiudi" style="padding:2px 8px">✕</button>
        </div>
        <div style="font:700 18px var(--f);margin:6px 0 2px">${esc(i.nome || c.numero)}${i.tier ? ` <span class="badge a" style="font-size:9px">${esc(i.tier)}</span>` : ''}</div>
        <div style="font:500 12px var(--mono);color:var(--tx2);margin-bottom:6px">${esc(c.numero)}</div>
        ${dettagli}
        <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-primary" id="chPrenota" style="flex:1">📅 Prenota</button>
        </div>`;
    el.style.display = 'block';
    el.querySelector('#chChiudi').onclick = nascondi;
    el.querySelector('#chPrenota').onclick = () => apriPrenota(c.numero, i);
}

function apriPrenota(numero, i) {
    goPage('prenotazioni');
    const set = (id, v) => { const f = document.getElementById(id); if (f && v) { f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('pCliente', i.nome); set('pTelefono', tel9(numero)); set('pVettura', i.vettura);
    document.getElementById(i.nome ? 'pVettura' : 'pCliente')?.focus();
    nascondi();
}

// Elenco "da richiamare" in cima alla pagina Prenotazioni
function disegnaPerse() {
    let el = document.getElementById('chiamatePerse');
    const host = document.querySelector('#page-prenotazioni .sec');
    if (!host) return;
    if (!el) { el = document.createElement('div'); el.id = 'chiamatePerse'; host.insertBefore(el, host.children[1] || null); }
    if (!perse.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div style="background:rgba(230,57,70,.06);border:1px solid rgba(230,57,70,.25);border-radius:var(--r2);padding:10px 12px;margin-bottom:12px">
        <div style="font:600 12px var(--f);margin-bottom:6px">📞 Da richiamare oggi (${perse.length})</div>
        ${perse.map(p => { const i = chiE(p.numero); return `<div style="display:flex;align-items:center;gap:10px;padding:4px 0;font-size:12px">
            <span style="font:500 11px var(--mono);width:40px">${esc(p.ora || '')}</span>
            <span style="flex:1"><strong>${esc(i.nome || 'Numero nuovo')}</strong> · <a href="tel:${esc(p.numero)}">${esc(p.numero)}</a>${i.vettura ? ` · ${esc(i.vettura)}` : ''}</span>
            <button class="btn" data-pren="${esc(p._id)}" style="padding:2px 8px">📅</button>
            <button class="btn" data-ok="${esc(p._id)}" style="padding:2px 8px" title="Richiamato">✓</button></div>`; }).join('')}
    </div>`;
    el.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
        b.disabled = true;
        try { await fsUpdateDoc(fsDoc(db, 'chiamate', b.dataset.ok), { richiamato: true, richiamatoTs: Date.now(), richiamatoData: new Date().toLocaleDateString('it-IT'), richiamatoDa: state.currentUser?.user || '' }); }
        catch (e) { b.disabled = false; alert('Errore: ' + (e?.message || e)); }
    });
    el.querySelectorAll('[data-pren]').forEach(b => b.onclick = () => { const p = perse.find(x => x._id === b.dataset.pren); if (p) apriPrenota(p.numero, chiE(p.numero)); });
}
