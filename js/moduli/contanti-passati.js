// ─── Contanti dei giorni conclusi: NON si mostrano in dashboard ───
// Regola (Guido, 27/09/2026): i movimenti pagati in CONTANTI restano visibili solo nel giorno in cui
// vengono incassati. Dal giorno dopo spariscono da liste e totali a schermo. I dati NON vengono toccati:
// restano su Firestore, in Prima Nota, nella chiusura delle 21:00 e nell'archivio serale del Mac Mini
// (~/Archivio-WashHub/AAAA/MM/AAAA-MM-GG.pdf, script scripts/archivio-giornata.mjs).
import { fmtDI } from '../utils.js';

export const oggiISO = () => fmtDI(new Date());

/** 'DD/MM/YYYY' → 'YYYY-MM-DD' (le date già ISO passano invariate). */
export function toISO(d) {
    const s = String(d || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const [g, m, a] = s.split('/');
    return a ? `${a}-${m}-${g}` : '';
}

export const giornoPassato = (data) => { const iso = toISO(data); return !!iso && iso < oggiISO(); };

/** true se il movimento va nascosto: pagato in contanti in un giorno già concluso. */
export const nascondiContante = (metodo, data) => String(metodo || '').toUpperCase() === 'CONTANTI' && giornoPassato(data);
