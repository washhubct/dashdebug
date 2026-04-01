// Converte un valore in numero decimale (rimuove € e formatta)
export function pNum(v) {
    if (typeof v === 'number') return v;
    if (!v) return 0;
    return parseFloat(String(v).replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}

// Converte una stringa in oggetto Date
export function pDate(s) {
    if (!s) return null;
    if (s instanceof Date) return s;
    const p = String(s).split('/');
    if (p.length === 3) return new Date(p[2], p[1] - 1, p[0]);
    return new Date(s);
}

// Calcola i giorni di differenza tra due date
export function dBetween(a, b) {
    return Math.floor((b - a) / 864e5);
}

// Calcola i mesi di differenza
export function mBetween(a, b) {
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}

// Formatta numero in valuta Euro
export function fEur(n) {
    return '€' + n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Genera stringa Mese-Anno (es: 2026-03)
export function gMK(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Evita iniezioni di codice HTML (sicurezza)
export function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Formatta una data per l'input type="date" (YYYY-MM-DD)
export function fmtDI(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Converte da YYYY-MM-DD a DD/MM/YYYY
export function d2s(v) {
    if (!v) return '';
    const d = new Date(v);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}
