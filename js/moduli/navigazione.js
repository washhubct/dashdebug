import { state } from '../state.js';

export function initNavigazione() {
    // 1. Creiamo lo sfondo scuro (Overlay) in automatico
    let overlay = document.getElementById('sidebarOverlay');
    if(!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sidebarOverlay';
        // Stile inline per evitare di farti toccare il CSS
        overlay.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:99; opacity:0; transition:opacity 0.3s; backdrop-filter:blur(2px);';
        document.body.appendChild(overlay);
        
        // Se clicco nello scuro, si chiude il menu
        overlay.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            if(sidebar) sidebar.classList.remove('open');
            overlay.style.opacity = '0';
            setTimeout(() => overlay.style.display = 'none', 300);
        });
    }

    // 2. Bottone Hamburger
    const mobToggles = document.querySelectorAll('.mob-toggle');
    mobToggles.forEach(btn => {
        btn.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            if(sidebar) {
                sidebar.classList.toggle('open');
                if(sidebar.classList.contains('open')) {
                    sidebar.style.boxShadow = '4px 0 24px rgba(0,0,0,0.2)'; // Effetto ombra figo
                    overlay.style.display = 'block';
                    setTimeout(() => overlay.style.opacity = '1', 10);
                } else {
                    overlay.style.opacity = '0';
                    setTimeout(() => overlay.style.display = 'none', 300);
                }
            }
        });
    });

    // 3. Gestione click sulle voci di menu
    const navItems = document.querySelectorAll('.sb-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            let pageId = item.getAttribute('data-page');
            if (!pageId) {
                const idAttr = item.getAttribute('id'); 
                if(idAttr) pageId = idAttr.replace('nav-', '');
            }
            if (pageId) goPage(pageId);
        });
    });
}

export function goPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('show'));
    document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('on'));
    
    const pageTarget = document.getElementById('page-' + id);
    if(pageTarget) pageTarget.classList.add('show');
    
    const nav = document.getElementById('nav-' + id);
    if(nav) nav.classList.add('on');
    
    const titles = { cassa: ['💶','Incasso Giornaliero'], dashboard: ['📈','Dashboard Analitica'], abbonamenti: ['🅿️','Abbonamenti'], giornalieri: ['🎟️','Parcheggio a Ore'], prenotazioni: ['📋','Prenotazioni'], sospesi: ['⏳','Sospesi'], report: ['💰','Report Finanziario'], cancellazioni: ['🗑️','Registro Cancellazioni'] };
    const t = titles[id] || ['',''];
    
    const pIcon = document.getElementById('pageIcon');
    const pTitle = document.getElementById('pageTitle');
    if(pIcon) pIcon.textContent = t[0];
    if(pTitle) pTitle.textContent = t[1];
    
    // Chiudi il menu mobile e l'overlay quando si cambia pagina
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if(sidebar) sidebar.classList.remove('open');
    if(overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.style.display = 'none', 300);
    }
    
    document.dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId: id } }));
}
