// Topologias COMMS: mesh no es directa y directa no usa TCU como repetidor.
'use strict';
const TOP=require('../radio_topologias.js');
let ok=0,ko=0;
function check(n,c,x){if(c){ok++;console.log('OK   '+n);}else{ko++;console.log('FAIL '+n+(x==null?'':' -> '+x));}}
const nodos=[
 {id:'G1',x:0,y:0},{id:'G2',x:100,y:0},
 {id:'A',x:25,y:0,ncu:1},{id:'B',x:50,y:0,ncu:1},{id:'C',x:75,y:0,ncu:2}
];
const E=new Set(['A\u0000B','B\u0000C','C\u0000G2']);
const key=(a,b)=>a<b?a+'\u0000'+b:b+'\u0000'+a;
const mesh=(a,b)=>({viable:E.has(key(a.id,b.id)),margenDb:E.has(key(a.id,b.id))?12:-20});
const rm=TOP.analizaMalla(nodos,mesh,['G1','G2'],{umbralDb:8});
check('mesh usa A-B-C-G2 y cubre las tres TCU',rm.cubiertas===3,rm.cubiertas);
check('mesh llega a tres saltos',rm.saltosMax===3,rm.saltosMax);
check('mesh publica la suma exacta de saltos para carga',rm.saltosSuma===6,rm.saltosSuma);

const direct=(a,b)=>{
 const viable=(a.id==='A'&&b.id==='G1')||(b.id==='A'&&a.id==='G1')||
              (a.id==='C'&&b.id==='G2')||(b.id==='C'&&a.id==='G2');
 return {viable,margenDb:viable?10:-30};
};
const rd=TOP.analizaDirecta(nodos,direct,['G1','G2'],{umbralDb:8,raizDe:n=>'G'+n.ncu});
check('directa no rescata B aunque B pueda hablar con A/C por otra radio',rd.cubiertas===2,rd.cubiertas);
check('directa deja B sin ruta',rd.sinRuta.length===1&&rd.sinRuta[0]==='B',rd.sinRuta);
check('directa siempre tiene un salto',rd.saltosMax===1,rd.saltosMax);
check('directa suma un salto por TCU cubierta',rd.saltosSuma===2,rd.saltosSuma);
check('asignacion declarada: A y C estan cubiertas por su gateway',rd.asignadaOk===2,rd.asignadaOk);
check('con los dos gateways existentes no hay subconjunto que cubra todas',rd.minimoRaicesExistentes===null,JSON.stringify(rd.minimoRaicesExistentes));

const redund=(a,b)=>{
 const rootA=['G1','G2'].includes(a.id), rootB=['G1','G2'].includes(b.id);
 const viable=rootA!==rootB;
 return {viable,margenDb:viable?20:-20};
};
const rr=TOP.analizaDirecta(nodos,redund,['G1','G2'],{umbralDb:8});
check('si cada TCU ve ambos gateways, las tres tienen diversidad >=2',rr.conDosOMasGateways===3,rr.conDosOMasGateways);
check('y un solo gateway existente basta para cubrirlas',rr.minimoRaicesExistentes&&rr.minimoRaicesExistentes.n===1,JSON.stringify(rr.minimoRaicesExistentes));

const dos=(a,b)=>{
 const k=key(a.id,b.id);
 const ok=['A\u0000G1','B\u0000G1','C\u0000G2'].includes(k);
 return {viable:ok,margenDb:ok?15:-30};
};
const r2=TOP.analizaDirecta(nodos,dos,['G1','G2'],{umbralDb:8});
check('el solver encuentra DOS gateways cuando uno solo no basta',
      r2.minimoRaicesExistentes&&r2.minimoRaicesExistentes.n===2,
      JSON.stringify(r2.minimoRaicesExistentes));
const sinAsign=TOP.analizaDirecta(nodos,redund,['G1','G2'],{umbralDb:8});
check('sin binding previo, asignadaOk es null y no un cero engañoso',
      sinAsign.asignadaOk===null,JSON.stringify(sinAsign.asignadaOk));

console.log('\n'+(ko?'FALLAN '+ko+' de ':'TODO OK — ')+(ok+ko)+' comprobaciones');
process.exit(ko?1:0);
