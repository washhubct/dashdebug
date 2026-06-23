/**
 * WhatsApp Cloud API integration (Meta Cloud API v21).
 *
 * 3 Cloud Functions:
 *   - whatsappWebhook (HTTPS onRequest, public): GET = subscribe verification,
 *     POST = riceve messaggi inbound + status update outbound. Verifica HMAC
 *     X-Hub-Signature-256 con META_APP_SECRET.
 *   - whatsappSend (callable): invia text (24h window) o template.
 *   - whatsappSendBulk (callable): broadcast template — stub, TODO Fase 3.
 *
 * Modello Firestore:
 *   whatsappChats/{phone}                  // metadata conversazione
 *     phone, customerName, lastMessage, lastMessageAt, lastDirection,
 *     windowExpiresAt (Timestamp, +24h da ultimo inbound),
 *     unreadCount, updatedAt
 *   whatsappChats/{phone}/messages/{metaMessageId}
 *     direction (in|out), type, text, templateName, components,
 *     metaMessageId, status (received|queued|sent|delivered|read|failed),
 *     sentBy, sentByEmail, createdAt, statusUpdatedAt, raw, error
 *
 * Secrets richiesti (defineSecret):
 *   META_WHATSAPP_TOKEN         permanent access token (System User)
 *   META_PHONE_NUMBER_ID        es. 1234567890 (Phone Number ID)
 *   META_WEBHOOK_VERIFY_TOKEN   stringa random nostra (configurata anche su Meta)
 *   META_APP_SECRET             secret dell'app Meta Developer (HMAC validation)
 */

import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import crypto from 'crypto'

const META_WHATSAPP_TOKEN = defineSecret('META_WHATSAPP_TOKEN')
const META_PHONE_NUMBER_ID = defineSecret('META_PHONE_NUMBER_ID')
const META_WEBHOOK_VERIFY_TOKEN = defineSecret('META_WEBHOOK_VERIFY_TOKEN')
const META_APP_SECRET = defineSecret('META_APP_SECRET')

const REGION = 'europe-west1'
const GRAPH_API = 'https://graph.facebook.com/v21.0'
const WINDOW_24H_MS = 24 * 60 * 60 * 1000

// ───────────────────────────── helpers ─────────────────────────────

/**
 * Normalizza un numero a "3xxxxxxxxx" (cifre, senza prefisso 39).
 * Allineato al formato usato come customerId in FidelAI.
 */
function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.replace(/\D/g, '')
  if (!digits || digits.length < 8) return null
  return digits.startsWith('39') && digits.length > 10 ? digits.slice(2) : digits
}

/** Formato richiesto da Meta Cloud API: "39333..." (E.164 senza +). */
function toMetaPhone(cid: string): string {
  return cid.startsWith('39') ? cid : '39' + cid
}

/** Verifica HMAC SHA256 della firma webhook Meta. */
function verifyHmac(rawBody: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!rawBody || !header || !header.startsWith('sha256=')) return false
  const expected = header.slice(7)
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(computed, 'hex')
  if (a.length !== b.length) return false
  try { return crypto.timingSafeEqual(a, b) } catch { return false }
}

/** Best-effort name resolve: WA contact profile → clienti collection. */
async function resolveCustomerName(cid: string, fallback: string | null): Promise<string | null> {
  if (fallback) return fallback
  try {
    const snap = await getFirestore().collection('clienti').where('telefono', '==', cid).limit(1).get()
    if (!snap.empty) return snap.docs[0].data().nome || null
  } catch (_) {}
  return null
}

// ─────────────────────────── whatsappWebhook ───────────────────────────

export const whatsappWebhook = onRequest({
  region: REGION,
  secrets: [META_WEBHOOK_VERIFY_TOKEN, META_APP_SECRET],
  maxInstances: 10,
  cors: false,
}, async (req, res) => {
  // GET: verifica subscribe (Meta richiama una volta quando configuri il webhook)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode']
    const token = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token === META_WEBHOOK_VERIFY_TOKEN.value()) {
      res.status(200).send(String(challenge))
      return
    }
    res.status(403).send('forbidden')
    return
  }
  if (req.method !== 'POST') {
    res.status(405).send('method not allowed')
    return
  }

  // Verifica firma HMAC: rifiuta payload non firmati con META_APP_SECRET
  const signature = (req.get('X-Hub-Signature-256') || req.get('x-hub-signature-256') || '').toString()
  if (!verifyHmac(req.rawBody, signature, META_APP_SECRET.value())) {
    console.warn('[whatsapp] HMAC mismatch')
    res.status(401).send('invalid signature')
    return
  }

  try {
    const db = getFirestore()
    const body = req.body || {}
    const entries: any[] = body.entry || []

    for (const entry of entries) {
      const changes: any[] = entry?.changes || []
      for (const change of changes) {
        const value = change?.value || {}
        const contacts: any[] = value?.contacts || []
        const messages: any[] = value?.messages || []
        const statuses: any[] = value?.statuses || []

        const contactMap: Record<string, string> = {}
        for (const c of contacts) {
          const wa = c?.wa_id
          const name = c?.profile?.name
          if (wa && name) contactMap[wa] = name
        }

        // ── inbound messages ──
        for (const msg of messages) {
          const cid = normalizePhone(msg?.from)
          if (!cid) continue
          const metaId: string = msg?.id || `inbound-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const type: string = msg?.type || 'unknown'
          const ts = msg?.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date()
          const text: string | null =
            msg?.text?.body ||
            msg?.button?.text ||
            msg?.interactive?.button_reply?.title ||
            msg?.interactive?.list_reply?.title ||
            null

          const customerName = await resolveCustomerName(cid, contactMap[msg?.from] || null)

          const chatRef = db.doc(`whatsappChats/${cid}`)
          const msgRef = chatRef.collection('messages').doc(metaId)

          await db.runTransaction(async (tx) => {
            const existing = await tx.get(msgRef)
            if (existing.exists) return // idempotenza: Meta può rispedire

            tx.set(msgRef, {
              direction: 'in',
              type,
              text,
              metaMessageId: metaId,
              from: cid,
              status: 'received',
              createdAt: Timestamp.fromDate(ts),
              raw: msg,
            })

            const chatPatch: Record<string, unknown> = {
              phone: cid,
              lastMessage: text || `[${type}]`,
              lastMessageAt: Timestamp.fromDate(ts),
              lastDirection: 'in',
              windowExpiresAt: Timestamp.fromMillis(ts.getTime() + WINDOW_24H_MS),
              unreadCount: FieldValue.increment(1),
              updatedAt: FieldValue.serverTimestamp(),
            }
            if (customerName) chatPatch.customerName = customerName
            tx.set(chatRef, chatPatch, { merge: true })
          })
        }

        // ── status updates per outbound ──
        for (const status of statuses) {
          const metaId = status?.id
          const cid = normalizePhone(status?.recipient_id)
          const statusName = status?.status // sent | delivered | read | failed
          if (!metaId || !cid || !statusName) continue
          const patch: Record<string, unknown> = {
            status: statusName,
            statusUpdatedAt: FieldValue.serverTimestamp(),
          }
          if (statusName === 'failed') patch.error = status?.errors || null
          await db.doc(`whatsappChats/${cid}/messages/${metaId}`).set(patch, { merge: true })
        }
      }
    }

    res.status(200).send('ok')
  } catch (err: any) {
    // Sempre 200 a Meta in caso di errore nostro (evita storm di retry)
    console.error('[whatsapp] webhook error:', err)
    res.status(200).send('ok')
  }
})

// ─────────────────────────── whatsappSend ───────────────────────────

interface SendArgs {
  to: string
  type: 'text' | 'template'
  text?: string
  templateName?: string
  languageCode?: string
  components?: unknown[]
}

export const whatsappSend = onCall({
  region: REGION,
  secrets: [META_WHATSAPP_TOKEN, META_PHONE_NUMBER_ID],
  maxInstances: 10,
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login richiesto')
  const args = (request.data || {}) as SendArgs
  const cid = normalizePhone(args.to)
  if (!cid) throw new HttpsError('invalid-argument', 'telefono non valido')

  const db = getFirestore()
  let payload: Record<string, unknown>

  if (args.type === 'text') {
    if (!args.text || typeof args.text !== 'string' || args.text.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'text richiesto')
    }
    // Verifica 24h window: messaggi liberi solo se il cliente ha scritto entro 24h
    const chatSnap = await db.doc(`whatsappChats/${cid}`).get()
    const wExp = chatSnap.exists ? (chatSnap.data()?.windowExpiresAt as Timestamp | undefined) : null
    if (!wExp || wExp.toMillis() < Date.now()) {
      throw new HttpsError('failed-precondition', 'Finestra 24h chiusa: usa un template approvato')
    }
    payload = {
      messaging_product: 'whatsapp',
      to: toMetaPhone(cid),
      type: 'text',
      text: { body: args.text.trim() },
    }
  } else if (args.type === 'template') {
    if (!args.templateName) throw new HttpsError('invalid-argument', 'templateName richiesto')
    payload = {
      messaging_product: 'whatsapp',
      to: toMetaPhone(cid),
      type: 'template',
      template: {
        name: args.templateName,
        language: { code: args.languageCode || 'it' },
        ...(args.components && Array.isArray(args.components) ? { components: args.components } : {}),
      },
    }
  } else {
    throw new HttpsError('invalid-argument', 'type non valido (text|template)')
  }

  const url = `${GRAPH_API}/${META_PHONE_NUMBER_ID.value()}/messages`
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${META_WHATSAPP_TOKEN.value()}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err: any) {
    console.error('[whatsapp] fetch error:', err)
    throw new HttpsError('unavailable', `Meta API non raggiungibile: ${err?.message || err}`)
  }

  const data: any = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    console.error('[whatsapp] send failed:', data)
    throw new HttpsError('internal', data?.error?.message || `Meta HTTP ${resp.status}`)
  }
  const metaMessageId: string | null = data?.messages?.[0]?.id || null

  const chatRef = db.doc(`whatsappChats/${cid}`)
  const msgId = metaMessageId || `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  await chatRef.collection('messages').doc(msgId).set({
    direction: 'out',
    type: args.type,
    text: args.text || null,
    templateName: args.templateName || null,
    components: args.components || null,
    metaMessageId,
    sentBy: request.auth.uid,
    sentByEmail: request.auth.token?.email || null,
    status: 'queued',
    createdAt: FieldValue.serverTimestamp(),
  })
  await chatRef.set({
    phone: cid,
    lastMessage: args.text || `[template:${args.templateName}]`,
    lastMessageAt: FieldValue.serverTimestamp(),
    lastDirection: 'out',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return { ok: true, metaMessageId, chatId: cid }
})

// ─────────────────────────── whatsappSendBulk (stub) ───────────────────────────

export const whatsappSendBulk = onCall({
  region: REGION,
  secrets: [META_WHATSAPP_TOKEN, META_PHONE_NUMBER_ID],
  maxInstances: 5,
  timeoutSeconds: 540,
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login richiesto')
  // TODO Fase 3: batching + rate limit + log invii per template
  throw new HttpsError('unimplemented', 'Bulk send da implementare in Fase 3')
})
