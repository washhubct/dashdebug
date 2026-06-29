// ═══════════════════════════════════════════════════════════════════
// FidelAI — UI riscatto codici + lookup cliente
// Tutte le chiamate passano da Cloud Functions dashdebug (fidelaiRedeem)
// che proxa verso le external API di fideliai-app col Bearer secret.
// Lookup customer/transactions usa un SDK Firebase separato verso
// fideliai-app (lettura pubblica concessa dalle rules).
// ═══════════════════════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import {
    getFirestore,
    doc,
    getDoc,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js';
import { esc } from '../utils.js';

const FIDELAI_CONFIG = {
    apiKey: 'AIzaSyD7kHbNv09Mg-aYfFXSMKrVdi_JqlOuQF4',
    authDomain: 'fideliai-app.firebaseapp.com',
    projectId: 'fideliai-app',
    storageBucket: 'fideliai-app.firebasestorage.app',
    messagingSenderId: '49232775542',
    appId: '1:49232775542:web:e5e5771426462389c5d257',
};
const MERCHANT_ID = 'TSfZHShvSqOu4gPGA9JcV0IqmjI2';
const REGION = 'europe-west1';

let fidelaiDb = null;
let initialized = false;

function ensureFidelaiDb() {
    if (fidelaiDb) return fidelaiDb;
    const app = initializeApp(FIDELAI_CONFIG, 'fidelai-readonly');
    fidelaiDb = getFirestore(app);
    return fidelaiDb;
}

export function initFidelai() {
    if (initialized) return;
    initialized = true;

    const codeInput = document.getElementById('fidelaiCodeInput');
    const redeemBtn = document.getElementById('fidelaiRedeemBtn');
    if (codeInput) {
        codeInput.addEventListener('input', () => {
            codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4);
        });
        codeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleRedeem();
        });
    }
    if (redeemBtn) redeemBtn.addEventListener('click', handleRedeem);

    const lookupInput = document.getElementById('fidelaiLookupInput');
    const lookupBtn = document.getElementById('fidelaiLookupBtn');
    if (lookupInput) {
        lookupInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLookup();
        });
    }
    if (lookupBtn) lookupBtn.addEventListener('click', handleLookup);
}

function normalizePhone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('39') && d.length > 10) return d.slice(2);
    return d;
}

async function handleRedeem() {
    const codeInput = document.getElementById('fidelaiCodeInput');
    const btn = document.getElementById('fidelaiRedeemBtn');
    const result = document.getElementById('fidelaiRedeemResult');
    const code = (codeInput?.value || '').replace(/\D/g, '');
    if (code.length !== 4) {
        showResult(result, 'Inserisci 4 cifre', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = '…';
    showResult(result, '<em>Verifica codice…</em>', 'info');

    try {
        const functions = getFunctions(undefined, REGION);
        const call = httpsCallable(functions, 'fidelaiRedeem');
        const res = await call({ code });
        const data = res.data || {};
        if (!data.ok) throw new Error(data.error || 'Errore');

        const html = `
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
                <div style="font-size:32px">✅</div>
                <div>
                    <div style="font:700 16px var(--f);color:var(--tx)">${esc(data.customerName || 'Cliente')}</div>
                    <div style="font:400 13px var(--f);color:var(--tx2)">${esc(data.rewardName || '')}</div>
                </div>
            </div>
            <div style="font:400 13px var(--f);color:var(--tx2)">
                –${esc(String(data.pointsCost || 0))} punti • Nuovo saldo: <strong>${esc(String(data.newPoints || 0))}</strong>
            </div>
        `;
        showResult(result, html, 'success');
        codeInput.value = '';
    } catch (ex) {
        const msg = ex?.message || 'Errore';
        showResult(result, esc(msg), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Applica';
    }
}

function showResult(el, html, kind) {
    if (!el) return;
    const colors = {
        success: { bg: 'var(--grn1,#dcfce7)', color: 'var(--grn,#166534)' },
        error:   { bg: 'var(--red1,#fee2e2)', color: 'var(--red,#991b1b)' },
        info:    { bg: 'var(--bg2)',         color: 'var(--tx2)' },
    };
    const c = colors[kind] || colors.info;
    el.style.display = 'block';
    el.style.background = c.bg;
    el.style.color = c.color;
    el.innerHTML = html;
}

async function handleLookup() {
    const input = document.getElementById('fidelaiLookupInput');
    const btn = document.getElementById('fidelaiLookupBtn');
    const result = document.getElementById('fidelaiLookupResult');
    const phone = normalizePhone(input?.value);
    if (phone.length < 9) {
        result.style.display = 'block';
        result.innerHTML = '<p style="color:var(--red);font:500 13px var(--f);margin-top:8px">Numero non valido</p>';
        return;
    }

    btn.disabled = true;
    btn.textContent = '…';
    result.style.display = 'block';
    result.innerHTML = '<p style="color:var(--tx2);font:400 13px var(--f);margin-top:8px"><em>Caricamento…</em></p>';

    try {
        const db = ensureFidelaiDb();
        const customerRef = doc(db, `merchants/${MERCHANT_ID}/customers/${phone}`);
        const cSnap = await getDoc(customerRef);
        if (!cSnap.exists()) {
            result.innerHTML = '<p style="color:var(--tx2);font:500 13px var(--f);margin-top:8px;padding:14px;background:var(--bg2);border-radius:var(--r2)">Cliente non trovato — non ha ancora attivato la card.</p>';
            return;
        }
        const c = cSnap.data();
        if (c.cardAttivata !== true) {
            result.innerHTML = `<p style="color:var(--amb);font:500 13px var(--f);margin-top:8px;padding:14px;background:var(--amb1);border-radius:var(--r2)">Customer trovato (${esc(c.name || '—')}) ma card non attivata. I punti non vengono caricati finché non completa l'attivazione su card.washhub.it.</p>`;
            return;
        }

        const transQ = query(
            collection(db, `merchants/${MERCHANT_ID}/transactions`),
            where('customerId', '==', phone),
            orderBy('createdAt', 'desc'),
            limit(10)
        );
        const transSnap = await getDocs(transQ);
        const txs = [];
        transSnap.forEach(d => txs.push({ id: d.id, ...d.data() }));

        const txHtml = txs.length === 0
            ? '<p style="color:var(--tx3);font:400 12px var(--f);text-align:center;padding:14px">Nessuna transazione</p>'
            : txs.map(t => {
                const date = t.createdAt?.toDate?.()?.toLocaleDateString('it-IT') || '';
                const label = t.type === 'earn' ? 'Acquisto' : (t.rewardName || 'Riscatto');
                const sign = t.type === 'earn' ? '+' : '-';
                const color = t.type === 'earn' ? 'var(--grn,#166534)' : 'var(--red,#991b1b)';
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--brd);font:400 13px var(--f)">
                    <div>
                        <div style="color:var(--tx)">${esc(label)}</div>
                        <div style="color:var(--tx3);font-size:11px">${esc(date)}</div>
                    </div>
                    <div style="font:700 14px var(--mono);color:${color}">${sign}${esc(String(t.points || 0))}</div>
                </div>`;
            }).join('');

        result.innerHTML = `
            <div style="margin-top:10px;padding:16px;background:var(--bg2);border-radius:var(--r2)">
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
                    <div>
                        <div style="font:700 16px var(--f);color:var(--tx)">${esc(c.name || '—')}</div>
                        <div style="font:400 12px var(--mono);color:var(--tx2)">${esc(c.phone || phone)}${c.email ? ' • ' + esc(c.email) : ''}</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font:800 24px var(--f);color:var(--gold,#C8A84E)">${esc(String(c.totalPoints || 0))}</div>
                        <div style="font:400 11px var(--f);color:var(--tx3);text-transform:uppercase;letter-spacing:.5px">punti</div>
                    </div>
                </div>
                <div style="font:600 11px var(--mono);color:var(--tx3);text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px">Ultime transazioni</div>
                <div style="background:var(--bg3);border-radius:var(--r2);overflow:hidden">${txHtml}</div>
            </div>
        `;
    } catch (ex) {
        result.innerHTML = `<p style="color:var(--red);font:500 13px var(--f);margin-top:8px">Errore: ${esc(ex.message || 'Errore')}</p>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Cerca';
    }
}
