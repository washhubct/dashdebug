import { db, fsCollection, fsAddDoc, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI, normalizeName, nameSimilarity } from '../utils.js';
import { logDelete } from './log.js';
import { renderCassa } from './cassa.js';
import { autoSalvaCliente, checkClienteDuplicato, showThankYouToast, showConfirmPrenToast, showWelcomePrenToast, showWelcomeToast } from './clienti.js';
import { avviaPagamento, healthBridge, richiediPagamento } from './cassa-automatica.js';
import { loadServiziAttivi } from './servizi-aggiuntivi.js';
import { confermaReferral, rollbackReferral, rollbackReferralNonConfermato } from './referral-confirm.js';

const PREN_SLOTS = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00'];

// Sconto applicato al cliente che USA un codice referral altrui.
// Cambiare qui se in futuro cambia la promo.
const SCONTO_REFERRAL_EUR = 5;

// Ritorna true se il telefono ha almeno 9 cifre (ignora spazi, +, -)
function validaTelefono(tel) {
    return (tel.replace(/[\s\-\+\.]/g, '').match(/\d/g) || []).length >= 9;
}

export function initPrenotazioni() {
    const prenData = document.getElementById('prenData');
    if (prenData) {
        if (!prenData.value) prenData.value = fmtDI(new Date());
        prenData.addEventListener('change', renderPren);
        const btns = prenData.parentElement.querySelectorAll('button');
        btns.forEach(btn => {
            if (btn.textContent.includes('Oggi')) {
                btn.addEventListener('click', () => { prenData.value = fmtDI(new Date()); renderPren(); });
            } else if (btn.textContent.includes('Ieri')) {
                btn.addEventListener('click', () => { moveDate(-1); });
            } else if (btn.textContent.includes('Domani')) {
                btn.addEventListener('click', () => { moveDate(1); });
            }
        });
    }

    const addPrenBtn = document.querySelector('#page-prenotazioni .form-panel.show:not([style*="bg4"]) .btn-primary');
    if (addPrenBtn) addPrenBtn.addEventListener('click', addPren);

    const allPanels = document.querySelectorAll('#page-prenotazioni .form-panel');
    allPanels.forEach(panel => {
        const h3 = panel.querySelector('h3');
        if(h3 && h3.textContent.includes('Tappezzeria')) {
            const tapBtn = panel.querySelector('.btn-primary');
            if(tapBtn) tapBtn.addEventListener('click', addTap);
        }
    });

    document.getElementById('prenTb')?.addEventListener('click', handlePrenActions);
    document.getElementById('tapTb')?.addEventListener('click', handleTapActions);
}

function moveDate(days) {
    const prenData = document.getElementById('prenData');
    let d = new Date(prenData.value);
    if (isNaN(d.getTime())) d = new Date();
    d.setDate(d.getDate() + days);
    prenData.value = fmtDI(d);
    renderPren();
}

export function renderPren() {
    const date = document.getElementById('prenData')?.value;
    if (!date) return;
    const dayData = state.prenDB[date] || [];
    const tb = document.getElementById('prenTb');
    if (!tb) return;

    let totCount = 0, incContanti = 0, incPos = 0, incSospesi = 0;
    let html = '';

    PREN_SLOTS.forEach(slot => {
        const isPausa = slot === '13:30';
        const entries = dayData.filter(e => e.orario === slot);

        if (isPausa && entries.length === 0) {
            html += `<tr style="background:rgba(240,165,0,.05)"><td style="font:600 11px var(--mono);color:var(--amb)">${slot}</td><td colspan="7" style="color:var(--amb);font-size:12px;font-style:italic">🍽️ Pausa pranzo (13:30 - 14:30)</td></tr>`;
            return;
        }

        if (entries.length === 0) {
            html += `<tr><td style="font:500 11px var(--mono);color:var(--tx3)">${slot}</td><td colspan="6" style="color:var(--tx3);font-size:11px">—</td><td><button class="act-btn quick-add" data-slot="${slot}" title="Aggiungi qui">+</button></td></tr>`;
        } else {
            entries.forEach((e, i) => {
                totCount++;
                const prezzo = pNum(e.prezzo);
                if (e.saldato === 'SI' && e.saldo === 'CONTANTI') incContanti += prezzo;
                else if (e.saldato === 'SI' && e.saldo === 'POS') incPos += prezzo;
                else incSospesi += prezzo;

                const isPaid = e.saldato === 'SI' && e.saldo !== 'SOSPESO';
                let pagHtml = e.saldo === 'SOSPESO' ? '<span class="badge a">SOSPESO ⏳</span>' :
                             isPaid ? '<span class="badge g">SALDATO ✓</span>' :
                             `<button class="btn pay-btn" data-id="${e._pid}" data-mod="CONTANTI">💵</button>
                              <button class="btn pay-btn" data-id="${e._pid}" data-mod="POS">💳</button>
                              <button class="btn pay-btn" data-id="${e._pid}" data-mod="SOSPESO" style="border-color:var(--amb);color:var(--amb)">⏳</button>`;

                // Badge referral: presente sulla prenotazione (dal sito) ma non ancora scontato
                let refBadge = '';
                if (e.referral) {
                    if (e.scontoReferralApplicato === true) {
                        refBadge = ` <span class="badge g" title="Sconto referral di €${e.scontoReferral || 5} già applicato" style="font-size:9px">REF −€${e.scontoReferral || 5} ✓</span>`;
                    } else {
                        refBadge = ` <span class="badge a" title="Codice amico ${esc(e.referral)} — sconto €5 verrà applicato all'inserimento prezzo" style="font-size:9px">REF ${esc(e.referral)} −€5</span>`;
                    }
                }

                // Cella prezzo: se sconto applicato, mostra prezzo originale barrato sotto
                let prezzoCellHtml = prezzo ? '€' + prezzo : '—';
                if (e.scontoReferralApplicato === true && e.prezzoOrigine) {
                    prezzoCellHtml = `€${prezzo}<br><span style="font:400 9px var(--mono);color:var(--tx3);text-decoration:line-through">€${pNum(e.prezzoOrigine)}</span>`;
                }

                html += `<tr ${isPaid ? 'style="opacity:.7"' : ''}>
                    <td style="font:500 11px var(--mono)">${i === 0 ? slot : ''}</td>
                    <td><strong>${esc(e.cliente || '')}</strong>${refBadge}</td>
                    <td>${esc(e.vettura || '')}</td>
                    <td style="font:500 12px var(--mono)">${prezzoCellHtml}</td>
                    <td>${pagHtml}</td>
                    <td>${e.saldo ? `<span class="badge ${e.saldo === 'SOSPESO' ? 'a' : 'b'}">${esc(e.saldo)}</span>` : '—'}</td>
                    <td style="font-size:11px;color:var(--tx2)">${esc(e.note || '')}</td>
                    <td>
                        <button class="act-btn edit-pren" data-id="${e._pid}">✎</button>
                        ${e.saldato === 'SI' ? `<button class="act-btn undo-pay" data-id="${e._pid}">↩</button>` : `<button class="act-btn del del-pren" data-id="${e._pid}">✕</button>`}
                    </td></tr>`;
            });
        }
    });

    tb.innerHTML = html;
    document.getElementById('prenTotCount').textContent = totCount;
    document.getElementById('prenIncContanti').textContent = fEur(incContanti);
    document.getElementById('prenIncPos').textContent = fEur(incPos);
    document.getElementById('prenSospesi').textContent = fEur(incSospesi);
    renderCassa();
}

async function handlePrenActions(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.disabled) return;
    const id = btn.dataset.id;
    const date = document.getElementById('prenData').value;

    if (btn.classList.contains('quick-add')) {
        document.getElementById('pOrario').value = btn.dataset.slot;
        document.getElementById('pCliente').focus();
    } else if (btn.classList.contains('pay-btn')) {
        btn.disabled = true;
        try {
            const mod = btn.dataset.mod;
            const serviziExtra = mod !== 'SOSPESO' ? await mostraModalServizi(date, id) : [];
            await markPaid(date, id, mod, serviziExtra);
        } finally { btn.disabled = false; }
    } else if (btn.classList.contains('undo-pay')) {
        btn.disabled = true;
        try { await unmarkPaid(date, id); } finally { btn.disabled = false; }
    } else if (btn.classList.contains('del-pren')) {
        await delPren(date, id);
    } else if (btn.classList.contains('edit-pren')) {
        await editPren(date, id);
    }
}

async function addPren() {
    const date = document.getElementById('prenData').value;
    const inputNome = document.getElementById('pCliente').value;
    const telefono = document.getElementById('pTelefono')?.value.trim() || '';
    const inputVett = document.getElementById('pVettura').value;
    const prezzoRaw = document.getElementById('pPrezzo').value.trim();
    const msg = document.getElementById('prenMsg');

    const showErr = (text, focusId) => {
        if (msg) { msg.style.color = 'var(--red)'; msg.textContent = text; }
        document.getElementById(focusId)?.focus();
    };

    if (!inputNome.trim()) return showErr('⚠️ Inserisci il nominativo', 'pCliente');
    if (!telefono) return showErr('⚠️ Il numero di telefono è obbligatorio', 'pTelefono');
    if (!validaTelefono(telefono)) return showErr('⚠️ Telefono non valido — inserisci almeno 9 cifre (es. 333 1234567)', 'pTelefono');
    if (!inputVett.trim()) return showErr('⚠️ Inserisci il modello vettura', 'pVettura');
    if (!prezzoRaw) return showErr('⚠️ Inserisci il prezzo', 'pPrezzo');

    const prezzoNum = parseFloat(prezzoRaw.replace(',', '.'));
    if (isNaN(prezzoNum) || prezzoNum < 0) return showErr('⚠️ Prezzo non valido (es. 25 oppure 25,50)', 'pPrezzo');

    // Hard autocomplete: se esistono clienti simili, forza scelta o conferma "nuovo"
    const clienteFinale = await checkClienteDuplicato(inputNome);
    if (clienteFinale === null) return; // utente ha annullato

    const obj = {
        dataPren: date,
        orario: document.getElementById('pOrario').value,
        cliente: clienteFinale,
        telefono: telefono,
        vettura: normalizeName(inputVett),
        targa: (document.getElementById('pTarga')?.value.trim() || '').toUpperCase(),
        prezzo: prezzoRaw,
        note: document.getElementById('pNote').value.trim(),
        saldo: '', saldato: '',
        sedeId: state.sedeAttiva
    };

    try {
        const ref = await fsAddDoc(fsCollection(db, "prenotazioni"), obj);
        obj._pid = ref.id;
        if (!state.prenDB[date]) state.prenDB[date] = [];
        state.prenDB[date].push(obj);
        
        // Auto-salva cliente nel CRM con telefono; isNew = true se creato ora
        const isNewClient = await autoSalvaCliente(obj.cliente, obj.vettura, '', obj.telefono);

        renderPren();
        ['pCliente','pTelefono','pVettura','pTarga','pPrezzo','pNote'].forEach(id => document.getElementById(id).value = '');
        if (msg) msg.textContent = '';

        // UN SOLO toast a seconda che il cliente sia nuovo o già conosciuto.
        // Nuovo → benvenuto + conferma prenotazione in unico messaggio (con IG).
        // Esistente → solo conferma prenotazione (promemoria).
        const [y, m, d] = (date || '').split('-');
        const dataIta = d && m && y ? `${d}/${m}/${y}` : date;
        if (isNewClient) {
            showWelcomePrenToast(obj.cliente, dataIta, obj.orario);
        } else {
            showConfirmPrenToast(obj.cliente, dataIta, obj.orario);
        }
    } catch(e) { console.error(e); }
}

// Wrappa avviaPagamento in Promise per uso await
function avviaPagamentoPromise(importoCent, idRef) {
    return new Promise(resolve => {
        avviaPagamento(importoCent, idRef, resolve);
    });
}

// Se la cassa automatica è abilitata e raggiungibile, attiva la VNE per
// il pagamento contanti e ritorna i metadati VNE. Se è offline chiede
// conferma per fallback manuale. Ritorna:
//   { manuale: true }                → procedi col flusso manuale (no metadati)
//   { ok: true, meta, effettivo? }   → cassa ha incassato, salva con metadati
//   { abort: true }                  → pagamento annullato/fallito, non salvare
async function gestisciCassaContanti(prezzoEur, refId) {
    if (!state.cassaAuto?.enabled) return { manuale: true };
    if (!prezzoEur || prezzoEur <= 0) return { manuale: true };

    const h = await healthBridge();
    if (!h?.ok || !h?.vne_reachable) {
        const motivo = !h?.ok ? 'bridge offline' : 'cassa scollegata';
        const fallback = confirm(`⚠️ Cassa automatica non raggiungibile (${motivo}).\n\nVuoi salvare manualmente come pagamento contanti?`);
        return fallback ? { manuale: true } : { abort: true };
    }

    const importoCent = Math.round(prezzoEur * 100);
    const res = await avviaPagamentoPromise(importoCent, refId);

    if (res.status === 'completed') {
        return {
            ok: true,
            meta: { pagamentoVia: 'CASSA_AUTO', idVNE: res.idVNE, vneInserito: res.inserito, vneResto: res.resto },
        };
    }
    if (res.status === 'partial') {
        const ok = confirm(`Cliente ha inserito €${(res.inserito||0).toFixed(2)} ma il totale era €${prezzoEur.toFixed(2)}.\nAccettare pagamento parziale?`);
        if (!ok) return { abort: true };
        return {
            ok: true,
            effettivo: res.inserito,
            meta: { pagamentoVia: 'CASSA_AUTO', idVNE: res.idVNE, vneStatus: 'partial', vneInserito: res.inserito, vneResto: res.resto },
        };
    }
    if (res.status === 'error') alert('Errore cassa: ' + (res.error || 'sconosciuto'));
    return { abort: true };
}

async function mostraModalServizi(date, pid) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return [];

    const servizi = await loadServiziAttivi();
    if (servizi.length === 0) return [];

    return new Promise(resolve => {
        const base = pNum(entry.prezzo);
        // Sconto referral: applicato se la prenotazione ha codice amico e non lo abbiamo già scontato.
        const scontoAttivo = !!entry.referral && entry.scontoReferralApplicato !== true && base > 0;
        const calcola = (extraSum) => {
            const lordo = base + extraSum;
            const sconto = scontoAttivo ? Math.min(SCONTO_REFERRAL_EUR, lordo) : 0;
            return { lordo, sconto, netto: Math.max(0, lordo - sconto) };
        };
        const iniziale = calcola(0);

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';

        const scontoRowHtml = scontoAttivo
            ? `<div id="saScontoRow" style="display:flex;align-items:center;justify-content:space-between;padding:6px 14px;color:var(--amb);font:500 12px var(--f)">
                   <span>🎁 Sconto referral (${esc(entry.referral)})</span>
                   <span id="saSconto">−€${iniziale.sconto.toFixed(2)}</span>
               </div>`
            : '';

        overlay.innerHTML = `
            <div style="background:var(--bg2);border-radius:var(--r);padding:20px;width:100%;max-width:380px;box-shadow:0 12px 40px rgba(0,0,0,.5)">
                <div style="margin-bottom:14px">
                    <div style="font:700 17px var(--f);margin-bottom:4px">Ci sono servizi aggiuntivi?</div>
                    <div style="font:400 12px var(--f);color:var(--tx2)">${esc(entry.cliente)} · lavaggio <strong style="color:var(--tx)">€${base.toFixed(2)}</strong></div>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
                    ${servizi.map(s => `
                        <label style="display:flex;align-items:center;gap:12px;padding:11px 14px;background:var(--bg3);border-radius:var(--r2);border:1.5px solid var(--brd);cursor:pointer;transition:border-color .15s" onchange="this.style.borderColor=this.querySelector('input').checked?'var(--grn)':'var(--brd)'">
                            <input type="checkbox" class="sa-item" data-nome="${esc(s.nome)}" data-prezzo="${s.prezzo}" style="width:18px;height:18px;cursor:pointer;flex-shrink:0;accent-color:var(--grn)">
                            <span style="flex:1;font:500 14px var(--f)">${esc(s.nome)}</span>
                            <span style="font:700 13px var(--mono);color:var(--grn)">+€${s.prezzo.toFixed(2)}</span>
                        </label>
                    `).join('')}
                </div>
                ${scontoRowHtml}
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg4);border-radius:var(--r2);margin-bottom:14px">
                    <span style="font:500 13px var(--f);color:var(--tx2)">Totale da incassare</span>
                    <span id="saTot" style="font:700 20px var(--f);color:var(--grn)">€${iniziale.netto.toFixed(2)}</span>
                </div>
                <div style="display:flex;gap:8px">
                    <button id="saSkip" class="btn" style="flex:1;color:var(--tx2)">Solo lavaggio</button>
                    <button id="saOk" class="btn btn-primary" style="flex:2;font:600 14px var(--f)">Incassa €${iniziale.netto.toFixed(2)}</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        overlay.querySelectorAll('.sa-item').forEach(chk => {
            chk.addEventListener('change', () => {
                let extraSum = 0;
                overlay.querySelectorAll('.sa-item:checked').forEach(c => extraSum += parseFloat(c.dataset.prezzo));
                const r = calcola(extraSum);
                overlay.querySelector('#saTot').textContent = '€' + r.netto.toFixed(2);
                overlay.querySelector('#saOk').textContent = 'Incassa €' + r.netto.toFixed(2);
                const ss = overlay.querySelector('#saSconto');
                if (ss) ss.textContent = '−€' + r.sconto.toFixed(2);
            });
        });

        const close = (selected) => { document.body.removeChild(overlay); resolve(selected); };

        overlay.querySelector('#saSkip').addEventListener('click', () => close([]));
        overlay.querySelector('#saOk').addEventListener('click', () => {
            const sel = [];
            overlay.querySelectorAll('.sa-item:checked').forEach(c => sel.push({ nome: c.dataset.nome, prezzo: parseFloat(c.dataset.prezzo) }));
            close(sel);
        });
    });
}

async function markPaid(date, pid, mod, serviziExtra = []) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return;

    let extraMeta = {};
    let prezzoFinaleStr = entry.prezzo;

    if (serviziExtra && serviziExtra.length > 0) {
        const totale = pNum(entry.prezzo) + serviziExtra.reduce((s, x) => s + x.prezzo, 0);
        prezzoFinaleStr = String(totale);
        extraMeta.serviziAggiuntivi = serviziExtra;
        extraMeta.prezzoLavaggio = entry.prezzo;
    }

    // Sconto referral automatico (no-op se già applicato o assente).
    // L'operatore l'ha già visto nel modal "Servizi aggiuntivi", non rialertiamo.
    const sc = applicaScontoReferral(entry, prezzoFinaleStr);
    if (sc.meta) {
        prezzoFinaleStr = String(sc.prezzoFinale);
        Object.assign(extraMeta, sc.meta);
    }

    if (mod === 'CONTANTI') {
        const prezzoEur = pNum(prezzoFinaleStr);
        const r = await gestisciCassaContanti(prezzoEur, pid);
        if (r.abort) return;
        if (r.ok) {
            extraMeta = { ...extraMeta, ...r.meta };
            if (r.effettivo) prezzoFinaleStr = String(r.effettivo);
        }
    }

    try {
        const upd = { saldato: 'SI', saldo: mod, ...extraMeta };
        if (prezzoFinaleStr !== entry.prezzo) upd.prezzo = prezzoFinaleStr;
        await fsUpdateDoc(fsDoc(db, "prenotazioni", pid), upd);
        Object.assign(entry, upd);

        // Conferma referral (no-op se assente o già confermato)
        if (entry.referral && entry.referralConfermato !== true) {
            await confermaReferral(entry);
            try {
                await fsUpdateDoc(fsDoc(db, "prenotazioni", pid), { referralConfermato: true });
            } catch (e) { console.warn('referralConfermato flag fail:', e?.message); }
        }

        renderPren();
        showThankYouToast(entry.cliente, pNum(prezzoFinaleStr));
    } catch(e) { alert("Errore Cloud"); }
}

async function unmarkPaid(date, pid) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return;
    try {
        await fsUpdateDoc(fsDoc(db, "prenotazioni", pid), { saldato: '', saldo: '' });
        entry.saldato = ''; entry.saldo = '';

        // Rollback referral se la prenotazione era stata confermata
        if (entry.referral && entry.referralConfermato === true) {
            await rollbackReferral(entry);
            try {
                await fsUpdateDoc(fsDoc(db, "prenotazioni", pid), { referralConfermato: false });
            } catch (e) { console.warn('referralConfermato rollback fail:', e?.message); }
        }

        renderPren();
    } catch(e) { alert("Errore Cloud"); }
}

async function delPren(date, pid) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return;
    const motivazione = prompt(`Motivo cancellazione per ${entry.cliente}?`);
    if (!motivazione) return;

    try {
        await logDelete('PRENOTAZIONI', `${entry.cliente} - ${entry.vettura}`, motivazione);

        // Rollback contatori referral sulla prenotazione cancellata.
        // - non confermata → decrement totale + inAttesa
        // - confermata     → log warning, NON tocco (il voucher è già stato emesso
        //                    e il referrer potrebbe averlo già usato; l'admin
        //                    può eventualmente invalidare a mano dal pannello Voucher).
        if (entry.referral) {
            if (entry.referralConfermato === true) {
                console.warn('[delPren] prenotazione confermata cancellata, voucher gia\' emesso non viene revocato:', entry.referral);
            } else {
                try {
                    await rollbackReferralNonConfermato(entry);
                } catch (e) { console.warn('[delPren] rollback referral fail:', e?.message); }
            }
        }

        await fsDeleteDoc(fsDoc(db, "prenotazioni", pid));
        state.prenDB[date] = state.prenDB[date].filter(e => e._pid !== pid);
        renderPren();
    } catch(e) { alert("Errore Cloud"); }
}

async function editPren(date, pid) {
    const entry = state.prenDB[date]?.find(e => e._pid === pid);
    if (!entry) return;
    
    const nuovoCliente = prompt('Nominativo:', entry.cliente);
    if (nuovoCliente === null) return;
    const nuovaVettura = prompt('Vettura:', entry.vettura);
    if (nuovaVettura === null) return;
    const nuovoPrezzo = prompt('Prezzo €:', entry.prezzo);
    if (nuovoPrezzo === null) return;
    // Validazione numerica (accetta "25", "25,50", "25.50")
    const prezzoTrim = nuovoPrezzo.trim();
    const prezzoNum = parseFloat(prezzoTrim.replace(',', '.'));
    if (prezzoTrim && (isNaN(prezzoNum) || prezzoNum < 0)) {
        alert("⚠️ Prezzo non valido! Usa un numero (es. 25 oppure 25,50).");
        return;
    }
    const nuoveNote = prompt('Note:', entry.note || '');
    if (nuoveNote === null) return;

    const updates = {
        cliente: normalizeName(nuovoCliente),
        vettura: normalizeName(nuovaVettura),
        prezzo: prezzoTrim,
        note: nuoveNote.trim()
    };

    // Sconto referral automatico (idempotente).
    // Si applica solo se la prenotazione ha un codice referral e non è già stato applicato.
    const sc = applicaScontoReferral(entry, prezzoTrim);
    if (sc.meta) {
        updates.prezzo = String(sc.prezzoFinale);
        Object.assign(updates, sc.meta);
        alert(`💰 Sconto referral applicato\n\nCodice amico: ${entry.referral}\nPrezzo inserito: €${pNum(prezzoTrim)}\nSconto: −€${sc.meta.scontoReferral}\nPrezzo finale: €${sc.prezzoFinale}`);
    }

    try {
        await fsUpdateDoc(fsDoc(db, "prenotazioni", pid), updates);
        Object.assign(entry, updates);
        renderPren();
    } catch(e) { alert("Errore Cloud"); }
}

function _parseIta(s) {
    if (!s) return null;
    const [d, m, y] = s.split('/');
    return y ? new Date(+y, +m - 1, +d) : null;
}

// Applica lo sconto -€5 per chi usa un codice referral altrui (best effort,
// idempotente: se già applicato non rifa). Ritorna prezzo finale + meta da
// salvare insieme alla prenotazione.
function applicaScontoReferral(entry, prezzoBase) {
    const base = pNum(prezzoBase);
    if (!entry?.referral) return { prezzoFinale: base, meta: null };
    if (entry.scontoReferralApplicato === true) return { prezzoFinale: base, meta: null };
    if (base <= 0) return { prezzoFinale: base, meta: null };

    const sconto = Math.min(SCONTO_REFERRAL_EUR, base);
    const finale = Math.max(0, base - sconto);
    return {
        prezzoFinale: finale,
        meta: {
            prezzoOrigine: base,
            scontoReferral: sconto,
            scontoReferralApplicato: true
        }
    };
}

export function renderTap() {
    const tb = document.getElementById('tapTb');
    if (!tb) return;

    // Usa la data selezionata nel selettore, non la data di sistema
    const iso = document.getElementById('prenData')?.value;
    const selDataIta = iso ? iso.split('-').reverse().join('/') : new Date().toLocaleDateString('it-IT');
    const selDate = iso ? new Date(iso + 'T00:00:00') : new Date();
    selDate.setHours(0, 0, 0, 0);

    // In lavorazione: status=IN (qualunque giorno), oppure OUT ma usciti DOPO la data selezionata
    const inLav = state.tapDB.filter(t => {
        if (t.status === 'IN') return true;
        if (t.status === 'OUT') {
            const dOut = _parseIta(t.dataOut);
            return dOut && dOut > selDate;
        }
        return false;
    });

    // Completate nel giorno selezionato
    const outData = state.tapDB.filter(t => t.status === 'OUT' && t.dataOut === selDataIta);

    let html = '';
    if (inLav.length === 0) {
        html = '<tr><td colspan="7" class="empty">Nessuna tappezzeria in lavorazione</td></tr>';
    } else {
        inLav.forEach(t => {
            html += `<tr>
                <td style="font:400 11px var(--mono)">${t.dataIn}</td>
                <td><strong>${esc(t.cliente)}</strong></td>
                <td>${esc(t.modello)}</td>
                <td style="font:500 11px var(--mono)">${esc(t.targa)}</td>
                <td style="font-weight:600">€${pNum(t.prezzo)}</td>
                <td>
                    <button class="btn pay-tap" data-id="${t._id}" data-mod="CONTANTI">💵</button>
                    <button class="btn pay-tap" data-id="${t._id}" data-mod="POS">💳</button>
                    <button class="btn pay-tap" data-id="${t._id}" data-mod="SOSPESO" style="border-color:var(--amb);color:var(--amb)">⏳</button>
                </td>
                <td><button class="act-btn del del-tap" data-id="${t._id}">✕</button></td></tr>`;
        });
    }
    tb.innerHTML = html;

    // Sezione completate oggi
    let outSection = document.getElementById('tapOutSection');
    if (!outSection) {
        outSection = document.createElement('div');
        outSection.id = 'tapOutSection';
        tb.closest('.tbl-wrap')?.after(outSection);
    }

    if (outData.length > 0) {
        let outHtml = `<div style="margin-top:14px;margin-bottom:6px;font:600 11px var(--mono);color:var(--tx3);text-transform:uppercase;letter-spacing:0.5px">✅ Completate ${selDataIta}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Entrata</th><th>Uscita</th><th>Cliente</th><th>Modello</th><th>Targa</th><th>Prezzo</th><th>Pagamento</th></tr></thead><tbody>`;
        outData.forEach(t => {
            outHtml += `<tr style="opacity:0.6">
                <td>${t.dataIn}</td>
                <td>${t.dataOut || '—'}</td>
                <td>${esc(t.cliente)}</td>
                <td>${esc(t.modello)}</td>
                <td>${esc(t.targa)}</td>
                <td style="font-weight:600">€${pNum(t.prezzo)}</td>
                <td><span class="badge ${t.pagamento === 'SOSPESO' ? 'a' : 'b'}">${t.pagamento || '—'}</span></td>
            </tr>`;
        });
        outHtml += '</tbody></table></div>';
        outSection.innerHTML = outHtml;
    } else {
        outSection.innerHTML = '';
    }
}

async function addTap() {
    const msg = document.getElementById('tapMsg');
    const inputNome = document.getElementById('tCliente').value;
    const modelloRaw = document.getElementById('tModello').value;
    const prezzoRaw = document.getElementById('tPrezzo').value.trim();

    const targaRaw = document.getElementById('tTarga').value.trim();
    if(!inputNome.trim() || !modelloRaw.trim() || !prezzoRaw || !targaRaw) {
        if(msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Compila Cliente, Modello, Targa e Prezzo!'; }
        if(!targaRaw) document.getElementById('tTarga').focus();
        return;
    }

    // Hard autocomplete: scelta obbligata se ci sono simili
    const clienteFinale = await checkClienteDuplicato(inputNome);
    if (clienteFinale === null) return;

    const telefono = (document.getElementById('tTelefono')?.value || '').trim();
    if (telefono && !validaTelefono(telefono)) {
        if(msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Telefono non valido — inserisci almeno 9 cifre'; }
        document.getElementById('tTelefono')?.focus();
        return;
    }
    const obj = {
        dataIn: new Date().toLocaleDateString('it-IT'),
        cliente: clienteFinale,
        modello: normalizeName(modelloRaw),
        targa: normalizeName(document.getElementById('tTarga').value),
        telefono,
        prezzo: prezzoRaw,
        status: 'IN', pagamento: '', dataOut: '',
        sedeId: state.sedeAttiva
    };
    try {
        const ref = await fsAddDoc(fsCollection(db, "tappezzeria"), obj);
        obj._id = ref.id;
        state.tapDB.push(obj);
        
        // Auto-salva cliente nel CRM. Tappezzeria non raccoglie tel:
        // se il cliente era già nel CRM con tel noto, il toast benvenuto può
        // comunque scattare (in caso di prima interazione con noi).
        const isNewClient = await autoSalvaCliente(obj.cliente, obj.modello, obj.targa, '');

        renderTap();
        ['tCliente','tModello','tTarga','tTelefono','tPrezzo'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });

        // Se è un nuovo cliente con telefono valido nel CRM, propone benvenuto
        if (isNewClient) showWelcomeToast(obj.cliente);
        if(msg) { msg.style.color = 'var(--grn)'; msg.textContent = 'Tappezzeria registrata!'; setTimeout(() => msg.textContent = '', 2000); }
    } catch(e) { console.error(e); if(msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Errore connessione Cloud'; } }
}

async function handleTapActions(e) {
    const btn = e.target.closest('button');
    const id = btn?.dataset.id;
    if (!id) return;
    if (btn.classList.contains('pay-tap')) {
        btn.disabled = true;
        try { await markPaidTap(id, btn.dataset.mod); } finally { btn.disabled = false; }
    } else if (btn.classList.contains('del-tap')) {
        delTap(id);
    }
}

async function markPaidTap(id, modDefault) {
    const t = state.tapDB.find(x => x._id === id);
    if (!t) return;

    let modUp = modDefault;
    let extraMeta = {};
    let prezzoFinaleStr = t.prezzo;

    if (modUp === 'CONTANTI') {
        const pag = await richiediPagamento(parseFloat(t.prezzo) || 0, t.cliente + ' — ' + t.modello, 'TAP-' + id);
        if (!pag) return;
        modUp = pag.mod;
        prezzoFinaleStr = String(pag.prezzoFinale);
        extraMeta = pag.meta || {};
    } else if (modUp === 'POS') {
        modUp = 'POS';
    }

    const dataOut = new Date().toLocaleDateString('it-IT');
    const dataISO = fmtDI(new Date());
    const upd = { status: 'OUT', pagamento: modUp, dataOut, ...extraMeta };
    if (prezzoFinaleStr !== t.prezzo) upd.prezzo = prezzoFinaleStr;

    try {
        await fsUpdateDoc(fsDoc(db, "tappezzeria", id), upd);
        Object.assign(t, upd);

        if (modUp !== 'SOSPESO') {
            showThankYouToast(t.cliente, parseFloat(prezzoFinaleStr) || 0);
            const imp = parseFloat(prezzoFinaleStr) || 0;
            await fsAddDoc(fsCollection(db, "primaNota"), {
                DATA: dataOut, dataISO,
                'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO',
                'PRIMANOTA CLIENTI/FORNITORI': 'TAPPEZZERIA ' + (t.cliente || '') + ' ' + (t.modello || ''),
                Descrizione: 'TAPPEZZERIA ' + (t.cliente || '') + ' ' + (t.modello || ''),
                ENTRATA: imp, Entrata: imp,
                USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0,
                "MODALITA'": modUp, timestamp: Date.now(),
                sedeId: state.sedeAttiva
            }).catch(e => console.warn("Errore Prima Nota tappezzeria:", e));
        }

        renderTap();
        renderCassa();
    } catch(e) { alert("Errore Cloud"); }
}

async function delTap(id) {
    const t = state.tapDB.find(x => x._id === id);
    if (!t) return;
    const motivazione = prompt("Motivo cancellazione tappezzeria?");
    if (!motivazione || motivazione.trim() === '') { alert("❌ Cancellazione annullata: motivazione mancante."); return; }
    try {
        await logDelete('TAPPEZZERIA', `${t.cliente} - ${t.modello}`, motivazione.trim());
        await fsDeleteDoc(fsDoc(db, "tappezzeria", id));
        state.tapDB = state.tapDB.filter(x => x._id !== id);
        renderTap();
        renderCassa();
    } catch(e) { alert("Errore Cloud"); }
}
