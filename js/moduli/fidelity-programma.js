// ─── PROGRAMMA FEDELTÀ (07/10/2026) ───
// Pannello nella pagina FidelAI: punti per €, premi (su FidelAI, via callable fidelaiLoyalty, solo admin)
// e invito WhatsApp dopo il pagamento (config/fidelity, letto da functions/src/fidelai-bridge.ts).
// L'invito resta SPENTO finché Guido non lo attiva dopo il test.
import { db, fsDoc, fsGetDoc, fsSetDoc, fsCollection, fsAddDoc } from '../firebase-config.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js';
import { state } from '../state.js';
import { esc } from '../utils.js';
import { isAdmin } from './auth.js';

const TESTO_DEFAULT = 'Ciao {nome} 👋 grazie per essere passato al Wash Hub!\n\nCon la card fedeltà accumuli punti a ogni lavaggio e li trasformi in premi. I punti del lavaggio di oggi te li abbiamo già messi da parte: attiva la card qui e li trovi caricati 👇\n{link}\n\nA presto,\nStaff Wash Hub';

let premi = [];        // [{id?, name, description, pointsCost, active, delete?}]
let caricato = false;
const call = () => httpsCallable(getFunctions(undefined, 'europe-west1'), 'fidelaiLoyalty');
const $ = id => document.getElementById(id);

export function initFidelityProgramma() {
    document.addEventListener('pageChanged', e => { if (e.detail?.pageId === 'fidelai') carica(); });
    $('fpAddPremio')?.addEventListener('click', () => { premi.push({ name: '', description: '', pointsCost: 100, active: true }); renderPremi(); });
    $('fpSalvaProgramma')?.addEventListener('click', salvaProgramma);
    $('fpSalvaInvito')?.addEventListener('click', salvaInvito);
    $('fpProva')?.addEventListener('click', inviaProva);
    $('fpTesto')?.addEventListener('input', anteprima);
    $('fpPpe')?.addEventListener('input', esempio);
    $('fpPremiTb')?.addEventListener('input', e => {
        const tr = e.target.closest('tr'); if (!tr) return;
        const p = premi[+tr.dataset.i]; if (!p) return;
        const f = e.target.dataset.f;
        if (f === 'pointsCost') p.pointsCost = parseInt(e.target.value, 10) || 0;
        else if (f === 'active') p.active = e.target.checked;
        else if (f) p[f] = e.target.value;
    });
    $('fpPremiTb')?.addEventListener('click', e => {
        const b = e.target.closest('.fp-del'); if (!b) return;
        const p = premi[+b.dataset.i]; if (!p) return;
        if (!confirm(`Eliminare il premio "${p.name || 'senza nome'}"?\nChi l'ha già riscattato non perde niente.`)) return;
        if (p.id) p.delete = true; else premi.splice(+b.dataset.i, 1);
        renderPremi();
    });
}

async function carica() {
    const admin = isAdmin();
    ['fpSalvaProgramma', 'fpAddPremio', 'fpSalvaInvito'].forEach(id => { const b = $(id); if (b) b.disabled = !admin; });
    try {
        const r = (await call()({ action: 'get' })).data;
        premi = r.rewards || [];
        $('fpPpe').value = r.pointsPerEuro;
        $('fpPendDays').textContent = r.pendingDays || 30;
        $('fpKpis').innerHTML = `
            <div class="kpi" style="border-color:var(--gold,#C8A84E)"><div class="kpi-label">💎 Card attive</div><div class="kpi-val">${r.carteAttive}</div></div>
            <div class="kpi b"><div class="kpi-label">⏳ Lavaggi in attesa di card</div><div class="kpi-val">${r.lavaggiInSospeso}</div><div class="kpi-sub">punti messi da parte, si caricano all'attivazione</div></div>
            <div class="kpi g"><div class="kpi-label">📲 Inviti inviati</div><div class="kpi-val">${r.invitiInviati ?? 0}</div></div>`;
        renderPremi(); esempio();
        caricato = true;
    } catch (e) {
        $('fpKpis').innerHTML = `<div class="empty">Programma fedeltà non raggiungibile: ${esc(e.message || '')}</div>`;
    }
    try {
        const c = (await fsGetDoc(fsDoc(db, 'config', 'fidelity'))).data() || {};
        $('fpAttivo').checked = c.invitoAttivo === true;
        $('fpSoloTest').checked = c.soloTest !== false; // default: test
        $('fpNumeriTest').value = (c.numeriTest || []).join(', ');
        $('fpTesto').value = c.testoInvito || TESTO_DEFAULT;
        anteprima();
        statoInvito(c);
    } catch (e) { console.warn('config/fidelity', e.message); }
}

function renderPremi() {
    const admin = isAdmin();
    const vis = premi.map((p, i) => ({ p, i })).filter(x => !x.p.delete);
    $('fpPremiTb').innerHTML = vis.length ? vis.map(({ p, i }) => `<tr data-i="${i}">
        <td><input data-f="name" value="${esc(p.name)}" placeholder="Nome premio" ${admin ? '' : 'disabled'} style="width:100%;padding:6px 8px;background:var(--bg2);border:1px solid var(--brd);border-radius:6px;font:600 13px var(--f);color:var(--tx)">
            <input data-f="description" value="${esc(p.description || '')}" placeholder="Descrizione (la vede il cliente)" ${admin ? '' : 'disabled'} style="width:100%;margin-top:4px;padding:5px 8px;background:var(--bg2);border:1px solid var(--brd);border-radius:6px;font:400 11px var(--f);color:var(--tx2)"></td>
        <td><input data-f="pointsCost" type="number" min="1" value="${p.pointsCost}" ${admin ? '' : 'disabled'} style="width:80px;padding:6px 8px;background:var(--bg2);border:1px solid var(--brd);border-radius:6px;font:700 13px var(--mono);color:var(--tx)"></td>
        <td style="text-align:center"><input data-f="active" type="checkbox" ${p.active ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
        <td>${admin ? `<button class="act-btn del fp-del" data-i="${i}" title="Elimina">✕</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="4" class="empty">Nessun premio</td></tr>';
}

function esempio() {
    const ppe = parseFloat($('fpPpe').value) || 0;
    const prossimo = premi.filter(p => !p.delete && p.active).sort((a, b) => a.pointsCost - b.pointsCost)[0];
    const lav = Math.round(18 * ppe);
    $('fpEsempio').textContent = ppe
        ? `Esempio: lavaggio tradizionale €18 = ${lav} punti${prossimo && lav ? ` · per "${prossimo.name}" servono circa ${Math.ceil(prossimo.pointsCost / lav)} lavaggi` : ''}`
        : 'Con 0 punti per euro nessun lavaggio dà punti.';
}

async function salvaProgramma() {
    if (!isAdmin()) return;
    const msg = $('fpMsgProgramma');
    const bad = premi.find(p => !p.delete && (!String(p.name).trim() || !(p.pointsCost > 0)));
    if (bad) { msg.style.color = 'var(--red)'; msg.textContent = 'Ogni premio deve avere un nome e punti maggiori di zero.'; return; }
    msg.style.color = 'var(--tx2)'; msg.textContent = 'Salvataggio…';
    try {
        await call()({ action: 'set', pointsPerEuro: parseFloat($('fpPpe').value) || 0, rewards: premi });
        msg.style.color = 'var(--grn)'; msg.textContent = '✅ Salvato: i clienti vedono subito i nuovi premi sulla card.';
        await carica();
    } catch (e) { msg.style.color = 'var(--red)'; msg.textContent = '❌ ' + (e.message || 'errore'); }
}

function anteprima() {
    const t = ($('fpTesto').value || TESTO_DEFAULT).replace(/\{nome\}/g, 'Mario').replace(/\{link\}/g, 'https://card.washhub.it/?c=3331234567');
    $('fpAnteprima').textContent = 'Anteprima:\n\n' + t;
}

function statoInvito(c) {
    const el = $('fpMsgInvito');
    if (c.invitoAttivo !== true) { el.style.color = 'var(--tx3)'; el.textContent = '⏸ Spento: nessun messaggio parte dopo i pagamenti.'; }
    else if (c.soloTest) { el.style.color = 'var(--amb)'; el.textContent = `🧪 In prova: parte solo verso ${(c.numeriTest || []).join(', ') || '(nessun numero)'}.`; }
    else { el.style.color = 'var(--grn)'; el.textContent = '🟢 Attivo per tutti i clienti senza card.'; }
}

async function salvaInvito() {
    if (!isAdmin()) return;
    const numeri = $('fpNumeriTest').value.split(',').map(s => s.replace(/\D/g, '')).filter(s => s.length >= 9);
    const cfg = {
        invitoAttivo: $('fpAttivo').checked, soloTest: $('fpSoloTest').checked, numeriTest: numeri,
        testoInvito: $('fpTesto').value.trim() || TESTO_DEFAULT, aggiornato: Date.now(), aggiornatoDa: state.currentUser?.email || '',
    };
    if (cfg.invitoAttivo && !cfg.soloTest && !confirm('Attivare l\'invito per TUTTI i clienti senza card?\nDa ora ogni lavaggio pagato da un cliente senza card fa partire un WhatsApp (una volta per cliente).')) return;
    try { await fsSetDoc(fsDoc(db, 'config', 'fidelity'), cfg, { merge: true }); statoInvito(cfg); }
    catch (e) { $('fpMsgInvito').style.color = 'var(--red)'; $('fpMsgInvito').textContent = '❌ ' + (e.message || 'errore'); }
}

// Prova manuale: mette in coda il messaggio verso un numero, senza pagamento e senza punti
async function inviaProva() {
    const tel = prompt('A quale numero mando la prova?', ($('fpNumeriTest').value.split(',')[0] || '').trim());
    if (!tel) return;
    const d = tel.replace(/\D/g, '').replace(/^39(?=3\d{8,9}$)/, '');
    if (d.length < 9) { alert('Numero non valido'); return; }
    const testo = ($('fpTesto').value || TESTO_DEFAULT).replace(/\{nome\}/g, 'Guido').replace(/\{link\}/g, `https://card.washhub.it/?c=${d}`);
    await fsAddDoc(fsCollection(db, 'whatsappCoda'), { telefono: d, clienteId: null, nome: 'PROVA INVITO CARD', testo, stato: 'in_coda', priorita: 10,
        tipo: 'fidelity', campagnaId: 'fidelity-prova', segmento: 'fidelity', template: 'invito-card', operatore: state.currentUser?.user || 'Staff', creato: Date.now(), sedeId: state.sedeAttiva });
    $('fpMsgInvito').style.color = 'var(--grn)'; $('fpMsgInvito').textContent = `📤 Prova in coda verso ${d}: il Mac Mini la manda entro un minuto (orario 9-20).`;
}
