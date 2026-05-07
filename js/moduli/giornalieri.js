import { db, fsCollection, fsAddDoc, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI } from '../utils.js';
import { logDelete } from './log.js';
import { renderCassa } from './cassa.js';
import { richiediPagamento } from './cassa-automatica.js';

export function initGiornalieri() {
    // Gestione input data e bottone "Oggi"
    const giornData = document.getElementById('giornData');
    if (giornData) {
        giornData.addEventListener('change', renderGiornalieri);
        const btnOggi = giornData.nextElementSibling;
        if (btnOggi && btnOggi.tagName === 'BUTTON') {
            btnOggi.addEventListener('click', () => {
                giornData.value = fmtDI(new Date());
                renderGiornalieri();
            });
        }
    }

    // Bottone Registra IN
    const addBtn = document.querySelector('#page-giornalieri .btn-primary');
    if(addBtn) addBtn.addEventListener('click', addGiornaliero);

    // Event Delegation per i tasti della tabella (Checkout e ✕)
    const tb = document.getElementById('giornTb');
    if(tb) {
        tb.addEventListener('click', (e) => {
            const btnCheckout = e.target.closest('.btn-primary');
            if (btnCheckout) {
                checkoutGiornaliero(btnCheckout.dataset.id);
                return;
            }
            const btnDel = e.target.closest('.del');
            if (btnDel) {
                delGiornaliero(btnDel.dataset.id);
            }
        });
    }
}

export function calcPrezzoGiornaliero(oraIn, dataIn, oraOut, dataOut) {
    const start = new Date(dataIn + 'T' + oraIn);
    const end   = new Date(dataOut + 'T' + oraOut);
    const diffMs = end - start;
    if (diffMs <= 0) return 0;

    const diffOre = diffMs / 3600000;

    // Primo giorno (≤24h)
    if (diffOre <= 6) {
        // €2/h con cap a €8
        return Math.min(Math.ceil(diffOre) * 2, 8);
    }
    if (diffOre <= 24) {
        // €8 fisso + €2/h per ogni ora oltre le 6h, cap €15
        return Math.min(8 + Math.ceil(diffOre - 6) * 2, 15);
    }

    // Oltre 24h: €15 primo giorno + €12 per ogni giorno intero + €2/h per le ore residue
    const oreExtra    = diffOre - 24;
    const giorniInteri = Math.floor(oreExtra / 24);
    const oreResidue   = oreExtra % 24;
    return 15 + giorniInteri * 12 + Math.ceil(oreResidue) * 2;
}

export function renderGiornalieri() {
    const giornDataEl = document.getElementById('giornData');
    if(giornDataEl && !giornDataEl.value) giornDataEl.value = fmtDI(new Date());
    const dateStr = giornDataEl?.value;
    if (!dateStr) return;
    
    const tb = document.getElementById('giornTb');
    if(!tb) return;

    let inSosta = 0, incContanti = 0, incPos = 0;
    
    const filtrati = state.giornDB.filter(g => g.dataIn === dateStr || g.status === 'IN');
    
    if (!filtrati.length) { 
        tb.innerHTML = '<tr><td colspan="8" class="empty">Nessun parcheggio registrato</td></tr>'; 
        document.getElementById('gInSosta').textContent = '0';
        document.getElementById('gIncContanti').textContent = '€0';
        document.getElementById('gIncPos').textContent = '€0';
        renderCassa();
        return; 
    }
    
    let html = '';
    const now = new Date();
    const nowTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const nowDate = fmtDI(now);

    filtrati.sort((a, b) => (a.status === 'IN' ? -1 : 1));
    
    filtrati.forEach(g => {
        const isOut = g.status === 'OUT';
        let costoHtml = '';
        let currCosto = 0;
        
        if (isOut) {
            if (g.pagamento === 'CONTANTI' && g.dataOut === dateStr) incContanti += pNum(g.prezzoFinale);
            if (g.pagamento === 'POS' && g.dataOut === dateStr) incPos += pNum(g.prezzoFinale);
            costoHtml = `<strong>€${g.prezzoFinale}</strong>`;
        } else {
            inSosta++;
            currCosto = calcPrezzoGiornaliero(g.orarioIn, g.dataIn, nowTime, nowDate);
            costoHtml = `<span style="color:var(--tx3)">Previsto: €${currCosto}</span>`;
        }
        
        const badge = isOut ? `<span class="badge ${g.pagamento === 'POS' ? 'b' : 'g'}">${g.pagamento}</span>` : `<span class="badge a">IN SOSTA ⏳</span>`;
        const tdOut = isOut ? `<span style="font:500 11px var(--mono)">${g.orarioOut}</span>` : '<span style="color:var(--tx3)">—</span>';
        
        html += `<tr ${isOut ? 'style="opacity:0.6"' : ''}>
            <td style="font:500 11px var(--mono)">${g.dataIn === dateStr ? g.orarioIn : g.dataIn.split('-').reverse().join('/') + ' ' + g.orarioIn}</td>
            <td><strong>${esc(g.vettura)}</strong></td>
            <td style="font:500 10px var(--mono)">${esc(g.targa)}</td>
            <td style="font-size:11px">${esc(g.telefono)}</td>
            <td>${tdOut}</td>
            <td>${costoHtml}</td>
            <td>${badge}</td>
            <td style="white-space:nowrap">
                ${!isOut ? `<button class="btn btn-primary" style="font-size:10px;padding:4px 8px" data-id="${g._id}">Checkout</button>` : `<button class="act-btn del" data-id="${g._id}">✕</button>`}
            </td>
        </tr>`;
    });
    
    tb.innerHTML = html;
    document.getElementById('gInSosta').textContent = inSosta;
    document.getElementById('gIncContanti').textContent = fEur(incContanti);
    document.getElementById('gIncPos').textContent = fEur(incPos);
    
    // Aggiorniamo anche la cassa principale
    renderCassa();
}

async function addGiornaliero() {
    const msg = document.getElementById('gMsg');
    const vettura = document.getElementById('gVettura').value.trim().toUpperCase();
    const targa = document.getElementById('gTarga').value.trim().toUpperCase();
    const telefono = document.getElementById('gTel').value.trim();
    let orarioIn = document.getElementById('gArrivo').value;
    
    if (!orarioIn) {
        const d = new Date();
        orarioIn = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    if (!vettura || !targa || !telefono) { 
        msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Compila Vettura, Targa e Telefono!'; return; 
    }

    const obj = { 
        dataIn: fmtDI(new Date()), orarioIn: orarioIn, 
        vettura, targa, telefono, 
        status: 'IN', pagamento: '', dataOut: '', orarioOut: '', prezzoFinale: 0 
    };

    try {
        const docRef = await fsAddDoc(fsCollection(db, "giornalieri"), obj);
        obj._id = docRef.id;
        state.giornDB.push(obj);
        
        document.getElementById('gVettura').value = ''; 
        document.getElementById('gTarga').value = ''; 
        document.getElementById('gTel').value = ''; 
        document.getElementById('gArrivo').value = '';
        
        msg.style.color = 'var(--grn)'; msg.textContent = 'Ingresso registrato!'; 
        setTimeout(() => msg.textContent = '', 2000);
        renderGiornalieri();
    } catch (e) { alert("Errore connessione Cloud"); }
}

async function checkoutGiornaliero(id) {
    const g = state.giornDB.find(x => x._id === id); if (!g) return;

    const now = new Date();
    const dataUscita = fmtDI(now);
    const nowTime = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    // Step 1: modal conferma orario + prezzo
    const step1 = await _mostraModalCheckout(g, nowTime, dataUscita);
    if (!step1) return;

    // Step 2: modal pagamento
    const pag = await richiediPagamento(step1.prezzo, g.vettura + ' ' + g.targa, id);
    if (!pag) return;

    try {
        await fsUpdateDoc(fsDoc(db, "giornalieri", id), {
            status: 'OUT', pagamento: pag.mod, dataOut: dataUscita,
            orarioOut: step1.orarioOut, prezzoFinale: pag.prezzoFinale, ...pag.meta
        });
        g.status = 'OUT'; g.pagamento = pag.mod; g.dataOut = dataUscita;
        g.orarioOut = step1.orarioOut; g.prezzoFinale = pag.prezzoFinale;
        renderGiornalieri();
    } catch (e) { alert("Errore salvataggio."); }
}

function _mostraModalCheckout(g, nowTime, dataUscita) {
    return new Promise(resolve => {
        const prezzoCalcolato = calcPrezzoGiornaliero(g.orarioIn, g.dataIn, nowTime, dataUscita);
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px';
        overlay.innerHTML = `
            <div style="background:var(--bg2);border-radius:var(--r);padding:20px;width:100%;max-width:340px;box-shadow:0 12px 40px rgba(0,0,0,.5)">
                <div style="font:700 15px var(--f);margin-bottom:4px">🅿️ Checkout</div>
                <div style="font:400 12px var(--f);color:var(--tx2);margin-bottom:16px"><strong>${esc(g.vettura)}</strong> ${esc(g.targa)} — entrato ${g.orarioIn}</div>
                <div style="display:flex;gap:10px;margin-bottom:12px">
                    <div class="ff" style="flex:1"><label style="font:600 11px var(--f);color:var(--tx2);display:block;margin-bottom:4px">Orario uscita</label>
                        <input id="_coOra" type="time" value="${nowTime}" style="width:100%;background:var(--bg3);border:1px solid var(--brd);color:var(--tx);padding:7px 10px;border-radius:var(--r2);font:500 13px var(--mono);outline:0"></div>
                    <div class="ff" style="flex:1"><label style="font:600 11px var(--f);color:var(--tx2);display:block;margin-bottom:4px">Importo €</label>
                        <input id="_coPrezzo" type="number" step="1" value="${prezzoCalcolato}" style="width:100%;background:var(--bg3);border:1px solid var(--brd);color:var(--tx);padding:7px 10px;border-radius:var(--r2);font:600 14px var(--mono);outline:0"></div>
                </div>
                <div style="display:flex;gap:8px">
                    <button id="_coAnn" class="btn" style="flex:1;color:var(--tx3)">Annulla</button>
                    <button id="_coOk" class="btn btn-primary" style="flex:2">Avanti →</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        // Ricalcola prezzo live se cambia orario
        overlay.querySelector('#_coOra').addEventListener('change', e => {
            const p = calcPrezzoGiornaliero(g.orarioIn, g.dataIn, e.target.value, dataUscita);
            overlay.querySelector('#_coPrezzo').value = p;
        });

        overlay.querySelector('#_coAnn').addEventListener('click', () => { overlay.remove(); resolve(null); });
        overlay.querySelector('#_coOk').addEventListener('click', () => {
            const orarioOut = overlay.querySelector('#_coOra').value;
            const prezzo = parseFloat(overlay.querySelector('#_coPrezzo').value) || 0;
            overlay.remove();
            resolve({ orarioOut, prezzo });
        });
    });
}

async function delGiornaliero(id) {
    const g = state.giornDB.find(x => x._id === id); if (!g) return;
    const motivazione = prompt(`⚠️ Stai per ELIMINARE il parcheggio giornaliero di ${g.vettura} (Targa: ${g.targa}).\nInserisci il MOTIVO della cancellazione (OBBLIGATORIO):`);
    if (motivazione === null || motivazione.trim() === '') { alert("❌ Cancellazione annullata: motivazione mancante."); return; }
    
    try {
        await logDelete('PARCHEGGIO A ORE', `Vettura: ${g.vettura} - Targa: ${g.targa} - Ingresso: ${g.dataIn} ${g.orarioIn}`, motivazione.trim());
        await fsDeleteDoc(fsDoc(db, "giornalieri", id));
        state.giornDB = state.giornDB.filter(x => x._id !== id);
        renderGiornalieri();
    } catch (e) { alert("Errore Cloud"); }
}
