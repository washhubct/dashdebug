import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore } from 'firebase-admin/firestore'
import { telegram, TELEGRAM_BOT_TOKEN } from './telegram'

// ═══════════════════════════════════════════════════════════════════
// WATCHDOG WORKER WHATSAPP (27/10/2026)
// Il 02/10 WhatsApp ha scollegato il numero e nessuno se n'è accorto per 5 giorni.
// Ogni 15 min: se config/whatsapp.enabled e il worker del Mac Mini non pinga da più
// di 10 min (processo morto, Mac spento) o è offline/scollegato, un avviso Telegram
// nel gruppo Meteo Wash Hub (config/meteo.telegram.chatProposta). Un solo avviso per
// problema (config/whatsapp.watchdog.avvisatoPer) e un "tutto ok" quando torna.
// ═══════════════════════════════════════════════════════════════════
const REGION = 'europe-west1'
const TZ = 'Europe/Rome'
const MAX_SILENZIO_MS = 10 * 60_000

export const whatsappWatchdog = onSchedule({ schedule: '*/15 * * * *', timeZone: TZ, region: REGION, secrets: [TELEGRAM_BOT_TOKEN] }, async () => {
  const db = getFirestore()
  const cfg = (await db.doc('config/whatsapp').get()).data() || {}
  if (cfg.enabled !== true) return
  const w = cfg.worker || {}
  const chat = String(((await db.doc('config/meteo').get()).data() || {}).telegram?.chatProposta || '')
  let problema = ''
  if (!w.ultimoPing || Date.now() - Number(w.ultimoPing) > MAX_SILENZIO_MS) problema = 'worker muto da ' + Math.round((Date.now() - Number(w.ultimoPing || 0)) / 60_000) + ' min (processo fermo o Mac Mini spento)'
  else if (w.qrPending) problema = 'numero scollegato: serve ricollegare WhatsApp (QR / codice)'
  else if (!w.online) problema = 'worker offline' + (w.errore ? ': ' + w.errore : '')
  const prima = String(cfg.watchdog?.avvisatoPer || '')
  if (problema === prima) return
  const inCoda = (await db.collection('whatsappCoda').where('stato', '==', 'in_coda').count().get()).data().count
  const text = problema
    ? `⚠️ <b>WhatsApp Wash Hub</b>\n${problema}\n${inCoda} messaggi in attesa.`
    : `✅ <b>WhatsApp Wash Hub</b> di nuovo online (${inCoda} in attesa).`
  if (problema || prima) await telegram(chat, text)
  await db.doc('config/whatsapp').set({ watchdog: { avvisatoPer: problema, controllato: Date.now() } }, { merge: true })
})
