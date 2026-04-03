// ─── HTML ESCAPING ──────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── CONSTANTS ───────────────────────────────────────────────
const SYNC_INTERVAL_MS = 30000; // fallback polling (SSE is primary)
const MAX_LOG_DISPLAY = 200;
const MAX_RACK_CAPACITY = 20;
const MS_PER_DAY = 86400000;

const ACTIONS=['ADD','MOVE','REMOVE','HARVEST'];
const ZONES=['SPAWN','INC','TENT1','TENT2','TENT3','CONTAM'];
const SPAWN_RACKS=['SPAWN_R1','SPAWN_R2'];
const INC_RACKS=['INC_R1','INC_R2','INC_R3','INC_R4','INC_R5','INC_R6','INC_R7','INC_R8','INC_R9','INC_R10'];
const ALL_RACKS=[...SPAWN_RACKS,...INC_RACKS];
const LOCS=[...ZONES,...ALL_RACKS];
const RACK_ZONE=Object.fromEntries([...SPAWN_RACKS.map(r=>[r,'SPAWN']),...INC_RACKS.map(r=>[r,'INC'])]);
const toZone=loc=>RACK_ZONE[loc]||loc;
const ABBR={Kings:'KINGS',Oyster:'OYS',Shiitake:'SHII',Reishi:'REI',"Lion's Mane":'LION'};
const SP_COLORS=['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63','#00bcd4','#8bc34a'];
const REF_GROUPS=[
  {g:'Actions',items:['ADD','MOVE','REMOVE','HARVEST']},
  {g:'Zones',items:['SPAWN','INC','TENT1','TENT2','TENT3','CONTAM']},
  {g:'SPAWN racks',items:['SPAWN_R1','SPAWN_R2']},
  {g:'INC racks 1–5',items:['INC_R1','INC_R2','INC_R3','INC_R4','INC_R5']},
  {g:'INC racks 6–10',items:['INC_R6','INC_R7','INC_R8','INC_R9','INC_R10']},
  {g:'Quantities',items:['1','2','3','4','5','6','7','8','9','10']}
];

// ─── DATA ────────────────────────────────────────────────────
let batches=[],scanLog=[],manualTasks=[],harvests=[],cultures=[],inventory={},teamMembers=[],caldav={},assets=[],calendarEvents=[];
let scan={action:null,from:null,to:null,count:0,harvestBag:null};
let confirmCb=null,noteId=null,saving=false,lastHash='';
let spMap={};
const spColor=s=>{const k=(s||'').toLowerCase();if(!spMap[k])spMap[k]=SP_COLORS[Object.keys(spMap).length%SP_COLORS.length];return spMap[k]};
const spDot=s=>`<span class="sp-dot" style="background:${spColor(s)}"></span>`;

// ─── AUTH ────────────────────────────────────────────────────
let currentUser=null;
async function authFetch(url,opts){
  const r=await fetch(url,opts);
  if(r.status===401){window.location.href='/login.html';throw new Error('unauthorized');}
  return r;
}
async function loadCurrentUser(){
  try{const r=await authFetch('/api/auth/me');currentUser=await r.json();}catch{}
}

// ─── SYNC ────────────────────────────────────────────────────
async function loadData(){
  setSyncStatus('busy','Syncing...');
  try{
    const r=await authFetch('/api/data');
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    applyData(d);
    setSyncStatus('ok','Synced '+new Date().toLocaleTimeString('de-DE'));
    refresh();
  }catch(e){if(e.message==='unauthorized')return;setSyncStatus('err','Sync error: '+(e.message||'offline'))}
}
function applyData(d){
  batches=d.batches||[];scanLog=d.scanLog||[];manualTasks=d.manualTasks||[];
  harvests=d.harvests||[];cultures=d.cultures||[];
  inventory=d.inventory||defaultInventory();
  teamMembers=d.teamMembers||[];caldav=d.caldav||{};assets=d.assets||[];calendarEvents=d.calendarEvents||[];
  batches.forEach(b=>spColor(b.species));cultures.forEach(c=>spColor(c.species));
  fillCultureSelect('nb-culture',['PD','LC']);updateTodoBadge();
}
function defaultInventory(){
  return{
    stock:{hardwood:0,wheatbran:0,gypsum:0,grain:0},
    thresholds:{hardwood:{minKg:50},wheatbran:{minKg:20},gypsum:{minKg:5},grain:{minKg:10}},
    // Average substrate composition used for "~X bags" estimates
    // These are editable in the Inventory → Stock tab
    avgComposition:{hwPct:75,wbPct:25,rhPct:63,bagKg:3,grainBagKg:1},
    log:[]
  };
}
async function saveData(){
  if(saving)return;saving=true;setSyncStatus('busy','Saving...');
  try{
    const r=await authFetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({batches,scanLog,manualTasks,harvests,cultures,inventory,teamMembers,caldav,assets,calendarEvents})});
    if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.reason||d.error||'HTTP '+r.status)}
    setSyncStatus('ok','Saved '+new Date().toLocaleTimeString('de-DE'));
  }catch(e){setSyncStatus('err','Save error: '+(e.message||'check server'))}
  finally{saving=false}
}
function setSyncStatus(cls,msg){document.getElementById('sync-dot').className='sync-dot '+cls;document.getElementById('sync-label').textContent=msg}
async function pollSync(){
  if(saving)return;
  try{const r=await authFetch('/api/data');
  if(!r.ok)return;
  const d=await r.json();const h=JSON.stringify(d);if(h!==lastHash){lastHash=h;applyData(d);setSyncStatus('ok','Synced '+new Date().toLocaleTimeString('de-DE'));refresh();}}catch{}
}

// ─── NAV ─────────────────────────────────────────────────────
const PAGES={dash:'n-dash',batch:'n-batch',lab:'n-lab',assets:'n-assets',print:'n-print',todo:'n-todo',settings:'n-settings'};
function go(page,btnId){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('p-'+page).classList.add('active');
  document.getElementById(btnId).classList.add('active');
  if(page==='dash'){renderStatus();renderRacks();renderLocTabs();renderDashAlerts();}
  if(page==='batch')renderBatches();
  if(page==='lab')renderCultures();
  if(page==='inv'){renderInvStock();}
  if(page==='assets')renderAssets();
  if(page==='print'){fillBatchSelect();renderLabList();}
  if(page==='todo')renderTodo();
  if(page==='settings')renderLog();
  updateTodoBadge();
}
function openStab(page,sub){
  document.querySelectorAll(`#p-${page} .stab`).forEach(b=>b.classList.remove('active'));
  document.querySelectorAll(`#p-${page} .sp`).forEach(p=>p.classList.remove('active'));
  document.getElementById(`st-${page}-${sub}`).classList.add('active');
  document.getElementById(`sp-${page}-${sub}`).classList.add('active');
  if(page==='batch'&&sub==='list')renderBatches();
  if(page==='batch'&&sub==='harvest')renderHarvests();
  if(page==='lab'&&sub==='cultures')renderCultures();
  if(page==='lab'&&sub==='work'){lwUpdate();renderLabLog();}
  if(page==='lab'&&sub==='lineage')fillLineageSelect();
  if(page==='inv'&&sub==='stock')renderInvStock();
  if(page==='inv'&&sub==='delivery'){delMatChange();adjMatChange();}
  if(page==='inv'&&sub==='log')renderInvLog();
  if(page==='assets'&&sub==='list')renderAssets();
  if(page==='assets'&&sub==='add')resetAssetForm();
  if(page==='assets'&&sub==='export')initExportTab();
  if(page==='assets'&&sub==='labels')renderAssetLabelList();
  if(page==='print'&&sub==='bags')fillBatchSelect();
  if(page==='print'&&sub==='lab'){renderLabList();renderLabPreview();}
  if(page==='print'&&sub==='ref')renderRefBarcodes();
  if(page==='todo'&&sub==='todo'){renderTodo();fillAssigneeSelect();}
  if(page==='todo'&&sub==='cal'){loadCalDAVImports().then(()=>renderCalendar());}
  if(page==='settings'&&sub==='caldav')loadCaldavSettings();
  if(page==='settings'&&sub==='log')renderLog();
}
function refresh(){
  const active=document.querySelector('.page.active');if(!active)return;
  const id=active.id.replace('p-','');
  if(id==='dash'){renderStatus();renderRacks();renderLocTabs();renderDashAlerts();}
  if(id==='batch')renderBatches();
  if(id==='lab')renderCultures();
  if(id==='inv')renderInvStock();
  if(id==='assets')renderAssets();
  if(id==='todo'){renderTodo();if(document.getElementById('sp-todo-cal').classList.contains('active')){loadCalDAVImports().then(()=>renderCalendar())}}
  updateTodoBadge();
}

// ─── MODALS ──────────────────────────────────────────────────
function confirm2(title,body,label,cb){document.getElementById('m-title').textContent=title;document.getElementById('m-body').textContent=body;document.getElementById('m-ok').textContent=label||'Confirm';confirmCb=cb;document.getElementById('m-confirm').classList.add('open')}
function closeConfirm(){document.getElementById('m-confirm').classList.remove('open');confirmCb=null}
document.getElementById('m-ok').onclick=()=>{if(confirmCb)confirmCb();closeConfirm()};
document.getElementById('m-confirm').addEventListener('click',e=>{if(e.target.id==='m-confirm')closeConfirm()});
function openNote(id){const b=batches.find(x=>x.batchId===id);if(!b)return;noteId=id;document.getElementById('m-note-title').textContent='Note — '+id;document.getElementById('m-note-text').value=b.notes||'';document.getElementById('m-note').classList.add('open');setTimeout(()=>document.getElementById('m-note-text').focus(),80)}
function closeNote(){document.getElementById('m-note').classList.remove('open');noteId=null}
function saveNote(){const b=batches.find(x=>x.batchId===noteId);if(b){b.notes=document.getElementById('m-note-text').value.trim();saveData();renderBatches()}closeNote()}
document.getElementById('m-note').addEventListener('click',e=>{if(e.target.id==='m-note')closeNote()});

// Batch-add modal
function openBatchAdd(){
  const bs=document.getElementById('ba-batch');
  bs.innerHTML='<option value="">— choose batch —</option>'+batches.map(b=>`<option value="${esc(b.batchId)}">${esc(b.batchId)} (${esc(b.species)})</option>`).join('');
  const ls=document.getElementById('ba-loc');
  ls.innerHTML=[...ZONES,...ALL_RACKS].map(l=>`<option value="${l}">${l}</option>`).join('');
  bs.onchange=baPreview;ls.onchange=baPreview;
  document.getElementById('m-batchadd').classList.add('open');
}
function closeBatchAdd(){document.getElementById('m-batchadd').classList.remove('open')}
function baPreview(){const id=document.getElementById('ba-batch').value,loc=document.getElementById('ba-loc').value,b=batches.find(x=>x.batchId===id);document.getElementById('ba-prev').textContent=b?`Will log ${b.bags.length} bags → ${loc}`:'';}
document.getElementById('m-batchadd').addEventListener('click',e=>{if(e.target.id==='m-batchadd')closeBatchAdd()});
function confirmBatchAdd(){
  const id=document.getElementById('ba-batch').value,loc=document.getElementById('ba-loc').value,batch=batches.find(x=>x.batchId===id);
  if(!id||!batch){alert('Select a batch first');return}
  const now=new Date().toISOString();
  batch.bags.forEach(bagId=>{const entry={time:now,action:'ADD',batch:id,bag:bagId,from:null,to:loc,species:batch.species,strain:batch.strain};scanLog.push(entry);scan.count++;});
  saveData();updateSD();setFb('ok',`Batch ADD: ${batch.bags.length} bags → ${loc}`);closeBatchAdd();
}

// ─── HELPERS ─────────────────────────────────────────────────
const abbrev=s=>{if(!s)return'BAG';const u=s.toLowerCase();for(const k in ABBR)if(k.toLowerCase()===u)return ABBR[k];return s.replace(/\s+/g,'').slice(0,5).toUpperCase()};
// Date string used in batch/culture IDs: DDMMYY format (e.g. "020426" for 2 Apr 2026)
// Barcode scanning decodes this via spAbbrev_strain_MMDD_bagNum format — see processScan()
const todayStr=()=>{const d=new Date();return String(d.getDate()).padStart(2,'0')+String(d.getMonth()+1).padStart(2,'0')+String(d.getFullYear()).slice(2)};
const genBatchId=sp=>{const ab=abbrev(sp),dt=todayStr(),n=batches.filter(b=>b.batchId.startsWith(ab+'-'+dt)).length;return ab+'-'+dt+'-'+String(n+1).padStart(2,'0')};
const sbadge=s=>{const m={INCUBATING:'b-inc',FRUITING:'b-tent','SPAWN RUN':'b-spawn',CONTAM:'b-contam',DONE:'b-done',EMPTY:'b-done'};return`<span class="badge ${m[s]||'b-done'}">${s}</span>`};

// ─── STATUS CALC ─────────────────────────────────────────────
function getStatus(id){
  const c={SPAWN:0,INC:0,TENT1:0,TENT2:0,TENT3:0,CONTAM:0};
  scanLog.filter(e=>e.batch===id).forEach(e=>{
    const tz=toZone(e.to),fz=toZone(e.from);
    if(e.action==='ADD'&&e.to&&c[tz]!==undefined)c[tz]=Math.max(0,c[tz]+1);
    if(e.action==='MOVE'){if(e.from&&c[fz]!==undefined)c[fz]=Math.max(0,c[fz]-1);if(e.to&&c[tz]!==undefined)c[tz]++}
    if(e.action==='REMOVE'&&e.from&&c[fz]!==undefined)c[fz]=Math.max(0,c[fz]-1);
  });
  const total=Object.values(c).reduce((a,b)=>a+b,0);
  let status='EMPTY',action='';
  if(c.TENT1+c.TENT2+c.TENT3>0){status='FRUITING';action='Harvest / check'}
  else if(c.INC>0){status='INCUBATING';action='Move to tent when ready'}
  else if(c.SPAWN>0){status='SPAWN RUN';action='Monitor spawn run'}
  else if(c.CONTAM>0){status='CONTAM';action='Discard bags'}
  else if(total===0&&scanLog.some(e=>e.batch===id)){status='DONE'}
  return{c,total,status,action};
}
const getHarvested=id=>harvests.filter(h=>h.batch===id).reduce((s,h)=>s+(h.grams||0),0);

// ─── DASHBOARD ───────────────────────────────────────────────
let harvestChartInst=null,batchYieldInst=null,timelineInst=null;

function renderMetrics(tot,inc,tent,contam){
  const totalHarv=harvests.reduce((s,h)=>s+(h.grams||0),0);
  const contamRate=tot>0?Math.round((contam/tot)*100):0;
  document.getElementById('metrics').innerHTML=[
    ['Total batches',tot,'#1a1a1a'],
    ['In incubation',inc,'#1e40af'],
    ['In tents / fruiting',tent,'#166534'],
    ['Total harvested',totalHarv>0?(totalHarv>=1000?(totalHarv/1000).toFixed(1)+'kg':totalHarv+'g'):'—','#92400e']
  ].map(([l,v,c])=>`<div class="met"><div class="met-l">${l}</div><div class="met-v" style="color:${c}">${v}</div></div>`).join('');
}

function renderPipelineChart(){
  const stages=[
    {label:'SPAWN',color:'#9b59b6'},
    {label:'INC',color:'#3498db'},
    {label:'TENT',color:'#2ecc71'},
    {label:'DONE',color:'#e5e3dd'},
    {label:'CONTAM',color:'#e74c3c'}
  ];
  const counts={SPAWN:0,INC:0,TENT:0,DONE:0,CONTAM:0};
  batches.forEach(b=>{
    const{c,status}=getStatus(b.batchId);
    counts.SPAWN+=c.SPAWN;counts.INC+=c.INC;
    counts.TENT+=c.TENT1+c.TENT2+c.TENT3;counts.CONTAM+=c.CONTAM;
    if(status==='DONE')counts.DONE++;
  });
  const max=Math.max(1,...Object.values(counts));
  const el=document.getElementById('pipeline-chart');
  el.innerHTML=stages.map(s=>{
    const v=counts[s.label]||0;
    const pct=Math.round((v/max)*100);
    return`<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="width:52px;font-size:11px;font-weight:600;color:#555;text-align:right;flex-shrink:0">${s.label}</div>
      <div style="flex:1;height:22px;background:#f0ede8;border-radius:4px;overflow:hidden">
        <div style="height:100%;background:${s.color};width:${pct}%;border-radius:4px;transition:width .4s;display:flex;align-items:center;padding-left:8px">
          ${v>0?`<span style="font-size:11px;font-weight:600;color:rgba(255,255,255,.9)">${v}</span>`:''}
        </div>
      </div>
      <div style="width:28px;font-size:11px;color:#888;text-align:right;flex-shrink:0">${v}</div>
    </div>`;
  }).join('');
}

function renderHarvestChart(){
  const canvas=document.getElementById('harvest-chart');
  if(!canvas)return;
  // Group by species
  const bySpecies={};
  harvests.forEach(h=>{if(!bySpecies[h.species])bySpecies[h.species]=0;bySpecies[h.species]+=h.grams||0});
  const labels=Object.keys(bySpecies);
  const data=labels.map(s=>bySpecies[s]);
  const colors=labels.map(s=>spColor(s));
  if(harvestChartInst){harvestChartInst.destroy();harvestChartInst=null}
  if(!labels.length){canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);const ctx=canvas.getContext('2d');ctx.fillStyle='#aaa';ctx.font='12px system-ui';ctx.textAlign='center';ctx.fillText('No harvest data yet',canvas.width/2,80);return}
  harvestChartInst=new Chart(canvas,{
    type:'bar',
    data:{labels,datasets:[{data,backgroundColor:colors,borderRadius:5,borderSkipped:false}]},
    options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>ctx.parsed.y+'g'}}},scales:{y:{ticks:{callback:v=>v+'g'},grid:{color:'#f0ede8'}},x:{grid:{display:false}}}}
  });
}

let statusCardMode=false;
function toggleStatusView(){
  statusCardMode=!statusCardMode;
  document.getElementById('status-table-view').style.display=statusCardMode?'none':'block';
  document.getElementById('status-card-view').style.display=statusCardMode?'block':'none';
  document.getElementById('status-view-btn').textContent=statusCardMode?'Table':'Cards';
  if(statusCardMode)renderStatusCards();
}

function renderStatusCards(){
  const q=(document.getElementById('status-q').value||'').toLowerCase();
  const el=document.getElementById('status-card-view');
  const filtered=batches.filter(b=>!q||b.batchId.toLowerCase().includes(q)||b.species.toLowerCase().includes(q));
  if(!filtered.length){el.innerHTML='<div class="empty">No batches match.</div>';return}
  el.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px';
  el.innerHTML=filtered.map(b=>{
    const{c,status,action}=getStatus(b.batchId);
    const harv=getHarvested(b.batchId);
    const due=new Date(b.due);const ov=due<new Date()&&(c.INC>0||c.SPAWN>0);
    const stages=[['S',c.SPAWN,'#9b59b6'],['I',c.INC,'#3498db'],['T',c.TENT1+c.TENT2+c.TENT3,'#2ecc71'],['!',c.CONTAM,'#e74c3c']].filter(x=>x[1]>0);
    const statusColors={INCUBATING:'#dbeafe',FRUITING:'#dcfce7','SPAWN RUN':'#f3e8ff',CONTAM:'#fee2e2',DONE:'#f5f4f0',EMPTY:'#f5f4f0'};
    return`<div style="border:1px solid ${ov?'#fecaca':'#e5e3dd'};border-radius:10px;padding:12px;background:${ov?'#fff5f5':'#fff'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px">
        <div>
          <div style="font-size:11px;font-family:monospace;color:#888">${esc(b.batchId)}</div>
          <div style="font-size:14px;font-weight:600;margin-top:1px">${spDot(b.species)}${esc(b.species)}</div>
          <div style="font-size:11px;color:#888">${esc(b.strain)}</div>
        </div>
        <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:${statusColors[status]||'#f5f4f0'};color:#555;flex-shrink:0;margin-left:4px">${status}</span>
      </div>
      <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap">
        ${stages.map(([l,n,col])=>`<span style="font-size:11px;font-weight:600;background:${col}22;color:${col};border:1px solid ${col}44;padding:1px 7px;border-radius:99px">${l}: ${n}</span>`).join('')}
      </div>
      ${harv>0?`<div style="font-size:11px;color:#92400e;font-weight:500;margin-bottom:4px">Harvest ${harv}g harvested</div>`:''}
      <div style="font-size:10px;color:${ov?'#b91c1c':'#aaa'}">Due: ${due.toLocaleDateString('de-DE')}${ov?' ⚠':''}</div>
      ${action?`<div style="font-size:11px;color:#666;margin-top:4px;font-style:italic">${action}</div>`:''}
    </div>`;
  }).join('');
}

function renderStatus(){
  const q=(document.getElementById('status-q').value||'').toLowerCase(),body=document.getElementById('status-body');
  if(!batches.length){body.innerHTML='<tr><td colspan="14" class="empty">No batches yet. Create one in Batches → New batch.</td></tr>';renderMetrics(0,0,0,0);renderPipelineChart();renderHarvestChart();return}
  let ti=0,tt=0,tc=0;
  const rows=batches.filter(b=>!q||b.batchId.toLowerCase().includes(q)||b.species.toLowerCase().includes(q)||b.strain.toLowerCase().includes(q)).map(b=>{
    const{c,total,status,action}=getStatus(b.batchId);ti+=c.INC;tt+=c.TENT1+c.TENT2+c.TENT3;tc+=c.CONTAM;
    const due=new Date(b.due),ov=due<new Date()&&(c.INC>0||c.SPAWN>0);
    const harv=getHarvested(b.batchId);
    return`<tr class="${ov?'alert-tr':''}"><td style="font-family:monospace;font-size:10px">${esc(b.batchId)}</td><td>${spDot(b.species)}${esc(b.species)}</td><td>${esc(b.strain)}</td><td>${c.SPAWN||''}</td><td>${c.INC||''}</td><td>${c.TENT1||''}</td><td>${c.TENT2||''}</td><td>${c.TENT3||''}</td><td style="color:${c.CONTAM>0?'#b91c1c':'inherit'}">${c.CONTAM||''}</td><td style="font-weight:600">${total}</td><td style="color:#92400e;font-size:11px">${harv>0?harv+'g':''}</td><td style="font-size:10px;color:${ov?'#b91c1c':'#888'}">${due.toLocaleDateString('de-DE')}</td><td>${sbadge(status)}</td><td style="font-size:11px;color:#666">${esc(action)}</td></tr>`;
  });
  body.innerHTML=rows.join('')||'<tr><td colspan="14" class="empty">No matches.</td></tr>';
  renderMetrics(batches.length,ti,tt,tc);
  renderPipelineChart();
  renderHarvestChart();
  if(statusCardMode)renderStatusCards();
}
function renderDashAlerts(){
  const tasks=buildAutoTasks().filter(t=>t.urgent||t.warn);
  const invAlerts=getInvAlerts();
  const all=[...invAlerts,...tasks];
  const el=document.getElementById('dash-alerts');
  if(!all.length){el.innerHTML='<div style="font-size:12px;color:#888;padding:4px 0">No urgent tasks right now.</div>';return}
  el.innerHTML=all.slice(0,8).map(t=>`<div class="todo-row ${t.urgent?'urgent':'warn'}"><span class="pdot ${t.urgent?'high':'med'}"></span><div style="flex:1"><div style="font-size:13px;font-weight:500">${t.species?spDot(t.species):''}${esc(t.text)}</div><div style="font-size:11px;color:#888;margin-top:1px">${esc(t.detail)}</div></div>${t.species?`<button class="btn btn-sm" onclick="go('dash','n-dash')" style="font-size:11px">View</button>`:`<button class="btn btn-sm" onclick="go('inv','n-inv')" style="font-size:11px">Stock</button>`}</div>`).join('');
}

// ─── RACKS ───────────────────────────────────────────────────
function getRackBags(rackId){
  const bags={};
  scanLog.forEach(e=>{
    if(e.action==='ADD'&&e.to===rackId&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain};
    if(e.action==='MOVE'){if(e.to===rackId&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain};if(e.from===rackId&&e.bag)delete bags[e.bag];}
    if(e.action==='REMOVE'&&e.from===rackId&&e.bag)delete bags[e.bag];
  });
  return bags;
}
function renderRacks(){
  const render=(ids,elId)=>{
    document.getElementById(elId).innerHTML=ids.map(id=>{
      const bags=getRackBags(id),count=Object.keys(bags).length;
      const byBatch={};Object.values(bags).forEach(b=>{if(!byBatch[b.batchId])byBatch[b.batchId]={c:0,sp:b.species};byBatch[b.batchId].c++});
      const label=id.replace(/_/g,' ');
      return`<div class="rack-card" onclick="showRack('${id}')">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;font-weight:600">${label}</span><span style="font-size:12px;color:${count>0?'#1a1a1a':'#aaa'}">${count} bag${count!==1?'s':''}</span></div>
        <div style="height:4px;border-radius:2px;background:#f0ede8;overflow:hidden;margin-bottom:4px"><div style="height:100%;border-radius:2px;background:${count>0?'#3498db':'#e5e3dd'};width:${Math.min(100,Math.round(count/MAX_RACK_CAPACITY*100))}%"></div></div>
        <div style="font-size:10px;color:#888">${Object.entries(byBatch).length?Object.entries(byBatch).map(([bid,d])=>`${spDot(d.sp)}<span style="font-family:monospace">${esc(bid)}</span>(${d.c})`).join(' '):'Empty'}</div>
      </div>`;
    }).join('');
  };
  render(SPAWN_RACKS,'racks-spawn');render(INC_RACKS,'racks-inc');
}
function showRack(id){
  const bags=getRackBags(id),entries=Object.entries(bags);
  const el=document.getElementById('rack-detail');
  document.getElementById('rack-detail-title').textContent=id.replace(/_/g,' ')+' — '+entries.length+' bag'+(entries.length!==1?'s':'');
  if(!entries.length){document.getElementById('rack-detail-body').innerHTML='<div class="empty">No bags on this rack.</div>';el.style.display='block';return}
  const byBatch={};entries.forEach(([bagId,d])=>{if(!byBatch[d.batchId])byBatch[d.batchId]={sp:d.species,st:d.strain,bags:[]};byBatch[d.batchId].bags.push(bagId)});
  document.getElementById('rack-detail-body').innerHTML=Object.entries(byBatch).map(([bid,d])=>`<div style="margin-bottom:8px"><div style="font-size:12px;font-weight:600;margin-bottom:4px">${spDot(d.sp)}${esc(bid)} — ${esc(d.sp)}/${esc(d.st)} (${d.bags.length} bags)</div><div style="display:flex;flex-wrap:wrap;gap:4px">${d.bags.map(b=>`<span style="font-size:10px;font-family:monospace;background:#fff;border:1px solid #e5e3dd;padding:2px 6px;border-radius:4px">${esc(b)}</span>`).join('')}</div></div>`).join('');
  el.style.display='block';el.scrollIntoView({behavior:'smooth',block:'nearest'});
}

// ─── LOCATION TABS ──────────────────────────────────────────
let activeLocTab='SPAWN';
const selectedLocBags=new Map(); // bagId → {batchId, loc}
function getZoneBags(zone){
  const bags={};
  scanLog.forEach(e=>{
    const tz=toZone(e.to),fz=toZone(e.from);
    if(e.action==='ADD'&&tz===zone&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain,loc:e.to};
    if(e.action==='MOVE'){
      if(tz===zone&&e.bag)bags[e.bag]={batchId:e.batch,species:e.species,strain:e.strain,loc:e.to};
      if(fz===zone&&e.bag)delete bags[e.bag];
    }
    if(e.action==='REMOVE'&&e.bag&&bags[e.bag])delete bags[e.bag];
  });
  return bags;
}
function renderLocTabs(){
  const tabs=document.getElementById('loc-tabs');
  tabs.innerHTML=ZONES.map(z=>{
    const count=Object.keys(getZoneBags(z)).length;
    return`<button class="btn btn-sm${activeLocTab===z?' btn-p':''}" onclick="activeLocTab='${z}';selectedLocBags.clear();renderLocTabs()" style="font-size:11px">${z} <span style="font-size:10px;opacity:.7">(${count})</span></button>`;
  }).join('');
  renderLocBody();
}
function toggleLocBag(bagId,batchId,loc){
  if(selectedLocBags.has(bagId))selectedLocBags.delete(bagId);
  else selectedLocBags.set(bagId,{batchId,loc});
  // Update chip style
  const el=document.getElementById('lb-'+bagId.replace(/[^a-zA-Z0-9]/g,'_'));
  if(el){
    const sel=selectedLocBags.has(bagId);
    el.style.background=sel?'#1a1a1a':'#fff';
    el.style.color=sel?'#fff':'#333';
    el.style.border=sel?'1px solid #1a1a1a':'1px solid #e5e3dd';
  }
  // Update action bar
  const bar=document.getElementById('loc-action-bar');
  const n=selectedLocBags.size;
  if(n>0){
    bar.style.display='flex';
    bar.innerHTML=`<span style="font-size:12px;font-weight:600">${n} bag${n!==1?'s':''} selected</span><span style="flex:1"></span>
      <button class="btn btn-sm" onclick="locSelectAll()" style="font-size:11px">Select all</button>
      <button class="btn btn-sm" onclick="selectedLocBags.clear();renderLocBody()" style="font-size:11px">Clear</button>
      <button class="btn btn-sm btn-p" onclick="openLocMovePopup()" style="font-size:11px">Move</button>
      <button class="btn btn-sm btn-r" onclick="locRemoveSelected()" style="font-size:11px">Remove</button>`;
  }else{
    bar.style.display='none';
  }
}
function locSelectAll(){
  const bags=getZoneBags(activeLocTab);
  Object.entries(bags).forEach(([bagId,d])=>selectedLocBags.set(bagId,{batchId:d.batchId,loc:d.loc}));
  renderLocBody();
}
function openLocMovePopup(){
  if(!selectedLocBags.size)return;
  const n=selectedLocBags.size;
  const fromLoc=activeLocTab;
  const m=document.getElementById('m-locmove');
  document.getElementById('lm-title').textContent=n+' bag'+(n!==1?'s':'');
  document.getElementById('lm-info').textContent='Currently in '+fromLoc;
  document.getElementById('lm-confirm').style.display='none';
  const grid=document.getElementById('lm-grid');
  grid.style.display='flex';
  grid.innerHTML='<div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.05em;width:100%;margin-bottom:2px">Zones</div>'
    +ZONES.filter(z=>z!==fromLoc).map(z=>`<button class="btn btn-sm" onclick="locPreConfirm('${z}')" style="font-size:12px;padding:8px 12px">${z}</button>`).join('')
    +'<div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.05em;width:100%;margin-top:8px;margin-bottom:2px">Racks</div>'
    +ALL_RACKS.filter(r=>r!==fromLoc).map(r=>`<button class="btn btn-sm" onclick="locPreConfirm('${r}')" style="font-size:11px;padding:6px 10px">${r.replace(/_/g,' ')}</button>`).join('');
  m.classList.add('open');
}
function locPreConfirm(toLoc){
  document.getElementById('lm-grid').style.display='none';
  const c=document.getElementById('lm-confirm');
  c.style.display='block';
  const n=selectedLocBags.size;
  const ids=[...selectedLocBags.keys()];
  const preview=ids.length<=6?ids.map(id=>id.split('-').pop()).join(', '):ids.slice(0,5).map(id=>id.split('-').pop()).join(', ')+' + '+(ids.length-5)+' more';
  c.innerHTML=`<div style="text-align:center;padding:12px 0">
    <div style="font-size:14px;margin-bottom:8px">Move <strong>${n} bag${n!==1?'s':''}</strong></div>
    <div style="font-size:11px;color:#888;margin-bottom:8px;font-family:monospace">${preview}</div>
    <div style="font-size:20px;margin-bottom:16px">${activeLocTab} → <strong>${toLoc}</strong></div>
    <div style="display:flex;gap:8px;justify-content:center">
      <button class="btn" onclick="openLocMovePopup()" style="min-width:100px">Cancel</button>
      <button class="btn btn-p" onclick="locMoveTo('${toLoc}')" style="min-width:100px">Confirm</button>
    </div>
  </div>`;
}
function renderLocBody(){
  const bags=getZoneBags(activeLocTab),entries=Object.entries(bags),el=document.getElementById('loc-body');
  if(!entries.length){selectedLocBags.clear();el.innerHTML='<div class="empty" style="font-size:12px">No bags in '+activeLocTab+'.</div><div id="loc-action-bar" style="display:none"></div>';return}
  const byBatch={};entries.forEach(([bagId,d])=>{if(!byBatch[d.batchId])byBatch[d.batchId]={sp:d.species,st:d.strain,bags:[]};byBatch[d.batchId].bags.push({id:bagId,loc:d.loc})});
  Object.values(byBatch).forEach(d=>d.bags.sort((a,b)=>{const na=parseInt(a.id.split('-').pop())||0,nb=parseInt(b.id.split('-').pop())||0;return na-nb}));
  const n=selectedLocBags.size;
  el.innerHTML=Object.entries(byBatch).map(([bid,d])=>`<div style="margin-bottom:12px">
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">${spDot(d.sp)}${esc(bid)} <span style="font-weight:400;color:#888">— ${esc(d.sp)}/${esc(d.st)}</span> <span style="font-size:11px;color:#aaa">(${d.bags.length})</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:5px">${d.bags.map(b=>{
      const sel=selectedLocBags.has(b.id);
      return`<span id="lb-${b.id.replace(/[^a-zA-Z0-9]/g,'_')}" data-bag="${esc(b.id)}" data-batch="${esc(bid)}" data-loc="${esc(b.loc)}" style="font-size:11px;font-family:monospace;padding:4px 8px;border-radius:6px;cursor:pointer;${sel?'background:#1a1a1a;color:#fff;border:1px solid #1a1a1a':'background:#fff;border:1px solid #e5e3dd;color:#333'}">
        ${esc(b.id.split('-').pop())}${b.loc!==activeLocTab?` <span style="font-size:9px;color:${sel?'#aaa':'#999'}">${esc(b.loc)}</span>`:''}
      </span>`;
    }).join('')}</div>
  </div>`).join('')
  +`<div id="loc-action-bar" style="${n>0?'display:flex':'display:none'};align-items:center;gap:8px;flex-wrap:wrap;background:#f9f8f5;border:1px solid #e5e3dd;border-radius:8px;padding:8px 12px;margin-top:8px">
    <span style="font-size:12px;font-weight:600">${n} bag${n!==1?'s':''} selected</span><span style="flex:1"></span>
    <button class="btn btn-sm" onclick="locSelectAll()" style="font-size:11px">Select all</button>
    <button class="btn btn-sm" onclick="selectedLocBags.clear();renderLocBody()" style="font-size:11px">Clear</button>
    <button class="btn btn-sm btn-p" onclick="openLocMovePopup()" style="font-size:11px">Move</button>
    <button class="btn btn-sm btn-r" onclick="locRemoveSelected()" style="font-size:11px">Remove</button>
  </div>`;
}
// Event delegation — no inline onclick, prevents scroll
document.getElementById('loc-body').addEventListener('click',function(e){
  const chip=e.target.closest('span[data-bag]');
  if(!chip)return;
  e.preventDefault();e.stopPropagation();
  toggleLocBag(chip.dataset.bag,chip.dataset.batch,chip.dataset.loc);
});
let lastLocUndoCount=0;
function locMoveTo(toLoc){
  if(!selectedLocBags.size)return;
  const now=new Date().toISOString();
  const n=selectedLocBags.size;
  selectedLocBags.forEach((d,bagId)=>{
    const entry={time:now,action:'MOVE',batch:d.batchId,bag:bagId,from:d.loc,to:toLoc,species:null,strain:null};scanLog.push(entry);    scan.count++;
  });
  lastLocUndoCount=n;
  selectedLocBags.clear();document.getElementById('m-locmove').classList.remove('open');
  saveData();updateSD();renderLocTabs();renderRacks();renderStatus();
  setLocFb('Moved '+n+' bag'+(n!==1?'s':'')+' → '+toLoc);
}
function locRemoveSelected(){
  if(!selectedLocBags.size)return;
  const n=selectedLocBags.size;
  if(!confirm('Remove '+n+' bag'+(n!==1?'s':'')+'?'))return;
  const now=new Date().toISOString();
  selectedLocBags.forEach((d,bagId)=>{
    const entry={time:now,action:'REMOVE',batch:d.batchId,bag:bagId,from:d.loc,to:null};scanLog.push(entry);    scan.count++;
  });
  lastLocUndoCount=n;
  selectedLocBags.clear();document.getElementById('m-locmove').classList.remove('open');
  saveData();updateSD();renderLocTabs();renderRacks();renderStatus();
  setLocFb('Removed '+n+' bag'+(n!==1?'s':''));
}
function setLocFb(msg){
  const el=document.getElementById('scan-toast');
  el.className='scan-toast fb-ok visible';
  el.innerHTML=msg+' <button onclick="locUndo()" style="margin-left:8px;font-size:11px;padding:2px 10px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;font-weight:600;pointer-events:auto">Undo</button>';
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.remove('visible'),5000);
}
function locUndo(){
  if(!lastLocUndoCount)return;
  scanLog.splice(scanLog.length-lastLocUndoCount,lastLocUndoCount);
  lastLocUndoCount=0;
  saveData();updateSD();renderLocTabs();renderRacks();renderStatus();
  setFb('ok','Undo successful');
}

// ─── BATCHES ─────────────────────────────────────────────────
function nbTypeChange(){
  const isGrain=document.getElementById('nb-type').value==='grain';
  // Toggle weight buttons
  document.getElementById('wbtn-3').style.display=isGrain?'none':'';
  document.getElementById('wbtn-5').style.display=isGrain?'none':'';
  document.getElementById('wbtn-07').style.display=isGrain?'':'none';
  document.getElementById('wbtn-1').style.display=isGrain?'':'none';
  document.getElementById('wbtn-2').style.display=isGrain?'':'none';
  document.getElementById('wbtn-5g').style.display=isGrain?'':'none';
  // Toggle substrate section (grain doesn't need it)
  document.querySelector('details').style.display=isGrain?'none':'';
  // Set default weight
  document.getElementById('nb-weight').value=isGrain?'1':'3';
  setBagWeight(isGrain?1:3);
  nbPreview();
}
function setBagWeight(kg){
  document.getElementById('nb-weight').value=kg;
  // Highlight the active button
  ['wbtn-3','wbtn-5','wbtn-07','wbtn-1','wbtn-2','wbtn-5g'].forEach(id=>{
    const btn=document.getElementById(id);
    if(!btn)return;
    const btnKg=parseFloat(btn.textContent);
    btn.className='btn btn-sm'+(btnKg===kg?' btn-p':'');
  });
  nbPreview();
}
function nbPreview(){
  const sp=document.getElementById('nb-sp').value.trim(),st=document.getElementById('nb-st').value.trim();
  const qty=parseInt(document.getElementById('nb-qty').value)||0;
  document.getElementById('nb-prev').textContent=(sp&&st)?genBatchId(sp)+' ('+qty+' bags)':'—';
  const isGrain=document.getElementById('nb-type').value==='grain';
  const bagKg=parseFloat(document.getElementById('nb-weight').value)||0;
  if(!qty||!bagKg){document.getElementById('nb-mat-preview').style.display='none';return}
  let lines=[];
  if(isGrain){
    const totalGrain=qty*bagKg;
    const avail=inventory.stock?.grain||0;
    const enough=avail>=totalGrain;
    lines.push(`<strong>Grain needed:</strong> ${totalGrain.toFixed(2)} kg (${qty} × ${bagKg} kg)`);
    lines.push(`In stock: ${avail.toFixed(2)} kg → ${enough?'✓ sufficient':'⚠ only enough for '+Math.floor(avail/bagKg)+' bags'}`);
  }else{
    const hw=parseFloat(document.getElementById('nb-hw').value)||0;
    const wb=parseFloat(document.getElementById('nb-wb').value)||0;
    const rh=parseFloat(document.getElementById('nb-rh').value)||0;
    const gyp=document.getElementById('nb-gyp').checked;
    if(hw||wb){
      // Correct calculation: subtract water first, then split dry matter
      // dryKg = bagKg × (1 - rh/100)
      const dryKg = rh>0 ? bagKg*(1-rh/100) : bagKg;
      const hwKg=qty*dryKg*(hw/100);
      const wbKg=qty*dryKg*(wb/100);
      const gypKg=gyp?qty*dryKg*0.01:0;
      const hwStock=inventory.stock?.hardwood||0;
      const wbStock=inventory.stock?.wheatbran||0;
      const gypStock=inventory.stock?.gypsum||0;
      if(rh>0) lines.push(`<strong>Bag:</strong> ${bagKg}kg total → ${dryKg.toFixed(3)}kg dry matter per bag (${rh}% water removed)`);
      if(hw) lines.push(`<strong>Hardwood (${hw}%):</strong> ${hwKg.toFixed(3)} kg needed — ${hwStock.toFixed(2)} kg in stock ${hwStock>=hwKg?'✓':'⚠ short by '+(hwKg-hwStock).toFixed(2)+'kg'}`);
      if(wb) lines.push(`<strong>Wheat bran (${wb}%):</strong> ${wbKg.toFixed(3)} kg needed — ${wbStock.toFixed(2)} kg in stock ${wbStock>=wbKg?'✓':'⚠ short by '+(wbKg-wbStock).toFixed(2)+'kg'}`);
      if(gyp) lines.push(`<strong>Gypsum (~1%):</strong> ${gypKg.toFixed(3)} kg needed — ${gypStock.toFixed(2)} kg in stock ${gypStock>=gypKg?'✓':'⚠'}`);
      lines.push(`<strong>Total dry matter per bag:</strong> ${dryKg.toFixed(3)} kg`);
    }
  }
  const el=document.getElementById('nb-mat-preview');
  if(lines.length){el.innerHTML=lines.join('<br>');el.style.display='block';}
  else el.style.display='none';
}
function nbSubSum(){const hw=parseFloat(document.getElementById('nb-hw').value)||0,wb=parseFloat(document.getElementById('nb-wb').value)||0,s=hw+wb;document.getElementById('nb-subsum').textContent=(hw||wb)?'Total: '+s+'%'+(s!==100?' — should add up to 100%':''):'';nbPreview()}
function createBatch(){
  const sp=document.getElementById('nb-sp').value.trim(),st=document.getElementById('nb-st').value.trim();
  const qty=parseInt(document.getElementById('nb-qty').value)||0,days=parseInt(document.getElementById('nb-days').value)||14;
  const isGrain=document.getElementById('nb-type').value==='grain';
  const bagKg=parseFloat(document.getElementById('nb-weight').value)||0;
  if(!sp||!st||qty<1){alert('Please fill in species, strain and quantity');return}
  if(!bagKg){alert('Please enter a bag weight');return}
  const hw=parseFloat(document.getElementById('nb-hw').value)||0,wb=parseFloat(document.getElementById('nb-wb').value)||0;
  const substrate=(!isGrain&&(hw||wb))?{hardwood:hw,wheatbran:wb,rh:parseFloat(document.getElementById('nb-rh').value)||null,gypsum:document.getElementById('nb-gyp').checked}:null;
  const batchId=genBatchId(sp);spColor(sp);
  const due=new Date();due.setDate(due.getDate()+days);
  const bags=Array.from({length:qty},(_,i)=>batchId+'-'+String(i+1).padStart(2,'0'));
  const batchType=isGrain?'grain':'block';
  batches.push({batchId,species:sp,strain:st,qty,days,substrate,bagKg,batchType,sourceId:document.getElementById('nb-culture').value||null,notes:document.getElementById('nb-notes').value.trim(),created:new Date().toISOString(),due:due.toISOString(),bags});

  // Auto-deduct materials from inventory
  if(!inventory.stock)inventory.stock={hardwood:0,wheatbran:0,gypsum:0,grain:0};
  const now=new Date().toISOString();
  if(isGrain){
    const grainUsed=qty*bagKg;
    inventory.stock.grain=Math.max(0,inventory.stock.grain-grainUsed);
    invLog('grain',-grainUsed,'batch',batchId,now);
  }else if(substrate){
    // Subtract water first: dry matter = bagKg × (1 - rh/100)
    const rh=parseFloat(document.getElementById('nb-rh').value)||0;
    const dryKgPerBag=rh>0?bagKg*(1-rh/100):bagKg;
    const hwUsed=qty*dryKgPerBag*(hw/100);
    const wbUsed=qty*dryKgPerBag*(wb/100);
    if(hwUsed>0){inventory.stock.hardwood=Math.max(0,inventory.stock.hardwood-hwUsed);invLog('hardwood',-hwUsed,'batch',batchId,now)}
    if(wbUsed>0){inventory.stock.wheatbran=Math.max(0,inventory.stock.wheatbran-wbUsed);invLog('wheatbran',-wbUsed,'batch',batchId,now)}
    if(substrate.gypsum){const gypUsed=qty*dryKgPerBag*0.01;inventory.stock.gypsum=Math.max(0,inventory.stock.gypsum-gypUsed);invLog('gypsum',-gypUsed,'batch',batchId,now)}
  }

  saveData();
  pushBatchCaldav(batches[batches.length-1]);
  document.getElementById('nb-bags').innerHTML=bags.map(b=>`<span style="font-size:10px;font-family:monospace;background:#f5f4f0;padding:2px 6px;border-radius:4px;color:#555">${b}</span>`).join('');
  document.getElementById('nb-result').style.display='block';
  document.getElementById('nb-sp').value='';document.getElementById('nb-st').value='';
  document.getElementById('nb-qty').value='10';document.getElementById('nb-days').value='14';
  document.getElementById('nb-notes').value='';document.getElementById('nb-mat-preview').style.display='none';
  nbPreview();updateTodoBadge();
}
function goToPrintBatch(){go('print','n-print');setTimeout(()=>{openStab('print','bags');fillBatchSelect();const s=document.getElementById('print-batch'),last=batches[batches.length-1];if(last){s.value=last.batchId;renderBagPreview()}},100)}
function renderBatches(){
  const q=(document.getElementById('batch-q').value||'').toLowerCase(),body=document.getElementById('batches-body');
  if(!batches.length){body.innerHTML='<tr><td colspan="12" class="empty">No batches yet.</td></tr>';return}
  body.innerHTML=batches.filter(b=>!q||b.batchId.toLowerCase().includes(q)||b.species.toLowerCase().includes(q)||b.strain.toLowerCase().includes(q)).map(b=>{
    const{status}=getStatus(b.batchId);
    const sub=b.substrate?[`<span class="sub-tag">HW ${b.substrate.hardwood}% WB ${b.substrate.wheatbran}%</span>`,b.substrate.rh?`<span class="sub-tag">RH ${b.substrate.rh}%</span>`:'',b.substrate.gypsum?`<span class="sub-tag" style="background:#f0fdf4;color:#166534">Gypsum</span>`:''].join(''):'<span style="color:#ccc;font-size:11px">—</span>';
    const src=b.sourceId?`<span style="font-family:monospace;font-size:10px;color:#6b21a8">${esc(b.sourceId)}</span>`:'<span style="color:#ccc;font-size:11px">—</span>';
    const note=b.notes?`<span style="font-size:11px;color:#555;cursor:pointer" onclick="openNote('${esc(b.batchId)}')">${esc(b.notes.length>22?b.notes.slice(0,22)+'…':b.notes)}</span>`:`<span style="font-size:11px;color:#bbb;cursor:pointer;font-style:italic" onclick="openNote('${esc(b.batchId)}')">Add note</span>`;
    return`<tr><td style="font-family:monospace;font-size:10px"><span onclick="toggleBatchBags('${esc(b.batchId)}')" style="cursor:pointer;user-select:none" id="btog-${esc(b.batchId)}">&#9654;</span> ${esc(b.batchId)}</td><td>${spDot(b.species)}${esc(b.species)}</td><td>${esc(b.strain)}</td><td>${b.qty}</td><td>${b.days}d</td><td>${sub}</td><td>${src}</td><td style="font-size:10px;color:#888">${new Date(b.created).toLocaleDateString('de-DE')}</td><td style="font-size:10px;color:#888">${new Date(b.due).toLocaleDateString('de-DE')}</td><td>${sbadge(status)}</td><td>${note}</td><td style="white-space:nowrap"><button class="btn btn-sm" onclick="openAddBags('${esc(b.batchId)}')" style="margin-right:3px">+Bags</button><button class="btn btn-sm btn-r" onclick="delBatch('${esc(b.batchId)}')">Del</button></td></tr>`;
  }).join('')||'<tr><td colspan="12" class="empty">No matches.</td></tr>';
}
const locColor={SPAWN:'#9b59b6',INC:'#3498db',TENT1:'#2ecc71',TENT2:'#2ecc71',TENT3:'#2ecc71',CONTAM:'#e74c3c'};
function toggleBatchBags(batchId){
  const existing=document.getElementById('brow-'+batchId);
  if(existing){existing.remove();document.getElementById('btog-'+batchId).innerHTML='&#9654;';return}
  const b=batches.find(x=>x.batchId===batchId);if(!b)return;
  document.getElementById('btog-'+batchId).innerHTML='&#9660;';
  const parentRow=document.getElementById('btog-'+batchId).closest('tr');
  const tr=document.createElement('tr');tr.id='brow-'+batchId;
  const td=document.createElement('td');td.colSpan=12;td.style.cssText='background:#f9f8f5;padding:8px 12px';
  td.innerHTML='<div style="display:flex;flex-wrap:wrap;gap:4px">'+b.bags.map(bag=>{
    const last=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===bag.toUpperCase());
    let loc='—',color='#aaa';
    if(last){
      if(last.action==='REMOVE'){loc='Removed';color='#999'}
      else if(last.to){loc=last.to;const z=toZone(last.to);color=locColor[z]||'#888'}
    }
    const num=bag.split('-').pop();
    return`<span style="font-size:10px;font-family:monospace;padding:3px 7px;border-radius:5px;background:#fff;border:1px solid #e5e3dd;display:inline-flex;align-items:center;gap:3px${last&&last.action==='REMOVE'?';text-decoration:line-through;opacity:.5':''}">
      ${num} <span style="font-size:9px;color:${color};font-weight:600">${loc}</span>
    </span>`;
  }).join('')+'</div>';
  tr.appendChild(td);parentRow.after(tr);
}
let addBagsBatchId=null;
function openAddBags(batchId){
  const b=batches.find(x=>x.batchId===batchId);
  if(!b)return;
  addBagsBatchId=batchId;
  document.getElementById('ab-info').textContent=batchId+' currently has '+b.bags.length+' bags ('+b.bags[b.bags.length-1]+' is last)';
  document.getElementById('ab-qty').value=1;
  document.getElementById('ab-preview').style.display='none';
  document.getElementById('m-addbags').classList.add('open');
  setTimeout(()=>document.getElementById('ab-qty').focus(),80);
}
function confirmAddBags(){
  const b=batches.find(x=>x.batchId===addBagsBatchId);
  if(!b)return;
  const qty=parseInt(document.getElementById('ab-qty').value)||0;
  if(qty<1){alert('Enter at least 1');return}
  const lastNum=parseInt(b.bags[b.bags.length-1].split('-').pop())||b.bags.length;
  const newBags=Array.from({length:qty},(_,i)=>b.batchId+'-'+String(lastNum+1+i).padStart(2,'0'));
  b.bags=[...b.bags,...newBags];
  b.qty=b.bags.length;
  saveData();
  document.getElementById('m-addbags').classList.remove('open');
  renderBatches();
  setFb('ok','Added '+qty+' bag'+(qty!==1?'s':'')+' to '+b.batchId+' (now '+b.bags.length+' total)');
}
document.getElementById('m-addbags').addEventListener('click',e=>{if(e.target.id==='m-addbags')document.getElementById('m-addbags').classList.remove('open')});

function delBatch(id){confirm2('Delete batch '+id+'?','Permanently deletes the batch record. Scan log and harvest entries remain.','Delete batch',()=>{batches=batches.filter(b=>b.batchId!==id);saveData();renderBatches();renderStatus()})}

// ─── HARVESTS ────────────────────────────────────────────────
function showHarvestPanel(bagId,batchId){
  const b=batches.find(x=>x.batchId===batchId);
  scan.harvestBag={bagId,batchId,species:b?.species,strain:b?.strain};
  document.getElementById('hp-lbl').textContent='Log harvest — '+bagId;
  document.getElementById('hp-bag').value=bagId;document.getElementById('hp-grams').value='';
  document.getElementById('harvest-panel').style.display='block';
  setTimeout(()=>document.getElementById('hp-grams').focus(),80);
  setFb('harvest','Bag scanned: '+bagId+' → enter grams above then press Enter');
}
function confirmHarvest(){
  const g=parseFloat(document.getElementById('hp-grams').value),f=parseInt(document.getElementById('hp-flush').value)||1;
  if(!g||g<=0){alert('Enter a weight in grams');return}
  const p=scan.harvestBag;
  harvests.push({time:new Date().toISOString(),batch:p.batchId,bag:p.bagId,species:p.species,strain:p.strain,grams:g,flush:f});
  saveData();scan.harvestBag=null;scan.count++;
  document.getElementById('harvest-panel').style.display='none';
  setFb('ok',`Harvest logged: ${p.bagId} → ${g}g (flush ${f})`);updateSD();
}
function cancelHarvest(){scan.harvestBag=null;document.getElementById('harvest-panel').style.display='none';setFb('info','Harvest cancelled.')}
document.getElementById('hp-grams').addEventListener('keydown',e=>{if(e.key==='Enter')confirmHarvest()});
function renderHarvests(){
  const q=(document.getElementById('harvest-q').value||'').toLowerCase(),body=document.getElementById('harvest-body');
  const items=[...harvests].reverse().filter(h=>!q||h.batch.toLowerCase().includes(q)||(h.species||'').toLowerCase().includes(q)).slice(0,MAX_LOG_DISPLAY);
  body.innerHTML=items.length?items.map(h=>`<tr><td style="font-size:10px;color:#aaa">${new Date(h.time).toLocaleString('de-DE')}</td><td style="font-family:monospace;font-size:10px">${esc(h.batch)||'—'}</td><td style="font-family:monospace;font-size:10px">${esc(h.bag)||'—'}</td><td>${h.species?spDot(h.species)+esc(h.species):'—'}</td><td>${esc(h.strain)||'—'}</td><td>${h.flush||1}</td><td style="font-weight:500;color:#92400e">${h.grams}g</td></tr>`).join(''):'<tr><td colspan="7" class="empty">No harvests yet. Scan HARVEST then a bag.</td></tr>';

  const byBatch={};
  harvests.forEach(h=>{if(!byBatch[h.batch])byBatch[h.batch]={total:0,flushes:{},species:h.species};byBatch[h.batch].total+=h.grams;byBatch[h.batch].flushes[h.flush]=(byBatch[h.batch].flushes[h.flush]||0)+h.grams});
  const ids=Object.keys(byBatch).sort((a,b)=>byBatch[b].total-byBatch[a].total);
  const tot=harvests.reduce((s,h)=>s+h.grams,0);
  document.getElementById('harvest-metrics').innerHTML=ids.length?[
    ['Total harvested',tot>=1000?(tot/1000).toFixed(1)+'kg':tot+'g'],
    ['Batches with yield',ids.length],
    ['Top batch',ids[0]?byBatch[ids[0]].total+'g':'—']
  ].map(([l,v])=>`<div class="met"><div class="met-l">${l}</div><div class="met-v" style="font-size:16px;color:#92400e">${v}</div></div>`).join(''):'';

  if(!ids.length){
    document.getElementById('harvest-totals').innerHTML='<div class="empty">No harvest data yet.</div>';
    return;
  }

  // Bar chart: yield per batch
  const batchYieldCanvas=document.getElementById('batch-yield-chart');
  if(batchYieldCanvas){
    if(batchYieldInst){batchYieldInst.destroy();batchYieldInst=null}
    batchYieldInst=new Chart(batchYieldCanvas,{
      type:'bar',
      data:{
        labels:ids.slice(0,12),
        datasets:[{label:'Grams',data:ids.slice(0,12).map(id=>byBatch[id].total),backgroundColor:ids.slice(0,12).map(id=>spColor(byBatch[id].species)),borderRadius:5,borderSkipped:false}]
      },
      options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'g'}}},scales:{y:{ticks:{callback:v=>v+'g'},grid:{color:'#f0ede8'}},x:{ticks:{font:{size:9}},grid:{display:false}}}}
    });
  }

  // Line chart: harvest over time by week
  const byWeek={};
  harvests.forEach(h=>{
    const d=new Date(h.time);
    const mon=new Date(d);mon.setDate(d.getDate()-d.getDay()+1);
    const key=mon.toISOString().slice(0,10);
    byWeek[key]=(byWeek[key]||0)+h.grams;
  });
  const weekKeys=Object.keys(byWeek).sort();
  const timelineCanvas=document.getElementById('harvest-timeline-chart');
  if(timelineCanvas){
    if(timelineInst){timelineInst.destroy();timelineInst=null}
    timelineInst=new Chart(timelineCanvas,{
      type:'line',
      data:{
        labels:weekKeys.map(k=>{const d=new Date(k);return d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})}),
        datasets:[{label:'g/week',data:weekKeys.map(k=>byWeek[k]),fill:true,borderColor:'#f39c12',backgroundColor:'rgba(243,156,18,.12)',tension:.4,pointRadius:3,pointBackgroundColor:'#f39c12'}]
      },
      options:{responsive:true,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'g'}}},scales:{y:{ticks:{callback:v=>v+'g'},grid:{color:'#f0ede8'}},x:{ticks:{font:{size:9},maxRotation:0},grid:{display:false}}}}
    });
  }

  // Per-batch totals with flush breakdown
  const max=byBatch[ids[0]].total;
  document.getElementById('harvest-totals').innerHTML=ids.map(id=>{
    const d=byBatch[id],pct=Math.round((d.total/max)*100);
    return`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px"><span style="font-size:12px;font-weight:500">${spDot(d.species)}${esc(id)}</span><span style="font-size:13px;font-weight:600;color:#92400e">${d.total}g</span></div><div class="harvest-bar"><div class="harvest-bar-fill" style="width:${pct}%"></div></div><div style="font-size:10px;color:#888;margin-top:2px">${Object.entries(d.flushes).map(([f,g])=>`Flush ${f}: ${g}g`).join(' · ')}</div></div>`;
  }).join('');
}

// ─── TO-DO ───────────────────────────────────────────────────
function buildAutoTasks(){
  const tasks=[],today=new Date();today.setHours(0,0,0,0);
  batches.forEach(b=>{
    const{status,action}=getStatus(b.batchId);if(status==='DONE'||status==='EMPTY')return;
    const due=new Date(b.due);due.setHours(0,0,0,0);
    const dl=Math.round((due-today)/(MS_PER_DAY));
    let urgent=false,warn=false,text='',detail='';
    if(status==='INCUBATING'||status==='SPAWN RUN'){
      if(dl<0){urgent=true;text=`${b.batchId} — ${action}`;detail=`Due ${Math.abs(dl)} day(s) ago`}
      else if(dl<=2){warn=true;text=`${b.batchId} — ${action}`;detail=`Due in ${dl} day(s)`}
      else{text=`${b.batchId} — ${action}`;detail=`Due in ${dl} days`}
    }else if(status==='FRUITING'){text=`${b.batchId} — Harvest / check`;detail=`${b.species}/${b.strain} fruiting`;warn=true}
    else if(status==='CONTAM'){text=`${b.batchId} — Discard bags`;detail=`${b.species}/${b.strain}`;urgent=true}
    if(text)tasks.push({text,detail,urgent,warn,species:b.species});
  });
  return tasks;
}
function renderTodo(){
  const filter=document.getElementById('todo-filter').value,tasks=buildAutoTasks();
  const shown=filter==='urgent'?tasks.filter(t=>t.urgent||t.warn):tasks;
  const urgent=tasks.filter(t=>t.urgent).length,warn=tasks.filter(t=>t.warn).length;
  document.getElementById('todo-metrics').innerHTML=[['Open tasks',tasks.length],['Urgent',urgent],['Coming up',warn]].map(([l,v])=>`<div class="met"><div class="met-l">${l}</div><div class="met-v" style="color:${l==='Urgent'&&v>0?'#b91c1c':l==='Coming up'&&v>0?'#92400e':'#1a1a1a'}">${v}</div></div>`).join('');
  document.getElementById('todo-auto').innerHTML=shown.length?shown.map(t=>`<div class="todo-row ${t.urgent?'urgent':t.warn?'warn':''}"><span class="pdot ${t.urgent?'high':t.warn?'med':'low'}"></span><div style="flex:1"><div style="font-size:13px;font-weight:500">${spDot(t.species)}${esc(t.text)}</div><div style="font-size:11px;color:#888;margin-top:1px">${esc(t.detail)}</div></div><button class="btn btn-sm" onclick="go('dash','n-dash')" style="font-size:11px">View</button></div>`).join(''):'<div class="empty">No tasks right now!</div>';
  renderManualTasks();updateTodoBadge();
}
function renderManualTasks(){
  const el=document.getElementById('todo-manual');
  if(!manualTasks.length){el.innerHTML='<div class="empty" style="padding:1rem">No manual tasks.</div>';return}
  el.innerHTML=manualTasks.map((t,i)=>{
    const assignTag=t.assignee?`<span class="tag tag-assignee">${esc(t.assignee)}</span>`:'<span class="tag tag-company">Alle</span>';
    const dueTag=t.dueDate?`<span class="tag tag-due">${new Date(t.dueDate).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})}</span>`:'';
    const privateTag=t.private?'<span class="tag" style="background:#fef3c7;color:#92400e;font-size:10px">privat</span>':'';
    const syncDot=caldav.enabled?(t.caldavSynced?'<span class="caldav-status synced" title="Synced"></span>':'<span class="caldav-status pending" title="Not synced"></span>'):'';
    const desc=t.description?`<div style="font-size:11px;color:#888;margin-top:2px">${esc(t.description)}</div>`:'';
    return`<div class="todo-row"><input type="checkbox" ${t.done?'checked':''} onchange="toggleTask(${i})" /><span class="pdot ${t.priority}"></span><div style="flex:1"><div style="font-size:13px;font-weight:500" class="${t.done?'done-text':''}">${esc(t.text)}${assignTag}${dueTag}${privateTag}${syncDot}</div>${desc}</div><button class="btn btn-sm btn-r" onclick="deleteTask(${i})">×</button></div>`;
  }).join('');
}
function addTask(){
  document.getElementById('task-form').style.display='block';
  fillAssigneeSelect();
  document.getElementById('task-text').focus();
}
function fillAssigneeSelect(){
  const sel=document.getElementById('task-assignee');
  sel.innerHTML='<option value="">Everyone (company)</option>'+teamMembers.map(m=>`<option value="${esc(m.name)}">${esc(m.name)}</option>`).join('');
}
function saveTask(){
  const text=document.getElementById('task-text').value.trim();if(!text)return;
  const assignee=document.getElementById('task-assignee').value;
  const dueDate=document.getElementById('task-due').value||null;
  const description=document.getElementById('task-desc').value.trim()||null;
  const priv=document.getElementById('task-private').checked;
  manualTasks.push({text,priority:document.getElementById('task-prio').value,done:false,created:new Date().toISOString(),assignee:assignee||null,dueDate,description,caldavUid:null,caldavSynced:null,private:priv});
  document.getElementById('task-text').value='';document.getElementById('task-desc').value='';document.getElementById('task-due').value='';document.getElementById('task-private').checked=false;
  document.getElementById('task-form').style.display='none';
  saveData();renderManualTasks();updateTodoBadge();
  if(caldav.enabled)pushTaskCaldav(manualTasks[manualTasks.length-1]);
}
function toggleTask(i){manualTasks[i].done=!manualTasks[i].done;manualTasks[i].caldavSynced=null;saveData();renderManualTasks();updateTodoBadge();if(caldav.enabled&&manualTasks[i].caldavUid)pushTaskCaldav(manualTasks[i])}
function deleteTask(i){confirm2('Delete task?','This task will be permanently removed.','Delete',()=>{manualTasks.splice(i,1);saveData();renderManualTasks();updateTodoBadge()})}
function updateTodoBadge(){const n=buildAutoTasks().filter(t=>t.urgent||t.warn).length+manualTasks.filter(t=>!t.done).length+getInvAlerts().length;document.getElementById('n-todo').classList.toggle('alert',n>0)}

// ─── TEAM MEMBERS ───────────────────────────────────────────
function renderTeam(){
  const el=document.getElementById('team-list');
  if(!teamMembers.length){el.innerHTML='<div class="empty" style="padding:1rem">No team members yet. Add your first member below.</div>';return}
  el.innerHTML=teamMembers.map((m,i)=>`<div class="member-row"><span class="name">${esc(m.name)}</span>${m.role?`<span style="font-size:11px;color:#888">${esc(m.role)}</span>`:''}<button class="btn btn-sm btn-r" onclick="removeMember(${i})">×</button></div>`).join('');
}
function addMember(){
  const name=document.getElementById('member-name').value.trim();if(!name)return;
  const role=document.getElementById('member-role').value.trim();
  if(teamMembers.some(m=>m.name.toLowerCase()===name.toLowerCase()))return;
  teamMembers.push({name,role:role||null,added:new Date().toISOString()});
  document.getElementById('member-name').value='';document.getElementById('member-role').value='';
  saveData();renderTeam();
}
function removeMember(i){confirm2('Remove member?','Remove '+teamMembers[i].name+' from the team. Their existing task assignments remain.','Remove',()=>{teamMembers.splice(i,1);saveData();renderTeam()})}

// ─── CalDAV SYNC ────────────────────────────────────────────
function loadCaldavSettings(){
  // Show the CalDAV URL for this server
  const port=location.port?':'+location.port:'';
  const url=location.protocol+'//'+location.hostname+port+'/caldav/calendars/';
  document.getElementById('caldav-url-display').textContent=url;
  document.getElementById('caldav-enabled').checked=!!caldav.enabled;
}
function saveCaldavSettings(){
  caldav.enabled=document.getElementById('caldav-enabled').checked;
  saveData();
  showCaldavStatus('Einstellungen gespeichert.','#166534');
}
function showCaldavStatus(msg,color){
  const el=document.getElementById('caldav-status');
  el.style.display='block';el.style.color=color||'#888';el.textContent=msg;
  setTimeout(()=>{el.style.display='none'},8000);
}
async function syncCaldavNow(){
  if(!caldav.enabled){showCaldavStatus('Enable sync first, then save settings.','#92400e');return}
  const btn=document.getElementById('caldav-sync-btn');btn.disabled=true;btn.textContent='Syncing...';
  showCaldavStatus('Writing tasks to calendar files...','#888');
  try{
    const r=await authFetch('/api/caldav/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caldav,teamMembers,manualTasks,batches,calendarEvents})}).then(r=>r.json());
    if(r.error){showCaldavStatus('Sync failed: '+r.error,'#b91c1c')}
    else{
      showCaldavStatus(`Done! ${r.pushed} tasks written to calendar.${r.errors?' ('+r.errors+' errors)':''}  Calendar clients can now see them via CalDAV.`, r.errors?'#92400e':'#166534');
      await loadData();renderManualTasks();
    }
  }catch(e){showCaldavStatus('Sync error: '+e.message,'#b91c1c')}
  finally{btn.disabled=false;btn.textContent='Sync all tasks now'}
}
async function pushTaskCaldav(task){
  if(!caldav.enabled)return;
  try{
    const r=await authFetch('/api/caldav/push-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task})}).then(r=>r.json());
    if(r.ok&&r.uid){task.caldavUid=r.uid;task.caldavSynced=new Date().toISOString();saveData();renderManualTasks()}
  }catch(e){console.error('CalDAV push error:',e)}
}

async function pushBatchCaldav(batch){
  if(!caldav.enabled)return;
  try{
    await authFetch('/api/caldav/push-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({batch})});
  }catch(e){console.error('CalDAV batch push error:',e)}
}

// ─── CALENDAR ───────────────────────────────────────────────
let calYear=new Date().getFullYear(),calMonth=new Date().getMonth(),calView='month';
let calSelectedDate=new Date(),caldavImports=[];
const CAL_DAYS=['Mo','Di','Mi','Do','Fr','Sa','So'];
const CAL_MONTHS=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const CAL_HOURS_START=6,CAL_HOURS_END=22;

function fmtDate(y,m,d){return y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
function parseDateStr(s){const p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2])}

function collectCalendarEvents(){
  const events=[];
  batches.forEach(b=>{
    if(!b.due)return;
    const d=new Date(b.due);
    events.push({date:d.toISOString().split('T')[0],label:b.batchId+' — '+b.species+(b.strain?' ('+b.strain+')':''),type:'batch-due',id:b.batchId,draggable:true,allDay:true,color:'#e74c3c'});
  });
  manualTasks.forEach(t=>{
    if(!t.dueDate)return;
    events.push({date:t.dueDate.split('T')[0],label:t.text,type:'task-due',id:t.created,draggable:!t.done,allDay:true,color:'#3498db'});
  });
  harvests.forEach(h=>{
    if(!h.time)return;
    const d=new Date(h.time);
    events.push({date:d.toISOString().split('T')[0],label:(h.batch||'?')+' '+h.grams+'g',type:'harvest',id:null,draggable:false,allDay:true,color:'#f39c12'});
  });
  calendarEvents.forEach(ev=>{
    events.push({date:ev.startDate,label:ev.title,type:'custom',id:ev.id,draggable:true,allDay:ev.allDay,startTime:ev.startTime,endTime:ev.endTime,color:ev.color||'#2ecc71',description:ev.description});
  });
  caldavImports.forEach(ev=>{
    events.push({date:ev.date,label:ev.summary,type:'caldav-import',id:ev.uid,draggable:false,allDay:ev.allDay!==false,startTime:ev.startTime,endTime:ev.endTime,color:'#9b59b6'});
  });
  return events;
}

function renderCalendar(){
  const title=document.getElementById('cal-title');
  if(!title)return;
  document.querySelectorAll('.cal-vbtn').forEach(b=>b.classList.remove('active'));
  const btn=document.getElementById('cv-'+calView);if(btn)btn.classList.add('active');
  if(calView==='month')renderCalMonth();
  else if(calView==='week')renderCalWeek();
  else if(calView==='day')renderCalDay();
}

function setCalView(v){calView=v;renderCalendar()}
function calToday(){calYear=new Date().getFullYear();calMonth=new Date().getMonth();calSelectedDate=new Date();renderCalendar()}

function calNav(delta){
  if(calView==='month'){calMonth+=delta;if(calMonth<0){calMonth=11;calYear--}if(calMonth>11){calMonth=0;calYear++}}
  else if(calView==='week'){calSelectedDate.setDate(calSelectedDate.getDate()+delta*7);calYear=calSelectedDate.getFullYear();calMonth=calSelectedDate.getMonth()}
  else if(calView==='day'){calSelectedDate.setDate(calSelectedDate.getDate()+delta);calYear=calSelectedDate.getFullYear();calMonth=calSelectedDate.getMonth()}
  renderCalendar();
}

// ── Month View ──
function renderCalMonth(){
  const container=document.getElementById('cal-container');
  const title=document.getElementById('cal-title');
  title.textContent=CAL_MONTHS[calMonth]+' '+calYear;

  const firstDay=new Date(calYear,calMonth,1);
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  let startDow=(firstDay.getDay()+6)%7;
  const prevLast=new Date(calYear,calMonth,0).getDate();
  const events=collectCalendarEvents();
  const todayStr=new Date().toISOString().split('T')[0];

  // Always show 6 rows for consistent height
  const totalCells=startDow+daysInMonth;
  const rows=Math.max(6,Math.ceil(totalCells/7));
  const trailing=rows*7-totalCells;

  let html='<div class="cal-grid" id="cal-grid">';
  html+=CAL_DAYS.map(d=>'<div class="cal-hdr">'+d+'</div>').join('');

  function eventsForDate(ds){
    const de=events.filter(e=>e.date===ds);
    const mx=3;
    let o=de.slice(0,mx).map(e=>{
      const drag=e.draggable?'draggable="true"':'';
      const cls=e.draggable?'cal-event':'cal-event no-drag';
      const bg=e.color?'style="background:'+e.color+'"':'';
      return'<div class="'+cls+'" '+drag+' data-type="'+e.type+'" data-id="'+(e.id||'')+'" title="'+esc(e.label)+'" '+bg+'>'+esc(e.label)+'</div>';
    }).join('');
    if(de.length>mx)o+='<div class="cal-more">+'+(de.length-mx)+' mehr</div>';
    return o;
  }

  for(let i=startDow-1;i>=0;i--){
    const day=prevLast-i,m=calMonth===0?11:calMonth-1,y=calMonth===0?calYear-1:calYear,ds=fmtDate(y,m,day);
    html+='<div class="cal-cell other" data-date="'+ds+'" onclick="calCellClick(event,\''+ds+'\')"><div class="cal-day" onclick="event.stopPropagation();calGotoDay(\''+ds+'\')">'+day+'</div>'+eventsForDate(ds)+'</div>';
  }
  for(let d=1;d<=daysInMonth;d++){
    const ds=fmtDate(calYear,calMonth,d),cls=ds===todayStr?'cal-cell today':'cal-cell';
    html+='<div class="'+cls+'" data-date="'+ds+'" onclick="calCellClick(event,\''+ds+'\')"><div class="cal-day" onclick="event.stopPropagation();calGotoDay(\''+ds+'\')">'+d+'</div>'+eventsForDate(ds)+'</div>';
  }
  for(let d=1;d<=trailing;d++){
    const m=calMonth===11?0:calMonth+1,y=calMonth===11?calYear+1:calYear,ds=fmtDate(y,m,d);
    html+='<div class="cal-cell other" data-date="'+ds+'" onclick="calCellClick(event,\''+ds+'\')"><div class="cal-day" onclick="event.stopPropagation();calGotoDay(\''+ds+'\')">'+d+'</div>'+eventsForDate(ds)+'</div>';
  }
  html+='</div>';
  container.innerHTML=html;
  initCalDragDrop(container);
}
function calCellClick(e,ds){if(e.target.closest('.cal-event')||e.target.closest('.cal-more'))return;openEventModal(ds)}

function calGotoDay(ds){calSelectedDate=parseDateStr(ds);calYear=calSelectedDate.getFullYear();calMonth=calSelectedDate.getMonth();setCalView('day')}

// ── Week View ──
function getWeekStart(d){const dt=new Date(d);const dow=(dt.getDay()+6)%7;dt.setDate(dt.getDate()-dow);dt.setHours(0,0,0,0);return dt}

function renderCalWeek(){
  const container=document.getElementById('cal-container');
  const title=document.getElementById('cal-title');
  const ws=getWeekStart(calSelectedDate);
  const days=[];
  for(let i=0;i<7;i++){const d=new Date(ws);d.setDate(ws.getDate()+i);days.push(d)}
  const todayStr=new Date().toISOString().split('T')[0];
  title.textContent=days[0].getDate()+'. '+(days[0].getMonth()!==days[6].getMonth()?CAL_MONTHS[days[0].getMonth()]+' — '+days[6].getDate()+'. '+CAL_MONTHS[days[6].getMonth()]:' — '+days[6].getDate()+'. '+CAL_MONTHS[days[0].getMonth()])+' '+days[6].getFullYear();

  const events=collectCalendarEvents();
  const dayStrs=days.map(d=>d.toISOString().split('T')[0]);

  let html='<div class="cal-week">';
  // Header with day name + large day number
  html+='<div class="cal-week-hdr"><div class="cal-week-hdr-cell"></div>';
  days.forEach((d,i)=>{const ds=dayStrs[i];html+='<div class="cal-week-hdr-cell'+(ds===todayStr?' today-col':'')+'" onclick="calGotoDay(\''+ds+'\')">'+CAL_DAYS[i]+'<span class="wk-day-num">'+d.getDate()+'</span></div>'});
  html+='</div>';
  // All-day row
  html+='<div class="cal-week-allday"><div class="cal-week-allday-label">Ganzt.</div>';
  days.forEach((d,i)=>{
    const ds=dayStrs[i];
    const de=events.filter(e=>e.date===ds&&e.allDay);
    html+='<div class="cal-week-allday-cell" data-date="'+ds+'">';
    de.forEach(e=>{
      const cls=e.draggable?'cal-event':'cal-event no-drag';
      const bg=e.color?'style="background:'+e.color+'"':'';
      html+='<div class="'+cls+'" '+(e.draggable?'draggable="true"':'')+' data-type="'+e.type+'" data-id="'+(e.id||'')+'" title="'+esc(e.label)+'" '+bg+'>'+esc(e.label)+'</div>';
    });
    html+='</div>';
  });
  html+='</div>';
  // Time grid
  html+='<div class="cal-week-body">';
  for(let h=CAL_HOURS_START;h<=CAL_HOURS_END;h++){
    html+='<div class="cal-week-time">'+String(h).padStart(2,'0')+':00</div>';
    days.forEach((d,i)=>{
      const ds=dayStrs[i];
      html+='<div class="cal-week-slot'+(ds===todayStr?' today-col':'')+'" data-date="'+ds+'" data-hour="'+h+'" onclick="openEventModal(\''+ds+'\',\''+String(h).padStart(2,'0')+':00\')"></div>';
    });
  }
  html+='</div></div>';
  container.innerHTML=html;

  // Render timed events as absolutely positioned blocks
  const body=container.querySelector('.cal-week-body');
  if(body){
    days.forEach((d,i)=>{
      const ds=dayStrs[i];
      const timed=events.filter(e=>e.date===ds&&!e.allDay&&e.startTime);
      timed.forEach(e=>{
        const[sh,sm]=(e.startTime||'09:00').split(':').map(Number);
        const[eh,em]=(e.endTime||String(sh+1).padStart(2,'0')+':00').split(':').map(Number);
        const top=((sh-CAL_HOURS_START)*48)+(sm/60*48);
        const height=Math.max(24,((eh-sh)*48)+((em-sm)/60*48));
        const col=i+2;
        const el=document.createElement('div');
        el.className='cal-week-ev';
        el.style.cssText='top:'+top+'px;height:'+height+'px;background:'+(e.color||'#2ecc71')+';grid-column:'+col;
        el.textContent=e.label;
        el.title=e.label;
        el.dataset.type=e.type;el.dataset.id=e.id||'';
        el.onclick=function(){onCalEventClick(e)};
        body.appendChild(el);
      });
    });
    // Current time indicator
    const now=new Date();const nowDs=now.toISOString().split('T')[0];
    const todayIdx=dayStrs.indexOf(nowDs);
    if(todayIdx>=0){
      const nowH=now.getHours(),nowM=now.getMinutes();
      if(nowH>=CAL_HOURS_START&&nowH<=CAL_HOURS_END){
        const top=((nowH-CAL_HOURS_START)*48)+(nowM/60*48);
        const line=document.createElement('div');
        line.className='cal-week-now-line';
        line.style.top=top+'px';
        body.appendChild(line);
        // Scroll to current time
        body.scrollTop=Math.max(0,top-150);
      }
    }
  }
  initCalDragDrop(container);
}

// ── Day View ──
function renderCalDay(){
  const container=document.getElementById('cal-container');
  const title=document.getElementById('cal-title');
  const d=calSelectedDate;
  const ds=d.toISOString().split('T')[0];
  const dayName=CAL_DAYS[(d.getDay()+6)%7];
  title.textContent=dayName+', '+d.getDate()+'. '+CAL_MONTHS[d.getMonth()]+' '+d.getFullYear();

  const events=collectCalendarEvents();
  const dayEvents=events.filter(e=>e.date===ds);
  const allDay=dayEvents.filter(e=>e.allDay);
  const timed=dayEvents.filter(e=>!e.allDay&&e.startTime);

  let html='<div class="cal-day-view">';
  // All-day section
  html+='<div class="cal-day-allday"><div class="sec">Ganztägig</div>';
  if(allDay.length){
    allDay.forEach(e=>{
      const cls=e.draggable?'cal-event':'cal-event no-drag';
      const bg=e.color?'style="background:'+e.color+'"':'';
      html+='<div class="'+cls+'" '+(e.draggable?'draggable="true"':'')+' data-type="'+e.type+'" data-id="'+(e.id||'')+'" title="'+esc(e.label)+'" '+bg+'>'+esc(e.label)+'</div>';
    });
  }else{html+='<div class="cal-day-allday-empty">Keine ganztägigen Events</div>'}
  html+='</div>';
  // Time slots
  html+='<div class="cal-day-body">';
  for(let h=CAL_HOURS_START;h<=CAL_HOURS_END;h++){
    html+='<div class="cal-day-time">'+String(h).padStart(2,'0')+':00</div>';
    html+='<div class="cal-day-slot" data-date="'+ds+'" data-hour="'+h+'" onclick="openEventModal(\''+ds+'\',\''+String(h).padStart(2,'0')+':00\')"></div>';
  }
  html+='</div></div>';
  container.innerHTML=html;

  // Place timed events
  const body=container.querySelector('.cal-day-body');
  if(body){
    timed.forEach(e=>{
      const[sh,sm]=(e.startTime||'09:00').split(':').map(Number);
      const[eh,em]=(e.endTime||String(sh+1).padStart(2,'0')+':00').split(':').map(Number);
      const top=((sh-CAL_HOURS_START)*48)+(sm/60*48);
      const height=Math.max(24,((eh-sh)*48)+((em-sm)/60*48));
      const el=document.createElement('div');
      el.className='cal-day-ev';
      el.style.cssText='top:'+top+'px;height:'+height+'px;background:'+(e.color||'#2ecc71');
      el.innerHTML='<strong>'+esc(e.label)+'</strong>'+(e.startTime?' <span style="opacity:.8">'+e.startTime+(e.endTime?' — '+e.endTime:'')+'</span>':'');
      el.title=e.label;
      el.dataset.type=e.type;el.dataset.id=e.id||'';
      el.onclick=function(){onCalEventClick(e)};
      body.appendChild(el);
    });
    // Current time indicator
    const now=new Date();const nowDs=now.toISOString().split('T')[0];
    if(ds===nowDs){
      const nowH=now.getHours(),nowM=now.getMinutes();
      if(nowH>=CAL_HOURS_START&&nowH<=CAL_HOURS_END){
        const top=((nowH-CAL_HOURS_START)*48)+(nowM/60*48);
        const line=document.createElement('div');
        line.className='cal-day-now-line';
        line.style.top=top+'px';
        body.appendChild(line);
        body.scrollTop=Math.max(0,top-150);
      }
    }
  }
  initCalDragDrop(container);
}

// ── Drag-and-Drop ──
function initCalDragDrop(root){
  if(!root)return;
  root.ondragstart=function(e){
    const ev=e.target.closest('.cal-event');
    if(!ev||ev.classList.contains('no-drag')){e.preventDefault();return}
    e.dataTransfer.setData('text/plain',ev.dataset.type+'|'+ev.dataset.id);
    e.dataTransfer.effectAllowed='move';
    ev.style.opacity='0.4';
  };
  root.ondragend=function(e){
    const ev=e.target.closest('.cal-event');
    if(ev)ev.style.opacity='1';
    root.querySelectorAll('.drag-over').forEach(c=>c.classList.remove('drag-over'));
  };
  root.ondragover=function(e){
    const cell=e.target.closest('[data-date]');
    if(!cell)return;
    e.preventDefault();e.dataTransfer.dropEffect='move';
    root.querySelectorAll('.drag-over').forEach(c=>c.classList.remove('drag-over'));
    cell.classList.add('drag-over');
  };
  root.ondragleave=function(e){
    const cell=e.target.closest('[data-date]');
    if(cell)cell.classList.remove('drag-over');
  };
  root.ondrop=function(e){
    e.preventDefault();
    root.querySelectorAll('.drag-over').forEach(c=>c.classList.remove('drag-over'));
    const cell=e.target.closest('[data-date]');
    if(!cell||!cell.dataset.date)return;
    const data=e.dataTransfer.getData('text/plain');if(!data)return;
    const[type,id]=data.split('|');
    handleCalendarDrop(type,id,cell.dataset.date);
  };
}

function handleCalendarDrop(type,id,newDateStr){
  if(type==='batch-due'){
    const b=batches.find(x=>x.batchId===id);if(!b)return;
    const newDue=new Date(newDateStr+'T12:00:00');
    b.due=newDue.toISOString();
    const created=new Date(b.created);
    b.days=Math.max(1,Math.round((newDue-created)/MS_PER_DAY));
    saveData();renderCalendar();
    pushBatchCaldav(b);
    if(document.querySelector('#p-dash.active'))renderStatus();
  }else if(type==='task-due'){
    const t=manualTasks.find(x=>x.created===id);if(!t)return;
    t.dueDate=newDateStr;t.caldavSynced=null;
    saveData();renderCalendar();renderManualTasks();
    if(caldav.enabled&&t.caldavUid)pushTaskCaldav(t);
  }else if(type==='custom'){
    const ev=calendarEvents.find(x=>x.id===id);if(!ev)return;
    ev.startDate=newDateStr;ev.caldavSynced=null;
    saveData();renderCalendar();
    pushEventCaldav(ev);
  }
}

// ── Event Click ──
function onCalEventClick(ev){
  if(ev.type==='custom'){
    const ce=calendarEvents.find(x=>x.id===ev.id);
    if(ce)openEventModal(ce.startDate,ce.startTime,ce);
  }else if(ev.type==='batch-due'||ev.type==='task-due'){
    openEventMoveModal(ev);
  }
}

function openEventMoveModal(ev){
  document.getElementById('cal-ev-title').textContent='Event verschieben';
  document.getElementById('cal-ev-id').value='';
  document.getElementById('cal-ev-mode').value='move';
  document.getElementById('cal-ev-name').value=ev.label;
  document.getElementById('cal-ev-name').disabled=true;
  document.getElementById('cal-ev-date').value=ev.date;
  document.getElementById('cal-ev-end-date').value='';
  document.getElementById('cal-ev-allday').checked=true;
  document.getElementById('cal-ev-times').style.display='none';
  document.getElementById('cal-ev-category').closest('.g2').style.display='none';
  document.getElementById('cal-ev-desc').closest('div').style.display='none';
  document.getElementById('cal-ev-del-btn').style.display='none';
  document.getElementById('cal-ev-id').dataset.moveType=ev.type;
  document.getElementById('cal-ev-id').dataset.moveId=ev.id;
  document.getElementById('m-cal-event').classList.add('open');
}

// ── Event CRUD Modal ──
function openEventModal(date,time,existing){
  const modal=document.getElementById('m-cal-event');
  document.getElementById('cal-ev-name').disabled=false;
  document.getElementById('cal-ev-category').closest('.g2').style.display='';
  document.getElementById('cal-ev-desc').closest('div').style.display='';
  if(existing){
    document.getElementById('cal-ev-title').textContent='Event bearbeiten';
    document.getElementById('cal-ev-mode').value='edit';
    document.getElementById('cal-ev-id').value=existing.id;
    document.getElementById('cal-ev-name').value=existing.title;
    document.getElementById('cal-ev-date').value=existing.startDate;
    document.getElementById('cal-ev-end-date').value=existing.endDate||'';
    document.getElementById('cal-ev-allday').checked=existing.allDay;
    document.getElementById('cal-ev-start-time').value=existing.startTime||'09:00';
    document.getElementById('cal-ev-end-time').value=existing.endTime||'10:00';
    document.getElementById('cal-ev-category').value=existing.category||'custom';
    document.getElementById('cal-ev-color').value=existing.color||'#2ecc71';
    document.getElementById('cal-ev-desc').value=existing.description||'';
    document.getElementById('cal-ev-del-btn').style.display='';
  }else{
    document.getElementById('cal-ev-title').textContent='Neues Event';
    document.getElementById('cal-ev-mode').value='create';
    document.getElementById('cal-ev-id').value='';
    document.getElementById('cal-ev-name').value='';
    document.getElementById('cal-ev-date').value=date||new Date().toISOString().split('T')[0];
    document.getElementById('cal-ev-end-date').value='';
    document.getElementById('cal-ev-allday').checked=!time;
    document.getElementById('cal-ev-start-time').value=time||'09:00';
    const endH=time?String(Math.min(23,parseInt(time)+1)).padStart(2,'0')+':00':'10:00';
    document.getElementById('cal-ev-end-time').value=endH;
    document.getElementById('cal-ev-category').value='custom';
    document.getElementById('cal-ev-color').value='#2ecc71';
    document.getElementById('cal-ev-desc').value='';
    document.getElementById('cal-ev-del-btn').style.display='none';
  }
  toggleCalTimeInputs();
  modal.classList.add('open');
  if(!existing)document.getElementById('cal-ev-name').focus();
}
function closeEventModal(){
  document.getElementById('m-cal-event').classList.remove('open');
  document.getElementById('cal-ev-id').dataset.moveType='';
  document.getElementById('cal-ev-id').dataset.moveId='';
}
function toggleCalTimeInputs(){
  document.getElementById('cal-ev-times').style.display=document.getElementById('cal-ev-allday').checked?'none':'grid';
}

function saveCalEvent(){
  const mode=document.getElementById('cal-ev-mode').value;
  // Handle move mode for batch-due / task-due
  if(mode==='move'){
    const moveType=document.getElementById('cal-ev-id').dataset.moveType;
    const moveId=document.getElementById('cal-ev-id').dataset.moveId;
    const newDate=document.getElementById('cal-ev-date').value;
    if(newDate&&moveType)handleCalendarDrop(moveType,moveId,newDate);
    closeEventModal();return;
  }
  const name=document.getElementById('cal-ev-name').value.trim();if(!name)return;
  const allDay=document.getElementById('cal-ev-allday').checked;
  const ev={
    id:mode==='edit'?document.getElementById('cal-ev-id').value:('cev-'+Date.now()+'-'+Math.random().toString(36).slice(2,6)),
    title:name,
    description:document.getElementById('cal-ev-desc').value.trim()||null,
    startDate:document.getElementById('cal-ev-date').value,
    endDate:document.getElementById('cal-ev-end-date').value||null,
    allDay:allDay,
    startTime:allDay?null:document.getElementById('cal-ev-start-time').value,
    endTime:allDay?null:document.getElementById('cal-ev-end-time').value,
    category:document.getElementById('cal-ev-category').value,
    color:document.getElementById('cal-ev-color').value,
    caldavUid:null,caldavSynced:null,
    created:new Date().toISOString()
  };
  if(mode==='edit'){
    const idx=calendarEvents.findIndex(x=>x.id===ev.id);
    if(idx>=0){ev.caldavUid=calendarEvents[idx].caldavUid;ev.created=calendarEvents[idx].created;calendarEvents[idx]=ev}
  }else{calendarEvents.push(ev)}
  saveData();renderCalendar();closeEventModal();
  if(caldav.enabled)pushEventCaldav(ev);
}

function deleteCalEvent(){
  const id=document.getElementById('cal-ev-id').value;if(!id)return;
  confirm2('Event löschen?','Dieses Event wird unwiderruflich gelöscht.','Löschen',()=>{
    calendarEvents=calendarEvents.filter(x=>x.id!==id);
    saveData();renderCalendar();closeEventModal();
  });
}

async function pushEventCaldav(ev){
  if(!caldav.enabled)return;
  try{
    const r=await authFetch('/api/caldav/push-event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:ev})}).then(r=>r.json());
    if(r.ok&&r.uid){ev.caldavUid=r.uid;ev.caldavSynced=new Date().toISOString();saveData()}
  }catch(e){console.error('CalDAV event push error:',e)}
}

// ── CalDAV Import ──
async function loadCalDAVImports(){
  try{
    const r=await authFetch('/api/caldav/import');
    if(r.ok)caldavImports=await r.json();
  }catch(e){caldavImports=[];}
}

// ─── SCAN LOG ────────────────────────────────────────────────
function renderLog(){const q=(document.getElementById('log-q').value||'').toLowerCase(),body=document.getElementById('log-body');const items=[...scanLog].reverse().filter(e=>!q||JSON.stringify(e).toLowerCase().includes(q)).slice(0,MAX_LOG_DISPLAY);body.innerHTML=items.length?items.map(e=>`<tr><td style="font-size:10px;color:#aaa">${new Date(e.time).toLocaleString('de-DE')}</td><td><span class="badge ${e.action==='ADD'?'b-add':e.action==='REMOVE'?'b-remove':e.action==='HARVEST'?'b-harvest':'b-move'}">${esc(e.action)}</span></td><td style="font-family:monospace;font-size:10px">${esc(e.batch)||'—'}</td><td style="font-family:monospace;font-size:10px">${esc(e.bag)||'—'}</td><td>${esc(e.from)||'—'}</td><td>${esc(e.to)||'—'}</td><td>${e.species?spDot(e.species)+esc(e.species):'—'}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">No scans yet.</td></tr>'}
function clearLog(){confirm2('Clear entire scan log?','Permanently deletes all '+scanLog.length+' scan entries. Batches and harvests are not deleted.','Yes, clear everything',()=>{scanLog=[];saveData();renderLog()})}

// ─── INVENTORY ───────────────────────────────────────────────
const MAT_LABELS={hardwood:'Hardwood pellets',wheatbran:'Wheat bran',gypsum:'Gypsum',grain:'Grain'};
const MAT_COLORS={hardwood:'#92400e',wheatbran:'#166534',gypsum:'#1e40af',grain:'#6b21a8'};
const MAT_BG={hardwood:'#fff7ed',wheatbran:'#f0fdf4',gypsum:'#eff6ff',grain:'#faf5ff'};
const MAT_BORDER={hardwood:'#fed7aa',wheatbran:'#bbf7d0',gypsum:'#bfdbfe',grain:'#e9d5ff'};

function invLog(mat,deltaKg,type,ref,time){
  if(!inventory.log)inventory.log=[];
  const running=inventory.stock[mat]||0;
  inventory.log.push({time:time||new Date().toISOString(),mat,deltaKg,running,type,ref});
}

function getAvgComp(){
  // Returns the average composition settings, with fallback defaults
  const a=inventory.avgComposition||{};
  return{
    hwPct:a.hwPct??75,
    wbPct:a.wbPct??25,
    rhPct:a.rhPct??63,
    bagKg:a.bagKg??3,
    grainBagKg:a.grainBagKg??1
  };
}

function estBagsFromMat(mat,stockKg){
  // Estimate how many fruiting blocks (or grain bags) can be made from this material
  // For HW/WB: dry matter per bag = bagKg × (1 − rh/100), split by avg %
  // For grain: simply stockKg / grainBagKg
  const c=getAvgComp();
  if(mat==='grain'){
    return{bags:c.grainBagKg>0?Math.floor(stockKg/c.grainBagKg):0,bagKg:c.grainBagKg,isGrain:true};
  }
  const dryPerBag=c.bagKg*(1-c.rhPct/100);  // dry matter per bag
  let matPerBag=0;
  if(mat==='hardwood') matPerBag=dryPerBag*(c.hwPct/100);
  if(mat==='wheatbran') matPerBag=dryPerBag*(c.wbPct/100);
  if(mat==='gypsum') matPerBag=dryPerBag*0.01;
  const bags=matPerBag>0?Math.floor(stockKg/matPerBag):0;
  return{bags,matPerBag,bagKg:c.bagKg,isGrain:false};
}

function renderInvStock(){
  if(!inventory.stock)inventory.stock={hardwood:0,wheatbran:0,gypsum:0,grain:0};
  if(!inventory.thresholds)inventory.thresholds={hardwood:{minKg:50},wheatbran:{minKg:20},gypsum:{minKg:5},grain:{minKg:10}};
  if(!inventory.avgComposition)inventory.avgComposition={hwPct:75,wbPct:25,rhPct:63,bagKg:3,grainBagKg:1};

  const cards=document.getElementById('inv-cards');
  cards.innerHTML=Object.keys(MAT_LABELS).map(mat=>{
    const stock=inventory.stock[mat]||0;
    const thresh=inventory.thresholds[mat]||{minKg:0};
    const low=thresh.minKg>0&&stock<thresh.minKg;
    const {bags,bagKg,matPerBag,isGrain}=estBagsFromMat(mat,stock);
    const pct=thresh.minKg>0?Math.min(100,Math.round((stock/Math.max(stock,thresh.minKg*3))*100)):Math.min(100,Math.round((stock/Math.max(stock,100))*100));
    const estNote=isGrain
      ? `≈ ${bags} grain bags @ ${bagKg}kg each`
      : `≈ <strong>${bags}</strong> × ${bagKg}kg blocks <span style="font-size:10px;color:#aaa">(avg estimate)</span>`;
    return`<div style="background:${MAT_BG[mat]};border:1px solid ${low?'#f87171':MAT_BORDER[mat]};border-radius:10px;padding:14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-size:12px;font-weight:600;color:${MAT_COLORS[mat]}">${MAT_LABELS[mat]}</div>
        ${low?`<span style="font-size:10px;background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:99px;font-weight:600">LOW STOCK</span>`:''}
      </div>
      <div style="font-size:26px;font-weight:700;color:#1a1a1a;margin-bottom:2px">${stock.toFixed(1)} <span style="font-size:14px;font-weight:400;color:#888">kg</span></div>
      <div style="height:5px;border-radius:3px;background:rgba(0,0,0,.08);overflow:hidden;margin-bottom:8px">
        <div style="height:100%;border-radius:3px;background:${low?'#f87171':MAT_COLORS[mat]};width:${pct}%;transition:width .3s"></div>
      </div>
      <div style="font-size:12px;color:#555;line-height:1.6">${estNote}</div>
      ${thresh.minKg>0?`<div style="font-size:11px;color:${low?'#b91c1c':'#aaa'};margin-top:2px">Alert below ${thresh.minKg}kg</div>`:''}
      <button class="btn btn-sm" onclick="openStab('inv','delivery')" style="margin-top:8px;font-size:11px">+ Log delivery</button>
    </div>`;
  }).join('');
  renderThresholds();
}

function renderThresholds(){
  const el=document.getElementById('inv-thresholds');
  if(!el)return;
  const c=getAvgComp();

  // Per-material alert thresholds
  const threshHtml=`<div style="overflow-x:auto;margin-bottom:16px"><table>
    <thead><tr><th>Material</th><th>In stock</th><th>Alert below (kg)</th><th>Est. bags (avg)</th></tr></thead>
    <tbody>
    ${Object.keys(MAT_LABELS).map(mat=>{
      const stock=inventory.stock[mat]||0;
      const t=inventory.thresholds[mat]||{minKg:0};
      const {bags}=estBagsFromMat(mat,stock);
      return`<tr>
        <td style="font-weight:500;color:${MAT_COLORS[mat]}">${MAT_LABELS[mat]}</td>
        <td style="font-weight:600">${stock.toFixed(2)} kg</td>
        <td><input type="text" inputmode="decimal" value="${t.minKg}" style="width:80px;font-size:12px;padding:3px 6px" onchange="updateThreshold('${mat}','minKg',this.value)" /></td>
        <td style="font-size:12px;color:#666">~${bags} bags <span style="font-size:10px;color:#aaa">(avg)</span></td>
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>`;

  // Average composition settings
  const compHtml=`<div style="background:#f9f8f5;border-radius:8px;padding:12px">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">
      Average composition used for estimates
    </div>
    <p style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.6">
      These averages are used to calculate "~X bags" on the stock cards. 
      They are <strong>estimates only</strong> — exact usage is tracked when you create a batch with a specific substrate recipe.
    </p>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
      <div><label style="font-size:11px">Hardwood %</label>
        <input type="text" inputmode="decimal" value="${c.hwPct}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('hwPct',this.value)" /></div>
      <div><label style="font-size:11px">Wheat bran %</label>
        <input type="text" inputmode="decimal" value="${c.wbPct}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('wbPct',this.value)" /></div>
      <div><label style="font-size:11px">Water % (RH)</label>
        <input type="text" inputmode="decimal" value="${c.rhPct}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('rhPct',this.value)" /></div>
      <div><label style="font-size:11px">Block weight (kg)</label>
        <input type="text" inputmode="decimal" value="${c.bagKg}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('bagKg',this.value)" /></div>
      <div><label style="font-size:11px">Grain bag (kg)</label>
        <input type="text" inputmode="decimal" value="${c.grainBagKg}" style="font-size:13px;padding:5px 8px" onchange="updateAvgComp('grainBagKg',this.value)" /></div>
    </div>
    <div style="margin-top:8px;font-size:11px;color:#aaa">
      With these settings: 1 × ${c.bagKg}kg block uses ~${(c.bagKg*(1-c.rhPct/100)*(c.hwPct/100)).toFixed(3)}kg hardwood + ~${(c.bagKg*(1-c.rhPct/100)*(c.wbPct/100)).toFixed(3)}kg wheat bran (dry weights after removing ${c.rhPct}% water)
    </div>
  </div>`;

  el.innerHTML=threshHtml+compHtml;
}

function updateAvgComp(key,val){
  if(!inventory.avgComposition)inventory.avgComposition={hwPct:75,wbPct:25,rhPct:63,bagKg:3,grainBagKg:1};
  inventory.avgComposition[key]=parseFloat(val)||0;
  saveData();renderInvStock();
}

function updateThreshold(mat,key,val){
  if(!inventory.thresholds)inventory.thresholds={};
  if(!inventory.thresholds[mat])inventory.thresholds[mat]={minKg:0};
  inventory.thresholds[mat][key]=parseFloat(val)||0;
  saveData();renderInvStock();
}

function delMatChange(){
  const mat=document.getElementById('del-mat').value;
  const stock=inventory.stock?.[mat]||0;
  document.getElementById('del-current').textContent='Current stock: '+stock.toFixed(2)+' kg';
  document.getElementById('del-kg').value='';
  document.getElementById('del-preview').style.display='none';
}
function delPreview(){
  const mat=document.getElementById('del-mat').value;
  const kg=parseFloat(document.getElementById('del-kg').value)||0;
  const el=document.getElementById('del-preview');
  if(!kg){el.style.display='none';return}
  const cur=inventory.stock?.[mat]||0;
  el.innerHTML='After delivery: <strong>'+(cur+kg).toFixed(2)+' kg</strong> ('+cur.toFixed(2)+' + '+kg+' kg)';
  el.style.display='block';
}
function adjMatChange(){
  const mat=document.getElementById('adj-mat').value;
  const stock=inventory.stock?.[mat]||0;
  document.getElementById('adj-current').textContent='Current stock: '+stock.toFixed(2)+' kg';
  document.getElementById('adj-absolute').value='';
  document.getElementById('adj-delta').value='';
  document.getElementById('adj-preview').style.display='none';
}
function adjPreview(mode){
  const mat=document.getElementById('adj-mat').value;
  const cur=inventory.stock?.[mat]||0;
  const el=document.getElementById('adj-preview');
  let newVal,diff;
  if(mode==='absolute'){
    const abs=parseFloat(document.getElementById('adj-absolute').value);
    if(isNaN(abs)){el.style.display='none';return}
    document.getElementById('adj-delta').value='';
    newVal=Math.max(0,abs);diff=newVal-cur;
    el.innerHTML='Set to <strong>'+newVal.toFixed(2)+' kg</strong> ('+(diff>=0?'+':'')+diff.toFixed(2)+' kg from current '+cur.toFixed(2)+' kg)';
  }else{
    const delta=parseFloat(document.getElementById('adj-delta').value);
    if(isNaN(delta)){el.style.display='none';return}
    document.getElementById('adj-absolute').value='';
    newVal=Math.max(0,cur+delta);diff=delta;
    el.innerHTML='New total: <strong>'+newVal.toFixed(2)+' kg</strong> ('+(diff>=0?'+':'')+diff.toFixed(2)+' kg)';
  }
  el.style.display='block';
}
function logDelivery(){
  const mat=document.getElementById('del-mat').value;
  const kg=parseFloat(document.getElementById('del-kg').value)||0;
  const note=document.getElementById('del-note').value.trim();
  if(kg<=0){alert('Enter a quantity greater than 0');return}
  if(!inventory.stock)inventory.stock={hardwood:0,wheatbran:0,gypsum:0,grain:0};
  inventory.stock[mat]=(inventory.stock[mat]||0)+kg;
  invLog(mat,kg,'delivery',note||'delivery');
  saveData();
  document.getElementById('del-kg').value='';document.getElementById('del-note').value='';
  document.getElementById('del-preview').style.display='none';
  openStab('inv','stock');renderInvStock();
  setFb('ok','Delivery logged: +'+kg+'kg '+MAT_LABELS[mat]+' now '+inventory.stock[mat].toFixed(2)+'kg total');
}
function logAdjustment(){
  const mat=document.getElementById('adj-mat').value;
  const absVal=document.getElementById('adj-absolute').value;
  const deltaVal=document.getElementById('adj-delta').value;
  const reason=document.getElementById('adj-reason').value.trim()||'Manual adjustment';
  if(!inventory.stock)inventory.stock={hardwood:0,wheatbran:0,gypsum:0,grain:0};
  const cur=inventory.stock[mat]||0;
  let newStock,delta;
  if(absVal!==''){
    newStock=Math.max(0,parseFloat(absVal)||0);delta=newStock-cur;
  }else if(deltaVal!==''){
    delta=parseFloat(deltaVal)||0;newStock=Math.max(0,cur+delta);
  }else{alert('Enter either a new total or an adjustment amount');return}
  inventory.stock[mat]=newStock;
  invLog(mat,delta,'adjustment',reason);
  saveData();
  document.getElementById('adj-absolute').value='';document.getElementById('adj-delta').value='';
  document.getElementById('adj-reason').value='';document.getElementById('adj-preview').style.display='none';
  openStab('inv','stock');renderInvStock();
  setFb('ok','Adjusted '+MAT_LABELS[mat]+': '+(delta>=0?'+':'')+delta.toFixed(2)+'kg now '+newStock.toFixed(2)+'kg');
}

function renderInvLog(){
  const filter=document.getElementById('inv-log-filter').value;
  const body=document.getElementById('inv-log-body');
  if(!inventory.log||!inventory.log.length){body.innerHTML='<tr><td colspan="6" class="empty">No usage history yet.</td></tr>';return}
  const rows=[...inventory.log].reverse().filter(e=>filter==='all'||e.mat===filter).slice(0,MAX_LOG_DISPLAY);
  // Build running totals per material going forwards for display
  body.innerHTML=rows.map(e=>`<tr>
    <td style="font-size:10px;color:#aaa">${new Date(e.time).toLocaleString('de-DE')}</td>
    <td style="color:${MAT_COLORS[e.mat]};font-weight:500">${MAT_LABELS[e.mat]}</td>
    <td style="font-weight:600;color:${e.deltaKg<0?'#991b1b':'#166534'}">${e.deltaKg>0?'+':''}${e.deltaKg.toFixed(2)} kg</td>
    <td style="font-size:11px">${(e.running||0).toFixed(1)} kg</td>
    <td><span class="badge ${e.type==='delivery'?'b-add':e.type==='adjustment'?'b-move':'b-harvest'}">${e.type}</span></td>
    <td style="font-size:11px;color:#666">${esc(e.ref)||'—'}</td>
  </tr>`).join('');
}

// Show low-stock alerts in dashboard
function getInvAlerts(){
  if(!inventory.stock||!inventory.thresholds)return[];
  return Object.keys(MAT_LABELS).filter(mat=>{
    const stock=inventory.stock[mat]||0;
    const thresh=(inventory.thresholds[mat]||{}).minKg||0;
    return thresh>0&&stock<thresh;
  }).map(mat=>{
    const stock=inventory.stock[mat]||0;
    const thresh=inventory.thresholds[mat].minKg;
    const {bags}=estBagsFromMat(mat,stock);
    return{text:`Low stock: ${MAT_LABELS[mat]}`,detail:`${stock.toFixed(1)} kg remaining (≈${bags} bags) — below ${thresh}kg threshold`,urgent:stock<thresh*0.5,warn:true,species:null};
  });
}

// ─── BACKUP ──────────────────────────────────────────────────
function exportBackup(){const blob=new Blob([JSON.stringify({exported:new Date().toISOString(),version:8,batches,scanLog,manualTasks,harvests,cultures,inventory,assets},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='meisterpilze_backup_'+todayStr()+'.json';a.click()}
function previewImport(){const file=document.getElementById('import-file').files[0],prev=document.getElementById('import-preview'),btn=document.getElementById('import-btn');if(!file){prev.textContent='';btn.style.display='none';return}const r=new FileReader();r.onload=e=>{try{const d=JSON.parse(e.target.result);if(!d.batches){prev.textContent='Invalid file.';btn.style.display='none';return}prev.innerHTML=`<span style="color:#166534">Valid: ${new Date(d.exported).toLocaleString('de-DE')} — ${d.batches.length} batches, ${d.scanLog.length} scans, ${(d.cultures||[]).length} cultures, inventory: ${d.inventory?'yes':'no'}.</span>`;btn.style.display='inline-block';}catch{prev.textContent='Cannot read file.';btn.style.display='none'}};r.readAsText(file)}
function importBackup(){const file=document.getElementById('import-file').files[0];if(!file)return;confirm2('Restore this backup?','Replaces ALL data on the server for all users. Cannot be undone.','Yes, restore',()=>{const r=new FileReader();r.onload=e=>{try{const d=JSON.parse(e.target.result);batches=d.batches||[];scanLog=d.scanLog||[];manualTasks=d.manualTasks||[];harvests=d.harvests||[];cultures=d.cultures||[];inventory=d.inventory||defaultInventory();assets=d.assets||[];batches.forEach(b=>spColor(b.species));saveData();alert('Restored successfully.');go('dash','n-dash');}catch{alert('Failed to restore.')}};r.readAsText(file)})}

// ─── ASSETS (Anlageinventar) ────────────────────────────────
let editingAssetId=null;
let selectedAssetIds=new Set();

function formatEur(n){return n.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €'}

function computeDepreciation(asset,refDate){
  const ref=refDate?new Date(refDate):new Date();
  const entry=new Date(asset.entryDate);
  const isGwg=asset.purchasePrice<=800;
  if(asset.purchasePrice<=0||asset.usefulLife<=0)return{annualDepr:0,accumulated:0,bookValue:asset.purchasePrice,isGwg};

  // GWG (§6 Abs. 2 EStG): sofort voll abgeschrieben im Anschaffungsjahr
  if(isGwg){
    const refYear=ref.getFullYear(),entryYear=entry.getFullYear();
    if(refYear>=entryYear){
      const bv=asset.status==='aktiv'?1:0;
      return{annualDepr:asset.purchasePrice,accumulated:asset.purchasePrice-bv,bookValue:bv,isGwg:true};
    }
    return{annualDepr:asset.purchasePrice,accumulated:0,bookValue:asset.purchasePrice,isGwg:true};
  }

  // Lineare AfA (§7 Abs. 1 EStG) — monatsweise pro rata temporis
  // Anschaffungsmonat zählt als voller Monat
  const annualDepr=Math.round(asset.purchasePrice/asset.usefulLife*100)/100;
  const entryYear=entry.getFullYear(),entryMonth=entry.getMonth(); // 0-based
  const refYear=ref.getFullYear(),refMonth=ref.getMonth();

  if(ref<entry)return{annualDepr,accumulated:0,bookValue:asset.purchasePrice,isGwg:false};

  let accumulated=0;
  for(let y=entryYear;y<=refYear;y++){
    // Determine months of depreciation in this year
    const startM=(y===entryYear)?entryMonth:0;
    const endM=(y===refYear)?refMonth:11;
    const months=endM-startM+1;
    accumulated+=annualDepr*months/12;
  }
  accumulated=Math.min(Math.round(accumulated*100)/100,asset.purchasePrice);
  let bookValue=Math.round((asset.purchasePrice-accumulated)*100)/100;
  // Erinnerungswert: 1€ wenn voll abgeschrieben + aktiv
  if(bookValue<1&&asset.status==='aktiv'&&asset.purchasePrice>0)bookValue=1;
  if(bookValue<0)bookValue=0;
  return{annualDepr,accumulated:Math.round((asset.purchasePrice-bookValue)*100)/100,bookValue,isGwg:false};
}

function nextAssetId(){
  let max=0;
  assets.forEach(a=>{const m=a.assetId.match(/^INV-(\d+)$/);if(m)max=Math.max(max,parseInt(m[1]))});
  return'INV-'+String(max+1).padStart(4,'0');
}

function assetStatusBadge(s){return`<span class="badge badge-${s}">${s.charAt(0).toUpperCase()+s.slice(1)}</span>`}

function renderAssets(){
  const cat=document.getElementById('asset-cat-filter').value;
  const stat=document.getElementById('asset-stat-filter').value;
  const q=(document.getElementById('asset-search').value||'').toLowerCase().trim();
  const now=new Date();

  let rows=assets.filter(a=>{
    if(cat!=='all'&&a.category!==cat)return false;
    if(stat!=='all'&&a.status!==stat)return false;
    if(q){const hay=(a.assetId+' '+a.name+' '+(a.supplier||'')+' '+(a.serialNumber||'')+' '+(a.location||'')).toLowerCase();if(!hay.includes(q))return false}
    return true;
  }).sort((a,b)=>b.assetId.localeCompare(a.assetId));

  // Stats
  const aktiv=assets.filter(a=>a.status==='aktiv');
  const totalPurchase=aktiv.reduce((s,a)=>s+a.purchasePrice,0);
  const totalBook=aktiv.reduce((s,a)=>s+computeDepreciation(a).bookValue,0);
  const gwgCount=aktiv.filter(a=>a.purchasePrice<=800).length;
  document.getElementById('asset-stats').innerHTML=
    `<div class="met"><div class="met-v">${assets.length}</div><div class="met-l">Gesamt</div></div>`+
    `<div class="met"><div class="met-v">${formatEur(totalPurchase)}</div><div class="met-l">Anschaffungswert (aktiv)</div></div>`+
    `<div class="met"><div class="met-v">${formatEur(totalBook)}</div><div class="met-l">Buchwert heute (aktiv)</div></div>`+
    `<div class="met"><div class="met-v">${gwgCount}</div><div class="met-l">GWG (≤ 800 €)</div></div>`;

  // Table
  const body=document.getElementById('assets-body');
  if(!rows.length){body.innerHTML='<tr><td colspan="8" class="empty">Keine Anlagen erfasst. Klicke auf "Hinzufügen" um loszulegen.</td></tr>';return}
  body.innerHTML=rows.map(a=>{
    const d=computeDepreciation(a);
    const gwg=d.isGwg?'<span class="badge badge-gwg" style="margin-left:4px;font-size:9px">GWG</span>':'';
    return`<tr>
      <td style="font-family:monospace;font-size:11px;font-weight:500">${esc(a.assetId)}</td>
      <td>${esc(a.name)}${gwg}</td>
      <td>${esc(a.category)}</td>
      <td style="text-align:right">${formatEur(a.purchasePrice)}</td>
      <td style="text-align:right">${formatEur(d.bookValue)}</td>
      <td>${assetStatusBadge(a.status)}</td>
      <td style="font-size:11px;color:#555">${esc(a.location)||'—'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-sm" onclick="editAsset('${esc(a.assetId)}')" style="padding:2px 6px">Bearb.</button>
        <button class="btn btn-sm" onclick="quickPrintAsset('${esc(a.assetId)}')" style="padding:2px 6px">Druck</button>
        <button class="btn btn-sm" onclick="deleteAsset('${esc(a.assetId)}')" style="padding:2px 6px;color:#991b1b">×</button>
      </td>
    </tr>`}).join('');
}

function resetAssetForm(){
  editingAssetId=null;
  document.getElementById('asset-name').value='';
  document.getElementById('asset-category').value='Maschinen';
  document.getElementById('asset-entry-date').value=new Date().toISOString().slice(0,10);
  document.getElementById('asset-price').value='';
  document.getElementById('asset-life').value='5';
  document.getElementById('asset-depr-method').value='linear';
  document.getElementById('asset-supplier').value='';
  document.getElementById('asset-invoice').value='';
  document.getElementById('asset-serial').value='';
  document.getElementById('asset-location').value='';
  document.getElementById('asset-status').value='aktiv';
  document.getElementById('asset-exit-date').value='';
  document.getElementById('asset-exit-row').style.display='none';
  document.getElementById('asset-notes').value='';
  document.getElementById('asset-id-preview').textContent='Neue ID: '+nextAssetId();
  // Fill location datalist
  const locs=[...new Set(assets.map(a=>a.location).filter(Boolean))];
  document.getElementById('asset-loc-list').innerHTML=locs.map(l=>`<option value="${esc(l)}">`).join('');
}

function assetStatusChange(){
  const s=document.getElementById('asset-status').value;
  document.getElementById('asset-exit-row').style.display=s==='aktiv'?'none':'block';
}

function editAsset(id){
  const a=assets.find(x=>x.assetId===id);if(!a)return;
  editingAssetId=id;
  document.getElementById('asset-name').value=a.name;
  document.getElementById('asset-category').value=a.category;
  document.getElementById('asset-entry-date').value=a.entryDate;
  document.getElementById('asset-price').value=a.purchasePrice;
  document.getElementById('asset-life').value=a.usefulLife;
  document.getElementById('asset-depr-method').value=a.depreciationMethod||'linear';
  document.getElementById('asset-supplier').value=a.supplier||'';
  document.getElementById('asset-invoice').value=a.invoiceNumber||'';
  document.getElementById('asset-serial').value=a.serialNumber||'';
  document.getElementById('asset-location').value=a.location||'';
  document.getElementById('asset-status').value=a.status;
  document.getElementById('asset-exit-date').value=a.exitDate||'';
  document.getElementById('asset-exit-row').style.display=a.status==='aktiv'?'none':'block';
  document.getElementById('asset-notes').value=a.notes||'';
  document.getElementById('asset-id-preview').textContent='Bearbeiten: '+id;
  openStab('assets','add');
}

function saveAsset(){
  const name=document.getElementById('asset-name').value.trim();
  const category=document.getElementById('asset-category').value;
  const entryDate=document.getElementById('asset-entry-date').value;
  const price=parseFloat(document.getElementById('asset-price').value);
  const life=parseInt(document.getElementById('asset-life').value);
  if(!name||!entryDate||isNaN(price)||price<0||isNaN(life)||life<1){alert('Bitte alle Pflichtfelder ausfüllen.');return}
  const status=document.getElementById('asset-status').value;
  const obj={
    assetId:editingAssetId||nextAssetId(),
    name,category,entryDate,
    exitDate:status!=='aktiv'?document.getElementById('asset-exit-date').value||null:null,
    purchasePrice:price,usefulLife:life,
    depreciationMethod:document.getElementById('asset-depr-method').value,
    supplier:document.getElementById('asset-supplier').value.trim()||null,
    invoiceNumber:document.getElementById('asset-invoice').value.trim()||null,
    serialNumber:document.getElementById('asset-serial').value.trim()||null,
    location:document.getElementById('asset-location').value.trim()||null,
    status,
    notes:document.getElementById('asset-notes').value.trim(),
    created:editingAssetId?(assets.find(a=>a.assetId===editingAssetId)||{}).created||new Date().toISOString():new Date().toISOString()
  };
  if(editingAssetId){const i=assets.findIndex(a=>a.assetId===editingAssetId);if(i>=0)assets[i]=obj;else assets.push(obj)}
  else assets.push(obj);
  saveData();editingAssetId=null;
  openStab('assets','list');
}

function deleteAsset(id){
  confirm2('Anlage löschen?','Die Anlage '+id+' wird unwiderruflich gelöscht.','Ja, löschen',()=>{
    assets=assets.filter(a=>a.assetId!==id);saveData();renderAssets();
  });
}

// ─── ASSET EXPORT ───────────────────────────────────────────
function initExportTab(){
  const y=new Date().getFullYear();
  document.getElementById('stichtag-date').value=y+'-12-31';
}

function exportAssetCSV(){
  const hdr=['Inventar-Nr','Bezeichnung','Kategorie','Anschaffungsdatum','Anschaffungskosten','Nutzungsdauer (J.)','Jahres-AfA','Kumulierte AfA','Buchwert','GWG','Status','Lieferant','Rechnungsnr','Seriennr','Standort','Abgangsdatum','Bemerkungen'];
  const rows=assets.map(a=>{
    const d=computeDepreciation(a);
    return[a.assetId,a.name,a.category,fmtDE(a.entryDate),fmtNum(a.purchasePrice),a.usefulLife,fmtNum(d.annualDepr),fmtNum(d.accumulated),fmtNum(d.bookValue),d.isGwg?'Ja':'Nein',a.status,a.supplier||'',a.invoiceNumber||'',a.serialNumber||'',a.location||'',a.exitDate?fmtDE(a.exitDate):'',a.notes||''];
  });
  const csv='\uFEFF'+[hdr,...rows].map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='inventar_'+todayStr()+'.csv';a.click();
}

function fmtDE(iso){if(!iso)return'';const d=new Date(iso);return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'+d.getFullYear()}
function fmtNum(n){return String(Math.round(n*100)/100).replace('.',',')}

function renderStichtagReport(){
  const ref=document.getElementById('stichtag-date').value;
  if(!ref){alert('Bitte Stichtag wählen.');return}
  const aktiv=assets.filter(a=>a.status==='aktiv'||(a.exitDate&&a.exitDate>ref));
  let totalPurchase=0,totalBook=0,totalAccum=0;
  const rows=aktiv.map(a=>{
    const d=computeDepreciation(a,ref);
    totalPurchase+=a.purchasePrice;totalBook+=d.bookValue;totalAccum+=d.accumulated;
    return`<tr><td style="font-family:monospace;font-size:11px">${esc(a.assetId)}</td><td>${esc(a.name)}</td><td style="text-align:right">${formatEur(a.purchasePrice)}</td><td style="text-align:right">${formatEur(d.accumulated)}</td><td style="text-align:right;font-weight:600">${formatEur(d.bookValue)}</td></tr>`;
  });
  document.getElementById('stichtag-result').innerHTML=
    `<div style="font-size:12px;color:#555;margin-bottom:6px">Stichtag: ${fmtDE(ref)} — ${aktiv.length} aktive Anlagen</div>`+
    `<div style="overflow-x:auto"><table><thead><tr><th>Nr</th><th>Bezeichnung</th><th>Anschaffungskosten</th><th>Kum. AfA</th><th>Buchwert</th></tr></thead><tbody>`+
    rows.join('')+
    `<tr style="font-weight:700;border-top:2px solid #333"><td colspan="2">Summe</td><td style="text-align:right">${formatEur(totalPurchase)}</td><td style="text-align:right">${formatEur(totalAccum)}</td><td style="text-align:right">${formatEur(totalBook)}</td></tr>`+
    `</tbody></table></div>`;
}

// ─── ASSET LABELS ───────────────────────────────────────────
function renderAssetLabelList(){
  const el=document.getElementById('asset-label-list');
  if(!assets.length){el.innerHTML='<div class="empty">Keine Anlagen vorhanden.</div>';return}
  el.innerHTML=assets.filter(a=>a.status==='aktiv').map(a=>{
    const chk=selectedAssetIds.has(a.assetId)?'checked':'';
    return`<label style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #eee;font-size:12px;cursor:pointer">
      <input type="checkbox" ${chk} onchange="toggleAssetLabel('${esc(a.assetId)}',this.checked)">
      <span style="font-family:monospace;font-weight:500">${esc(a.assetId)}</span>
      <span style="color:#555">${esc(a.name)}</span>
      <span style="color:#999;font-size:11px">${esc(a.category)}</span>
    </label>`;
  }).join('');
}

function toggleAssetLabel(id,on){if(on)selectedAssetIds.add(id);else selectedAssetIds.delete(id)}
function toggleAllAssetLabels(on){
  if(on)assets.filter(a=>a.status==='aktiv').forEach(a=>selectedAssetIds.add(a.assetId));
  else selectedAssetIds.clear();
  renderAssetLabelList();
}

function makeAssetZPL(ids){
  return ids.map(id=>{
    const a=assets.find(x=>x.assetId===id);if(!a)return'';
    const bcVal=id.replace(/-/g,'_');
    const loc=(a.category||'')+(a.location?' / '+a.location:'');
    const nameTrunc=a.name.length>28?a.name.slice(0,26)+'..':a.name;
    return'^XA^PW400^LL240^CI28^LH0,0'+
      '^FO20,10^BY2,2.0,60^BCN,60,N,N,N^FD'+bcVal+'^FS'+
      '^FO8,78^A0N,28,28^FD'+id+'^FS'+
      '^FO8,110^A0N,20,20^FD'+nameTrunc+'^FS'+
      '^FO8,135^A0N,16,16^FD'+loc.slice(0,36)+'^FS'+
      '^XZ';
  }).filter(Boolean).join('\n');
}

async function printAssetLabels(){
  const ids=[...selectedAssetIds];
  if(!ids.length){alert('Bitte mindestens eine Anlage auswählen.');return}
  const zpl=makeAssetZPL(ids);
  const err=await sendToPrinter(zpl);
  if(err)alert('Druckfehler: '+err);
  else setFb('ok',ids.length+' Inventar-Etikett'+(ids.length!==1?'en':'')+' gedruckt');
}

function downloadAssetZPL(){
  const ids=[...selectedAssetIds];
  if(!ids.length){alert('Bitte mindestens eine Anlage auswählen.');return}
  const zpl=makeAssetZPL(ids);
  const blob=new Blob([zpl],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='inventar_labels.zpl';a.click();
}

async function quickPrintAsset(id){
  const zpl=makeAssetZPL([id]);
  const err=await sendToPrinter(zpl);
  if(err){const blob=new Blob([zpl],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=id+'_label.zpl';a.click()}
}

// ─── CULTURES ────────────────────────────────────────────────
const ctBadge=t=>{const m={MC:'badge-mc',PD:'badge-pd',LC:'badge-lc',G2G:'badge-g2g'};return`<span class="badge ${m[t]||''}">${t}</span>`}
const csBadge=s=>{const m={active:'badge-active',stored:'badge-stored',used:'badge-used',contam:'badge-contam'};return`<span class="badge ${m[s]||''}">${s}</span>`}
function fillCultureSelect(id,types){const s=document.getElementById(id);if(!s)return;const cur=s.value;s.innerHTML='<option value="">— none —</option>'+cultures.filter(c=>(c.status==='active'||c.status==='stored')&&(!types||types.includes(c.type))).map(c=>`<option value="${esc(c.id)}">${esc(c.id)} — ${esc(c.species)}/${esc(c.strain)} (${esc(c.type)})</option>`).join('');if(cur)s.value=cur}
function renderCultures(){
  const type=document.getElementById('cult-type').value,stat=document.getElementById('cult-stat').value,body=document.getElementById('cultures-body');
  const rows=cultures.filter(c=>(type==='all'||c.type===type)&&(stat==='all'||c.status===stat)).sort((a,b)=>b.created.localeCompare(a.created));
  if(!rows.length){body.innerHTML='<tr><td colspan="9" class="empty">No cultures yet. Use Lab → Log work to register them.</td></tr>';return}
  body.innerHTML=rows.map(c=>`<tr><td style="font-family:monospace;font-size:11px;font-weight:500">${esc(c.id)}</td><td>${ctBadge(c.type)}</td><td>${spDot(c.species)}${esc(c.species)}</td><td>${esc(c.strain)||'—'}</td><td style="font-family:monospace;font-size:10px;color:#888">${esc(c.parentId)||'—'}</td><td style="font-size:10px;color:#888">${new Date(c.created).toLocaleDateString('de-DE')}</td><td>${csBadge(c.status)}</td><td style="font-size:11px;color:#555;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.notes)||'—'}</td><td style="white-space:nowrap"><select onchange="setCultureStatus('${esc(c.id)}',this.value)" style="width:auto;font-size:11px;padding:2px 5px"><option value="active" ${c.status==='active'?'selected':''}>Active</option><option value="stored" ${c.status==='stored'?'selected':''}>Stored</option><option value="used" ${c.status==='used'?'selected':''}>Used up</option><option value="contam" ${c.status==='contam'?'selected':''}>Contaminated</option></select> <button class="btn btn-sm" onclick="quickPrintCulture('${esc(c.id)}')" title="Print label" style="padding:2px 6px">Print</button></td></tr>`).join('');
}
function setCultureStatus(id,status){const c=cultures.find(x=>x.id===id);if(c){c.status=status;saveData();renderCultures()}}

// ─── LAB WORK ────────────────────────────────────────────────
function lwUpdate(){
  const type=document.getElementById('lw-type').value;
  const dl=document.getElementById('sp-list');
  dl.innerHTML=[...new Set([...batches.map(b=>b.species),...cultures.map(c=>c.species)].filter(Boolean))].map(s=>`<option value="${s}">`).join('');
  const pr=document.getElementById('lw-parent-row'),sr=document.getElementById('lw-source-row'),ql=document.getElementById('lw-qty-lbl');
  if(type==='MC'){pr.style.display='none';sr.style.display='block';ql.textContent='Quantity (tubes/dishes)'}
  else if(type==='PD'){pr.style.display='block';document.getElementById('lw-parent-lbl').textContent='Parent (MC, PD or LC)';fillParentSelect(['MC','PD','LC']);sr.style.display='none';ql.textContent='Number of dishes'}
  else if(type==='LC'){pr.style.display='block';document.getElementById('lw-parent-lbl').textContent='Source (petri dish or MC)';fillParentSelect(['MC','PD']);sr.style.display='none';ql.textContent='Number of flasks'}
  else{pr.style.display='none';sr.style.display='none';ql.textContent='Number of bags'}
  lwPreview();
}
function fillParentSelect(types){const s=document.getElementById('lw-parent');const cur=s.value;s.innerHTML='<option value="">— none / new isolation —</option>'+cultures.filter(c=>(c.status==='active'||c.status==='stored')&&types.includes(c.type)).map(c=>`<option value="${esc(c.id)}">${esc(c.id)} — ${esc(c.species)}/${esc(c.strain)}</option>`).join('');if(cur)s.value=cur}
function lwPreview(){
  const type=document.getElementById('lw-type').value,sp=document.getElementById('lw-sp').value.trim(),qty=parseInt(document.getElementById('lw-qty').value)||1;
  const box=document.getElementById('lw-prev-box'),prev=document.getElementById('lw-prev');
  if(!sp||type==='G2G'){box.style.display='none';return}
  const prefix=type+'-'+abbrev(sp)+'-'+todayStr()+'-';
  const existing=cultures.filter(c=>c.id.startsWith(prefix)).length;
  prev.textContent=Array.from({length:qty},(_,i)=>prefix+String(existing+i+1).padStart(2,'0')).join('\n');
  box.style.display='block';
}
document.getElementById('lw-sp').addEventListener('input',lwPreview);
document.getElementById('lw-qty').addEventListener('input',lwPreview);
function logLabWork(){
  const type=document.getElementById('lw-type').value,sp=document.getElementById('lw-sp').value.trim(),st=document.getElementById('lw-st').value.trim();
  const parentId=document.getElementById('lw-parent')?.value||null,qty=parseInt(document.getElementById('lw-qty').value)||1;
  if(!sp){alert('Please enter a species');return}
  if(type==='G2G'){alert('G2G is recorded via the scan bar — use ADD to move grain bags.');return}
  const prefix=type+'-'+abbrev(sp)+'-'+todayStr()+'-';
  const existing=cultures.filter(c=>c.id.startsWith(prefix)).length;
  const newC=Array.from({length:qty},(_,i)=>({id:prefix+String(existing+i+1).padStart(2,'0'),type,species:sp,strain:st||'',parentId:parentId||null,source:document.getElementById('lw-source')?.value.trim()||null,status:'active',notes:document.getElementById('lw-notes').value.trim(),created:new Date().toISOString()}));
  cultures.push(...newC);saveData();
  document.getElementById('lw-notes').value='';document.getElementById('lw-qty').value='1';
  if(document.getElementById('lw-source'))document.getElementById('lw-source').value='';
  renderLabLog();fillCultureSelect('nb-culture',['PD','LC']);lwPreview();
  const ids=newC.map(c=>c.id).join(', ');
  if(confirm(`Logged: ${newC.length} ${type} created\n${ids}\n\nPrint labels now?`)){
    selectedLabIds=new Set(newC.map(c=>c.id));go('print','n-print');
    setTimeout(()=>{openStab('print','lab');renderLabList();renderLabPreview();},150);
  }
}
function renderLabLog(){const body=document.getElementById('lab-log-body');const rows=[...cultures].sort((a,b)=>b.created.localeCompare(a.created)).slice(0,50);body.innerHTML=rows.length?rows.map(c=>`<tr><td style="font-size:10px;color:#aaa">${new Date(c.created).toLocaleDateString('de-DE')}</td><td>${ctBadge(c.type)}</td><td style="font-family:monospace;font-size:11px">${esc(c.id)}</td><td style="font-family:monospace;font-size:10px;color:#888">${esc(c.parentId)||'—'}</td><td>${spDot(c.species)}${esc(c.species)}${c.strain?' / '+esc(c.strain):''}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">No lab work logged yet.</td></tr>'}

// ─── LINEAGE ─────────────────────────────────────────────────
function fillLineageSelect(){const s=document.getElementById('lineage-sel');const cur=s.value;s.innerHTML='<option value="">— select —</option>'+(cultures.length?`<optgroup label="Cultures">${cultures.map(c=>`<option value="C:${esc(c.id)}">${esc(c.id)} (${esc(c.type)} — ${esc(c.species)})</option>`).join('')}</optgroup>`:'')+( batches.length?`<optgroup label="Batches">${batches.map(b=>`<option value="B:${esc(b.batchId)}">${esc(b.batchId)} (${esc(b.species)})</option>`).join('')}</optgroup>`:'');if(cur)s.value=cur}
function buildTree(rootId,rootType){
  const getAnc=id=>{const c=cultures.find(x=>x.id===id);if(!c)return[];const node={id:c.id,type:c.type,species:c.species,strain:c.strain,status:c.status,created:c.created};if(c.parentId){const p=cultures.find(x=>x.id===c.parentId);if(p)return[...getAnc(c.parentId),node]}return[node]};
  const getDesc=(id,depth)=>{if(depth>6)return[];const ch=[];cultures.filter(c=>c.parentId===id).forEach(c=>ch.push({...c,harvest:0,children:getDesc(c.id,depth+1)}));batches.filter(b=>b.sourceId===id).forEach(b=>{const{status}=getStatus(b.batchId);ch.push({id:b.batchId,type:'BATCH',species:b.species,strain:b.strain,status,harvest:getHarvested(b.batchId),created:b.created,children:[]})});return ch};
  if(rootType==='C'){const anc=getAnc(rootId);const c=cultures.find(x=>x.id===rootId);if(!c)return null;const root={...anc[anc.length-1]||{id:c.id,type:c.type,species:c.species,strain:c.strain,status:c.status,created:c.created}};root.children=getDesc(rootId,0);if(anc.length>1){let tree=anc[0],cur=tree;for(let i=1;i<anc.length;i++){anc[i].children=i===anc.length-1?root.children:[];cur.children=[anc[i]];cur=anc[i]}return tree}return root}
  else{const b=batches.find(x=>x.batchId===rootId);if(!b)return null;const{status}=getStatus(b.batchId);const bn={id:b.batchId,type:'BATCH',species:b.species,strain:b.strain,status,harvest:getHarvested(b.batchId),created:b.created,children:[]};if(b.sourceId){const anc=getAnc(b.sourceId);if(anc.length){let tree=anc[0],cur=tree;for(let i=1;i<anc.length;i++){anc[i].children=[];cur.children=[anc[i]];cur=anc[i]}cur.children=[bn];return tree}}return bn}
}
const NODE_BG={MC:'#f3e8ff',PD:'#dbeafe',LC:'#dcfce7',BATCH:'#fff7ed'};
const NODE_BD={MC:'#c084fc',PD:'#93c5fd',LC:'#86efac',BATCH:'#fdba74'};
function treeHtml(node,depth){const ch=node.children?.length?`<div style="margin-left:${depth?20:0}px;padding-left:16px;border-left:2px solid #e5e3dd;margin-top:5px">${node.children.map(c=>treeHtml(c,depth+1)).join('')}</div>`:'';const harv=node.harvest>0?`<span class="badge b-harvest" style="margin-left:4px">${node.harvest}g</span>`:'';return`<div style="margin-bottom:5px"><div style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;background:${NODE_BG[node.type]||'#f5f4f0'};border:1px solid ${NODE_BD[node.type]||'#e5e3dd'};border-radius:7px;padding:5px 10px"><span style="font-size:10px;font-weight:600;color:#555">${esc(node.type)}</span><span style="font-family:monospace;font-size:12px;font-weight:600">${esc(node.id)}</span><span style="font-size:11px;color:#666">${esc(node.species)||''}${node.strain?' / '+esc(node.strain):''}</span><span style="font-size:10px;color:#888">${esc(node.status)||''}</span>${harv}<span style="font-size:10px;color:#aaa">${node.created?new Date(node.created).toLocaleDateString('de-DE'):''}</span></div>${ch}</div>`}
function renderLineage(){const val=document.getElementById('lineage-sel').value,body=document.getElementById('lineage-body');if(!val){body.innerHTML='<div class="empty">Select a culture or batch above.</div>';return}const[type,id]=val.split(':');const tree=buildTree(id,type);body.innerHTML=tree?`<div style="padding:4px 0">${treeHtml(tree,0)}</div>`:'<div class="empty">No lineage data found.</div>'}

// ─── BAG INFO MODAL ──────────────────────────────────────────
let biBagId=null,biBatchId=null;
function openBagInfo(bagId,batchId,batch){
  biBagId=bagId;biBatchId=batchId;
  const b=batch||batches.find(x=>x.batchId.toUpperCase()===batchId.toUpperCase());
  const el=document.getElementById('bi-body');
  if(!b){el.innerHTML='<p style="color:#b91c1c">Batch not found: '+esc(batchId)+'</p>';document.getElementById('m-baginfo').classList.add('open');return}
  document.getElementById('bi-title').textContent=bagId;
  // Current location
  const bagLogs=scanLog.filter(e=>(e.bag||'').toUpperCase()===bagId.toUpperCase());
  let currentLoc='Not placed yet';
  if(bagLogs.length){
    const last=bagLogs[bagLogs.length-1];
    if(last.action==='REMOVE')currentLoc='Removed';
    else if(last.action==='ADD'||last.action==='MOVE')currentLoc=last.to||'Unknown';
  }
  // Harvests for this bag
  const bagHarvests=harvests.filter(h=>(h.bag||'').toUpperCase()===bagId.toUpperCase());
  const totalHarv=bagHarvests.reduce((s,h)=>s+(h.grams||0),0);
  el.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="met"><div class="met-l">Species</div><div style="font-size:15px;font-weight:600">${spDot(b.species)}${esc(b.species)}</div></div>
      <div class="met"><div class="met-l">Strain</div><div style="font-size:15px;font-weight:600">${esc(b.strain)||'—'}</div></div>
      <div class="met"><div class="met-l">Current location</div><div style="font-size:15px;font-weight:600;color:#1e40af">${esc(currentLoc)}</div></div>
      <div class="met"><div class="met-l">Harvested</div><div style="font-size:15px;font-weight:600;color:#92400e">${totalHarv>0?totalHarv+'g':'None yet'}</div></div>
    </div>
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Batch ${esc(b.batchId)} — all bags</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:120px;overflow-y:auto">
      ${b.bags.map(bag=>{
        const isThis=bag.toUpperCase()===bagId.toUpperCase();
        const bagNum=bag.split('-').pop();
        const bagLast=[...scanLog].reverse().find(e=>(e.bag||'').toUpperCase()===bag.toUpperCase());
        const loc=!bagLast?'—':bagLast.action==='REMOVE'?'✗':bagLast.to||'?';
        return`<span style="font-size:11px;font-family:monospace;padding:3px 8px;border-radius:5px;background:${isThis?'#1a1a1a':'#f5f4f0'};color:${isThis?'#fff':'#555'};border:1px solid ${isThis?'#1a1a1a':'#e5e3dd'}" title="${esc(loc)}">
          ${esc(bagNum)} <span style="font-size:9px;color:${isThis?'#aaa':'#bbb'}">${esc(loc)}</span>
        </span>`;
      }).join('')}
    </div>
    ${bagHarvests.length?`<div style="margin-top:10px;font-size:12px;color:#92400e"><strong>Harvests:</strong> ${bagHarvests.map(h=>`Flush ${h.flush}: ${h.grams}g`).join(' · ')}</div>`:''}
  `;
  document.getElementById('m-baginfo').classList.add('open');
  setFb('info','Bag info: '+bagId+' — choose an action below or close');
}
function biSetAction(action){
  document.getElementById('m-baginfo').classList.remove('open');
  scan.action=action;scan.from=null;scan.to=null;scan.harvestBag=null;
  updateSD();
  if(action==='HARVEST'){
    showHarvestPanel(biBagId,biBatchId);
  }else if(action==='REMOVE'){
    const entry={time:new Date().toISOString(),action:'REMOVE',batch:biBatchId,bag:biBagId,from:null,to:null};scanLog.push(entry);    scan.count++;saveData();updateSD();
    setFb('ok','REMOVE logged: '+biBagId);
  }else{
    setFb('ok',action+' ready — now scan a location, then scan more bags');
  }
}
document.getElementById('m-baginfo').addEventListener('click',e=>{if(e.target.id==='m-baginfo')document.getElementById('m-baginfo').classList.remove('open')});

// ─── PRINT — BAG LABELS ──────────────────────────────────────
// ─── PRINT via server → ZPL → Windows spooler → GK420d ──────
// Correct size/orientation automatically — no browser dialog issues.
// Hyphens encoded as underscores in barcode to fix German keyboard scanning.

// Species abbreviation: 1 word → first 2 letters (CH), 2+ words → first letter each (BO, BK)
function spAbbrev(species){
  if(!species)return'XX';
  const words=species.trim().split(/\s+/);
  if(words.length===1)return words[0].slice(0,2).toUpperCase();
  return(words[0][0]+words[1][0]).toUpperCase();
}

function makeBagZPL(bags,batch,mode){
  return bags.map(bagId=>{
    let z='^XA^PW400^LL240^CI28^LH0,0';
    // Format: CH_ERL_0327_4 (max 13 chars)
    // species abbrev _ strain 3 chars _ MMDD _ bag number (no leading zero)
    const parts=bagId.split('-');
    let bcVal;
    if(parts.length===4){
      const sp=spAbbrev(batch.species);
      const st=(batch.strain||'000').slice(0,3).toUpperCase();
      const mmdd=parts[1].slice(2,4)+parts[1].slice(0,2); // DDMMYY '020426' → MMDD '0402'
      const bagNum=parseInt(parts[3],10);    // '04' → 4 (no leading zero)
      bcVal=sp+'_'+st+'_'+mmdd+'_'+bagNum;   // CH_ERL_0327_4
    }else{
      bcVal=bagId.replace(/-/g,'_');
    }
    z+='^FO10,5^BY2,2.0,72^BCN,72,N,N,N^FD'+bcVal+'^FS';
    z+='^FO0,84^FB400,1,0,C^A0N,38,38^FD'+bagId+'^FS';
    if(mode==='full'||mode==='date'){
      // Strain + substrate on one line
      let infoLine=batch.strain||'';
      if(batch.substrate){
        const hw=batch.substrate.hardwood||0;
        const wb=batch.substrate.wheatbran||0;
        const rh=batch.substrate.rh||0;
        const subStr=(hw?'HW'+hw+'%':'')+( wb?' WB'+wb+'%':'')+( rh?' RH'+rh+'%':'');
        if(subStr) infoLine+=(infoLine?' · ':'')+subStr;
      }
      if(infoLine) z+='^FO0,130^FB400,1,0,C^A0N,28,28^FD'+infoLine+'^FS';
    }
    if(mode==='date'){
      const due=new Date(batch.due);
      const dueStr=String(due.getDate()).padStart(2,'0')+'.'+String(due.getMonth()+1).padStart(2,'0')+'.'+due.getFullYear();
      z+='^FO0,168^FB400,1,0,C^A0N,24,24^FDFaellig: '+dueStr+'^FS';
    }
    z+='^XZ';
    return z;
  }).join('\n');
}

function makeLabZPL(ids,opts){
  return ids.map(id=>{
    const c=cultures.find(x=>x.id===id);if(!c)return'';
    const sp=(c.species||'')+(c.strain?' / '+c.strain:'');
    const ds=new Date(c.created).toLocaleDateString('de-DE');
    const bcVal=id.replace(/-/g,'_');
    let z='^XA^PW400^LL240^CI28^LH0,0';
    if(opts.bc)z+='^FO20,10^BY2,2.0,60^BCN,60,N,N,N^FD'+bcVal+'^FS';
    z+='^FO8,78^A0N,28,28^FD'+id+'^FS';
    if(opts.sp&&sp)z+='^FO8,110^A0N,20,20^FD'+sp+'^FS';
    if(opts.par&&c.parentId)z+='^FO8,135^A0N,17,17^FDParent: '+c.parentId+'^FS';
    if(opts.dt)z+='^FO8,156^A0N,16,16^FD'+ds+'^FS';
    if(opts.qr)z+='^FO272,10^BQN,2,3^FDMM,A'+id+'^FS';
    return z+'^XZ';
  }).filter(Boolean).join('\n');
}



function toggleBagRange(){document.getElementById('bag-range-inputs').style.display=document.getElementById('print-range').value==='range'?'inline-flex':'none'}

async function printBagLabels(){
  const b=batches.find(x=>x.batchId===document.getElementById('print-batch').value);
  if(!b){alert('Select a batch first.');return}
  let bags=b.bags;
  if(document.getElementById('print-range').value==='range'){
    const from=parseInt(document.getElementById('bag-from').value)||1;
    const to=parseInt(document.getElementById('bag-to').value)||b.bags.length;
    bags=b.bags.filter(bagId=>{const n=parseInt(bagId.split('-').pop());return n>=from&&n<=to});
    if(!bags.length){alert('No bags in that range.');return}
  }
  const zpl=makeBagZPL(bags,b,document.getElementById('print-mode').value);
  const err=await sendToPrinter(zpl);
  if(err)alert('Print error: '+err);
  else setFb('ok','Printed '+bags.length+' labels for '+b.batchId);
}

async function printLabLabels(){
  const ids=[...selectedLabIds];
  if(!ids.length){alert('Select at least one culture.');return}
  const zpl=makeLabZPL(ids,getLabOpts());
  const err=await sendToPrinter(zpl);
  if(err)alert('Print error: '+err);
  else setFb('ok','Printed '+ids.length+' lab label'+(ids.length!==1?'s':''));
}

async function quickPrintCulture(id){
  const zpl=makeLabZPL([id],{bc:true,qr:false,sp:true,par:true,dt:true});
  const err=await sendToPrinter(zpl);
  if(err){
    // fallback: download ZPL
    const blob=new Blob([zpl],{type:'text/plain'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=id+'_label.zpl';a.click();
  }
}

async function sendToPrinter(zpl){
  try{
    const r=await authFetch('/api/print',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({zpl})});
    const d=await r.json();
    if(d.ok)return null;
    return d.error||'Print failed';
  }catch(e){return'Could not reach server: '+e.message;}
}



function fillBatchSelect(){const s=document.getElementById('print-batch');const cur=s.value;s.innerHTML='<option value="">— choose batch —</option>'+batches.map(b=>`<option value="${esc(b.batchId)}">${esc(b.batchId)} (${esc(b.species)} / ${esc(b.strain)})</option>`).join('');if(cur)s.value=cur}

function renderBagPreview(){const id=document.getElementById('print-batch').value,el=document.getElementById('bag-preview');if(!id){el.innerHTML='<div class="empty">Select a batch above.</div>';return}const batch=batches.find(b=>b.batchId===id);if(!batch)return;const wrap=document.createElement('div');wrap.style.cssText='display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px';batch.bags.forEach((bagId,i)=>{const cell=document.createElement('div');cell.style.cssText='border:1px solid #e5e3dd;border-radius:5px;padding:4px;text-align:center;background:#fff;aspect-ratio:2/1;display:flex;align-items:center;justify-content:center;overflow:hidden';const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.style.cssText='display:block;width:100%;max-height:56px';cell.appendChild(svg);wrap.appendChild(cell);setTimeout(()=>{try{JsBarcode(svg,bagId,{format:'CODE128',width:1.4,height:32,displayValue:true,fontSize:10,margin:6,background:'#fff',lineColor:'#000'})}catch{}},50+i*10)});el.innerHTML='';el.appendChild(wrap)}

let selectedLabIds=new Set();
function renderLabList(){const filter=document.getElementById('lab-filter').value,el=document.getElementById('lab-list'),today=todayStr();const rows=cultures.filter(c=>{if(filter==='all')return c.status==='active'||c.status==='stored';if(filter==='today'){const d=new Date(c.created);return String(d.getFullYear()).slice(2)+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')===today}return c.type===filter}).sort((a,b)=>b.created.localeCompare(a.created));el.innerHTML=rows.length?rows.map(c=>`<label style="display:flex;align-items:center;gap:7px;padding:4px 0;cursor:pointer;font-size:12px;border-bottom:0.5px solid #f0ede8"><input type="checkbox" ${selectedLabIds.has(c.id)?'checked':''} onchange="toggleLabId('${esc(c.id)}',this.checked)" style="width:14px;height:14px;margin:0" /><span style="font-family:monospace;font-weight:500">${esc(c.id)}</span><span class="badge ${c.type==='MC'?'badge-mc':c.type==='PD'?'badge-pd':'badge-lc'}">${esc(c.type)}</span><span style="color:#888">${esc(c.species)}${c.strain?' / '+esc(c.strain):''}</span></label>`).join(''):'<div style="font-size:12px;color:#aaa;padding:6px">No cultures match.</div>'}
function toggleLabId(id,on){if(on)selectedLabIds.add(id);else selectedLabIds.delete(id);renderLabPreview()}
function getLabOpts(){return{bc:document.getElementById('lp-bc').checked,qr:document.getElementById('lp-qr').checked,sp:document.getElementById('lp-sp').checked,par:document.getElementById('lp-par').checked,dt:document.getElementById('lp-dt').checked}}
function renderLabPreview(){const el=document.getElementById('lab-preview');const ids=[...selectedLabIds];if(!ids.length){el.innerHTML='<div class="empty">Tick cultures in the list to preview labels.</div>';return}const opts=getLabOpts();const wrap=document.createElement('div');wrap.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px';ids.forEach((id,i)=>{const c=cultures.find(x=>x.id===id);if(!c)return;const cell=document.createElement('div');cell.style.cssText='border:1px solid #e5e3dd;border-radius:6px;padding:6px;background:#fff;aspect-ratio:2/1;overflow:hidden;display:flex;gap:4px';const left=document.createElement('div');left.style.cssText='flex:1;overflow:hidden;display:flex;flex-direction:column;justify-content:center;gap:1px';if(opts.bc){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.style.cssText='display:block;width:100%;max-height:32px';left.appendChild(svg);setTimeout(()=>{try{JsBarcode(svg,id,{format:'CODE128',width:1,height:24,displayValue:false,margin:2,background:'#fff',lineColor:'#000'})}catch{}},30+i*15)}const idEl=document.createElement('div');idEl.style.cssText='font-family:monospace;font-size:8px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';idEl.textContent=id;left.appendChild(idEl);if(opts.sp&&(c.species||c.strain)){const e2=document.createElement('div');e2.style.cssText='font-size:8px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';e2.textContent=(c.species||'')+(c.strain?' / '+c.strain:'');left.appendChild(e2)}if(opts.par&&c.parentId){const e2=document.createElement('div');e2.style.cssText='font-size:7px;color:#888';e2.textContent='↑ '+c.parentId;left.appendChild(e2)}if(opts.dt){const e2=document.createElement('div');e2.style.cssText='font-size:7px;color:#aaa';e2.textContent=new Date(c.created).toLocaleDateString('de-DE');left.appendChild(e2)}cell.appendChild(left);if(opts.qr){const right=document.createElement('div');right.style.cssText='width:48px;flex-shrink:0;display:flex;align-items:center;justify-content:center';const qrdiv=document.createElement('div');right.appendChild(qrdiv);cell.appendChild(right);setTimeout(()=>{try{new QRCode(qrdiv,{text:id,width:44,height:44,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.L})}catch{}},40+i*15)}wrap.appendChild(cell)});el.innerHTML='';el.appendChild(wrap)}

// ─── REF BARCODES ────────────────────────────────────────────
async function makeQR(val){return new Promise(resolve=>{const div=document.createElement('div');div.style.cssText='display:inline-block';try{new QRCode(div,{text:val,width:120,height:120,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.L});setTimeout(()=>{const img=div.querySelector('img')||div.querySelector('canvas');if(img){img.style.cssText='display:block;width:100%;height:auto';resolve(img)}else resolve(null)},100)}catch{resolve(null)}})}

async function renderRefBarcodes(){const grid=document.getElementById('ref-grid');grid.innerHTML='';const useQR=document.getElementById('ref-qr').checked;for(const group of REF_GROUPS){const card=document.createElement('div');card.className='card';card.innerHTML=`<div class="sec">${group.g}</div>`;const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;align-items:flex-end';for(const val of group.items){const cell=document.createElement('div');cell.className='bc-cell';cell.style.minWidth='80px';if(useQR){const img=await makeQR(val);if(img)cell.appendChild(img);const lbl=document.createElement('div');lbl.style.cssText='font-size:11px;font-weight:600;color:#555;margin-top:3px';lbl.textContent=val;cell.appendChild(lbl)}else{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.style.cssText='display:block';cell.appendChild(svg);setTimeout(()=>{try{JsBarcode(svg,val,{format:'CODE128',width:2,height:50,displayValue:true,fontSize:11,margin:12,background:'#fff',lineColor:'#000'})}catch{}},20)}row.appendChild(cell)}card.appendChild(row);grid.appendChild(card)}}
async function printRef(){const sheet=document.getElementById('ref-print-sheet');sheet.innerHTML='';const useQR=document.getElementById('ref-qr').checked;const title=document.createElement('div');title.style.cssText='font-family:Arial,sans-serif;font-size:15px;font-weight:bold;margin-bottom:12px;padding:8px';title.textContent='Meisterpilze — Reference '+(useQR?'QR Codes':'Barcodes');sheet.appendChild(title);let delay=0;for(const group of REF_GROUPS){const sec=document.createElement('div');sec.style.cssText='font-family:Arial,sans-serif;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:10px 8px 6px';sec.textContent=group.g;sheet.appendChild(sec);const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:0 8px';for(const val of group.items){const cell=document.createElement('div');cell.style.cssText='border:1px solid #ddd;border-radius:5px;padding:5px 7px;text-align:center;background:#fff;page-break-inside:avoid';if(useQR){const img=await makeQR(val);if(img){img.style.width='80px';img.style.height='80px';cell.appendChild(img)}const lbl=document.createElement('div');lbl.style.cssText='font-size:10px;font-weight:bold;font-family:Arial,sans-serif';lbl.textContent=val;cell.appendChild(lbl)}else{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');cell.appendChild(svg);setTimeout(()=>{try{JsBarcode(svg,val,{format:'CODE128',width:2,height:50,displayValue:true,fontSize:11,margin:12,background:'#fff',lineColor:'#000'})}catch{}},delay);delay+=25}row.appendChild(cell)}sheet.appendChild(row)}setTimeout(()=>window.print(),useQR?800:delay+200)}

// ─── GLOBAL SCAN ENGINE ──────────────────────────────────────
let _toastTimer=null;
function setFb(type,msg){
  const el=document.getElementById('scan-toast');
  el.className='scan-toast fb-'+type;
  el.textContent=msg;
  // Show toast
  requestAnimationFrame(()=>el.classList.add('visible'));
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>el.classList.remove('visible'),type==='err'?4000:3000);
}
function updateSD(){document.getElementById('s-action').textContent=scan.action||'—';document.getElementById('s-from').textContent=scan.from||'—';document.getElementById('s-to').textContent=scan.to||'—';document.getElementById('s-count').textContent=scan.count}
function resetScan(){scan={action:null,from:null,to:null,count:scan.count,harvestBag:null};document.getElementById('harvest-panel').style.display='none';updateSD();setFb('info','State reset. Scan ADD, MOVE, REMOVE or HARVEST to begin.')}
function processScan(raw){
  // Replace _ with - (German HID keyboard fix)
  let val=raw.trim().toUpperCase().replace(/_/g,'-');if(!val)return;
  // Decode new format: BO-ERL-0327-6 → full bag ID BLUES-260327-01-06
  // Parts: [spAbbrev, strainPrefix, MMDD, bagNum]
  const parts=val.split('-');
  if(parts.length===4&&/^\d{4}$/.test(parts[2])&&/^\d{1,2}$/.test(parts[3])){
    const scannedSp=parts[0];   // e.g. BO
    const scannedSt=parts[1];   // e.g. ERL
    const scannedMmdd=parts[2]; // e.g. 0327
    const scannedBag=parts[3].padStart(2,'0'); // 6→06
    // Find matching batch by comparing species abbrev + strain prefix + date MMDD
    const matchBatch=batches.find(b=>{
      const bSp=spAbbrev(b.species);
      const bSt=(b.strain||'000').slice(0,3).toUpperCase();
      const bDateParts=b.batchId.split('-');
      const bMmdd=bDateParts[1]?bDateParts[1].slice(2):'';
      return bSp===scannedSp && bSt===scannedSt && bMmdd===scannedMmdd;
    });
    if(matchBatch){
      val=matchBatch.batchId+'-'+scannedBag;
      setFb('info','Matched: '+val+' from '+matchBatch.batchId);
    }else{
      setFb('err','No batch found for '+val+' — check species/strain/date match');
      return;
    }
  }
  if(ACTIONS.includes(val)){
    scan.action=val;scan.from=null;scan.to=null;scan.harvestBag=null;
    document.getElementById('harvest-panel').style.display='none';updateSD();
    setFb('ok',{ADD:'Action: ADD → scan location or rack, then bags',MOVE:'Action: MOVE → scan FROM location',REMOVE:'Action: REMOVE → scan bags',HARVEST:'Action: HARVEST → scan a bag to log its weight'}[val]);return;
  }
  if(LOCS.includes(val)){
    if(scan.action==='ADD'){scan.to=val;updateSD();setFb('ok','Location: '+val+' → now scan bags (location stays until you change it)');return}
    if(scan.action==='MOVE'&&!scan.from){scan.from=val;updateSD();setFb('ok','From: '+val+' → scan the TO location');return}
    if(scan.action==='MOVE'&&scan.from){scan.to=val;updateSD();setFb('ok','To: '+val+' → now scan bags');return}
    setFb('err','Set an action first — scan ADD, MOVE, REMOVE or HARVEST.');return;
  }
  // Culture ID scan → open lineage
  if(/^(MC|PD|LC)-[A-Z]+-\d{6}-\d{2}$/.test(val)){
    const c=cultures.find(x=>x.id.toUpperCase()===val);
    if(c){go('lab','n-lab');openStab('lab','lineage');setTimeout(()=>{document.getElementById('lineage-sel').value='C:'+c.id;renderLineage()},100);setFb('ok','Culture scanned: '+val+' → lineage view');return}
  }
  const isBag=/-\d{2}$/.test(val);
  const batchId=isBag?val.split('-').slice(0,-1).join('-'):val;
  const batch=batches.find(b=>b.batchId.toUpperCase()===batchId.toUpperCase());
  if(batch||isBag){
    if(!scan.action){openBagInfo(val,batchId,batch);return}
    if(scan.action==='HARVEST'){showHarvestPanel(isBag?val:batchId,batchId);return}
    if(scan.action==='ADD'&&!scan.to){setFb('err','Scan a location or rack first.');return}
    if(scan.action==='MOVE'&&(!scan.from||!scan.to)){setFb('err','Scan FROM and TO locations first.');return}
    const entry={time:new Date().toISOString(),action:scan.action,batch:batchId,bag:isBag?val:null,from:scan.from,to:scan.to,species:batch?.species,strain:batch?.strain};scanLog.push(entry);    scan.count++;saveData();
    setFb('ok','Logged: '+scan.action+' '+val+(scan.to?' → '+scan.to:'')+' ['+scan.count+' this session]');
    updateSD();return;
  }
  setFb('err','Unknown barcode: '+val+'. Check the batch exists first.');
}
// ─── GLOBAL BARCODE BUFFER (timing-based scanner detection) ──
const _scanBuf={chars:[],timer:null};
const SCAN_MAX_GAP=50;   // max ms between keystrokes from a scanner
const SCAN_MIN_LEN=3;    // minimum barcode length

// Known barcode format patterns for validation
function isKnownBarcode(val){
  val=val.toUpperCase().replace(/_/g,'-');
  if(ACTIONS.includes(val))return true;
  if(LOCS.includes(val))return true;
  // Short barcode format: XX-XXX-0000-0
  if(/^[A-Z]{2,6}-[A-Z]{2,6}-\d{4}-\d{1,2}$/.test(val))return true;
  // Culture ID: MC|PD|LC-XXX-000000-00
  if(/^(MC|PD|LC)-[A-Z]+-\d{6}-\d{2}$/.test(val))return true;
  // Bag ID: SPECIES-YYMMDD-NN-NN
  if(/^[A-Z]+-\d{6}-\d{2}-\d{2}$/.test(val))return true;
  // Batch ID: SPECIES-YYMMDD-NN
  if(/^[A-Z]+-\d{6}-\d{2}$/.test(val))return true;
  return false;
}

function _flushScanBuf(){
  const raw=_scanBuf.chars.map(c=>c.ch).join('');
  _scanBuf.chars=[];
  if(raw.length<SCAN_MIN_LEN)return;
  // Validate against known formats
  const cleaned=raw.trim().toUpperCase().replace(/_/g,'-');
  if(!isKnownBarcode(cleaned))return;
  processScan(raw);
}

document.addEventListener('keydown',e=>{
  // Ignore modifier combos (copy-paste, shortcuts)
  if(e.ctrlKey||e.metaKey||e.altKey)return;

  const now=performance.now();

  // Enter/Return = end of barcode
  if(e.key==='Enter'){
    if(_scanBuf.chars.length>=SCAN_MIN_LEN){
      clearTimeout(_scanBuf.timer);
      // Check timing: all chars must have arrived within SCAN_MAX_GAP of each other
      const allFast=_scanBuf.chars.every((c,i)=>i===0||c.t-_scanBuf.chars[i-1].t<SCAN_MAX_GAP);
      if(allFast){
        e.preventDefault();
        e.stopPropagation();
        _flushScanBuf();
        return;
      }
    }
    _scanBuf.chars=[];
    clearTimeout(_scanBuf.timer);
    return;
  }

  // Only collect single printable characters
  if(e.key.length!==1)return;

  // If gap since last char is too long, reset buffer
  if(_scanBuf.chars.length>0&&now-_scanBuf.chars[_scanBuf.chars.length-1].t>SCAN_MAX_GAP){
    _scanBuf.chars=[];
  }

  _scanBuf.chars.push({ch:e.key,t:now});

  // Safety timeout: flush if scanner stops mid-stream
  clearTimeout(_scanBuf.timer);
  _scanBuf.timer=setTimeout(()=>{_scanBuf.chars=[]},SCAN_MAX_GAP*2);
});

// ─── CAMERA SCAN ────────────────────────────────────────────
let camScanner=null;
function openCamScan(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){setFb('err','Camera not available in this browser. Use HTTPS or localhost.');return}
  document.getElementById('m-camscan').classList.add('open');
  camScanner=new Html5Qrcode('cam-reader');
  camScanner.start(
    {facingMode:'environment'},
    {fps:10,qrbox:{width:250,height:250},formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE,Html5QrcodeSupportedFormats.CODE_128]},
    function(decodedText){if(navigator.vibrate)navigator.vibrate(100);closeCamScan();processScan(decodedText)},
    function(){}
  ).catch(function(err){
    closeCamScan();
    if(err.name==='NotAllowedError')setFb('err','Camera permission denied. Check browser settings.');
    else setFb('err','Camera error: '+(err.message||err));
  });
}
function closeCamScan(){
  document.getElementById('m-camscan').classList.remove('open');
  if(camScanner){camScanner.stop().catch(function(){});camScanner.clear();camScanner=null}
}
document.addEventListener('visibilitychange',function(){if(document.hidden&&camScanner)closeCamScan()});

// ─── USER MANAGEMENT ─────────────────────────────────────────
async function doLogout(){
  try{await authFetch('/api/auth/logout',{method:'POST'});}catch{}
  window.location.href='/login.html';
}

async function loadUsersTab(){
  const c=document.getElementById('sp-settings-users');
  if(!c)return;
  const acct=document.getElementById('users-account');
  if(acct&&currentUser)acct.innerHTML=`Logged in as <b>${esc(currentUser.username)}</b> (${esc(currentUser.role)})`;
  if(!currentUser||currentUser.role!=='admin'){
    const tbl=document.getElementById('users-table');
    if(tbl)tbl.innerHTML='<p style="color:#888">Admin access required to manage users.</p>';
    return;
  }
  try{
    const r=await authFetch('/api/users');
    const users=await r.json();
    const tbl=document.getElementById('users-table');
    if(!tbl)return;
    tbl.innerHTML='<table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:6px;border-bottom:1px solid #ddd">Username</th><th style="text-align:left;padding:6px;border-bottom:1px solid #ddd">Role</th><th style="text-align:left;padding:6px;border-bottom:1px solid #ddd">Created</th><th style="padding:6px;border-bottom:1px solid #ddd"></th></tr></thead><tbody>'+
      users.map(u=>`<tr><td style="padding:6px">${esc(u.username)}</td><td style="padding:6px">${esc(u.role)}</td><td style="padding:6px">${u.created?new Date(u.created).toLocaleDateString('de-DE'):''}</td><td style="padding:6px">${u.username!==currentUser.username?`<button class="btn btn-r" style="font-size:11px;padding:2px 8px" onclick="deleteUser(${u.id})">Delete</button>`:''}</td></tr>`).join('')+
      '</tbody></table>';
  }catch{}
}

async function addUser(){
  const u=document.getElementById('new-username').value.trim();
  const p=document.getElementById('new-password').value;
  const role=document.getElementById('new-role').value;
  if(!u||!p){alert('Username and password required');return;}
  if(p.length<8){alert('Password must be at least 8 characters');return;}
  try{
    const r=await authFetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,role})});
    if(!r.ok){const d=await r.json();alert(d.error||'Failed');return;}
    document.getElementById('new-username').value='';
    document.getElementById('new-password').value='';
    loadUsersTab();
  }catch(e){alert(e.message)}
}

async function deleteUser(id){
  if(!confirm('Delete this user?'))return;
  try{
    const r=await authFetch('/api/users/'+id,{method:'DELETE'});
    if(!r.ok){const d=await r.json();alert(d.error||'Failed');return;}
    loadUsersTab();
  }catch(e){alert(e.message)}
}

// ─── INIT ────────────────────────────────────────────────────
loadCurrentUser();
loadData();
setInterval(pollSync,SYNC_INTERVAL_MS);

// SSE for real-time multi-client sync
(function initSSE(){
  try{
    const es=new EventSource('/api/events');
    es.onmessage=function(e){
      try{const d=JSON.parse(e.data);if(d.type==='data-changed')pollSync()}catch{}
    };
    es.onerror=function(){/* auto-reconnects; fallback polling handles gaps */};
  }catch{}
})();

// Register service worker for PWA / offline support
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  });
}
