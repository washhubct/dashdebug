# Modal / Dialog

## Struttura

```html
<div id="modal-pagamento" class="modal">
  <div class="modal-box">

    <div class="modal-header">
      <h3>Registra Pagamento</h3>
      <button class="modal-close" onclick="chiudiModal('modal-pagamento')">✕</button>
    </div>

    <div class="modal-body">
      <div class="form-grid">
        <div class="ff">
          <label>Importo</label>
          <input type="number" placeholder="0.00">
        </div>
        <div class="ff">
          <label>Metodo</label>
          <select>
            <option>Contanti</option>
            <option>Carta</option>
            <option>Bonifico</option>
          </select>
        </div>
      </div>
      <div class="form-msg" id="msgPagamento"></div>
    </div>

    <div class="modal-footer">
      <button class="btn" onclick="chiudiModal('modal-pagamento')">Annulla</button>
      <button class="btn btn-primary" onclick="salvaPagamento()">Registra</button>
    </div>

  </div>
</div>
```

## Anatomy

| Elemento | Classe | Stile |
|----------|--------|-------|
| Overlay | `.modal` | fixed full-screen, `rgba(0,0,0,.5)`, z-index 100 |
| Box | `.modal-box` | bg white, border-radius 14–20px, shadow `0 12px 40px rgba(0,0,0,.5)`, max-width 480–600px |
| Header | `.modal-header` | flex, space-between, border-bottom, padding 16–20px |
| Titolo | `h3` in header | 600, 15px, --tx |
| Chiudi | `.modal-close` | 24px, testo --tx2, hover --red |
| Body | `.modal-body` | padding 20px, scroll se overflow |
| Footer | `.modal-footer` | flex, gap 10px, justify-end, border-top, padding 16px |

## Dimensioni

| Contenuto | Max-width |
|-----------|-----------|
| Form semplice (2–3 campi) | `420px` |
| Form medio (4–6 campi) | `520px` |
| Form complesso / dettaglio | `600px` |

Mai > 600px. Su mobile: `width: calc(100% - 32px)`, `max-height: 90vh`, scroll interno.

## Apertura / Chiusura

```js
function apriModal(id) {
  document.getElementById(id).style.display = 'flex';
}
function chiudiModal(id) {
  document.getElementById(id).style.display = 'none';
}
// Chiudi su click overlay
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) chiudiModal(m.id); });
});
```

Entry: `fadeIn .3s ease`.

## Tipi di Modal

| Tipo | Uso |
|------|-----|
| Pagamento | Registra incasso (metodo, importo, note) |
| Rinnovo abbonamento | Nuova scadenza + eventuale tariffa |
| Dettaglio prenotazione | Vista in sola lettura + azioni |
| Conferma eliminazione | "Eliminare questa prenotazione?" con 2 bottoni |

**Modal di conferma eliminazione:**
```html
<div class="modal-body">
  <p>Eliminare la prenotazione <strong>PREN-0042</strong>?</p>
  <p style="color:var(--tx2);font-size:12px">Questa azione non può essere annullata.</p>
</div>
<div class="modal-footer">
  <button class="btn">Annulla</button>
  <button class="btn" style="color:var(--red);border-color:var(--red)" onclick="elimina()">Elimina</button>
</div>
```

Il bottone elimina usa stile rosso con `.btn` base, non un componente separato.

## Regole d'uso

- Un solo modal aperto alla volta
- Il bottone primary nel footer è sempre l'azione principale
- L'overlay cliccabile chiude il modal (salvo form non salvato)
- Il titolo descrive l'azione, non l'oggetto: "Registra Pagamento", non "Pagamento"

## Anti-uso

- Non mettere tabelle o liste lunghe in modal (usa pagina dedicata)
- Non annidare modal
- Non usare modal per messaggi informativi brevi (usa toast o form-msg)
