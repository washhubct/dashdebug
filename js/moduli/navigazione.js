import { state } from '../state.js';

export function initNavigazione() {
    // Usa l'overlay già presente nell'HTML (id="sidebarOverlay")
    const overlay = document.getElementById('sidebarOverlay');
    const sidebar = document.getElementById('sidebar');
    const closeBtn = document.getElementById('sbClose');

    // --- Funzioni apri/chiudi ---
    function openSidebar() {
        if (!sidebar) return;
        sidebar.classList.add('open');
        if (overlay) overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        if (!sidebar) return;
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    // --- Hamburger ---
    document.querySelectorAll('.mob-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sidebar && sidebar.classList.contains('open')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    });

    // --- Overlay chiude ---
    if (overlay) overlay.addEventListener('click', closeSidebar);

    // --- Bottone ✕ chiude ---
    if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

    // --- Swipe left chiude ---
    let touchStartX = 0;
    let touchStartY = 0;
    if (sidebar) {
        sidebar.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        sidebar.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
            if (dx < -60 && dy < 100) closeSidebar();
        }, { passive: true });
    }

    // --- Click su voci di menu ---
    document.querySelectorAll('.sb-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            let pageId = item.getAttribute('data-page');
            if (!pageId) {
                const idAttr = item.getAttribute('id');
                if (idAttr) pageId = idAttr.replace('nav-', '');
            }
            if (pageId) goPage(pageId);
        });
    });

    // --- Logout ---
    const logoutBtn = sidebar?.querySelector('.sb-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', closeSidebar);
    }
}

export function goPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('show'));
    document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('on'));

    const pageTarget = document.getElementById('page-' + id);
    if (pageTarget) pageTarget.classList.add('show');

    const nav = document.getElementById('nav-' + id);
    if (nav) nav.classList.add('on');

    const titles = {
        cassa: ['💶', 'Incasso Giornaliero'],
        dashboard: ['📈', 'Dashboard Analitica'],
        abbonamenti: ['🅿️', 'Abbonamenti'],
        giornalieri: ['🎟️', 'Parcheggio a Ore'],
        prenotazioni: ['📋', 'Prenotazioni'],
        sospesi: ['⏳', 'Sospesi'],
        report: ['💰', 'Report Finanziario'],
        cancellazioni: ['🗑️', 'Registro Cancellazioni']
    };
    const t = titles[id] || ['', ''];

    const pIcon = document.getElementById('pageIcon');
    const pTitle = document.getElementById('pageTitle');
    if (pIcon) pIcon.textContent = t[0];
    if (pTitle) pTitle.textContent = t[1];

    // Chiudi sidebar mobile
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';

    document.dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId: id } }));
}
