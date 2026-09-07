import { onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'

// ═══════════════════════════════════════════════════════════════════
// USCITE → PRIMA NOTA: cancellazione coerente
//
// La Cassa scrive ogni uscita anche in primaNota, ma delUscita (cassa.js)
// cancellava solo il doc in `uscite`: la riga PN restava orfana e il report
// contava spese inesistenti (visto 07/09/2026, Lungomare 05/09).
// Le rules permettono delete su primaNota solo all'admin, quindi la pulizia
// gira qui server-side per tutti gli utenti.
// Match: prima per uscitaId (righe nuove), poi per sede+data+descrizione+
// importo+modalità (righe storiche senza link).
// ═══════════════════════════════════════════════════════════════════
export const onUscitaDeleted = onDocumentDeleted({
  document: 'uscite/{id}',
  region: 'europe-west1',
}, async (event) => {
  const db = getFirestore()
  const u = event.data?.data()
  if (!u) return
  const id = event.params.id

  let snap = await db.collection('primaNota').where('uscitaId', '==', id).get()
  if (snap.empty) {
    const sede = u.sedeId || 'lungomare'
    const cand = await db.collection('primaNota')
      .where('sedeId', '==', sede)
      .where('dataISO', '==', String(u.data || ''))
      .get()
    const imp = Number(u.importo) || 0
    const descr = String(u.descrizione || '').trim().toUpperCase()
    const mod = String(u.metodo || '').toUpperCase()
    const match = cand.docs.filter(d => {
      const r = d.data()
      return !r.uscitaId
        && Math.abs((Number(r.USCITE ?? r.Uscite) || 0) - imp) < 0.005
        && String(r.Descrizione || '').trim().toUpperCase() === descr
        && String(r["MODALITA'"] || '').toUpperCase() === mod
    }).slice(0, 1) // una sola riga: se l'utente ha due uscite identiche ne resta una
    if (match.length === 0) {
      console.log(`[uscite] ${id}: nessuna riga primaNota corrispondente (${sede} ${u.data} "${descr}" €${imp})`)
      return
    }
    for (const d of match) await d.ref.delete()
    console.log(`[uscite] ${id}: rimossa riga primaNota ${match[0].id} (match per campi)`)
    return
  }
  for (const d of snap.docs) await d.ref.delete()
  console.log(`[uscite] ${id}: rimosse ${snap.size} righe primaNota (uscitaId)`)
})
