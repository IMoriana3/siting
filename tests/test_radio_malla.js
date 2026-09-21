// La capa Zigbee y la malla: radio_zigbee.js y radio_malla.js.
//
// POR QUÉ ESTE BANCO. Dos cosas se pueden colar aquí sin que nadie las vea:
//
//   1. UN NÚMERO SUPUESTO. La variante estándar no tiene sensibilidad leída de
//      datasheet, así que NO puede dar margen. Si algún día devuelve un número,
//      es que alguien lo puso de memoria, y a partir de ahí nadie distingue un
//      margen medido de uno inventado. Aquí se exige `null` y su motivo.
//
//   2. UN GRAFO MAL LEÍDO. En un ÁRBOL todo nodo interno es punto de
//      articulación por definición: 31 de 53 en El Burgo. Presentarlos como
//      «puntos únicos de fallo» sería un disparate, y es un error fácil de
//      cometer porque el geojson del árbitro dibuja UNA línea por nodo —del
//      padre dominante al hijo—, o sea un árbol, no la malla.
//
// LOS GRAFOS DE PRUEBA ESTÁN RESUELTOS A MANO, no comparados contra la propia
// función. Camino, triángulo, pajarita y árbol: en los cuatro se sabe la
// respuesta antes de preguntarla.
//
//   node tests/test_radio_malla.js
//   MUTA=<clave> node tests/test_radio_malla.js      (TIENE que salir rojo)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};
const cerca = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol);

const MUTACIONES = {
  // ── radio_zigbee ──
  // la variante sin sensibilidad se inventa un margen: el fallo que este banco
  // existe para impedir
  sensInventada: ['zigbee', /if \(variante\.rx_sens_dbm == null\) \{/, 'if (false) {'],
  // el modo calibrado se da por hecho aunque no haya campaña
  siempreCalib:  ['zigbee', /if \(!calib\) return \{ lMod: 0, lRoce: 0, offset: 0, modo: TEORICO/,
                            'if (!calib) return { lMod: 0, lRoce: 0, offset: 0, modo: CALIBRADO'],
  // atravesar y rozar dejan de distinguirse: l_mod y l_roce pasan a ser lo mismo
  // (ancla movida al cortar contra el plano inclinado: `cuenta` ya no resuelve
  //  una banda con `corta`, resuelve el panel con `cortaPanel` y mira su estado)
  rozarEsTapar:  ['zigbee', /else if \(c\.estado === "hueco"\) roza\+\+;/, 'else if (c.estado === "hueco") atraviesa++;'],
  // la vegetación no modelada deja de avisar
  vegCallada:    ['zigbee', /if \(veg === null\) motivos\.push\("vegetacion_no_modelada"\);/, ''],
  // el canal desconocido deja de avisar: la Ptx de la PRO pasaria por buena
  // cuando puede ser 16 dB menos si la planta va por el canal 26
  canalCallado:  ['zigbee', /motivos\.push\("canal_desconocido_ptx_es_cota_superior"\);/, ''],

  // ── radio_malla ──
  // «no se sabe» pasa a contar como enlace bueno
  noSeSabeEsSi:  ['malla', /if \(r\.viable === null \|\| r\.viable === undefined\) \{/, 'if (false) {'],
  // la raíz deja de mirarse: se pierde el caso del nodo con dos hijos
  sinRaizArt:    ['malla', /if \(hijosRaiz > 1\) art\.add\(raiz\);/, ''],
  // un nodo inalcanzable pasa a tener 0 saltos en vez de null
  sinRutaEsCero: ['malla', /for \(var k of ady\.keys\(\)\) d\.set\(k, null\);/,
                           'for (var k of ady.keys()) d.set(k, 0);'],
  // deja de decir que la malla es un arbol: se pierde el aviso que impide leer
  // las articulaciones como puntos unicos de fallo
  nuncaArbol:    ['malla', /esArbol: aristas === nodos\.length - 1 && sinRuta\.length === 0,/,
                           'esArbol: false,'],
};
const MUTA = process.env.MUTA;
let fuenteZ = fs.readFileSync(path.join(RAIZ, 'radio_zigbee.js'), 'utf8');
let fuenteM = fs.readFileSync(path.join(RAIZ, 'radio_malla.js'), 'utf8');
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  const antes = m[0] === 'zigbee' ? fuenteZ : fuenteM;
  const nuevo = antes.replace(m[1], m[2]);
  if (nuevo === antes) { console.error('la mutacion «' + MUTA + '» no casó con el código'); process.exit(2); }
  if (m[0] === 'zigbee') fuenteZ = nuevo; else fuenteM = nuevo;
  console.log('### MUTACION «' + MUTA + '» PUESTA en ' + m[0] + ': este banco TIENE que salir rojo\n');
}

// Los tres módulos en el mismo contexto, como en la página: primero el motor,
// que es de quien cuelgan los otros dos.
const ctx = { module: { exports: {} }, globalThis: {}, console: console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'radio_pv_model.js'), 'utf8'), ctx);
ctx.module = { exports: {} };
vm.runInContext(fuenteZ, ctx);
const ZB = ctx.module.exports;
ctx.module = { exports: {} };
vm.runInContext(fuenteM, ctx);
const ML = ctx.module.exports;
const PARAMS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));

check('los tres módulos cargan y se ven entre ellos',
      !!(ctx.RadioPV && ZB && ZB.presupuesto && ML && ML.analiza));
if (!ZB || !ML) { console.log('\nFALLOS: ' + ko); process.exit(1); }

// ── LA CDF, CONTRA VALORES DE TABLA ─────────────────────────────────────────
// No contra la copia del modelo congelado: contra la normal de verdad. La
// aproximación de Abramowitz-Stegun 7.1.26 tiene error < 1,5e-7, así que se le
// exige eso y no más, que es lo honesto con la fórmula que se está usando.
console.log('\n· la probabilidad de enlace');
check('Φ(0) = 0,5', cerca(ZB.phi(0), 0.5, 1.5e-7), ZB.phi(0));
check('Φ(1,959964) = 0,975', cerca(ZB.phi(1.959963985), 0.975, 1.5e-7), ZB.phi(1.959963985));
check('Φ(−1,959964) = 0,025', cerca(ZB.phi(-1.959963985), 0.025, 1.5e-7), ZB.phi(-1.959963985));
check('Φ(1) = 0,8413447', cerca(ZB.phi(1), 0.8413447461, 1.5e-7), ZB.phi(1));
check('Φ(−3) = 0,0013499', cerca(ZB.phi(-3), 0.0013498980, 1.5e-7), ZB.phi(-3));
check('es simétrica: Φ(x) + Φ(−x) = 1', cerca(ZB.phi(0.7) + ZB.phi(-0.7), 1, 1e-12));

// ── LOS PARÁMETROS, TAL COMO ESTÁN HOY ──────────────────────────────────────
console.log('\n· lo que el JSON de parámetros dice y lo que calla');
const PRO = PARAMS.tecnologias.zigbee_pro_24, STD = PARAMS.tecnologias.zigbee_std_24;
check('la variante PRO trae sensibilidad', PRO.rx_sens_dbm === -103.0, PRO.rx_sens_dbm);
check('la ESTÁNDAR NO la trae, y eso es un dato, no un olvido', STD.rx_sens_dbm === null);
check('las dos traen `_fuente`', !!PRO._fuente && !!STD._fuente);
check('sigma sigue sin campaña', PARAMS.propagacion.sigma_db.valor === null);
check('y la vegetación sin modelo', PARAMS.vegetacion.modelo.valor === null);

const PROP = {
  eps_r_suelo: PARAMS.propagacion.eps_r_suelo.valor,
  sigma_suelo_s_m: PARAMS.propagacion.sigma_suelo_s_m.valor,
  polarizacion: PARAMS.propagacion.polarizacion.valor,
  sigma_db: PARAMS.propagacion.sigma_db.valor,           // null
  vegetacion: { modelo: PARAMS.vegetacion.modelo.valor }  // null
};

// ── EL BALANCE ──────────────────────────────────────────────────────────────
// Enlace de 60 m entre dos TCUs con las antenas a 0,775 m (viga 1,50 − caída
// 0,725, que es la altura del ajuste de El Burgo), dos filas en medio de canto.
console.log('\n· el balance de enlace, y lo que se niega a dar');
const R = ctx.RadioPV;
/* LA BANDA VERTICAL YA NO ESTA EN EL MOTOR. Vive en la referencia, con otro
   nombre, porque el motor no puede tener DOS funciones que den el despeje de
   una fila. Aqui se usa solo para construir el caso de prueba. */
const REF = require('./referencia_banda_vertical.js');
R.banda = REF.banda; R.corta = REF.corta;
/* EL ENLACE DE PRUEBA, con el contrato nuevo: el cruce trae la geometria de la
   fila -eje, cuerda, su alfa y el seno del angulo de cruce- y el motor corta
   contra el plano inclinado. Antes traia una banda vertical ya resuelta. */
const enlace = {
  D: 60, zA: 0.775, zB: 0.775,
  cruces: [{ s: 20, zEje: 2.0, cuerda: 2.38, alpha: 90, senPhi: 1 },
           { s: 40, zEje: 2.0, cuerda: 2.38, alpha: 90, senPhi: 1 }]
};
const pPro = ZB.presupuesto(enlace, PRO, PROP, null);
const pStd = ZB.presupuesto(enlace, STD, PROP, null);

check('la PRO sí da margen', typeof pPro.margenDb === 'number', pPro.margenDb);
check('LA ESTÁNDAR NO, porque no hay sensibilidad', pStd.margenDb === null, pStd.margenDb);
check('y dice por qué, en la salida', pStd.motivos.indexOf('sin_sensibilidad_no_hay_margen') >= 0,
      pStd.motivos.join(','));
check('pero sí da Prx, que no depende de la sensibilidad', typeof pStd.prxDbm === 'number', pStd.prxDbm);
check('la diferencia de Prx entre las dos son los 11 dB de potencia',
      cerca(pPro.prxDbm - pStd.prxDbm, PRO.ptx_dbm - STD.ptx_dbm, 1e-9),
      (pPro.prxDbm - pStd.prxDbm).toFixed(6));
check('sin campaña el modo es TEÓRICO, y va en la salida', pPro.modo === 'TEORICO', pPro.modo);
check('sin sigma no hay probabilidad de enlace', pPro.pEnlace === null);
check('y lo dice', pPro.motivos.indexOf('sin_sigma_no_hay_probabilidad') >= 0, pPro.motivos.join(','));
check('la vegetación sale como NO MODELADA, no como 0 dB', pPro.vegetacionDb === null &&
      pPro.motivos.indexOf('vegetacion_no_modelada') >= 0);
// EL CANAL. Entre el 26 y cualquier otro hay 16 dB de Ptx («Canal 26: máx +3»
// dice el modelo congelado, frente a +19). Mientras no se lea del inventario,
// el margen de la PRO es una COTA SUPERIOR y el motivo tiene que decirlo.
check('sin canal leido, avisa de que la Ptx es una cota superior',
      pPro.motivos.indexOf('canal_desconocido_ptx_es_cota_superior') >= 0, pPro.motivos.join(','));
check('el JSON declara el canal como pendiente, no lo supone',
      PARAMS.tecnologias.zigbee_pro_24.canal.valor === null);
const conCanal = Object.assign({}, PRO, { canal: { valor: 15 } });
check('y con el canal leido, ese aviso desaparece',
      ZB.presupuesto(enlace, conCanal, PROP, null)
        .motivos.indexOf('canal_desconocido_ptx_es_cota_superior') < 0);
console.log('     (medido: PRO ' + pPro.margenDb.toFixed(2) + ' dB de margen · pérdida total ' +
            pPro.perdidaTotalDb.toFixed(2) + ' dB, de los cuales ' +
            pPro.difraccionDb.toFixed(2) + ' de difracción)');

// ── ATRAVESAR NO ES ROZAR ───────────────────────────────────────────────────
// Es la distinción que separa `l_mod_db` de `l_roce_db`. Con las palas DE CANTO
// la banda se abre 2,38 m y el rayo a 0,775 m pasa por debajo (roza). Con las
// palas PLANAS la banda degenera en el plano del eje, a 2,0 m, y el rayo sigue
// pasando por debajo. Para que ATRAVIESE hay que subir las antenas dentro de la
// banda. Los tres casos, a mano.
console.log('\n· atravesar una mesa no es rozarla por debajo');
/* MISMA INTENCION, CONTRATO NUEVO. `cuenta` ya no recibe una banda vertical ya
   resuelta: recibe la geometria CRUDA de la fila y corta contra el plano
   inclinado. El cruce es {s, zEje, cuerda, alpha, senPhi}, y `senPhi` hace
   falta porque el canto vive a ±(c/2)·cos α del eje y hay que llevarlo de `w` a
   distancia recorrida. Un cruce SIN `senPhi` no es «cero obstaculos»: es un
   cruce que no se puede resolver, y por eso `cuenta` lo manda a `fuera`. */
const cruceCanto = (s, al) => ({ s: s, zEje: 2.0, cuerda: 2.38, alpha: al, senPhi: 1 });
const deCanto = R.banda(2.0, 2.38, 90, 0);   // 0,810 .. 3,190
check('de canto, la banda va de 0,810 a 3,190', cerca(deCanto.zBot, 0.81) && cerca(deCanto.zTop, 3.19),
      deCanto.zBot.toFixed(3) + '..' + deCanto.zTop.toFixed(3));
const cCanto = ZB.cuenta(60, 0.775, 0.775, [cruceCanto(30, 90)]);
check('a 0,775 m el rayo ROZA la mesa de canto, no la atraviesa',
      cCanto.roza === 1 && cCanto.atraviesa === 0, JSON.stringify(cCanto));
const cDentro = ZB.cuenta(60, 2.0, 2.0, [cruceCanto(30, 90)]);
check('a 2,0 m la ATRAVIESA', cDentro.atraviesa === 1 && cDentro.roza === 0, JSON.stringify(cDentro));
const cPlana = ZB.cuenta(60, 0.775, 0.775, [cruceCanto(30, 0)]);
check('con las palas planas, a 0,775 m también roza', cPlana.roza === 1, JSON.stringify(cPlana));
const cEncima = ZB.cuenta(60, 5.0, 5.0, [cruceCanto(30, 90)]);
check('y a 5,0 m pasa por encima, que no es ninguna de las dos',
      cEncima.porEncima === 1 && cEncima.atraviesa === 0 && cEncima.roza === 0, JSON.stringify(cEncima));
/* Y UN CRUCE QUE NO SE PUEDE RESOLVER SE CUENTA APARTE, no como «no tapa». */
const cSinPhi = ZB.cuenta(60, 0.775, 0.775, [{ s: 30, zEje: 2.0, cuerda: 2.38, alpha: 90, senPhi: 0 }]);
check('un cruce sin angulo (enlace paralelo a la fila) va a `fuera`, no a «no tapa»',
      cSinPhi.fuera === 1 && cSinPhi.roza === 0 && cSinPhi.atraviesa === 0, JSON.stringify(cSinPhi));

// ── UN JSON DE CALIBRACIÓN A MEDIAS LANZA ───────────────────────────────────
console.log('\n· la calibración, entera o ninguna');
const calibBuena = { l_mod_db: 4.5, l_roce_db: 2.0, offset_db: -3.0, version: '1.0', campana: 'ayora-2026' };
const cOk = ZB.correcciones(calibBuena);
check('con campaña, el modo es CALIBRADO', cOk.modo === 'CALIBRADO');
check('y arrastra versión y campaña', cOk.version === '1.0' && cOk.campana === 'ayora-2026');
let lanzo = false;
try { ZB.correcciones({ l_mod_db: 4.5, offset_db: -3.0 }); } catch (e) { lanzo = /l_roce_db/.test(e.message); }
check('un JSON a medias LANZA, en vez de rellenar el hueco con un cero', lanzo);
// y la calibración mueve el número en la dirección que debe
const pCal = ZB.presupuesto(enlace, PRO, PROP, calibBuena);
check('calibrado, el enlace con 2 mesas rozadas pierde 2·2,0 − 3,0 = 1,0 dB más',
      cerca(pCal.perdidaTotalDb - pPro.perdidaTotalDb, 2 * 2.0 - 3.0, 1e-9),
      (pCal.perdidaTotalDb - pPro.perdidaTotalDb).toFixed(6));

// ── LA MALLA: GRAFOS RESUELTOS A MANO ───────────────────────────────────────
console.log('\n· puntos de articulación, en grafos que se saben de memoria');
const grafo = pares => {
  const a = new Map();
  for (const [u, v] of pares) {
    if (!a.has(u)) a.set(u, []); if (!a.has(v)) a.set(v, []);
    a.get(u).push(v); a.get(v).push(u);
  }
  return a;
};
const orden = s => Array.from(s).sort().join(',');

// CAMINO A—B—C: sólo B parte el grafo
check('camino A—B—C: la articulación es B', orden(ML.articulaciones(grafo([['A','B'],['B','C']]))) === 'B');
// TRIÁNGULO: ninguna, porque siempre queda el otro lado
check('triángulo A—B—C—A: ninguna',
      orden(ML.articulaciones(grafo([['A','B'],['B','C'],['C','A']]))) === '');
// PAJARITA: dos triángulos que comparten X. Sólo X
check('pajarita (dos triángulos por X): sólo X',
      orden(ML.articulaciones(grafo([['A','B'],['B','X'],['X','A'],
                                     ['C','D'],['D','X'],['X','C']]))) === 'X');
// ESTRELLA: el centro, y sólo él
check('estrella de 5 puntas: sólo el centro',
      orden(ML.articulaciones(grafo([['C','1'],['C','2'],['C','3'],['C','4'],['C','5']]))) === 'C');
// ÁRBOL de 7 nodos: TODOS los internos. Ésta es la comprobación que impide
// presentar articulaciones de un árbol como «puntos únicos de fallo».
const arbol = grafo([['r','a'],['r','b'],['a','c'],['a','d'],['b','e'],['b','f']]);
check('árbol de 7 nodos: los 3 internos (r, a, b) y ninguna hoja',
      orden(ML.articulaciones(arbol)) === 'a,b,r');
// dos componentes separadas: cada una con las suyas
check('con dos componentes, se analizan las dos',
      orden(ML.articulaciones(grafo([['A','B'],['B','C'],['P','Q'],['Q','R']]))) === 'B,Q');

// ── SALTOS ──────────────────────────────────────────────────────────────────
console.log('\n· saltos al coordinador');
const cadena = grafo([['gw','a'],['a','b'],['b','c'],['c','d']]);
cadena.set('suelto', []);
const s = ML.saltos(cadena, ['gw']);
check('gw a 0 saltos, y d a 4', s.get('gw') === 0 && s.get('d') === 4, s.get('d'));
check('UN NODO SIN RUTA DA null, NO 0 ni Infinity', s.get('suelto') === null, s.get('suelto'));
const s2 = ML.saltos(cadena, ['gw', 'c']);
check('con dos raíces, se toma la más cercana', s2.get('d') === 1 && s2.get('b') === 1,
      'd=' + s2.get('d') + ' b=' + s2.get('b'));

// ── REDUNDANCIA ─────────────────────────────────────────────────────────────
console.log('\n· redundancia: a cuántos aísla cada nodo si cae');
// gw—X, y de X cuelgan dos triángulos. Si cae X se quedan sin ruta los 4
const red = ML.redundancia(grafo([['gw','X'],['X','A'],['A','B'],['B','X'],
                                  ['X','C'],['C','D'],['D','X']]), ['gw']);
check('si cae X, se quedan sin ruta los 4 de los triángulos', red.aislaA.get('X') === 4,
      red.aislaA.get('X'));
check('si cae A, no se queda nadie sin ruta: B llega por el otro lado',
      red.aislaA.get('A') === 0, red.aislaA.get('A'));
check('y A no es ni articulación', !red.articulaciones.has('A'));

// ── ANÁLISIS COMPLETO Y EL AVISO DEL ÁRBOL ──────────────────────────────────
console.log('\n· el aviso que impide leer mal un árbol');
const enRecta = n => Array.from({length: n}, (_, i) => ({ id: 'n' + i, x: i * 10, y: 0 }));
// enlaza sólo con el vecino inmediato: sale una cadena, que es un árbol
const soloVecino = (a, b) => ({ viable: Math.abs(a.x - b.x) <= 10.5, margenDb: 5 });
const anCadena = ML.analiza(enRecta(6), soloVecino, ['n0'], 100);
check('una cadena se detecta como ÁRBOL', anCadena.esArbol === true);
check('y entonces TODOS los internos salen articulación: 4 de 6',
      anCadena.articulaciones.size === 4, anCadena.articulaciones.size);
// con alcance de dos vecinos ya hay ciclos y deja de ser árbol
const dosVecinos = (a, b) => ({ viable: Math.abs(a.x - b.x) <= 20.5, margenDb: 5 });
const anRed = ML.analiza(enRecta(6), dosVecinos, ['n0'], 100);
check('con dos vecinos ya NO es árbol', anRed.esArbol === false);
check('y no queda ninguna articulación', anRed.articulaciones.size === 0, anRed.articulaciones.size);

// ── «NO SE SABE» NO ES «NO» ─────────────────────────────────────────────────
console.log('\n· «no se sabe» no entra en la malla, y se cuenta aparte');
const aVeces = (a, b) => (a.id === 'n0' && b.id === 'n1')
  ? { viable: null, margenDb: null }
  : { viable: Math.abs(a.x - b.x) <= 10.5, margenDb: 5 };
const anDesc = ML.analiza(enRecta(4), aVeces, ['n0'], 100);
check('el par desconocido NO se cuenta como enlace', anDesc.aristas === 2, anDesc.aristas);
check('pero queda anotado', anDesc.desconocidos.length === 1, anDesc.desconocidos.length);
check('y n0 se queda sin ruta, que es la consecuencia honesta',
      anDesc.sinRuta.length === 3 || anDesc.saltos.get('n1') === null,
      JSON.stringify(anDesc.sinRuta));

// ── LA ELIPSE FRENTE A LA FÍSICA ────────────────────────────────────────────
console.log('\n· la elipse de buildAdjacency frente al modelo');
const cmp = ML.compara(grafo([['a','b'],['b','c']]), grafo([['a','b'],['a','c']]));
check('un par en común de tres', cmp.ambas === 1, cmp.ambas);
check('uno sólo de la radio', cmp.soloRadio.length === 1, cmp.soloRadio.length);
check('uno sólo de la elipse', cmp.soloElipse.length === 1, cmp.soloElipse.length);
check('Jaccard = 1/3', cerca(cmp.jaccard, 1 / 3, 1e-12), cmp.jaccard);
const igual = grafo([['a','b'],['b','c']]);
check('dos mallas idénticas dan Jaccard 1', ML.compara(igual, igual).jaccard === 1);

// ── LA PODA SE CUENTA ───────────────────────────────────────────────────────
console.log('\n· la poda geométrica se declara');
const anPoda = ML.vecinosViables(enRecta(10), () => ({ viable: true, margenDb: 1 }), 15);
check('con alcance 15 sobre 45 pares, se podan 36', anPoda.podados === 36,
      anPoda.podados + ' podados / ' + anPoda.evaluados + ' evaluados');
check('y los evaluados son los 9 pares contiguos', anPoda.evaluados === 9, anPoda.evaluados);

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
                       : 'TODO OK — ' + ok + ' comprobaciones'));
if (MUTA) {
  console.log(ko ? '### bien: la mutacion «' + MUTA + '» sale roja'
                 : '### MAL: la mutacion «' + MUTA + '» pasa desapercibida');
}
process.exit(ko ? 1 : 0);
