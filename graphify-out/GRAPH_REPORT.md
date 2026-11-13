# Graph Report - dashdebug  (2026-11-13)

## Corpus Check
- 101 files · ~116,338 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 11 file(s) not represented in the graph (top: (none) 4, .service 2, .plist 2)

## Summary
- 1293 nodes · 3228 edges · 72 communities (61 shown, 11 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 84 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9a0a2b33`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- fEur
- fEur
- prenota-online.ts
- Meteo Semaforo Function
- sospesi.js
- Script Archivio e Analisi
- Bridge Cassa VNE Flask
- Parcheggio Smart Function
- CRM Dedup Script
- Presenze e Paghe
- report.js
- parcheggio-smart.js
- Dipendenze Functions
- Cancello Sync e Chiamate
- esc
- setup-cassa-config.js
- main.js
- ref_firebase_admin
- Worker WhatsApp Web
- firebase-config.js
- Fatture in Cloud Function
- Bridge FidelAI Function
- Prenota Pubblico JS
- Tastierini Hikvision Orari
- Design Badge e Tabelle
- WhatsApp Cloud API (spenta)
- Voucher
- Palette e Sedi Design
- prenotazioni.js
- Brand e Form Design
- TS Config Functions
- Shell Index HTML
- fidelity-programma.js
- Dipendenze Worker WA
- Backfill Meteo Storico
- Cancello Client Firestore
- Install Bridge Pi/Windows
- Design Pattern e Modali
- Design Card e Pannelli
- Conti Clienti Function
- Design Bottoni e Filtri
- Migrazione Multisede Docs
- FidelAI Admin Riscatti
- renderCassa
- servizi-aggiuntivi.js
- Manifest PWA
- Backup Pre Multisede
- Cancello Docs
- Mock VNE Test
- chiamate.js
- Backfill sedeId
- Chiamate Client Firestore
- Protocollo VNE Note
- Bridge Run Entry
- Analisi Sospesi Script
- Chiamate Monitor Core
- Display Cassa Cliente
- reset-pagamenti-20261022.mjs
- meteo.js
- cassa-stato.js
- Microcopy e Tono
- Design Tokens
- Runbook WhatsApp
- Dipendenze Root
- Bridge CORS
- Smoke Test Bridge
- Telegram Chat ID
- Bridge Errori 404
- Init TLS Bridge
- giornalieri.js
- Firestore config/cassaAutomatica (bridgeUrl, bridgeToken, enabled)
- chiusura.ts

## God Nodes (most connected - your core abstractions)
1. `esc()` - 83 edges
2. `fEur()` - 60 edges
3. `fmtDI()` - 50 edges
4. `pNum()` - 49 edges
5. `renderCassa()` - 36 edges
6. `state` - 28 edges
7. `db` - 27 edges
8. `Wash Hub Gestionale Design System` - 26 edges
9. `pDate()` - 21 edges
10. `renderPren()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Table empty state` --semantically_similar_to--> `Empty state (.empty)`  [INFERRED] [semantically similar]
  design-system/components/table.md → DESIGN.md
- `occupato() guard (cassaAutoBox / modal / input)` --conceptually_related_to--> `Python Flask cash bridge (port 8765)`  [INFERRED]
  index.html → bridge-cassa/README.md
- `Prenotazioni + Tappezzeria page` --conceptually_related_to--> `Cloud Functions whatsappWebhook / whatsappSend / whatsappSendBulk`  [AMBIGUOUS]
  index.html → docs/WHATSAPP_RUNBOOK.md
- `KPI Card (.kpi)` --semantically_similar_to--> `KPI Card (.kpi with accent variants)`  [INFERRED] [semantically similar]
  design-system/components/card.md → DESIGN.md
- `Toolbar sopra tabella (.pbar)` --semantically_similar_to--> `Tab / Filtri rapidi toolbar (.pbar)`  [INFERRED] [semantically similar]
  design-system/components/table.md → DESIGN.md

## Import Cycles
- 2-file cycle: `js/moduli/cassa.js -> js/moduli/incassi-manuali.js -> js/moduli/cassa.js`

## Hyperedges (group relationships)
- **Cassa VNE integration stack** — readme_cassa_automatica_vne, readme_bridge_python, readme_raspberry_pi_zero_w, readme_cassa_automatica_module, readme_cassa_stato_widget, readme_config_cassa_automatica, scripts_setup_cassa_config [EXTRACTED 1.00]
- **Design system component documentation set** — design_system_components_button_component_doc, design_system_components_card_component_doc, design_system_components_modal_component_doc, design_system_components_input_component_doc, design_system_components_table_component_doc, design_system_components_badge_component_doc [EXTRACTED 1.00]
- **Parcheggio Smart PIN sync flow** — index_page_parchsmart, bridge_cassa_cancello_readme_codiciparcheggio, bridge_cassa_cancello_readme_cancello_sync_service, bridge_cassa_cancello_readme_hikvision_terminals, bridge_cassa_cancello_readme_cancellostato [INFERRED 0.85]
- **Post-payment customer display + FidelAI card** — index_page_cassa, display_cassadisplay_collection, display_ascolta, display_mostra, display_fidelai_customers [INFERRED 0.85]
- **VNE automatic cash payment flow (gestionale → bridge → VNE)** — index_page_cassa, bridge_cassa_install_linux_config_cassaautomatica, bridge_cassa_readme_flask_bridge, bridge_cassa_readme_bridge_endpoints, bridge_cassa_protocollo_vne_notes_vne_selfcash_api [INFERRED 0.85]
- **White-label rebranding flow** — design_template_brand_placeholders, design_template_primary_color_tokens, design_template_gold_to_primary_replacement, design_template_sidebar_logo_branding, design_template_new_client_setup_checklist [INFERRED 0.85]

## Communities (72 total, 11 thin omitted)

### Community 0 - "fEur"
Cohesion: 0.11
Nodes (51): aggiornaBtnIncasso(), calcScad(), deleteAbb(), disdiciAbb(), editAbb(), fatturaFICAbb(), hideAbbF(), incassoOraSelezionato() (+43 more)

### Community 1 - "fEur"
Cohesion: 0.17
Nodes (30): magazzinoCall(), acquisti, b64(), badgeVar(), call(), carica(), comprimi(), confermaZeri() (+22 more)

### Community 2 - "prenota-online.ts"
Cohesion: 0.07
Nodes (57): ALLOWED_ORIGINS, cors(), finalizza(), form(), garanziaAddebita, getConfigGaranzia(), prenotaGaranzia, SLOTS (+49 more)

### Community 3 - "Meteo Semaforo Function"
Cohesion: 0.09
Nodes (43): bloccoSede(), Cfg, CFG_DEFAULT, Cielo, CIELO, cielo(), cieloCat(), Consiglio (+35 more)

### Community 4 - "sospesi.js"
Cohesion: 0.15
Nodes (42): ficCall(), _mostraModalMetodo(), richiediPagamento(), mostraEsitoFattura(), segnaPagataFIC(), arricchisciServizio(), buildSospesiArray(), chiediNumeroFattura() (+34 more)

### Community 5 - "Script Archivio e Analisi"
Cohesion: 0.07
Nodes (28): auto, dir, GG, rows, archivia(), args, caricaGiorno(), csv() (+20 more)

### Community 6 - "Bridge Cassa VNE Flask"
Cohesion: 0.14
Nodes (19): annulla(), annulla_aperta(), annulla_con_retry(), aperta(), aperta_get(), aperta_set(), chiusura(), handle_preflight() (+11 more)

### Community 7 - "Parcheggio Smart Function"
Cohesion: 0.11
Nodes (33): ALLOWED_ORIGINS, cors(), emettiScontrino(), epochToRomeLocal(), finalizza(), fmtIt(), generaCodice(), getConfig() (+25 more)

### Community 8 - "CRM Dedup Script"
Cohesion: 0.08
Nodes (31): APPLY, bk, byKey, byTel, byTok, clienti, daUnire, db (+23 more)

### Community 9 - "Presenze e Paghe"
Cohesion: 0.13
Nodes (30): accontiLocali, applicaCreditoAutomatico(), applicaPagamento(), caricaPresenze(), COSTI_FISSI, DIPENDENTI_FISSI, DIPENDENTI_PER_SEDE, eliminaPresenza() (+22 more)

### Community 10 - "report.js"
Cohesion: 0.16
Nodes (27): initDashDates(), loadHistoricalData(), needsHistorical(), onDateChg(), qp(), isDipendenteBonifico(), calcolaDatiOperativi(), costiFissiCfg() (+19 more)

### Community 11 - "parcheggio-smart.js"
Cohesion: 0.18
Nodes (27): aggiornaPreview(), apriWhatsApp(), caricaCodici(), caricaConfig(), caricaStatoCancello(), codici, config, fmtIt() (+19 more)

### Community 12 - "Dipendenze Functions"
Cohesion: 0.07
Nodes (46): dependencies, @anthropic-ai/sdk@^1.6.0, firebase-admin@^12.0.0, firebase-functions@^6.0.0, nodemailer@^6.10.1, twilio@^5.0.0, zod@^4.6.7, devDependencies (+38 more)

### Community 13 - "Cancello Sync e Chiamate"
Cohesion: 0.17
Nodes (7): carica_stato(), ciclo(), local_iso(), main(), now_ms(), nuovo_employee_no(), salva_stato()

### Community 14 - "esc"
Cohesion: 0.08
Nodes (60): apriAvviso(), render(), giornoLabel(), primoNome(), apriCampagna(), ascoltaCoda(), render(), ascoltaConfig() (+52 more)

### Community 15 - "setup-cassa-config.js"
Cohesion: 0.12
Nodes (21): Bridge Python su Raspberry Pi Zero W (bridge-cassa/), Flag operativo CASSA AUTO (enabled), js/moduli/cassa-automatica.js (modale + polling), Cassa Automatica VNE (SelfCashAPI 3.05), js/moduli/cassa-stato.js widget stato VNE, Modalita alternativa HTTP loopback + Cloudflare Tunnel, Firestore config/cassaAutomatica, Firebase project dashboard-washhub (+13 more)

### Community 16 - "main.js"
Cohesion: 0.15
Nodes (15): getCutoffISO(), initFirebaseData(), initSelezioneSedeUI(), loadPrenotazioniFast(), loadPrimaNotaFast(), caricaClienti(), initMarketing(), renderMarketing() (+7 more)

### Community 17 - "ref_firebase_admin"
Cohesion: 0.15
Nodes (14): db, smsReminder, TWILIO_FROM, TWILIO_SID, TWILIO_TOKEN, Previsione, chunk(), emettiVoucherReferral() (+6 more)

### Community 18 - "Worker WhatsApp Web"
Cohesion: 0.16
Nodes (18): cfgRef, CHIUSURE, client, db, DEFAULT_LIMITI, DIR, giorno, inviaUno() (+10 more)

### Community 19 - "firebase-config.js"
Cohesion: 0.18
Nodes (13): app, db, firebaseConfig, functions, GIORNI, initAvvisoMaltempo(), initCassaAutomatica(), VNE_MESS_MAP (+5 more)

### Community 20 - "Fatture in Cloud Function"
Cohesion: 0.12
Nodes (29): entityDoc(), erroreFicLeggibile(), exchangeToken(), fic(), ficApi, ficOauthCallback, getAccessToken(), getVat22() (+21 more)

### Community 21 - "Bridge FidelAI Function"
Cohesion: 0.18
Nodes (17): AnyDoc, baseOpts, callFidelai(), FIDELAI_API_BASE, FIDELAI_BRIDGE_SECRET, FIDELAI_MERCHANT, fidelaiPrenotazioneCreated, fidelaiPrenotazioneUpdated (+9 more)

### Community 22 - "Prenota Pubblico JS"
Cohesion: 0.11
Nodes (14): chiusureFirestore, dateInput, dateSection, datiSection, form, GIORNI_CHIUSI, selectedSlotInput, servizioInput (+6 more)

### Community 24 - "Design Badge e Tabelle"
Cohesion: 0.15
Nodes (15): Badge component, Empty state (.empty), Semantic status colors (--grn/--red/--amb/--blu), Badge Mono (.badge-sm), Badge component doc, Standard Badge (.badge g/r/a/b), Action button (.act-btn, title for a11y), Table component doc (+7 more)

### Community 25 - "WhatsApp Cloud API (spenta)"
Cohesion: 0.20
Nodes (14): BulkArgs, BulkDest, META_APP_SECRET, META_PHONE_NUMBER_ID, META_WEBHOOK_VERIFY_TOKEN, META_WHATSAPP_TOKEN, normalizePhone(), resolveCustomerName() (+6 more)

### Community 26 - "Voucher"
Cohesion: 0.24
Nodes (14): aggiornaScadutiClient(), codiceLibero(), creaVoucherReferral(), generaCodiceVoucher(), initVouchers(), randomChunk(), renderVouchers(), renderVouchersKpi() (+6 more)

### Community 27 - "Palette e Sedi Design"
Cohesion: 0.19
Nodes (14): Oro Wash Hub (--gold #C8A84E), Scala estesa oro 50-900, Location variants (data-sede accent), Sede Lungomare (#0077B6 blu mare), Sede Paesi Etnei (#2D2D2D grigio lavico), Sidebar component, CSS custom properties in :root, Brand placeholders ({{BRAND_NAME}}, {{PRIMARY_COLOR}}, {{SEDE_NOME}}...) (+6 more)

### Community 28 - "prenotazioni.js"
Cohesion: 0.08
Nodes (60): garanziaAddebitaCall(), annullaPagamento(), avviaPagamento(), bridge(), mapVneError(), openCassaModal(), rimborso(), sleep() (+52 more)

### Community 29 - "Brand e Form Design"
Cohesion: 0.17
Nodes (11): Brand identity Wash Hub (Apple-style, premium), Brand personality (Affidabile, Ordinato, Diretto, Sobrio), Dashboard shell layout (sidebar 260px + topbar + main), Input / Form Field component (.ff), Responsive breakpoints (769/768/430/380), Input component doc, Form field (.ff label/input/.form-msg), Input variants (text, select, textarea, date, search box) (+3 more)

### Community 30 - "TS Config Functions"
Cohesion: 0.17
Nodes (11): compileOnSave, compilerOptions, esModuleInterop, module, noImplicitReturns, noUnusedLocals, outDir, sourceMap (+3 more)

### Community 31 - "Shell Index HTML"
Cohesion: 0.18
Nodes (12): APP_VERSION auto-reload + version.json polling, index.html Gestionale SPA shell, occupato() guard (cassaAutoBox / modal / input), Abbonamenti page (+ conti a canone), Admin pages (Dashboard, Report, Cancellazioni, Servizi), Clienti / CRM page, Marketing pages (SMS Reminder, Porta un Amico, Voucher), Prenotazioni + Tappezzeria page (+4 more)

### Community 32 - "fidelity-programma.js"
Cohesion: 0.15
Nodes (20): auth, ADMIN_EMAILS, initAuth(), isAdmin(), messaggioErroreLogin(), requireAdmin(), tabFlag, anteprima() (+12 more)

### Community 33 - "Dipendenze Worker WA"
Cohesion: 0.20
Nodes (11): qrcode, whatsapp-web.js, dependencies, qrcode@^1.5.4, whatsapp-web.js@^1.26.0, description, name, private (+3 more)

### Community 34 - "Backfill Meteo Storico"
Cohesion: 0.17
Nodes (6): auto, cfg, db, esistenti, pn, pres

### Community 36 - "Install Bridge Pi/Windows"
Cohesion: 0.25
Nodes (11): Install bridge on Raspberry Pi Zero W (LAN-only), Raspberry Pi Zero W washhub-cassa.local, Self-signed TLS via init-tls.sh (SAN LAN IP), washhub-cassa-bridge systemd service, Cloudflare Tunnel cassa.washhub.it (CNAME on GoDaddy), Install bridge on Windows PC (fallback), NSSM WashHubCassaBridge Windows service, Bridge cassa VNE README (+3 more)

### Community 37 - "Design Pattern e Modali"
Cohesion: 0.24
Nodes (9): Wash Hub Gestionale Design System, Keyframes fadeIn/slideDown/spin/pulse, Loading state (global loader + spinner), Modal / Dialog component, Motion system (durations, easing, keyframes), Neutral tokens (--bg, --tx, --brd), Spacing 4px grid, Surface colors (topbar blur, loader, modal backdrop) (+1 more)

### Community 38 - "Design Card e Pannelli"
Cohesion: 0.20
Nodes (11): Card / Panel component, KPI Card (.kpi with accent variants), Chart Card (.chart-card, Chart.js), Card component doc, Form Panel (.form-panel, slideDown), KPI Card (.kpi), Form grid (.form-grid auto-fill 180px), apriModal / chiudiModal (+3 more)

### Community 39 - "Conti Clienti Function"
Cohesion: 0.36
Nodes (10): addebitaConto(), contiAddebitoMensile, contiLetturaShelly, db, isoDay(), itaDay(), letturaShelly(), MESI (+2 more)

### Community 40 - "Design Bottoni e Filtri"
Cohesion: 0.27
Nodes (10): Button component (.btn/.btn-primary/.qbtn/.act-btn), Tab / Filtri rapidi toolbar (.pbar), Button states (hover/active/disabled/focus), Button component doc, Query/Filter pill (.qbtn, mutually exclusive), Primary button (.btn-primary), Secondary button (.btn), Conferma eliminazione modal (+2 more)

### Community 41 - "Migrazione Multisede Docs"
Cohesion: 0.22
Nodes (7): Backfill sedeId migration script (phase 1), MULTISEDE-MIGRATION roadmap, Option B subcollection per sede (rejected), Option C multi-tenant tenantId (deferred white-label), Role-based access via sedi[] flags / custom claims, Sede selector UX (sedeAttiva, data-sede), Sidebar sede switcher (lungomare / paesi-etnei)

### Community 42 - "FidelAI Admin Riscatti"
Cohesion: 0.28
Nodes (8): ADMIN_EMAILS, baseOpts, callFidelai(), FIDELAI_API_BASE, FIDELAI_BRIDGE_SECRET, FIDELAI_MERCHANT, fidelaiLoyalty, fidelaiRedeem

### Community 43 - "renderCassa"
Cohesion: 0.21
Nodes (17): addUscita(), delUscita(), initCassa(), renderCassa(), renderCassaAutoEntries(), FINESTRA_GIORNI, giornoPassato(), limiteISO() (+9 more)

### Community 44 - "servizi-aggiuntivi.js"
Cohesion: 0.38
Nodes (8): addServizio(), _esc(), initServiziAggiuntivi(), _loadFromFirestore(), loadServiziAttivi(), renderPanel(), _servizi, wireForm()

### Community 45 - "Manifest PWA"
Cohesion: 0.22
Nodes (8): background_color, description, display, icons, name, short_name, start_url, theme_color

### Community 46 - "Backup Pre Multisede"
Cohesion: 0.22
Nodes (5): admin, COLLECTIONS, db, fs, path

### Community 47 - "Cancello Docs"
Cohesion: 0.29
Nodes (7): cancello@washhub.it Firebase account, cancello_sync.py service (washhub-cancello systemd), Firestore cancelloStato/lungomare (pinOccupati), Firestore codiciParcheggio collection, cancello-sync README (Parcheggio Smart), Hikvision DS-K1T805MX gate terminals (EST .51 / INT .50), Parcheggio Smart page

### Community 49 - "chiamate.js"
Cohesion: 0.33
Nodes (11): apriPrenota(), avviaChiamate(), box(), chiE(), disegnaPerse(), etichetta(), isoOggi(), mostra() (+3 more)

### Community 50 - "Backfill sedeId"
Cohesion: 0.29
Nodes (7): admin, argv, backfillCollection(), COLLECTIONS, db, main(), SINGLE_COLL

### Community 52 - "Protocollo VNE Note"
Cohesion: 0.33
Nodes (6): PROTOCOLLO-VNE-NOTES (VNE 3.05 error map), VNE mess error codes (req_status NACK), Payment polling status lifecycle (pending→completed/partial/deleted/returned), tipo_annullamento (partial accept vs full refund), VNE Automatic Cash Self-Cash API v3.05, test_mock.py VNE emulator (port 9999)

### Community 54 - "Analisi Sospesi Script"
Cohesion: 0.29
Nodes (4): admin, argv, db, SEDE

### Community 56 - "Display Cassa Cliente"
Cohesion: 0.40
Nodes (6): ascolta() cassaDisplay/{sede} listener, FidelAI merchants/{MERCHANT}/customers/{tel} (fideliai-app), mostra() thank-you + FidelAI QR, riposo() idle video loop, display.html customer-facing cash screen (kiosk), FidelAI Riscatti + Programma fedeltà page

### Community 57 - "reset-pagamenti-20261022.mjs"
Cohesion: 0.18
Nodes (8): APPLY, batch, db, FINO, tot, db, H, s

### Community 58 - "meteo.js"
Cohesion: 0.33
Nodes (8): meteoCall(), EMOJI, fmtD(), GG, initMeteo(), LABEL, oggiISO(), renderMeteo()

### Community 59 - "cassa-stato.js"
Cohesion: 0.50
Nodes (8): healthBridge(), statoCassa(), ensureCard(), initCassaStato(), refresh(), renderSkeleton(), startAutoRefresh(), stopAutoRefresh()

### Community 60 - "Microcopy e Tono"
Cohesion: 0.40
Nodes (5): Microcopy (CTA, conferme, errori, empty state), Terminologia ufficiale (Prenotazione, Sospeso, Prima Nota...), Status map per modulo (Prenotazioni, Abbonamenti, Giornalieri), Terminologia personalizzabile, Voice & Tone (italiano, diretto)

### Community 61 - "Design Tokens"
Cohesion: 0.60
Nodes (5): design-system/ folder, Style Dictionary build (css/tokens.css), Token structure (color, typography, spacing, borderRadius, shadow, motion, layout), Processo aggiornamento token, tokens.json (Style Dictionary-compatible)

### Community 62 - "Runbook WhatsApp"
Cohesion: 0.50
Nodes (5): WhatsApp 24h conversation window, WhatsApp Cloud API activation runbook, Firebase secrets META_WHATSAPP_TOKEN / PHONE_NUMBER_ID / WEBHOOK_VERIFY_TOKEN / APP_SECRET, Meta message templates (conferma/reminder/grazie/benvenuto), Cloud Functions whatsappWebhook / whatsappSend / whatsappSendBulk

### Community 63 - "Dipendenze Root"
Cohesion: 0.67
Nodes (3): devDependencies, firebase-admin@^13.10.0, firebase-admin

### Community 69 - "giornalieri.js"
Cohesion: 0.56
Nodes (8): addGiornaliero(), calcPrezzoGiornaliero(), checkoutGiornaliero(), delGiornaliero(), initGiornalieri(), _mostraModalCheckout(), parcheggioInSospeso(), renderGiornalieri()

### Community 70 - "Firestore config/cassaAutomatica (bridgeUrl, bridgeToken, enabled)"
Cohesion: 0.40
Nodes (5): Firestore config/cassaAutomatica (bridgeUrl, bridgeToken, enabled), Bridge endpoints (/health /paga /polling /annulla /stato /rimborso /chiusura), BRIDGE_TOKEN Bearer authentication, Firestore cassaDisplay/{sede}, Incasso Giornaliero page (cassa)

### Community 71 - "chiusura.ts"
Cohesion: 0.53
Nodes (5): chiusuraGiornaliera, giornoRome(), isDomenica(), SEDI, slugTipo()

## Ambiguous Edges - Review These
- `Prenotazioni + Tappezzeria page` → `Cloud Functions whatsappWebhook / whatsappSend / whatsappSendBulk`  [AMBIGUOUS]
  index.html · relation: conceptually_related_to

## Knowledge Gaps
- **44 isolated node(s):** `Flag operativo CASSA AUTO (enabled)`, `Modalita alternativa HTTP loopback + Cloudflare Tunnel`, `Firebase project dashboard-washhub`, `GitHub Pages deploy (git push origin main)`, `Raspberry Pi Zero W` (+39 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 359 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `js/moduli/cassa-automatica.js (modale + polling)` connect `setup-cassa-config.js` to `Design Pattern e Modali`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **What connects `Flag operativo CASSA AUTO (enabled)`, `Modalita alternativa HTTP loopback + Cloudflare Tunnel`, `Firebase project dashboard-washhub` to the rest of the system?**
  _44 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `fEur` be split into smaller, more focused modules?**
  _Cohesion score 0.11320754716981132 - nodes in this community are weakly interconnected._
- **Should `prenota-online.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06610259122157588 - nodes in this community are weakly interconnected._
- **Should `Meteo Semaforo Function` be split into smaller, more focused modules?**
  _Cohesion score 0.08562367864693446 - nodes in this community are weakly interconnected._
- **Should `Script Archivio e Analisi` be split into smaller, more focused modules?**
  _Cohesion score 0.0728744939271255 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Prenotazioni + Tappezzeria page` and `Cloud Functions whatsappWebhook / whatsappSend / whatsappSendBulk`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._