import { state, CONFIG } from '../state.js';
import { pNum, pDate, fEur, esc, gMK, fmtDI } from '../utils.js';

let ch1 = null;
let ch2 = null;

export function initReport() {
    // Inizializza Date Report Finanziario
    const n = new Date();
    const repFrom = document.getElementById('repFrom');
    const repTo = document.getElementById('repTo');
    
    if(repFrom) repFrom.value = fmtDI(new Date(n.getFullYear(), n.getMonth(), 1));
    if(repTo) repTo.value = fmtDI(n);

    if(repFrom) repFrom.addEventListener('change', renderReport);
    if(repTo) repTo.addEventListener('change', renderReport);

    // Inizializza Chat AI
    const chatIn = document.getElementById('chatIn');
    const chatBtn = document.querySelector('.chat-input button');
    
    if(chatIn) {
        chatIn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendChat();
        });
    }
    if(chatBtn) {
        chatBtn.addEventListener('click', sendChat);
    }
}

export function renderReport() {
    if (state.currentUser?.role !== 'admin') return;
    
    const fromVal = document.getElementById('repFrom')?.value;
    const toVal = document.getElementById('repTo')?.value;
    if (!fromVal || !toVal || !state.rawData?.primaNota?.rows) return;

    const from = new Date(fromVal), to = new Date(toVal);
    const rows = state.rawData.primaNota.rows.filter(r => {
        // Supporta sia dataISO (YYYY-MM-DD) che DATA (DD/MM/YYYY)
        const d = r.dataISO ? new Date(r.dataISO) : pDate(r.DATA || r.Data);
        return d && d >= from && d <= to;
    });

    let totEntrate = 0, totUscitePN = 0, totSospesi = 0;
    let entByCat = {};
    let uscByCat = {};

    rows.forEach(r => {
        const ent = pNum(r.ENTRATA || r.Entrata);
        const usc = pNum(r.USCITE || r.Uscite || r.USCITA);
        const sosp = pNum(r.SOSPESO || r.Sospeso);
        const cc = String(r['CENTRO DI COSTO'] || r.Categoria || 'Altro').trim();
        const desc = String(r['PRIMANOTA CLIENTI/FORNITORI'] || r.Descrizione || '').toUpperCase();

        totEntrate += ent;
        totUscitePN += usc;
        totSospesi += sosp;

        if (ent > 0) { entByCat[cc] = (entByCat[cc] || 0) + ent; }
        if (usc > 0) {
            let cat = 'Altre Uscite';
            if (desc.includes('STIPEND') || desc.includes('PAGAMENT') || desc.includes('RAGAZZI')) cat = 'Personale Lavaggio';
            else if (desc.includes('FORNITOR')) cat = 'Fornitori';
            else if (desc.includes('UTENZ')) cat = 'Utenze';
            else if (desc.includes('MANUTENZ')) cat = 'Manutenzione';
            uscByCat[cat] = (uscByCat[cat] || 0) + usc;
        }
    });

    const fatLavaggio = entByCat['LAVAGGIO'] || 0;
    const consumabili = fatLavaggio * 0.03;
    if (consumabili > 0) uscByCat['Prodotti Consumabili (3% Lav.)'] = consumabili;

    const totUscite = totUscitePN + consumabili;
    const margine = totEntrate - totUscite;
    const margPct = totEntrate > 0 ? ((margine / totEntrate) * 100).toFixed(1) : '0.0';

    const repKpis = document.getElementById('repKpis');
    if(repKpis) {
        repKpis.innerHTML = `
            <div class="kpi g"><div class="kpi-label">Entrate Totali</div><div class="kpi-val">${fEur(totEntrate)}</div></div>
            <div class="kpi r"><div class="kpi-label">Uscite Totali</div><div class="kpi-val">${fEur(totUscite)}</div><div class="kpi-sub">Incl. consumabili ${fEur(consumabili)}</div></div>
            <div class="kpi b"><div class="kpi-label">Margine Netto</div><div class="kpi-val">${fEur(margine)}</div><div class="kpi-sub">${margPct}%</div></div>
            <div class="kpi a"><div class="kpi-label">Sospesi</div><div class="kpi-val">${fEur(totSospesi)}</div></div>`;
    }

    const uscEntries = Object.entries(uscByCat).sort((a, b) => b[1] - a[1]);
    const tbUsc = document.getElementById('repUscTb');
    if(tbUsc) {
        if (uscEntries.length === 0) {
            tbUsc.innerHTML = '<tr><td colspan="3" class="empty">Nessuna uscita nel periodo</td></tr>';
        } else {
            tbUsc.innerHTML = uscEntries.map(([cat, val]) => {
                const pct = totUscite > 0 ? ((val / totUscite) * 100).toFixed(1) : '0';
                const isCalc = cat.includes('Consumabili');
                return `<tr><td>${isCalc ? '<span class="badge b">AUTO</span> ' : ''}<strong>${esc(cat)}</strong></td><td style="font-weight:600">${fEur(val)}</td><td><div style="display:flex;align-items:center;gap:8px"><div style="width:${Math.min(pct, 100)}%;height:6px;background:var(--red);border-radius:3px;min-width:2px"></div><span style="font:400 11px var(--mono);color:var(--tx2)">${pct}%</span></div></td></tr>`;
            }).join('');
            tbUsc.innerHTML += `<tr style="background:var(--bg4)"><td><strong>TOTALE USCITE</strong></td><td style="font-weight:700">${fEur(totUscite)}</td><td></td></tr>`;
        }
    }

    const entEntries = Object.entries(entByCat).sort((a, b) => b[1] - a[1]);
    const tbEnt = document.getElementById('repEntTb');
    if(tbEnt) {
        if (entEntries.length === 0) {
            tbEnt.innerHTML = '<tr><td colspan="3" class="empty">Nessuna entrata nel periodo</td></tr>';
        } else {
            tbEnt.innerHTML = entEntries.map(([cat, val]) => {
                const pct = totEntrate > 0 ? ((val / totEntrate) * 100).toFixed(1) : '0';
                return `<tr><td><strong>${esc(cat)}</strong></td><td style="font-weight:600">${fEur(val)}</td><td><div style="display:flex;align-items:center;gap:8px"><div style="width:${Math.min(pct, 100)}%;height:6px;background:var(--grn);border-radius:3px;min-width:2px"></div><span style="font:400 11px var(--mono);color:var(--tx2)">${pct}%</span></div></td></tr>`;
            }).join('');
            tbEnt.innerHTML += `<tr style="background:var(--bg4)"><td><strong>TOTALE ENTRATE</strong></td><td style="font-weight:700">${fEur(totEntrate)}</td><td></td></tr>`;
        }
    }
}

export function renderDash() {
    if (!state.rawData || state.currentUser?.role !== 'admin') return;
    
    // 1. Calcolo Entrate e Uscite dalla Prima Nota
    const rows = (state.rawData?.primaNota?.rows || []).filter(r => {
        const d = r.dataISO ? new Date(r.dataISO) : pDate(r.DATA || r.Data);
        return d && d >= state.dateFrom && d <= state.dateTo;
    });

    let ent = 0, usc = 0;
    rows.forEach(r => {
        ent += pNum(r.ENTRATA || r.Entrata);
        usc += pNum(r.USCITE || r.Uscite || r.USCITA);
    });

    // 2. NUOVO CALCOLO: Sospesi ancora aperti generati nel periodo selezionato
    let sospesiApertiPeriodo = 0;
    if (state.localSosp) {
        state.localSosp.forEach(s => {
            // Controlliamo solo quelli NON pagati
            if (!s._pagato) {
                const dSosp = pDate(s.data);
                // Se la data rientra nel range della dashboard, lo sommiamo
                if (dSosp && dSosp >= state.dateFrom && dSosp <= state.dateTo) {
                    sospesiApertiPeriodo += pNum(s.importo);
                }
            }
        });
    }

    // 3. Stampa dei 3 KPI nella Dashboard
    const kpisEl = document.getElementById('kpis');
    if(kpisEl) {
        kpisEl.innerHTML = `
            <div class="kpi g"><div class="kpi-label">Entrate Gestionali (Periodo)</div><div class="kpi-val">${fEur(ent)}</div></div>
            <div class="kpi r"><div class="kpi-label">Uscite Gestionali (Periodo)</div><div class="kpi-val">${fEur(usc)}</div></div>
            <div class="kpi a"><div class="kpi-label">Sospesi Aperti (Periodo)</div><div class="kpi-val">${fEur(sospesiApertiPeriodo)}</div><div class="kpi-sub">Credito da incassare</div></div>
        `;
    }

    renderCharts(rows);
}
function renderCharts(rows) {
    const months = [];
    const d = new Date(state.dateFrom.getFullYear(), state.dateFrom.getMonth(), 1);
    const end = new Date(state.dateTo.getFullYear(), state.dateTo.getMonth(), 1);
    
    while (d <= end) {
        months.push(gMK(d));
        d.setMonth(d.getMonth() + 1);
    }
    
    const labels = months.map(m => {
        const [y, mo] = m.split('-');
        return CONFIG.MESI_S[parseInt(mo) - 1] + ' ' + y.slice(2);
    });
    
    const byM = {};
    months.forEach(m => byM[m] = { ent: 0, usc: 0, lav: 0, par: 0 });
    
    rows.forEach(r => {
        const dt = r.dataISO ? new Date(r.dataISO) : pDate(r.DATA || r.Data);
        if (!dt) return;
        const mk = gMK(dt);
        if (!byM[mk]) return;
        const e = pNum(r.ENTRATA || r.Entrata), u = pNum(r.USCITE || r.Uscite || r.USCITA);
        const cc = String(r['CENTRO DI COSTO'] || r.Categoria || '').toUpperCase();
        
        byM[mk].ent += e;
        byM[mk].usc += u;
        if (cc.includes('LAVAGG')) byM[mk].lav += e;
        else if (cc.includes('PARCH')) byM[mk].par += e;
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
    if(ch1El) {
        ch1 = new Chart(ch1El, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Entrate', data: months.map(m => byM[m].ent), backgroundColor: 'rgba(42,157,92,.7)', borderRadius: 3, barPercentage: .4 },
                    { label: 'Uscite', data: months.map(m => byM[m].usc), backgroundColor: 'rgba(212,51,51,.6)', borderRadius: 3, barPercentage: .4 }
                ]
            },
            options: opts
        });
    }

    if (ch2 && ch2El) ch2.destroy();
    if(ch2El) {
        ch2 = new Chart(ch2El, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Lavaggio', data: months.map(m => byM[m].lav), backgroundColor: 'rgba(37,99,235,.65)', borderRadius: 3, barPercentage: .4 },
                    { label: 'Parcheggio', data: months.map(m => byM[m].par), backgroundColor: 'rgba(245,197,24,.75)', borderRadius: 3, barPercentage: .4 }
                ]
            },
            options: opts
        });
    }
}

async function sendChat() {
    const inp = document.getElementById('chatIn');
    if(!inp) return;
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
        const rows = (state.rawData?.primaNota?.rows || []).filter(r => {
            const d = r.dataISO ? new Date(r.dataISO) : pDate(r.DATA || r.Data);
            return d && d >= state.dateFrom && d <= state.dateTo;
        });
        
        let ent = 0, usc = 0;
        rows.forEach(r => {
            ent += pNum(r.ENTRATA || r.Entrata);
            usc += pNum(r.USCITE || r.Uscite || r.USCITA);
        });

        const ctx = `Dati WASH HUB:\n- Entrate: €${ent.toFixed(2)}\n- Uscite: €${usc.toFixed(2)}\n- Margine: €${(ent - usc).toFixed(2)}\n- Abbonati: ${state.localAbb.length}\n- Sospesi aperti: ${state.localSosp.filter(s => !s._pagato).length}\n\nDomanda: ${text}`;

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
            let d = JSON.parse(txt);
            finalReply = d.output || d.reply || d.text || d.response || d.message || '';
            if (Array.isArray(d) && d.length > 0) {
                finalReply = d[0].output || d[0].text || d[0].message || JSON.stringify(d[0]);
            }
        } catch (e) {
            const lines = txt.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const parsedLine = JSON.parse(line);
                        if (parsedLine.type === 'item' && parsedLine.content) {
                            finalReply += parsedLine.content;
                        }
                    } catch (err) {}
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
        if (e.name === 'AbortError') {
            msgs.innerHTML += `<div class="msg bot" style="border-color:var(--amb)">⚠️ Timeout (30s). Vai su n8n.</div>`;
        } else {
            msgs.innerHTML += `<div class="msg bot" style="border-color:var(--red)">⚠️ Errore di connessione: ${esc(e.message)}</div>`;
        }
    }
    msgs.scrollTop = msgs.scrollHeight;
}
