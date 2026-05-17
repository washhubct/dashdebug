# DESIGN.md — Wash Hub Gestionale Design System

> Documento di riferimento per il design system del gestionale Wash Hub.
> Estratto dal codebase esistente, pronto per ingestione da Claude Design.
> Ultima revisione: maggio 2026.

---

## 1. COLORS

### 1.1 Brand Primary — Oro Wash Hub

| Token | Valore | Uso |
|-------|--------|-----|
| `--gold` | `#C8A84E` | Brand primary, bottoni primari, accenti attivi |
| `--gold-light` | `#E8D590` | Oro chiaro, variante decorativa |
| `--gold-subtle` | `rgba(200,168,78,.08)` | Background leggero su elementi dorati |
| `--gold-ring` | `rgba(200,168,78,.3)` | Focus ring, shadow bottoni |
| `--gold-hover` | `rgba(200,168,78,.06)` | Hover su righe tabella |
| `#B8963E` | Hover scuro del gold | Solo per stato hover bottone primario |

**Scala estesa oro (proposta per componentistica futura):**

| Step | Hex | Uso suggerito |
|------|-----|---------------|
| 50 | `#FBF7EC` | Background chip/badge molto leggero |
| 100 | `#F4EAC9` | Background sezioni highlight |
| 200 | `#E8D590` | `--gold-light` |
| 300 | `#D9BC6A` | Border su elementi gold |
| 400 | `#C8A84E` | **`--gold` — primary** |
| 500 | `#B8963E` | Hover/pressed state |
| 600 | `#9A7B2F` | Active state |
| 700 | `#7A6025` | Dark variant |
| 800 | `#5A4519` | Very dark |
| 900 | `#3A2D0E` | Near-black gold tint |

---

### 1.2 Neutrals

| Token | Valore | Uso |
|-------|--------|-----|
| `--bg` | `#F2F2F7` | Background principale app (grigio iOS chiaro) |
| `--bg2` | `#FFFFFF` | Card, modal, pannelli form |
| `--bg3` | `#FFFFFF` | Background annidati |
| `--bg4` | `#F9F9FB` | Header tabella, footer card |
| `--brd` | `rgba(0,0,0,.06)` | Border sottile (divisori, outline card) |
| `--brd2` | `rgba(0,0,0,.10)` | Border più visibile (input default) |
| `--tx` | `#1C1C1E` | Testo primario (carbon Apple) |
| `--tx2` | `#636366` | Testo secondario (subtitle, note) |
| `--tx3` | `#AEAEB2` | Testo terziario (label, placeholder, empty) |
| — | `#FFFFFF` | Testo su bottone primario/oro |

---

### 1.3 Semantic — Status Colors

| Token | Hex | Variante BG | Uso |
|-------|-----|-------------|-----|
| `--grn` | `#34C759` | `rgba(52,199,89,.10)` | Successo, pagato, attivo |
| `--red` | `#FF3B30` | `rgba(255,59,48,.08)` | Errore, sospeso, cancellato |
| `--amb` | `#FF9500` | `rgba(255,149,0,.10)` | Attenzione, scadenza, in attesa |
| `--blu` | `#007AFF` | `rgba(0,122,255,.08)` | Info, acconto, in corso |
| `--gold` (alias `--yel`) | `#C8A84E` | `rgba(200,168,78,.08)` | KPI speciali, brand accent |

Tutti i colori semantici seguono il pattern: colore pieno per testo/icone, versione `.08–.10` opacity per background chip/badge.

---

### 1.4 Surface Colors (Dashboard Data-Dense)

| Superficie | Valore | Contesto |
|------------|--------|----------|
| App background | `#F2F2F7` | Sempre visibile dietro tutto |
| Card/panel | `#FFFFFF` | Ogni contenitore principale |
| Table header | `#F9F9FB` | Righe `<th>` |
| Topbar | `rgba(255,255,255,.85)` + blur(20px) | Sticky, glassmorphism leggero |
| Loader overlay | `rgba(255,255,255,.92)` + blur(20px) | Full-screen durante caricamento |
| Modal backdrop | `rgba(0,0,0,.5)` | Overlay dietro dialog |

---

### 1.5 Location Variants — Identità di Sede

Il colore oro `#C8A84E` è **condiviso** tra tutte le sedi (identità brand unica Wash Hub).
L'accent secondario differenzia la sede nell'header/sidebar.

| Sede | Accent Secondario | Hex | Rationale |
|------|-------------------|-----|-----------|
| **Lungomare** (Palermo) | Blu mare Mediterraneo | `#0077B6` | Richiama il lungomare, acqua, cielo palermitano |
| **Paesi Etnei** (Catania) | Grigio lavico / obsidian | `#2D2D2D` | Richiama la lava dell'Etna, pietra lavica, territorio |

**Implementazione:** la sede attiva aggiunge una classe `data-sede="lungomare"` o `data-sede="paesi-etnei"` al `<body>`. L'accent viene usato come colore del sidebar logo, border-top del topbar, e indicatore attivo nel nav.

```css
/* Lungomare */
[data-sede="lungomare"] { --sede-accent: #0077B6; }
/* Paesi Etnei */
[data-sede="paesi-etnei"] { --sede-accent: #2D2D2D; }
```

---

## 2. TYPOGRAPHY

### 2.1 Font Families

| Ruolo | Stack |
|-------|-------|
| **UI principale** | `'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif` |
| **Codici / date** | `'JetBrains Mono', 'SF Mono', monospace` |

Inter è il font primario per tutte le interfacce. Il monospace è riservato a: date picker, ID documento (PREN-xxx, TAP-xxx), numeri in tabella dove l'allineamento colonnas è critico.

---

### 2.2 Type Scale

| Livello | Size | Weight | Line Height | Letter Spacing | Uso |
|---------|------|--------|-------------|----------------|-----|
| **KPI Display** | 42px | 700 | 1.1 | -0.8px | Valore cassa netta principale |
| **KPI Value** | 26px | 700 | 1.2 | -0.8px | Valori KPI standard (desktop) |
| **KPI Value md** | 22px | 700 | 1.2 | -0.5px | KPI tablet |
| **KPI Value sm** | 20px | 700 | 1.2 | -0.5px | KPI mobile |
| **KPI Value xs** | 18px | 700 | 1.2 | 0 | KPI small mobile |
| **h1 Topbar** | 17px | 600 | 1.3 | -0.3px | Titolo pagina nella topbar |
| **h2 Login** | 22px | 700 | 1.3 | -0.3px | Titolo login box |
| **h3 Section** | 15px | 600 | 1.4 | 0 | Titoli di sezione pagina |
| **Body** | 14px | 400 | 1.5 | 0 | Testo generico, sidebar items |
| **Body sm** | 13px | 400 | 1.5 | 0 | Celle tabella, testo form |
| **Body xs** | 12px | 400 | 1.5 | 0 | Note, timestamp aggiornamento |
| **Label** | 10px | 600 | 1.4 | 0.8–1px | Label campi form, header tabella |
| **Label caps** | 10px | 600 | 1.4 | 1.5–2px | KPI label, sezioni sidebar |
| **Caption** | 11px | 400 | 1.5 | 0.5px | Login subtitle, testo accessorio |
| **Badge** | 10px | 600 | 1 | 0.3px | Badge status |
| **Badge mono** | 10px | 600 | 1 | 0 | Badge ID documento (monospace) |

**Regola uppercase:** le label (`<10px`) vanno sempre in `text-transform: uppercase`. Non usare uppercase su testo > 12px.

---

### 2.3 Weight Usage Rules

| Weight | Uso |
|--------|-----|
| 400 (Regular) | Body text, input values, testo secondario |
| 500 (Medium) | Sidebar nav items, bottoni secondari, badge sottotitoli |
| 600 (Semibold) | Label campi, titoli sezione, intestazioni tabella, topbar h2 |
| 700 (Bold) | KPI values, titoli principali, heading login, testo enfatizzato |

---

## 3. SPACING

### 3.1 Base Scale (4px grid)

| Token | Valore | Uso tipico |
|-------|--------|------------|
| `space-1` | 4px | Micro gap (filter chips, icon-label) |
| `space-2` | 8px | Gap piccolo (form field interno, button row) |
| `space-3` | 12px | Gap standard (sidebar nav, form grid) |
| `space-4` | 16px | Padding card mobile, gap KPI grid |
| `space-5` | 20px | Padding card desktop, gap sezioni |
| `space-6` | 24px | Padding form panel, padding topbar v |
| `space-7` | 28px | Padding page content desktop |
| `space-8` | 32px | Margin section break |
| `space-10` | 40px | Empty state padding |

### 3.2 Component Spacing Rules

| Contesto | Valore |
|----------|--------|
| Padding card/panel | `20px` (desktop) / `16px` (tablet) / `14px` (mobile) |
| Padding page content | `28px` (desktop) / `20px 14px` (tablet) / `16px 12px` (430px) / `14px 10px` (380px) |
| Gap griglia KPI | `16px` (desktop) / `10px` (tablet) / `8px` (mobile) |
| Gap form grid | `14px` (desktop) / `10px` (mobile) |
| Gap topbar items | `8px` |
| Margin sotto sezione | `24px` (`margin-bottom: 24px`) |
| Padding bottone primario | `9px 18px` |
| Padding input | `10px 14px` |
| Padding badge | `4px 10px` |
| Padding header tabella | `12px 16px` |
| Padding celle tabella | `12px 16px` |
| Padding sidebar logo | `24px 20px` |
| Padding sidebar nav | `16px 12px` |

---

## 4. LAYOUT

### 4.1 Dashboard Shell (Desktop ≥ 769px)

```
┌─────────────────────────────────────────────────────────────┐
│ TOPBAR  sticky, z-50, backdrop-blur(20px), h≈60px          │
├─────────────┬───────────────────────────────────────────────┤
│             │                                               │
│  SIDEBAR    │  PAGE CONTENT                                 │
│  260px      │  flex: 1, overflow-y: auto                    │
│  fixed      │  padding: 28px                                │
│  z-40       │                                               │
│  flex-col   │  ┌─ KPI GRID ──────────────────────────────┐ │
│             │  │  auto-fit, minmax(200px, 1fr), gap 16px  │ │
│             │  └─────────────────────────────────────────┘ │
│             │                                               │
│             │  ┌─ TABLE / FORM PANEL ───────────────────┐  │
│             │  │  width: 100%                            │  │
│             │  └────────────────────────────────────────┘  │
│             │                                               │
│  sb-footer  │                                               │
│  sticky bot │                                               │
└─────────────┴───────────────────────────────────────────────┘
```

### 4.2 Responsive Breakpoints

| Breakpoint | px | Comportamento chiave |
|------------|----|-----------------------|
| Desktop | ≥ 769px | Layout sidebar + main fisso |
| Tablet / Mobile | ≤ 768px | Sidebar diventa overlay 300px (max 88vw); KPI 2 col; form 2 col; chart 1 col |
| Smartphone | ≤ 430px | Form 1 col; input font 15px (no zoom iOS); padding ridotto |
| Smartphone XS | ≤ 380px | Sidebar 100vw; KPI 1 col; padding minimo |

**Target principale:** desktop (schermo operatori in sede). Mobile = fallback per controllo veloce da smartphone operatore.

### 4.3 Grid Patterns

| Grid | Valore |
|------|--------|
| KPI desktop | `repeat(auto-fit, minmax(200px, 1fr))` |
| KPI mobile | `repeat(2, minmax(0, 1fr))` |
| Form desktop | `repeat(auto-fill, minmax(180px, 1fr))` |
| Chart desktop | `1fr 1fr` |
| Tutto mobile | `1fr` |

### 4.4 Density

Il gestionale è **data-dense**: gli operatori leggono tabelle, compilano form, controllano KPI tutto il giorno. Non è un sito marketing.

- **Preferire** contenuto compatto con padding `12–16px` vs layout arioso da marketing
- **Evitare** whitespace eccessivo tra sezioni
- **Priorità:** leggibilità + velocità di scansione > estetica decorativa
- **Font minimo in tabella:** 13px (leggibile a 40cm schermo)

---

## 5. COMPONENTS

### 5.1 Button

#### Varianti

**Primary Button** (`.btn-primary`)
```html
<button class="btn btn-primary">Salva Prenotazione</button>
```
- Background: `--gold` (`#C8A84E`)
- Testo: `#FFFFFF`, weight 600, size 13px
- Padding: `9px 18px`, border-radius `--r2` (10px)
- Shadow: `0 2px 8px var(--gold-ring)`
- Hover: `#B8963E`, shadow potenziata, `translateY(-1px)`
- Active: `translateY(0)`, `scale(.98)`

**Secondary Button** (`.btn`)
```html
<button class="btn">Annulla</button>
```
- Background: `--bg2` (bianco)
- Border: `1px solid var(--brd2)`
- Testo: `--tx`, weight 500, size 13px
- Padding: `9px 18px`
- Hover: border gold, background `--gold-subtle`

**Query/Filter Pill** (`.qbtn`)
```html
<button class="qbtn on">Oggi</button>
<button class="qbtn">Settimana</button>
<button class="qbtn">Mese</button>
```
- Border-radius: `20px` (pill)
- Padding: `6px 16px`
- Font: 500 12px
- Default: `--bg2` bianco con border
- Attivo (`.on`): background `--gold`, testo bianco

**Action Button** (`.act-btn`)
```html
<button class="act-btn" title="Modifica">✎</button>
<button class="act-btn del" title="Elimina">✕</button>
```
- Size: `32px × 32px` (44px su mobile)
- Border: `1px solid var(--brd2)`
- Border-radius: `8px`
- Default: icona `--tx2`
- Hover: icona `--gold`, border `--gold`, background `--gold-subtle`
- Hover `.del`: icona `--red`, border `--red`, background `rgba(255,59,48,.06)`

#### Anti-uso
- Non usare più di un Primary Button per sezione
- Non usare `.btn-primary` per azioni distruttive (usa rosso inline)
- Non aggiungere icone decorative ai bottoni operativi

---

### 5.2 Card / Panel

**Standard Card / KPI**
```html
<div class="kpi g">
  <div class="kpi-label">Incasso Oggi</div>
  <div class="kpi-val">€ 1.240</div>
  <div class="kpi-sub">12 lavaggi completati</div>
</div>
```
- Background: `--bg2`, border: `1px solid var(--brd)`
- Border-radius: `--r` (14px), shadow: `--shadow-sm`
- Padding: `20px`
- Accent: `4px` border-left colorato per variante semantica
  - `.g` → `--grn`
  - `.r` → `--red`
  - `.a` → `--amb`
  - `.b` → `--blu`
- Hover: `--shadow-md`, `translateY(-2px)`, transizione `all .25s`

**Form Panel** (`.form-panel`)
```html
<div class="form-panel show">
  <div class="form-grid">...</div>
  <div class="form-actions">...</div>
</div>
```
- Background: `--bg2`, border: `1px solid var(--brd)`
- Border-radius: `--r` (14px), shadow: `--shadow-sm`
- Padding: `24px`
- Entry animation: `slideDown .3s ease` (opacity 0→1, translateY -8px→0)
- Nascosto di default, visibile con `.show`

**Chart Card** (`.chart-card`)
- Stesso stile card, padding `20px`
- Contiene canvas Chart.js

---

### 5.3 Modal / Dialog

```html
<div id="modal-pagamento" class="modal">
  <div class="modal-box">
    <div class="modal-header">
      <h3>Registra Pagamento</h3>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <!-- content -->
    </div>
    <div class="modal-footer">
      <button class="btn">Annulla</button>
      <button class="btn btn-primary">Conferma</button>
    </div>
  </div>
</div>
```

- Overlay: `rgba(0,0,0,.5)`, z-index: 100
- Box: `--bg2`, border-radius: `--r` (14px o 20px), shadow: `0 12px 40px rgba(0,0,0,.5)`
- Max-width: `480–600px` (dipende dal contenuto)
- Entry: `fadeIn .3s ease`
- Footer: `flex`, `gap: 10px`, `justify-content: flex-end`

**Regola:** il modal deve sempre avere un'azione primaria chiara e un'uscita visibile (X + Annulla).

---

### 5.4 Input / Form Field

```html
<div class="ff">
  <label>Targa</label>
  <input type="text" placeholder="AA000BB">
  <div class="form-msg"></div>
</div>
```

- Label: 600 10px uppercase, `--tx3`, letter-spacing 0.8px, margin-bottom 6px
- Input: `--bg`, border `1.5px solid var(--brd2)`, border-radius `--r2` (10px)
- Padding: `10px 14px`, font 14px `--tx`
- Focus: border `--gold`, shadow `0 0 0 3px var(--gold-ring)`
- Mobile: font-size 16px (previene zoom iOS)
- Transizione: `all .25s`

**Select:** stesso styling input
**Textarea:** stesso styling, `resize: vertical`
**Date Input:** monospace font, padding `7px 12px`

**Search Box** (`.search-box`)
- Border-radius: `20px` (pill)
- Width: `220px`, focus → `260px`
- Padding: `8px 16px`

---

### 5.5 Badge

```html
<span class="badge g">Pagato</span>
<span class="badge r">Sospeso</span>
<span class="badge a">In Attesa</span>
<span class="badge b">Acconto</span>
```

- Padding: `4px 10px`, border-radius: `10px`
- Font: 600 10px, letter-spacing 0.3px
- Varianti:
  - `.g`: background `rgba(52,199,89,.10)`, testo `--grn`
  - `.r`: background `rgba(255,59,48,.08)`, testo `--red`
  - `.a`: background `rgba(255,149,0,.10)`, testo `--amb`
  - `.b`: background `rgba(0,122,255,.08)`, testo `--blu`

**Badge mono** (`.badge-sm`, per ID documento in sidebar nav):
- Padding: `3px 8px`, border-radius: `12px`, font monospace 10px 600

---

### 5.6 Table

```html
<div class="tbl-wrap">
  <table class="tbl">
    <thead>
      <tr>
        <th>Data</th>
        <th>Cliente</th>
        <th>Importo</th>
        <th>Stato</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>17/05/2026</td>
        <td>Mario Rossi</td>
        <td>€ 45,00</td>
        <td><span class="badge g">Pagato</span></td>
      </tr>
    </tbody>
  </table>
</div>
```

- Wrapper: `--bg2`, border `1px solid var(--brd)`, border-radius `--r`, shadow `--shadow-sm`, overflow-x auto
- `<th>`: background `--bg4`, padding `12px 16px`, 600 10px uppercase, `--tx3`, letter-spacing 1px
- `<td>`: padding `12px 16px`, border-bottom `1px solid var(--brd)`, 400 13px `--tx`
- Row hover: `background var(--gold-hover)`, transizione `0.15s`
- White-space: nowrap (scroll orizzontale su mobile)

---

### 5.7 KPI Card

Vedi §5.2 per anatomia completa. Varianti accent:

```html
<div class="kpi g">...</div>   <!-- verde — entrate, successo -->
<div class="kpi r">...</div>   <!-- rosso — uscite, problemi -->
<div class="kpi a">...</div>   <!-- ambra — avvisi, scadenze -->
<div class="kpi b">...</div>   <!-- blu — informazioni, acconto -->
```

Grid: `repeat(auto-fit, minmax(200px, 1fr))` → adatta il numero di colonne automaticamente.

---

### 5.8 Sidebar

```html
<nav class="sidebar" id="sidebar">
  <div class="sb-logo">
    <div class="sb-icon">W</div>
    <div>
      <h1>WASH HUB</h1>
      <span>Lungomare</span>
    </div>
  </div>
  <div class="sb-nav">
    <div class="sb-section">OPERATIVO</div>
    <a class="sb-item on" data-page="prenotazioni">
      <span class="icon">📋</span> Prenotazioni
    </a>
    <!-- altri items -->
  </div>
  <div class="sb-footer">
    <div class="sb-user">...</div>
    <button class="sb-logout">Esci</button>
  </div>
</nav>
```

- Width: `260px` fixed (desktop)
- Background: `--bg2`, border-right `1px solid var(--brd)`
- `.sb-section`: 600 9px uppercase, `--tx3`, letter-spacing 2px
- `.sb-item`: padding `10px 12px`, border-radius `--r2` (10px), transizione `all .2s`
- `.sb-item.on`: background `--gold-subtle`, testo `--gold`, font 600
- Mobile: overlay slide-in da sinistra, `translateX(-100%)` → `translateX(0)`, transizione `cubic-bezier(.32,.72,0,1) .35s`

---

### 5.9 Topbar

```html
<header class="topbar">
  <div class="topbar-l">
    <button class="mob-toggle">☰</button>
    <span class="page-icon">📋</span>
    <h2>Prenotazioni</h2>
    <span class="dot-live"></span>
  </div>
  <div class="topbar-r">
    <span class="update-time">agg. 14:32</span>
    <button class="btn-refresh">↻</button>
  </div>
</header>
```

- Background: `rgba(255,255,255,.85)`, backdrop-filter `blur(20px)`
- Border-bottom: `1px solid var(--brd)`
- Position: sticky, top 0, z-index 50
- Padding: `16px 28px` (desktop), `12px 14px` (mobile)
- `.dot-live`: 8px circle, `--grn`, animazione `pulse 2s infinite`

---

### 5.10 Loading State

```html
<div class="loader" id="loader">
  <div class="spinner"></div>
  <p>Caricamento...</p>
</div>
```

- Full-screen overlay, z-index 999
- Background `rgba(255,255,255,.92)`, blur(20px)
- Spinner: 36px, border 3px `--brd2`, top `--gold`, `spin .7s linear infinite`
- Testo: 500 12px `--tx3`, letter-spacing 0.5px
- Rimozione: classe `.out` → opacity 0, pointer-events none, transizione `opacity .4s`

---

### 5.11 Empty State

```html
<div class="empty">
  Nessuna prenotazione trovata per i filtri selezionati.
</div>
```

- Padding: `40px`, text-align center
- Font: 400 14px `--tx3`

---

### 5.12 Tab / Filtri Rapidi

```html
<div class="pbar">
  <div class="filters">
    <button class="qbtn on">Tutti</button>
    <button class="qbtn">Pagati</button>
    <button class="qbtn">Sospesi</button>
    <button class="qbtn">In Attesa</button>
  </div>
  <div style="margin-left:auto">
    <button class="btn btn-primary">+ Nuova Prenotazione</button>
  </div>
</div>
```

Toolbar (`.pbar`): flex, gap 8px, flex-wrap, margin-bottom 20px.
I `.qbtn` funzionano come tab: uno solo `.on` attivo alla volta.

---

## 6. MOTION

### 6.1 Durate

| Nome | Durata | Uso |
|------|--------|-----|
| Fast | 150ms | Hover su righe tabella, background toggle |
| Normal | 200–250ms | Bottoni, input focus, sidebar items, form panel entry |
| Slow | 350–400ms | Sidebar mobile slide, loader fade-out |
| Extra slow | 500ms | Login screen overlay, page fade |

### 6.2 Easing

| Easing | Contesto |
|--------|----------|
| `ease` | Default per `transition: all` |
| `linear` | Spinner rotation |
| `cubic-bezier(.32,.72,0,1)` | Sidebar mobile slide-in (feel nativo iOS) |

### 6.3 Keyframes

```css
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
/* Uso: .page.show { animation: fadeIn .3s ease; } */

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* Uso: .form-panel.show { animation: slideDown .3s ease; } */

@keyframes spin {
  to { transform: rotate(360deg); }
}
/* Uso: .spinner { animation: spin .7s linear infinite; } */

@keyframes pulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(52,199,89,.4); }
  50%      { box-shadow: 0 0 0 6px transparent; }
}
/* Uso: .dot-live { animation: pulse 2s infinite; } */
```

### 6.4 Regole

- **Animare solo feedback utente:** hover, focus, apertura panel, loading
- **Non animare** contenuto dati (numeri, righe tabella al caricamento)
- **Non usare** animazioni di celebrazione (confetti, bounce)
- **Transizioni veloci** per interazioni operative (150–250ms): l'operatore usa il gestionale 8 ore/giorno, ogni ritardo si accumula
- **Solo `translateY` leggero** (max -8px) per lift effects, no traslazioni elaborate

---

## 7. VOICE & TONE

### 7.1 Lingua e Registro

- **Lingua:** italiano
- **Registro:** professionale ma diretto — come un collega di lavoro, non un chatbot
- **Tono:** assertivo, informativo, senza condescendenza
- **Evitare:** emoji nei label operativi, esclamazioni, frasi generiche ("Benvenuto!")

### 7.2 Terminologia Ufficiale

| Termine | Descrizione | NON usare |
|---------|-------------|-----------|
| Prenotazione | Lavaggio auto (PREN-xxx) | "Appuntamento", "Ordine" |
| Tappezzeria | Servizio tappezzeria (TAP-xxx) | "Interno" |
| Sospeso | Pagamento non ancora incassato | "Debito", "Non pagato" |
| Prima Nota | Report contabile | "Cassa", "Registro" |
| Abbonamento | Parcheggio mensile/annuale | "Tessera", "Contratto" |
| Giornaliero | Singolo ingresso parcheggio | "Ticket", "Soste" |
| Filiale / Sede | Lungomare o Paesi Etnei | "Branch", "Punto vendita" |
| Operatore | Staff che usa il gestionale | "Utente", "Admin" |

### 7.3 Microcopy

**CTA principali:**
- Salva → `Salva Prenotazione` / `Salva Rinnovo`
- Nuovo → `+ Nuova Prenotazione` / `+ Aggiungi Abbonamento`
- Conferma pagamento → `Registra Pagamento`
- Elimina → `Elimina` (senza "Sei sicuro?" — usa invece dialog di conferma)

**Conferme:**
- Successo: `Prenotazione salvata.` (non "Operazione completata con successo!")
- Elimina: `Eliminato.`
- Pagamento: `Pagamento registrato.`

**Errori:**
- Campo mancante: `Inserisci [nome campo].`
- Telefono: `Numero di telefono obbligatorio.`
- Generico: `Errore durante il salvataggio. Riprova.`

**Empty state:**
- Tabella vuota: `Nessuna prenotazione per il periodo selezionato.`
- Ricerca vuota: `Nessun risultato per "[termine]".`
- Prima volta: `Nessuna prenotazione ancora. Inizia con + Nuova Prenotazione.`

---

## 8. BRAND

### 8.1 Identità

**Wash Hub** è un centro autolavaggio premium a Palermo. Il gestionale riflette questa identità: **professionale, ordinato, affidabile** — non generico.

- **Colore brand:** oro `#C8A84E` — segnale di qualità, premium, ma non ostentato
- **Design language:** Apple-style — bianco dominante, tipografia pulita, ombre sottilissime
- **Ispirazione:** retail luxury piegato a tool operativo — bello da vedere, veloce da usare

### 8.2 Personality

| Attributo | Descrizione |
|-----------|-------------|
| **Affidabile** | I dati sono corretti, le azioni funzionano, niente sorprese |
| **Ordinato** | Ogni cosa ha il suo posto, la gerarchia visiva è chiara |
| **Diretto** | L'operatore trova subito quello che cerca senza navigare |
| **Sobrio** | No decorazioni inutili, no animazioni distraenti |

### 8.3 Target Reale

- **Sebastiano** — operatore quotidiano: gestisce prenotazioni, incassi, problemi. Usa il gestionale 6–8 ore al giorno dallo schermo della cassa. Ha bisogno di velocità e chiarezza, non bellezza.
- **Michela** — commercialista: guarda i report mensili, esporta dati. Ha bisogno di leggibilità e precisione numerica.

**Implicazioni design:** priorità alla densità informativa e alla velocità di interazione. Non ai margini generosi o ai layout da portfolio.

---

## 9. ANTI-PATTERNS

### Non fare mai

| Anti-pattern | Motivazione |
|--------------|-------------|
| Gradient fluffy / glassmorphism pesante | Distrae, non è un'app consumer |
| Emoji in label operativi (badge, intestazioni tabella, KPI) | Non professionale, difficile da scansionare |
| Animazioni di celebrazione (confetti, bounce, pop) | Siamo un gestionale, non un gioco |
| Densità Material Design (padding 24px+ ovunque) | Spreca spazio su schermo da cassa |
| Dark mode forzata | La sede ha luce naturale, lo schermo è in ambiente luminoso |
| Border-radius > 20px su container grandi | Sembra mobile app, non dashboard |
| Colori vivaci non nel palette (viola, rosa, ciano) | Rompono la coerenza Apple-style |
| Testo < 11px in tabelle | Illeggibile a distanza d'uso |
| Modal > 600px su desktop | Troppo invasivo per operazioni frequenti |
| Più di 1 bottone primary per sezione | Crea ambiguità sull'azione principale |
| Lorem ipsum o placeholder generici in UI | Usa sempre termini del dominio reale |
| Breadcrumb in una sidebar con nav diretta | Ridondante |
| Skeleton loader per tabelle < 500ms | Il loader globale è sufficiente |
