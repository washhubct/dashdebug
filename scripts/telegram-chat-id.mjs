// Stampa gli id delle chat/gruppi che hanno scritto al bot (per config/meteo.telegram.chatProposta / chatDipendenti).
// Uso: TELEGRAM_BOT_TOKEN="$(firebase functions:secrets:access TELEGRAM_BOT_TOKEN --project dashboard-washhub)" node scripts/telegram-chat-id.mjs
const t = process.env.TELEGRAM_BOT_TOKEN; if (!t) throw new Error('TELEGRAM_BOT_TOKEN mancante')
const j = await (await fetch(`https://api.telegram.org/bot${t}/getUpdates`)).json()
const chats = new Map()
for (const u of j.result || []) { const c = u.message?.chat || u.my_chat_member?.chat || u.channel_post?.chat; if (c) chats.set(c.id, `${c.type} "${c.title || c.first_name || ''}"`) }
if (!chats.size) console.log('Nessun messaggio ricevuto: scrivi qualcosa nel gruppo con il bot dentro e rilancia.')
for (const [id, d] of chats) console.log(id, d)
