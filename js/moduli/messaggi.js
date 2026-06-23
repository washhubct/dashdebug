// ═══════════════════════════════════════════════════════════════════
// Messaggi — UI chat WhatsApp Cloud API
// Reads:  whatsappChats (real-time)
//         whatsappChats/{phone}/messages (real-time, only when chat open)
// Writes: whatsappChats (markAsRead) | invio msg via callable whatsappSend
// ═══════════════════════════════════════════════════════════════════

import { db, fsOnSnapshot, fsCollection, fsDoc, fsUpdateDoc } from '../firebase-config.js';
import {
    query,
    orderBy,
    limit,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-functions.js';
import { esc } from '../utils.js';

const REGION = 'europe-west1';
const functions = getFunctions(undefined, REGION);
const callSend = httpsCallable(functions, 'whatsappSend');

// Flag temporaneo: la feature è scritta e deployata frontend, ma il backend
// Meta Cloud API non è ancora configurato (servono token + webhook su Meta).
// Quando attivo, flippa a false e la UI si accende automaticamente.
const COMING_SOON = true;

// Template fissi — i nomi devono combaciare con quelli approvati in Meta.
// La compilazione delle variabili verrà aggiunta in Fase 3 con UI dedicata.
const TEMPLATES = [
    { id: 'conferma_prenotazione',  label: '📅 Conferma prenotazione' },
    { id: 'reminder_prenotazione',  label: '🔔 Reminder lavaggio domani' },
    { id: 'grazie_pagamento',       label: '🙏 Ringraziamento + card' },
    { id: 'benvenuto_nuovo_cliente',label: '👋 Benvenuto + card' },
];

const state = {
    chats: [],                  // [{ id, ...data }]
    activeChatId: null,
    unsubChats: null,
    unsubMessages: null,
    messages: [],
    audioCtx: null,
};

let initialized = false;

export function initMessaggi() {
    if (initialized) return;
    initialized = true;

    if (COMING_SOON) {
        document.addEventListener('pageChanged', (e) => {
            if (e.detail.pageId === 'messaggi') renderComingSoon();
        });
        return;
    }

    requestNotificationPermission();
    document.addEventListener('pageChanged', (e) => {
        if (e.detail.pageId === 'messaggi') startChatsListener();
    });
}

function renderComingSoon() {
    const page = document.getElementById('page-messaggi');
    if (!page) return;
    page.innerHTML = `
        <div class="sec" style="display:flex;align-items:center;justify-content:center;min-height:60vh">
          <div style="text-align:center;max-width:480px;padding:32px">
            <div style="font-size:72px;margin-bottom:16px">💬</div>
            <div style="font:700 22px var(--f);color:var(--tx);margin-bottom:10px">Messaggi WhatsApp</div>
            <div style="font:500 14px var(--f);color:var(--gold);margin-bottom:18px;letter-spacing:.5px;text-transform:uppercase">Coming Soon</div>
            <div style="font:400 14px var(--f);color:var(--tx2);line-height:1.55">
              Stiamo finendo di collegare il canale WhatsApp ufficiale al gestionale.<br><br>
              Presto da qui potrai vedere e rispondere in tempo reale a tutti i messaggi dei clienti, ricevere notifiche su nuovi messaggi e usare i template approvati.
            </div>
          </div>
        </div>`;
}

// ─── notifiche browser ───
function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        // Differita: richiede su prima apertura pagina, non al boot
        document.addEventListener('pageChanged', (e) => {
            if (e.detail.pageId === 'messaggi' && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        }, { once: true });
    }
}

function notifyInbound(chat, text) {
    if (state.activeChatId === chat.id) return; // chat aperta: niente notifica
    if (Notification.permission === 'granted') {
        const n = new Notification(`📲 ${chat.customerName || chat.phone}`, {
            body: text || 'Nuovo messaggio',
            icon: '/img/logo.png',
            tag: `wa-${chat.id}`,
        });
        n.onclick = () => { window.focus(); openChat(chat.id); };
    }
    playBeep();
}

function playBeep() {
    try {
        if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = state.audioCtx;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.value = 0.05;
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.12);
    } catch (_) {}
}

// ─── listener: lista conversazioni ───
function startChatsListener() {
    if (state.unsubChats) return; // già attivo
    const q = query(fsCollection(db, 'whatsappChats'), orderBy('lastMessageAt', 'desc'), limit(200));
    let firstSnapshot = true;
    state.unsubChats = fsOnSnapshot(q, (snap) => {
        const prevById = new Map(state.chats.map(c => [c.id, c]));
        const chats = [];
        snap.forEach(d => {
            const data = d.data();
            chats.push({ id: d.id, ...data });
        });
        state.chats = chats;
        renderChatList();
        updateNavBadge();

        if (!firstSnapshot) {
            // Rileva nuovi inbound per notifica
            chats.forEach(c => {
                const prev = prevById.get(c.id);
                const prevUnread = prev?.unreadCount || 0;
                const currUnread = c.unreadCount || 0;
                if (currUnread > prevUnread && c.lastDirection === 'in') {
                    notifyInbound(c, c.lastMessage);
                }
            });
        }
        firstSnapshot = false;
    }, err => console.warn('[messaggi] chats listener:', err.message));
}

function updateNavBadge() {
    const total = state.chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    const badge = document.getElementById('navMessaggiBadge');
    if (!badge) return;
    if (total > 0) {
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

// ─── render lista conversazioni ───
function renderChatList() {
    const list = document.getElementById('msgChatList');
    if (!list) return;
    const filter = (document.getElementById('msgSearch')?.value || '').toLowerCase().trim();
    const filtered = state.chats.filter(c => {
        if (!filter) return true;
        return (c.customerName || '').toLowerCase().includes(filter)
            || (c.phone || '').includes(filter)
            || (c.lastMessage || '').toLowerCase().includes(filter);
    });
    if (filtered.length === 0) {
        list.innerHTML = '<div class="msg-empty">Nessuna conversazione</div>';
        return;
    }
    list.innerHTML = filtered.map(c => {
        const isActive = c.id === state.activeChatId;
        const unread = c.unreadCount || 0;
        const name = c.customerName || c.phone || '—';
        const time = fmtRelative(c.lastMessageAt);
        const preview = (c.lastMessage || '').slice(0, 60);
        return `<div class="msg-chat-row ${isActive ? 'on' : ''} ${unread > 0 ? 'unread' : ''}" data-id="${esc(c.id)}">
            <div class="msg-avatar">${esc((name[0] || '?').toUpperCase())}</div>
            <div class="msg-chat-body">
                <div class="msg-chat-head">
                    <span class="msg-chat-name">${esc(name)}</span>
                    <span class="msg-chat-time">${esc(time)}</span>
                </div>
                <div class="msg-chat-preview">
                    <span>${esc(preview)}</span>
                    ${unread > 0 ? `<span class="msg-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
    list.querySelectorAll('.msg-chat-row').forEach(row => {
        row.addEventListener('click', () => openChat(row.dataset.id));
    });
}

function fmtRelative(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'ora';
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm';
    if (diff < 86_400_000) return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

// ─── thread view ───
function openChat(chatId) {
    if (state.unsubMessages) { state.unsubMessages(); state.unsubMessages = null; }
    state.activeChatId = chatId;
    state.messages = [];
    renderChatList();

    const chat = state.chats.find(c => c.id === chatId);
    document.getElementById('page-messaggi')?.classList.add('show-thread');
    document.getElementById('msgEmpty')?.style.setProperty('display', 'none');
    const threadEl = document.getElementById('msgThread');
    if (threadEl) threadEl.style.display = 'flex';
    document.getElementById('msgThreadName').textContent = chat?.customerName || chat?.phone || '—';
    document.getElementById('msgThreadPhone').textContent = chat?.phone || '';

    const composer = document.getElementById('msgComposer');
    if (composer) composer.style.display = 'flex';
    updateComposerState(chat);

    // Azzera unreadCount
    if (chat?.unreadCount > 0) {
        fsUpdateDoc(fsDoc(db, 'whatsappChats', chatId), {
            unreadCount: 0,
            lastReadAt: serverTimestamp(),
        }).catch(e => console.warn('markAsRead:', e.message));
    }

    // Listener thread
    const q = query(fsCollection(db, `whatsappChats/${chatId}/messages`), orderBy('createdAt', 'asc'), limit(500));
    state.unsubMessages = fsOnSnapshot(q, (snap) => {
        const msgs = [];
        snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
        state.messages = msgs;
        renderThread();
    }, err => console.warn('[messaggi] msg listener:', err.message));
}

function updateComposerState(chat) {
    const textarea = document.getElementById('msgTextInput');
    const sendBtn = document.getElementById('msgSendBtn');
    const tplSel = document.getElementById('msgTplSelect');
    const winInfo = document.getElementById('msgWindowInfo');
    if (!textarea || !sendBtn || !tplSel || !winInfo) return;

    const wExp = chat?.windowExpiresAt?.toDate?.();
    const inWindow = wExp && wExp.getTime() > Date.now();
    textarea.disabled = !inWindow;
    textarea.placeholder = inWindow
        ? 'Scrivi un messaggio…'
        : 'Finestra 24h chiusa — invia un template per riaprire la conversazione';
    if (inWindow) {
        const mins = Math.floor((wExp.getTime() - Date.now()) / 60_000);
        const hh = Math.floor(mins / 60);
        const mm = mins % 60;
        winInfo.textContent = `✓ Finestra libera attiva (${hh}h ${mm}m residui)`;
        winInfo.style.color = 'var(--grn, #2a8a3f)';
    } else {
        winInfo.textContent = '⚠ Solo template (finestra 24h chiusa)';
        winInfo.style.color = 'var(--amb, #b87b00)';
    }
    sendBtn.disabled = false;
}

function renderThread() {
    const wrap = document.getElementById('msgThreadBody');
    if (!wrap) return;
    if (state.messages.length === 0) {
        wrap.innerHTML = '<div class="msg-empty" style="margin:auto">Nessun messaggio</div>';
        return;
    }
    wrap.innerHTML = state.messages.map(m => {
        const side = m.direction === 'out' ? 'out' : 'in';
        const time = fmtMessageTime(m.createdAt);
        const text = m.text || (m.templateName ? `[template: ${m.templateName}]` : `[${m.type || '?'}]`);
        const status = m.direction === 'out' ? statusIcon(m.status) : '';
        return `<div class="msg-bubble ${side}">
            <div class="msg-bubble-text">${esc(text).replace(/\n/g, '<br>')}</div>
            <div class="msg-bubble-meta">${esc(time)} ${status}</div>
        </div>`;
    }).join('');
    wrap.scrollTop = wrap.scrollHeight;
}

function fmtMessageTime(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function statusIcon(s) {
    if (s === 'failed') return '❌';
    if (s === 'read') return '✓✓';
    if (s === 'delivered') return '✓✓';
    if (s === 'sent') return '✓';
    return '⏳';
}

// ─── composer: invio ───
async function sendCurrent() {
    if (!state.activeChatId) return;
    const chat = state.chats.find(c => c.id === state.activeChatId);
    if (!chat) return;

    const tplSel = document.getElementById('msgTplSelect');
    const textarea = document.getElementById('msgTextInput');
    const sendBtn = document.getElementById('msgSendBtn');
    const tplName = tplSel?.value || '';
    const text = (textarea?.value || '').trim();

    if (!tplName && !text) return;

    sendBtn.disabled = true;
    sendBtn.textContent = 'Invio…';

    try {
        const payload = tplName
            ? { to: chat.phone, type: 'template', templateName: tplName, languageCode: 'it' }
            : { to: chat.phone, type: 'text', text };
        const res = await callSend(payload);
        if (!res.data?.ok) throw new Error('Risposta inattesa');

        if (textarea) textarea.value = '';
        if (tplSel) tplSel.value = '';
    } catch (err) {
        const msg = err?.message || err?.code || 'Invio fallito';
        alert('Errore invio WhatsApp: ' + msg);
        console.error('[messaggi] send:', err);
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Invia';
    }
}

// ─── wire-up controlli pagina al primo apertura ───
document.addEventListener('DOMContentLoaded', () => {
    const search = document.getElementById('msgSearch');
    if (search) search.addEventListener('input', renderChatList);

    const sendBtn = document.getElementById('msgSendBtn');
    if (sendBtn) sendBtn.addEventListener('click', sendCurrent);

    const textarea = document.getElementById('msgTextInput');
    if (textarea) textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendCurrent();
        }
    });

    const tplSel = document.getElementById('msgTplSelect');
    if (tplSel) {
        tplSel.innerHTML = '<option value="">— Messaggio libero (24h) —</option>'
            + TEMPLATES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
    }

    const backBtn = document.getElementById('msgBackBtn');
    if (backBtn) backBtn.addEventListener('click', () => {
        // Su mobile torna alla lista; su desktop chiude semplicemente il thread
        document.getElementById('page-messaggi')?.classList.remove('show-thread');
        if (state.unsubMessages) { state.unsubMessages(); state.unsubMessages = null; }
        state.activeChatId = null;
        renderChatList();
        const t = document.getElementById('msgThread');
        if (t) t.style.display = 'none';
        const e = document.getElementById('msgEmpty');
        if (e) e.style.display = '';
        const c = document.getElementById('msgComposer');
        if (c) c.style.display = 'none';
    });
});
