import { db, fsCollection, fsAddDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI } from '../utils.js';
import { logDelete } from './log.js';

export function initCassa() {
    const cassaData = document.getElementById('cassaData');
    if (cassaData) {
        cassaData.addEventListener('change', renderCassa);
        const oggiBtn = cassaData.nextElementSibling;
        if(oggiBtn && oggiBtn.tagName === 'BUTTON') {
            oggiBtn.addEventListener('click', () => {
                cassaData.value = fmtDI(new Date());
                renderCassa();
            });
        }
    }

    const addUscitaBtn = document.querySelector('#page-cassa .btn-primary');
    if (addUscitaBtn) {
        addUscitaBtn.addEventListener('click', addUscita);
    }

    const uscitaTb = document.getElementById('uscitaTb');
    if (uscitaTb) {
        uscitaTb.addEventListener('click', (e) => {
            const btn = e.target.closest('.del');
            if (btn) {
                const id = btn.getAttribute('data-id');
                if (id) delUscita(id);
            }
        });
    }
}

export function renderCassa() {
    const cassaDataEl = document.getElementById('cassaData');
    if(cassaDataEl && !cassaDataEl.value) cassaDataEl.value = fmtDI(new Date());
    const dStr = cassaDataEl?.value;
    if(!dStr) return;
    const dIta = dStr.split('-').reverse().join('/');
    
    let eC = 0, eP = 0, eB = 0;
    let cLav = 0, cTap = 0, cPar = 0;
    let sospGiorno = 0;
    
    // 1. Prenotazioni (Lavaggi)
    (state.prenDB[dStr] || []).forEach(p => {
        if(p.saldo === 'SOSPESO') {
            sospGiorno += pNum(p.prezzo);
        } else if(p.saldato === 'SI') {
            let imp = pNum(p.prezzo);
            if(p.saldo === 'CONTANTI') eC += imp;
            else if(p.saldo === 'POS') eP += imp;
            else if(p.saldo === 'BONIFICO') eB += imp;
            cLav += imp;
        }
    });

    // 2. Tappezzeria
    state.tapDB.forEach(t => {
        if(t.status === 'OUT' && t.dataOut === dIta) {
            let imp = pNum(t.prezzo);
            let mod = (t.pagamento || '').toUpperCase();
            if(mod === 'SOSPESO' || mod === 'FATTURATO') {
                sospGiorno += imp;
            } else {
                if(mod === 'CONTANTI') eC += imp;
                else if(mod === 'POS') eP += imp;
                else if(mod === 'BONIFICO') eB += imp;
                cTap += imp;
            }
        }
    });

    // 3. Giornalieri (Parcheggio Ore)
    state.giornDB.forEach(g => {
        if(g.status === 'OUT' && g.dataOut === dStr) {
            let imp = pNum(g.prezzoFinale);
            if(g.pagamento === 'CONTANTI') eC += imp;
            else if(g.pagamento === 'POS') eP += imp;
            else if(g.pagamento === 'BONIFICO') eB += imp;
            cPar += imp;
        }
    });

    // 4. Abbonamenti (Parcheggio Abbonati)
    state.localAbb.forEach(a => {
        if(a.PAGAMENTO === 'SI' && a['DATA PAGAMENTO'] === dIta) {
            let imp = pNum(a.IMPORTO);
            let mod = (a["MODALITA'"] || '').toUpperCase();
            if(mod === 'CONTANTI') eC += imp;
            else if(mod === 'POS') eP += imp;
            else if(mod === 'BONIFICO') eB += imp;
            cPar += imp;
        }
    });

    // 5. Sospesi Saldati (pagati oggi)
    state.localSosp.forEach(s => {
        if(s._pagato && s._dataPag === dIta) {
            let imp = pNum(s.importo);
            let mod = (s._modPag || '').toUpperCase();
            if(mod === 'CONTANTI') eC += imp;
            else if(mod === 'POS') eP += imp;
            else if(mod === 'BONIFICO' || mod === 'FATTURA') eB += imp;
            if(s._sid && s._sid.startsWith('PREN-')) cLav += imp;
            else if(s._sid && s._sid.startsWith('TAP-')) cTap += imp;
        }
    });

    // --- Uscite ---
    let uC = 0;
    let uHtml = '';
    let uList = state.usciteDB.filter(u => u.data === dStr);
    uList.sort((a,b) => b.timestamp - a.timestamp);
    
    if(uList.length === 0) {
        uHtml = '<tr><td colspan="5" class="empty">Nessuna uscita registrata oggi</td></tr>';
    } else {
        uList.forEach(u => {
            let imp = pNum(u.importo);
            if(u.metodo === 'CONTANTI') uC += imp;
            uHtml += `<tr><td style="font:400 11px var(--mono)">${u.orario}</td><td><strong>${esc(u.descrizione)}</strong></td><td><span class="badge ${u.metodo==='POS'?'b':'g'}">${esc(u.metodo)}</span></td><td style="font-weight:600; color:var(--red)">-€${imp}</td><td><button class="act-btn del" data-id="${u._id}">✕</button></td></tr>`;
        });
    }

    if(document.getElementById('cassaEntCont')) document.getElementById('cassaEntCont').textContent = fEur(eC);
    if(document.getElementById('cassaEntPos')) document.getElementById('cassaEntPos').textContent = fEur(eP);
    if(document.getElementById('cassaSospGiorno')) document.getElementById('cassaSospGiorno').textContent = fEur(sospGiorno);
    if(document.getElementById('cassaCatLav')) document.getElementById('cassaCatLav').textContent = fEur(cLav);
    if(document.getElementById('cassaCatTap')) document.getElementById('cassaCatTap').textContent = fEur(cTap);
    if(document.getElementById('cassaCatPar')) document.getElementById('cassaCatPar').textContent = fEur(cPar);
    if(document.getElementById('uscitaTb')) document.getElementById('uscitaTb').innerHTML = uHtml;
    if(document.getElementById('cassaNetta')) document.getElementById('cassaNetta').textContent = fEur(eC - uC);
}

async function addUscita() {
    let desc = document.getElementById('uDesc')?.value.trim();
    let imp = document.getElementById('uImp')?.value.trim();
    let mod = document.getElementById('uMod')?.value;
    let dStr = document.getElementById('cassaData')?.value;
    if(!desc || !imp) return alert('Inserisci Descrizione e Importo!');
    let now = new Date();
    let obj = { data: dStr, orario: String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'), timestamp: now.getTime(), descrizione: desc, importo: parseFloat(imp.replace(',', '.')), metodo: mod };
    try {
        const ref = await fsAddDoc(fsCollection(db, "uscite"), obj);
        obj._id = ref.id;
        state.usciteDB.push(obj);
        
        // Scrivi uscita in Prima Nota
        try {
            const dIta = dStr.split('-').reverse().join('/');
            await fsAddDoc(fsCollection(db, "primaNota"), {
                DATA: dIta, dataISO: dStr,
                'CENTRO DI COSTO': 'VARIE', Categoria: 'VARIE',
                'PRIMANOTA CLIENTI/FORNITORI': desc,
                Descrizione: desc,
                ENTRATA: 0, Entrata: 0,
                USCITE: obj.importo, Uscite: obj.importo,
                SOSPESO: 0, Sospeso: 0,
                "MODALITA'": mod, timestamp: Date.now()
            });
        } catch(e) { console.warn("Errore Prima Nota uscita:", e); }
        
        document.getElementById('uDesc').value = ''; document.getElementById('uImp').value = '';
        renderCassa();
    } catch(e) { alert("Errore Cloud"); }
}

async function delUscita(id) {
    let u = state.usciteDB.find(x => x._id === id); if(!u) return;
    const motivazione = prompt(`Eliminare uscita di €${u.importo}?\nMotivo (OBBLIGATORIO):`);
    if(!motivazione) return;
    try {
        await logDelete('USCITE CASSA', `Uscita: ${u.descrizione} - €${u.importo}`, motivazione.trim());
        await fsDeleteDoc(fsDoc(db, "uscite", id));
        state.usciteDB = state.usciteDB.filter(x => x._id !== id);
        renderCassa();
    } catch(e) { alert("Errore Cloud"); }
}
