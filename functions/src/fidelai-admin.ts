/**
 * Callable functions per la pagina FidelAI nel gestionale dashdebug.
 * Proxy verso le external API di fideliai-app: il Bearer secret resta
 * server-side, mai esposto al browser.
 *
 * Auth: richiede utente autenticato sul gestionale (request.auth).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineString, defineSecret } from 'firebase-functions/params'

const FIDELAI_API_BASE = defineString('FIDELAI_API_BASE', {
  default: 'https://europe-west1-fideliai-app.cloudfunctions.net',
})
const FIDELAI_MERCHANT = defineString('FIDELAI_MERCHANT', { default: 'washhub' })
const FIDELAI_BRIDGE_SECRET = defineSecret('FIDELAI_BRIDGE_SECRET')

const REGION = 'europe-west1'

const baseOpts = {
  region: REGION,
  secrets: [FIDELAI_BRIDGE_SECRET],
  maxInstances: 10,
}

async function callFidelai(path: string, body: Record<string, unknown>): Promise<any> {
  const url = `${FIDELAI_API_BASE.value()}/${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FIDELAI_BRIDGE_SECRET.value()}`,
    },
    body: JSON.stringify(body),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) {
    throw new HttpsError(
      res.status === 400 ? 'invalid-argument' : 'internal',
      data.error || `FidelAI ${path} HTTP ${res.status}`
    )
  }
  return data
}

/**
 * Applica un codice riscatto 4 cifre dettato dal cliente alla cassa.
 * Input: { code: string }
 * Output: { customerName, rewardName, pointsCost, newPoints, transactionId }
 */
export const fidelaiRedeem = onCall(baseOpts, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Devi essere autenticato.')

  const code = String((req.data as any)?.code || '').replace(/\D/g, '')
  if (code.length !== 4) {
    throw new HttpsError('invalid-argument', 'Codice non valido (4 cifre)')
  }

  return callFidelai('validateAndApplyRedeem', {
    merchant: FIDELAI_MERCHANT.value(),
    code,
  })
})
