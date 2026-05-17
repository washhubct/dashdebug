# Table

## Struttura

```html
<div class="tbl-wrap">
  <table class="tbl">
    <thead>
      <tr>
        <th>Data</th>
        <th>Cliente</th>
        <th>Targa</th>
        <th>Servizio</th>
        <th>Importo</th>
        <th>Stato</th>
        <th></th>  <!-- colonna azioni -->
      </tr>
    </thead>
    <tbody id="tbodyPrenotazioni">
      <tr>
        <td>17/05/2026</td>
        <td>Mario Rossi</td>
        <td style="font-family:var(--mono)">AA000BB</td>
        <td>Premium</td>
        <td>€ 45,00</td>
        <td><span class="badge g">Pagato</span></td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="act-btn" title="Modifica">✎</button>
            <button class="act-btn del" title="Elimina">✕</button>
          </div>
        </td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="font-weight:600">Totale</td>
        <td style="font-weight:700">€ 1.240,00</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
</div>
```

## Anatomy

| Elemento | Stile |
|----------|-------|
| `.tbl-wrap` | bg white, border 1px --brd, radius 14px, shadow-sm, overflow-x auto |
| `.tbl` | width 100%, border-collapse collapse, font-size 13px, white-space nowrap |
| `th` | bg --bg4, padding 12px 16px, 600 10px uppercase, --tx3, letter-spacing 1px, border-bottom --brd |
| `td` | padding 12px 16px, 400 13px --tx, border-bottom 1px --brd |
| `tfoot td` | bg --bg4, font 600, border-top 2px --brd2 |
| Row hover | bg `rgba(200,168,78,.06)`, transizione 0.15s |
| Ultima riga | `tr:last-child td { border-bottom: none; }` |

## Colonne speciali

**Codice documento (monospace):**
```html
<td style="font-family:var(--mono);font-size:12px;letter-spacing:.5px">PREN-0042</td>
```

**Importo (allineato a destra):**
```html
<th style="text-align:right">Importo</th>
<td style="text-align:right;font-weight:600">€ 45,00</td>
```

**Data:**
```html
<td style="font-family:var(--mono);font-size:12px">17/05/2026</td>
```

**Badge status:**
```html
<td><span class="badge g">Pagato</span></td>
<td><span class="badge r">Sospeso</span></td>
<td><span class="badge a">In Attesa</span></td>
<td><span class="badge b">Acconto</span></td>
```

**Azioni:**
```html
<td style="text-align:right">
  <div style="display:flex;gap:4px;justify-content:flex-end">
    <button class="act-btn" title="Modifica">✎</button>
    <button class="act-btn" title="Pagamento">€</button>
    <button class="act-btn del" title="Elimina">✕</button>
  </div>
</td>
```

## Empty State

```html
<tbody>
  <tr>
    <td colspan="7" class="empty">
      Nessuna prenotazione per il periodo selezionato.
    </td>
  </tr>
</tbody>
```

`.empty`: padding 40px, text-align center, 400 14px --tx3.

## Toolbar sopra la tabella

```html
<div class="pbar">
  <div class="filters">
    <button class="qbtn on">Tutti</button>
    <button class="qbtn">Pagati</button>
    <button class="qbtn">Sospesi</button>
  </div>
  <div class="search-box">
    <input type="text" placeholder="Cerca...">
  </div>
  <div style="margin-left:auto">
    <button class="btn btn-primary">+ Nuova Prenotazione</button>
  </div>
</div>
```

## Mobile

Su ≤ 768px il wrapper ha `overflow-x: auto` per scroll orizzontale. Gradient fade sui bordi per indicare il contenuto scrollabile.

Non collassare le colonne su mobile: le tabelle operative richiedono sempre visibilità completa.

## Regole d'uso

- Sempre `overflow-x: auto` sul wrapper
- Dati numerici allineati a destra
- Codici e date in font monospace
- La colonna azioni è sempre l'ultima
- Il `tfoot` mostra i totali quando significativi
- Max ~8–10 colonne visibili contemporaneamente

## Anti-uso

- Non usare tabelle per contenuto non tabulare (usa card o lista)
- Non usare `white-space: normal` nelle celle (rompe l'allineamento)
- Non mettere input editabili inline nelle celle (usa modal)
- Non omettere la colonna azioni se le righe sono modificabili
