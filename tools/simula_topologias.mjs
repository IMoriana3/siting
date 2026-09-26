/* simula_topologias.mjs — Zigbee mesh vs Wi-SUN mesh vs LoRa directo.
 *
 * Usa el MISMO rfEnlace del visor y el layout real. La unica diferencia entre
 * tecnologias es su variante de radio y la topologia permitida.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cargaApp, hermano, RAIZ, ANTENA_NCU_M } from './_motor_app.mjs';
const require=createRequire(import.meta.url);
const TOP=require(path.join(RAIZ,'radio_topologias.js'));

const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>0?process.argv[i+1]:d;};
const PLANTA=arg('planta','elburgo');
const HORAS=arg('horas','8,12,16').split(',').map(Number).filter(Number.isFinite);
const DIA=[2026,5,21];
const ALCANCE=Number(arg('alcance','1200'));
const SALIDA=arg('json',null);
const UMBRALES=[0,8];
const DIR=hermano();
if(!DIR){console.error('SIN ALCANCE: no encuentro cobertura-zigbee al lado.');process.exit(2);}
const fn=path.join(DIR,PLANTA+'_layout.json');
if(!fs.existsSync(fn)){console.error('SIN ALCANCE: falta '+fn);process.exit(2);}
const L=JSON.parse(fs.readFileSync(fn,'utf8'));
const {ctx,S,rows}=cargaApp(L);
const P=ctx.S._radioParams;
const cuerda=(L.bifila&&L.bifila.cuerda)||P.geometria.cuerda_m_defecto.valor;
const paso=(L.pitch!=null?L.pitch:P.geometria.pitch_m_defecto.valor);
const gcr=cuerda/paso;

const nodos=[],raices=[];
for(let k=0;k<(L.ncus||[]).length;k++){
  const n=L.ncus[k];
  nodos.push({id:'NCU'+(k+1),x:n.x,y:n.n,ncu:k+1,esNcu:true,esEquipo:true,antenaM:ANTENA_NCU_M});
  raices.push('NCU'+(k+1));
}
for(let i=0;i<S.motors.length;i++){
  const m=S.motors[i];
  if(!(m.ncu>=1&&m.ncu<=raices.length)) continue;
  nodos.push({id:'T'+i,x:m.x,y:m.y,i,ncu:m.ncu,esNcu:false});
}
const ntcu=nodos.length-raices.length;

function instala(baseKey,v,id){
  const key='__sim_'+id;
  const base=P.tecnologias[baseKey]||{};
  P.tecnologias[key]=Object.assign({},base,v,{
    nombre:(v.modelo? v.modelo+' · ':'')+(v.modo||base.nombre||id),
    procedencia:'datasheet',
    canal:{valor:v.canal_ref_mhz||868.3,procedencia:'datasheet'}
  });
  return key;
}
function enlaza(key,hora){
  S.rf.variante=key;
  Object.assign(S.rf.sol,{on:true,lat:L.clat,lon:L.clon,gcr,
    horaUTC:Date.UTC(DIA[0],DIA[1],DIA[2],hora,0)});
  ctx.S._rfRows=null;
  return (a,b)=>{
    const r=ctx.rfEnlace({x:a.x,y:a.y,i:a.i,esEquipo:a.esEquipo,antenaM:a.antenaM},
                         {x:b.x,y:b.y,i:b.i,esEquipo:b.esEquipo,antenaM:b.antenaM},rows);
    return (!r||r.margenDb==null)?{viable:null,margenDb:null}
                                 :{viable:r.margenDb>=0,margenDb:r.margenDb};
  };
}
function q(x,n=1){return x==null?null:+x.toFixed(n);}
function cargaMinimaPct(tasa,hopsSuma){
  if(!(tasa>0)||!(hopsSuma>0)) return null;
  return 100*(44*8*hopsSuma)/(30*tasa);
}
function deberMinPct(tasa){
  if(!(tasa>0)) return null;
  return 100*(44*8)/(30*tasa);
}
function resumeOne(nombre,tech,topologia,variante,key){
  const porUmbral={};
  for(const umbral of UMBRALES){
    const hs=[];
    for(const h of HORAS){
      const e=enlaza(key,h);
      const r=topologia==='directa'
        ? TOP.analizaDirecta(nodos,e,raices,{umbralDb:umbral,alcanceMax:ALCANCE,
            raizDe:n=>'NCU'+n.ncu})
        : TOP.analizaMalla(nodos,e,raices,{umbralDb:umbral,alcanceMax:ALCANCE});
      const directo=topologia==='mesh'
        ? TOP.analizaDirecta(nodos,e,raices,{umbralDb:umbral,alcanceMax:ALCANCE,raizDe:n=>'NCU'+n.ncu})
        : r;
      hs.push({hora:h,cubiertas:r.cubiertas,sinRuta:r.sinRuta.length,
        cubiertasDirectas:directo.cubiertas,
        sinRutaDirecta:directo.sinRuta.length,
        redundanciaGw:r.conDosOMasGateways,
        asignadaOk:r.asignadaOk==null?null:r.asignadaOk,
        minRaicesExistentes:r.minimoRaicesExistentes,
        saltosMediano:q(r.saltosMediano,2),saltosMax:r.saltosMax,
        maxDistanciaViableM:q(r.maxDistanciaViableM,1),
        margenMinDb:q(r.margenMinDb,1),margenMedianoDb:q(r.margenMedianoDb,1),
        saltosMedio:q(r.saltosMedio,3),
        cargaMinimaRedPct:q(cargaMinimaPct(variante.tasa_bps,r.saltosSuma),2)});
    }
    porUmbral[String(umbral)]={
      cubiertasMin:Math.min(...hs.map(x=>x.cubiertas)),
      cubiertasMax:Math.max(...hs.map(x=>x.cubiertas)),
      sinRutaMax:Math.max(...hs.map(x=>x.sinRuta)),
      cubiertasDirectasMin:Math.min(...hs.map(x=>x.cubiertasDirectas)),
      cubiertasDirectasMax:Math.max(...hs.map(x=>x.cubiertasDirectas)),
      redundanciaGwMin:hs.every(x=>x.redundanciaGw!=null)?Math.min(...hs.map(x=>x.redundanciaGw)):null,
      saltosMax:Math.max(...hs.map(x=>x.saltosMax||0))||null,
      maxDistanciaObservadaM:q(Math.max(...hs.map(x=>x.maxDistanciaViableM||0)),1)||null,
      cargaMinimaRedPctMax:q(Math.max(...hs.map(x=>x.cargaMinimaRedPct||0)),2)||null,
      horas:hs
    };
  }
  return {
    nombre,tecnologia:tech,topologia,variante:{
      fabricante:variante.fabricante||null,modelo:variante.modelo||null,modo:variante.modo||null,
      f_hz:variante.f_hz,ptx_dbm:variante.ptx_dbm,gtx_dbi:variante.gtx_dbi,
      rx_sens_dbm:variante.rx_sens_dbm,tasa_bps:variante.tasa_bps||null,
      sf:variante.sf||null,channel_plan_id:variante.channel_plan_id||null
    },
    payload44B30s:{porTcuMinPct:q(deberMinPct(variante.tasa_bps),3),
      nota:'limite inferior: solo payload, sin cabeceras, ACK, contention ni reintentos'},
    umbrales:porUmbral
  };
}

const escenarios=[];
const z=P.tecnologias.zigbee_pro_24;
escenarios.push(resumeOne('Zigbee PRO · mesh','zigbee','mesh',z,'zigbee_pro_24'));

for(const v of (P.tecnologias.lora_eu868.candidatos.variantes_calculables||[])){
  const key=instala('lora_eu868',v,'lora_'+v.id);
  escenarios.push(resumeOne('LoRa directo · '+v.modelo+' · '+v.modo,'lora','directa',v,key));
}
for(const v of (P.tecnologias.wisun_fan_863.candidatos.variantes_calculables||[])){
  const key=instala('wisun_fan_863',v,'wisun_'+v.id);
  escenarios.push(resumeOne('Wi-SUN mesh · '+v.modelo+' · '+v.modo,'wisun','mesh',v,key));
}

const out={
  schema:'comms-topology-sim/1',planta:PLANTA,fechaSimulada:'2026-06-21',
  horasUTC:HORAS,tcus:ntcu,gatewaysEnPosicionesNcu:raices.length,umbralFisicoDb:0,
  umbralDisenoDb:8,alcancePodaM:ALCANCE,
  semantica:{
    zigbee:'mesh: TCU pueden retransmitir',
    wisun:'mesh RPL proxy: todas las TCU se suponen router-capable; camino de menor numero de saltos como cota inferior',
    lora_p2p:'directo: solo TCU-gateway; no hay retransmision TCU-TCU',
    lorawan:'misma geometria directa que LoRa P2P; star-of-stars permite que cualquier gateway que oiga el uplink lo entregue al servidor'
  },
  supuestos:[
    'mismas posiciones NCU del layout para los gateways de las tres tecnologias',
    'antena NCU a la cota declarada por el proyecto; TCU en su montaje actual',
    'LoRa/Wi-SUN usan antena sub-GHz TE 0600-00020 de 2 dBi como referencia, no BOM aprobada',
    'sin campana sub-GHz: es PREDICCION, no calibracion',
    'viable fisico = margen >=0 dB; diseno = margen >=8 dB',
    'carga de red es un limite inferior con 44 B/TCU/30 s; no incluye overhead ni reintentos'
  ],
  escenarios
};
if(SALIDA) fs.writeFileSync(SALIDA,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out,null,2));
