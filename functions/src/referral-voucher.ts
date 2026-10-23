import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { randomInt } from 'crypto'
import { tel9 } from './referral-check'

// ═══════════════════════════════════════════════════════════════════
// VOUCHER "PORTA UN AMICO" lato server (23/10/2026)
//
// Prima il voucher lo creava il gestionale dal PC dell'operatore, ma le rules
// permettono di creare /vouchers solo agli admin: con l'account operatore la
// scrittura falliva in silenzio → 0 voucher emessi su 7 referral confermati.
// Ora: quando una prenotazione col codice amico diventa referralConfermato=true
// (saldo in cassa), questo trigger emette €5 al titolare del codice. Un voucher
// per ogni amico nuovo che lava, senza limite (Guido 23/10).
// Idempotente: id voucher deterministico + campo voucherEmesso sulla prenotazione.
// ═══════════════════════════════════════════════════════════════════

const VALORE = 5
const DURATA_MS = 30 * 864e5 // 1 mese (decisione Guido 08/10/2026)
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const chunk = (n: number) => Array.from({ length: n }, () => CHARS[randomInt(CHARS.length)]).join('')

export async function emettiVoucherReferral(pid: string, p: FirebaseFirestore.DocumentData): Promise<string | null> {
  const code = String(p.referral || '').trim().toUpperCase()
  if (!code || p.referralConfermato !== true || p.referralNonValido || p.voucherEmesso) return null
  const db = getFirestore()
  const ref = await db.collection('referral').doc(code).get()
  const telRef = tel9(ref.data()?.telefono)
  if (telRef.length < 9) { console.warn('[voucher] referral senza telefono', code, pid); return null }
  const pref = db.collection('prenotazioni').doc(pid)
  const codice = `VCH-${chunk(4)}-${chunk(4)}`
  const now = Date.now()
  const creato = await db.runTransaction(async tx => {
    const cur = await tx.get(pref)
    if (cur.data()?.voucherEmesso) return null // già fatto (retry del trigger)
    tx.create(db.collection('vouchers').doc(codice), {
      codice, valore: VALORE, stato: 'attivo', telefono: telRef, referralCode: code,
      prenotazioneOrigine: pid, amico: String(p.cliente || ''), sedeId: p.sedeId || 'lungomare',
      dataEmissione: FieldValue.serverTimestamp(), dataEmissioneMs: now, dataScadenza: now + DURATA_MS,
      dataUso: null, prenotazioneUso: null, emessoDa: 'server',
    })
    tx.update(pref, { voucherEmesso: codice })
    tx.set(db.collection('referral').doc(code), { vouchersAttivi: FieldValue.arrayUnion(codice) }, { merge: true })
    return codice
  })
  if (creato) console.log(`[voucher] ${creato} €${VALORE} a ${telRef} (codice ${code}, amico ${p.cliente}, pren ${pid})`)
  return creato
}

export const voucherReferral = onDocumentUpdated(
  { document: 'prenotazioni/{id}', region: 'europe-west1' },
  async event => {
    const before = event.data?.before.data()
    const after = event.data?.after.data()
    if (!after || before?.referralConfermato === true || after.referralConfermato !== true) return
    try { await emettiVoucherReferral(event.params.id, after) } catch (e) { console.error('[voucher] errore', event.params.id, e) }
  }
)
