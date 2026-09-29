/* Plant Studies v1 - thin UI over the canonical SolarGPT local engine.
   No earthing or robot-cleaning physics lives in this file.
*/
(function(){
"use strict";

var API_KEY="solargptApiUrl", DEFAULT_API="http://localhost:8765";
var PS={
  api:null, engineOk:false, activeOverlay:null,
  earthing:{result:null,input:null,uiSig:null,dirty:false},
  cleaning:{result:null,input:null,uiSig:null,approved:new Set(),dirty:false},
  modal:null, body:null,
  staleCache:{earthing:{t:0,value:false},cleaning:{t:0,value:false}}
};

function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function fmt(v,d){var x=Number(v);return Number.isFinite(x)?x.toLocaleString("es-ES",{maximumFractionDigits:d==null?2:d}):"—";}
function apiUrl(){
  if(PS.api)return PS.api;
  try{PS.api=localStorage.getItem(API_KEY)||DEFAULT_API;}catch(_){PS.api=DEFAULT_API;}
  return PS.api.replace(/\/+$/,"");
}
function setApi(){
  var u=prompt("URL del motor local SolarGPT:",apiUrl());
  if(!u)return;
  PS.api=String(u).trim().replace(/\/+$/,"");
  try{localStorage.setItem(API_KEY,PS.api);}catch(_){}
  checkEngine();
}
async function checkEngine(){
  var el=document.getElementById("ps-engine");
  if(el)el.textContent="Motor SolarGPT · comprobando…";
  try{
    var r=await fetch(apiUrl()+"/health",{cache:"no-store"});
    if(!r.ok)throw new Error("HTTP "+r.status);
    var j=await r.json(), eps=new Set(j.endpoints||[]);
    PS.engineOk=eps.has("/studies/earthing")&&eps.has("/studies/robot-cleaning");
    if(el)el.innerHTML=PS.engineOk?
      'Motor SolarGPT · <span style="color:var(--ok)">conectado</span>':
      'Motor SolarGPT · <span style="color:var(--warn)">sin Plant Studies v1</span>';
  }catch(err){
    PS.engineOk=false;
    if(el)el.innerHTML='Motor SolarGPT · <span style="color:var(--danger)">no disponible</span>';
  }
}
async function post(path,payload){
  var r=await fetch(apiUrl()+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  var j=null;try{j=await r.json();}catch(_){}
  if(!r.ok){
    var detail=j&&j.detail!=null?(typeof j.detail==="string"?j.detail:JSON.stringify(j.detail)):"HTTP "+r.status;
    throw new Error(detail);
  }
  return j;
}
function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(v&&typeof v==="object"){var o={};Object.keys(v).sort().forEach(function(k){o[k]=stable(v[k]);});return o;}
  return v;
}
function uiHash(v){
  var s=JSON.stringify(stable(v)),h=2166136261;
  for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0).toString(16).padStart(8,"0");
}
function motorId(m){
  var id=String(m&&m.id||"").trim();
  if(!id)throw new Error("Hay una estructura sin identificador geométrico. No se crea un ID por índice.");
  return id;
}
function tableLength(m){
  var x=Number(m&&m.len!=null?m.len:(S.p&&S.p.tlen));
  if(!Number.isFinite(x)||x<=0)throw new Error("Falta longitud de mesa para "+motorId(m));
  return x;
}
function boundary(){
  if(Array.isArray(S.hull)&&S.hull.length>=3)return S.hull.map(function(p){return{x:+p.x,y:+p.y};});
  if(typeof convexHull==="function"&&typeof esquinasMesa==="function"){
    var h=convexHull(esquinasMesa(S.motors||[]));
    if(h&&h.length>=3)return h.map(function(p){return{x:+p.x,y:+p.y};});
  }
  throw new Error("No hay envolvente de planta suficiente para Earthing Design.");
}
function earthingEquipment(){
  var out=[];
  (S.ncus||[]).forEach(function(x){out.push({id:String(x.id),kind:"ncu",x:+x.x,y:+x.y});});
  (S.rsus||[]).forEach(function(x){out.push({id:String(x.id),kind:"weather_station",x:+x.x,y:+x.y});});
  (S.reps||[]).forEach(function(x){out.push({id:String(x.id),kind:"repeater",x:+x.x,y:+x.y});});
  return out.filter(function(x){return Number.isFinite(x.x)&&Number.isFinite(x.y);});
}
function cleaningStructures(){
  return (S.motors||[]).map(function(m){
    return {id:motorId(m),x:+m.x,y:+m.y,z:m.z==null?null:+m.z,length_m:tableLength(m),azimuth_deg:(m.az==null?null:+m.az),block_id:(m.pb==null?null:String(m.pb))};
  }).sort(function(a,b){return a.id.localeCompare(b.id);});
}
function earthingSig(input){return uiHash({boundary:boundary(),equipment:earthingEquipment(),input:input});}
function cleaningSig(input){return uiHash({structures:cleaningStructures(),input:input});}
function stale(kind,force){
  var st=kind==="earthing"?PS.earthing:PS.cleaning, cache=PS.staleCache[kind], now=Date.now();
  if(!st.result||!st.input||!st.uiSig)return false;
  if(st.dirty){cache.value=true;cache.t=now;return true;}
  if(!force&&now-cache.t<750)return cache.value;
  try{cache.value=st.uiSig!==(kind==="earthing"?earthingSig(st.input):cleaningSig(st.input));}
  catch(_){cache.value=true;}
  cache.t=now;return cache.value;
}
function statusHtml(kind){
  var st=kind==="earthing"?PS.earthing:PS.cleaning;
  if(!st.result)return '<span style="color:var(--muted-2)">sin calcular</span>';
  if(stale(kind))return '<span style="color:var(--warn)">⚠ desactualizado</span>';
  var s=String(st.result.status||"OK"),color=(s.indexOf("PASS")===0||s==="OK")?"var(--ok)":(s.indexOf("FAIL")===0?"var(--danger)":"var(--warn)");
  return '<span style="color:'+color+'">'+esc(s)+'</span>';
}
function updateStatus(){
  var e=document.getElementById("ps-earthing-status"),c=document.getElementById("ps-cleaning-status");
  if(e)e.innerHTML=statusHtml("earthing");
  if(c)c.innerHTML=statusHtml("cleaning");
}
function injectCss(){
  var st=document.createElement("style");
  st.textContent=
    ".ps-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}"+
    ".ps-card{padding:9px;border:1px solid var(--line-2);border-radius:8px;background:var(--surface-2)}"+
    ".ps-card b{display:block;font-size:12px;margin-bottom:3px}.ps-status{font:10.5px var(--mono);min-height:16px}"+
    ".ps-modal{position:fixed;inset:0;background:rgba(3,8,12,.76);z-index:1000;display:none;align-items:center;justify-content:center;padding:18px}"+
    ".ps-modal.open{display:flex}.ps-box{width:min(1120px,96vw);height:min(820px,94vh);background:var(--panel);border:1px solid var(--line-2);border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 28px 80px rgba(0,0,0,.5)}"+
    ".ps-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}.ps-head h2{font-size:15px}.ps-pill{font:10px var(--mono);padding:3px 7px;border-radius:12px;background:var(--warn-bg);color:var(--warn)}.ps-x{margin-left:auto;font-size:21px;color:var(--muted)}"+
    ".ps-body{display:grid;grid-template-columns:330px 1fr;flex:1;min-height:0}.ps-form{overflow:auto;border-right:1px solid var(--line);padding:16px}.ps-results{overflow:auto;padding:16px;background:var(--panel-2)}"+
    ".ps-field{margin-bottom:10px}.ps-field label{display:block;font-size:11.5px;color:var(--muted);margin-bottom:4px}.ps-field input{width:100%;padding:8px 9px;border:1px solid var(--line-2);border-radius:6px;background:var(--surface-2);color:var(--text);font-family:var(--mono)}"+
    ".ps-actions{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.ps-summary{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;margin-bottom:12px}.ps-kpi{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:9px}.ps-kpi .k{font:9.5px var(--mono);color:var(--muted);text-transform:uppercase}.ps-kpi .v{font:700 17px var(--mono);margin-top:3px}"+
    ".ps-table{border-collapse:collapse;width:100%;font-size:11px}.ps-table th,.ps-table td{padding:6px 7px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.ps-table th{color:var(--muted);font:600 10px var(--mono)}"+
    ".ps-note{padding:9px 11px;border-radius:8px;background:var(--warn-bg);color:var(--warn);font-size:11.5px;margin-bottom:10px}.ps-ok{background:var(--ok-bg);color:var(--ok)}.ps-err{background:var(--danger-bg);color:var(--danger)}"+
    "@media(max-width:800px){.ps-body{grid-template-columns:1fr}.ps-form{border-right:0;border-bottom:1px solid var(--line);max-height:45vh}.ps-summary{grid-template-columns:1fr 1fr}}";
  document.head.appendChild(st);
}
function injectPanel(){
  var sec=document.createElement("div");sec.className="sec";sec.id="plant-studies-sec";
  sec.innerHTML='<h3>Estudios de planta</h3><div class="ps-grid">'+
    '<div class="ps-card"><b>⚡ Puesta a tierra</b><div class="ps-status" id="ps-earthing-status">sin calcular</div><button class="btn btn-ghost btn-sm" id="ps-earthing-open" style="width:100%;margin-top:7px">Abrir estudio</button></div>'+
    '<div class="ps-card"><b>🤖 Limpieza robot</b><div class="ps-status" id="ps-cleaning-status">sin calcular</div><button class="btn btn-ghost btn-sm" id="ps-cleaning-open" style="width:100%;margin-top:7px">Abrir estudio</button></div></div>'+
    '<button class="btn btn-ghost btn-sm btn-block" id="ps-study-boq" style="margin-top:8px">BoQ de estudios actuales</button><button class="btn btn-ghost btn-sm btn-block" id="ps-engine" style="margin-top:6px">Motor SolarGPT · comprobar</button>'+
    '<div class="hint" style="font-size:10.5px;color:var(--muted-2);margin-top:6px">El HTML solo envía la geometría actual y pinta el resultado; el cálculo vive en SolarGPT.</div>';
  var panel=document.querySelector("aside.panel");if(!panel)return;
  var resultSec=[].slice.call(panel.querySelectorAll(".sec")).find(function(x){var h=x.querySelector("h3");return h&&/^\s*Resultado\s*$/.test(h.textContent||"");});
  panel.insertBefore(sec,resultSec||null);
  document.getElementById("ps-earthing-open").onclick=openEarthing;
  document.getElementById("ps-cleaning-open").onclick=openCleaning;
  document.getElementById("ps-engine").onclick=setApi;
  document.getElementById("ps-study-boq").onclick=downloadCombinedBoq;
}
function injectModal(){
  var m=document.createElement("div");m.className="ps-modal";m.id="ps-modal";
  m.innerHTML='<div class="ps-box"><div class="ps-head"><h2 id="ps-title">Estudio</h2><span class="ps-pill" id="ps-class">CANONICAL ENGINE</span><button class="ps-x" id="ps-close">×</button></div><div class="ps-body"><div class="ps-form" id="ps-form"></div><div class="ps-results" id="ps-results"></div></div></div>';
  document.body.appendChild(m);PS.modal=m;PS.body=document.getElementById("ps-results");
  document.getElementById("ps-close").onclick=function(){m.classList.remove("open");};
  m.addEventListener("click",function(e){if(e.target===m)m.classList.remove("open");});
}
function field(id,label,value,step,hint){
  return '<div class="ps-field"><label for="'+id+'">'+esc(label)+(hint?' · <span style="color:var(--muted-2)">'+esc(hint)+'</span>':'')+'</label><input id="'+id+'" type="number" step="'+(step==null?"any":step)+'" value="'+esc(value)+'"></div>';
}
function val(id){var e=document.getElementById(id),x=e?Number(e.value):NaN;if(!Number.isFinite(x))throw new Error("Valor inválido: "+id);return x;}
function valOpt(id){var e=document.getElementById(id);if(!e||String(e.value).trim()==="")return null;var x=Number(e.value);if(!Number.isFinite(x))throw new Error("Valor inválido: "+id);return x;}
function requireEngine(){
  if(PS.engineOk)return true;
  PS.body.innerHTML='<div class="ps-note ps-err"><b>Motor SolarGPT no disponible.</b><br>Arranca el servicio local en '+esc(apiUrl())+' o cambia la URL desde el panel. No se usa un cálculo aproximado en navegador.</div>';
  return false;
}
function geomRev(){return String(S.sc||S.projName||"layout");}
var EARTH_DEFAULT={soil_resistivity_ohm_m:100,season_factor:1.5,gravel_resistivity_ohm_m:3000,gravel_thickness_m:.10,fault_current_a:5000,fault_time_s:1,target_grid_resistance_ohm:1,grid_spacing_m:20,grid_azimuth_deg:0,grid_depth_m:.6,rod_length_m:3,rod_group_efficiency:.60,main_strip_width_mm:50,main_strip_thickness_mm:10,corrosion_allowance_pct:25,bond_conductor_area_mm2:35};
function earthValues(){
  return {soil_resistivity_ohm_m:val("pe-rho"),season_factor:val("pe-season"),gravel_resistivity_ohm_m:val("pe-gravel"),gravel_thickness_m:val("pe-gravel-h"),fault_current_a:val("pe-if")*1000,fault_time_s:val("pe-tf"),target_grid_resistance_ohm:val("pe-target"),grid_spacing_m:val("pe-spacing"),grid_azimuth_deg:val("pe-grid-az"),grid_depth_m:val("pe-depth"),rod_length_m:val("pe-rod"),rod_group_efficiency:val("pe-eff"),main_strip_width_mm:val("pe-w"),main_strip_thickness_mm:val("pe-t"),corrosion_allowance_pct:val("pe-corr"),bond_conductor_area_mm2:val("pe-cu")};
}
function openEarthing(){
  PS.modal.classList.add("open");document.getElementById("ps-title").textContent="Puesta a tierra · preliminar";document.getElementById("ps-class").textContent="PRELIMINARY · NO IFC";
  var d=PS.earthing.input||EARTH_DEFAULT;
  document.getElementById("ps-form").innerHTML='<div class="ps-note">Confirmar con resistividad medida, modelo multicapa y estudio de cortocircuito antes de IFC.</div>'+
    field("pe-rho","Resistividad suelo (Ω·m)",d.soil_resistivity_ohm_m)+field("pe-season","Factor estacional",d.season_factor,.05)+field("pe-gravel","Resistividad grava (Ω·m)",d.gravel_resistivity_ohm_m)+field("pe-gravel-h","Espesor grava (m)",d.gravel_thickness_m,.01)+field("pe-if","Corriente defecto (kA)",d.fault_current_a/1000,.1)+field("pe-tf","Tiempo defecto (s)",d.fault_time_s,.01)+field("pe-target","Objetivo Rgrid (Ω)",d.target_grid_resistance_ohm,.05)+field("pe-spacing","Paso malla preliminar (m)",d.grid_spacing_m,1)+field("pe-grid-az","Azimut malla (° N→E)",d.grid_azimuth_deg,1)+field("pe-depth","Profundidad malla (m)",d.grid_depth_m,.05)+field("pe-rod","Longitud pica (m)",d.rod_length_m,.1)+field("pe-eff","Eficiencia grupo picas",d.rod_group_efficiency,.05)+field("pe-w","Pletina GI ancho (mm)",d.main_strip_width_mm,1)+field("pe-t","Pletina GI espesor (mm)",d.main_strip_thickness_mm,.5)+field("pe-corr","Sobreespesor corrosión (%)",d.corrosion_allowance_pct,1)+field("pe-cu","Conductor Cu equipos (mm²)",d.bond_conductor_area_mm2,1)+'<button class="btn btn-primary btn-block" id="pe-run">Calcular con SolarGPT</button>';
  document.getElementById("pe-run").onclick=runEarthing;[].slice.call(document.querySelectorAll("#ps-form input")).forEach(function(x){x.addEventListener("input",function(){PS.earthing.dirty=true;updateStatus();renderEarthing();});});renderEarthing();
}
async function runEarthing(){
  if(!requireEngine())return;
  try{
    var input=earthValues();PS.body.innerHTML='<div class="ps-note">Calculando…</div>';
    var j=await post("/studies/earthing",{boundary:boundary(),equipment:earthingEquipment(),inputs:input,geometry_revision:geomRev(),source_revisions:{surface:"siting/index.html"}});
    PS.earthing={result:j,input:input,uiSig:earthingSig(input),dirty:false};PS.staleCache.earthing={t:Date.now(),value:false};PS.activeOverlay="earthing";renderEarthing();updateStatus();draw();
  }catch(err){PS.body.innerHTML='<div class="ps-note ps-err">'+esc(err.message)+'</div>';}
}
function kpi(k,v){return '<div class="ps-kpi"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div></div>';}
function boqTable(rows){
  if(!rows||!rows.length)return "";
  return '<h3 style="margin:14px 0 6px">BoQ del estudio</h3><table class="ps-table"><thead><tr><th>Código</th><th>Partida</th><th>Cantidad</th><th>Ud.</th><th>Fuente</th></tr></thead><tbody>'+rows.map(function(x){return '<tr><td>'+esc(x.code)+'</td><td>'+esc(x.description)+'</td><td>'+fmt(x.quantity,2)+'</td><td>'+esc(x.unit)+'</td><td>'+esc(x.source||'')+'</td></tr>';}).join("")+'</tbody></table>';
}
function warnings(ws){return (ws||[]).map(function(x){return '<div class="ps-note">'+esc(x)+'</div>';}).join("");}
function actions(kind){return '<div class="ps-actions"><button class="btn btn-ghost btn-sm" data-ps="json" data-kind="'+kind+'">JSON</button><button class="btn btn-ghost btn-sm" data-ps="boq" data-kind="'+kind+'">BoQ CSV</button><button class="btn btn-ghost btn-sm" data-ps="dxf" data-kind="'+kind+'">DXF</button><button class="btn btn-ghost btn-sm" data-ps="print" data-kind="'+kind+'">Informe</button><button class="btn btn-ghost btn-sm" data-ps="overlay" data-kind="'+kind+'">Mostrar en plano</button></div>';}
function renderEarthing(){
  var r=PS.earthing.result;if(!r){PS.body.innerHTML='<div class="ps-note">Aún no calculado.</div>';return;}
  var x=r.results||{},st=stale("earthing",true);
  PS.body.innerHTML=(st?'<div class="ps-note">⚠ Desactualizado: geometría/equipos cambiaron. Recalcula antes de usarlo.</div>':'')+
    '<div class="ps-summary">'+kpi("Rgrid",fmt(x.estimated_grid_resistance_ohm,3)+" Ω")+kpi("Picas",fmt(x.earth_pit_count,0))+kpi("GI 2D",fmt(x.horizontal_grid_length_m,0)+" m")+kpi("GPR",fmt(x.gpr_v,0)+" V")+'</div>'+
    '<div class="ps-note '+(String(r.status).indexOf("FAIL")===0?"ps-err":String(r.status).indexOf("PASS")===0?"ps-ok":"")+'"><b>'+esc(r.status)+'</b><br>Touch permitido: '+fmt(x.allowable_touch_voltage_v,0)+' V · Step permitido: '+fmt(x.allowable_step_voltage_v,0)+' V<br>Touch real de malla: '+esc((r.checks||{}).touch_voltage||"UNKNOWN")+'.</div><div class="hint">Plano: naranja = malla/picas · verde discontinuo = bonds de equipos explícitos.</div>'+boqTable(r.boq)+warnings(r.warnings)+actions("earthing");
  bindActions("earthing");
}
var CLEAN_DEFAULT={row_transverse_tolerance_m:1.5,azimuth_tolerance_deg:3,native_gap_max_m:0,standard_bridge_max_m:0,max_robot_travel_m:0,max_longitudinal_slope_pct:0,default_azimuth_deg:null};
function cleanValues(){
  return {row_transverse_tolerance_m:val("pc-row"),azimuth_tolerance_deg:val("pc-az"),native_gap_max_m:val("pc-native"),standard_bridge_max_m:val("pc-bridge"),max_robot_travel_m:val("pc-travel"),max_longitudinal_slope_pct:val("pc-slope"),default_azimuth_deg:valOpt("pc-default-az"),approved_bridge_ids:Array.from(PS.cleaning.approved).sort()};
}
function openCleaning(){
  PS.modal.classList.add("open");document.getElementById("ps-title").textContent="Limpieza robot · fleet & gaps";document.getElementById("ps-class").textContent="NO AUTO-BRIDGING";
  var d=PS.cleaning.input||CLEAN_DEFAULT;
  document.getElementById("ps-form").innerHTML='<div class="ps-note">Ningún hueco se puentea automáticamente. Bridge máximo = 0 significa capacidad del fabricante desconocida.</div>'+
    field("pc-row","Tolerancia transversal fila (m)",d.row_transverse_tolerance_m,.1)+field("pc-az","Tolerancia azimut (°)",d.azimuth_tolerance_deg,.5)+field("pc-native","Gap nativo máximo (m)",d.native_gap_max_m,.1)+field("pc-bridge","Bridge estándar máximo (m)",d.standard_bridge_max_m,.1)+field("pc-travel","Recorrido máximo robot (m)",d.max_robot_travel_m,1,"0 = sin límite declarado")+field("pc-slope","Pendiente longitudinal máxima (%)",d.max_longitudinal_slope_pct,.1,"0 = sin límite declarado")+field("pc-default-az","Azimut por defecto si falta en la mesa (°)",d.default_azimuth_deg==null?"":d.default_azimuth_deg,1,"vacío = fallar, no inferir")+'<button class="btn btn-primary btn-block" id="pc-run">Calcular con SolarGPT</button>';
  document.getElementById("pc-run").onclick=runCleaning;[].slice.call(document.querySelectorAll("#ps-form input")).forEach(function(x){x.addEventListener("input",function(){PS.cleaning.dirty=true;updateStatus();renderCleaning();});});renderCleaning();
}
async function runCleaning(){
  if(!requireEngine())return;
  try{
    var input=cleanValues();PS.body.innerHTML='<div class="ps-note">Calculando líneas y discontinuidades…</div>';
    var j=await post("/studies/robot-cleaning",{structures:cleaningStructures(),inputs:input,geometry_revision:geomRev(),source_revisions:{surface:"siting/index.html"}});
    PS.cleaning.result=j;PS.cleaning.input=input;PS.cleaning.uiSig=cleaningSig(input);PS.cleaning.dirty=false;PS.staleCache.cleaning={t:Date.now(),value:false};
    var valid=new Set((j.gaps||[]).map(function(g){return g.gap_id;}));PS.cleaning.approved=new Set(Array.from(PS.cleaning.approved).filter(function(x){return valid.has(x);}));
    PS.activeOverlay="cleaning";renderCleaning();updateStatus();draw();
  }catch(err){PS.body.innerHTML='<div class="ps-note ps-err">'+esc(err.message)+'</div>';}
}
function renderCleaning(){
  var r=PS.cleaning.result;if(!r){PS.body.innerHTML='<div class="ps-note">Aún no calculado.</div>';return;}
  var x=r.results||{},st=stale("cleaning",true),cand=(r.gaps||[]).filter(function(g){return g.state==="BRIDGE_CANDIDATE"||g.state==="BRIDGE_APPROVED";});
  var trs=cand.map(function(g){return '<tr><td><input type="checkbox" class="pc-bridge-cb" data-id="'+esc(g.gap_id)+'" '+(PS.cleaning.approved.has(g.gap_id)?"checked":"")+'></td><td>'+esc(g.from_id)+' → '+esc(g.to_id)+'</td><td>'+fmt(g.gap_m,2)+' m</td><td>'+esc(g.state)+'</td></tr>';}).join("");
  PS.body.innerHTML=(st?'<div class="ps-note">⚠ Desactualizado: el layout cambió. Recalcula antes de usarlo.</div>':'')+
    '<div class="ps-summary">'+kpi("Robots",fmt(x.robot_count,0))+kpi("Líneas",fmt(x.cleaning_line_count,0))+kpi("Longitud",fmt(x.cleanable_length_m,0)+" m")+kpi("Bridges aprob.",fmt(x.approved_bridge_count,0))+'</div>'+
    '<div class="ps-note '+(r.status==="OK"?"ps-ok":"")+'"><b>'+esc(r.status)+'</b><br>Candidatos: '+fmt(x.bridge_candidate_count,0)+' · Bloqueados: '+fmt(x.blocked_gap_count,0)+' · Capacidad desconocida: '+fmt(x.unknown_bridge_gap_count,0)+' · Robots ahorrados: '+fmt(x.robots_saved_by_approved_bridges,0)+'</div>'+
    (cand.length?'<h3 style="margin:12px 0 6px">Bridges candidatos</h3><table class="ps-table"><thead><tr><th>Aprobar</th><th>Gap</th><th>Longitud</th><th>Estado</th></tr></thead><tbody>'+trs+'</tbody></table><button class="btn btn-primary btn-sm" id="pc-rerun" style="margin-top:8px">Recalcular con selección</button>':'')+
    '<div class="hint">Plano: azul = línea de limpieza · amarillo = bridge candidato · verde = bridge aprobado · rojo = gap bloqueado.</div>'+blockTable(r.blocks)+boqTable(r.boq)+warnings(r.warnings)+actions("cleaning");
  [].slice.call(document.querySelectorAll(".pc-bridge-cb")).forEach(function(cb){cb.onchange=function(){if(cb.checked)PS.cleaning.approved.add(cb.dataset.id);else PS.cleaning.approved.delete(cb.dataset.id);PS.cleaning.dirty=true;updateStatus();};});
  var rr=document.getElementById("pc-rerun");if(rr)rr.onclick=runCleaning;bindActions("cleaning");
}
function blockTable(rows){
  if(!rows||!rows.length)return "";
  return '<h3 style="margin:14px 0 6px">Resumen por bloque</h3><table class="ps-table"><thead><tr><th>Bloque</th><th>Mesas</th><th>Líneas</th><th>Robots</th><th>Longitud</th></tr></thead><tbody>'+
    rows.map(function(x){return '<tr><td>'+esc(x.block_id==null?"sin bloque":x.block_id)+'</td><td>'+fmt(x.structure_count,0)+'</td><td>'+fmt(x.cleaning_line_count,0)+'</td><td>'+fmt(x.robot_count,0)+'</td><td>'+fmt(x.cleanable_length_m,0)+' m</td></tr>';}).join("")+'</tbody></table>';
}
function currentStudyBoq(){
  var out=[];
  if(PS.earthing.result&&!stale("earthing",true))out=out.concat(PS.earthing.result.boq||[]);
  if(PS.cleaning.result&&!stale("cleaning",true))out=out.concat(PS.cleaning.result.boq||[]);
  return out;
}
function downloadCombinedBoq(){
  var rows=currentStudyBoq();
  if(!rows.length){alert("No hay estudios vigentes para incorporar al BoQ.");return;}
  var lines=["code,description,quantity,unit,source"];
  rows.forEach(function(x){var cells=[x.code,x.description,x.quantity,x.unit,x.source].map(function(v){return '"'+String(v==null?"":v).replace(/"/g,'""')+'"';});lines.push(cells.join(","));});
  dl((S.sc||"plant")+"_plant_studies_boq.csv",lines.join("\n"),"text/csv");
}
function resultOf(kind){return kind==="earthing"?PS.earthing.result:PS.cleaning.result;}
function dl(name,text,type){var b=new Blob([text],{type:type||"text/plain"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);}
function downloadJson(kind){var r=resultOf(kind);if(r)dl((S.sc||"plant")+"_"+kind+".json",JSON.stringify(r,null,2),"application/json");}
function downloadBoq(kind){
  var r=resultOf(kind);if(!r)return;var lines=["code,description,quantity,unit,source"];
  (r.boq||[]).forEach(function(x){var cells=[x.code,x.description,x.quantity,x.unit,x.source].map(function(v){return '"'+String(v==null?"":v).replace(/"/g,'""')+'"';});lines.push(cells.join(","));});
  dl((S.sc||"plant")+"_"+kind+"_boq.csv",lines.join("\n"),"text/csv");
}
function dxfLine(a,b,layer){return "0\nLINE\n8\n"+layer+"\n10\n"+a.x+"\n20\n"+a.y+"\n30\n0\n11\n"+b.x+"\n21\n"+b.y+"\n31\n0\n";}
function dxfCircle(p,r,layer){return "0\nCIRCLE\n8\n"+layer+"\n10\n"+p.x+"\n20\n"+p.y+"\n30\n0\n40\n"+r+"\n";}
function downloadDxf(kind){
  var r=resultOf(kind);if(!r)return;var out="0\nSECTION\n2\nENTITIES\n",o=r.overlay||{};
  if(kind==="earthing"){
    var p=o.perimeter_grid||[];for(var i=1;i<p.length;i++)out+=dxfLine(p[i-1],p[i],"EARTH_GRID");
    (o.earth_pits||[]).forEach(function(x){out+=dxfCircle(x,.6,"EARTH_PIT");});
    (o.internal_grid_lines||[]).forEach(function(x){out+=dxfLine(x.from,x.to,"EARTH_GRID_INTERNAL");});
    (o.equipment_bonds||[]).forEach(function(x){out+=dxfLine(x.from,x.to,"EARTH_BOND");});
  }else{
    (o.lines||[]).forEach(function(x){out+=dxfLine(x.start,x.end,"CLEAN_LINE");});
    (o.gaps||[]).forEach(function(x){out+=dxfCircle(x.point,.4,x.state==="BRIDGE_APPROVED"?"CLEAN_BRIDGE":"CLEAN_GAP");});
  }
  dl((S.sc||"plant")+"_"+kind+".dxf",out+"0\nENDSEC\n0\nEOF\n","application/dxf");
}
function printReport(kind){
  var r=resultOf(kind);if(!r)return;
  var previous=PS.activeOverlay, image="";
  try{
    PS.activeOverlay=kind;draw();
    if(typeof cv!=="undefined"&&cv&&cv.toDataURL)image=cv.toDataURL("image/png");
  }catch(_){}
  PS.activeOverlay=previous;try{draw();}catch(_){}
  var w=window.open("","_blank");if(!w)return;
  var title=kind==="earthing"?"Puesta a tierra · preliminar":"Limpieza robot";
  var html='<!doctype html><meta charset="utf-8"><title>'+esc(title)+'</title><style>body{font:13px Arial;margin:28px;color:#17202a}h1{font-size:20px}pre{white-space:pre-wrap;background:#f4f6f7;padding:12px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}.warn{padding:10px;background:#fff4d6}.map{width:100%;max-height:560px;object-fit:contain;border:1px solid #ddd;margin:12px 0}</style><h1>'+esc(title)+' · '+esc(S.projName||S.sc||"planta")+'</h1><p><b>Estado:</b> '+esc(r.status)+'</p><p><b>Fingerprint:</b> '+esc(r.fingerprint)+'</p>'+(image?'<img class="map" src="'+image+'">':'')+(r.warnings||[]).map(function(x){return '<div class="warn">'+esc(x)+'</div>';}).join("")+boqTable(r.boq)+'<h2>Resultados</h2><pre>'+esc(JSON.stringify(r.results,null,2))+'</pre>';
  w.document.write(html);w.document.close();setTimeout(function(){w.print();},350);
}
function bindActions(kind){
  [].slice.call(document.querySelectorAll('[data-kind="'+kind+'"][data-ps]')).forEach(function(b){
    b.onclick=function(){
      var a=b.dataset.ps;
      if(a==="json")downloadJson(kind);else if(a==="boq")downloadBoq(kind);else if(a==="dxf")downloadDxf(kind);else if(a==="print")printReport(kind);else if(a==="overlay"){PS.activeOverlay=kind;draw();}
    };
  });
}
function path(points,color,width,dash){
  if(!points||points.length<2)return;ctx.beginPath();
  points.forEach(function(p,i){var q=w2s(p);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});
  ctx.strokeStyle=color;ctx.lineWidth=width*DPR;if(dash)ctx.setLineDash(dash.map(function(x){return x*DPR;}));ctx.stroke();ctx.setLineDash([]);
}
function paintEarthing(r){
  var o=r.overlay||{};path(o.perimeter_grid,"#d45d22",2,[8,4]);
  (o.internal_grid_lines||[]).forEach(function(g){path([g.from,g.to],"rgba(212,93,34,.65)",1);});
  (o.equipment_bonds||[]).forEach(function(b){path([b.from,b.to],"#1f9d57",1,[4,4]);});
  (o.earth_pits||[]).forEach(function(p){var q=w2s(p);ctx.beginPath();ctx.arc(q.x,q.y,5*DPR,0,Math.PI*2);ctx.fillStyle="#d45d22";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=DPR;ctx.stroke();});
}
function paintCleaning(r){
  var o=r.overlay||{};
  (o.lines||[]).forEach(function(x){path([x.start,x.end],"#2878c7",3);});
  (o.gaps||[]).forEach(function(g){var q=w2s(g.point),ap=g.state==="BRIDGE_APPROVED";ctx.beginPath();ctx.arc(q.x,q.y,(ap?6:4)*DPR,0,Math.PI*2);ctx.fillStyle=ap?"#36D399":(g.state==="BRIDGE_CANDIDATE"?"#F2A900":"#ef5f6b");ctx.fill();});
}
function paint(){
  if(!PS.activeOverlay||S._rosaOff)return;
  var st=PS.activeOverlay==="earthing"?PS.earthing:PS.cleaning;
  if(!st.result||stale(PS.activeOverlay))return;
  ctx.save();ctx.lineCap="round";ctx.lineJoin="round";
  if(PS.activeOverlay==="earthing")paintEarthing(st.result);else paintCleaning(st.result);
  ctx.restore();
}
function wrapDraw(){
  try{var base=draw;draw=function(){base();paint();updateStatus();};}catch(err){console.warn("Plant Studies: draw wrapper no disponible",err);}
}
function init(){injectCss();injectPanel();injectModal();wrapDraw();checkEngine();updateStatus();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
window.PlantStudies={state:PS,checkEngine:checkEngine,openEarthing:openEarthing,openCleaning:openCleaning,isStale:stale,currentBoq:currentStudyBoq};
})();