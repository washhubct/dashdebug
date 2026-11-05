// Variabili globali di sistema
export const CONFIG = {
    MESI_S: ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'],
    N8N_URL: 'https://n8n-guido.lisergico.it/webhook/917ede0f-bdc3-4b3f-a29e-9d9336b22d09/chat'
};

// Lo stato centrale dell'applicazione (Database locali in memoria)
export const state = {
    currentUser: null,
    rawData: null,
    loadedMonths: 0,
    dateFrom: null,
    dateTo: null,
    abbFilter: 'tutti',
    sospFilter: 'aperti',
    abbEditId: null,
    sedeAttiva: localStorage.getItem('sedeAttiva') || 'lungomare',
    sedePermesse: [],
    
    // DB Locali
    prenDB: {},
    tapDB: [],
    giornDB: [],
    logDB: [],
    usciteDB: [],
    localAbb: [],
    localSosp: [],
    presenzeDB: [],
    incassiManualiDB: [],
    
    // Storico inziale
    storicoSospesi: []
};
