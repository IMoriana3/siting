// Prueba sintética del careo temporal de primer salto. NO usa ZIP de planta.
// node tests/test_careo_elburgo_modelo.js
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const RAIZ=path.join(__dirname,'..');
const TOOL=path.join(RAIZ,'tools','careo_elburgo_modelo.mjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rf-burgo-'));
let tests=0,ko=0;
function check(n,cond,detail){
 tests++;if(!cond){ko++;console.log('FAIL '+n+(detail?' '+detail:''));}
 else console.log('OK   '+n);
}
const GWS=['NCU01-GW1','NCU01-GW2','NCU02-GW1','NCU02-GW2'];
function fixture(){
 const nodos={'NCU01-GW1':'TCU_SUNNER_ID_041',
   'NCU01-GW2':'TCU_SUNNER_ID_062','NCU02-GW1':'TCU_SUNNER_ID_045',
   'NCU02-GW2':'TCU_SUNNER_ID_055'};
 const redes={};
 for(const g of GWS){
  const uno=nodos[g];
  redes[g]={series_horarias:[
   {hora_utc:'2026-10-12T14',mediana_abs_tilt_de_las_tcu_medidas:53.4,mediana_saltos:6},
   {hora_utc:'2026-10-12T18',mediana_abs_tilt_de_las_tcu_medidas:5.1,mediana_saltos:3}],
   primeros_saltos_14_18_utc:{
    '2026-10-12T14':{[uno]:12, HSU_FICTICIA:3},
    '2026-10-12T18':{[uno]:8, HSU_FICTICIA:0}}};
 }
 return{formato:'careo-rutas-observadas-v1',desde:'2026-10-12',hasta:'2026-10-12',redes};
}
const entrada=path.join(tmp,'obs.json'),dest=path.join(tmp,'out.json');
try{
 const data=fixture();fs.writeFileSync(entrada,JSON.stringify(data));
 const proc=cp.spawnSync(process.execPath,[TOOL,'--observado',entrada,'--salida',dest],{encoding:'utf8',timeout:30000});
 check('el comparador Node termina sin error',proc.status===0,(proc.stderr||'').slice(0,250));
 const r=fs.existsSync(dest)?JSON.parse(fs.readFileSync(dest,'utf8')):null;
 check('se emite un informe independiente con versión de contrato',!!r&&r.contrato==='careo-primeros-saltos-rf-siting-v1');
 check('se evalúan cuatro gateways a dos horas',!!r&&r.resultados.length===8);
 check('se usa el motor canónico con hashes reproducibles',!!r&&/^[a-f0-9]{64}$/.test(r.reproducibilidad.sha256_radio_zigbee));
 check('no se atribuye el PRO hipotético a El Burgo como hardware real',!!r&&r.parametros.variante.includes('hipótesis'));
 check('el montaje de PE2088 no figura como validado',!!r&&r.parametros.pe2088_lmr195.includes('NO APLICADOS'));
 check('no se inventa perfil DEM',!!r&&r.parametros.terreno.includes('NO EVALUADO'));
 if(r){
  const q=(g,h)=>r.resultados.find(a=>a.gw===g&&a.periodo==='2026-10-12T'+h);
  const a=q('NCU01-GW1','14'),b=q('NCU01-GW1','18');
  check('en NCU01-GW1 la inclinación alta reduce candidatos directos',a.tcus_predichas_margen_0<b.tcus_predichas_margen_0);
  check('el nodo TCU41 usa el extremo de antena oeste (no el centro)',Math.abs(a.top_primeros_saltos[0].distancia_m-71.8)<0.3,a.top_primeros_saltos[0].distancia_m);
  check('se conserva la discrepancia, TCU41 puede aparecer con margen negativo a 14h',a.top_primeros_saltos[0].margen_legacy_db<0);
  check('la misma TCU41 sale viable a 18h',b.top_primeros_saltos[0].margen_legacy_db>0);
  check('HSU declarada sin coordenada queda fuera del denominador RF',a.consultas_hsu_sin_posicion_verificada===3&&a.consultas_tcu_evaluables===12);
  check('la consulta observada no se confunde con RSSI medido',r.restricciones.some(t=>t.includes('no son paquetes entregados')));
  check('no filtra IP ni MAC al informe',!JSON.stringify(r).includes('00:13:')&&!JSON.stringify(r).includes('10.100.'));
 }else for(let i=0;i<7;i++)check('dependiente del JSON '+i,false);
 const incompleto=fixture();delete incompleto.redes['NCU02-GW2'];fs.writeFileSync(entrada,JSON.stringify(incompleto));
 const bad=cp.spawnSync(process.execPath,[TOOL,'--observado',entrada],{encoding:'utf8',timeout:30000});
 check('falta de gateway NO retorna verde',bad.status===2);
 const missing=cp.spawnSync(process.execPath,[TOOL],{encoding:'utf8',timeout:30000});
 check('sin datos NO simula',missing.status===2);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log(tests+' comprobaciones, '+ko+' fallos');
process.exitCode=ko?1:0;
