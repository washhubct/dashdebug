import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from '../firebase-config.js';
import { state } from '../state.js';

export function initAuth() {
    const loginBtn = document.querySelector('.login-btn');
    const logoutBtn = document.querySelector('.sb-logout');
    
    onAuthStateChanged(auth, user => {
        if (user) {
            // TRUCCO CTO: Se l'utente apre una nuova scheda o riapre il browser,
            // non c'è la "wh_active_tab". Quindi lo scolleghiamo per forzare il click su Accedi!
            if (!sessionStorage.getItem('wh_active_tab')) {
                signOut(auth);
                return;
            }
            
            // Login confermato (utente ha cliccato Accedi o ha solo ricaricato la pagina)
            const ADMIN_EMAILS = [
                'amministrazione@avrlogisticarl.com'
            ];
            let role = 'user';
            let label = 'Operatore';
            if (ADMIN_EMAILS.includes(user.email.toLowerCase())) {
                role = 'admin';
                label = 'Amministratore';
            }
            
            state.currentUser = { 
                user: user.email.split('@')[0].toUpperCase(), 
                label: label,
                role: role,
                email: user.email
            };
            
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
                sessionStorage.setItem('wh_active_tab', 'true');
                await signInWithEmailAndPassword(auth, e, p);
                err.textContent = '';
            } catch(error) {
                sessionStorage.removeItem('wh_active_tab');
                err.textContent = 'Credenziali errate!';
            } finally {
                loginBtn.textContent = 'Accedi';
            }
        });
    }

    // Permette di accedere anche premendo "Invio" sulla tastiera
    document.getElementById('loginPass')?.addEventListener('keydown', (e) => {
        if(e.key === 'Enter') loginBtn.click();
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            sessionStorage.removeItem('wh_active_tab');
            signOut(auth);
        });
    }
}
