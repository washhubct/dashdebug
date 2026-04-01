import { db, fsCollection, fsAddDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { esc } from '../utils.js';

// Funzione che salva la cancellazione su Firebase
export async function logDelete(sezione, dettaglio, motivazione) {
    const now = new Date();
    const operatore = state.currentUser ? state.currentUser.user : 'Staff';
    const dataOra = now.toLocaleDateString('it-IT') + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');

    const obj = { data: dataOra, timestamp: now.getTime(), operatore: operatore, sezione: sezione, dettaglio: dettaglio, motivazione: motivazione };
    try {
        const docRef = await fsAddDoc(fsCollection(db, "cancellazioni"), obj);
        obj._id = docRef.id;
        state.logDB.push(obj);
    } catch(e) { console.error("Errore salvataggio log", e); }
}

// Funzione che disegna la tabella per l'Amministratore
export function renderCancellazioni() {
    const tb = document.getElementById('cancTb');
    if(!tb) return;
    
    if(!state.logDB || !state.logDB.length) { 
        tb.innerHTML = '<tr><td colspan="5" class="empty">Nessuna cancellazione registrata</td></tr>'; 
        return; 
    }

    let html = '';
    // Ordina dal più recente al più vecchio
    const sorted = [...state.logDB].sort((a,b) => (b.timestamp||0) - (a.timestamp||0));
    sorted.forEach(l => {
        html += `<tr>
            <td style="font:400 11px var(--mono)">${l.data}</td>
            <td><strong>${esc(l.operatore)}</strong></td>
            <td><span class="badge a">${esc(l.sezione)}</span></td>
            <td style="font-size:11px">${esc(l.dettaglio)}</td>
            <td style="color:var(--red);font-style:italic;font-size:11px">"${esc(l.motivazione)}"</td>
        </tr>`;
    });
    tb.innerHTML = html;
}

// Inizializza i bottoni della pagina Log
export function initLog() {
    const page = document.getElementById('page-cancellazioni');
    if(page) {
        // Cerca il bottone "Aggiorna" dentro la pagina
        const refreshBtn = page.querySelector('.btn');
        if(refreshBtn) {
            refreshBtn.addEventListener('click', renderCancellazioni);
        }
    }
}
