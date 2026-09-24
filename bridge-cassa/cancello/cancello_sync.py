#!/usr/bin/env python3
"""
cancello-sync — Wash Hub Parcheggio Smart
=========================================
Gira sul Pi del Wash Hub (stessa LAN dei terminali Hikvision DS-K1T805MX).
Ogni POLL_SEC secondi:

  1. legge da Firestore i `codiciParcheggio` attivi/revocati (sede lungomare)
  2. crea/aggiorna sui DUE terminali (EST = entrata, INT = uscita) un utente
     temporaneo con PIN = codice e periodo di validità = inizio/fine
  3. cancella l'utente per i codici revocati o scaduti (→ stato 'scaduto')
  4. legge gli eventi di passaggio dai terminali e li scrive in `eventi[]`
  5. pubblica in `cancelloStato/lungomare` lo stato dei terminali e la lista
     dei PIN già occupati (abbonati caricati a mano) così sito e dash non
     generano codici doppi

Accesso Firestore: REST API con un utente Firebase Auth dedicato
(cancello@washhub.it, ruolo operatore → sede lungomare via rules). Niente
service account sul Pi. Solo stdlib: nessuna dipendenza da installare.

Config in ~/cancello.env (chmod 600):
  HIK_USER, HIK_PASS      admin dei terminali
  HIK_EST, HIK_INT        IP terminali (192.168.1.51 / .50)
  FB_API_KEY, FB_EMAIL, FB_PASSWORD
  POLL_SEC (20)           intervallo ciclo
  STATE_FILE (~/cancello.state.json)
"""
import datetime as dt
import json
import logging
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from urllib.request import HTTPDigestAuthHandler, HTTPPasswordMgrWithDefaultRealm, build_opener

# ── config ─────────────────────────────────────────────────────────────
ENV_FILE = os.path.expanduser(os.environ.get('CANCELLO_ENV', '~/cancello.env'))
if os.path.exists(ENV_FILE):
    for line in open(ENV_FILE):
        line = line.rstrip('\n')
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

HIK_USER = os.environ.get('HIK_USER', 'admin')
HIK_PASS = os.environ.get('HIK_PASS', '')
TERMINALI = {'est': os.environ.get('HIK_EST', '192.168.1.51'), 'int': os.environ.get('HIK_INT', '192.168.1.50')}
FB_API_KEY = os.environ.get('FB_API_KEY', '')
FB_EMAIL = os.environ.get('FB_EMAIL', '')
FB_PASSWORD = os.environ.get('FB_PASSWORD', '')
POLL_SEC = int(os.environ.get('POLL_SEC', '20'))
STATE_FILE = os.path.expanduser(os.environ.get('STATE_FILE', '~/cancello.state.json'))
PROJECT = 'dashboard-washhub'
SEDE = 'lungomare'
COLL = 'codiciParcheggio'
EMP_PREFIX = '77'                 # employeeNo dei codici smart: 77 + 6 cifre (gli abbonati a mano usano 000000xx)
SCADUTO_GRACE_MS = 10 * 60 * 1000  # tolleranza dopo `fine` prima di cancellare l'utente
TZ_SUFFIX = '+02:00'              # aggiornato dal terminale (System/time)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s', stream=sys.stdout)
log = logging.getLogger('cancello')


def now_ms() -> int:
    return int(time.time() * 1000)


def local_iso(ms: int) -> str:
    """epoch ms → 'YYYY-MM-DDTHH:MM:SS' nell'ora locale del Pi (= ora del terminale)."""
    return dt.datetime.fromtimestamp(ms / 1000).strftime('%Y-%m-%dT%H:%M:%S')


# ── Hikvision ISAPI ────────────────────────────────────────────────────
class Terminale:
    def __init__(self, nome: str, host: str):
        self.nome, self.host = nome, host
        self.base = f'http://{host}'
        pm = HTTPPasswordMgrWithDefaultRealm()
        pm.add_password(None, self.base, HIK_USER, HIK_PASS)
        self.op = build_opener(HTTPDigestAuthHandler(pm))
        self.online = False
        self.utenti: dict[str, dict] = {}   # employeeNo → UserInfo

    def call(self, path: str, method: str = 'GET', body=None, timeout: int = 15):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={'Content-Type': 'application/json'})
        with self.op.open(req, timeout=timeout) as r:
            txt = r.read().decode(errors='replace')
        return json.loads(txt) if txt.strip().startswith('{') else txt

    def carica_utenti(self):
        utenti, pos = {}, 0
        while True:
            r = self.call('/ISAPI/AccessControl/UserInfo/Search?format=json', 'POST',
                          {'UserInfoSearchCond': {'searchID': 'sync', 'searchResultPosition': pos, 'maxResults': 50}})
            s = r.get('UserInfoSearch', {})
            lista = s.get('UserInfo', []) or []
            for u in lista:
                utenti[u['employeeNo']] = u
            pos += len(lista)
            if s.get('responseStatusStrg') != 'MORE' or not lista:
                break
        self.utenti = utenti
        self.online = True
        return utenti

    def upsert(self, emp: str, nome: str, pin: str, inizio_ms: int, fine_ms: int):
        body = {'UserInfo': {
            'employeeNo': emp, 'name': nome[:32], 'userType': 'normal',
            'Valid': {'enable': True, 'beginTime': local_iso(inizio_ms), 'endTime': local_iso(fine_ms), 'timeType': 'local'},
            'password': pin, 'doorRight': '1', 'RightPlan': [{'doorNo': 1, 'planTemplateNo': '1'}],
        }}
        if emp in self.utenti:
            r = self.call('/ISAPI/AccessControl/UserInfo/Modify?format=json', 'PUT', body)
        else:
            r = self.call('/ISAPI/AccessControl/UserInfo/Record?format=json', 'POST', body)
        if not isinstance(r, dict) or r.get('statusCode') != 1:
            raise RuntimeError(f'ISAPI {self.nome}: {r}')
        self.utenti[emp] = body['UserInfo']

    def delete(self, emp: str):
        if emp not in self.utenti:
            return
        r = self.call('/ISAPI/AccessControl/UserInfo/Delete?format=json', 'PUT', {'UserInfoDelCond': {'EmployeeNoList': [{'employeeNo': emp}]}})
        if not isinstance(r, dict) or r.get('statusCode') != 1:
            raise RuntimeError(f'ISAPI delete {self.nome}: {r}')
        self.utenti.pop(emp, None)

    def eventi(self, da_ms: int, a_ms: int) -> list[dict]:
        """Eventi di accesso (major 5 = evento controllo accessi) nell'intervallo. Best effort."""
        out, pos = [], 0
        while True:
            r = self.call('/ISAPI/AccessControl/AcsEvent?format=json', 'POST', {'AcsEventCond': {
                'searchID': 'ev', 'searchResultPosition': pos, 'maxResults': 30, 'major': 5, 'minor': 0,
                'startTime': local_iso(da_ms) + TZ_SUFFIX, 'endTime': local_iso(a_ms) + TZ_SUFFIX,
            }}, timeout=25)
            s = r.get('AcsEvent', {}) if isinstance(r, dict) else {}
            lista = s.get('InfoList', []) or []
            out += lista
            pos += len(lista)
            if s.get('responseStatusStrg') != 'MORE' or not lista or pos > 500:
                break
        return out

    def ora(self):
        txt = self.call('/ISAPI/System/time')
        if isinstance(txt, str):
            import re
            m = re.search(r'<localTime>([^<]+)</localTime>', txt)
            return m.group(1) if m else None
        return None


# ── Firebase / Firestore REST ──────────────────────────────────────────
class Firestore:
    DOCS = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'

    def __init__(self):
        self.id_token, self.refresh_token, self.exp = None, None, 0

    def _post_json(self, url, body, headers=None):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **(headers or {})})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b'{}')

    def login(self):
        if self.id_token and time.time() < self.exp - 120:
            return
        try:
            if self.refresh_token:
                data = urllib.parse.urlencode({'grant_type': 'refresh_token', 'refresh_token': self.refresh_token}).encode()
                req = urllib.request.Request(f'https://securetoken.googleapis.com/v1/token?key={FB_API_KEY}', data=data)
                with urllib.request.urlopen(req, timeout=30) as r:
                    j = json.loads(r.read())
                self.id_token, self.refresh_token = j['id_token'], j['refresh_token']
                self.exp = time.time() + int(j.get('expires_in', 3600))
                return
        except Exception as e:
            log.warning('refresh token fallito: %s', e)
        j = self._post_json(f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FB_API_KEY}',
                            {'email': FB_EMAIL, 'password': FB_PASSWORD, 'returnSecureToken': True})
        self.id_token, self.refresh_token = j['idToken'], j['refreshToken']
        self.exp = time.time() + int(j.get('expiresIn', 3600))
        log.info('Firebase login ok (%s)', FB_EMAIL)

    def _req(self, method, url, body=None):
        self.login()
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {self.id_token}'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read() or b'{}')
        except urllib.error.HTTPError as e:
            raise RuntimeError(f'Firestore {method} {url.split("/documents")[-1][:80]} → {e.code}: {e.read().decode()[:300]}')

    # valori Firestore ⇄ Python
    @staticmethod
    def enc(v):
        if v is None: return {'nullValue': None}
        if isinstance(v, bool): return {'booleanValue': v}
        if isinstance(v, int): return {'integerValue': str(v)}
        if isinstance(v, float): return {'doubleValue': v}
        if isinstance(v, str): return {'stringValue': v}
        if isinstance(v, list): return {'arrayValue': {'values': [Firestore.enc(x) for x in v]}}
        if isinstance(v, dict): return {'mapValue': {'fields': {k: Firestore.enc(x) for k, x in v.items()}}}
        raise TypeError(type(v))

    @staticmethod
    def dec(v):
        if 'nullValue' in v: return None
        if 'booleanValue' in v: return v['booleanValue']
        if 'integerValue' in v: return int(v['integerValue'])
        if 'doubleValue' in v: return v['doubleValue']
        if 'stringValue' in v: return v['stringValue']
        if 'timestampValue' in v: return v['timestampValue']
        if 'arrayValue' in v: return [Firestore.dec(x) for x in v['arrayValue'].get('values', [])]
        if 'mapValue' in v: return {k: Firestore.dec(x) for k, x in v['mapValue'].get('fields', {}).items()}
        return None

    def doc_to_dict(self, d):
        out = {k: self.dec(v) for k, v in d.get('fields', {}).items()}
        out['_id'] = d['name'].rsplit('/', 1)[-1]
        return out

    def query(self, coll: str, **uguali) -> list[dict]:
        # Solo filtri di uguaglianza: le rules richiedono che la query filtri su sedeId.
        filtri = [{'fieldFilter': {'field': {'fieldPath': k}, 'op': 'EQUAL', 'value': self.enc(v)}} for k, v in uguali.items()]
        where = filtri[0] if len(filtri) == 1 else {'compositeFilter': {'op': 'AND', 'filters': filtri}}
        body = {'structuredQuery': {'from': [{'collectionId': coll}], 'where': where}}
        rows = self._req('POST', self.DOCS + ':runQuery', body)
        return [self.doc_to_dict(r['document']) for r in rows if 'document' in r]

    def get(self, coll: str, id_: str) -> dict | None:
        try:
            return self.doc_to_dict(self._req('GET', f'{self.DOCS}/{coll}/{id_}'))
        except RuntimeError as e:
            if '404' in str(e): return None
            raise

    def patch(self, coll: str, id_: str, campi: dict):
        mask = '&'.join('updateMask.fieldPaths=' + urllib.parse.quote(k) for k in campi)
        self._req('PATCH', f'{self.DOCS}/{coll}/{id_}?{mask}', {'fields': {k: self.enc(v) for k, v in campi.items()}})


# ── stato locale (ultimo evento letto per terminale) ───────────────────
def carica_stato() -> dict:
    try:
        return json.load(open(STATE_FILE))
    except Exception:
        return {}


def salva_stato(st: dict):
    tmp = STATE_FILE + '.tmp'
    json.dump(st, open(tmp, 'w'))
    os.replace(tmp, STATE_FILE)


# ── ciclo ──────────────────────────────────────────────────────────────
def nuovo_employee_no(occupati: set[str]) -> str:
    for _ in range(100):
        emp = EMP_PREFIX + f'{random.randint(0, 999999):06d}'
        if emp not in occupati:
            return emp
    raise RuntimeError('employeeNo esauriti')


def ciclo(fs: Firestore, terms: dict[str, Terminale], stato: dict):
    now = now_ms()

    # 1. terminali: utenti presenti (serve anche per i PIN occupati)
    for t in terms.values():
        try:
            t.carica_utenti()
        except Exception as e:
            t.online = False
            log.warning('terminale %s (%s) non raggiungibile: %s', t.nome, t.host, e)

    # 2. codici da Firestore
    attivi = fs.query(COLL, sedeId=SEDE, stato='attivo')
    revocati = [c for c in fs.query(COLL, sedeId=SEDE, stato='revocato')
                if any((c.get('sync') or {}).get(k) != 'ok' for k in terms)]
    occupati_emp = set()
    for t in terms.values():
        occupati_emp |= set(t.utenti)
    occupati_emp |= {c['hikEmployeeNo'] for c in attivi if c.get('hikEmployeeNo')}
    emp_to_doc = {}

    # 3. attivi → carica / scadenza
    for c in attivi:
        fine = int(c.get('fineTs') or 0)
        inizio = int(c.get('inizioTs') or 0)
        emp = c.get('hikEmployeeNo')
        if fine and now > fine + SCADUTO_GRACE_MS:
            ok = True
            for t in terms.values():
                if not t.online: ok = False; continue
                try:
                    if emp: t.delete(emp)
                except Exception as e:
                    ok = False; log.warning('delete scaduto %s su %s: %s', c['_id'], t.nome, e)
            if ok:
                fs.patch(COLL, c['_id'], {'stato': 'scaduto', 'scadutoTs': now, 'sync': {'est': 'ok', 'int': 'ok'}})
                log.info('codice %s (%s) scaduto → utenti rimossi', c.get('codice'), c.get('targa'))
            continue
        if not c.get('codice') or not fine:
            continue
        if not emp:
            emp = nuovo_employee_no(occupati_emp)
            occupati_emp.add(emp)
            fs.patch(COLL, c['_id'], {'hikEmployeeNo': emp})
            c['hikEmployeeNo'] = emp
        emp_to_doc[emp] = c
        sync = dict(c.get('sync') or {})
        cambiato = False
        for k, t in terms.items():
            presente = emp in t.utenti and t.utenti[emp].get('password') == c['codice'] \
                and t.utenti[emp].get('Valid', {}).get('endTime') == local_iso(fine)
            if sync.get(k) == 'ok' and presente:
                continue
            if not t.online:
                if sync.get(k) != 'errore':
                    sync[k] = 'errore'; cambiato = True
                    fs.patch(COLL, c['_id'], {'sync': sync, 'syncErrore': f'terminale {k.upper()} non raggiungibile'})
                continue
            try:
                nome = f"SMART {c.get('targa','')}".strip()
                t.upsert(emp, nome, str(c['codice']), max(int(inizio), now - 60_000) if inizio < now else inizio, fine)
                sync[k] = 'ok'; cambiato = True
                log.info('codice %s (%s) caricato su %s fino a %s', c['codice'], c.get('targa'), k.upper(), local_iso(fine))
            except Exception as e:
                sync[k] = 'errore'; cambiato = True
                fs.patch(COLL, c['_id'], {'sync': sync, 'syncErrore': str(e)[:200]})
                log.error('upsert %s su %s: %s', c['_id'], k, e)
        if cambiato and all(sync.get(k) == 'ok' for k in terms):
            fs.patch(COLL, c['_id'], {'sync': sync, 'syncErrore': None, 'syncTs': now})

    # 4. revocati → rimuovi
    for c in revocati:
        emp = c.get('hikEmployeeNo')
        sync = dict(c.get('sync') or {})
        for k, t in terms.items():
            if sync.get(k) == 'ok': continue
            if not t.online: continue
            try:
                if emp: t.delete(emp)
                sync[k] = 'ok'
            except Exception as e:
                sync[k] = 'errore'; log.error('revoca %s su %s: %s', c['_id'], k, e)
        fs.patch(COLL, c['_id'], {'sync': sync, 'syncTs': now})
        if all(sync.get(k) == 'ok' for k in terms):
            log.info('codice %s revocato → utenti rimossi', c.get('codice'))

    # 5. eventi di passaggio (solo utenti smart 77xxxxxx)
    for k, t in terms.items():
        if not t.online: continue
        da = int(stato.get(f'ultimoEvento_{k}') or (now - 3600_000))
        try:
            evs = t.eventi(da + 1000, now)
        except Exception as e:
            log.warning('eventi %s: %s', k, e); continue
        max_ts = da
        for ev in evs:
            emp = str(ev.get('employeeNoString') or ev.get('employeeNo') or '')
            ts_txt = str(ev.get('time') or '')[:19]
            try:
                ts = int(dt.datetime.strptime(ts_txt, '%Y-%m-%dT%H:%M:%S').timestamp() * 1000)
            except Exception:
                continue
            max_ts = max(max_ts, ts)
            if not emp.startswith(EMP_PREFIX):
                continue
            c = emp_to_doc.get(emp)
            if not c:
                continue
            evento = {'tipo': 'ingresso' if k == 'est' else 'uscita', 'ts': ts, 'terminale': k, 'minor': ev.get('minor'), 'esito': ev.get('currentVerifyMode') or ''}
            lista = list(c.get('eventi') or [])
            if any(e.get('ts') == ts and e.get('terminale') == k for e in lista):
                continue
            lista.append(evento)
            c['eventi'] = lista
            fs.patch(COLL, c['_id'], {'eventi': lista, 'ultimoPassaggioTs': ts})
            log.info('%s %s targa %s alle %s', evento['tipo'], c.get('codice'), c.get('targa'), ts_txt)
        stato[f'ultimoEvento_{k}'] = max_ts

    # 6. stato terminali + PIN occupati (per generazione codici lato sito/dash)
    pins = set()
    for t in terms.values():
        pins |= {str(u.get('password')) for u in t.utenti.values() if u.get('password')}
    stato_doc = {
        'sedeId': SEDE, 'ultimoCiclo': now, 'pinOccupati': sorted(pins),
        'terminali': {k: {'online': t.online, 'host': t.host, 'utenti': len(t.utenti)} for k, t in terms.items()},
        'codiciAttivi': len(attivi),
    }
    fs.patch('cancelloStato', SEDE, stato_doc)
    salva_stato(stato)


def main():
    if not HIK_PASS or not FB_EMAIL or not FB_PASSWORD:
        log.error('config incompleta in %s', ENV_FILE); sys.exit(1)
    terms = {k: Terminale(k, h) for k, h in TERMINALI.items()}
    fs = Firestore()
    stato = carica_stato()
    global TZ_SUFFIX
    try:
        ora = terms['est'].ora()
        if ora and (ora.endswith('+01:00') or ora.endswith('+02:00')):
            TZ_SUFFIX = ora[-6:]
        log.info('ora terminale EST: %s', ora)
    except Exception as e:
        log.warning('lettura ora terminale: %s', e)
    log.info('cancello-sync avviato: EST=%s INT=%s poll=%ss', TERMINALI['est'], TERMINALI['int'], POLL_SEC)
    while True:
        t0 = time.time()
        try:
            ciclo(fs, terms, stato)
        except Exception as e:
            log.error('ciclo fallito: %s', e)
        time.sleep(max(2, POLL_SEC - (time.time() - t0)))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--once':
        terms = {k: Terminale(k, h) for k, h in TERMINALI.items()}
        ciclo(Firestore(), terms, carica_stato())
    else:
        main()
