// UI condivisa Fatture in Cloud: esito emissione (con riprova invio SDI)
// e scelta "incassa adesso". Usata da sospesi, prenotazioni, abbonamenti.
import { ficCall } from '../firebase-config.js';
import { esc, fEur } from '../utils.js';

/**
 * Modale post-fattura. Se la fattura non è partita verso SDI mostra l'errore
 * e un tasto "Riprova invio" (dopo aver corretto l'anagrafica su CRM/FIC).
 * opts.chiediIncasso: mostra "Il cliente paga adesso?" → resolve(true/false).
 * Altrimenti resolve(false) alla chiusura.
 */
export function mostraEsitoFattura(res, { label = '', totale = 0, chiediIncasso = false, giaPagata = false } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px';
        const sdiHtml = (inviata, err) => inviata
            ? `<span style="color:var(--grn)">📤 Inviata a SDI</span>`
            : `<div style="background:rgba(255,59,48,.12);border:1px solid var(--red);border-radius:var(--r2);padding:8px 10px;color:var(--red)">
                 ⚠️ <strong>NON inviata a SDI</strong><br><span style="font-size:10px">${esc(err || 'errore')}</span><br>
                 <button id="_fiRetry" class="btn" style="margin-top:8px;font-size:11px;border-color:var(--red);color:var(--red)">🔁 Riprova invio SDI</button>
               </div>`;
        overlay.innerHTML = `
            <div style="background:var(--bg2);border-radius:var(--r);padding:20px;width:100%;max-width:380px;box-shadow:0 12px 40px rgba(0,0,0,.5)">
                <div style="font:700 15px var(--f);margin-bottom:4px">✅ Fattura n. ${esc(String(res.numero ?? '—'))} creata${giaPagata ? ' · 💰 pagata' : ''}</div>
                <div style="font:400 12px var(--f);color:var(--tx2);margin-bottom:6px"><strong>${esc(label)}</strong> — ${fEur(res.totale ?? totale)}</div>
                <div id="_fiSdi" style="font:400 11px var(--f);margin-bottom:14px">${sdiHtml(res.inviata, res.invioErrore)}${res.clienteCreato ? '<br><span style="color:var(--tx3)">Cliente creato su FIC coi dati del CRM</span>' : ''}</div>
                ${chiediIncasso ? `
                <div style="font:600 13px var(--f);margin-bottom:10px">Il cliente paga adesso?</div>
                <div style="display:flex;flex-direction:column;gap:8px">
                    <button id="_fiOra" class="btn btn-primary">💰 Incassa adesso (contanti / POS / bonifico)</button>
                    <button id="_fiDopo" class="btn" style="color:var(--tx3);font-size:11px">Più tardi — resta in "Fatturati"</button>
                </div>` : `<button id="_fiDopo" class="btn btn-primary" style="width:100%">OK</button>`}
            </div>`;
        document.body.appendChild(overlay);
        const bindRetry = () => {
            const b = overlay.querySelector('#_fiRetry');
            if (!b) return;
            b.addEventListener('click', async () => {
                b.disabled = true; b.textContent = '⏳ Invio…';
                try {
                    const r = await ficCall('inviaSdi', { ficDocId: res.ficDocId });
                    res.inviata = r.inviata; res.invioErrore = r.invioErrore;
                } catch (e) { res.inviata = false; res.invioErrore = e.message || 'errore'; }
                overlay.querySelector('#_fiSdi').innerHTML = sdiHtml(res.inviata, res.invioErrore);
                bindRetry();
            });
        };
        bindRetry();
        overlay.querySelector('#_fiOra')?.addEventListener('click', () => { overlay.remove(); resolve(true); });
        overlay.querySelector('#_fiDopo').addEventListener('click', () => { overlay.remove(); resolve(false); });
    });
}

/** Segna pagata su FIC la fattura collegata (best effort: non blocca l'incasso). */
export async function segnaPagataFIC(ficDocId, modalita) {
    if (!ficDocId) return;
    try { await ficCall('segnaPagata', { ficDocId, modalita }); }
    catch (e) { console.warn('[FIC] segnaPagata', ficDocId, e.message); alert('⚠️ Incasso salvato, ma non sono riuscito a segnare la fattura come pagata su FIC:\n' + (e.message || 'errore')); }
}
