import { db, fsCollection, fsAddDoc, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI } from '../utils.js';
import { logDelete } from './log.js';
import { renderCassa } from './cassa.js';

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
    let start = new Date(dataIn + 'T' + oraIn);
    let end = new Date(dataOut + 'T' + oraOut);
    let diffMs = end - start;
    if (diffMs <= 0) return 0;
    
    let diffMinuti = Math.floor(diffMs / (1000 * 60));
    // Sottraiamo 15 min di tolleranza
    let oreDaPagare = Math.ceil(Math.max(0, diffMinuti - 15) / 60);

    if (oreDaPagare === 0 && diffMinuti > 0) oreDaPagare = 1;

    let giorni = Math.floor(oreDaPagare / 24);
    let restoOre = oreDaPagare % 24;

    let extra = 0;
    if (restoOre <= 0) extra = 0;
    else if (restoOre <= 5) extra = restoOre * 2; 
    else if (restoOre <= 12) extra = 10;          
    else extra = 20;                             

    return (giorni * 20) + extra;
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
    const orarioUscitaSuggerito = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const dataUscita = fmtDI(now);
    
    const orarioOut = prompt(`Orario di uscita per ${g.vettura} (Targa: ${g.targa})?`, orarioUscitaSuggerito);
    if (orarioOut === null) return;

    const prezzoCalcolato = calcPrezzoGiornaliero(g.orarioIn, g.dataIn, orarioOut, dataUscita);
    
    let importoConfermato = prompt(`Importo calcolato dal sistema (tolleranza 15m inclusa): €${prezzoCalcolato}\n\nConferma l'importo o digitalo manualmente se vuoi cambiarlo:`, prezzoCalcolato);
    if (importoConfermato === null) return;
    
    const prezzoFinale = parseFloat(importoConfermato.replace(',', '.')) || 0;

    let modPagamento = prompt(`Incasso finale: €${prezzoFinale}\nInserisci metodo di pagamento (CONTANTI o POS):`, "CONTANTI");
    if (modPagamento === null) return;
    modPagamento = modPagamento.trim().toUpperCase();
    if (modPagamento !== 'CONTANTI' && modPagamento !== 'POS') modPagamento = 'CONTANTI';

    try {
        await fsUpdateDoc(fsDoc(db, "giornalieri", id), { 
            status: 'OUT', pagamento: modPagamento, dataOut: dataUscita, orarioOut: orarioOut, prezzoFinale: prezzoFinale 
        });
        g.status = 'OUT'; g.pagamento = modPagamento; g.dataOut = dataUscita; g.orarioOut = orarioOut; g.prezzoFinale = prezzoFinale;
        renderGiornalieri();
    } catch (e) { alert("Errore di connessione al Cloud durante il salvataggio."); }
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
