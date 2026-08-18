import { db, fsCollection, fsAddDoc, fsGetDocs, fsUpdateDoc, fsDeleteDoc, fsDoc, fsSetDoc } from '../firebase-config.js';
import { query, where } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { state } from '../state.js';
import { pNum, fEur, fmtDI, pDate } from '../utils.js';

// ─── CONFIGURAZIONE DIPENDENTI PER SEDE ───
const DIPENDENTI_PER_SEDE = {
    'lungomare': [
        { nome: 'SONY', modalita: 'BONIFICO', importoDefault: 70 },
        { nome: 'CUMAR', modalita: 'BONIFICO', importoDefault: 55 },
        { nome: 'XXX', modalita: 'BONIFICO', importoDefault: 50 },
        { nome: 'PARAM', modalita: 'CONTANTI', importoDefault: 50 },
        { nome: 'HAPPY', modalita: 'CONTANTI', importoDefault: 45 },
        { nome: 'SHENTER', modalita: 'CONTANTI', importoDefault: 45 },
        { nome: 'MENTA', modalita: 'BONIFICO', importoDefault: 0 }
    ],
    'paesi-etnei': [
        { nome: 'ROCKY', modalita: 'BONIFICO', importoDefault: 0 },
        { nome: 'MINTA', modalita: 'CONTANTI', importoDefault: 0 }
    ]
};

function getDipendenti() {
    return DIPENDENTI_PER_SEDE[state.sedeAttiva] || DIPENDENTI_PER_SEDE['lungomare'];
}

let currentWeekStart = null;
// Mese/anno mostrati nel riepilogo mensile (navigabili con ◀ ▶)
let riepMese = new Date().getMonth();
let riepAnno = new Date().getFullYear();
let presenzeLocali = []; // cache locale delle presenze caricate
let accontiLocali = {}; // nome → importo residuo (anticipi su stipendio, collection `acconti`)

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

    // Navigazione mese del riepilogo (per vedere anche i mesi passati)
    document.getElementById('prezMesePrev')?.addEventListener('click', () => {
        riepMese--;
        if (riepMese < 0) { riepMese = 11; riepAnno--; }
        renderRiepilogoMensile(riepMese, riepAnno);
    });
    document.getElementById('prezMeseNext')?.addEventListener('click', () => {
        riepMese++;
        if (riepMese > 11) { riepMese = 0; riepAnno++; }
        renderRiepilogoMensile(riepMese, riepAnno);
    });

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
    // Lungomare: lun-sab. Paesi Etnei: lun-dom (self-service aperto 7/7).
    const nGiorni = state.sedeAttiva === 'paesi-etnei' ? 7 : 6;
    const days = [];
    for (let i = 0; i < nGiorni; i++) {
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
    container.innerHTML = getDipendenti().map(dip =>
        `<div class="ff" style="width:70px">
            <label>${dip.nome}</label>
            <input type="number" step="1" id="prez_${dip.nome.replace(/\s+/g, '_')}" placeholder="${dip.importoDefault}" style="text-align:center">
        </div>`
    ).join('');
}

// ─── CARICA PRESENZE DA FIRESTORE ───
async function caricaPresenze() {
    try {
        const snap = await fsGetDocs(query(fsCollection(db, 'presenzeDipendenti'), where('sedeId', '==', state.sedeAttiva)));
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

    // Acconti: try separato — se la collection non è leggibile le presenze restano ok
    try {
        const snapA = await fsGetDocs(query(fsCollection(db, 'acconti'), where('sedeId', '==', state.sedeAttiva)));
        accontiLocali = {};
        snapA.forEach(docSnap => {
            const a = docSnap.data();
            if (pNum(a.importo) > 0) accontiLocali[a.nome] = pNum(a.importo);
        });
    } catch (e) {
        console.warn('Errore caricamento acconti:', e);
    }
}

// ─── TROVA PRESENZE PER DATA (formato YYYY-MM-DD) ───
function getPresenzaByDate(dataISO) {
    return presenzeLocali.find(p => p.dataISO === dataISO);
}

// ─── RENDER PAGINA PRESENZE ───
export async function renderPresenze() {
    if (!currentWeekStart) currentWeekStart = getMonday(new Date());

    // Rigenera i campi input: i dipendenti dipendono dalla sede attiva
    renderInputFields();

    await caricaPresenze();

    const days = getWeekDays(currentWeekStart);
    const endWeek = new Date(days[days.length - 1]);

    // Label settimana
    const label = document.getElementById('prezWeekLabel');
    if (label) {
        const d1 = days[0], d2 = days[days.length - 1];
        label.textContent = `${d1.getDate()}/${d1.getMonth() + 1} — ${d2.getDate()}/${d2.getMonth() + 1}/${d2.getFullYear()}`;
    }

    const dipendenti = getDipendenti();

    // Header tabella
    const thead = document.getElementById('prezTHead');
    if (thead) {
        thead.innerHTML = `<tr>
            <th style="width:90px">Giorno</th>
            ${dipendenti.map(d => `<th style="text-align:center;min-width:60px">${d.nome}<br><span style="font-weight:400;font-size:7px;color:var(--tx3)">${d.modalita === 'BONIFICO' ? '🏦' : '💵'}</span></th>`).join('')}
            <th style="text-align:center">Totale</th>
            <th style="width:60px"></th>
        </tr>`;
    }

    // Body tabella
    const tbody = document.getElementById('prezTBody');
    if (!tbody) return;

    let totSettimanale = 0;
    let totPerDip = {};
    dipendenti.forEach(d => totPerDip[d.nome] = 0);

    let html = '';
    const oggi = fmtDI(new Date());

    days.forEach(day => {
        const dataISO = fmtDI(day);
        const giorno = GIORNI_S[day.getDay()];
        const isOggi = dataISO === oggi;
        const isDomenica = day.getDay() === 0;

        // Domenica esclusa solo a Lungomare (Paesi Etnei apre 7/7)
        if (isDomenica && state.sedeAttiva !== 'paesi-etnei') return;

        const presenza = getPresenzaByDate(dataISO);
        let totGiorno = 0;

        const cells = dipendenti.map(dip => {
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
            ${dipendenti.map(d => `<td style="text-align:center;font:700 12px var(--mono);color:var(--red)">${totPerDip[d.nome] > 0 ? '€' + totPerDip[d.nome] : '—'}</td>`).join('')}
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

    // Riepilogo mensile per dipendente (mese navigabile con ◀ ▶)
    renderRiepilogoMensile(riepMese, riepAnno);

    // Listener elimina
    tbody.querySelectorAll('.del-prez').forEach(btn => {
        btn.addEventListener('click', () => eliminaPresenza(btn.dataset.date));
    });
}

// ─── RIEPILOGO MENSILE ───
function renderRiepilogoMensile(mese, anno) {
    const tb = document.getElementById('prezRiepilogoTb');
    if (!tb) return;

    const lbl = document.getElementById('prezMeseLabel');
    if (lbl) {
        const mesiS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
        lbl.textContent = `${mesiS[mese]} ${anno}`;
    }

    const dipendenti = getDipendenti();
    const totDip = {};
    const giorniDip = {};
    dipendenti.forEach(d => { totDip[d.nome] = 0; giorniDip[d.nome] = 0; });

    // Include anche dipendenti non più in organico ma presenti nei record
    // del mese (es. Sebastiano nei mesi prima di luglio 2026)
    const exDipendenti = [];
    presenzeLocali.forEach(p => {
        const d = p.dataISO ? new Date(p.dataISO) : null;
        if (!d || d.getMonth() !== mese || d.getFullYear() !== anno) return;
        if (!p.dettaglio) return;
        for (const [nome, val] of Object.entries(p.dettaglio)) {
            if (totDip[nome] === undefined) {
                totDip[nome] = 0;
                giorniDip[nome] = 0;
                exDipendenti.push(nome);
            }
            totDip[nome] += pNum(val);
            if (pNum(val) > 0) giorniDip[nome]++;
        }
    });

    const mesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
    let totGenerale = 0;

    const righe = [
        ...dipendenti.map(d => ({ nome: d.nome, mod: d.modalita === 'BONIFICO' ? '<span class="badge b">🏦 Bonifico</span>' : '<span class="badge g">💵 Contanti</span>' })),
        ...exDipendenti.sort().map(n => ({ nome: n, mod: '<span class="badge" title="Non più in organico">👋 ex</span>' })),
    ];

    // "Da pagare" = giornate NON marcate pagate su TUTTO lo storico (il
    // pagamento è a quindicina, può stare a cavallo di più mesi)
    const daPagare = {};
    presenzeLocali.forEach(p => {
        if (!p.dettaglio) return;
        for (const [nome, val] of Object.entries(p.dettaglio)) {
            const v = pNum(val);
            if (v <= 0) continue;
            if (p.pagati && p.pagati[nome]) continue; // già saldata
            daPagare[nome] = (daPagare[nome] || 0) + v;
        }
    });

    tb.innerHTML = righe.map(dip => {
        totGenerale += totDip[dip.nome];
        const dovuto = daPagare[dip.nome] || 0;
        const acconto = accontiLocali[dip.nome] || 0;
        const netto = dovuto - acconto; // >0 = da versare, <0 = resta in acconto
        let cellaPagare;
        if (dovuto <= 0) {
            cellaPagare = acconto > 0
                ? `<span style="color:var(--grn)">✓ in acconto ${fEur(acconto)}</span>`
                : `<span style="color:var(--grn)">✓ saldato</span>`;
        } else if (netto > 0) {
            cellaPagare = `<span style="color:var(--amb)">${fEur(netto)}</span>` +
                (acconto > 0 ? `<br><span style="font:400 9px var(--f);color:var(--tx3)">−${fEur(acconto)} acconto</span>` : '');
        } else {
            cellaPagare = `<span style="color:var(--grn)">✓ coperto da acconto${netto < 0 ? ` (resta ${fEur(-netto)})` : ''}</span>`;
        }
        return `<tr>
            <td><strong>${dip.nome}</strong></td>
            <td>${dip.mod}</td>
            <td style="text-align:center">${giorniDip[dip.nome]}</td>
            <td style="font:700 13px var(--f);color:var(--red)">${fEur(totDip[dip.nome])}</td>
            <td style="font:700 13px var(--f)">${cellaPagare}</td>
            <td style="white-space:nowrap">${dovuto > 0 ? `<button class="btn btn-paga-dip" data-nome="${dip.nome}" style="font-size:10px;padding:3px 10px;background:var(--grn1);border-color:var(--grn);color:var(--grn)">💰 Segna pagato</button> ` : ''}<button class="btn btn-acconto-dip" data-nome="${dip.nome}" title="Registra/modifica acconto (anticipo su stipendio)" style="font-size:10px;padding:3px 8px">💶</button></td>
        </tr>`;
    }).join('');

    tb.innerHTML += `<tr style="background:var(--bg4)">
        <td colspan="2"><strong>TOTALE ${mesi[mese].toUpperCase()} ${anno}</strong></td>
        <td></td>
        <td style="font:700 14px var(--f);color:var(--red)">${fEur(totGenerale)}</td>
        <td colspan="2"></td>
    </tr>`;

    tb.querySelectorAll('.btn-paga-dip').forEach(btn => {
        btn.addEventListener('click', () => segnaPagatoDipendente(btn.dataset.nome));
    });
    tb.querySelectorAll('.btn-acconto-dip').forEach(btn => {
        btn.addEventListener('click', () => impostaAcconto(btn.dataset.nome));
    });
}

// Registra/modifica un acconto (anticipo su giornate future non ancora inserite).
// Salvato in `acconti/{sedeId}_{nome}`; viene scalato al prossimo "Segna pagato".
async function impostaAcconto(nome) {
    const attuale = accontiLocali[nome] || 0;
    const inp = prompt(`Acconto per ${nome} (anticipo su stipendio).\nImporto attuale: €${attuale}\n\nInserisci il nuovo importo (0 per azzerare):`, attuale || '');
    if (inp === null) return;
    const val = parseFloat(String(inp).replace(',', '.'));
    if (isNaN(val) || val < 0) { alert('Importo non valido'); return; }
    try {
        await fsSetDoc(fsDoc(db, 'acconti', `${state.sedeAttiva}_${nome}`), {
            nome,
            sedeId: state.sedeAttiva,
            importo: val,
            aggiornato: new Date().toLocaleDateString('it-IT')
        }, { merge: true });
        if (val > 0) accontiLocali[nome] = val; else delete accontiLocali[nome];
        renderRiepilogoMensile(riepMese, riepAnno);
    } catch (e) {
        alert('Errore salvataggio acconto: ' + (e?.message || e));
    }
}

// Quindicina: marca come PAGATE tutte le giornate non saldate del dipendente
// (su tutto lo storico), con la data odierna. Il "Da pagare" torna a zero.
async function segnaPagatoDipendente(nome) {
    const daSaldare = presenzeLocali.filter(p =>
        p.dettaglio && pNum(p.dettaglio[nome]) > 0 && !(p.pagati && p.pagati[nome])
    );
    if (!daSaldare.length) return;
    const totale = daSaldare.reduce((s, p) => s + pNum(p.dettaglio[nome]), 0);
    const prima = daSaldare.map(p => p.dataISO).sort()[0].split('-').reverse().join('/');
    const acconto = accontiLocali[nome] || 0;
    const daVersare = Math.max(0, totale - acconto);
    const rigaAcconto = acconto > 0
        ? `\nAcconto scalato: ${fEur(Math.min(acconto, totale))} → da versare ${fEur(daVersare)}`
        : '';
    if (!confirm(`Segnare PAGATO ${nome}?\n${daSaldare.length} giornate dal ${prima} — totale ${fEur(totale)}${rigaAcconto}`)) return;

    const oggi = new Date().toLocaleDateString('it-IT');
    for (const p of daSaldare) {
        if (!p._id) continue;
        const pagati = { ...(p.pagati || {}), [nome]: oggi };
        try {
            await fsUpdateDoc(fsDoc(db, 'presenzeDipendenti', p._id), { pagati });
            p.pagati = pagati;
        } catch (e) { console.warn('segna pagato fallito', p.dataISO, e?.message); }
    }

    // Consuma l'acconto sulle giornate appena saldate
    if (acconto > 0) {
        const residuo = Math.max(0, acconto - totale);
        try {
            await fsSetDoc(fsDoc(db, 'acconti', `${state.sedeAttiva}_${nome}`), {
                nome,
                sedeId: state.sedeAttiva,
                importo: residuo,
                aggiornato: oggi
            }, { merge: true });
            if (residuo > 0) accontiLocali[nome] = residuo; else delete accontiLocali[nome];
        } catch (e) { console.warn('aggiornamento acconto fallito', e?.message); }
    }
    renderRiepilogoMensile(riepMese, riepAnno);
}

// ─── SALVA PRESENZA GIORNATA ───
async function salvaPresenza() {
    const msg = document.getElementById('prezMsg');
    const dataInput = document.getElementById('prezData');
    if (!dataInput?.value) { if (msg) { msg.style.color = 'var(--red)'; msg.textContent = '⚠️ Seleziona una data!'; } return; }

    const dataISO = dataInput.value;
    const dataIta = dataISO.split('-').reverse().join('/');

    // Raccogli importi
    const dipendenti = getDipendenti();
    const dettaglio = {};
    let costoTotale = 0;
    dipendenti.forEach(dip => {
        const input = document.getElementById(`prez_${dip.nome.replace(/\s+/g, '_')}`);
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
            timestamp: Date.now(),
            sedeId: state.sedeAttiva
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
        dipendenti.forEach(dip => {
            const input = document.getElementById(`prez_${dip.nome.replace(/\s+/g, '_')}`);
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
