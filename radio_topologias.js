/* radio_topologias.js — topologia permitida encima del mismo enlace RF.
 *
 * MESH: Zigbee / Wi-SUN. Una arista TCU-TCU fisicamente viable puede
 * participar en el camino hacia una raiz.
 * DIRECTA: LoRa P2P / LoRaWAN. Solo cuentan TCU-gateway. Una TCU no se
 * convierte en repetidor porque oiga a otra.
 *
 * No calcula radio. Recibe enlaza(a,b) -> {viable,margenDb}.
 */
(function (raiz) {
  "use strict";
  var RM = (raiz && raiz.RadioMalla) ? raiz.RadioMalla
         : (typeof require === "function" ? require("./radio_malla.js") : null);
  if (!RM) throw new Error("radio_topologias: falta radio_malla.js");

  function mediana(xs) {
    if (!xs.length) return null;
    var a = xs.slice().sort(function(x,y){ return x-y; });
    var m = Math.floor(a.length/2);
    return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
  }

  function combinaciones(xs, k, cb, pref, ini) {
    pref = pref || []; ini = ini || 0;
    if (pref.length === k) return cb(pref.slice());
    for (var i=ini; i<=xs.length-(k-pref.length); i++) {
      pref.push(xs[i]);
      if (combinaciones(xs, k, cb, pref, i+1) === true) return true;
      pref.pop();
    }
    return false;
  }

  function minimoRaices(coberturaPorNodo, raices) {
    if (!raices.length) return null;
    var nodos = Array.from(coberturaPorNodo.keys());
    if (!nodos.length) return {n:0,raices:[]};
    if (raices.length > 16) return null;
    for (var k=1; k<=raices.length; k++) {
      var hallado = null;
      combinaciones(raices, k, function(sub) {
        var s = new Set(sub);
        var ok = nodos.every(function(n) {
          var vs = coberturaPorNodo.get(n) || [];
          return vs.some(function(v){ return s.has(v.raiz); });
        });
        if (ok) { hallado = sub.slice(); return true; }
        return false;
      });
      if (hallado) return { n:k, raices:hallado };
    }
    return null;
  }

  function analizaDirecta(nodos, enlaza, raices, opts) {
    opts = opts || {};
    var umbral = opts.umbralDb == null ? 0 : opts.umbralDb;
    var tope = opts.alcanceMax == null ? Infinity : opts.alcanceMax;
    var tope2 = tope * tope;
    var raizSet = new Set(raices || []);
    var porId = new Map(nodos.map(function(n){ return [n.id,n]; }));
    var roots = (raices || []).map(function(id){ return porId.get(id); }).filter(Boolean);
    var tcus = nodos.filter(function(n){ return !raizSet.has(n.id); });
    var cobertura = new Map(), desconocidos = [], podados = 0, evaluados = 0;
    var margenes = [], distancias = [], mejorMargen = new Map();

    for (var i=0; i<tcus.length; i++) {
      var n=tcus[i], vs=[];
      for (var j=0; j<roots.length; j++) {
        var r0=roots[j], dx=n.x-r0.x, dy=n.y-r0.y, d=Math.hypot(dx,dy);
        if (dx*dx+dy*dy > tope2) { podados++; continue; }
        evaluados++;
        var q=enlaza(n,r0);
        if (!q || q.viable == null || q.margenDb == null) {
          desconocidos.push([n.id,r0.id]); continue;
        }
        if (q.margenDb >= umbral && q.viable !== false) {
          vs.push({raiz:r0.id,margenDb:q.margenDb,distanciaM:d});
          margenes.push(q.margenDb); distancias.push(d);
        }
      }
      vs.sort(function(a,b){ return b.margenDb-a.margenDb; });
      cobertura.set(n.id,vs);
      mejorMargen.set(n.id,vs.length?vs[0].margenDb:null);
    }

    var sinRuta=[], una=[], dosOMas=[], asignadaOk=[], asignadaKo=[];
    var tieneAsignacion = typeof opts.raizDe === "function";
    for (var k=0; k<tcus.length; k++) {
      var nd=tcus[k], v=cobertura.get(nd.id)||[];
      if (!v.length) sinRuta.push(nd.id);
      else if (v.length===1) una.push(nd.id); else dosOMas.push(nd.id);
      if (tieneAsignacion) {
        var rid=opts.raizDe(nd);
        if (rid!=null) {
          if (v.some(function(x){ return x.raiz===rid; })) asignadaOk.push(nd.id);
          else asignadaKo.push(nd.id);
        }
      }
    }
    var minimo=minimoRaices(cobertura, roots.map(function(r){return r.id;}));
    return {
      topologia:"directa", semantica:"TCU-gateway; las TCU no retransmiten",
      umbralDb:umbral, tcus:tcus.length, raices:roots.length,
      cubiertas:tcus.length-sinRuta.length, sinRuta:sinRuta,
      conUnGateway:una.length, conDosOMasGateways:dosOMas.length,
      asignadaOk:tieneAsignacion?asignadaOk.length:null,
      asignadaKo:tieneAsignacion?asignadaKo:null,
      minimoRaicesExistentes:minimo,
      saltosMax:sinRuta.length===tcus.length?null:1,
      saltosMediano:sinRuta.length===tcus.length?null:1,
      saltosSuma:tcus.length-sinRuta.length,
      saltosMedio:(tcus.length-sinRuta.length)?1:null,
      maxDistanciaViableM:distancias.length?Math.max.apply(null,distancias):null,
      distanciaMedianaViableM:mediana(distancias),
      margenMinDb:margenes.length?Math.min.apply(null,margenes):null,
      margenMedianoDb:mediana(margenes),
      evaluados:evaluados,podados:podados,desconocidos:desconocidos,
      coberturaPorNodo:cobertura,mejorMargen:mejorMargen
    };
  }

  function analizaMalla(nodos, enlaza, raices, opts) {
    opts=opts||{};
    var umbral=opts.umbralDb==null?0:opts.umbralDb;
    var fn=function(a,b){
      var q=enlaza(a,b);
      if(!q||q.viable==null||q.margenDb==null) return {viable:null,margenDb:null};
      return {viable:q.viable!==false && q.margenDb>=umbral,margenDb:q.margenDb};
    };
    var r=RM.analiza(nodos,fn,raices,opts.alcanceMax);
    var porId=new Map(nodos.map(function(n){return [n.id,n];}));
    var ds=[], ms=[];
    for(var it of r.ady){
      var u=it[0],vs=it[1];
      for(var i=0;i<vs.length;i++){
        if(u>=vs[i]) continue;
        var a=porId.get(u),b=porId.get(vs[i]);
        if(a&&b) ds.push(Math.hypot(a.x-b.x,a.y-b.y));
        var m=r.margenes.get(RM.clave(u,vs[i])); if(m!=null) ms.push(m);
      }
    }
    var hops=[];
    for(var sd of r.saltos){
      var id=sd[0],d=sd[1];
      if((raices||[]).indexOf(id)<0 && d!=null) hops.push(d);
    }
    r.topologia="mesh"; r.semantica="TCU-TCU y TCU-gateway pueden formar caminos multisalto";
    r.umbralDb=umbral;
    r.cubiertas=nodos.length-(raices||[]).length-r.sinRuta.length;
    r.tcus=nodos.length-(raices||[]).length;
    r.conDosOMasGateways=null;
    r.saltosMax=hops.length?Math.max.apply(null,hops):null;
    r.saltosMediano=mediana(hops);
    r.saltosSuma=hops.length?hops.reduce(function(a,b){return a+b;},0):0;
    r.saltosMedio=hops.length?r.saltosSuma/hops.length:null;
    r.maxDistanciaViableM=ds.length?Math.max.apply(null,ds):null;
    r.distanciaMedianaViableM=mediana(ds);
    r.margenMinDb=ms.length?Math.min.apply(null,ms):null;
    r.margenMedianoDb=mediana(ms);
    return r;
  }

  var API={analizaDirecta:analizaDirecta,analizaMalla:analizaMalla,
           minimoRaices:minimoRaices,mediana:mediana};
  raiz.RadioTopologias=API;
  if(typeof module!=="undefined"&&module.exports) module.exports=API;
})(typeof window!=="undefined"?window:globalThis);
