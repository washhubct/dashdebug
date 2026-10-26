import { db, fsCollection, fsAddDoc, fsGetDocs, fsUpdateDoc, fsDeleteDoc, fsDoc, fsSetDoc } from '../firebase-config.js';
import { query, where } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { state } from '../state.js';
import { pNum, fEur, fmtDI, pDate } from '../utils.js';

// ─── CONFIGURAZIONE DIPENDENTI PER SEDE ───
export const DIPENDENTI_PER_SEDE = {
    'lungomare': [
        // SONY: dal 01/09/2026 a stipendio fisso (vedi DIPENDENTI_FISSI), non più a giornata
        // PARAM: uscito dall'organico il 14/09/2026 (storico e "da pagare" restano visibili come ex)
        { nome: 'CUMAR', modalita: 'BONIFICO', importoDefault: 55 },
        { nome: 'XXX', modalita: 'BONIFICO', importoDefault: 50 },
        { nome: 'HAPPY', modalita: 'CONTANTI', importoDefault: 45 },
        // SHENTER: uscito dall'organico il 26/10/2026 (storico e "da pagare" restano visibili come ex)
        { nome: 'MENTA', modalita: 'BONIFICO', importoDefault: 0 }
    ],
    'paesi-etnei': [
        { nome: 'ROCKY', modalita: 'BONIFICO', importoDefault: 0 },
        { nome: 'MINTA', modalita: 'CONTANTI', importoDefault: 0 }
    ]
};

// Dipendenti a stipendio fisso mensile: niente presenze giornaliere, il costo
// entra nel report pro-rata dal giorno `dal` (report.js costiFissi).
export const DIPENDENTI_FISSI = {
    'lungomare': [
        { nome: 'SONY', modalita: 'BONIFICO', mensile: 1700, dal: '2026-09-01' },
    ],
    'paesi-etnei': [],
};
export function isDipendenteFisso(nome, sedeId) {
    return (DIPENDENTI_FISSI[sedeId] || []).some(d => d.nome === nome);
}

function getDipendenti() {
    return DIPENDENTI_PER_SEDE[state.sedeAttiva] || DIPENDENTI_PER_SEDE['lungomare'];
}

// true se il dipendente è pagato con bonifico (assunto → costo azienda nel report)
export function isDipendenteBonifico(nome, sedeId) {
    const lista = DIPENDENTI_PER_SEDE[sedeId] || DIPENDENTI_PER_SEDE[state.sedeAttiva] || [];
    return (lista.find(d => d.nome === nome)?.modalita || '') === 'BONIFICO';
}

let currentWeekStart = null;
// Mese/anno mostrati nel riepilogo mensile (navigabili con ◀ ▶)
let riepMese = new Date().getMonth();
let riepAnno = new Date().getFullYear();
let presenzeLocali = []; // cache locale delle presenze caricate
let accontiLocali = {}; // nome → importo residuo (anticipi su stipendio, collection `acconti`)
let movimentiLocali = {}; // nome → [{data, importo, tipo, nota}] storico versamenti (campo movimenti in `acconti`)
let stipendiLocali = {}; // nome → { 'YYYY-MM': {importo, data} } stipendi fissi pagati (campo stipendiPagati in `acconti`)

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
        stipendiLocali = {};
        movimentiLocali = {};
        snapA.forEach(docSnap => {
            const a = docSnap.data();
            if (pNum(a.importo) > 0) accontiLocali[a.nome] = pNum(a.importo);
            if (Array.isArray(a.movimenti)) movimentiLocali[a.nome] = a.movimenti;
            if (a.stipendiPagati) stipendiLocali[a.nome] = a.stipendiPagati;
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
        ...exDipendenti.sort().map(n => {
            const f = (DIPENDENTI_FISSI[state.sedeAttiva] || []).find(d => d.nome === n);
            return f
                ? { nome: n, mod: `<span class="badge b" title="Stipendio fisso dal ${f.dal.split('-').reverse().join('/')}: le giornate qui sono lo storico a giornata">📅 Fisso ${fEur(f.mensile)}/mese</span>` }
                : { nome: n, mod: '<span class="badge" title="Non più in organico">👋 ex</span>' };
        }),
    ];

    // Per mese (richiesta Guido 02/10/2026): pagato e da pagare del mese mostrato, più l'arretrato
    // degli altri mesi. Una giornata può essere pagata in parte (`parziali[nome]` = quota già
    // versata con un acconto): conta come pagata per quella quota e da pagare per il resto.
    const daPagare = {}, pagatoMese = {}, daPagareMese = {};
    presenzeLocali.forEach(p => {
        if (!p.dettaglio) return;
        const d = p.dataISO ? new Date(p.dataISO) : null;
        const nelMese = d && d.getMonth() === mese && d.getFullYear() === anno;
        for (const [nome, val] of Object.entries(p.dettaglio)) {
            const v = pNum(val);
            if (v <= 0) continue;
            const { pagato, resto } = quotaGiornata(p, nome);
            if (nelMese) {
                if (pagato > 0) pagatoMese[nome] = (pagatoMese[nome] || 0) + pagato;
                if (resto > 0) daPagareMese[nome] = (daPagareMese[nome] || 0) + resto;
            }
            if (resto > 0) daPagare[nome] = (daPagare[nome] || 0) + resto;
        }
    });

    tb.innerHTML = righe.map(dip => {
        totGenerale += totDip[dip.nome];
        const dovuto = daPagare[dip.nome] || 0;
        const credito = accontiLocali[dip.nome] || 0; // eccedenza versata: copre le prossime giornate
        const cellaPagare = dovuto > 0
            ? `<span style="color:var(--amb)">${fEur(dovuto)}</span>`
            : `<span style="color:var(--grn)">✓ saldato</span>${credito > 0 ? `<br><span style="font:400 9px var(--f);color:var(--tx3)" title="Versato in più: copre in automatico le prossime giornate">a credito ${fEur(credito)}</span>` : ''}`;
        const pm = pagatoMese[dip.nome] || 0, dm = daPagareMese[dip.nome] || 0;
        const arretrato = Math.max(0, dovuto - dm);
        const cellaMese = dm > 0
            ? `<span style="color:var(--amb)">${fEur(dm)}</span>`
            : (totDip[dip.nome] > 0 ? '<span style="color:var(--grn)">✓ saldato</span>' : '—');
        const ultimi = (movimentiLocali[dip.nome] || []).slice(-4).reverse().map(m => `${m.data} ${fEur(pNum(m.importo))} ${m.tipo || ''}`).join('\n');
        return `<tr>
            <td><strong>${dip.nome}</strong></td>
            <td>${dip.mod}</td>
            <td style="text-align:center">${giorniDip[dip.nome]}</td>
            <td style="font:700 13px var(--f);color:var(--red)">${fEur(totDip[dip.nome])}</td>
            <td style="font:600 12px var(--f);color:var(--grn)">${pm ? fEur(pm) : '—'}</td>
            <td style="font:700 13px var(--f)">${cellaMese}</td>
            <td style="font:600 12px var(--f)" title="Totale non pagato su tutto lo storico: ${fEur(dovuto)}">${arretrato > 0 ? `<span style="color:var(--red)">${fEur(arretrato)}</span>` : '—'}</td>
            <td style="white-space:nowrap">${dm > 0 ? `<button class="btn btn-paga-mese" data-nome="${dip.nome}" title="Paga tutte le giornate di questo mese (${fEur(dm)})" style="font-size:10px;padding:3px 10px;background:var(--grn1);border-color:var(--grn);color:var(--grn)">💰 Paga mese</button> ` : ''}${arretrato > 0 ? `<button class="btn btn-paga-dip" data-nome="${dip.nome}" title="Paga TUTTO l'arretrato (tutti i mesi: ${fEur(dovuto)})" style="font-size:10px;padding:3px 8px">tutto</button> ` : ''}<button class="btn btn-acconto-dip" data-nome="${dip.nome}" title="Acconto: versi una cifra e si scala subito dal da pagare (giornate più vecchie prima); l'eccedenza resta a credito${ultimi ? '\n\nUltimi versamenti:\n' + ultimi : ''}" style="font-size:10px;padding:3px 8px">💶 Acconto</button></td>
        </tr>`;
    }).join('');

    // Dipendenti a stipendio fisso (es. SONY dal 01/09/2026): una riga per mese con lo
    // stipendio del mese (pro-rata nel mese di ingresso), pagato sì/no e gli stipendi
    // arretrati dei mesi precedenti. Stato in acconti/{sede}_{nome}.stipendiPagati['YYYY-MM'].
    const meseKey = `${anno}-${String(mese + 1).padStart(2, '0')}`;
    (DIPENDENTI_FISSI[state.sedeAttiva] || []).forEach(f => {
        if (meseKey < f.dal.slice(0, 7)) return;              // non ancora a stipendio fisso
        if (righe.some(r => r.nome === f.nome)) return;       // già in tabella (storico a giornata)
        const pagatiMap = stipendiLocali[f.nome] || {};
        const importo = stipendioMese(f, anno, mese);
        const pag = pagatiMap[meseKey];
        const arretrati = Object.entries(stipendiArretrati(f, pagatiMap, meseKey));
        const arrTot = arretrati.reduce((s, [, v]) => s + v, 0);
        totGenerale += importo;
        tb.innerHTML += `<tr>
            <td><strong>${f.nome}</strong></td>
            <td><span class="badge b" title="Stipendio fisso dal ${f.dal.split('-').reverse().join('/')}">📅 Fisso ${fEur(f.mensile)}/mese</span></td>
            <td style="text-align:center">—</td>
            <td style="font:700 13px var(--f);color:var(--red)">${fEur(importo)}</td>
            <td style="font:600 12px var(--f);color:var(--grn)" title="${pag ? 'pagato il ' + pag.data : ''}">${pag ? fEur(pNum(pag.importo)) : '—'}</td>
            <td style="font:700 13px var(--f)">${pag ? '<span style="color:var(--grn)">✓ saldato</span>' : `<span style="color:var(--amb)">${fEur(importo)}</span>`}</td>
            <td style="font:600 12px var(--f)" title="${arretrati.map(([k, v]) => k + ' ' + fEur(v)).join(', ')}">${arrTot > 0 ? `<span style="color:var(--red)">${fEur(arrTot)}</span>` : '—'}</td>
            <td style="white-space:nowrap">${!pag && importo > 0 ? `<button class="btn btn-paga-stip" data-nome="${f.nome}" data-mese="${meseKey}" data-importo="${importo}" title="Segna pagato lo stipendio di questo mese" style="font-size:10px;padding:3px 10px;background:var(--grn1);border-color:var(--grn);color:var(--grn)">💰 Paga stipendio</button>` : ''}${arretrati.map(([k, v]) => ` <button class="btn btn-paga-stip" data-nome="${f.nome}" data-mese="${k}" data-importo="${v}" title="Segna pagato lo stipendio arretrato di ${k}" style="font-size:10px;padding:3px 8px">${k.slice(5)}/${k.slice(2, 4)}</button>`).join('')}</td>
        </tr>`;
    });

    tb.innerHTML += `<tr style="background:var(--bg4)">
        <td colspan="2"><strong>TOTALE ${mesi[mese].toUpperCase()} ${anno}</strong></td>
        <td></td>
        <td style="font:700 14px var(--f);color:var(--red)">${fEur(totGenerale)}</td>
        <td colspan="4"></td>
    </tr>`;

    tb.querySelectorAll('.btn-paga-dip').forEach(btn => {
        btn.addEventListener('click', () => segnaPagatoDipendente(btn.dataset.nome));
    });
    tb.querySelectorAll('.btn-paga-mese').forEach(btn => {
        btn.addEventListener('click', () => segnaPagatoDipendente(btn.dataset.nome, { mese, anno }));
    });
    tb.querySelectorAll('.btn-acconto-dip').forEach(btn => {
        btn.addEventListener('click', () => registraAcconto(btn.dataset.nome));
    });
    tb.querySelectorAll('.btn-paga-stip').forEach(btn => {
        btn.addEventListener('click', () => pagaStipendio(btn.dataset.nome, btn.dataset.mese, pNum(btn.dataset.importo)));
    });
}

// Stipendio dovuto nel mese a un dipendente fisso: intero, oppure pro-rata sui giorni
// dal giorno `dal` se è il mese di ingresso (stessa regola di report.js costiFissi).
function stipendioMese(f, anno, mese) {
    const giorniMese = new Date(anno, mese + 1, 0).getDate();
    const dal = new Date(f.dal + 'T00:00:00');
    if (dal.getFullYear() !== anno || dal.getMonth() !== mese) return f.mensile;
    return Math.round(f.mensile * (giorniMese - dal.getDate() + 1) / giorniMese);
}

// Stipendi dei mesi PRECEDENTI a `meseKey` (da `dal` in poi) non ancora segnati pagati.
function stipendiArretrati(f, pagatiMap, meseKey) {
    const out = {};
    let [a, m] = f.dal.slice(0, 7).split('-').map(Number);
    m -= 1;
    for (;;) {
        const k = `${a}-${String(m + 1).padStart(2, '0')}`;
        if (k >= meseKey) break;
        if (!pagatiMap[k]) out[k] = stipendioMese(f, a, m);
        m++; if (m > 11) { m = 0; a++; }
    }
    return out;
}

// Segna pagato lo stipendio fisso di un mese → acconti/{sede}_{nome}.stipendiPagati[YYYY-MM]
async function pagaStipendio(nome, meseKey, importo) {
    const [a, m] = meseKey.split('-');
    const mesiL = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
    const r = prompt(`Stipendio ${nome} — ${mesiL[+m - 1]} ${a}.\nImporto pagato (netto):`, String(importo));
    if (r === null) return;
    const val = parseFloat(String(r).replace(',', '.'));
    if (isNaN(val) || val <= 0) { alert('Importo non valido'); return; }
    const oggi = new Date().toLocaleDateString('it-IT');
    try {
        await fsSetDoc(fsDoc(db, 'acconti', `${state.sedeAttiva}_${nome}`), {
            nome, sedeId: state.sedeAttiva, aggiornato: oggi,
            stipendiPagati: { [meseKey]: { importo: val, data: oggi } }
        }, { merge: true });
        stipendiLocali[nome] = { ...(stipendiLocali[nome] || {}), [meseKey]: { importo: val, data: oggi } };
        renderRiepilogoMensile(riepMese, riepAnno);
    } catch (e) {
        alert('Errore salvataggio stipendio: ' + (e?.message || e));
    }
}

// Quota pagata e resto da pagare di una giornata per un dipendente.
function quotaGiornata(p, nome) {
    const v = pNum(p.dettaglio?.[nome]);
    if (v <= 0) return { pagato: 0, resto: 0 };
    if (p.pagati && p.pagati[nome]) return { pagato: v, resto: 0 };
    const parz = Math.min(v, pNum(p.parziali?.[nome]));
    return { pagato: parz, resto: v - parz };
}

// Giornate con un resto da pagare, dalla più vecchia; `periodo` {mese, anno} le limita a un mese.
function giornateAperte(nome, periodo = null) {
    return presenzeLocali.filter(p => {
        if (quotaGiornata(p, nome).resto <= 0) return false;
        if (!periodo) return true;
        const d = p.dataISO ? new Date(p.dataISO) : null;
        return d && d.getMonth() === periodo.mese && d.getFullYear() === periodo.anno;
    }).sort((a, b) => (a.dataISO || '').localeCompare(b.dataISO || ''));
}

// Cuore della logica pagamenti (Guido 22/10/2026): ogni somma versata copre SUBITO le giornate
// aperte dalla più vecchia; l'ultima può restare coperta in parte (`parziali`). Quel che avanza
// resta a credito in acconti/{sede}_{nome}.importo e viene usato in automatico quando si salvano
// nuove giornate (vedi applicaCreditoAutomatico). Ogni versamento è un movimento con data.
async function applicaPagamento(nome, importo, { periodo = null, tipo = 'ACCONTO', nota = '' } = {}) {
    const oggi = new Date().toLocaleDateString('it-IT');
    let resto = importo, coperte = 0;
    for (const p of giornateAperte(nome, periodo)) {
        if (resto <= 0 || !p._id) break;
        const q = quotaGiornata(p, nome);
        const upd = {};
        if (resto >= q.resto) {
            upd.pagati = { ...(p.pagati || {}), [nome]: oggi };
            if (p.parziali && p.parziali[nome] !== undefined) { upd.parziali = { ...p.parziali }; delete upd.parziali[nome]; }
            resto -= q.resto; coperte++;
        } else {
            upd.parziali = { ...(p.parziali || {}), [nome]: q.pagato + resto };
            resto = 0; coperte++;
        }
        try {
            await fsUpdateDoc(fsDoc(db, 'presenzeDipendenti', p._id), upd);
            Object.assign(p, upd);
        } catch (e) { console.warn('pagamento giornata fallito', p.dataISO, e?.message); }
    }
    // Eccedenza → credito (solo per acconti liberi; "Paga mese/tutto" versano l'esatto dovuto)
    const creditoPrima = accontiLocali[nome] || 0;
    const credito = creditoPrima + (periodo ? 0 : Math.max(0, resto));
    const mov = { data: oggi, importo, tipo, coperte, nota: nota || '' };
    if (credito !== creditoPrima || resto > 0) mov.aCredito = Math.max(0, resto);
    const movimenti = [...(movimentiLocali[nome] || []), mov].slice(-200);
    try {
        await fsSetDoc(fsDoc(db, 'acconti', `${state.sedeAttiva}_${nome}`), {
            nome, sedeId: state.sedeAttiva, importo: credito, aggiornato: oggi, movimenti
        }, { merge: true });
        if (credito > 0) accontiLocali[nome] = credito; else delete accontiLocali[nome];
        movimentiLocali[nome] = movimenti;
    } catch (e) { console.warn('aggiornamento acconto fallito', e?.message); }
    return { coperte, aCredito: Math.max(0, resto) };
}

// 💶 Acconto: chiede la cifra versata e la scala subito dal da pagare.
async function registraAcconto(nome) {
    const aperte = giornateAperte(nome);
    const dovuto = aperte.reduce((s, p) => s + quotaGiornata(p, nome).resto, 0);
    const credito = accontiLocali[nome] || 0;
    const inp = prompt(`Acconto a ${nome}.\nDa pagare ora: ${fEur(dovuto)}${credito ? ` · già a credito ${fEur(credito)}` : ''}\n\nQuanto gli dai adesso?`, '');
    if (inp === null) return;
    const val = parseFloat(String(inp).replace(',', '.'));
    if (isNaN(val) || val <= 0) { alert('Importo non valido'); return; }
    const r = await applicaPagamento(nome, val, { tipo: 'ACCONTO' });
    const dopo = giornateAperte(nome).reduce((s, p) => s + quotaGiornata(p, nome).resto, 0);
    alert(`${nome}: versati ${fEur(val)} → ${r.coperte} giornate coperte, da pagare ora ${fEur(dopo)}${r.aCredito > 0 ? `, ${fEur(r.aCredito)} a credito per le prossime giornate` : ''}.`);
    renderRiepilogoMensile(riepMese, riepAnno);
}

// "Paga mese" / "tutto": versa esattamente il dovuto (del mese o di tutto lo storico).
async function segnaPagatoDipendente(nome, periodo = null) {
    const aperte = giornateAperte(nome, periodo);
    if (!aperte.length) return;
    const totale = aperte.reduce((s, p) => s + quotaGiornata(p, nome).resto, 0);
    const prima = aperte[0].dataISO.split('-').reverse().join('/');
    const mesiL = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
    if (!confirm(`Segnare PAGATO ${nome}${periodo ? ' — solo ' + mesiL[periodo.mese] + ' ' + periodo.anno : ''}?\n${aperte.length} giornate dal ${prima} — totale ${fEur(totale)}`)) return;
    await applicaPagamento(nome, totale, { periodo, tipo: periodo ? 'PAGA_MESE' : 'PAGA_TUTTO' });
    renderRiepilogoMensile(riepMese, riepAnno);
}

// Dopo il salvataggio di una giornata: se il dipendente ha credito (ha versato in più),
// la giornata nuova viene coperta subito con quel credito.
async function applicaCreditoAutomatico(dataISO) {
    await caricaPresenze();
    const p = getPresenzaByDate(dataISO);
    if (!p || !p.dettaglio) return;
    for (const nome of Object.keys(p.dettaglio)) {
        const credito = accontiLocali[nome] || 0;
        const q = quotaGiornata(p, nome);
        if (credito <= 0 || q.resto <= 0) continue;
        const usa = Math.min(credito, q.resto);
        const oggi = new Date().toLocaleDateString('it-IT');
        const upd = usa >= q.resto
            ? { pagati: { ...(p.pagati || {}), [nome]: oggi } }
            : { parziali: { ...(p.parziali || {}), [nome]: q.pagato + usa } };
        try {
            await fsUpdateDoc(fsDoc(db, 'presenzeDipendenti', p._id), upd);
            Object.assign(p, upd);
            const residuo = credito - usa;
            const movimenti = [...(movimentiLocali[nome] || []), { data: oggi, importo: usa, tipo: 'DA_CREDITO', coperte: 1, nota: `giornata ${dataISO.split('-').reverse().join('/')}` }].slice(-200);
            await fsSetDoc(fsDoc(db, 'acconti', `${state.sedeAttiva}_${nome}`), {
                nome, sedeId: state.sedeAttiva, importo: residuo, aggiornato: oggi, movimenti
            }, { merge: true });
            if (residuo > 0) accontiLocali[nome] = residuo; else delete accontiLocali[nome];
            movimentiLocali[nome] = movimenti;
        } catch (e) { console.warn('credito automatico fallito', nome, e?.message); }
    }
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
        await applicaCreditoAutomatico(dataISO);
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
