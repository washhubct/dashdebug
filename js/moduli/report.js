import { state, CONFIG } from '../state.js';
import { pNum, pDate, fEur, esc, gMK, fmtDI } from '../utils.js';

let ch1 = null;
let ch2 = null;

export function initReport() {
    const n = new Date();
    const repFrom = document.getElementById('repFrom');
    const repTo = document.getElementById('repTo');
    if (repFrom) repFrom.value = fmtDI(new Date(n.getFullYear(), n.getMonth(), 1));
    if (repTo) repTo.value = fmtDI(n);
    if (repFrom) repFrom.addEventListener('change', renderReport);
    if (repTo) repTo.addEventListener('change', renderReport);

    const chatIn = document.getElementById('chatIn');
    const chatBtn = document.querySelector('.chat-input button');
    if (chatIn) chatIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
    if (chatBtn) chatBtn.addEventListener('click', sendChat);
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: date inclusive
// ═══════════════════════════════════════════════════════════════════
function endOfDay(dateStr) { const d = new Date(dateStr); d.setHours(23, 59, 59, 999); return d; }
function startOfDay(dateStr) { const d = new Date(dateStr); d.setHours(0, 0, 0, 0); return d; }

// ═══════════════════════════════════════════════════════════════════
// HELPER: filtra dati operativi per periodo
// ═══════════════════════════════════════════════════════════════════
function inRange(dateStr, from, to) {
    if (!dateStr) return false;
    let d;
    if (typeof dateStr === 'string') {
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) d = new Date(dateStr);
        else d = pDate(dateStr);
    } else {
        d = dateStr;
    }
    return d && d >= from && d <= to;
}

// ═══════════════════════════════════════════════════════════════════
// CALCOLA DATI OPERATIVI DAL PERIODO (dalle collezioni, non Prima Nota)
// ═══════════════════════════════════════════════════════════════════
function calcolaDatiOperativi(fromStr, toStr) {
    const from = startOfDay(fromStr);
    const to = endOfDay(toStr);

    // --- LAVAGGI (da prenotazioni) ---
    let lavContanti = 0, lavPos = 0, lavSospesi = 0, numLavaggi = 0;
    for (const [date, entries] of Object.entries(state.prenDB || {})) {
        if (!inRange(date, from, to)) continue;
        entries.forEach(p => {
            numLavaggi++;
            const imp = pNum(p.prezzo);
            if (p.saldato === 'SI') {
                if (p.saldo === 'CONTANTI') lavContanti += imp;
                else if (p.saldo === 'POS') lavPos += imp;
            } else if (p.saldo === 'SOSPESO') {
                lavSospesi += imp;
            }
        });
    }

    // --- TAPPEZZERIA ---
    let tapContanti = 0, tapPos = 0, tapSospesi = 0, numTap = 0;
    (state.tapDB || []).forEach(t => {
        if (t.status !== 'OUT') return;
        const dataOut = t.dataOut || '';
        if (!inRange(dataOut, from, to)) return;
        numTap++;
        const imp = pNum(t.prezzo);
        const mod = (t.pagamento || '').toUpperCase();
        if (mod === 'SOSPESO' || mod === 'FATTURATO') tapSospesi += imp;
        else if (mod === 'CONTANTI') tapContanti += imp;
        else if (mod === 'POS') tapPos += imp;
        else tapContanti += imp; // default
    });

    // --- PARCHEGGIO ABBONAMENTI ---
    let abbContanti = 0, abbPos = 0, abbBonifico = 0, numAbb = 0;
    (state.localAbb || []).forEach(a => {
        if (a.PAGAMENTO !== 'SI') return;
        const dataPag = a['DATA PAGAMENTO'] || '';
        if (!inRange(dataPag, from, to)) return;
        numAbb++;
        const imp = pNum(a.IMPORTO);
        const mod = (a["MODALITA'"] || '').toUpperCase();
        if (mod === 'CONTANTI') abbContanti += imp;
        else if (mod === 'POS') abbPos += imp;
        else if (mod === 'BONIFICO') abbBonifico += imp;
        else abbContanti += imp;
    });

    // --- PARCHEGGIO AD ORE (giornalieri) ---
    let parContanti = 0, parPos = 0, numPar = 0;
    (state.giornDB || []).forEach(g => {
        if (g.status !== 'OUT') return;
        if (!inRange(g.dataOut, from, to)) return;
        numPar++;
        const imp = pNum(g.prezzoFinale);
        if (g.pagamento === 'CONTANTI') parContanti += imp;
        else if (g.pagamento === 'POS') parPos += imp;
    });

    // --- SOSPESI APERTI nel periodo ---
    let sospesiAperti = 0, numSospesi = 0;
    (state.localSosp || []).forEach(s => {
        if (s._pagato) return;
        const d = pDate(s.data);
        if (d && d >= from && d <= to) {
            sospesiAperti += pNum(s.importo);
            numSospesi++;
        }
    });

    // --- USCITE ---
    let uscContanti = 0, uscPos = 0;
    (state.usciteDB || []).forEach(u => {
        if (!inRange(u.data, from, to)) return;
        const imp = pNum(u.importo);
        if (u.metodo === 'CONTANTI') uscContanti += imp;
        else if (u.metodo === 'POS') uscPos += imp;
        else uscContanti += imp;
    });

    // --- PERSONALE (da presenze) ---
    let costoPersonale = 0;
    let dettaglioDip = {};
    (state.presenzeDB || []).forEach(p => {
        const d = p.dataISO ? new Date(p.dataISO) : pDate(p.data);
        if (d && d >= from && d <= to) {
            costoPersonale += pNum(p.costoTotale);
            if (p.dettaglio) {
                for (const [nome, val] of Object.entries(p.dettaglio)) {
                    dettaglioDip[nome] = (dettaglioDip[nome] || 0) + pNum(val);
                }
            }
        }
    });

    // --- COSTI FISSI (pro-rata giornaliero) ---
    const giorniPeriodo = Math.max(1, Math.round((to - from) / 864e5));
    const costiFissi = {
        affitto: Math.round((1560 / 30) * giorniPeriodo * 100) / 100,
        operatore: Math.round((1400 / 30) * giorniPeriodo * 100) / 100,
        luce: Math.round((1000 / 30) * giorniPeriodo * 100) / 100,
        acqua: Math.round((390 / 30) * giorniPeriodo * 100) / 100,
        assicurazione: Math.round((82.33 / 30) * giorniPeriodo * 100) / 100,
        giorni: giorniPeriodo,
        totale: 0
    };
    costiFissi.totale = costiFissi.affitto + costiFissi.operatore + costiFissi.luce + costiFissi.acqua + costiFissi.assicurazione;

    // --- TOTALI ---
    const fatLavaggio = lavContanti + lavPos;
    const fatTappezzeria = tapContanti + tapPos;
    const fatParchAbb = abbContanti + abbPos + abbBonifico;
    const fatParchOre = parContanti + parPos;
    const fatParchTot = fatParchAbb + fatParchOre;
    const fatturato = fatLavaggio + fatTappezzeria + fatParchTot;
    const usciteTot = uscContanti + uscPos;
    const consumabili = fatLavaggio * 0.03;

    return {
        // Lavaggio
        lavContanti, lavPos, lavSospesi, fatLavaggio, numLavaggi,
        // Tappezzeria
        tapContanti, tapPos, tapSospesi, fatTappezzeria, numTap,
        // Parcheggio
        abbContanti, abbPos, abbBonifico, fatParchAbb, numAbb,
        parContanti, parPos, fatParchOre, numPar,
        fatParchTot,
        // Totali
        fatturato, sospesiAperti, numSospesi,
        uscContanti, uscPos, usciteTot,
        costoPersonale, dettaglioDip,
        costiFissi, consumabili,
        // Margine
        margine: fatturato - usciteTot - costiFissi.totale - consumabili - costoPersonale,
        marginePct: fatturato > 0 ? ((fatturato - usciteTot - costiFissi.totale - consumabili - costoPersonale) / fatturato * 100).toFixed(1) : '0.0',
        // Per grafici
        from, to
    };
}

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD ANALITICA — lettura dati operativi
// ═══════════════════════════════════════════════════════════════════
export function renderDash() {
    if (state.currentUser?.role !== 'admin') return;

    const d = calcolaDatiOperativi(fmtDI(state.dateFrom), fmtDI(state.dateTo));

    // --- KPI PRINCIPALI ---
    const mainEl = document.getElementById('dashKpiMain');
    if (mainEl) {
        mainEl.innerHTML = `
            <div class="kpi g">
                <div class="kpi-label">Fatturato Incassato</div>
                <div class="kpi-val">${fEur(d.fatturato)}</div>
                <div class="kpi-sub">Contanti ${fEur(d.lavContanti + d.tapContanti + d.abbContanti + d.parContanti)} · POS ${fEur(d.lavPos + d.tapPos + d.abbPos + d.parPos)}</div>
            </div>
            <div class="kpi b">
                <div class="kpi-label">Margine Operativo</div>
                <div class="kpi-val">${fEur(d.margine)}</div>
                <div class="kpi-sub">${d.marginePct}% sul fatturato</div>
            </div>
            <div class="kpi a">
                <div class="kpi-label">Sospesi da Incassare</div>
                <div class="kpi-val">${fEur(d.sospesiAperti + d.lavSospesi + d.tapSospesi)}</div>
                <div class="kpi-sub">${d.numSospesi} in attesa</div>
            </div>
            <div class="kpi" style="border-color:var(--tx2)">
                <div class="kpi-label">Lavaggi Effettuati</div>
                <div class="kpi-val">${d.numLavaggi}</div>
                <div class="kpi-sub">Media ${d.numLavaggi > 0 ? fEur(d.fatLavaggio / d.numLavaggi) : '€0'}/lav.</div>
            </div>
        `;
    }

    // --- FATTURATO PER CATEGORIA ---
    const catEl = document.getElementById('dashKpiCat');
    if (catEl) {
        catEl.innerHTML = `
            <div class="kpi" style="border-color:var(--blu)">
                <div class="kpi-label">🧼 Lavaggio</div>
                <div class="kpi-val" style="color:var(--blu)">${fEur(d.fatLavaggio)}</div>
                <div class="kpi-sub">${d.numLavaggi} lav. · Sosp. ${fEur(d.lavSospesi)}</div>
            </div>
            <div class="kpi" style="border-color:var(--amb)">
                <div class="kpi-label">🪡 Tappezzeria</div>
                <div class="kpi-val" style="color:var(--amb)">${fEur(d.fatTappezzeria)}</div>
                <div class="kpi-sub">${d.numTap} lav. · Sosp. ${fEur(d.tapSospesi)}</div>
            </div>
            <div class="kpi" style="border-color:var(--yel)">
                <div class="kpi-label">🅿️ Parcheggio Abb.</div>
                <div class="kpi-val" style="color:#9a7800">${fEur(d.fatParchAbb)}</div>
                <div class="kpi-sub">${d.numAbb} abbonamenti pagati</div>
            </div>
            <div class="kpi" style="border-color:var(--grn)">
                <div class="kpi-label">🎟️ Parcheggio Ore</div>
                <div class="kpi-val" style="color:var(--grn)">${fEur(d.fatParchOre)}</div>
                <div class="kpi-sub">${d.numPar} soste chiuse</div>
            </div>
        `;
    }

    // --- USCITE & COSTI ---
    const uscEl = document.getElementById('dashKpiUsc');
    if (uscEl) {
        const dipDetail = Object.entries(d.dettaglioDip).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n}: ${fEur(v)}`).join(' · ');

        uscEl.innerHTML = `
            <div class="kpi r">
                <div class="kpi-label">👷 Personale</div>
                <div class="kpi-val">${fEur(d.costoPersonale)}</div>
                <div class="kpi-sub" title="${dipDetail}" style="cursor:help;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${dipDetail || 'Nessun dato presenze'}</div>
            </div>
            <div class="kpi r">
                <div class="kpi-label">🏠 Costi Fissi</div>
                <div class="kpi-val">${fEur(d.costiFissi.totale)}</div>
                <div class="kpi-sub">Pro-rata ${d.costiFissi.giorni}gg su 30</div>
            </div>
            <div class="kpi r">
                <div class="kpi-label">📦 Altre Uscite</div>
                <div class="kpi-val">${fEur(d.usciteTot)}</div>
                <div class="kpi-sub">Spese operative registrate</div>
            </div>
            <div class="kpi r">
                <div class="kpi-label">🧴 Consumabili</div>
                <div class="kpi-val">${fEur(d.consumabili)}</div>
                <div class="kpi-sub">3% fatturato lavaggi</div>
            </div>
        `;
    }

    renderCharts(d);
}

// ═══════════════════════════════════════════════════════════════════
// GRAFICI — dati operativi per mese
// ═══════════════════════════════════════════════════════════════════
function renderCharts(data) {
    const months = [];
    const d = new Date(state.dateFrom.getFullYear(), state.dateFrom.getMonth(), 1);
    const end = new Date(state.dateTo.getFullYear(), state.dateTo.getMonth(), 1);
    while (d <= end) { months.push(gMK(d)); d.setMonth(d.getMonth() + 1); }

    const labels = months.map(m => {
        const [y, mo] = m.split('-');
        return CONFIG.MESI_S[parseInt(mo) - 1] + ' ' + y.slice(2);
    });

    // Calcola per mese
    const byM = {};
    months.forEach(m => byM[m] = { lav: 0, tap: 0, abb: 0, ore: 0, usc: 0 });

    // Lavaggi per mese
    for (const [date, entries] of Object.entries(state.prenDB || {})) {
        const dt = new Date(date);
        if (isNaN(dt.getTime())) continue;
        const mk = gMK(dt);
        if (!byM[mk]) continue;
        entries.forEach(p => {
            if (p.saldato === 'SI' && p.saldo !== 'SOSPESO') byM[mk].lav += pNum(p.prezzo);
        });
    }

    // Tappezzeria per mese
    (state.tapDB || []).forEach(t => {
        if (t.status !== 'OUT' || !t.dataOut) return;
        const dt = pDate(t.dataOut);
        if (!dt) return;
        const mk = gMK(dt);
        if (!byM[mk]) return;
        const mod = (t.pagamento || '').toUpperCase();
        if (mod !== 'SOSPESO' && mod !== 'FATTURATO') byM[mk].tap += pNum(t.prezzo);
    });

    // Abbonamenti per mese
    (state.localAbb || []).forEach(a => {
        if (a.PAGAMENTO !== 'SI' || !a['DATA PAGAMENTO']) return;
        const dt = pDate(a['DATA PAGAMENTO']);
        if (!dt) return;
        const mk = gMK(dt);
        if (!byM[mk]) return;
        byM[mk].abb += pNum(a.IMPORTO);
    });

    // Parcheggio ore per mese
    (state.giornDB || []).forEach(g => {
        if (g.status !== 'OUT' || !g.dataOut) return;
        const dt = new Date(g.dataOut);
        if (isNaN(dt.getTime())) return;
        const mk = gMK(dt);
        if (!byM[mk]) return;
        byM[mk].ore += pNum(g.prezzoFinale);
    });

    // Uscite per mese
    (state.usciteDB || []).forEach(u => {
        if (!u.data) return;
        const dt = new Date(u.data);
        if (isNaN(dt.getTime())) return;
        const mk = gMK(dt);
        if (!byM[mk]) return;
        byM[mk].usc += pNum(u.importo);
    });

    const opts = {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#5a5a52', font: { size: 10, family: 'DM Sans' }, boxWidth: 10, padding: 12 } } },
        scales: {
            x: { grid: { color: '#e0ddd4' }, ticks: { color: '#8a8a80', font: { size: 9, family: 'JetBrains Mono' } } },
            y: { grid: { color: '#e0ddd4' }, ticks: { color: '#8a8a80', font: { size: 9, family: 'JetBrains Mono' }, callback: v => '€' + v.toLocaleString('it-IT') } }
        }
    };

    const ch1El = document.getElementById('ch1');
    const ch2El = document.getElementById('ch2');

    if (ch1 && ch1El) ch1.destroy();
    if (ch1El) {
        ch1 = new Chart(ch1El, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Lavaggio', data: months.map(m => byM[m].lav), backgroundColor: 'rgba(37,99,235,.7)', borderRadius: 3, barPercentage: .5 },
                    { label: 'Tappezzeria', data: months.map(m => byM[m].tap), backgroundColor: 'rgba(212,160,23,.7)', borderRadius: 3, barPercentage: .5 },
                    { label: 'Parcheggio Abb.', data: months.map(m => byM[m].abb), backgroundColor: 'rgba(245,197,24,.65)', borderRadius: 3, barPercentage: .5 },
                    { label: 'Parcheggio Ore', data: months.map(m => byM[m].ore), backgroundColor: 'rgba(42,157,92,.6)', borderRadius: 3, barPercentage: .5 },
                ]
            },
            options: { ...opts, plugins: { ...opts.plugins, title: { display: false } } }
        });
    }

    if (ch2 && ch2El) ch2.destroy();
    if (ch2El) {
        const totLav = months.reduce((s, m) => s + byM[m].lav, 0);
        const totTap = months.reduce((s, m) => s + byM[m].tap, 0);
        const totAbb = months.reduce((s, m) => s + byM[m].abb, 0);
        const totOre = months.reduce((s, m) => s + byM[m].ore, 0);
        const totUsc = months.reduce((s, m) => s + byM[m].usc, 0);

        ch2 = new Chart(ch2El, {
            type: 'doughnut',
            data: {
                labels: ['Lavaggio', 'Tappezzeria', 'Parch. Abb.', 'Parch. Ore'],
                datasets: [{
                    data: [totLav, totTap, totAbb, totOre],
                    backgroundColor: ['rgba(37,99,235,.8)', 'rgba(212,160,23,.8)', 'rgba(245,197,24,.7)', 'rgba(42,157,92,.7)'],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '55%',
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#5a5a52', font: { size: 10, family: 'DM Sans' }, boxWidth: 10, padding: 12 } }
                }
            }
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
// REPORT FINANZIARIO (mantenuto per compatibilità, legge da Prima Nota)
// ═══════════════════════════════════════════════════════════════════
function getDataRecord(r) {
    if (r.dataISO) return new Date(r.dataISO);
    const raw = r.data || r.DATA || r.Data || '';
    if (!raw) return null;
    if (raw instanceof Date) return raw;
    if (typeof raw === 'string' && raw.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(raw);
    return pDate(raw);
}
function getEntrata(r) { return pNum(r.importo && r.tipo === 'ENTRATA' ? r.importo : (r.ENTRATA || r.Entrata || 0)); }
function getUscita(r) { if (r.tipo === 'USCITA' && r.importo) return pNum(r.importo); return pNum(r.USCITE || r.Uscite || r.USCITA || 0); }
function getCentroCosto(r) { return String(r.centro || r['CENTRO DI COSTO'] || r.Categoria || r.categoria || 'Altro').trim(); }
function getDescrizione(r) { return String(r.descrizione || r['PRIMANOTA CLIENTI/FORNITORI'] || r.Descrizione || '').toUpperCase(); }

export function renderReport() {
    if (state.currentUser?.role !== 'admin') return;
    const fromVal = document.getElementById('repFrom')?.value;
    const toVal = document.getElementById('repTo')?.value;
    if (!fromVal || !toVal) return;

    const d = calcolaDatiOperativi(fromVal, toVal);

    // Totale uscite COMPLETO (incluso personale)
    const totUscite = d.usciteTot + d.costiFissi.totale + d.consumabili + d.costoPersonale;
    const margine = d.fatturato - totUscite;
    const margPct = d.fatturato > 0 ? ((margine / d.fatturato) * 100).toFixed(1) : '0.0';

    // Sospesi totali (tutti quelli aperti, non solo un tipo)
    const sospesiTotali = d.sospesiAperti + d.lavSospesi + d.tapSospesi;

    const repKpis = document.getElementById('repKpis');
    if (repKpis) {
        repKpis.innerHTML = `
            <div class="kpi g"><div class="kpi-label">Entrate Totali</div><div class="kpi-val">${fEur(d.fatturato)}</div><div class="kpi-sub">Periodo: ${d.costiFissi.giorni} giorni</div></div>
            <div class="kpi r"><div class="kpi-label">Uscite Totali</div><div class="kpi-val">${fEur(totUscite)}</div><div class="kpi-sub">Personale ${fEur(d.costoPersonale)} + Fissi ${fEur(d.costiFissi.totale)} + Operative ${fEur(d.usciteTot)} + Cons. ${fEur(d.consumabili)}</div></div>
            <div class="kpi b"><div class="kpi-label">Margine Netto</div><div class="kpi-val">${fEur(margine)}</div><div class="kpi-sub">${margPct}%</div></div>
            <div class="kpi a"><div class="kpi-label">Sospesi</div><div class="kpi-val">${fEur(sospesiTotali)}</div><div class="kpi-sub">${d.numSospesi} in attesa</div></div>`;
    }

    // Dettaglio uscite CON personale
    const uscByCat = {};
    if (d.costoPersonale > 0) uscByCat['👷 Personale Lavaggio'] = d.costoPersonale;
    uscByCat['🏠 Affitto (35% Lav. / 20% Uff. / 45% Parch.)'] = d.costiFissi.affitto;
    uscByCat['👤 Operatore Lavaggio (fisso)'] = d.costiFissi.operatore;
    uscByCat['💡 Luce (media)'] = d.costiFissi.luce;
    uscByCat['💧 Acqua (media)'] = d.costiFissi.acqua;
    uscByCat['🛡️ Assicurazione'] = d.costiFissi.assicurazione;
    if (d.consumabili > 0) uscByCat['🧴 Consumabili (3% Lav.)'] = d.consumabili;
    if (d.usciteTot > 0) uscByCat['📦 Spese Operative'] = d.usciteTot;

    const uscEntries = Object.entries(uscByCat).sort((a, b) => b[1] - a[1]);
    const tbUsc = document.getElementById('repUscTb');
    if (tbUsc) {
        tbUsc.innerHTML = uscEntries.map(([cat, val]) => {
            const pct = totUscite > 0 ? ((val / totUscite) * 100).toFixed(1) : '0';
            return `<tr><td><strong>${esc(cat)}</strong></td><td style="font-weight:600">${fEur(val)}</td><td><div style="display:flex;align-items:center;gap:8px"><div style="width:${Math.min(pct, 100)}%;height:6px;background:var(--red);border-radius:3px;min-width:2px"></div><span style="font:400 11px var(--mono);color:var(--tx2)">${pct}%</span></div></td></tr>`;
        }).join('');
        tbUsc.innerHTML += `<tr style="background:var(--bg4)"><td><strong>TOTALE USCITE</strong></td><td style="font-weight:700">${fEur(totUscite)}</td><td style="font:400 10px var(--mono);color:var(--tx3)">Pro-rata ${d.costiFissi.giorni}gg</td></tr>`;
    }

    // Dettaglio entrate per categoria
    const entByCat = {};
    if (d.fatLavaggio > 0) entByCat['🧼 LAVAGGIO'] = d.fatLavaggio;
    if (d.fatTappezzeria > 0) entByCat['🪡 TAPPEZZERIA'] = d.fatTappezzeria;
    if (d.fatParchAbb > 0) entByCat['🅿️ PARCHEGGIO ABBONAMENTI'] = d.fatParchAbb;
    if (d.fatParchOre > 0) entByCat['🎟️ PARCHEGGIO AD ORE'] = d.fatParchOre;

    const entEntries = Object.entries(entByCat).sort((a, b) => b[1] - a[1]);
    const tbEnt = document.getElementById('repEntTb');
    if (tbEnt) {
        if (entEntries.length === 0) {
            tbEnt.innerHTML = '<tr><td colspan="3" class="empty">Nessuna entrata nel periodo</td></tr>';
        } else {
            tbEnt.innerHTML = entEntries.map(([cat, val]) => {
                const pct = d.fatturato > 0 ? ((val / d.fatturato) * 100).toFixed(1) : '0';
                return `<tr><td><strong>${esc(cat)}</strong></td><td style="font-weight:600">${fEur(val)}</td><td><div style="display:flex;align-items:center;gap:8px"><div style="width:${Math.min(pct, 100)}%;height:6px;background:var(--grn);border-radius:3px;min-width:2px"></div><span style="font:400 11px var(--mono);color:var(--tx2)">${pct}%</span></div></td></tr>`;
            }).join('');
            tbEnt.innerHTML += `<tr style="background:var(--bg4)"><td><strong>TOTALE ENTRATE</strong></td><td style="font-weight:700">${fEur(d.fatturato)}</td><td></td></tr>`;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// CHAT AI
// ═══════════════════════════════════════════════════════════════════
async function sendChat() {
    const inp = document.getElementById('chatIn');
    if (!inp) return;
    const text = inp.value.trim();
    if (!text) return;

    const msgs = document.getElementById('msgs');
    msgs.innerHTML += `<div class="msg user">${esc(text)}</div>`;
    inp.value = '';
    msgs.scrollTop = msgs.scrollHeight;

    const typ = document.createElement('div');
    typ.className = 'msg bot typing';
    typ.textContent = 'Analisi in corso... ⏳';
    msgs.appendChild(typ);
    msgs.scrollTop = msgs.scrollHeight;

    try {
        const d = calcolaDatiOperativi(fmtDI(state.dateFrom), fmtDI(state.dateTo));
        const ctx = `Dati WASH HUB (periodo selezionato):\n- Fatturato totale: €${d.fatturato.toFixed(2)}\n- Lavaggi: €${d.fatLavaggio.toFixed(2)} (${d.numLavaggi} lav.)\n- Tappezzeria: €${d.fatTappezzeria.toFixed(2)}\n- Parcheggio Abb: €${d.fatParchAbb.toFixed(2)}\n- Parcheggio Ore: €${d.fatParchOre.toFixed(2)}\n- Uscite: €${d.usciteTot.toFixed(2)}\n- Sospesi aperti: €${d.sospesiAperti.toFixed(2)} (${d.numSospesi})\n- Abbonati totali: ${state.localAbb.length}\n\nDomanda: ${text}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const r = await fetch(CONFIG.N8N_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ sessionId: 'dashboard-washhub', chatInput: ctx }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const txt = await r.text();
        typ.remove();

        let finalReply = '';
        try {
            let dd = JSON.parse(txt);
            finalReply = dd.output || dd.reply || dd.text || dd.response || dd.message || '';
            if (Array.isArray(dd) && dd.length > 0) finalReply = dd[0].output || dd[0].text || dd[0].message || JSON.stringify(dd[0]);
        } catch (e) {
            const lines = txt.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    try { const pl = JSON.parse(line); if (pl.type === 'item' && pl.content) finalReply += pl.content; } catch (err) {}
                }
            }
        }
        if (!finalReply && txt && !txt.includes('{"type":"begin"')) finalReply = txt;
        if (finalReply) {
            msgs.innerHTML += `<div class="msg bot">${esc(finalReply).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>')}</div>`;
        } else {
            msgs.innerHTML += `<div class="msg bot" style="border-color:var(--red)">⚠️ Errore di traduzione.</div>`;
        }
    } catch (e) {
        typ.remove();
        if (e.name === 'AbortError') msgs.innerHTML += `<div class="msg bot" style="border-color:var(--amb)">⚠️ Timeout (30s).</div>`;
        else msgs.innerHTML += `<div class="msg bot" style="border-color:var(--red)">⚠️ Errore: ${esc(e.message)}</div>`;
    }
    msgs.scrollTop = msgs.scrollHeight;
}
