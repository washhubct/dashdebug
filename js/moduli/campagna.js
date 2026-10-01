// ─── CAMPAGNA RICHIAMO WHATSAPP (01/10/2026) ───
// Scorre i clienti "a rischio" (31-90 gg) e "dormienti" (>90 gg) uno alla volta:
// per ognuno apre WhatsApp (wa.me) col messaggio già scritto e segna sul cliente
// `ultimoRichiamo` (ISO) + `richiami[]`, così chi è stato contattato esce dalla lista.
// L'invio automatico senza premere "invia" richiede le WhatsApp Cloud API con
// template approvato da Meta (messaggi.js): quando il setup Meta è completo il
// pulsante "Invia a tutti" potrà usare quello. Fino ad allora: un tap per cliente.
import { db, fsDoc, fsUpdateDoc, fsGetDoc, fsCollection, fsAddDoc, fsOnSnapshot } from '../firebase-config.js';
import { query, where } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { state } from '../state.js';
import { esc, fEur, fmtDI, formatPhoneForWA } from '../utils.js';
import { WA_TEMPLATES, fillTemplate, calcolaStatsCliente } from './clienti.js';

const GIORNI_ESCLUSIONE = 30; // già contattato da meno di N giorni → fuori lista
// Invio massivo = coda `whatsappCoda` svuotata dal worker WhatsApp Web sul Mac Mini
// (scripts/wa-worker/). Stato del worker in config/whatsapp.worker (online, inviatiOggi…).
let cloud = null;
let unsubCfg = null;

function ascoltaConfig(onChange) {
    if (unsubCfg) unsubCfg();
    unsubCfg = fsOnSnapshot(fsDoc(db, 'config', 'whatsapp'), snap => { cloud = snap.exists() ? snap.data() : { enabled: false }; onChange?.(); }, () => { cloud = { enabled: false }; onChange?.(); });
}
const workerOnline = () => !!(cloud?.worker?.online && Date.now() - (cloud.worker.ultimoPing || 0) < 60000);
const workerAttivo = () => cloud?.enabled !== false && cloud?.via === 'web';

export function initCampagna() {
    document.getElementById('campagnaBtn')?.addEventListener('click', apriCampagna);
}

function segmento(c, seg) {
    const gg = c._giorniDaUltimaVisita ?? 999;
    if (!(c._numLavaggi > 0)) return false;          // mai venuto: non è un richiamo
    if (seg === 'rischio') return gg > 30 && gg <= 90;
    if (seg === 'dormienti') return gg > 90 && gg <= 365; // oltre un anno: lista a parte, non spam
    return gg > 30 && gg <= 365;
}

function giorniDaRichiamo(c) {
    if (!c.ultimoRichiamo) return 999;
    return Math.floor((new Date() - new Date(c.ultimoRichiamo)) / 864e5);
}

function lista(seg, escludiContattati) {
    return (state.clientiDB || [])
        .filter(c => formatPhoneForWA(c.telefono) && segmento(c, seg) && (!escludiContattati || giorniDaRichiamo(c) >= GIORNI_ESCLUSIONE))
        .sort((a, b) => (a._giorniDaUltimaVisita ?? 999) - (b._giorniDaUltimaVisita ?? 999)); // prima chi è andato via da meno (più recuperabile)
}

async function apriCampagna() {
    const clienti = state.clientiDB || [];
    if (!clienti.length) { alert('Clienti non caricati'); return; }
    // stats fresche (renderClienti le mette in cache, ma la campagna può partire prima)
    for (const c of clienti) if (c._giorniDaUltimaVisita == null) { const s = calcolaStatsCliente(c.nome); c._giorniDaUltimaVisita = s.giorniDaUltimaVisita; c._numLavaggi = s.numLavaggi; c._ultimaVisita = s.ultimaVisita; }

    let seg = 'rischio', escludi = true, idx = 0, coda = lista(seg, escludi), inviati = 0;
    let campagnaId = null, codaStato = null, unsubCoda = null; // avanzamento dell'ultima messa in coda
    const tplIdx = Math.max(0, WA_TEMPLATES.findIndex(t => t.id === 'richiamo'));
    let testoTpl = WA_TEMPLATES[tplIdx].text;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10002;display:flex;align-items:flex-start;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);overflow-y:auto';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg2);border-radius:var(--r);padding:22px 20px;max-width:620px;width:100%;box-shadow:var(--shadow-xl);margin-top:10px';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const conta = s => ({ rischio: lista('rischio', escludi).length, dormienti: lista('dormienti', escludi).length, tutti: lista('tutti', escludi).length })[s];

    function render() {
        const c = coda[idx];
        const n = coda.length;
        modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <h3 style="font:700 16px var(--f)">📣 Campagna richiamo WhatsApp</h3>
                <button class="btn" id="cpClose">✕</button>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
                <button class="qbtn ${seg === 'rischio' ? 'on' : ''}" data-seg="rischio">A rischio (31-90gg) · ${conta('rischio')}</button>
                <button class="qbtn ${seg === 'dormienti' ? 'on' : ''}" data-seg="dormienti">Dormienti (91-365gg) · ${conta('dormienti')}</button>
                <button class="qbtn ${seg === 'tutti' ? 'on' : ''}" data-seg="tutti">Entrambi · ${conta('tutti')}</button>
                <label style="margin-left:auto;display:flex;align-items:center;gap:6px;font:500 11px var(--f);cursor:pointer"><input type="checkbox" id="cpEscl" ${escludi ? 'checked' : ''}> escludi contattati da meno di ${GIORNI_ESCLUSIONE}gg</label>
            </div>
            <div class="ff" style="margin-bottom:10px">
                <label>Template <span style="color:var(--tx3);font-weight:400">({nomeShort}, {giorni}, {numLavaggi}, {telefono})</span></label>
                <select id="cpTpl">${WA_TEMPLATES.filter(t => t.id !== 'custom').map((t, i) => `<option value="${i}" ${t.text === testoTpl ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
                <textarea id="cpTesto" rows="6" style="width:100%;margin-top:6px;font:400 13px var(--f);padding:10px 12px;border:1.5px solid var(--brd2);border-radius:var(--r2);resize:vertical">${esc(testoTpl)}</textarea>
            </div>
            ${!n ? `<div class="empty" style="padding:24px">Nessun cliente da contattare in questo segmento${escludi ? ' (o già tutti contattati negli ultimi ' + GIORNI_ESCLUSIONE + ' giorni)' : ''}.</div>` : `
            ${workerAttivo() ? `
            <div style="padding:12px 14px;background:${workerOnline() ? 'var(--grn1)' : 'var(--bg4)'};border:1px solid ${workerOnline() ? 'var(--grn)' : 'var(--brd)'};border-radius:var(--r2);margin-bottom:10px">
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                    <div style="flex:1;font:400 11px var(--f);color:var(--tx2)">
                        <b>Worker WhatsApp Web (Mac Mini): ${workerOnline() ? '🟢 online' : '🔴 offline'}</b>${cloud.worker?.numero ? ` · numero ${esc(cloud.worker.numero)}` : ''}${cloud.worker?.qrPending ? ' · <span style="color:var(--amb)">in attesa del QR</span>' : ''}<br>
                        oggi ${cloud.worker?.inviatiOggi || 0}/${cloud.limiti?.maxGiorno || 70} inviati · pausa ${cloud.limiti?.minPausaSec || 35}-${cloud.limiti?.maxPausaSec || 95}s · orario ${cloud.limiti?.oraInizio || 9}-${cloud.limiti?.oraFine || 20}${cloud.worker?.errore ? `<br><span style="color:var(--red)">${esc(cloud.worker.errore)}</span>` : ''}
                    </div>
                    <button class="btn btn-primary" id="cpBulk" style="background:#25D366;border-color:#25D366" ${workerOnline() ? '' : 'disabled title="Worker offline"'}>🚀 Metti in coda i ${n - idx}</button>
                </div>
                <div id="cpBulkEsito" style="margin-top:8px">${codaStato ? `<div style="font:500 12px var(--f)">📤 in coda ${codaStato.in_coda} · ✅ inviati ${codaStato.inviato} · ❌ falliti ${codaStato.fallito}${codaStato.falliti.length ? `<div style="font:400 10px var(--mono);color:var(--red);margin-top:4px">${codaStato.falliti.map(f => esc(f.nome) + ': ' + esc(f.errore || '')).join(' · ')}</div>` : ''}</div>` : ''}</div>
            </div>` : `
            <div style="font:400 11px var(--f);color:var(--tx3);margin-bottom:8px">Invio massivo non configurato (config/whatsapp.via = 'web' + worker sul Mac Mini). Intanto: un tap per cliente.</div>`}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <span style="font:600 12px var(--mono);color:var(--tx2)">${Math.min(idx + 1, n)} / ${n}</span>
                <span style="font:600 12px var(--mono);color:var(--grn)">✅ inviati ${inviati}</span>
            </div>
            ${c ? `
            <div style="padding:12px 14px;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r2);margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
                    <div style="font:700 14px var(--f)">${esc(c.nome)}${c.prezzoVip > 0 ? ' <span class="badge b" style="font-size:8px">⭐ VIP</span>' : ''}</div>
                    <div style="font:500 11px var(--mono);color:var(--tx3)">${esc(c.telefono)}</div>
                </div>
                <div style="font:400 11px var(--f);color:var(--tx2);margin-top:4px">${c._numLavaggi} lavaggi · ultimo ${esc(c._ultimaVisita || '—')} (${c._giorniDaUltimaVisita} gg fa) · speso ${fEur(c._spesaTotale || 0)}${c.ultimoRichiamo ? ` · già contattato il ${esc(String(c.ultimoRichiamo).split('-').reverse().join('/'))}` : ''}</div>
                <pre id="cpPreview" style="white-space:pre-wrap;font:400 12px var(--f);color:var(--tx);background:var(--bg3);padding:10px;border-radius:var(--r2);margin-top:8px">${esc(fillTemplate(testoTpl, c, calcolaStatsCliente(c.nome)))}</pre>
            </div>
            <div style="display:flex;gap:8px">
                <button class="btn" id="cpSkip" style="flex:1">⏭ Salta</button>
                <button class="btn btn-primary" id="cpSend" style="flex:2;background:#25D366;border-color:#25D366">📱 Apri WhatsApp e segna inviato</button>
            </div>
            <p style="font:400 11px var(--f);color:var(--tx3);margin-top:8px">Si apre WhatsApp col testo pronto: premi invio lì, poi torna qui — il prossimo cliente è già caricato.</p>
            ` : `<div class="empty" style="padding:24px">🎉 Lista finita: ${inviati} messaggi inviati.</div>`}`}`;

        modal.querySelector('#cpClose').onclick = chiudi;
        modal.querySelectorAll('[data-seg]').forEach(b => b.onclick = () => { seg = b.dataset.seg; idx = 0; coda = lista(seg, escludi); render(); });
        modal.querySelector('#cpEscl').onchange = e => { escludi = e.target.checked; idx = 0; coda = lista(seg, escludi); render(); };
        modal.querySelector('#cpTpl').onchange = e => { testoTpl = WA_TEMPLATES.filter(t => t.id !== 'custom')[+e.target.value].text; render(); };
        modal.querySelector('#cpTesto').oninput = e => { testoTpl = e.target.value; const pv = modal.querySelector('#cpPreview'); if (pv && c) pv.textContent = fillTemplate(testoTpl, c, calcolaStatsCliente(c.nome)); };
        modal.querySelector('#cpSkip')?.addEventListener('click', () => { idx++; render(); });
        modal.querySelector('#cpBulk')?.addEventListener('click', async (ev) => {
            const restanti = coda.slice(idx);
            if (!restanti.length) return;
            const lim = cloud?.limiti?.maxGiorno || 70;
            const giorni = Math.ceil(restanti.length / lim);
            if (!confirm(`Mettere in coda ${restanti.length} messaggi (${seg})?\nIl Mac Mini li manda uno alla volta a ritmo umano (max ${lim}/giorno → circa ${giorni} giorn${giorni === 1 ? 'o' : 'i'}).`)) return;
            const btn = ev.currentTarget; btn.disabled = true; btn.textContent = '⏳ metto in coda…';
            campagnaId = `camp_${Date.now()}`;
            const operatore = state.currentUser?.user || 'Staff';
            const tplId = (WA_TEMPLATES.find(t => t.text === testoTpl)?.id) || 'custom';
            let n = 0;
            for (const c of restanti) {
                const testo = fillTemplate(testoTpl, c, calcolaStatsCliente(c.nome)).trim();
                if (!testo) continue;
                try {
                    await fsAddDoc(fsCollection(db, 'whatsappCoda'), { telefono: c.telefono, clienteId: c._id, nome: c.nome, testo, stato: 'in_coda', campagnaId, segmento: seg, template: tplId, operatore, creato: Date.now() + n, sedeId: state.sedeAttiva });
                    n++;
                } catch (e) { console.warn('coda:', e.message); }
            }
            inviati += n; idx = coda.length;
            ascoltaCoda();
            render();
        });
        modal.querySelector('#cpSend')?.addEventListener('click', async () => {
            const msg = fillTemplate(testoTpl, c, calcolaStatsCliente(c.nome)).trim();
            if (!msg) { alert('Messaggio vuoto'); return; }
            window.open(`https://wa.me/${formatPhoneForWA(c.telefono)}?text=${encodeURIComponent(msg)}`, '_blank');
            const oggi = fmtDI(new Date());
            const ric = { data: oggi, segmento: seg, template: (WA_TEMPLATES.find(t => t.text === testoTpl)?.id) || 'custom', operatore: state.currentUser?.user || 'Staff', gg: c._giorniDaUltimaVisita };
            try { await fsUpdateDoc(fsDoc(db, 'clienti', c._id), { ultimoRichiamo: oggi, richiami: [...(c.richiami || []), ric].slice(-20) }); }
            catch (e) { console.warn('richiamo non salvato:', e.message); }
            c.ultimoRichiamo = oggi; c.richiami = [...(c.richiami || []), ric];
            inviati++; idx++;
            render();
        });
    }
    function ascoltaCoda() {
        if (unsubCoda) unsubCoda();
        if (!campagnaId) return;
        unsubCoda = fsOnSnapshot(query(fsCollection(db, 'whatsappCoda'), where('campagnaId', '==', campagnaId)), snap => {
            const st = { in_coda: 0, inviato: 0, fallito: 0, falliti: [] };
            snap.forEach(d => { const m = d.data(); st[m.stato] = (st[m.stato] || 0) + 1; if (m.stato === 'fallito') st.falliti.push(m); });
            codaStato = st;
            const es = modal.querySelector('#cpBulkEsito');
            if (es) es.innerHTML = `<div style="font:500 12px var(--f)">📤 in coda ${st.in_coda} · ✅ inviati ${st.inviato} · ❌ falliti ${st.fallito}${st.falliti.length ? `<div style="font:400 10px var(--mono);color:var(--red);margin-top:4px">${st.falliti.map(f => esc(f.nome) + ': ' + esc(f.errore || '')).join(' · ')}</div>` : ''}</div>`;
        });
    }
    const chiudi = () => { overlay.remove(); if (unsubCoda) unsubCoda(); if (unsubCfg) { unsubCfg(); unsubCfg = null; } };
    ascoltaConfig(() => { if (document.body.contains(overlay) && !modal.querySelector('#cpBulk:disabled')) render(); });
    render();
}
