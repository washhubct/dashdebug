#!/usr/bin/env python3
"""
Wash Hub — monitor chiamate (FRITZ!Box → Firestore), 19/10/2026.

Si collega al "Call Monitor" del FRITZ!Box (TCP 1012, da attivare una volta
componendo #96*5* da un telefono collegato al FRITZ!Box) e per ogni chiamata:
  • scrive/aggiorna  chiamate/{id}          → storico + "chiamate perse da richiamare"
  • aggiorna         chiamataLive/{sede}    → riquadro "📞 sta chiamando" in dashboard

Formato righe del Call Monitor (separatore ';'):
  data;RING;connId;chiamante;chiamato;SIPx;          chiamata in arrivo
  data;CALL;connId;interno;nostroNum;chiamato;SIPx;  chiamata in uscita
  data;CONNECT;connId;interno;numero;                risposta
  data;DISCONNECT;connId;durataSec;                  fine
Una RING senza CONNECT prima della DISCONNECT = chiamata PERSA.

Credenziali Firebase: stesse del servizio cancello (CANCELLO_ENV: FB_API_KEY, FB_EMAIL,
FB_PASSWORD) — l'utente deve avere accesso alla sede. Host FRITZ!Box: FRITZ_HOST (env).
Nessun segreto nel codice.
"""
import json, logging, os, socket, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime

ENV = os.environ.get('CANCELLO_ENV', '/home/pi/cancello.env')
for line in open(ENV, encoding='utf-8'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())

PROJECT = 'dashboard-washhub'
FB_API_KEY, FB_EMAIL, FB_PASSWORD = os.environ['FB_API_KEY'], os.environ['FB_EMAIL'], os.environ['FB_PASSWORD']
FRITZ_HOST = os.environ.get('FRITZ_HOST', 'fritz.box')
FRITZ_PORT = int(os.environ.get('FRITZ_PORT', '1012'))
SEDE = os.environ.get('CHIAMATE_SEDE', 'lungomare')

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s', stream=sys.stdout)
log = logging.getLogger('chiamate')


class Firestore:
    DOCS = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'

    def __init__(self):
        self.id_token, self.refresh_token, self.exp = None, None, 0

    def _post(self, url, data, json_body=True):
        body = json.dumps(data).encode() if json_body else urllib.parse.urlencode(data).encode()
        req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'} if json_body else {})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b'{}')

    def login(self):
        if self.id_token and time.time() < self.exp - 120:
            return
        try:
            if self.refresh_token:
                j = self._post(f'https://securetoken.googleapis.com/v1/token?key={FB_API_KEY}',
                               {'grant_type': 'refresh_token', 'refresh_token': self.refresh_token}, json_body=False)
                self.id_token, self.refresh_token = j['id_token'], j['refresh_token']
                self.exp = time.time() + int(j.get('expires_in', 3600))
                return
        except Exception as e:
            log.warning('refresh token fallito: %s', e)
        j = self._post(f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FB_API_KEY}',
                       {'email': FB_EMAIL, 'password': FB_PASSWORD, 'returnSecureToken': True})
        self.id_token, self.refresh_token = j['idToken'], j['refreshToken']
        self.exp = time.time() + int(j.get('expiresIn', 3600))
        log.info('Firebase login ok')

    @staticmethod
    def enc(v):
        if v is None: return {'nullValue': None}
        if isinstance(v, bool): return {'booleanValue': v}
        if isinstance(v, int): return {'integerValue': str(v)}
        if isinstance(v, float): return {'doubleValue': v}
        return {'stringValue': str(v)}

    def patch(self, path, fields):
        """Crea o aggiorna SOLO i campi passati (updateMask)."""
        self.login()
        mask = '&'.join('updateMask.fieldPaths=' + urllib.parse.quote(k) for k in fields)
        url = f'{self.DOCS}/{path}?{mask}'
        body = json.dumps({'fields': {k: self.enc(v) for k, v in fields.items()}}).encode()
        req = urllib.request.Request(url, data=body, method='PATCH',
                                     headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {self.id_token}'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'Firestore PATCH {path} → {e.code}: {e.read().decode()[:200]}')


def tel9(n):
    d = ''.join(c for c in str(n or '') if c.isdigit())
    return d[-9:] if len(d) >= 9 else d


class Monitor:
    def __init__(self, fs):
        self.fs = fs
        self.attive = {}   # connId → stato della chiamata in corso

    def scrivi(self, c, **campi):
        c.update(campi)
        doc = {k: c[k] for k in ('sedeId', 'numero', 'tel9', 'direzione', 'stato', 'inizioTs', 'dataISO', 'ora', 'durataSec')}
        doc['aggiornatoTs'] = int(time.time() * 1000)
        try:
            self.fs.patch(f"chiamate/{c['id']}", doc)
            self.fs.patch(f'chiamataLive/{SEDE}', {**doc, 'chiamataId': c['id'], 'sedeId': SEDE})
        except Exception as e:
            log.error('scrittura Firestore fallita (%s): %s', c['id'], e)

    def riga(self, line):
        p = line.strip().split(';')
        if len(p) < 3:
            return
        try:
            quando = datetime.strptime(p[0], '%d.%m.%y %H:%M:%S')
        except ValueError:
            quando = datetime.now()
        tipo, conn = p[1], p[2]
        ts = int(quando.timestamp() * 1000)
        base = {'sedeId': SEDE, 'inizioTs': ts, 'dataISO': quando.strftime('%Y-%m-%d'), 'ora': quando.strftime('%H:%M'), 'durataSec': 0}
        if tipo == 'RING':                                   # in arrivo
            num = p[3] if len(p) > 3 else ''
            c = {**base, 'id': f"{SEDE}_{quando.strftime('%Y%m%d%H%M%S')}_{conn}", 'numero': num or 'anonimo',
                 'tel9': tel9(num), 'direzione': 'in', 'risposta': False}
            self.attive[conn] = c
            self.scrivi(c, stato='squilla')
            log.info('RING da %s', num or 'anonimo')
        elif tipo == 'CALL':                                 # in uscita
            num = p[5] if len(p) > 5 else ''
            c = {**base, 'id': f"{SEDE}_{quando.strftime('%Y%m%d%H%M%S')}_{conn}", 'numero': num, 'tel9': tel9(num),
                 'direzione': 'out', 'risposta': False}
            self.attive[conn] = c
            self.scrivi(c, stato='uscita')
        elif tipo == 'CONNECT' and conn in self.attive:
            c = self.attive[conn]
            c['risposta'] = True
            self.scrivi(c, stato='in_corso')
        elif tipo == 'DISCONNECT' and conn in self.attive:
            c = self.attive.pop(conn)
            dur = int(p[3]) if len(p) > 3 and p[3].isdigit() else 0
            if c['direzione'] == 'in' and not c['risposta']:
                self.scrivi(c, stato='persa', durataSec=0)
                log.info('PERSA da %s', c['numero'])
            else:
                self.scrivi(c, stato='conclusa', durataSec=dur)

    def run(self):
        while True:
            try:
                log.info('connessione a %s:%s…', FRITZ_HOST, FRITZ_PORT)
                with socket.create_connection((FRITZ_HOST, FRITZ_PORT), timeout=30) as s:
                    s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
                    s.settimeout(None)
                    log.info('collegato al Call Monitor')
                    buf = b''
                    while True:
                        data = s.recv(4096)
                        if not data:
                            raise ConnectionError('chiuso dal FRITZ!Box')
                        buf += data
                        while b'\n' in buf:
                            line, buf = buf.split(b'\n', 1)
                            self.riga(line.decode('utf-8', 'replace'))
            except Exception as e:
                log.warning('Call Monitor non raggiungibile: %s — riprovo tra 30 s', e)
                time.sleep(30)


if __name__ == '__main__':
    Monitor(Firestore()).run()
