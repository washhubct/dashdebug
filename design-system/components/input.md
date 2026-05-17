# Input / Form Fields

## Struttura base

```html
<div class="ff">
  <label>Nome Cliente</label>
  <input type="text" placeholder="Mario Rossi">
  <div class="form-msg"></div>
</div>
```

## Anatomy

| Elemento | Classe | Stile |
|----------|--------|-------|
| Wrapper | `.ff` | layout verticale |
| Label | `label` | 600, 10px, uppercase, --tx3, letter-spacing 0.8px, margin-bottom 6px |
| Input | `input` | --bg background, border 1.5px solid --brd2, radius 10px, padding 10px 14px, 14px font |
| Messaggio | `.form-msg` | 400, 12px, min-height 18px, colore dinamico |

## Varianti

### Text / Number
```html
<div class="ff">
  <label>Targa</label>
  <input type="text" placeholder="AA000BB">
</div>

<div class="ff">
  <label>Importo (€)</label>
  <input type="number" placeholder="0.00" step="0.01">
</div>
```

### Select
```html
<div class="ff">
  <label>Servizio</label>
  <select>
    <option value="">— Seleziona —</option>
    <option value="base">Base</option>
    <option value="premium">Premium</option>
  </select>
</div>
```

### Textarea
```html
<div class="ff">
  <label>Note</label>
  <textarea rows="3" placeholder="Note aggiuntive..."></textarea>
</div>
```

### Date Input
```html
<div class="ff">
  <label>Data Appuntamento</label>
  <input type="date">
</div>
```
Font: JetBrains Mono (monospace). Padding: `7px 12px`.

### Search Box
```html
<div class="search-box">
  <input type="text" placeholder="Cerca cliente...">
</div>
```
Border-radius: `20px` (pill). Width: `220px` → `260px` on focus.

## Stati

| Stato | Apparenza |
|-------|-----------|
| Default | bg --bg, border 1.5px --brd2 |
| Focus | border --gold, shadow `0 0 0 3px rgba(200,168,78,.30)` |
| Error | border --red, .form-msg colore --red |
| Success | .form-msg colore --grn |
| Disabled | opacity .5, cursor not-allowed |

## Mobile

Su viewport ≤ 430px: `font-size: 16px` obbligatorio per evitare zoom automatico iOS.

## Form Grid

```html
<div class="form-grid">
  <div class="ff">...</div>
  <div class="ff">...</div>
  <div class="ff ff-full">...</div>  <!-- full width -->
</div>
```

Grid: `repeat(auto-fill, minmax(180px, 1fr))`, gap 14px.
Mobile ≤ 768px: 2 col. Mobile ≤ 430px: 1 col.

## Validazione

```js
function validaForm() {
  const telefono = input.value.trim();
  if (!telefono) {
    msg.textContent = 'Numero di telefono obbligatorio.';
    msg.style.color = 'var(--red)';
    return false;
  }
  return true;
}
```

Il campo `telefono` è sempre obbligatorio (vincolo business critico).

## Regole d'uso

- Label sempre in uppercase 10px — mai in sentence case
- Il `.form-msg` è sempre presente anche vuoto (preserva spazio layout)
- Campi raggruppati logicamente in `.form-grid`
- Textarea con `resize: vertical`, mai `resize: none`
- Placeholder descrittivo (es. `"AA000BB"` non `"Inserisci targa"`)

## Anti-uso

- Non usare label inline dentro input
- Non omettere `.form-msg` (rompe il layout al momento della validazione)
- Non creare form con più di 8 campi visibili (dividere in sezioni o modal)
