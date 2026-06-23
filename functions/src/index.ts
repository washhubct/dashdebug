import { onSchedule } from 'firebase-functions/v2/scheduler'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { defineString } from 'firebase-functions/params'
import Twilio from 'twilio'

initializeApp()

export * from './fidelai-bridge'
export * from './whatsapp'
const db = getFirestore()

const TWILIO_SID = defineString('TWILIO_SID')
const TWILIO_TOKEN = defineString('TWILIO_TOKEN')
const TWILIO_FROM = defineString('TWILIO_FROM') // numero Twilio es. +12015551234

const GIORNI_INATTIVITA = 14

// Gira ogni mattina alle 09:00 ora italiana
export const smsReminder = onSchedule({
  schedule: '0 7 * * *', // UTC 07:00 = IT 09:00
  timeZone: 'Europe/Rome',
  region: 'europe-west1',
}, async () => {
  const client = Twilio(TWILIO_SID.value(), TWILIO_TOKEN.value())

  const soglia = new Date()
  soglia.setDate(soglia.getDate() - GIORNI_INATTIVITA)
  const sogliaStr = soglia.toISOString().split('T')[0] // YYYY-MM-DD

  // Trova tutti i clienti con almeno una prenotazione negli ultimi 60 giorni
  const cutoff60 = new Date()
  cutoff60.setDate(cutoff60.getDate() - 60)
  const cutoffStr = cutoff60.toISOString().split('T')[0]

  const snap = await db.collection('prenotazioni')
    .where('dataPren', '>=', cutoffStr)
    .where('saldato', '==', 'SI')
    .get()

  // Raggruppa per telefono → ultima prenotazione
  const ultimaPerCliente: Record<string, { data: string; nome: string }> = {}
  snap.forEach(doc => {
    const d = doc.data()
    const tel = d.telefono
    if (!tel || tel.length < 9) return
    if (!ultimaPerCliente[tel] || d.dataPren > ultimaPerCliente[tel].data) {
      ultimaPerCliente[tel] = { data: d.dataPren, nome: d.cliente || '' }
    }
  })

  // Filtra chi non viene da GIORNI_INATTIVITA giorni
  const daContattare = Object.entries(ultimaPerCliente)
    .filter(([, v]) => v.data < sogliaStr)

  // Controlla chi ha già ricevuto SMS oggi (evita duplicati)
  const oggiStr = new Date().toISOString().split('T')[0]
  const smsInviatiSnap = await db.collection('smsLog')
    .where('data', '==', oggiStr)
    .get()
  const giàInviati = new Set<string>()
  smsInviatiSnap.forEach(d => giàInviati.add(d.data().telefono))

  let inviati = 0
  for (const [tel, { nome }] of daContattare) {
    if (giàInviati.has(tel)) continue

    const telDigits = tel.replace(/\D/g, '')
    const cardId = telDigits.startsWith('39') && telDigits.length > 10 ? telDigits.slice(2) : telDigits
    const cardUrl = `https://card.washhub.it/?c=${cardId}`

    const nomeDisplay = nome ? nome.split(' ')[0].charAt(0).toUpperCase() + nome.split(' ')[0].slice(1).toLowerCase() : ''
    const messaggio = nomeDisplay
      ? `Ciao ${nomeDisplay}! 👋 La tua auto ti aspetta da WASH HUB. Prenota: https://wash-hub.it/prenota  •  Punti & premi: ${cardUrl}`
      : `Ciao! 👋 La tua auto ti aspetta da WASH HUB. Prenota: https://wash-hub.it/prenota  •  Punti & premi: ${cardUrl}`

    try {
      const telFormatted = tel.startsWith('+') ? tel : `+39${tel.replace(/^0/, '')}`
      await client.messages.create({
        body: messaggio,
        from: TWILIO_FROM.value(),
        to: telFormatted,
      })

      // Log SMS inviato
      await db.collection('smsLog').add({
        telefono: tel,
        data: oggiStr,
        tipo: 'reminder',
        timestamp: Timestamp.now(),
      })

      inviati++
    } catch (err) {
      console.error(`SMS fallito per ${tel}:`, err)
    }
  }

  console.log(`SMS reminder: ${inviati} inviati su ${daContattare.length} candidati`)
})
