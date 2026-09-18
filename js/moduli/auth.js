import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from '../firebase-config.js';
import { state } from '../state.js';

// Lista admin — la sicurezza reale dev'essere su Firestore Security Rules,
// questa lista client serve solo per UI gating (mostrare/nascondere azioni)
const ADMIN_EMAILS = [
    'amministrazione@avrlogisticarl.com',
    'michela@avrlogisticarl.com'
];

/**
 * Verifica se l'utente corrente è admin.
 * Ri-legge auth.currentUser per evitare bypass via manipolazione di state.
 * IMPORTANTE: la vera protezione va messa nelle Firestore Security Rules.
 */
export function isAdmin() {
    const u = auth.currentUser;
    if (!u || !u.email) return false;
    return ADMIN_EMAILS.includes(u.email.toLowerCase());
}

/**
 * Guard da chiamare prima di ogni azione admin-only.
 * Ritorna true se autorizzato, false + alert altrimenti.
 */
export function requireAdmin(action = 'questa operazione') {
    if (!isAdmin()) {
        alert(`⛔ Non sei autorizzato a ${action}. Contatta l'amministratore.`);
        return false;
    }
    return true;
}

// sessionStorage può lanciare (Safari con "Blocca tutti i cookie", modalità privata,
// dati sito corrotti): mai far dipendere il login da questo.
const tabFlag = {
    get: () => { try { return sessionStorage.getItem('wh_active_tab'); } catch { return 'true'; } },
    set: () => { try { sessionStorage.setItem('wh_active_tab', 'true'); } catch { /* ignora */ } },
    clear: () => { try { sessionStorage.removeItem('wh_active_tab'); } catch { /* ignora */ } },
};

// Messaggi leggibili per gli errori Firebase Auth (prima era sempre "Credenziali errate!")
function messaggioErroreLogin(error) {
    const code = error?.code || '';
    const map = {
        'auth/wrong-password': 'Password errata.',
        'auth/invalid-credential': 'Email o password errate.',
        'auth/invalid-login-credentials': 'Email o password errate.',
        'auth/user-not-found': 'Nessun account con questa email.',
        'auth/invalid-email': 'Email non valida.',
        'auth/user-disabled': 'Account disabilitato: contatta l\'amministratore.',
        'auth/too-many-requests': 'Troppi tentativi: attendi qualche minuto o usa "Password dimenticata?".',
        'auth/network-request-failed': 'Nessuna connessione a Firebase: controlla rete, VPN o blocco contenuti.',
    };
    return map[code] || `Accesso non riuscito (${code || error?.message || 'errore sconosciuto'}).`;
}

export function initAuth() {
    const loginBtn = document.querySelector('.login-btn');
    const logoutBtn = document.querySelector('.sb-logout');

    onAuthStateChanged(auth, user => {
        if (user) {
            // Sessione per-scheda: chi apre una nuova scheda o riapre il browser deve
            // rifare il login (PC condiviso in sede). Vale solo per gli operatori:
            // gli admin (Guido, Michela) restano collegati sul proprio dispositivo —
            // su iPad/PWA la sessionStorage sparisce a ogni riapertura e Michela
            // veniva buttata fuori di continuo (18/09/2026).
            const emailLow = (user.email || '').toLowerCase();
            const adminUser = ADMIN_EMAILS.includes(emailLow);
            if (!adminUser && !tabFlag.get()) {
                signOut(auth);
                return;
            }
            if (adminUser) tabFlag.set();

            // Login confermato (utente ha cliccato Accedi o ha solo ricaricato la pagina)
            let role = 'user';
            let label = 'Operatore';
            if (adminUser) {
                role = 'admin';
                label = 'Amministratore';
            }

            // Object.freeze previene modifica del ruolo da console/state
            state.currentUser = Object.freeze({
                user: user.email.split('@')[0].toUpperCase(),
                label: label,
                role: role,
                email: user.email
            });

            document.dispatchEvent(new CustomEvent('authSuccess'));
        } else {
            // Nessun utente o utente appena scollegato: mostriamo il login
            document.getElementById('app').classList.remove('show');
            document.getElementById('loginScreen').classList.remove('out');
        }
    });

    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            const e = document.getElementById('loginUser').value.trim();
            const p = document.getElementById('loginPass').value.trim();
            const err = document.getElementById('loginErr');
            if(!e || !p) { err.textContent = 'Inserisci email e password'; return; }
            
            loginBtn.textContent = 'Accesso...';
            try {
                // L'utente sta cliccando "Accedi": attiviamo la sessione per questa scheda
                tabFlag.set();
                await signInWithEmailAndPassword(auth, e, p);
                err.textContent = '';
            } catch(error) {
                tabFlag.clear();
                console.warn('login fallito:', error?.code, error?.message);
                err.style.color = '';
                err.textContent = messaggioErroreLogin(error);
            } finally {
                loginBtn.textContent = 'Accedi';
            }
        });
    }

    // Permette di accedere anche premendo "Invio" sulla tastiera
    document.getElementById('loginPass')?.addEventListener('keydown', (e) => {
        if(e.key === 'Enter') loginBtn.click();
    });

    // Reset password via email Firebase (link "Password dimenticata?")
    document.getElementById('loginReset')?.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const e = document.getElementById('loginUser').value.trim();
        const err = document.getElementById('loginErr');
        if (!e) { err.textContent = 'Scrivi la tua email qui sopra, poi clicca "Password dimenticata?"'; return; }
        try {
            await sendPasswordResetEmail(auth, e);
            err.style.color = 'var(--grn)';
            err.textContent = `Email inviata a ${e}: apri il link per scegliere una nuova password.`;
        } catch (error) {
            err.style.color = '';
            err.textContent = 'Invio non riuscito: controlla che l\'email sia quella dell\'account.';
        }
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            tabFlag.clear();
            signOut(auth);
        });
    }
}
