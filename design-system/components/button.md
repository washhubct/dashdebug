# Button

## Varianti

### Primary (`.btn.btn-primary`)

Azione principale della sezione. Una sola per area visibile.

```html
<button class="btn btn-primary">+ Nuova Prenotazione</button>
<button class="btn btn-primary">Salva</button>
<button class="btn btn-primary">Registra Pagamento</button>
```

| Proprietà | Valore |
|-----------|--------|
| Background | `#C8A84E` (--gold) |
| Testo | `#FFFFFF`, 600, 13px |
| Padding | `9px 18px` |
| Border-radius | `10px` (--r2) |
| Shadow | `0 2px 8px rgba(200,168,78,.30)` |
| Hover | bg `#B8963E`, shadow più forte, `translateY(-1px)` |
| Active | `translateY(0)`, `scale(.98)` |

---

### Secondary (`.btn`)

Azioni secondarie, annulla, export.

```html
<button class="btn">Annulla</button>
<button class="btn">Esporta CSV</button>
```

| Proprietà | Valore |
|-----------|--------|
| Background | `#FFFFFF` (--bg2) |
| Border | `1px solid rgba(0,0,0,.10)` |
| Testo | `#1C1C1E`, 500, 13px |
| Padding | `9px 18px` |
| Hover | border gold, bg `rgba(200,168,78,.08)` |

---

### Query / Filter Pill (`.qbtn`)

Filtri rapidi temporali o per stato. Uno solo attivo alla volta.

```html
<div class="filters">
  <button class="qbtn on">Oggi</button>
  <button class="qbtn">Settimana</button>
  <button class="qbtn">Mese</button>
  <button class="qbtn">Tutti</button>
</div>
```

| Proprietà | Valore |
|-----------|--------|
| Border-radius | `20px` (pill) |
| Padding | `6px 16px` |
| Font | 500, 12px |
| Default | bg bianco, border sottile |
| `.on` (attivo) | bg `--gold`, testo bianco |

---

### Action Button (`.act-btn`)

Operazioni inline sulle righe di tabella (modifica, elimina, pagamento).

```html
<button class="act-btn" title="Modifica">✎</button>
<button class="act-btn" title="Pagamento">€</button>
<button class="act-btn del" title="Elimina">✕</button>
```

| Proprietà | Default | `.del` (elimina) |
|-----------|---------|------------------|
| Size | `32px × 32px` | stesso |
| Mobile size | `44px × 44px` | stesso |
| Border-radius | `8px` | stesso |
| Hover testo | `--gold` | `--red` |
| Hover border | gold | red |
| Hover bg | `rgba(200,168,78,.08)` | `rgba(255,59,48,.06)` |

---

## Stati

| Stato | Apparenza |
|-------|-----------|
| Default | Come da specifiche sopra |
| Hover | Cambio colore + lift (primary) |
| Active/Pressed | `scale(.98)` o `scale(.95)` |
| Disabled | `opacity: .45`, `cursor: not-allowed` |
| Focus | outline gold ring |

## Regole d'uso

- Max 1 `.btn-primary` per sezione / form
- Le azioni distruttive usano un modal di conferma, non un bottone rosso diretto
- I `.qbtn` sono mutually exclusive: uno solo `.on` alla volta
- I `.act-btn` non hanno label testuale: usa sempre `title` per accessibilità

## Anti-uso

- Non usare `btn-primary` per azioni distruttive
- Non aggiungere icone dentro `.btn` salvo `+` prefisso
- Non mettere più di 3 `.act-btn` per riga
