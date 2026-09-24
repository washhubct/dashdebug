# cancello-sync — Parcheggio Smart

Servizio Python (solo stdlib) che gira sul Pi del Wash Hub e tiene allineati i
`codiciParcheggio` di Firestore con gli utenti temporanei dei due terminali
Hikvision DS-K1T805MX del cancello (EST = entrata 192.168.1.51, INT = uscita
192.168.1.50). Dettagli del ciclo nel docstring di `cancello_sync.py`.

## Installazione sul Pi (una tantum)

```bash
mkdir -p ~/cancello
# copiare cancello_sync.py in ~/cancello/ (scp, o cat via ssh)
# ~/cancello.env (chmod 600) con: HIK_USER HIK_PASS HIK_EST HIK_INT
#                                 FB_API_KEY FB_EMAIL FB_PASSWORD POLL_SEC
sudo cp ~/cancello/washhub-cancello.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now washhub-cancello
```

Log: `tail -f ~/cancello/cancello.log`. Un ciclo singolo di test: `python3 ~/cancello/cancello_sync.py --once`.

## Account Firebase del Pi

`cancello@washhub.it` (Firebase Auth, email/password). Per le rules è un
operatore senza doc `/utenti/{uid}` → accesso alla sola sede `lungomare`.
Può leggere/aggiornare `codiciParcheggio` e scrivere `cancelloStato/lungomare`.
Per revocare l'accesso: disabilitare l'utente in Firebase Auth.

## Convenzioni sui terminali

- employeeNo dei codici smart: `77` + 6 cifre (gli abbonati caricati a mano
  usano `000000xx`). Nome utente sul terminale: `SMART <targa>`.
- PIN = codice a 6 cifre; il terminale è in modalità `cardOrPw` con PIN puro,
  quindi il cliente digita solo le cifre. I PIN degli abbonati vengono
  pubblicati in `cancelloStato.pinOccupati` e sito/dash li evitano.
- Validità = `Valid.beginTime/endTime` in ora locale (il terminale è in
  Europe/Rome). Scaduto il periodo il terminale rifiuta il PIN da solo; il
  servizio rimuove l'utente 10 minuti dopo `fine` e marca il doc `scaduto`.
- Il terminale blocca il login remoto per un po' dopo ~5 password sbagliate:
  non insistere con credenziali errate.
