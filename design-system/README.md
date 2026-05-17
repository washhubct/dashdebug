# design-system/

Design system di Wash Hub Gestionale. Contiene token e documentazione componenti.

## Struttura

```
design-system/
├── tokens.json          ← Token in formato Style Dictionary-compatible
├── README.md            ← Questo file
└── components/
    ├── button.md        ← Button: primary, secondary, pill, action
    ├── card.md          ← Card KPI, Form Panel, Chart Card
    ├── modal.md         ← Dialog / Modal
    ├── input.md         ← Input, Select, Textarea, Search
    ├── table.md         ← Table, row, header, empty state
    └── badge.md         ← Badge status, badge mono
```

## Come usare i token

### Style Dictionary (raccomandato)

```js
// style-dictionary.config.js
module.exports = {
  source: ['design-system/tokens.json'],
  platforms: {
    css: {
      transformGroup: 'css',
      prefix: 'wh',
      buildPath: 'css/',
      files: [{ destination: 'tokens.css', format: 'css/variables' }]
    }
  }
}
```

Esegui `npx style-dictionary build` per generare `css/tokens.css` con tutte le CSS custom properties.

### Uso diretto (senza build step)

I token sono già applicati come CSS custom properties nel codice esistente. Le variabili CSS sono definite in `:root` nel file CSS principale:

```css
:root {
  --gold:       #C8A84E;
  --bg:         #F2F2F7;
  --bg2:        #FFFFFF;
  --tx:         #1C1C1E;
  --grn:        #34C759;
  --red:        #FF3B30;
  --shadow-sm:  0 1px 2px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.03);
  /* ... */
}
```

Usa sempre le CSS variables nel codice, mai valori hardcoded.

## Struttura token

### color
- `color.brand.*` — scala oro (50–900)
- `color.neutral.*` — bg, text, border
- `color.semantic.*` — success, danger, warning, info
- `color.alpha.*` — versioni trasparenti del gold
- `color.surface.*` — topbar, loader, modal overlay
- `color.location.*` — accent per sede (lungomare, paesi-etnei)

### typography
- `typography.fontFamily.*` — ui (Inter), mono (JetBrains)
- `typography.fontSize.*` — scala completa
- `typography.fontWeight.*` — regular/medium/semibold/bold
- `typography.lineHeight.*` — tight/normal
- `typography.letterSpacing.*` — scala da -0.8px a 3px

### spacing
- `spacing.1` (4px) → `spacing.10` (40px) — griglia base 4px

### borderRadius
- `sm` 6px → `xl` 20px → `full` pill → `circle` 50%

### shadow
- `sm/md/lg/xl` — elevation system
- `modal` — dialog shadow
- `button-gold*` — shadow bottone primario
- `focus-gold` — focus ring input

### motion
- `motion.duration.*` — fast/normal/slow/extra-slow
- `motion.easing.*` — default/linear/ios-slide

### layout
- Z-index scale, sidebar width, breakpoints, blur values

## Aggiornare i token

1. Modifica `tokens.json`
2. Aggiorna le CSS variables corrispondenti nel CSS principale
3. Aggiorna i file `.md` dei componenti interessati
4. Aggiorna `DESIGN.md` se la modifica è sistemica
