// DELIVERY HUB v2 — Main App with month-filtered queries + cache

var CACHE_KEY = 'dhub_';

async function loadAllData() {
    try {
        await Promise.all([
            loadConsegnePerMese(),
            loadFiliali(),
            loadDriverAnagrafica(),
            loadDanni()
        ]);
    } catch (e) {
        console.error('Load error:', e);
        toast('Errore nel caricamento dati', 'error');
    }
}

// Carica consegne SOLO per il mese selezionato
async function loadConsegnePerMese() {
    var mese = state.meseCorrente;
    if (!mese) {
        var now = new Date();
        var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        mese = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
    }

    // Controlla cache per questo mese
    var cacheKey = CACHE_KEY + 'cons_' + mese;
    var cacheTimeKey = CACHE_KEY + 'cons_time_' + mese;
    var cacheTime = localStorage.getItem(cacheTimeKey);
    var lastSync = await getLastSyncTimestamp();
    var cacheValid = cacheTime && lastSync && parseInt(cacheTime) > lastSync;

    if (cacheValid) {
        try {
            var cached = JSON.parse(localStorage.getItem(cacheKey) || '[]');
            state.consegne = cached.map(function(c) {
                if (c.data && typeof c.data === 'string') c.data = new Date(c.data);
                return c;
            });
            console.log('Cache mese ' + mese + ': ' + state.consegne.length + ' consegne');
            return;
        } catch(e) { /* fallback to Firestore */ }
    }

    // Carica da Firestore filtrato per mese
    try {
        var snap = await db.collection('consegne')
            .where('mese', '==', mese)
            .get();
        state.consegne = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });
        console.log('Firestore mese ' + mese + ': ' + state.consegne.length + ' consegne');

        // Salva in cache (solo campi essenziali per risparmiare spazio)
        try {
            var cacheData = state.consegne.map(function(c) {
                return {
                    filiale: c.filiale,
                    data: c.data instanceof Date ? c.data.toISOString() : c.data,
                    mese: c.mese,
                    area: c.area,
                    importo: c.importo,
                    driver: c.driver,
                    fascia: c.fascia,
                    fonte: c.fonte,
                    consegnata: c.consegnata
                };
            });
            localStorage.setItem(cacheKey, JSON.stringify(cacheData));
            localStorage.setItem(cacheTimeKey, String(Date.now()));
        } catch(e) { console.warn('Cache save error:', e.message); }
    } catch (e) {
        console.warn('Consegne load:', e);
        // Fallback cache
        try {
            var cached = JSON.parse(localStorage.getItem(cacheKey) || '[]');
            state.consegne = cached.map(function(c) {
                if (c.data && typeof c.data === 'string') c.data = new Date(c.data);
                return c;
            });
            console.log('Fallback cache: ' + state.consegne.length);
        } catch(e2) { state.consegne = []; }
    }
}

async function getLastSyncTimestamp() {
    try {
        var snap = await db.collection('syncLogs')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();
        if (!snap.empty) {
            var ts = snap.docs[0].data().timestamp;
            return new Date(ts).getTime();
        }
    } catch (e) {}
    return 0;
}

async function loadFiliali() {
    var cached = localStorage.getItem(CACHE_KEY + 'filiali');
    if (cached) {
        try {
            state.filiali = JSON.parse(cached);
            state.filialiMap = {};
            state.filiali.forEach(function(f) { state.filialiMap[String(f.codice)] = f; });
            console.log('Cache: ' + state.filiali.length + ' filiali');
            return;
        } catch(e) {}
    }
    try {
        var snap = await db.collection('filiali').get();
        state.filiali = snap.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
        state.filialiMap = {};
        state.filiali.forEach(function(f) { state.filialiMap[String(f.codice)] = f; });
        localStorage.setItem(CACHE_KEY + 'filiali', JSON.stringify(state.filiali));
        console.log('Loaded ' + state.filiali.length + ' filiali');
    } catch (e) {
        console.warn('Filiali load:', e);
        state.filiali = [];
    }
}

async function loadDriverAnagrafica() {
    var cached = localStorage.getItem(CACHE_KEY + 'driver');
    if (cached) {
        try {
            state.driverList = JSON.parse(cached);
            console.log('Cache: ' + state.driverList.length + ' driver');
            return;
        } catch(e) {}
    }
    try {
        var snap = await db.collection('driverAnagrafica').get();
        state.driverList = snap.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
        localStorage.setItem(CACHE_KEY + 'driver', JSON.stringify(state.driverList));
        console.log('Loaded ' + state.driverList.length + ' driver');
    } catch (e) {
        console.warn('Driver load:', e);
        state.driverList = [];
    }
}

async function loadDanni() {
    try {
        var snap = await db.collection('danni').orderBy('data', 'desc').limit(500).get();
        state.danniList = snap.docs.map(function(doc) {
            var d = doc.data();
            d.id = doc.id;
            if (d.data && d.data.toDate) d.data = d.data.toDate();
            return d;
        });
        console.log('Loaded ' + state.danniList.length + ' danni');
    } catch (e) {
        console.warn('Danni load:', e);
        state.danniList = [];
    }
}

// Forza refresh da Firestore
async function forceRefresh() {
    toast('Aggiornamento...', 'info');
    clearCache();
    await loadAllData();
    refreshCurrentModule();
    toast('Dati aggiornati!', 'success');
}

function clearCache() {
    var keys = Object.keys(localStorage);
    keys.forEach(function(k) {
        if (k.indexOf(CACHE_KEY) === 0) localStorage.removeItem(k);
    });
    console.log('Cache svuotata');
}

document.addEventListener('DOMContentLoaded', function() {
    initAuth();
});
