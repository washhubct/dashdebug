# Badge

## Standard Badge (`.badge`)

Indica lo stato di un documento o record. Usato principalmente nelle celle tabella.

```html
<span class="badge g">Pagato</span>
<span class="badge r">Sospeso</span>
<span class="badge a">In Attesa</span>
<span class="badge b">Acconto</span>
```

| Proprietà | Valore |
|-----------|--------|
| Padding | `4px 10px` |
| Border-radius | `10px` |
| Font | 600, 10px, letter-spacing 0.3px |

| Variante | Classe | Testo | Background |
|----------|--------|-------|------------|
| Successo / Pagato | `.g` | `#34C759` | `rgba(52,199,89,.10)` |
| Pericolo / Sospeso | `.r` | `#FF3B30` | `rgba(255,59,48,.08)` |
| Attenzione / In Attesa | `.a` | `#FF9500` | `rgba(255,149,0,.10)` |
| Info / Acconto | `.b` | `#007AFF` | `rgba(0,122,255,.08)` |

## Status map per modulo

### Prenotazioni / Tappezzeria

| Stato | Badge |
|-------|-------|
| Pagato | `.g` Pagato |
| Sospeso | `.r` Sospeso |
| Acconto | `.b` Acconto |
| In attesa | `.a` In Attesa |
| Annullato | `.r` Annullato |

### Abbonamenti

| Stato | Badge |
|-------|-------|
| Attivo | `.g` Attivo |
| In scadenza (≤7gg) | `.a` In Scadenza |
| Scaduto | `.r` Scaduto |

### Giornalieri

| Stato | Badge |
|-------|-------|
| Pagato | `.g` Pagato |
| Non pagato | `.r` Non Pagato |

---

## Badge Mono (`.badge-sm`)

Versione monospace per ID documento o contatori nella sidebar.

```html
<span class="badge-sm">PREN-0042</span>
<span class="badge-sm">3</span>
```

| Proprietà | Valore |
|-----------|--------|
| Padding | `3px 8px` |
| Border-radius | `12px` |
| Font | JetBrains Mono, 600, 10px |

---

## Regole d'uso

- Un solo badge per cella tabella
- Il testo del badge corrisponde esattamente al termine del dominio (vedi §7.2 di DESIGN.md)
- Non usare badge per informazioni non di stato (usa testo normale)
- Non aggiungere icone dentro badge

## Anti-uso

- Non creare badge con testo > 2 parole
- Non usare colori del badge per segnalare priorità (usa accent color della card KPI)
- Non usare badge in titoli di sezione o header
