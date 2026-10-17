/* Careo reproducible de PRIMEROS SALTOS REALES frente a Siting.
 *
 * NO es un analizador de RSSI por enlace ni una validación de potencia RF.
 * Primero: python tools/careo_elburgo_datos.py --zip ... --json observado.json
 * Después: node tools/careo_elburgo_modelo.mjs --observado observado.json
 *          [--salida informe.json]
 *
 * El ZIP permanece fuera del repositorio; este script SOLO recibe agregados
 * sin MAC/IP y ejecuta el motor canónico de este repositorio.
 * Una ruta devuelta por Digi NO demuestra entrega de paquetes.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import * as PV0 from "../radio_pv_model.js";
import * as ZB0 from "../radio_zigbee.js";

const RAIZ=path.join(path.dirname(fileURLToPath(import.meta.url)),"..");
const RPV=PV0.default || PV0, ZB=ZB0.default || ZB0;
const arg=(n)=>{const i=process.argv.indexOf("--"+n); return i>=0?process.argv[i+1]:null;};
const ruta=arg("observado"),salida=arg("salida");
if(!ruta){console.error("Se requiere --observado JSON generado por careo_elburgo_datos.py");process.exit(2);}
function aborta(msg){console.error("NO EVALUABLE: "+msg);process.exit(2);}
function sha(s){return crypto.createHash("sha256").update(s).digest("hex");}
const texto=(name)=>fs.readFileSync(path.join(RAIZ,name),"utf8");
const html=texto("index.html"),srcPV=texto("radio_pv_model.js"),srcZB=texto("radio_zigbee.js"),srcParams=texto("radio_params.json");
const P=JSON.parse(srcParams);
const modelo=JSON.parse((html.match(/^const BURGO=(\{[\s\S]*?\});$/m)||[])[1]||"null");
if(!modelo || !modelo.bifila || !modelo.tcus || !modelo.ncus)aborta("preset BURGO incompleto");
let O;
try{O=JSON.parse(fs.readFileSync(ruta,"utf8"));}catch(e){aborta("entrada JSON inexistente o inválida: "+e.message);}
if(O.formato!=="careo-rutas-observadas-v1" || !O.redes)aborta("contrato de datos observado ausente");
const RE_GW=/^NCU(0[12])-GW([12])$/;
const GWS=["NCU01-GW1","NCU01-GW2","NCU02-GW1","NCU02-GW2"];
for(const gw of GWS)if(!O.redes[gw])aborta("falta la red "+gw);

function extrae(regex,nombre){
 const a=html.match(regex);
 if(!a)aborta("no se encuentra "+nombre+" en el HTML canónico");
 return a[0];
}
const srcRows=extrae(/function rfRows\(\)\{[\s\S]*?\n}\n/,"rfRows");
const srcOb=extrae(/function rfObstacles\(n,m,rows,conDuenyo\)\{[\s\S]*?\n}\n/,"rfObstacles");
const srcCru=extrae(/function rfCruces\(n,m,rows\)\{[\s\S]*?\n}\n/,"rfCruces");
const motors=modelo.tcus.map((t,i)=>({i,ncu:+t[2],gw:+t[3],esclavo:String(t[4]),
 x:+t[0],y:+t[1],len:t[6],wid:t[7],az:t[8]}));
const S={motors,bifila:modelo.bifila,p:{tlen:100,twid:12}};
const ctx={S,Math,ZigbeePV:{rowTopElev:()=>2},RF_ANT_H:1.5,
 RF_CHORD_M:modelo.bifila.cuerda,rfTilt:()=>ctx.angulo,
 rfAngulo:()=>ctx.angulo,rfEjeTubo:()=>({valor:P.geometria.eje_tubo_m.valor}),
 angulo:0};
vm.createContext(ctx);
vm.runInContext(srcRows+"\n"+srcOb+"\n"+srcCru+"\nvar __filas=rfRows();",ctx);
const cruces=(a,b)=>ctx.rfCruces(a,b,ctx.__filas);
const V=P.tecnologias.zigbee_pro_24,pr=P.propagacion;
const prop={eps_r_suelo:pr.eps_r_suelo.valor,sigma_suelo_s_m:pr.sigma_suelo_s_m.valor,
 polarizacion:pr.polarizacion.valor,sigma_db:null,vegetacion:{modelo:null}};
const umbralCerca=P.geometria.campo_cercano_lambdas.valor;
const perfiles={};
for(const g of GWS){
 const match=g.match(RE_GW),n=+match[1],gw=+match[2];
 const root=modelo.ncus.find(x=>+x[0]===n);
 if(!root)aborta("NCU sin posición: "+g);
 const bySlave=new Map(motors.filter(m=>m.ncu===n&&m.gw===gw).map(m=>[m.esclavo,m]));
 if(!bySlave.size)aborta("GW sin TCU en preset: "+g);
 perfiles[g]={root:{x:+root[3],y:+root[4]},bySlave};
}
function calcula(g,ang){
 ctx.angulo=ang;
 const conf=perfiles[g],r={};
 const zB=RPV.alturaAntenaTCU(P.geometria.eje_tubo_m.valor,
  P.geometria.antena_tcu.radio_ancla_m.valor,
  P.geometria.antena_tcu.coax_caida_m.valor,ang);
 for(const m of conf.bySlave.values()){
   // En El Burgo la antena está en la viga OESTE de la bifila; NO en su centro.
   // El desplazamiento sale de las DOS filas del propio rfRows, no de un ajuste
   // libre: (ancho bifila - cuerda) / 2 sobre el eje transversal de la mesa.
   const shift=(m.wid-modelo.bifila.cuerda)/2,a=(m.az||0)*Math.PI/180;
   const dst={x:m.x-shift*Math.cos(a),y:m.y+shift*Math.sin(a)};
   const D=Math.hypot(dst.x-conf.root.x,dst.y-conf.root.y);
   const c=cruces(conf.root,dst);
   // La misma puerta de campo cercano que rfEnlace: un canto dentro de las
   // primeras longitudes de onda no se evalúa como difracción de filo.
   let cercano=false;
   for(const x of c){
     if(!(x.senPhi>0))continue;
     const cut=RPV.cortaPanel(x.zEje,x.cuerda,x.alpha,-x.s*x.senPhi,(D-x.s)*x.senPhi,3.15,zB);
     if(cut.wBorde==null)continue;
     const b=x.s+cut.wBorde/x.senPhi;
     if(b>0&&b<D&&RPV.campoCercano(b,D-b,V.f_hz,umbralCerca).cerca){cercano=true;break;}
   }
   if(cercano){r[m.esclavo]={d:D,margenDb:null,cercano:true,cruces:c.length};continue;}
   const predict=ZB.presupuesto({D,zA:3.15,zB,cruces:c,perfil:null},V,prop,null);
   r[m.esclavo]={d:D,margenDb:predict.margenDb,cercano:false,cruces:c.length};
 }
 return r;
}
function compara(g,dia,hora){
 const periodo=dia+"T"+hora,red=O.redes[g];
 const s=(red.series_horarias||[]).find(x=>x.hora_utc===periodo);
 const ang=s&&s.mediana_abs_tilt_de_las_tcu_medidas;
 if(ang==null)return {gw:g,periodo,estado:"NO_EVALUABLE",motivo:"ángulo medido no disponible"};
 const primero=(red.primeros_saltos_14_18_utc||{})[periodo];
 if(!primero)return {gw:g,periodo,estado:"NO_EVALUABLE",motivo:"sin consultas de primeros saltos"};
 const pred=calcula(g,ang),todos=Object.values(pred);
 let total=0,clasificadas=0,conMargen=0,con8=0,hsu=0,sinPos=0,cerca=0;
 const top=[];
 for(const [id,num]of Object.entries(primero)){
   if(!Number.isInteger(num)||num<0)aborta("contador de rutas inválido en "+periodo);
   total+=num;
   const m=id.match(/^TCU_SUNNER_ID_(\d+)$/);
   if(!m){if(id.startsWith("HSU_"))hsu+=num;else sinPos+=num;continue;}
   const q=pred[String(+m[1])];
   if(!q){sinPos+=num;continue;}
   if(q.cercano||q.margenDb==null){cerca+=num;continue;}
   clasificadas+=num;
   if(q.margenDb>=0)conMargen+=num;
   if(q.margenDb>=8)con8+=num;
   top.push({tcu:+m[1],consultas:num,distancia_m:+q.d.toFixed(1),
             margen_legacy_db:+q.margenDb.toFixed(1),filas_cruzadas:q.cruces});
 }
 top.sort((a,b)=>b.consultas-a.consultas);
 return {gw:g,periodo,estado:"ESCENARIO_TEORICO",inclinacion_mediana_abs_deg:ang,
  saltos_mediana_observados:s.mediana_saltos,
  tcus_de_asignacion:todos.length,
  tcus_predichas_margen_0:todos.filter(x=>x.margenDb!=null&&x.margenDb>=0).length,
  tcus_predichas_margen_8:todos.filter(x=>x.margenDb!=null&&x.margenDb>=8).length,
  tcus_no_evaluables_campo_cercano:todos.filter(x=>x.cercano).length,
  consultas_primer_salto:total,consultas_tcu_evaluables:clasificadas,
  consultas_tcu_con_margen_0:conMargen,consultas_tcu_con_margen_8:con8,
  consultas_hsu_sin_posicion_verificada:hsu,consultas_tcu_sin_identidad_de_plano:sinPos,
  consultas_tcu_campo_cercano:cerca,
  pct_primeros_saltos_tcu_con_margen_0:clasificadas?+(100*conMargen/clasificadas).toFixed(1):null,
  top_primeros_saltos:top.slice(0,5)};
}
const dias=new Set();
for(const g of GWS)for(const datehour of Object.keys(O.redes[g].primeros_saltos_14_18_utc||{}))
  dias.add(datehour.slice(0,10));
const informe={
 contrato:"careo-primeros-saltos-rf-siting-v1",
 parametros:{variante:"zigbee_pro_24 LEGACY (hipótesis, NO inventario de El Burgo)",
  potencia_tx_dbm:V.ptx_dbm,sensibilidad_rx_dbm:V.rx_sens_dbm,
  altura_antena_ncu_m:3.15,
  altura_eje_m:P.geometria.eje_tubo_m.valor,
  extremo_tcu:"viga oeste bifila, centro menos (ancho-cuerda)/2",
  terreno:"NO EVALUADO (sin perfil)", vegetacion:"NO MODELADA",
  patron_antena:"NO DECLARADO en presupuesto: se usan ganancias de pico heredadas",
  pe2088_lmr195:"NO APLICADOS (montaje aún no verificado en ambas NCU de El Burgo)",
  angulo:"mediana horaria de inclinación absoluta de TCU válidas por gateway, no cada TCU"},
 reproducibilidad:{sha256_radio_pv_model:sha(srcPV),sha256_radio_zigbee:sha(srcZB),
  sha256_radio_params:sha(srcParams),sha256_index:sha(html)},
 restricciones:[
  "Consultas de rutas Digi no son paquetes entregados ni mediciones RSSI del primer salto.",
  "Los enlaces no elegidos como primer salto no son ejemplos negativos.",
  "El porcentaje sobre consultas repite nodos y no constituye tamaño de muestra independiente.",
  "La comparación es direccional NCU→TCU con tecnología, potencia y sensibilidad HIPOTÉTICAS.",
  "Sin inventario TX y patrón, sin terreno y sin HSU georreferenciada, NO se valida precisión en dB.",
  "Se respeta el corte por (NCU,GW); no se conectan redes distintas por compartir antena."
 ],
 resultados:[]};
for(const g of GWS)for(const dia of [...dias].sort())for(const hora of ["14","18"])
  informe.resultados.push(compara(g,dia,hora));
console.log("CAREO SITING vs rutas El Burgo — escenario legacy, NO validación de dB");
for(const r of informe.resultados){
 if(r.estado!=="ESCENARIO_TEORICO"){console.log(r.gw+" "+r.periodo+" NO EVALUABLE");continue;}
 console.log(r.gw+" "+r.periodo+" | ang="+r.inclinacion_mediana_abs_deg.toFixed(1)+
  "° | TCU margen>=0: "+r.tcus_predichas_margen_0+"/"+r.tcus_de_asignacion+
  " | saltos medidos mediana="+r.saltos_mediana_observados+
  " | primeros TCU >=0: "+r.consultas_tcu_con_margen_0+"/"+r.consultas_tcu_evaluables+
  " | HSU sin posición: "+r.consultas_hsu_sin_posicion_verificada);
}
if(salida){fs.writeFileSync(salida,JSON.stringify(informe,null,2)+"\n","utf8");console.log("Informe JSON escrito: "+salida);}
