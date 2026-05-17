# MULTISEDE-MIGRATION.md — Roadmap migrazione multi-sede

> Documento di roadmap architetturale. Non contiene codice da deployare ora.
> Obiettivo: preparare il gestionale a gestire più sedi (Lungomare + Paesi Etnei)
> senza rompere la struttura dati attuale.

---

## Contesto

**Wash Hub Lungomare** (Palermo) è la sede attuale. Sta aprendo **Wash Hub Paesi Etnei** (area Catania). Stesso brand, stessa codebase. I dati devono rimanere separati per sede ma visibili in aggregato dall'amministrazione.

Parallelamente, il gestionale viene productizzato come white-label per altri autolavaggi (modello B). Il design multi-sede è il precursore del design multi-tenant.

---

## Modello dati proposto

### Campo `sedeId`

Aggiungere il campo `sedeId` (string) a tutti i documenti operativi:

| Collection | Documenti esistenti | `sedeId` da assegnare |
|------------|---------------------|------------------------|
| `prenotazioni` | ~8.249 | `"lungomare"` |
| `tappezzeria` | da verificare | `"lungomare"` |
| `abbonamenti` | attivi | `"lungomare"` |
| `giornalieri` | da verificare | `"lungomare"` |
| `uscite` | tutte | `"lungomare"` |
| `presenzeDipendenti` | tutte | `"lungomare"` |
| `storico` | tutti i record sospesi | `"lungomare"` |
| `clienti` | CRM | `"lungomare"` (o condiviso — vedi §Clienti) |

**Valori `sedeId` definiti:**
- `"lungomare"` — Wash Hub Lungomare, Palermo
- `"paesi-etnei"` — Wash Hub Paesi Etnei, area Catania

---

## Opzioni di struttura collection

### Option A — Filtro su collection esistenti (raccomandato)

Le collection rimangono quelle attuali. Ogni query aggiunge `.where('sedeId', '==', sedeAttiva)`.

```
prenotazioni/
  PREN-0001  { sedeId: "lungomare", ... }
  PREN-0002  { sedeId: "paesi-etnei", ... }
```

**Pro:**
- Migrazione minima (solo backfill campo)
- Indici esistenti riutilizzabili (aggiungere indice composto `sedeId + data`)
- Reporting aggregato triviale (rimuovere il filtro sedeId)
- Compatible con struttura white-label (aggiungere `tenantId` in futuro)

**Contro:**
- Regole Firestore più complesse (controllare `sedeId` e `userId`)
- Con 2–3 sedi le collection crescono: necessari indici composti

---

### Option B — Subcollection per sede

```
sedi/
  lungomare/
    prenotazioni/
      PREN-0001 { ... }
  paesi-etnei/
    prenotazioni/
      PREN-0002 { ... }
```

**Pro:**
- Separazione dati netta a livello Firestore
- Regole di sicurezza più semplici (path-based)

**Contro:**
- Reporting aggregato richiede collectionGroup query (più costoso)
- Migrazione invasiva: tutti i path JS devono cambiare
- Non compatible con modello white-label (i tenant non sono sedi)
- Non ideale per AVR (ha già filiali, pattern diverso)

---

### Option C — Multi-tenant con tenantId

```
tenants/
  washhub/
    prenotazioni/
      PREN-0001 { sedeId: "lungomare", ... }
  altro-cliente/
    prenotazioni/
      PREN-0001 { ... }
```

**Pro:**
- Separazione completa tra clienti white-label
- Massima sicurezza (ogni tenant vede solo i propri dati)

**Contro:**
- Over-engineering per fase attuale (2 sedi, 1 tenant)
- Costoso da implementare ora: tutti i path, tutte le rules
- Meglio affrontare quando si onboarda il primo cliente white-label reale

**Decisione:** implementare Option A ora. Strutturare il campo `sedeId` in modo da poter aggiungere `tenantId` in futuro senza cambiare il modello.

---

## Selettore sede — UX

Ispirato al selettore filiali di AVR Delivery Hub.

### Desktop (sidebar o topbar)

```
[ Wash Hub ▼ ]
  ● Lungomare (Palermo)
  ○ Paesi Etnei (Catania)
  — Tutte le sedi
```

- Posizione: sotto il logo in sidebar, o dropdown nel topbar
- La sede selezionata viene salvata in `localStorage` e in Firestore (profilo utente)
- Il `body` riceve `data-sede="lungomare"` per applicare l'accent color della sede

### Mobile

Dropdown compatto nel topbar, accanto al nome pagina.

### Stato globale

```js
// Stato corrente sede
let sedeAttiva = localStorage.getItem('sedeAttiva') || 'lungomare';

// Ogni query Firestore
db.collection('prenotazioni')
  .where('sedeId', '==', sedeAttiva)
  .where('data', '>=', dataInizio)
  ...
```

Utenti con accesso a entrambe le sedi vedono il selettore. Utenti monosede non vedono il selettore (sedeAttiva è fissa).

---

## Role-based access

### Ruoli proposti

| Ruolo | Accesso |
|-------|---------|
| `admin` | Tutte le sedi + configurazione |
| `operatore-lungomare` | Solo sede Lungomare |
| `operatore-paesi-etnei` | Solo sede Paesi Etnei |
| `contabile` | Tutte le sedi, solo report (no scrittura) |

### Implementazione

I ruoli sono salvati nei **Firebase Auth Custom Claims** (via Admin SDK o Functions):

```json
{ "role": "operatore-lungomare", "sedi": ["lungomare"] }
```

Le Firestore Security Rules controllano il custom claim:

```
match /prenotazioni/{doc} {
  allow read, write: if
    request.auth.token.role == 'admin' ||
    (request.auth.token.sedi.hasAny([resource.data.sedeId]));
}
```

**Attenzione Guido:** da chiarire se Sebastiano avrà accesso a Paesi Etnei o solo Lungomare. Impatta le rules al momento della migrazione.

---

## Clienti CRM — gestione cross-sede

Un cliente (persona) può usare entrambe le sedi. Opzioni:

**A) Clienti condivisi** — collection `clienti` senza `sedeId`. Pro: autocomplete unificato, storico completo. Contro: più complesso per il white-label.

**B) Clienti per sede** — `clienti` con `sedeId`. Pro: separazione netta. Contro: duplicati per clienti cross-sede.

Raccomandazione: **Option A** (clienti condivisi) per Wash Hub multi-sede. Quando si affronta il white-label, ogni tenant avrà la propria collection `clienti`.

---

## Reporting

### Vista per sede

Filtro `sedeId == sedeAttiva` su tutte le query del modulo Prima Nota.

### Vista aggregata

Rimuovere il filtro `sedeId` (o usare `sedeId in ['lungomare', 'paesi-etnei']`). Mostrare due colonne o due serie nei grafici.

### Dashboard confronto sedi

Nuova sezione "Multi-sede" (solo utenti `admin` e `contabile`) con:
- KPI side-by-side per sede
- Grafico sovrapposizione incassi mensili
- Tabella sospesi per sede

---

## Path di migrazione dati

### Fase 1 — Backfill `sedeId` su record esistenti

Script una-tantum (Node.js con Admin SDK, non nel browser):

```js
// ATTENZIONE: fare export Firestore collection PRIMA di eseguire
// firebase firestore:export gs://backup-bucket/pre-migration-$(date +%Y%m%d)

const collections = ['prenotazioni','tappezzeria','abbonamenti',
                      'giornalieri','uscite','presenzeDipendenti','storico'];

for (const coll of collections) {
  const snap = await db.collection(coll).get();
  const batch = db.batch();
  snap.docs.forEach(doc => {
    if (!doc.data().sedeId) {
      batch.update(doc.ref, { sedeId: 'lungomare' });
    }
  });
  await batch.commit();
  console.log(`${coll}: ${snap.size} docs aggiornati`);
}
```

**Prerequisiti prima di eseguire:**
1. Export Firestore completo su Cloud Storage (backup)
2. Test su collection piccola (`uscite`) prima delle grandi
3. Verificare che nessun record abbia già `sedeId` valorizzato diversamente
4. Eseguire in orario basso traffico (notte)

### Fase 2 — Aggiornare le query JS

Ogni modulo aggiunge il filtro sede:
```js
// Prima
db.collection('prenotazioni').where('data', '==', oggi)
// Dopo
db.collection('prenotazioni').where('sedeId', '==', sedeAttiva).where('data', '==', oggi)
```

**Moduli da aggiornare:**
- `js/moduli/prenotazioni.js`
- `js/moduli/tappezzeria.js`
- `js/moduli/abbonamenti.js`
- `js/moduli/giornalieri.js`
- `js/moduli/sospesi.js`
- `js/moduli/prima-nota.js` (o report.js)
- `js/moduli/presenze.js`

### Fase 3 — Aggiornare Firestore rules

Aggiungere controllo `sedeId` basato sul custom claim utente.

### Fase 4 — Aggiornare indici Firestore

Aggiungere indici composti per le query più frequenti:
```
Collection: prenotazioni
Fields: sedeId ASC, data DESC
Fields: sedeId ASC, stato ASC, data DESC
```

### Fase 5 — UI selettore sede

Implementare dropdown sede in sidebar/topbar. Aggiornare `data-sede` su `body`.

### Fase 6 — Onboarding Paesi Etnei

Creare utenti Firebase Auth per nuovi operatori con custom claim `sedi: ["paesi-etnei"]`. Iniziare a inserire prenotazioni con `sedeId: "paesi-etnei"`.

---

## Domande aperte per Guido

1. **Partita IVA:** Lungomare e Paesi Etnei usano la stessa P.IVA o due entità fiscali separate? Questo impatta:
   - Come viene strutturata la Prima Nota (unico registro vs separato)
   - Se Michela ha bisogno di report separati per commercialista
   - Se serve numerazione fatture separata per sede

2. **Sebastiano:** avrà accesso a Paesi Etnei? O ci sarà un operatore dedicato lì?

3. **Timing:** quando si prevede l'apertura di Paesi Etnei? La migrazione dati va fatta prima dell'apertura per non avere record senza `sedeId`.

4. **Clienti cross-sede:** un cliente Lungomare che usa anche Paesi Etnei — deve apparire nello storico di entrambe? (risposta probabile: sì, rilevante per VIP pricing)

---

## Timeline suggerita

| Fase | Durata stimata | Prerequisito |
|------|---------------|--------------|
| Risposta alle domande aperte | — | Decisione Guido |
| Backfill `sedeId` su record Lungomare | 1h | Export backup |
| Update query JS + test | 1 sessione | Backfill completato |
| Update Firestore rules + indici | 1h | Query update |
| UI selettore sede | 1 sessione | Rules update |
| Onboarding Paesi Etnei | 30min | Sede operativa |

**Prima di tutto:** rispondere alle domande fiscali (P.IVA unica o doppia).
