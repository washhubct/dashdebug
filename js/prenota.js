import { db, fsCollection, fsGetDocs, fsAddDoc } from './firebase-config.js';
import { query, where } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const SLOTS = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00'];
const MAX_AUTO_PER_SLOT = 1;

// ─── GIORNI DI CHIUSURA ───
const GIORNI_CHIUSI = [
    '2026-04-06',  // Pasquetta
    '2026-05-01',  // Festa dei Lavoratori
    '2026-06-02',  // Festa della Repubblica
];

// Carica chiusure extra da Firestore (se esistono)
let chiusureFirestore = [];
async function caricaChiusure() {
    try {
        const snap = await fsGetDocs(fsCollection(db, 'chiusure'));
        snap.forEach(doc => {
            const d = doc.data();
            if (d.data) chiusureFirestore.push(d.data);
        });
    } catch (e) {
        // Collezione non esiste ancora, va bene
    }
}

function isGiornoChiuso(dateStr) {
    // Check hardcoded
    if (GIORNI_CHIUSI.includes(dateStr)) return true;
    // Check Firestore
    if (chiusureFirestore.includes(dateStr)) return true;
    // Check domenica
    const d = new Date(dateStr);
    if (d.getDay() === 0) return true;
    return false;
}

const servizioInput = document.getElementById('pServizio');
const dateSection = document.getElementById('dateSection');
const dateInput = document.getElementById('pDate');
const slotSection = document.getElementById('slotSection');
const slotContainer = document.getElementById('slotContainer');
const slotMsg = document.getElementById('slotMsg');
const datiSection = document.getElementById('datiSection');
const selectedSlotInput = document.getElementById('selectedSlot');
const form = document.getElementById('bookingForm');
const submitBtn = document.getElementById('submitBtn');

const today = new Date();
const localToday = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
dateInput.min = localToday;

// Carica chiusure all'avvio
caricaChiusure();

// Step 1: Sceglie il servizio -> Mostra la data
servizioInput.addEventListener('change', () => {
    dateSection.style.display = 'block';
});

// Step 2: Sceglie la data -> Calcola e mostra gli orari
dateInput.addEventListener('change', async () => {
    const selectedDate = dateInput.value;
    if(!selectedDate) return;

    datiSection.style.display = 'none';
    selectedSlotInput.value = '';
    
    slotSection.style.display = 'block';
    slotContainer.innerHTML = '';

    // Controlla se è giorno chiuso
    if (isGiornoChiuso(selectedDate)) {
        slotMsg.textContent = '🚫 Siamo chiusi in questa data. Seleziona un altro giorno.';
        slotMsg.style.color = '#d43333';
        return;
    }

    slotMsg.style.color = '';
    slotMsg.textContent = 'Verifico disponibilità in tempo reale... ⏳';

    try {
        // Query filtrata by dataPren: leggiamo solo le prenotazioni del giorno
        // selezionato invece dell'intera collezione (privacy + performance).
        const q = query(fsCollection(db, 'prenotazioni'), where('dataPren', '==', selectedDate));
        const snap = await fsGetDocs(q);
        let countPerSlot = {};

        snap.forEach(doc => {
            const data = doc.data();
            countPerSlot[data.orario] = (countPerSlot[data.orario] || 0) + 1;
        });

        slotMsg.textContent = 'Seleziona un orario:';
        
        SLOTS.forEach(slot => {
            const btn = document.createElement('button');
            btn.type = 'button';
            
            const isFull = (countPerSlot[slot] || 0) >= MAX_AUTO_PER_SLOT;
            
            let isPast = false;
            if (selectedDate === localToday) {
                const now = new Date();
                const nowHour = now.getHours();
                const nowMin = now.getMinutes();
                const [slotH, slotM] = slot.split(':').map(Number);
                if (slotH < nowHour || (slotH === nowHour && slotM <= nowMin)) {
                    isPast = true;
                }
            }

            if (isFull || isPast) {
                btn.className = 'slot-btn full';
                btn.disabled = true;
                btn.textContent = slot;
            } else {
                btn.className = 'slot-btn';
                btn.textContent = slot;
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    selectedSlotInput.value = slot;
                    
                    datiSection.style.display = 'block';
                });
            }
            slotContainer.appendChild(btn);
        });

    } catch (e) {
        console.error(e);
        slotMsg.textContent = '⚠️ Errore di connessione. Riprova.';
    }
});

// Invio finale
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const serv = servizioInput.value;
    const date = dateInput.value;
    const slot = selectedSlotInput.value;
    const nome = document.getElementById('pNome').value.trim().toUpperCase();
    const tel = document.getElementById('pTel').value.trim();
    const vettura = document.getElementById('pVettura').value.trim().toUpperCase();
    const targa = document.getElementById('pTarga').value.trim().toUpperCase();
    
    if(!serv || !date || !slot || !nome || !tel || !vettura) return;

    let noteText = `[WEB] Servizio: ${serv} | Tel: ${tel}`;
    if(targa) noteText += ` | Targa: ${targa}`;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Invio in corso... ⏳';

    try {
        await fsAddDoc(fsCollection(db, "prenotazioni"), {
            dataPren: date,
            orario: slot,
            cliente: nome,
            vettura: vettura,
            prezzo: '', 
            note: noteText,
            saldo: '',
            saldato: ''
        });

        document.getElementById('bookingScreen').style.display = 'none';
        document.getElementById('successScreen').style.display = 'block';
    } catch (err) {
        alert("Errore durante l'invio. Verifica la connessione.");
        submitBtn.disabled = false;
        submitBtn.textContent = 'Conferma Prenotazione';
    }
});
