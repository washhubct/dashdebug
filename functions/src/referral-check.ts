import { getFirestore } from 'firebase-admin/firestore'

// ═══════════════════════════════════════════════════════════════════
// PORTA UN AMICO — validità del codice (Guido 22/10/2026)
//
// Il codice amico vale SOLO se chi lo usa è un cliente nuovo: mai lavato da noi.
// Caso che ha fatto scattare la regola: Giuseppe Russo (cliente storico) ha
// prenotato col codice di Francesco Russo → sconto €5 + conferma referral.
// Il sito non può leggere prenotazioni/clienti (privati dal 14/10), quindi
// la verifica la fa qui la function e il sito chiama POST /referral/valida.
// ═══════════════════════════════════════════════════════════════════

export type EsitoReferral = 'ok' | 'self' | 'non-trovato' | 'gia-cliente' | 'esaurito'

// Ogni codice vale per al massimo 3 amici nuovi (Guido 23/10/2026)
export const MAX_AMICI_PER_CODICE = 3

// Nome normalizzato per il confronto: maiuscolo, senza accenti/punteggiatura, parole ordinate
// ("Russo Giuseppe" = "GIUSEPPE RUSSO"). Serve almeno nome + cognome (2 parole).
export function chiaveNome(nome: string): string {
  const parole = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(w => w.length >= 2)
  return parole.length >= 2 ? parole.sort().join(' ') : ''
}

export const tel9 = (t: unknown) => String(t || '').replace(/\D/g, '').slice(-9)

// Stesso algoritmo del sito (referral-code.ts): WH + 4 char dal telefono
export function codiceDaTelefono(telefono: string): string {
  const clean = tel9(telefono)
  let hash = 0
  for (let i = 0; i < clean.length; i++) { hash = ((hash << 5) - hash) + clean.charCodeAt(i); hash |= 0 }
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'WH', n = Math.abs(hash)
  for (let i = 0; i < 4; i++) { code += chars[n % chars.length]; n = Math.floor(n / chars.length) }
  return code
}

// Varianti con cui lo stesso numero può essere salvato (10 cifre, 9, +39, spazi...)
function varianti(t9: string): string[] {
  const t10 = '3' + t9
  return Array.from(new Set([t10, t9, '+39' + t10, '+39 ' + t10, '0039' + t10, '39' + t10,
    `+39 ${t10.slice(0, 3)} ${t10.slice(3)}`, `${t10.slice(0, 3)} ${t10.slice(3)}`, `+39 ${t10.slice(0, 3)} ${t10.slice(3, 6)} ${t10.slice(6)}`]))
}

// Il numero è già di un nostro cliente o ha già prenotato? CRM (ultime 9 cifre, ~1.300 doc)
// + prenotazioni (qualsiasi data, non disdette) e tappezzeria con le varianti del numero.
export async function amicoGiaCliente(telefono: string, nome = ''): Promise<boolean> {
  const t = tel9(telefono)
  const db = getFirestore()
  // Anagrafica: stesso telefono OPPURE stesso nome e cognome (Guido 23/10: un cliente
  // già in anagrafica non prende lo sconto anche se prenota con un altro numero)
  const kn = chiaveNome(nome)
  const crm = await db.collection('clienti').select('telefono', 'nome').get()
  if (crm.docs.some(d => (t.length >= 9 && tel9(d.data().telefono) === t) || (kn && chiaveNome(d.data().nome) === kn))) return true
  if (t.length < 9) return false
  // Qualsiasi prenotazione col numero, passata, di oggi o futura (escluse le disdette):
  // il codice amico vale solo sulla PRIMA prenotazione. Prima contavano solo i giorni
  // passati e Francesco Nicotra ha usato WH7LED 3 volte, 2 nello stesso giorno (23/10).
  const v = varianti(t)
  const [pr, tp] = await Promise.all([
    db.collection('prenotazioni').where('telefono', 'in', v.slice(0, 10)).select('stato').get(),
    db.collection('tappezzeria').where('telefono', 'in', v.slice(0, 10)).select('dataPren').get(),
  ])
  if (pr.docs.some(d => d.data().stato !== 'DISDETTA')) return true
  return tp.size > 0
}

// Esito completo per il sito e per i checkout (caparra SumUp / carta Stripe).
export async function validaReferral(codice: string, telefono: string, nome = ''): Promise<EsitoReferral> {
  const c = String(codice || '').trim().toUpperCase()
  if (c.length < 4) return 'non-trovato'
  if (codiceDaTelefono(telefono) === c) return 'self'
  const snap = await getFirestore().collection('referral').doc(c).get()
  const r = snap.data() || {}
  const t = String(r.telefono || '')
  if (!t) return 'non-trovato'
  if (t === tel9(telefono)) return 'self'
  if (await amicoGiaCliente(telefono, nome)) return 'gia-cliente'
  // Usi già fatti = prenotazioni in attesa + confermate (i contatori del doc referral)
  if ((Number(r.inAttesa) || 0) + (Number(r.confermati) || 0) >= MAX_AMICI_PER_CODICE) return 'esaurito'
  return 'ok'
}

// Codice da salvare sulla prenotazione: solo se valido, altrimenti stringa vuota.
export async function referralSeValido(codice: string, telefono: string, nome = ''): Promise<string> {
  return (await validaReferral(codice, telefono, nome)) === 'ok' ? codice.trim().toUpperCase() : ''
}
