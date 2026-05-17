# Card

## Varianti

### KPI Card (`.kpi`)

Mostra un indicatore chiave di prestazione. Usata nella griglia in cima ad ogni sezione.

```html
<!-- KPI con accent verde (entrate, successo) -->
<div class="kpi g">
  <div class="kpi-label">Incasso Oggi</div>
  <div class="kpi-val">€ 1.240</div>
  <div class="kpi-sub">12 lavaggi completati</div>
</div>

<!-- KPI con accent rosso (uscite, problemi) -->
<div class="kpi r">
  <div class="kpi-label">Sospesi</div>
  <div class="kpi-val">€ 380</div>
  <div class="kpi-sub">3 prenotazioni</div>
</div>

<!-- KPI ambra (avvisi, scadenze) -->
<div class="kpi a">
  <div class="kpi-label">Abbonamenti in Scadenza</div>
  <div class="kpi-val">5</div>
  <div class="kpi-sub">entro 7 giorni</div>
</div>

<!-- KPI blu (info, acconti) -->
<div class="kpi b">
  <div class="kpi-label">Acconti</div>
  <div class="kpi-val">€ 120</div>
  <div class="kpi-sub">2 prenotazioni</div>
</div>
```

#### Anatomy

| Elemento | Classe | Stile |
|----------|--------|-------|
| Container | `.kpi` | bg white, border, radius 14px, padding 20px, shadow-sm |
| Accent bar | `border-left: 4px solid` | colore per variante |
| Label | `.kpi-label` | 600, 10px, uppercase, --tx3, letter-spacing 1.5px |
| Valore | `.kpi-val` | 700, 26px, letter-spacing -0.8px |
| Nota | `.kpi-sub` | 400, 12px, --tx2 |

#### Varianti accent

| Classe | Colore | Uso |
|--------|--------|-----|
| `.g` | `--grn` (#34C759) | Entrate, positivo, attivo |
| `.r` | `--red` (#FF3B30) | Uscite, sospesi, problemi |
| `.a` | `--amb` (#FF9500) | Scadenze, attenzione |
| `.b` | `--blu` (#007AFF) | Info, acconti, neutro |

#### Grid

```html
<div class="kpis">
  <div class="kpi g">...</div>
  <div class="kpi r">...</div>
  <div class="kpi a">...</div>
</div>
```

Grid: `repeat(auto-fit, minmax(200px, 1fr))`, gap 16px.

---

### Form Panel (`.form-panel`)

Pannello form che appare/sparisce contestualmente. Nascosto di default.

```html
<div class="form-panel" id="panelNuovaPrenotazione">
  <div class="form-title">Nuova Prenotazione</div>
  <div class="form-grid">
    <div class="ff">
      <label>Cliente</label>
      <input type="text" placeholder="Nome cognome">
    </div>
    <div class="ff">
      <label>Targa</label>
      <input type="text" placeholder="AA000BB">
    </div>
    <!-- altri campi -->
  </div>
  <div class="form-actions">
    <button class="btn btn-primary">Salva</button>
    <button class="btn" onclick="chiudiPanel()">Annulla</button>
  </div>
</div>
```

| Proprietà | Valore |
|-----------|--------|
| Default | `display: none` |
| Visibile | classe `.show` → `display: block` |
| Entry animation | `slideDown .3s ease` (opacity 0→1, translateY -8px→0) |
| Background | white, border, radius 14px, shadow-sm |
| Padding | `24px` |

---

### Chart Card (`.chart-card`)

Container per grafici Chart.js.

```html
<div class="chart-card">
  <div class="chart-title">Incassi — Ultimi 30 giorni</div>
  <canvas id="chartIncassi"></canvas>
</div>
```

Stesso stile del form panel (bg white, border, radius 14px, shadow-sm, padding 20px).

Grid: `.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }` → 1 colonna su mobile.

---

## Regole d'uso

- Ogni sezione inizia sempre con la griglia KPI
- Usare l'accent color corretto per il tipo di dato (mai verde per uscite)
- Il `.kpi-sub` è facoltativo ma aggiunge contesto utile
- I form panel si chiudono quando si apre un altro (uno alla volta)
- Non annidare card dentro card

## Anti-uso

- Non usare KPI per dati testuali (usa tabella)
- Non mettere più di 2 righe nel `.kpi-sub`
- Non usare chart card senza titolo
