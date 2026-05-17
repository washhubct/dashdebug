# DESIGN-TEMPLATE.md — {{BRAND_NAME}} Gestionale Autolavaggio

> Versione white-label del design system Wash Hub.
> Tutti i riferimenti al brand specifico sono sostituiti da placeholder.
> Questo documento è il punto di partenza per ogni nuovo cliente del template.

---

## CUSTOMIZATION GUIDE — Cosa sostituire per brandizzare

Prima di iniziare, sostituisci questi 5 placeholder in tutto il progetto:

| Placeholder | Descrizione | Esempio |
|-------------|-------------|---------|
| `{{BRAND_NAME}}` | Nome del brand / insegna | `"Lava & Vai"` |
| `{{PRIMARY_COLOR}}` | Colore primario (hex) | `"#2563EB"` |
| `{{PRIMARY_COLOR_HOVER}}` | Versione scura (+15% luminosità) | `"#1D4ED8"` |
| `{{SEDE_NOME}}` | Nome della sede principale | `"Centrale"` |
| `{{CONTACT_EMAIL}}` | Email operativa | `"info@lavaevai.it"` |

Questi 5 valori vanno aggiornati in:
1. `css/` — CSS custom properties in `:root`
2. `index.html` — meta title, header sidebar, footer
3. `js/config.js` — nome brand e sede nei log/messaggi

Tutto il resto del design system (componenti, layout, tipografia, motion) rimane invariato.

---

## 1. COLORS

### 1.1 Brand Primary

| Token | Placeholder | Note |
|-------|-------------|------|
| `--primary` | `{{PRIMARY_COLOR}}` | Colore principale bottoni, accenti attivi |
| `--primary-light` | Derivato a +40% lightness | Per stati hover leggeri |
| `--primary-subtle` | `{{PRIMARY_COLOR}}` a 8% opacity | Background chip/badge |
| `--primary-ring` | `{{PRIMARY_COLOR}}` a 30% opacity | Focus ring |
| `--primary-hover` | `{{PRIMARY_COLOR}}` a 6% opacity | Hover righe tabella |
| `--primary-dark` | `{{PRIMARY_COLOR_HOVER}}` | Hover bottone primario |

**Come calcolare le varianti dal colore primario:**

```css
:root {
  /* Sostituisci con il colore del cliente */
  --primary: {{PRIMARY_COLOR}};
  --primary-dark: {{PRIMARY_COLOR_HOVER}};
  --primary-subtle: color-mix(in srgb, var(--primary) 8%, transparent);
  --primary-ring: color-mix(in srgb, var(--primary) 30%, transparent);
  --primary-hover: color-mix(in srgb, var(--primary) 6%, transparent);
}
```

---

### 1.2 Neutrals

Identici al sistema base — non modificare.

| Token | Valore | Uso |
|-------|--------|-----|
| `--bg` | `#F2F2F7` | Background app |
| `--bg2` | `#FFFFFF` | Card, panel |
| `--bg4` | `#F9F9FB` | Header tabella |
| `--brd` | `rgba(0,0,0,.06)` | Border sottile |
| `--brd2` | `rgba(0,0,0,.10)` | Border input |
| `--tx` | `#1C1C1E` | Testo primario |
| `--tx2` | `#636366` | Testo secondario |
| `--tx3` | `#AEAEB2` | Testo terziario |

---

### 1.3 Semantic

Identici al sistema base — non modificare. Questi colori sono universali e non appartengono al brand.

| Token | Valore | Uso |
|-------|--------|-----|
| `--grn` | `#34C759` | Successo, pagato |
| `--red` | `#FF3B30` | Errore, sospeso |
| `--amb` | `#FF9500` | Attenzione, scadenza |
| `--blu` | `#007AFF` | Info, acconto |

---

### 1.4 Location Variants

Se il cliente ha più sedi, definire un accent per ciascuna:

```css
[data-sede="{{SEDE_1_ID}}"] { --sede-accent: {{SEDE_1_COLOR}}; }
[data-sede="{{SEDE_2_ID}}"] { --sede-accent: {{SEDE_2_COLOR}}; }
```

L'accent viene usato nel sidebar logo e nell'indicatore sede nel topbar.

---

## 2. TYPOGRAPHY

### Font consigliato

**Inter** (Google Fonts, gratuito) è il default. È la scelta corretta per gestionale operativo:
- Ottima leggibilità a 13–14px
- Disponibile in tutti i weight necessari
- Nessun costo di licenza

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Per brandizzare con un font proprietario del cliente, sostituire solo il `font-family` in `:root --f`. Tutti i size, weight e spacing rimangono invariati.

### Type Scale

Invariata rispetto al sistema base. Vedi §2 di DESIGN.md.

---

## 3. SPACING

Invariato. Griglia base 4px. Vedi §3 di DESIGN.md.

---

## 4. LAYOUT

Invariato. Struttura sidebar 260px + topbar + main. Vedi §4 di DESIGN.md.

---

## 5. COMPONENTS

Invariati. Tutti i componenti (button, card, modal, input, table, badge) funzionano con qualsiasi `--primary`. L'unica modifica è sostituire `--gold` con `--primary` nelle CSS rules.

**Ricerca e sostituzione CSS:**
```
Sostituisci: var(--gold)     →  var(--primary)
Sostituisci: var(--gold-light) → var(--primary-light)
Sostituisci: var(--gold-subtle) → var(--primary-subtle)
Sostituisci: var(--gold-ring)   → var(--primary-ring)
Sostituisci: var(--gold-hover)  → var(--primary-hover)
Sostituisci: #B8963E          → var(--primary-dark)
Sostituisci: #C8A84E          → var(--primary)
```

---

## 6. MOTION

Invariato. Vedi §6 di DESIGN.md.

---

## 7. VOICE & TONE

### Lingua

Il sistema è progettato per italiano. Per adattare a un'altra lingua:
- Aggiornare tutte le stringhe in `js/moduli/*.js`
- Aggiornare microcopy in `index.html`
- Aggiornare label dei badge e stati

### Terminologia personalizzabile

Sostituire questi termini se il cliente usa denominazioni diverse:

| Template default | Alternativa comune |
|------------------|--------------------|
| Prenotazione | Appuntamento, Ordine |
| Sospeso | Residuo, Da incassare |
| Prima Nota | Registro cassa, Contabilità |
| Abbonamento | Tessera, Contratto |

Le modifiche vanno propagate in: label HTML, messaggi JS, badge stati, filtri qbtn.

### Microcopy

Mantenere il registro diretto e professionale. Non aggiungere elementi decorativi (emoji, esclamazioni, saluti) nei testi operativi.

---

## 8. BRAND

### Sidebar Logo

```html
<div class="sb-logo">
  <!-- Opzione A: icona testo -->
  <div class="sb-icon">{{BRAND_INITIAL}}</div>
  <div>
    <h1>{{BRAND_NAME}}</h1>
    <span>{{SEDE_NOME}}</span>
  </div>

  <!-- Opzione B: logo immagine -->
  <img src="assets/logo.svg" alt="{{BRAND_NAME}}" height="32">
</div>
```

**Specifiche logo immagine:**
- Formato: SVG (raccomandato) o PNG @2x
- Altezza: 32px (sidebar), 24px (topbar mobile)
- Sfondo: trasparente
- Colore: adattato al tema (mono dark o con primary color)

### Favicon

```html
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/icon-180.png">
```

### Footer / Credits

```html
<!-- In sb-footer -->
<div class="sb-brand-note">
  Gestionale {{BRAND_NAME}} · v{{VERSION}}
</div>
```

---

## 9. ANTI-PATTERNS

Identici al sistema base. Vedi §9 di DESIGN.md.

Aggiunta specifica per il template white-label:
- **Non hardcodare** il nome brand nel CSS o JS — sempre da config/variabile
- **Non modificare** la struttura dei componenti per personalizzare — usa solo token
- **Non aggiungere** moduli custom senza documentarli nel CLAUDE.md del cliente
- **Non cambiare** il nome delle classi CSS — rende impossibile applicare aggiornamenti del template base

---

## CHECKLIST SETUP NUOVO CLIENTE

Prima del go-live con un nuovo cliente:

- [ ] Sostituiti tutti i `{{BRAND_NAME}}` in HTML, JS, CSS
- [ ] Aggiornato `{{PRIMARY_COLOR}}` e varianti in `:root`
- [ ] Caricato logo SVG in `assets/logo.svg`
- [ ] Caricato favicon in `assets/favicon.svg`
- [ ] Aggiornato Firebase project ID in `js/config.js`
- [ ] Aggiornato dominio in `CNAME`
- [ ] Aggiornate le Firestore security rules per il nuovo tenant
- [ ] Testato su Chrome desktop + Safari mobile
- [ ] Creato utente operatore in Firebase Auth
- [ ] Comunicato accesso all'operatore con credenziali temporanee
