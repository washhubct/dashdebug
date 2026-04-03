import { db, fsCollection, fsAddDoc, fsGetDocs, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, fmtDI, pDate } from '../utils.js';

// ─── CONFIGURAZIONE DIPENDENTI ───
const DIPENDENTI = [
    { nome: 'SONY', modalita: 'BONIFICO', importoDefault: 70 },
    { nome: 'CUMAR', modalita: 'BONIFICO', importoDefault: 55 },
    { nome: 'XXX', modalita: 'BONIFICO', importoDefault: 50 },
    { nome: 'PARAM', modalita: 'CONTANTI', importoDefault: 50 },
    { nome: 'HAPPY', modalita: 'CONTANTI', importoDefault: 45 },
    { nome: 'SHENTER', modalita: 'CONTANTI', importoDefault: 45 },
    { nome: 'MENTA', modalita: 'BONIFICO', importoDefault: 0 }
];

let currentWeekStart = null;
let presenzeLocali = []; // cache locale delle presenze caricate

// ─── INIT ───
export function initPresenze() {
    // Setta la settimana corrente (lunedì)
    const oggi = new Date();
    currentWeekStart = getMonday(oggi);

    document.getElementById('prezSetPrev')?.addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        renderPresenze();
    });
    document.getElementById('prezSetNext')?.addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        renderPresenze();
    });
    document.getElementById('prezOggi')?.addEventListener('click', () => {
        currentWeekStart = getMonday(new Date());
        renderPresenze();
    });
    document.getElementById('prezSaveBtn')?.addEventListener('click', salvaPresenza);

    // Setta data di oggi nel form
    const prezData = document.getElementById('prezData');
    if (prezData) prezData.value = fmtDI(oggi);

    // Genera campi input per ogni dipendente
    renderInputFields();
}

function getMonday(d) {
    const dt = new Date(d);
    const day = dt.getDay();
    const diff = day === 0 ? -6 : 1 - day; // lunedì = 1
    dt.setDate(dt.getDate() + diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

function getWeekDays(monday) {
    const days = [];
    for (let i = 0; i < 6; i++) { // lun-sab
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        days.push(d);
    }
    return days;
}

const GIORNI_S = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

// ─── GENERA CAMPI INPUT DIPENDENTI ───
function renderInputFields() {
    const container = document.getElementById('prezInputFields');
    if (!container) return;
    container.innerHTML = DIPENDENTI.map(dip =>
        `<div class="ff" style="width:70px">
            <label>${dip.nome}</label>
            <input type="number" step="1" id="prez_${dip.nome}" placeholder="${dip.importoDefault}" style="text-align:center">
        </div>`
    ).join('');
}

// ─── CARICA PRESENZE DA FIRESTORE ───
async function caricaPresenze() {
    try {
        const snap = await fsGetDocs(fsCollection(db, 'presenzeDipendenti'));
        presenzeLocali = [];
        snap.forEach(docSnap => {
            const d = docSnap.data();
            d._id = docSnap.id;
            presenzeLocali.push(d);
        });
        // Aggiorna anche state per la dashboard
        state.presenzeDB = [...presenzeLocali];
    } catch (e) {
        console.warn('Errore caricamento presenze:', e);
    }
}

// ─── TROVA PRESENZE PER DATA (formato YYYY-MM-DD) ───
function getPresenzaByDate(dataISO) {
    return presenzeLocali.find(p => p.dataISO === dataISO);
}

// ─── RENDER PAGINA PRESENZE ───
export async function renderPresenze() {
    if (!currentWeekStart) currentWeekStart = getMonday(new Date());
    
    await caricaPresenze();

    const days = getWeekDays(currentWeekStart);
    const endWeek = new Date(days[days.length - 1]);

    // Label settimana
    const label = document.getElementById('prezWeekLabel');
    if (label) {
        const d1 = days[0], d2 = days[5];
        label.textContent = `${d1.getDate()}/${d1.getMonth() + 1} — ${d2.getDate()}/${d2.getMonth() + 1}/${d2.getFullYear()}`;
    }

    // Header tabella
    const thead = document.getElementById('prezTHead');
    if (thead) {
        thead.innerHTML = `<tr>
            <th style="width:90px">Giorno</th>
            ${DIPENDENTI.map(d => `<th style="text-align:center;min-width:60px">${d.nome}<br><span style="font-weight:400;font-size:7px;color:var(--tx3)">${d.modalita === 'BONIFICO' ? '🏦' : '💵'}</span></th>`).join('')}
            <th style="text-align:center">Totale</th>
            <th style="width:60px"></th>
        </tr>`;
    }

    // Body tabella
    const tbody = document.getElementById('prezTBody');
    if (!tbody) return;

    let totSettimanale = 0;
    let totPerDip = {};
    DIPENDENTI.forEach(d => totPerDip[d.nome] = 0);

    let html = '';
    const oggi = fmtDI(new Date());

    days.forEach(day => {
        const dataISO = fmtDI(day);
        const giorno = GIORNI_S[day.getDay()];
        const isOggi = dataISO === oggi;
        const isDomenica = day.getDay() === 0;
        
        if (isDomenica) return; // skip domenica

        const presenza = getPresenzaByDate(dataISO);
        let totGiorno = 0;

        const cells = DIPENDENTI.map(dip => {
            const val = presenza?.dettaglio?.[dip.nome] || 0;
            totGiorno += val;
            totPerDip[dip.nome] += val;
            
            if (val > 0) {
                return `<td style="text-align:center;font:600 12px var(--mono);color:var(--tx)">${val}</td>`;
            } else if (presenza) {
                return `<td style="text-align:center;color:var(--tx3)">—</td>`;
            } else {
                return `<td style="text-align:center;color:var(--brd)">·</td>`;
            }
        }).join('');

        totSettimanale += totGiorno;

        const rowStyle = isOggi ? 'background:var(--yel1)' : '';
        const hasData = !!presenza;

        html += `<tr style="${rowStyle}">
            <td style="font:500 11px var(--mono)">${giorno} ${day.getDate()}/${day.getMonth() + 1}${isOggi ? ' <span class="badge g" style="font-size:7px">OGGI</span>' : ''}</td>
            ${cells}
            <td style="text-align:center;font:700 12px var(--f);color:${totGiorno > 0 ? 'var(--red)' : 'var(--tx3)'}">${totGiorno > 0 ? '€' + totGiorno : '—'}</td>
            <td>${hasData ? `<button class="act-btn del del-prez" data-date="${dataISO}" title="Elimina presenze di questa giornata">✕</button>` : ''}</td>
        </tr>`;
    });

    tbody.innerHTML = html;

    // Footer con totali
    const tfoot = document.getElementById('prezTFoot');
    if (tfoot) {
        tfoot.innerHTML = `<tr style="background:var(--bg4);font-weight:700">
            <td style="font:700 11px var(--mono)">TOTALE</td>
            ${DIPENDENTI.map(d => `<td style="text-align:center;font:700 12px var(--mono);color:var(--red)">${totPerDip[d.nome] > 0 ? '€' + totPerDip[d.nome] : '—'}</td>`).join('')}
            <td style="text-align:center;font:700 14px var(--f);color:var(--red)">€${totSettimanale}</td>
            <td></td>
        </tr>`;
    }

    // KPI
    const kpiSett = document.getElementById('prezKpiSett');
    if (kpiSett) kpiSett.textContent = fEur(totSettimanale);

    const giorniLavorati = days.filter(d => getPresenzaByDate(fmtDI(d))).length;
    const kpiGiorni = document.getElementById('prezKpiGiorni');
    if (kpiGiorni) kpiGiorni.textContent = giorniLavorati;

    // Costo mese corrente
    const meseCorrente = new Date().getMonth();
    const annoCorrente = new Date().getFullYear();
    let costoMese = 0;
    presenzeLocali.forEach(p => {
        const d = p.dataISO ? new Date(p.dataISO) : null;
        if (d && d.getMonth() === meseCorrente && d.getFullYear() === annoCorrente) {
            costoMese += pNum(p.costoTotale);
        }
    });
    const kpiMese = document.getElementById('prezKpiMese');
    if (kpiMese) kpiMese.textContent = fEur(costoMese);

    // Riepilogo mensile per dipendente
    renderRiepilogoMensile(meseCorrente, annoCorrente);

    // Listener elimina
    tbody.querySelectorAll('.del-prez').forEach(btn => {
        btn.addEventListener('click', () => eliminaPresenza(btn.dataset.date));
    });
}

// ─── RIEPILOGO MENSILE ───
function renderRiepilogoMensile(mese, anno) {
    const tb = document.getElementById('prezRiepilogoTb');
    if (!tb) return;

    const totDip = {};
    const giorniDip = {};
    DIPENDENTI.forEach(d => { totDip[d.nome] = 0; giorniDip[d.nome] = 0; });

    presenzeLocali.forEach(p => {
        const d = p.dataISO ? new Date(p.dataISO) : null;
        if (!d || d.getMonth() !== mese || d.getFullYear() !== anno) return;
        if (!p.dettaglio) return;
        for (const [nome, val] of Object.entries(p.dettaglio)) {
            if (totDip[nome] !== undefined) {
                totDip[nome] += pNum(val);
                if (pNum(val) > 0) giorniDip[nome]++;
            }
        }
    });

    const mesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    let totGenerale = 0;

    tb.innerHTML = DIPENDENTI.map(dip => {
        totGenerale += totDip[dip.nome];
        const mod = dip.modalita === 'BONIFICO' ? '<span class="badge b">🏦 Bonifico</span>' : '<span class="badge g">💵 Contanti</span>';
        return `<tr>
            <td><strong>${dip.nome}</strong></td>
            <td>${mod}</td>
            <td style="text-align:center">${giorniDip[dip.nome]}</td>
            <td style="font:700 13px var(--f);color:var(--red)">${fEur(totDip[dip.nome])}</td>
        </tr>`;
    }).join('');

    tb.innerHTML += `<tr style="background:var(--bg4)">
        <td colspan="2"><strong>TOTALE ${mesi[mese].toUpperCase()} ${anno}</strong></td>
        <td></td>
        <td style="font:700 14px var(--f);color:var(--red)">${fEur(totGenerale)}</td>
    </tr>`;
}

// ─── SALVA PRESENZA GIORNATA ───
async function salvaPresenza() {
    const msg = document.getElementById('prezMsg');
    const dataInput = document.getElementById('prezData');
    if (!dataInput?.value) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Seleziona una data!'; } return; }

    const dataISO = dataInput.value;
    const dataIta = dataISO.split('-').reverse().join('/');

    // Raccogli importi
    const dettaglio = {};
    let costoTotale = 0;
    DIPENDENTI.forEach(dip => {
        const input = document.getElementById(`prez_${dip.nome}`);
        const val = input ? parseFloat(input.value) || 0 : 0;
        dettaglio[dip.nome] = val;
        costoTotale += val;
    });

    if (costoTotale === 0) {
        if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Inserisci almeno un importo!'; }
        return;
    }

    // Controlla se esiste già una presenza per questa data
    const esistente = getPresenzaByDate(dataISO);

    try {
        const record = {
            dataISO: dataISO,
            data: dataIta,
            dettaglio: dettaglio,
            costoTotale: costoTotale,
            timestamp: Date.now()
        };

        if (esistente && esistente._id) {
            // Aggiorna
            await fsUpdateDoc(fsDoc(db, 'presenzeDipendenti', esistente._id), record);
            if (msg) { msg.style.color = 'var(--grn)'; msg.textContent = `✅ Presenze ${dataIta} aggiornate!`; }
        } else {
            // Crea nuovo
            await fsAddDoc(fsCollection(db, 'presenzeDipendenti'), record);
            if (msg) { msg.style.color = 'var(--grn)'; msg.textContent = `✅ Presenze ${dataIta} salvate!`; }
        }

        // Pulisci i campi
        DIPENDENTI.forEach(dip => {
            const input = document.getElementById(`prez_${dip.nome}`);
            if (input) input.value = '';
        });

        setTimeout(() => { if (msg) msg.textContent = ''; }, 2500);
        renderPresenze();
    } catch (e) {
        console.error('Errore salvataggio presenze:', e);
        if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Errore salvataggio!'; }
    }
}

// ─── ELIMINA PRESENZA ───
async function eliminaPresenza(dataISO) {
    const presenza = getPresenzaByDate(dataISO);
    if (!presenza || !presenza._id) return;
    if (!confirm(`Eliminare le presenze del ${dataISO.split('-').reverse().join('/')}?`)) return;

    try {
        await fsDeleteDoc(fsDoc(db, 'presenzeDipendenti', presenza._id));
        renderPresenze();
    } catch (e) {
        console.error('Errore eliminazione presenze:', e);
        alert('Errore eliminazione!');
    }
}
