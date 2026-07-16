import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore } from 'firebase-admin/firestore'

// ═══════════════════════════════════════════════════════════════════
// CHIUSURA GIORNALIERA SERVER-SIDE — ore 21:00 Europe/Rome
//
// Sostituisce la chiusura client-side (autoChiusuraGiornate /
// checkChiusuraOre20 in js/main.js, rimosse il 16/07/2026): la chiusura
// contabile non dipende più da chi apre la dashboard né dalla versione
// JS in cache — fonte unica dei bug di duplicazione di luglio 2026.
//
// Per ogni sede chiude oggi + recupera fino a 6 giorni indietro (no
// domeniche). Idempotente: righe primaNota con ID `sede_data_tipo`,
// marker giornateChiuse con ID `sede_data`. I marker storici senza
// sedeId valgono per tutte le sedi (retrocompatibilità).
// ═══════════════════════════════════════════════════════════════════

const SEDI = ['lungomare', 'paesi-etnei']

// YYYY-MM-DD del giorno `offset` giorni fa, calendario Europe/Rome
function giornoRome(offset: number): string {
  const d = new Date(Date.now() - offset * 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

function isDomenica(dStr: string): boolean {
  return new Date(`${dStr}T12:00:00Z`).getUTCDay() === 0
}

const slugTipo = (descr: string) => descr.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()

export const chiusuraGiornaliera = onSchedule({
  schedule: '0 21 * * *',
  timeZone: 'Europe/Rome',
  region: 'europe-west1',
}, async () => {
  const db = getFirestore()

  // Registro giornate chiuse: marker con sedeId valgono per quella sede,
  // marker storici senza sedeId per tutte (stessa semantica del client)
  const snapChiuse = await db.collection('giornateChiuse').get()
  const chiusePerSede: Record<string, Set<string>> = {}
  for (const sede of SEDI) chiusePerSede[sede] = new Set()
  snapChiuse.forEach(doc => {
    const d = doc.data()
    if (!d.data) return
    for (const sede of SEDI) {
      if (!d.sedeId || d.sedeId === sede) chiusePerSede[sede].add(d.data)
    }
  })

  for (const sede of SEDI) {
    for (let i = 0; i <= 6; i++) {
      const dStr = giornoRome(i)
      if (isDomenica(dStr)) continue
      if (chiusePerSede[sede].has(dStr)) continue

      const dIta = dStr.split('-').reverse().join('/')

      // Le query filtrano solo per giorno; la sede si filtra in memoria
      // trattando i doc senza sedeId come 'lungomare' (dati pre-multisede)
      const perSede = (d: FirebaseFirestore.DocumentData) => (d.sedeId || 'lungomare') === sede

      const [snapPren, snapTap, snapGiorn, snapUsc] = await Promise.all([
        db.collection('prenotazioni').where('dataPren', '==', dStr).where('saldato', '==', 'SI').get(),
        db.collection('tappezzeria').where('status', '==', 'OUT').where('dataOut', '==', dIta).get(),
        db.collection('giornalieri').where('status', '==', 'OUT').where('dataOut', '==', dStr).get(),
        db.collection('uscite').where('data', '==', dStr).get(),
      ])

      let lavContanti = 0, lavPos = 0
      snapPren.forEach(doc => {
        const d = doc.data()
        if (!perSede(d)) return
        const imp = parseFloat(d.prezzo) || 0
        if (d.saldo === 'CONTANTI') lavContanti += imp
        else if (d.saldo === 'POS') lavPos += imp
      })

      let tapContanti = 0, tapPos = 0
      snapTap.forEach(doc => {
        const d = doc.data()
        if (!perSede(d) || d.pagamento === 'SOSPESO') return
        const imp = parseFloat(d.prezzo) || 0
        const mod = (d.pagamento || '').toUpperCase()
        if (mod === 'CONTANTI') tapContanti += imp
        else if (mod === 'POS') tapPos += imp
      })

      let parContanti = 0, parPos = 0
      snapGiorn.forEach(doc => {
        const d = doc.data()
        if (!perSede(d)) return
        const imp = parseFloat(d.prezzoFinale) || 0
        if (d.pagamento === 'CONTANTI') parContanti += imp
        else if (d.pagamento === 'POS') parPos += imp
      })

      let uscContanti = 0, uscPos = 0
      snapUsc.forEach(doc => {
        const d = doc.data()
        if (!perSede(d)) return
        const imp = parseFloat(d.importo) || 0
        if (d.metodo === 'CONTANTI') uscContanti += imp
        else if (d.metodo === 'POS') uscPos += imp
      })

      const totLav = lavContanti + lavPos + tapContanti + tapPos
      const totPar = parContanti + parPos
      const totUsc = uscContanti + uscPos

      const markerRef = db.collection('giornateChiuse').doc(`${sede}_${dStr}`)

      if (totLav === 0 && totPar === 0 && totUsc === 0) {
        await markerRef.set({ data: dStr, sedeId: sede, timestamp: Date.now(), note: 'Nessun movimento' })
        continue
      }

      // Stessa forma delle righe scritte storicamente dal client
      const base = { DATA: dIta, dataISO: dStr, USCITE: 0, Uscite: 0, SOSPESO: 0, Sospeso: 0, sedeId: sede }
      const righe: Record<string, unknown>[] = []
      if (lavContanti > 0) righe.push({ ...base, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'INCASSO CASH', Descrizione: 'INCASSO CASH', ENTRATA: lavContanti, Entrata: lavContanti, "MODALITA'": 'CONTANTI' })
      if (lavPos > 0) righe.push({ ...base, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'INCASSO POS', Descrizione: 'INCASSO POS', ENTRATA: lavPos, Entrata: lavPos, "MODALITA'": 'POS' })
      if (tapContanti > 0) righe.push({ ...base, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'TAPPEZZERIA CASH', Descrizione: 'TAPPEZZERIA CASH', ENTRATA: tapContanti, Entrata: tapContanti, "MODALITA'": 'CONTANTI' })
      if (tapPos > 0) righe.push({ ...base, 'CENTRO DI COSTO': 'LAVAGGIO', Categoria: 'LAVAGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'TAPPEZZERIA POS', Descrizione: 'TAPPEZZERIA POS', ENTRATA: tapPos, Entrata: tapPos, "MODALITA'": 'POS' })
      if (parContanti > 0) righe.push({ ...base, 'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'AD ORE', Descrizione: 'PARCHEGGIO AD ORE CASH', ENTRATA: parContanti, Entrata: parContanti, "MODALITA'": 'CONTANTI' })
      if (parPos > 0) righe.push({ ...base, 'CENTRO DI COSTO': 'PARCHEGGIO', Categoria: 'PARCHEGGIO', 'PRIMANOTA CLIENTI/FORNITORI': 'AD ORE', Descrizione: 'PARCHEGGIO AD ORE POS', ENTRATA: parPos, Entrata: parPos, "MODALITA'": 'POS' })
      if (uscContanti > 0) righe.push({ ...base, 'CENTRO DI COSTO': 'VARIE', Categoria: 'VARIE', 'PRIMANOTA CLIENTI/FORNITORI': 'USCITE GIORNATA', Descrizione: 'USCITE GIORNATA CASH', ENTRATA: 0, Entrata: 0, USCITE: uscContanti, Uscite: uscContanti, "MODALITA'": 'CONTANTI' })
      if (uscPos > 0) righe.push({ ...base, 'CENTRO DI COSTO': 'VARIE', Categoria: 'VARIE', 'PRIMANOTA CLIENTI/FORNITORI': 'USCITE GIORNATA', Descrizione: 'USCITE GIORNATA POS', ENTRATA: 0, Entrata: 0, USCITE: uscPos, Uscite: uscPos, "MODALITA'": 'POS' })

      for (const riga of righe) {
        riga.timestamp = Date.now()
        await db.collection('primaNota').doc(`${sede}_${dStr}_${slugTipo(riga.Descrizione as string)}`).set(riga)
      }

      await markerRef.set({
        data: dStr, sedeId: sede, timestamp: Date.now(),
        lavContanti, lavPos, tapContanti, tapPos,
        parContanti, parPos, uscContanti, uscPos,
        totaleEntrate: totLav + totPar, totaleUscite: totUsc,
      })

      console.log(`✅ [${sede}] Giornata ${dIta} chiusa — Lav: €${totLav} | Par: €${totPar} | Usc: €${totUsc}`)
    }
  }
})
