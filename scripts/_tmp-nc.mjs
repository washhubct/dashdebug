import admin from 'firebase-admin';
admin.initializeApp({ projectId: 'dashboard-washhub' });
const db = admin.firestore();
const s = (await db.doc('secrets/fic').get()).data();
let token = s.accessToken;
if (Date.now() > (s.expiresAt || 0) - 60000) { const d = await (await fetch('https://api-v2.fattureincloud.it/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: s.refreshToken, client_id: s.clientId, client_secret: s.clientSecret }) })).json(); await db.doc('secrets/fic').set({ accessToken: d.access_token, refreshToken: d.refresh_token || s.refreshToken, expiresAt: Date.now() + (d.expires_in || 86400) * 1000 }, { merge: true }); token = d.access_token; }
const H = { Authorization: `Bearer ${token}` };
const base = `https://api-v2.fattureincloud.it/c/${s.companyId}`;
const r = await fetch(`${base}/issued_documents?type=credit_note&per_page=5`, { headers: H });
console.log('credit_note list:', r.status, (await r.text()).slice(0, 200));
const d = (await (await fetch(`${base}/issued_documents/548537235?fieldset=detailed`, { headers: H })).json()).data;
console.log('n.30', d.date, d.entity?.name, d.amount_gross, d.ei_status, JSON.stringify(d.items_list.map(i => ({ n: i.name, q: i.qty, g: i.gross_price, v: i.vat?.id }))), JSON.stringify(d.ei_data));
