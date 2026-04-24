# Note protocollo VNE 3.05 — mappa errori

> Riassunto operativo della Appendice I del protocollo "VNE Automatic
> Cash Self-Cash API" v3.05. Le label IT sono quelle effettivamente
> mostrate all'utente nel gestionale (`js/moduli/cassa-automatica.js`).

## Schema risposta

Ogni POST a `/selfcashapi/` ritorna JSON con almeno:

```json
{ "req_status": 0|1, "mess": <int>, ... }
```

- `req_status = 0` → operazione accettata (per il polling lo stato
  reale del pagamento è in `status`: `pending` → `in_progress` →
  `completed` | `partial` | `deleted` | `returned`).
- `req_status = 1` → NACK: `mess` ha il codice errore.

## Codici `mess` mappati

| mess | Causa VNE | Messaggio UI italiano |
|------|-----------|------------------------|
| 0    | OK | (nessun messaggio) |
| 100  | ID transazione sconosciuto | "Transazione non trovata, riprova" |
| 101  | Importo non valido | "Importo non valido" |
| 102  | Operatore non valido | "Operatore non riconosciuto" |
| 105  | Importo fuori range consentito | "Importo fuori limiti cassa" |
| 106  | Taglio non disponibile per resto | "Taglio non disponibile in cassa, rifornire" |
| 110  | Cassa già impegnata | "Cassa occupata da altra operazione" |
| 111  | Operazione non rimborsabile | "Operazione non rimborsabile" |
| 115  | Rimborso non disponibile | "Rimborso non possibile in questo stato" |
| 120  | Token / autenticazione errata | "Token autenticazione errato" |
| 130  | Tipo comando non supportato | "Comando non supportato dalla cassa" |
| 200  | Recycler offline / errore HW | "Erogatore monete in errore" |
| 210  | Hopper offline / errore HW | "Hopper monete in errore" |
| 220  | Banconote periferica in errore | "Lettore banconote in errore" |
| 230  | Anomalia generica HW | "Errore hardware cassa, contattare assistenza" |
| 999  | (mock) tipo non gestito | "Comando di test non riconosciuto" |

> Mancanti: codici non documentati o specifici di firmware più recenti
> ricadono nel fallback "Errore cassa, riprova".

## Stati `status` durante polling pagamento (tipo=2)

| status | Cosa significa | UI |
|--------|----------------|----|
| `pending` | Attesa primo inserimento | spinner + "In attesa..." |
| `in_progress` | Cliente sta inserendo denaro | progress + "Inserito €X di €Y" |
| `completed` | Importo raggiunto, resto erogato | check verde, chiusura |
| `partial` | Annullato con accettazione parziale | conferma operatore |
| `deleted` | Annullato con restituzione | toast "Pagamento annullato" |
| `returned` | Cliente ha ritirato denaro | toast "Restituito €X" |

## Tipi annullamento (tipo=3)

- `tipo_annullamento = 1` → annulla con accettazione parziale (operatore
  decide di salvare l'incasso parziale).
- `tipo_annullamento = 2` → annulla con restituzione completa al cliente
  (default usato dal pulsante "Annulla").

## Note importanti

- **Importi sempre in centesimi**: `590` significa `5,90 €`. Errori comuni
  sono dovuti a invio in euro float.
- **Timeout protocollo 5 s**, il bridge usa 7 s (margine 2 s) e mappa eventuali
  scaduti su HTTP 504.
- **Polling**: la cassa accetta polling fino a `maxPollingMs` (default 180 s
  = 3 min lato gestionale). Oltre, l'operatore deve annullare manualmente.
- **Refundable**: tipo=1 invia sempre `refundable: 1` per consentire
  rimborsi successivi se il cliente reclama.
