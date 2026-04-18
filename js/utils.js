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

// ═══ CRM: Normalizzazione nomi cliente ═══
// UPPERCASE + trim + collapse spazi multipli (coerente con formato DB esistente)
// Es: "  riccardo  vecchio " → "RICCARDO VECCHIO"
export function normalizeName(s) {
    if (!s) return '';
    return String(s).trim().replace(/\s+/g, ' ').toUpperCase();
}

// Distanza di Levenshtein tra due stringhe
function levenshtein(a, b) {
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = [];
    for (let i = 0; i <= b.length; i++) m[i] = [i];
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b[i - 1] === a[j - 1]) m[i][j] = m[i - 1][j - 1];
            else m[i][j] = Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
        }
    }
    return m[b.length][a.length];
}

// ═══ Formatta telefono per wa.me (richiede numero senza "+") ═══
// Gestisce: "333 1234567", "+39 333 1234567", "0039 3331234567", "393331234567"
// Ritorna stringa tipo "393331234567" o null se formato irriconoscibile.
export function formatPhoneForWA(tel) {
    if (!tel) return null;
    let clean = String(tel).replace(/[^\d+]/g, '');
    if (clean.startsWith('00')) clean = '+' + clean.substring(2);
    if (!clean.startsWith('+')) {
        if (clean.startsWith('39') && clean.length >= 11) clean = '+' + clean;
        else if (clean.startsWith('3') && (clean.length === 10 || clean.length === 9)) clean = '+39' + clean;
        else return null;
    }
    return clean.replace(/^\+/, '');
}

// ═══ Similarità tra due nomi (0-1) ═══
// Token-based: decompone in parole, gestisce ordine diverso e abbreviazioni
// Es: "Riccardo Vecchio" vs "Vecchio R" → ~0.9 (alto)
//     "Mario Rossi" vs "Vecchio R" → ~0.3 (basso)
export function nameSimilarity(a, b) {
    if (!a || !b) return 0;
    const norm = s => String(s).toLowerCase().trim()
        .replace(/[.,;:'"!?()[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const tokA = norm(a).split(' ').filter(Boolean);
    const tokB = norm(b).split(' ').filter(Boolean);
    if (!tokA.length || !tokB.length) return 0;

    // Match esatto intero
    if (norm(a) === norm(b)) return 1;

    let matched = 0;
    const usedB = new Set();
    for (const tA of tokA) {
        for (let i = 0; i < tokB.length; i++) {
            if (usedB.has(i)) continue;
            const tB = tokB[i];
            // Match esatto token
            if (tA === tB) { matched += 1; usedB.add(i); break; }
            // Abbreviazione: uno è prefisso dell'altro (es. "r" in "riccardo")
            if (tA.length >= 1 && tB.length >= 1 &&
                (tA === tB.substring(0, tA.length) || tB === tA.substring(0, tB.length))) {
                // Peso crescente con la lunghezza dell'abbreviazione
                const minLen = Math.min(tA.length, tB.length);
                matched += minLen === 1 ? 0.7 : 0.85;
                usedB.add(i);
                break;
            }
            // Fuzzy: Levenshtein con soglia 85% su token lunghi
            const dist = levenshtein(tA, tB);
            const maxLen = Math.max(tA.length, tB.length);
            const sim = 1 - dist / maxLen;
            if (maxLen >= 4 && sim >= 0.85) { matched += sim; usedB.add(i); break; }
        }
    }

    // Dice coefficient: 2 * matched / (|A| + |B|)
    return (2 * matched) / (tokA.length + tokB.length);
}
