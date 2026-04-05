import { db, fsCollection, fsAddDoc, fsGetDocs, fsUpdateDoc, fsDeleteDoc, fsDoc } from '../firebase-config.js';
import { state } from '../state.js';
import { pNum, fEur, esc, fmtDI, pDate } from '../utils.js';

let clientiDB = [];
let filtroAttivo = 'tutti';

export function initClienti() {
    document.getElementById('addClienteBtn')?.addEventListener('click', () => showClienteForm());
    document.getElementById('clienteSaveBtn')?.addEventListener('click', salvaCliente);
    document.getElementById('clienteAnnullaBtn')?.addEventListener('click', hideClienteForm);
    document.getElementById('clienteSrch')?.addEventListener('input', renderClienti);
    document.getElementById('addVetturaBtn')?.addEventListener('click', () => aggiungiCampoVettura());
    document.getElementById('storicoCloseBtn')?.addEventListener('click', () => document.getElementById('clienteStorico')?.classList.remove('show'));

    // Toggle dati fiscali quando cambia tipo
    document.getElementById('cTipo')?.addEventListener('change', toggleDatiFiscali);

    document.querySelectorAll('#page-clienti [data-filtro]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#page-clienti [data-filtro]').forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
            filtroAttivo = btn.dataset.filtro;
            renderClienti();
        });
    });
    initAutocompletamento();
}

function toggleDatiFiscali() {
    const tipo = document.getElementById('cTipo')?.value || 'privato';
    const section = document.getElementById('datiFiscaliSection');
    if (section) section.style.display = (tipo === 'azienda' || tipo === 'fattura' || tipo === 'flotta') ? 'block' : 'none';
}

export async function caricaClienti() {
    try {
        const snap = await fsGetDocs(fsCollection(db, 'clienti'));
        clientiDB = [];
        snap.forEach(docSnap => { const d = docSnap.data(); d._id = docSnap.id; clientiDB.push(d); });
        state.clientiDB = clientiDB;
    } catch (e) { console.warn('Errore caricamento clienti:', e); }
}

function calcolaStatsCliente(nomeCliente) {
    if (!nomeCliente) return { numLavaggi:0, ultimaVisita:null, spesaTotale:0, giorniDaUltimaVisita:999, sospesiAperti:0, ticketMedio:0, frequenzaMedia:0 };
    const nomeUp = nomeCliente.toUpperCase();
    let numLavaggi=0, spesaTotale=0, ultimaData=null, primaData=null, sospesiAperti=0;

    for (const [date, entries] of Object.entries(state.prenDB || {})) {
        entries.forEach(p => {
            if ((p.cliente||'').toUpperCase() === nomeUp) {
                numLavaggi++;
                if (p.saldato==='SI') spesaTotale += pNum(p.prezzo);
                if (p.saldo==='SOSPESO') sospesiAperti += pNum(p.prezzo);
                const d = new Date(date);
                if (!ultimaData || d > ultimaData) ultimaData = d;
                if (!primaData || d < primaData) primaData = d;
            }
        });
    }
    (state.tapDB||[]).forEach(t => {
        if ((t.cliente||'').toUpperCase() === nomeUp) {
            numLavaggi++;
            if (t.status==='OUT' && t.pagamento!=='SOSPESO') spesaTotale += pNum(t.prezzo);
            if (t.pagamento==='SOSPESO') sospesiAperti += pNum(t.prezzo);
            const d = pDate(t.dataIn);
            if (d && (!ultimaData || d > ultimaData)) ultimaData = d;
            if (d && (!primaData || d < primaData)) primaData = d;
        }
    });

    const oggi = new Date();
    const giorniDa = ultimaData ? Math.floor((oggi - ultimaData) / 864e5) : 999;
    const ultimaVisita = ultimaData ? `${String(ultimaData.getDate()).padStart(2,'0')}/${String(ultimaData.getMonth()+1).padStart(2,'0')}/${ultimaData.getFullYear()}` : null;
    const ticketMedio = numLavaggi > 0 ? Math.round(spesaTotale / numLavaggi) : 0;
    const giorniAttivo = primaData ? Math.max(1, Math.floor((oggi - primaData) / 864e5)) : 1;
    const frequenzaMedia = numLavaggi > 1 ? Math.round(giorniAttivo / numLavaggi) : 0;
    return { numLavaggi, ultimaVisita, spesaTotale, giorniDaUltimaVisita:giorniDa, sospesiAperti, ticketMedio, frequenzaMedia };
}

function buildStorico(nomeCliente) {
    const nomeUp = nomeCliente.toUpperCase();
    const eventi = [];
    for (const [date, entries] of Object.entries(state.prenDB || {})) {
        entries.forEach(p => {
            if ((p.cliente||'').toUpperCase() === nomeUp) {
                eventi.push({ data:date, dataSort:new Date(date), tipo:'🧼 Lavaggio', vettura:p.vettura||'—', importo:pNum(p.prezzo),
                    pagamento: p.saldato==='SI' ? (p.saldo||'SI') : (p.saldo==='SOSPESO' ? '⏳ Sospeso' : '—') });
            }
        });
    }
    (state.tapDB||[]).forEach(t => {
        if ((t.cliente||'').toUpperCase() === nomeUp) {
            eventi.push({ data:t.dataIn||'—', dataSort:pDate(t.dataIn)||new Date(0), tipo:'🪡 Tappezzeria',
                vettura:(t.modello||'')+(t.targa?' '+t.targa:''), importo:pNum(t.prezzo),
                pagamento: t.status==='OUT' ? (t.pagamento==='SOSPESO'?'⏳ Sospeso':t.pagamento||'SI') : '🔧 In lav.' });
        }
    });
    eventi.sort((a,b) => b.dataSort - a.dataSort);
    return eventi;
}

function mostraStorico(clienteId) {
    const c = clientiDB.find(x => x._id === clienteId);
    if (!c) return;
    const panel = document.getElementById('clienteStorico');
    if (!panel) return;
    const stats = calcolaStatsCliente(c.nome);
    const eventi = buildStorico(c.nome);

    document.getElementById('storicoTitle').textContent = `📋 Storico di ${c.nome}`;
    const kpis = document.getElementById('storicoKpis');
    if (kpis) {
        kpis.innerHTML = `
            <div class="kpi g"><div class="kpi-label">Lavaggi</div><div class="kpi-val">${stats.numLavaggi}</div></div>
            <div class="kpi b"><div class="kpi-label">Spesa Totale</div><div class="kpi-val">${fEur(stats.spesaTotale)}</div></div>
            <div class="kpi" style="border-color:var(--tx2)"><div class="kpi-label">Ticket Medio</div><div class="kpi-val">${fEur(stats.ticketMedio)}</div></div>
            <div class="kpi" style="border-color:var(--amb)"><div class="kpi-label">Ogni ~</div><div class="kpi-val">${stats.frequenzaMedia > 0 ? stats.frequenzaMedia+'gg' : '—'}</div></div>
            ${stats.sospesiAperti > 0 ? `<div class="kpi r"><div class="kpi-label">Sospesi Aperti</div><div class="kpi-val">${fEur(stats.sospesiAperti)}</div></div>` : ''}`;
    }
    const tb = document.getElementById('storicoTb');
    if (tb) {
        if (!eventi.length) { tb.innerHTML = '<tr><td colspan="5" class="empty">Nessuno storico</td></tr>'; }
        else {
            tb.innerHTML = eventi.map(e => {
                const dataDisplay = e.data.includes('-') ? e.data.split('-').reverse().join('/') : e.data;
                const pagClass = e.pagamento.includes('Sospeso') ? 'a' : (e.pagamento==='—'||e.pagamento.includes('lav.') ? '' : 'g');
                return `<tr><td style="font:400 10px var(--mono)">${dataDisplay}</td><td>${e.tipo}</td><td style="font-size:11px">${esc(e.vettura)}</td><td style="font-weight:600">€${e.importo}</td><td>${pagClass?`<span class="badge ${pagClass}">${e.pagamento}</span>`:e.pagamento}</td></tr>`;
            }).join('');
        }
    }
    panel.classList.add('show');
    panel.scrollIntoView({behavior:'smooth'});
}

export function renderClienti() {
    const tb = document.getElementById('clientiTb');
    if (!tb) return;
    const srch = (document.getElementById('clienteSrch')?.value||'').toLowerCase();

    clientiDB.forEach(c => {
        const s = calcolaStatsCliente(c.nome);
        c._numLavaggi=s.numLavaggi; c._ultimaVisita=s.ultimaVisita; c._spesaTotale=s.spesaTotale;
        c._giorniDaUltimaVisita=s.giorniDaUltimaVisita; c._sospesiAperti=s.sospesiAperti;
        c._ticketMedio=s.ticketMedio; c._frequenzaMedia=s.frequenzaMedia;
    });

    const totClienti=clientiDB.length;
    const attivi=clientiDB.filter(c=>c._giorniDaUltimaVisita<=30).length;
    const rischio=clientiDB.filter(c=>c._giorniDaUltimaVisita>30&&c._giorniDaUltimaVisita<=90).length;
    const dormienti=clientiDB.filter(c=>c._giorniDaUltimaVisita>90&&c._numLavaggi>0).length;
    const vip=clientiDB.filter(c=>c.prezzoVip>0).length;
    const setK=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    setK('crmKpiTot',totClienti); setK('crmKpiAttivi',attivi); setK('crmKpiRischio',rischio); setK('crmKpiDormienti',dormienti); setK('crmKpiVip',vip);

    let filtered=[...clientiDB];
    if(filtroAttivo==='attivi') filtered=filtered.filter(c=>c._giorniDaUltimaVisita<=30);
    else if(filtroAttivo==='rischio') filtered=filtered.filter(c=>c._giorniDaUltimaVisita>30&&c._giorniDaUltimaVisita<=90);
    else if(filtroAttivo==='dormienti') filtered=filtered.filter(c=>c._giorniDaUltimaVisita>90&&c._numLavaggi>0);
    else if(filtroAttivo==='vip') filtered=filtered.filter(c=>c.prezzoVip>0);
    else if(filtroAttivo==='azienda') filtered=filtered.filter(c=>c.tipo==='azienda'||c.tipo==='fattura'||c.tipo==='flotta');
    else if(filtroAttivo==='sospesi') filtered=filtered.filter(c=>c._sospesiAperti>0);

    if(srch) filtered=filtered.filter(c=>(c.nome||'').toLowerCase().includes(srch)||(c.telefono||'').toLowerCase().includes(srch)||(c.vetture||[]).some(v=>(v.modello||'').toLowerCase().includes(srch)||(v.targa||'').toLowerCase().includes(srch)));

    if(filtroAttivo==='dormienti'||filtroAttivo==='rischio') filtered.sort((a,b)=>b._giorniDaUltimaVisita-a._giorniDaUltimaVisita);
    else filtered.sort((a,b)=>(b._numLavaggi||0)-(a._numLavaggi||0));

    if(!filtered.length){tb.innerHTML='<tr><td colspan="8" class="empty">Nessun cliente trovato</td></tr>';return;}

    tb.innerHTML=filtered.map(c=>{
        const vetture=(c.vetture||[]).map(v=>`${v.modello||''} ${v.targa||''}`).join(', ')||'—';
        const isVip=c.prezzoVip&&c.prezzoVip>0;
        const gg=c._giorniDaUltimaVisita;
        const alertClass=gg>90?'r':gg>60?'r':gg>30?'a':'g';
        const alertLabel=gg>90?`${gg}gg 🚨`:gg>60?`${gg}gg ⚠️`:gg>30?`${gg}gg`:c._ultimaVisita||'—';
        const tipoMap={azienda:['🏢','b'],fattura:['📄','a'],flotta:['🚐','b'],privato:['','']};
        const [tipoIcon,tipoBadge]=tipoMap[c.tipo]||['',''];
        const tipoHtml=tipoIcon?`<span class="badge ${tipoBadge}" style="font-size:8px">${tipoIcon} ${(c.tipo||'').toUpperCase()}</span>`:'<span style="font-size:10px;color:var(--tx3)">Privato</span>';

        return `<tr>
            <td><strong style="cursor:pointer;text-decoration:underline dotted" class="cli-storico" data-id="${c._id}">${esc(c.nome||'')}</strong>${isVip?' <span class="badge b" style="font-size:8px">⭐ VIP</span>':''}${c._sospesiAperti>0?` <span class="badge r" style="font-size:8px">€${c._sospesiAperti} sosp.</span>`:''}${c.note?`<div style="font:400 10px var(--f);color:var(--tx3);margin-top:2px" title="${esc(c.note)}">📝 ${esc(c.note.substring(0,40))}${c.note.length>40?'...':''}</div>`:''}</td>
            <td style="font-size:11px">${esc(c.telefono||'—')}</td>
            <td>${tipoHtml}</td>
            <td style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis" title="${esc(vetture)}">${esc(vetture)}</td>
            <td style="text-align:center;font:600 12px var(--mono)">${c._numLavaggi||0}</td>
            <td><span class="badge ${alertClass}">${alertLabel}</span></td>
            <td style="font-weight:600">${c._spesaTotale>0?fEur(c._spesaTotale):'—'}</td>
            <td style="white-space:nowrap"><button class="act-btn cli-storico-btn" data-id="${c._id}" title="Storico">📋</button><button class="act-btn edit-cli" data-id="${c._id}" title="Modifica">✎</button><button class="act-btn del del-cli" data-id="${c._id}" title="Elimina">✕</button></td></tr>`;
    }).join('');

    tb.querySelectorAll('.edit-cli').forEach(btn=>btn.addEventListener('click',()=>editCliente(btn.dataset.id)));
    tb.querySelectorAll('.del-cli').forEach(btn=>btn.addEventListener('click',()=>deleteCliente(btn.dataset.id)));
    tb.querySelectorAll('.cli-storico,.cli-storico-btn').forEach(el=>el.addEventListener('click',()=>mostraStorico(el.dataset.id)));
}

function showClienteForm(data) {
    const form=document.getElementById('clienteForm'); if(!form)return;
    form.classList.add('show'); document.getElementById('addClienteBtn').style.display='none';
    document.getElementById('clienteStorico')?.classList.remove('show');
    if(data&&data._id){
        document.getElementById('clienteFTitle').textContent='Modifica Cliente';
        document.getElementById('clienteSaveBtn').textContent='Aggiorna';
        state.clienteEditId=data._id;
        document.getElementById('cNome').value=data.nome||'';
        document.getElementById('cTel').value=data.telefono||'';
        document.getElementById('cNote').value=data.note||'';
        document.getElementById('cPrezzoVip').value=data.prezzoVip||'';
        document.getElementById('cTipo').value=data.tipo||'privato';
        // Dati fiscali
        document.getElementById('cDenominazione').value=data.denominazione||'';
        document.getElementById('cPiva').value=data.piva||'';
        document.getElementById('cCodDest').value=data.codDestinatario||'';
        document.getElementById('cPec').value=data.pec||'';
        document.getElementById('cSede').value=data.sedeLegale||'';
        const container=document.getElementById('vettureContainer'); container.innerHTML='';
        (data.vetture||[]).forEach(v=>aggiungiCampoVettura(v));
    } else {
        document.getElementById('clienteFTitle').textContent='Nuovo Cliente';
        document.getElementById('clienteSaveBtn').textContent='Salva';
        state.clienteEditId=null;
        ['cNome','cTel','cNote','cPrezzoVip','cDenominazione','cPiva','cCodDest','cPec','cSede'].forEach(id=>document.getElementById(id).value='');
        document.getElementById('cTipo').value='privato';
        document.getElementById('vettureContainer').innerHTML='';
        aggiungiCampoVettura();
    }
    toggleDatiFiscali();
}
function hideClienteForm(){document.getElementById('clienteForm')?.classList.remove('show');document.getElementById('addClienteBtn').style.display='';state.clienteEditId=null;}

function aggiungiCampoVettura(data){
    const container=document.getElementById('vettureContainer'); if(!container)return;
    const div=document.createElement('div'); div.className='vettura-row';
    div.style.cssText='display:flex;gap:8px;align-items:flex-end;margin-bottom:6px';
    div.innerHTML=`<div class="ff" style="flex:1;min-width:120px"><label>Modello</label><input class="v-modello" value="${esc((data?.modello)||'')}" placeholder="Es: FIAT 500"></div><div class="ff" style="width:100px"><label>Targa</label><input class="v-targa" value="${esc((data?.targa)||'')}" style="text-transform:uppercase" placeholder="AA000BB"></div><div class="ff" style="width:80px"><label>Prezzo €</label><input class="v-prezzo" type="number" step="1" value="${data?.prezzo||''}" placeholder="—"></div><button type="button" class="act-btn del" style="height:37px;margin-bottom:2px" title="Rimuovi">✕</button>`;
    div.querySelector('.del').addEventListener('click',()=>div.remove());
    container.appendChild(div);
}

async function salvaCliente(){
    const msg=document.getElementById('clienteMsg');
    const nome=document.getElementById('cNome').value.trim().toUpperCase();
    const telefono=document.getElementById('cTel').value.trim();
    const note=document.getElementById('cNote').value.trim();
    const prezzoVip=parseFloat(document.getElementById('cPrezzoVip').value)||0;
    const tipo=document.getElementById('cTipo')?.value||'privato';
    if(!nome){if(msg){msg.style.color='var(--red)';msg.textContent='⚠️ Inserisci il nome!';}return;}
    
    // Dati fiscali
    const denominazione=document.getElementById('cDenominazione')?.value.trim().toUpperCase()||'';
    const piva=document.getElementById('cPiva')?.value.trim()||'';
    const codDestinatario=document.getElementById('cCodDest')?.value.trim().toUpperCase()||'';
    const pec=document.getElementById('cPec')?.value.trim()||'';
    const sedeLegale=document.getElementById('cSede')?.value.trim()||'';
    
    const vetture=[];
    document.querySelectorAll('.vettura-row').forEach(row=>{
        const modello=row.querySelector('.v-modello')?.value.trim().toUpperCase()||'';
        const targa=row.querySelector('.v-targa')?.value.trim().toUpperCase()||'';
        const prezzo=parseFloat(row.querySelector('.v-prezzo')?.value)||0;
        if(modello||targa) vetture.push({modello,targa,prezzo});
    });
    const record={nome,telefono,vetture,note,prezzoVip,tipo,denominazione,piva,codDestinatario,pec,sedeLegale,timestamp:Date.now()};
    try{
        if(state.clienteEditId){
            await fsUpdateDoc(fsDoc(db,'clienti',state.clienteEditId),record);
            const idx=clientiDB.findIndex(c=>c._id===state.clienteEditId);
            if(idx>=0){record._id=state.clienteEditId;clientiDB[idx]=record;}
            if(msg){msg.style.color='var(--grn)';msg.textContent='✅ Aggiornato!';}
        } else {
            const dup=clientiDB.find(c=>c.nome===nome);
            if(dup&&!confirm(`Esiste già "${nome}". Aggiungo comunque?`))return;
            const ref=await fsAddDoc(fsCollection(db,'clienti'),record);
            record._id=ref.id; clientiDB.push(record);
            if(msg){msg.style.color='var(--grn)';msg.textContent='✅ Salvato!';}
        }
        state.clientiDB=clientiDB;
        setTimeout(()=>{hideClienteForm();renderClienti();},600);
    }catch(e){console.error(e);if(msg){msg.style.color='var(--red)';msg.textContent='⚠️ Errore!';}}
}

function editCliente(id){const c=clientiDB.find(x=>x._id===id);if(c)showClienteForm(c);}
async function deleteCliente(id){const c=clientiDB.find(x=>x._id===id);if(!c)return;if(!confirm(`Eliminare ${c.nome}?`))return;try{await fsDeleteDoc(fsDoc(db,'clienti',id));clientiDB=clientiDB.filter(x=>x._id!==id);state.clientiDB=clientiDB;renderClienti();}catch(e){console.error(e);}}

// ═══ AUTOCOMPLETAMENTO ═══
function initAutocompletamento(){
    setupAutocomplete('pCliente',q=>clientiDB.filter(c=>(c.nome||'').toLowerCase().includes(q)||(c.telefono||'').includes(q)).slice(0,6),onSelectCliente);
    setupAutocomplete('pTelefono',q=>clientiDB.filter(c=>(c.telefono||'').includes(q)||(c.nome||'').toLowerCase().includes(q)).slice(0,6),onSelectCliente);
    setupAutocomplete('tCliente',q=>clientiDB.filter(c=>(c.nome||'').toLowerCase().includes(q)||(c.telefono||'').includes(q)).slice(0,6),onSelectClienteTap);
}

function setupAutocomplete(inputId,searchFn,onSelectFn){
    const input=document.getElementById(inputId); if(!input)return;
    let dropdown=document.getElementById(inputId+'_ac');
    if(!dropdown){dropdown=document.createElement('div');dropdown.id=inputId+'_ac';dropdown.className='ac-dropdown';dropdown.style.cssText='position:absolute;z-index:999;background:var(--bg);border:1px solid var(--brd);border-radius:var(--r2);box-shadow:0 4px 16px rgba(0,0,0,.15);max-height:240px;overflow-y:auto;display:none;width:100%;left:0;top:100%';input.parentElement.style.position='relative';input.parentElement.appendChild(dropdown);}
    let timer;
    input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{
        const q=input.value.trim().toLowerCase();if(q.length<2){dropdown.style.display='none';return;}
        const res=searchFn(q);if(!res.length){dropdown.style.display='none';return;}
        dropdown.innerHTML=res.map(c=>{const v=(c.vetture||[]).map(x=>x.modello).filter(Boolean).join(', ');const s=calcolaStatsCliente(c.nome);
            return `<div class="ac-item" data-id="${c._id}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--brd);transition:background .15s"><div style="font:600 13px var(--f);color:var(--tx)">${esc(c.nome)}${c.prezzoVip>0?' <span style="color:var(--blu);font-size:10px">⭐VIP</span>':''} <span style="font:400 10px var(--mono);color:var(--tx3)">${s.numLavaggi}lav.</span></div><div style="font:400 11px var(--f);color:var(--tx2)">${esc(c.telefono||'—')}${v?' · '+esc(v):''}</div></div>`;}).join('');
        dropdown.style.display='block';
        dropdown.querySelectorAll('.ac-item').forEach(item=>{item.addEventListener('mouseenter',()=>item.style.background='var(--bg3)');item.addEventListener('mouseleave',()=>item.style.background='');item.addEventListener('click',()=>{const cl=clientiDB.find(c=>c._id===item.dataset.id);if(cl)onSelectFn(cl);dropdown.style.display='none';});});
    },200);});
    document.addEventListener('click',e=>{if(!input.contains(e.target)&&!dropdown.contains(e.target))dropdown.style.display='none';});
}

function onSelectCliente(cliente){
    const ic=document.getElementById('pCliente');if(ic)ic.value=cliente.nome;
    const it=document.getElementById('pTelefono');if(it&&cliente.telefono)it.value=cliente.telefono;
    if(cliente.vetture&&cliente.vetture.length>0){
        if(cliente.vetture.length===1){const v=cliente.vetture[0];const iv=document.getElementById('pVettura');if(iv)iv.value=(v.modello||'')+(v.targa?' '+v.targa:'');const p=v.prezzo||cliente.prezzoVip||'';const ip=document.getElementById('pPrezzo');if(ip&&p)ip.value=p;}
        else mostraSelettoreVettura(cliente,'pVettura','pPrezzo');
    } else if(cliente.prezzoVip>0){const ip=document.getElementById('pPrezzo');if(ip)ip.value=cliente.prezzoVip;}
}

function onSelectClienteTap(cliente){
    const ic=document.getElementById('tCliente');if(ic)ic.value=cliente.nome;
    if(cliente.vetture&&cliente.vetture.length>0){
        if(cliente.vetture.length===1){const v=cliente.vetture[0];const im=document.getElementById('tModello');if(im)im.value=v.modello||'';const it=document.getElementById('tTarga');if(it)it.value=v.targa||'';const p=v.prezzo||cliente.prezzoVip||'';const ip=document.getElementById('tPrezzo');if(ip&&p)ip.value=p;}
        else mostraSelettoreVetturaTap(cliente);
    }
}

function mostraSelettoreVettura(cliente,vetturaId,prezzoId){
    const iv=document.getElementById(vetturaId);if(!iv)return;
    document.getElementById('vetturaSel')?.remove();
    const sel=document.createElement('div');sel.id='vetturaSel';sel.style.cssText='position:absolute;z-index:999;background:var(--bg);border:1px solid var(--blu);border-radius:var(--r2);box-shadow:0 4px 16px rgba(37,99,235,.2);max-height:200px;overflow-y:auto;width:100%;left:0;top:100%';
    sel.innerHTML=`<div style="padding:6px 12px;font:600 10px var(--mono);color:var(--tx3);text-transform:uppercase;border-bottom:1px solid var(--brd)">Scegli vettura di ${esc(cliente.nome)}</div>`+cliente.vetture.map((v,i)=>`<div class="vet-opt" data-idx="${i}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--brd);transition:background .15s"><span style="font:600 12px var(--f)">${esc(v.modello||'—')}</span><span style="font:400 10px var(--mono);color:var(--tx2);margin-left:6px">${esc(v.targa||'')}${v.prezzo?' · €'+v.prezzo:''}</span></div>`).join('')+`<div class="vet-opt" data-idx="-1" style="padding:10px 14px;cursor:pointer;color:var(--blu);font:500 12px var(--f)">+ Nuova vettura</div>`;
    iv.parentElement.style.position='relative';iv.parentElement.appendChild(sel);
    sel.querySelectorAll('.vet-opt').forEach(opt=>{opt.addEventListener('mouseenter',()=>opt.style.background='var(--bg3)');opt.addEventListener('mouseleave',()=>opt.style.background='');opt.addEventListener('click',()=>{const idx=parseInt(opt.dataset.idx);if(idx>=0){const v=cliente.vetture[idx];iv.value=(v.modello||'')+(v.targa?' '+v.targa:'');const ip=document.getElementById(prezzoId);const p=v.prezzo||cliente.prezzoVip||'';if(ip&&p)ip.value=p;}else{iv.value='';iv.focus();}sel.remove();});});
    document.addEventListener('click',function h(e){if(!sel.contains(e.target)&&e.target!==iv){sel.remove();document.removeEventListener('click',h);}});
}

function mostraSelettoreVetturaTap(cliente){
    const im=document.getElementById('tModello');if(!im)return;
    document.getElementById('vetturaSel')?.remove();
    const sel=document.createElement('div');sel.id='vetturaSel';sel.style.cssText='position:absolute;z-index:999;background:var(--bg);border:1px solid var(--blu);border-radius:var(--r2);box-shadow:0 4px 16px rgba(37,99,235,.2);max-height:200px;overflow-y:auto;width:100%;left:0;top:100%';
    sel.innerHTML=`<div style="padding:6px 12px;font:600 10px var(--mono);color:var(--tx3);text-transform:uppercase;border-bottom:1px solid var(--brd)">Scegli vettura di ${esc(cliente.nome)}</div>`+cliente.vetture.map((v,i)=>`<div class="vet-opt" data-idx="${i}" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--brd);transition:background .15s"><span style="font:600 12px var(--f)">${esc(v.modello||'—')}</span><span style="font:400 10px var(--mono);color:var(--tx2);margin-left:6px">${esc(v.targa||'')}</span></div>`).join('')+`<div class="vet-opt" data-idx="-1" style="padding:10px 14px;cursor:pointer;color:var(--blu);font:500 12px var(--f)">+ Nuova vettura</div>`;
    im.parentElement.style.position='relative';im.parentElement.appendChild(sel);
    sel.querySelectorAll('.vet-opt').forEach(opt=>{opt.addEventListener('mouseenter',()=>opt.style.background='var(--bg3)');opt.addEventListener('mouseleave',()=>opt.style.background='');opt.addEventListener('click',()=>{const idx=parseInt(opt.dataset.idx);if(idx>=0){const v=cliente.vetture[idx];im.value=v.modello||'';const it=document.getElementById('tTarga');if(it)it.value=v.targa||'';const p=v.prezzo||cliente.prezzoVip||'';const ip=document.getElementById('tPrezzo');if(ip&&p)ip.value=p;}else{im.value='';im.focus();}sel.remove();});});
    document.addEventListener('click',function h(e){if(!sel.contains(e.target)&&e.target!==im){sel.remove();document.removeEventListener('click',h);}});
}

// ═══ AUTO-CREAZIONE CLIENTE ═══
export function autoSalvaCliente(nome,vettura,targa,telefono){
    if(!nome||nome.length<2)return;
    const nomeUp=nome.toUpperCase();
    const esistente=clientiDB.find(c=>c.nome===nomeUp);
    if(esistente){
        if(vettura&&!esistente.vetture?.some(v=>v.modello===vettura.toUpperCase())){const nv={modello:vettura.toUpperCase(),targa:(targa||'').toUpperCase(),prezzo:0};const vt=[...(esistente.vetture||[]),nv];fsUpdateDoc(fsDoc(db,'clienti',esistente._id),{vetture:vt}).catch(e=>console.warn(e));esistente.vetture=vt;}
        if(telefono&&!esistente.telefono){fsUpdateDoc(fsDoc(db,'clienti',esistente._id),{telefono}).catch(e=>console.warn(e));esistente.telefono=telefono;}
        return;
    }
    const record={nome:nomeUp,telefono:telefono||'',vetture:vettura?[{modello:vettura.toUpperCase(),targa:(targa||'').toUpperCase(),prezzo:0}]:[],note:'',prezzoVip:0,tipo:'privato',timestamp:Date.now()};
    fsAddDoc(fsCollection(db,'clienti'),record).then(ref=>{record._id=ref.id;clientiDB.push(record);state.clientiDB=clientiDB;}).catch(e=>console.warn(e));
}
