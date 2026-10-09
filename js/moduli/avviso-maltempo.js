// ─── AVVISO MALTEMPO (09/10/2026) ───
// Per il giorno mostrato in Prenotazioni: elenco clienti prenotati con messaggio WhatsApp già scritto.
// Invio A MANO, un tap per cliente (wa.me): niente worker automatico — il numero è stato bloccato
// il 02/10 per invii massivi, mai più bot sullo stesso numero (decisione 09/10/2026).
// Sulla prenotazione resta `avvisoMaltempo` (ISO) così si vede a chi è già stato mandato.
import { db, fsDoc, fsUpdateDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { esc, formatPhoneForWA } from '../utils.js';
import { isNoShow } from './prenotazioni.js';

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const TESTO_DEFAULT = 'Ciao {nome}, a causa del maltempo {giorno} restiamo chiusi 🌧️ Il tuo lavaggio delle {orario} lo spostiamo volentieri: rispondi con il giorno che preferisci. Grazie e scusa il disagio! Wash Hub';

export function initAvvisoMaltempo() {
    document.getElementById('avvisoMaltempoBtn')?.addEventListener('click', apriAvviso);
}

function giornoLabel(iso) {
    const d = new Date(iso + 'T12:00:00');
    const oggi = new Date(); oggi.setHours(12, 0, 0, 0);
    const diff = Math.round((d - oggi) / 86400000);
    if (diff === 0) return 'oggi';
    if (diff === 1) return 'domani';
    return `${GIORNI[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

const primoNome = n => {
    const s = String(n || '').trim().split(/\s+/)[0] || '';
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
};

function apriAvviso() {
    const data = document.getElementById('prenData')?.value;
    if (!data) return;
    const lista = (state.prenDB[data] || [])
        .filter(e => !isNoShow(e) && e.saldato !== 'SI')
        .sort((a, b) => String(a.orario || '').localeCompare(String(b.orario || '')));
    let testo = TESTO_DEFAULT;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10002;display:flex;align-items:flex-start;justify-content:center;padding:20px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);overflow-y:auto';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg2);border-radius:var(--r);padding:22px 20px;max-width:620px;width:100%;box-shadow:var(--shadow-xl);margin-top:10px';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    const chiudi = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) chiudi(); });

    const msgPer = e => testo
        .replaceAll('{nome}', primoNome(e.cliente))
        .replaceAll('{orario}', e.orario || '')
        .replaceAll('{giorno}', giornoLabel(data));

    function render() {
        const inviati = lista.filter(e => e.avvisoMaltempo).length;
        const righe = lista.map((e, i) => {
            const tel = formatPhoneForWA(e.telefono);
            const fatto = !!e.avvisoMaltempo;
            return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--brd)">
                <span style="font:600 12px var(--mono);width:44px">${esc(e.orario || '')}</span>
                <span style="flex:1;min-width:0"><strong>${esc(e.cliente || '')}</strong><br><span style="font-size:11px;color:var(--tx3)">${esc(e.vettura || '')}${tel ? '' : ' · ⚠️ telefono non valido'}</span></span>
                ${fatto ? '<span class="badge g" style="font-size:10px">✓ inviato</span>' : ''}
                <button class="btn ${fatto ? '' : 'btn-primary'}" data-i="${i}" ${tel ? '' : 'disabled'} style="white-space:nowrap">${fatto ? 'Rimanda' : '💬 Invia'}</button>
            </div>`;
        }).join('');
        modal.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <h3 style="margin:0">⛈️ Avviso maltempo · ${esc(giornoLabel(data))}</h3>
                <button class="btn" id="amClose">✕</button>
            </div>
            <p style="font-size:12px;color:var(--tx2);margin:0 0 12px">Un tap per cliente: si apre WhatsApp col messaggio pronto, premi Invia e torna qui. ${inviati}/${lista.length} inviati.</p>
            <label style="font-size:11px;color:var(--tx3)">Messaggio ({nome}, {orario}, {giorno} si compilano da soli)</label>
            <textarea id="amTesto" rows="4" style="width:100%;margin:4px 0 12px;background:var(--bg3);border:1px solid var(--brd);color:var(--tx);border-radius:var(--r2);padding:8px;font:400 13px var(--f)">${esc(testo)}</textarea>
            ${lista.length ? righe : '<p style="color:var(--tx3)">Nessuna prenotazione da avvisare in questo giorno.</p>'}`;
        modal.querySelector('#amClose').onclick = chiudi;
        modal.querySelector('#amTesto').oninput = ev => { testo = ev.target.value; };
        modal.querySelectorAll('button[data-i]').forEach(b => b.onclick = async () => {
            const e = lista[+b.dataset.i];
            const tel = formatPhoneForWA(e.telefono);
            if (!tel) return;
            window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msgPer(e))}`, '_blank');
            const quando = new Date().toISOString();
            e.avvisoMaltempo = quando;
            render();
            try { await fsUpdateDoc(fsDoc(db, 'prenotazioni', e._pid), { avvisoMaltempo: quando }); }
            catch (err) { console.warn('[avviso-maltempo] flag non salvato', e._pid, err?.message); }
        });
    }
    render();
}
