// DELIVERY HUB v2 — Main App (no cache per consegne)

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

async function loadConsegnePerMese() {
    var mese = state.meseCorrente;
    if (!mese) {
        var now = new Date();
        var prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        mese = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
    }

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
    } catch (e) {
        console.warn('Consegne load:', e);
        state.consegne = [];
    }
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

async function onMeseChange() {
    state.meseCorrente = document.getElementById('meseSelector').value;
    await loadConsegnePerMese();
    refreshCurrentModule();
}

function forceRefresh() {
    clearCache();
    location.reload();
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
