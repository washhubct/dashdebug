import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'

// ═══════════════════════════════════════════════════════════════════
// CONTI CLIENTI — addebiti ricorrenti (dal 01/10/2026)
//
// Ogni conto in contiClienti/{id} ha un canone mensile e, opzionale, la luce
// a consumo. Il giorno 1 di ogni mese (00:10 Europe/Rome):
//   • ADDEBITO_AFFITTO del mese corrente, id deterministico affitto_YYYY-MM
//     → rilanciare non duplica mai
//   • se luce.modo == 'shelly': legge il contatore cumulato dello Shelly
//     Pro 3EM via Shelly Cloud, salva la lettura in letture/YYYY-MM-01 e
//     addebita il delta col mese precedente (luce_YYYY-MM del mese concluso)
// La lettura manuale (modo 'manuale') resta in dashboard (js/moduli/conti.js).
// ═══════════════════════════════════════════════════════════════════

const REGION = 'europe-west1'
const TZ = 'Europe/Rome'
const db = getFirestore()

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const isoDay = (d: Date) => `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`
const itaDay = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
const oraRoma = () => new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))

/** Contatore cumulato (kWh) dello Shelly Pro 3EM via Shelly Cloud API. */
async function letturaShelly(cfg: { server: string; deviceId: string; authKey: string }): Promise<number> {
  const res = await fetch(`https://${cfg.server}/device/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id: cfg.deviceId, auth_key: cfg.authKey }),
  })
  const j: any = await res.json()
  if (!j?.isok) throw new Error('Shelly Cloud: ' + JSON.stringify(j?.errors || j).slice(0, 200))
  const st = j.data?.device_status || {}
  // Gen2 (Pro 3EM): emdata:0.total_act in Wh; fallback Gen1 emeters[].total
  const wh = st['emdata:0']?.total_act ?? (Array.isArray(st.emeters) ? st.emeters.reduce((s: number, e: any) => s + (e.total || 0), 0) : null)
  if (wh == null) throw new Error('Shelly: campo energia non trovato nello status')
  return Math.round(wh / 10) / 100
}

async function addebitaConto(contoId: string, c: FirebaseFirestore.DocumentData, oggi: Date, log: string[]) {
  const movs = db.collection('contiClienti').doc(contoId).collection('movimenti')
  const meseCorr = ym(oggi)
  const base = { dataISO: isoDay(oggi), data: itaDay(oggi), timestamp: Date.now(), operatore: 'sistema', sedeId: c.sedeId || 'lungomare', metodo: '' }

  // Canone del mese corrente
  const affId = `affitto_${meseCorr}`
  if (!(await movs.doc(affId).get()).exists && Number(c.canone) > 0) {
    await movs.doc(affId).set({ ...base, tipo: 'ADDEBITO_AFFITTO', importo: Number(c.canone), meseRif: meseCorr, note: `Canone ${MESI[oggi.getMonth()]} ${oggi.getFullYear()}` })
    log.push(`${c.nome}: affitto ${meseCorr} €${c.canone}`)
  }

  // Luce del mese appena concluso, solo con Shelly configurato
  if (c.luce?.modo !== 'shelly') return
  const shelly = (await db.doc('secrets/shelly').get()).data()?.[contoId] || c.luce?.shelly
  if (!shelly?.deviceId || !shelly?.authKey) { log.push(`${c.nome}: Shelly non configurato`); return }
  const letture = db.collection('contiClienti').doc(contoId).collection('letture')
  const prec = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1)
  const mesePrec = ym(prec)
  const luceId = `luce_${mesePrec}`
  if ((await movs.doc(luceId).get()).exists) return

  let kwhOra: number
  try { kwhOra = await letturaShelly({ server: shelly.server || 'shelly-13-eu.shelly.cloud', deviceId: shelly.deviceId, authKey: shelly.authKey }) }
  catch (e: any) { log.push(`${c.nome}: lettura Shelly fallita (${e.message})`); return }
  await letture.doc(isoDay(oggi)).set({ dataISO: isoDay(oggi), kwh: kwhOra, timestamp: Date.now(), fonte: 'shelly' })

  const prevSnap = await letture.doc(`${mesePrec}-01`).get()
  if (!prevSnap.exists) { log.push(`${c.nome}: prima lettura ${kwhOra} kWh salvata, luce ${mesePrec} da inserire a mano`); return }
  const delta = Math.round((kwhOra - Number(prevSnap.data()!.kwh)) * 100) / 100
  const prezzo = Number(c.luce?.prezzoKwh) || 0
  if (delta <= 0 || !prezzo) { log.push(`${c.nome}: delta ${delta} kWh / prezzo ${prezzo} → nessun addebito`); return }
  const importo = Math.round(delta * prezzo * 100) / 100
  await movs.doc(luceId).set({ ...base, tipo: 'ADDEBITO_LUCE', importo, meseRif: mesePrec, kwh: delta, prezzoKwh: prezzo, note: `Shelly: ${prevSnap.data()!.kwh} → ${kwhOra} kWh` })
  log.push(`${c.nome}: luce ${mesePrec} ${delta} kWh = €${importo}`)
}

export const contiAddebitoMensile = onSchedule({ schedule: '10 0 1 * *', timeZone: TZ, region: REGION }, async () => {
  const oggi = oraRoma()
  const log: string[] = []
  const snap = await db.collection('contiClienti').where('attivo', '==', true).get()
  for (const d of snap.docs) {
    try { await addebitaConto(d.id, d.data(), oggi, log) }
    catch (e: any) { log.push(`${d.data().nome}: ERRORE ${e.message}`) }
  }
  console.log('[conti] addebito mensile:', log.join(' | ') || 'niente da fare')
})

// Lettura Shelly su richiesta dalla dashboard (admin): salva la lettura di oggi,
// utile per la prima lettura all'installazione e per controllare il consumo
export const contiLetturaShelly = onCall({ region: REGION }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'login richiesto')
  const contoId = String(request.data?.contoId || '')
  const c = (await db.doc(`contiClienti/${contoId}`).get()).data()
  if (!c) throw new HttpsError('not-found', 'conto inesistente')
  const shelly = (await db.doc('secrets/shelly').get()).data()?.[contoId] || c.luce?.shelly
  if (!shelly?.deviceId || !shelly?.authKey) throw new HttpsError('failed-precondition', 'Shelly non configurato per questo conto')
  const kwh = await letturaShelly({ server: shelly.server || 'shelly-13-eu.shelly.cloud', deviceId: shelly.deviceId, authKey: shelly.authKey })
  const oggi = oraRoma()
  await db.collection('contiClienti').doc(contoId).collection('letture').doc(isoDay(oggi)).set({ dataISO: isoDay(oggi), kwh, timestamp: Date.now(), fonte: 'shelly-manuale' })
  return { kwh, data: isoDay(oggi) }
})
