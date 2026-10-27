import { defineSecret } from 'firebase-functions/params'

export const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN')

// chatId: uno o più id separati da virgola (chat private di Guido e Skippa, o un gruppo)
export async function telegram(chatId: string, text: string) {
  const token = TELEGRAM_BOT_TOKEN.value()
  const ids = String(chatId || '').split(',').map(x => x.trim()).filter(Boolean)
  if (!token || token.length < 20 || !ids.length) { console.warn('Telegram non configurato: messaggio non inviato'); return false }
  let ok = false
  for (const id of ids) {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: id, text, parse_mode: 'HTML', disable_web_page_preview: true }) })
    if (!r.ok) console.error('Telegram', id, r.status, (await r.text()).slice(0, 200)); else ok = true
  }
  return ok
}
