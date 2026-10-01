// ─── CONTI CLIENTI — partitario (01/10/2026) ───
// Clienti che pagano a rate un canone ricorrente (es. SALVO BOMBOLE: affitto
// spazio €200/mese + luce a consumo). Prima gli acconti erano prenotazioni
// finte e il dovuto viveva su un foglio Drive: qui addebiti e acconti stanno
// in contiClienti/{id}/movimenti e il saldo è sempre la loro differenza.
//   ADDEBITO_AFFITTO  canone del mese (lo crea la function il giorno 1)
//   ADDEBITO_LUCE     kWh × €/kWh (lettura a mano o Shelly Pro 3EM)
//   ACCONTO           versamento (contanti via cassa VNE / POS / bonifico) → riga Prima Nota
//   RETTIFICA         correzioni admin (positivo = addebito, negativo = storno)
//   APERTURA          saldo iniziale migrato dal Drive
import { db, fsCollection, fsGetDocs, fsDoc, fsSetDoc, fsAddDoc, fsUpdateDoc, fsDeleteDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI, formatPhoneForWA } from '../utils.js';
import { query, where } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { richiediPagamento } from './cassa-automatica.js';
import { renderCassa } from './cassa.js';
import { isAdmin } from './auth.js';
import { logDelete } from './log.js';

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const TIPO_LABEL = { ADDEBITO_AFFITTO: '🏠 Affitto', ADDEBITO_LUCE: '⚡ Luce', ACCONTO: '💶 Acconto', RETTIFICA: '✏️ Rettifica', APERTURA: '📂 Saldo iniziale' };

let contoSel = null;       // id conto aperto nella pagina
let filtroMese = '';       // 'YYYY-MM' o '' = tutti

export function initConti() {
    document.getElementById('page-conti')?.addEventListener('click', handleContiActions);
    document.getElementById('contiMese')?.addEventListener('change', e => { filtroMese = e.target.value; renderConti(); });
    document.getElementById('cassaAccontoBtn')?.addEventListener('click', () => accontoDaCassa());
    document.addEventListener('pageChanged', e => { if (e.detail?.pageId === 'conti') renderConti(); });
}

export async function caricaConti() {
    state.contiDB = [];
    try {
        const snap = await fsGetDocs(query(fsCollection(db, 'contiClienti'), where('sedeId', '==', state.sedeAttiva)));
        for (const d of snap.docs) {
            const c = { _id: d.id, ...d.data(), movimenti: [] };
            const mv = await fsGetDocs(fsCollection(db, 'contiClienti', d.id, 'movimenti'));
            mv.forEach(m => c.movimenti.push({ _id: m.id, ...m.data() }));
            c.movimenti.sort((a, b) => (a.dataISO || '').localeCompare(b.dataISO || '') || (a.timestamp || 0) - (b.timestamp || 0));
            state.contiDB.push(c);
        }
    } catch (e) { console.warn('Conti clienti non disponibili:', e.message); }
    aggiornaBottoneCassa();
    renderConti();
}

// Saldo = addebiti − acconti (mai salvato: si ricalcola sempre dai movimenti)
export function saldoConto(c) {
    return Math.round(c.movimenti.reduce((s, m) => s + (m.tipo === 'ACCONTO' ? -pNum(m.importo) : pNum(m.importo)), 0) * 100) / 100;
}

function ultimoAcconto(c) {
    return [...c.movimenti].reverse().find(m => m.tipo === 'ACCONTO') || null;
}

function giorniDa(iso) {
    if (!iso) return null;
    return Math.floor((new Date() - new Date(iso)) / 864e5);
}

function meseLabel(ym) {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return `${MESI[+m - 1]} ${y}`;
}

function aggiornaBottoneCassa() {
    const btn = document.getElementById('cassaAccontoBtn');
    if (btn) btn.style.display = (state.contiDB || []).some(c => c.attivo !== false) ? '' : 'none';
}

// ─── RENDER ───
export function renderConti() {
    const wrap = document.getElementById('contiCards');
    if (!wrap) return;
    const conti = (state.contiDB || []);
    if (!conti.length) {
        wrap.innerHTML = '<div class="empty">Nessun conto cliente per questa sede</div>';
        document.getElementById('contiDettaglio').innerHTML = '';
        return;
    }
    if (!contoSel || !conti.find(c => c._id === contoSel)) contoSel = conti[0]._id;

    wrap.innerHTML = conti.map(c => {
        const saldo = saldoConto(c);
        const ua = ultimoAcconto(c);
        const gg = giorniDa(ua?.dataISO);
        const allarme = gg !== null && gg >= 7;
        return `<div class="kpi ${saldo > 0 ? 'r' : 'g'} conto-card" data-id="${c._id}" style="cursor:pointer;${c._id === contoSel ? 'outline:2px solid var(--gold)' : ''}">
            <div class="kpi-label">${esc(c.nome)}${c.attivo === false ? ' · chiuso' : ''}</div>
            <div class="kpi-val">${fEur(saldo)}</div>
            <div class="kpi-sub" style="font:400 10px var(--mono);color:${allarme ? 'var(--red)' : 'var(--tx3)'};margin-top:2px">
                ${ua ? `ultimo acconto ${fEur(pNum(ua.importo))} il ${esc(ua.data)}${allarme ? ` · ${gg} gg fa ⚠️` : ''}` : 'nessun acconto'}
            </div></div>`;
    }).join('');

    const c = conti.find(x => x._id === contoSel);
    renderDettaglio(c);
}

function renderDettaglio(c) {
    const el = document.getElementById('contiDettaglio');
    if (!el || !c) return;
    const oggi = new Date();
    const ymOggi = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}`;
    const saldo = saldoConto(c);
    const addebiti = c.movimenti.filter(m => m.tipo !== 'ACCONTO').reduce((s, m) => s + pNum(m.importo), 0);
    const acconti = c.movimenti.filter(m => m.tipo === 'ACCONTO').reduce((s, m) => s + pNum(m.importo), 0);
    const affittoMese = c.movimenti.find(m => m.tipo === 'ADDEBITO_AFFITTO' && m.meseRif === ymOggi);
    const luceMese = c.movimenti.find(m => m.tipo === 'ADDEBITO_LUCE' && m.meseRif === ymOggi);
    const mesiLuceMancanti = mesiSenzaLuce(c);
    const mesi = [...new Set(c.movimenti.map(m => (m.dataISO || '').slice(0, 7)).filter(Boolean))].sort().reverse();

    const sel = document.getElementById('contiMese');
    if (sel) {
        const cur = filtroMese;
        sel.innerHTML = `<option value="">Tutti i movimenti</option>` + mesi.map(m => `<option value="${m}" ${m === cur ? 'selected' : ''}>${meseLabel(m)}</option>`).join('');
    }
    const lista = [...c.movimenti].reverse().filter(m => !filtroMese || (m.dataISO || '').startsWith(filtroMese));

    el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
            <div>
                <div style="font:700 16px var(--f)">${esc(c.nome)}</div>
                <div style="font:400 11px var(--f);color:var(--tx2)">Canone ${fEur(pNum(c.canone))}/mese il giorno ${c.giornoAddebito || 1} · luce ${c.luce?.prezzoKwh ? `€${c.luce.prezzoKwh}/kWh` : 'n.d.'} (${c.luce?.modo === 'shelly' ? 'Shelly' : 'lettura manuale'})${c.telefono ? ' · ' + esc(c.telefono) : ''}</div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn btn-primary conto-acconto" data-id="${c._id}">💶 Acconto</button>
                <button class="btn conto-luce" data-id="${c._id}">⚡ Luce (kWh)</button>
                <button class="btn conto-estratto" data-id="${c._id}">📱 Estratto conto</button>
                ${isAdmin() ? `<button class="btn conto-rettifica" data-id="${c._id}">✏️ Rettifica</button><button class="btn conto-modifica" data-id="${c._id}">⚙️</button>` : ''}
            </div>
        </div>
        <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin-bottom:12px">
            <div class="kpi ${saldo > 0 ? 'r' : 'g'}"><div class="kpi-label">Saldo dovuto</div><div class="kpi-val">${fEur(saldo)}</div></div>
            <div class="kpi"><div class="kpi-label">Addebitato</div><div class="kpi-val">${fEur(addebiti)}</div></div>
            <div class="kpi b"><div class="kpi-label">Versato</div><div class="kpi-val">${fEur(acconti)}</div></div>
            <div class="kpi" style="border-color:var(--amb)"><div class="kpi-label">${meseLabel(ymOggi)}</div>
                <div class="kpi-val" style="font-size:15px">${affittoMese ? '🏠 ' + fEur(pNum(affittoMese.importo)) : '🏠 —'} ${luceMese ? '⚡ ' + fEur(pNum(luceMese.importo)) : ''}</div>
                ${mesiLuceMancanti.length ? `<div class="kpi-sub" style="font:400 10px var(--mono);color:var(--amb);margin-top:2px">luce da addebitare: ${mesiLuceMancanti.map(meseLabel).join(', ')}</div>` : ''}
            </div>
        </div>
        <div class="tbl-wrap">
            <table class="tbl">
                <thead><tr><th style="width:90px">Data</th><th>Movimento</th><th style="width:110px">Addebito</th><th style="width:110px">Acconto</th><th style="width:90px">Metodo</th><th>Note</th>${isAdmin() ? '<th style="width:50px"></th>' : ''}</tr></thead>
                <tbody>${lista.length ? lista.map(m => `<tr>
                    <td style="font:400 11px var(--mono)">${esc(m.data || '')}</td>
                    <td><strong>${TIPO_LABEL[m.tipo] || m.tipo}</strong>${m.meseRif ? ` <span style="color:var(--tx3);font-size:11px">${meseLabel(m.meseRif)}</span>` : ''}${m.kwh ? ` <span style="color:var(--tx3);font-size:11px">${m.kwh} kWh</span>` : ''}</td>
                    <td style="font-weight:600;color:var(--red)">${m.tipo !== 'ACCONTO' ? fEur(pNum(m.importo)) : ''}</td>
                    <td style="font-weight:600;color:var(--grn)">${m.tipo === 'ACCONTO' ? fEur(pNum(m.importo)) : ''}</td>
                    <td>${m.metodo ? `<span class="badge ${m.metodo === 'POS' ? 'b' : 'g'}">${esc(m.metodo)}</span>` : ''}</td>
                    <td style="font-size:11px;color:var(--tx2)">${esc(m.note || '')}${m.operatore ? ` <span style="color:var(--tx3)">· ${esc(m.operatore)}</span>` : ''}</td>
                    ${isAdmin() ? `<td><button class="act-btn del conto-del" data-id="${c._id}" data-mid="${m._id}" title="Elimina">✕</button></td>` : ''}
                </tr>`).join('') : '<tr><td colspan="7" class="empty">Nessun movimento</td></tr>'}</tbody>
            </table>
        </div>`;
}

// Mesi passati (dal mese di apertura) senza addebito luce: promemoria per la lettura
function mesiSenzaLuce(c) {
    const out = [];
    const prima = c.movimenti.find(m => m.tipo === 'APERTURA' || m.tipo === 'ADDEBITO_AFFITTO');
    if (!prima?.dataISO) return out;
    const d = new Date(prima.dataISO.slice(0, 7) + '-01');
    const oggi = new Date();
    const fine = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1); // ultimo mese concluso
    for (; d <= fine; d.setMonth(d.getMonth() + 1)) {
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!c.movimenti.some(m => m.tipo === 'ADDEBITO_LUCE' && m.meseRif === ym)) out.push(ym);
    }
    return out;
}

// ─── AZIONI ───
async function handleContiActions(e) {
    const card = e.target.closest('.conto-card');
    if (card) { contoSel = card.dataset.id; renderConti(); return; }
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const c = (state.contiDB || []).find(x => x._id === btn.dataset.id);
    if (!c) return;
    btn.disabled = true;
    try {
        if (btn.classList.contains('conto-acconto')) await registraAcconto(c);
        else if (btn.classList.contains('conto-luce')) await registraLuce(c);
        else if (btn.classList.contains('conto-estratto')) inviaEstratto(c);
        else if (btn.classList.contains('conto-rettifica')) await registraRettifica(c);
        else if (btn.classList.contains('conto-modifica')) await modificaConto(c);
        else if (btn.classList.contains('conto-del')) await eliminaMovimento(c, btn.dataset.mid);
    } finally { btn.disabled = false; }
}

function nuovoMovimento(c, extra) {
    const now = new Date();
    return {
        dataISO: fmtDI(now), data: now.toLocaleDateString('it-IT'), timestamp: now.getTime(),
        operatore: state.currentUser?.user || 'Staff', sedeId: c.sedeId || state.sedeAttiva,
        ...extra
    };
}

async function salvaMovimento(c, mov, id = null) {
    if (id) { await fsSetDoc(fsDoc(db, 'contiClienti', c._id, 'movimenti', id), mov); mov._id = id; }
    else { const ref = await fsAddDoc(fsCollection(db, 'contiClienti', c._id, 'movimenti'), mov); mov._id = ref.id; }
    c.movimenti.push(mov);
    c.movimenti.sort((a, b) => (a.dataISO || '').localeCompare(b.dataISO || '') || (a.timestamp || 0) - (b.timestamp || 0));
}

// Acconto: chiede quanto, poi "come paga" (contanti → cassa VNE, POS, bonifico) e scrive
// anche la riga Prima Nota (PARCHEGGIO, come le righe storiche di questo cliente)
async function registraAcconto(c, importoPreset = null) {
    const saldo = saldoConto(c);
    const raw = importoPreset ?? prompt(`Acconto di ${c.nome}\nSaldo dovuto: ${fEur(saldo)}\n\nImporto €:`, '50');
    if (raw === null) return;
    const importo = parseFloat(String(raw).replace(',', '.'));
    if (!importo || importo <= 0) { alert('Importo non valido'); return; }

    const pag = await richiediPagamento(importo, `${c.nome} — acconto conto`, 'CONTO-' + c._id, { addBonifico: true });
    if (!pag) return;
    const incassato = pag.prezzoFinale || importo;
    const residuo = Math.round((saldo - incassato) * 100) / 100;

    const mov = nuovoMovimento(c, { tipo: 'ACCONTO', importo: incassato, metodo: pag.mod, note: '', ...(pag.meta?.pagamentoVia ? { pagamentoVia: pag.meta.pagamentoVia, idVNE: pag.meta.idVNE || '' } : {}) });
    // id deterministici decisi prima di scrivere: l'operatore può solo creare (niente update dopo)
    const movId = `acconto_${mov.timestamp}`;
    const pnId = `${mov.sedeId}_${mov.dataISO}_acconto-${c._id}-${mov.timestamp}`;
    mov.pnId = pnId;
    try {
        await salvaMovimento(c, mov, movId);
    } catch (e) { console.error('Errore acconto:', e); alert('❌ Errore salvataggio acconto'); return; }

    // Prima Nota: stesso centro di costo delle righe storiche → cassa e report lo contano da soli
    const pnRow = {
        DATA: mov.data, dataISO: mov.dataISO,
        'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO',
        'PRIMANOTA CLIENTI/FORNITORI': `ACCONTO ${c.nome}`,
        Descrizione: `ACCONTO ${c.nome} - ${pag.mod} (residuo ${fEur(residuo)})`,
        ENTRATA: incassato, Entrata: incassato, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0,
        "MODALITA'": pag.mod, timestamp: mov.timestamp, sedeId: mov.sedeId,
        contoId: c._id, movimentoId: movId, ...(pag.meta || {})
    };
    try {
        await fsSetDoc(fsDoc(db, 'primaNota', pnId), pnRow);
        state.rawData?.primaNota?.rows?.push(pnRow);
    } catch (e) { console.error('Errore Prima Nota acconto:', e); alert('⚠️ Acconto salvato ma NON in Prima Nota: avvisa Guido'); }

    renderConti(); renderCassa();
    alert(`✅ Acconto ${fEur(incassato)} registrato.\nResiduo ${c.nome}: ${fEur(residuo)}`);
}

// Dalla pagina Cassa: scegli il conto (se più di uno) e registra
async function accontoDaCassa() {
    const conti = (state.contiDB || []).filter(c => c.attivo !== false);
    if (!conti.length) return;
    let c = conti[0];
    if (conti.length > 1) {
        const scelta = prompt('Quale conto?\n' + conti.map((x, i) => `${i + 1}. ${x.nome} (dovuto ${fEur(saldoConto(x))})`).join('\n'), '1');
        if (scelta === null) return;
        c = conti[+scelta - 1];
        if (!c) return;
    }
    await registraAcconto(c);
}

// Lettura luce a mano: kWh del mese × prezzo → ADDEBITO_LUCE (uno per mese, sovrascrivibile da admin)
async function registraLuce(c) {
    const mancanti = mesiSenzaLuce(c);
    const oggi = new Date();
    const def = mancanti[0] || `${oggi.getFullYear()}-${String(oggi.getMonth()).padStart(2, '0')}`;
    const mese = prompt(`Luce di ${c.nome}\nMese (AAAA-MM):${mancanti.length ? `\nMancano: ${mancanti.map(meseLabel).join(', ')}` : ''}`, def);
    if (!mese || !/^\d{4}-\d{2}$/.test(mese)) return;
    const esiste = c.movimenti.find(m => m.tipo === 'ADDEBITO_LUCE' && m.meseRif === mese);
    if (esiste && !isAdmin()) { alert(`Luce ${meseLabel(mese)} già addebitata (${fEur(pNum(esiste.importo))}). Solo l'admin può correggerla.`); return; }
    const kwhRaw = prompt(`kWh consumati a ${meseLabel(mese)}:`, esiste?.kwh || '');
    if (kwhRaw === null) return;
    const kwh = parseFloat(kwhRaw.replace(',', '.'));
    if (!kwh || kwh <= 0) { alert('kWh non validi'); return; }
    const prezzo = pNum(c.luce?.prezzoKwh);
    if (!prezzo) { alert('Prezzo €/kWh non impostato sul conto (⚙️)'); return; }
    const importo = Math.round(kwh * prezzo * 100) / 100;
    if (!confirm(`Luce ${meseLabel(mese)}: ${kwh} kWh × €${prezzo} = ${fEur(importo)}\nAddebitare sul conto di ${c.nome}?`)) return;
    const mov = nuovoMovimento(c, { tipo: 'ADDEBITO_LUCE', importo, meseRif: mese, kwh, prezzoKwh: prezzo, metodo: '', note: 'lettura manuale' });
    try {
        if (esiste) c.movimenti = c.movimenti.filter(m => m._id !== esiste._id);
        await salvaMovimento(c, mov, `luce_${mese}`);
        renderConti();
    } catch (e) { console.error(e); alert('❌ Errore salvataggio luce'); }
}

async function registraRettifica(c) {
    const raw = prompt(`Rettifica su ${c.nome}\nPositivo = addebito, negativo = storno/sconto.\nImporto €:`);
    if (raw === null) return;
    const importo = parseFloat(raw.replace(',', '.'));
    if (!importo) return;
    const note = prompt('Motivo (obbligatorio):');
    if (!note?.trim()) return;
    try {
        await salvaMovimento(c, nuovoMovimento(c, { tipo: 'RETTIFICA', importo, metodo: '', note: note.trim() }));
        renderConti();
    } catch (e) { console.error(e); alert('❌ Errore'); }
}

async function modificaConto(c) {
    const canone = prompt('Canone mensile €:', c.canone);
    if (canone === null) return;
    const prezzoKwh = prompt('Prezzo luce €/kWh:', c.luce?.prezzoKwh ?? '0.40');
    if (prezzoKwh === null) return;
    const telefono = prompt('Telefono (per estratto conto WhatsApp):', c.telefono || '');
    if (telefono === null) return;
    const upd = { canone: pNum(canone), telefono: telefono.trim(), luce: { ...(c.luce || {}), prezzoKwh: parseFloat(String(prezzoKwh).replace(',', '.')) || 0 } };
    try {
        await fsUpdateDoc(fsDoc(db, 'contiClienti', c._id), upd);
        Object.assign(c, upd);
        renderConti();
    } catch (e) { console.error(e); alert('❌ Errore'); }
}

async function eliminaMovimento(c, mid) {
    const m = c.movimenti.find(x => x._id === mid);
    if (!m) return;
    const motivo = prompt(`Eliminare ${TIPO_LABEL[m.tipo] || m.tipo} ${fEur(pNum(m.importo))} del ${m.data}?\nMotivo (obbligatorio):`);
    if (!motivo?.trim()) return;
    try {
        await logDelete('CONTI CLIENTI', `${c.nome}: ${m.tipo} ${fEur(pNum(m.importo))} del ${m.data}`, motivo.trim());
        await fsDeleteDoc(fsDoc(db, 'contiClienti', c._id, 'movimenti', mid));
        if (m.pnId) { try { await fsDeleteDoc(fsDoc(db, 'primaNota', m.pnId)); } catch (e) { console.warn('PN non rimossa:', e.message); } }
        c.movimenti = c.movimenti.filter(x => x._id !== mid);
        renderConti(); renderCassa();
    } catch (e) { console.error(e); alert('❌ Errore eliminazione'); }
}

// Estratto conto via WhatsApp (wa.me): dovuto / versato / residuo + ultimi movimenti
function inviaEstratto(c) {
    const tel = formatPhoneForWA(c.telefono);
    const saldo = saldoConto(c);
    const oggi = new Date().toLocaleDateString('it-IT');
    const ultimi = [...c.movimenti].reverse().slice(0, 8).map(m =>
        `${m.data} ${m.tipo === 'ACCONTO' ? '−' : '+'}${fEur(pNum(m.importo))} ${TIPO_LABEL[m.tipo]?.replace(/^\S+\s/, '') || ''}${m.meseRif ? ' ' + meseLabel(m.meseRif) : ''}`).join('\n');
    const testo = `Wash Hub — estratto conto ${c.nome} al ${oggi}\n\nResiduo da versare: ${fEur(saldo)}\n\nUltimi movimenti:\n${ultimi}\n\nGrazie!`;
    if (!tel) { prompt('Telefono non valido: copia il testo', testo); return; }
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(testo)}`, '_blank');
}
