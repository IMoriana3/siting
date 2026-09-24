// ESTADOS E INCERTIDUMBRE — fase 4, punto 5.
//
// QUÉ SE AFIRMA AQUÍ, y por qué cada cosa tiene su comprobación:
//
//   1. el estado de un enlace sale de ν y NO de un dB, porque ν es geometría y
//      longitud de onda: no depende de nada de lo que este repo tiene sin
//      calibrar (potencia, sensibilidad, sigma, correcciones de campaña);
//   2. el estado del RELIEVE se lee de su dB y NO de su ν, porque el ν del
//      perfil real lleva dentro el suelo plano que `dosRayosDb` ya cobra;
//   3. la procedencia sale del DATO —`procedencia` en `radio_params.json`— y
//      manda el más débil;
//   4. y todo eso llega A LA PANTALLA, que es donde faltaba: el motor sabía su
//      `modo` desde la fase 2 y la capa RF no lo enseñaba en ningún sitio.
//
//   node tests/test_rf_estado.js
//   MUTA=<clave> node tests/test_rf_estado.js     (TIENE que salir rojo)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra ? ' -> ' + extra : '')); }
};
const cerca = (a, b, t) => a != null && b != null && Math.abs(a - b) <= (t == null ? 1e-9 : t);

/* ── MUTACIONES ───────────────────────────────────────────────────────────
   Se aplican sobre COPIAS en un directorio temporal: los ficheros del repo no
   se tocan. Una puerta que nadie ha visto ponerse roja no es una puerta. */
const MUTACIONES = {
  // el umbral de despeje se mueve: -0,78 deja de ser libre
  bordeDespeje: ['radio_pv_model.js', 'if (nuMax <= NU_DESPEJA) return "libre";',
                                      'if (nuMax < NU_DESPEJA) return "libre";'],
  // el estado del relieve pasa a leerse de su ν, que es justo el doble conteo
  // del suelo plano: toda planta llana saldría «rozando»
  relievePorNu: ['radio_zigbee.js',
    'partes.relieve = { estado: relieveDb <= 0 ? "libre" : (relieveDb <= corte ? "rozando" : "tapado"),',
    'partes.relieve = { estado: RPV.estadoDeNu(relieveDet ? relieveDet.nuReal : null),'],
  // el peor deja de mandar y manda el primero
  peorNoManda: ['radio_zigbee.js',
    'var peor = RPV.peorEstado([partes.paneles.estado, partes.relieve.estado, partes.vegetacion.estado]);',
    'var peor = partes.paneles.estado;'],
  // «no mirado» se cuela como mirado: el enlace sale completo sin serlo
  completoRegalado: ['radio_zigbee.js', 'completo: sinMirar.length === 0', 'completo: true'],
  // un valor sin `procedencia` deja de cantar y se da por bueno
  sinRotularSeCuela: ['radio_zigbee.js',
    'if (Object.prototype.hasOwnProperty.call(o, "valor")) sinRotular.push(ruta);',
    'if (false) sinRotular.push(ruta);'],
  // manda el MÁS FUERTE en vez del más débil
  procedenciaOptimista: ['radio_zigbee.js', 'if (k > peorI) peorI = k;', 'if (peorI < 0 || k < peorI) peorI = k;'],
  // el umbral del relieve se teclea en vez de pedirse, y se teclea mal
  corteTecleado: ['radio_zigbee.js', 'var corte = RPV.perdidaFiloDb(0);', 'var corte = 60;'],
  // el DEM a vano corto vuelve a contar como veredicto
  demCuelaComoVisto: ['radio_zigbee.js', 'hayMotivo(motivos, "relieve_dem_sin_resolucion")', 'false'],
  // la anilla de «sin enlace» vuelve a ponerse por TAPADO: 190 de 215 enlaces
  // de El Burgo anillados, uno de ellos con 48,16 dB de margen
  anillaPorTapado: ['index.html', '  if(rfCalibrado()||rfMotor()==="antiguo") return v.margenDb!=null&&v.margenDb<8;\n  return false;',
                                  '  if(rfCalibrado()||rfMotor()==="antiguo") return v.margenDb!=null&&v.margenDb<8;\n  return !!(v.estado&&v.estado.estado==="tapado");'],
  // el tapado vuelve al rojo oscuro de la paleta de salud
  tapadoEnRojo: ['index.html', 'tapado:"#8c5a1e"', 'tapado:"#7a1d1d"'],
};
const MUTA = process.env.MUTA;
let DIR = RAIZ;
if (MUTA) {
  const mu = MUTACIONES[MUTA];
  if (!mu) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'estado-'));
  for (const f of ['radio_pv_model.js', 'radio_zigbee.js', 'zigbee_pv_model.js',
                   'radio_params.json', 'index.html'])
    fs.copyFileSync(path.join(RAIZ, f), path.join(DIR, f));
  const dest = path.join(DIR, mu[0]), antes = fs.readFileSync(dest, 'utf8');
  if (antes.split(mu[1]).length - 1 !== 1) {
    console.error('la mutacion «' + MUTA + '» no casó EXACTAMENTE una vez con ' + mu[0] +
                  ' (' + (antes.split(mu[1]).length - 1) + ' veces). Eso es NO COMPROBADO, no rojo.');
    process.exit(2);
  }
  fs.writeFileSync(dest, antes.replace(mu[1], mu[2]));
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}

const RadioPV = require(path.join(DIR, 'radio_pv_model.js'));
const RadioZigbee = require(path.join(DIR, 'radio_zigbee.js'));
const ZigbeePV = require(path.join(DIR, 'zigbee_pv_model.js'));
const PARAMS = JSON.parse(fs.readFileSync(path.join(DIR, 'radio_params.json'), 'utf8'));
const V = Object.assign({ nombre: 'zigbee_pro_24' }, PARAMS.tecnologias.zigbee_pro_24);
const PROP = { eps_r_suelo: 15, sigma_suelo_s_m: 0.005, polarizacion: 'v',
               sigma_db: null, vegetacion: { modelo: null } };

console.log('· 1. EL CLASIFICADOR: ν → estado, y los bordes exactos\n');

check('ν nulo es LIBRE: no hay canto que evaluar, que no es lo mismo que «no mirado»',
      RadioPV.estadoDeNu(null) === 'libre');
check('ν = -0,78 EXACTO es libre (J(ν) = 0 en P.526, el mismo umbral de Deygout)',
      RadioPV.estadoDeNu(-0.78) === 'libre' && RadioPV.perdidaFiloDb(-0.78) === 0);
check('un pelo por encima de -0,78 ya es rozando',
      RadioPV.estadoDeNu(-0.7799999) === 'rozando');
check('ν = 0 EXACTO todavía es rozando: el rayo directo pasa',
      RadioPV.estadoDeNu(0) === 'rozando');
check('un pelo por encima de 0 es tapado', RadioPV.estadoDeNu(1e-12) === 'tapado');
check('y J(0) vale 6,0329 dB, que es el corte que usa el relieve',
      cerca(RadioPV.perdidaFiloDb(0), 6.032852208563606, 1e-12));
check('el umbral es el MISMO que el de la recursión de Deygout (no hay dos)',
      RadioPV.NU_DESPEJA === -0.78);

check('el peor manda: libre + tapado es tapado',
      RadioPV.peorEstado(['libre', 'tapado']) === 'tapado');
check('y libre + rozando es rozando', RadioPV.peorEstado(['libre', 'rozando']) === 'rozando');
check('un mecanismo no evaluado (null) NO cuenta como estado',
      RadioPV.peorEstado(['libre', null]) === 'libre' && RadioPV.peorEstado([null]) === null);
let lanzo = false;
try { RadioPV.peorEstado(['gris']); } catch (e) { lanzo = true; }
check('un estado fuera del vocabulario LANZA, no se ignora', lanzo);

console.log('\n· 2. ν PUBLICADO COMO CAMPO, no dentro de una cadena\n');

const cruce = [{ s: 20, zEje: 1.5, cuerda: 2.382, alpha: 30, senPhi: 1 }];
const dTapa = RadioPV.difraccionPanelesDetalle(60, 0.8, 0.8, cruce, 2.45e9);
const dLibre = RadioPV.difraccionPanelesDetalle(60, 9, 9, cruce, 2.45e9);
const dNada = RadioPV.difraccionPanelesDetalle(60, 0.8, 0.8, [], 2.45e9);
check('con el dominante despejando, `nuMax` SALE aunque `dominante` sea null',
      dLibre.dominante === null && dLibre.nuMax != null && dLibre.nuMax <= -0.78, String(dLibre.nuMax));
check('y coincide con el ν que el motivo publica en texto',
      cerca(dLibre.nuMax, parseFloat(/nu = (-?[\d.]+)/.exec(dLibre.motivo)[1]), 5e-4));
check('sin cruces, `nuMax` es null y NO -1e9', dNada.nuMax === null);
check('con obstrucción, `nuMax` >= el ν del dominante',
      dTapa.nuMax >= dTapa.dominante.nu - 1e-12);

console.log('\n· 3. EL RELIEVE: SU ESTADO SALE DEL dB, NO DE SU ν\n');

/* ESTE ES EL CASO QUE CASI SE CUELA, y por eso está fijado con sus números.
   Con perfil PLANO, el ν del filo equivalente del perfil real vale -0,384 —el
   suelo invade de verdad el primer Fresnel, que a 100 m mide 1,75 m— y
   clasificar por ahí daría «rozando» en TODA PLANTA LLANA. Pero ese suelo YA
   está cobrado por `dosRayosDb`, que supone un plano reflectante debajo: es el
   mismo doble conteo que el relieve evita haciéndose POR DIFERENCIA. */
const llano = [], cerro = [];
for (let s = 0; s <= 100; s += 5) {
  llano.push([s, 739]);
  cerro.push([s, 739 + 3 * Math.exp(-Math.pow((s - 50) / 12, 2))]);
}
const relLlano = RadioPV.relieveDeltaDb(100, 739.475, 739.475, llano, 2.45e9);
check('con perfil PLANO el relieve es 0 EXACTO', relLlano.db === 0);
check('y sin embargo su ν es -0,384: clasificar por ahí pintaría rozando toda planta llana',
      cerca(relLlano.nuReal, -0.384071, 1e-5) && RadioPV.estadoDeNu(relLlano.nuReal) === 'rozando',
      String(relLlano.nuReal));

const enlLlano = RadioZigbee.presupuesto({ D: 100, zA: 739.475, zB: 739.475, cruces: [],
                                           perfil: llano, vanoMinUtil: 0 }, V, PROP, null);
check('EL ESTADO DEL RELIEVE EN LLANO ES LIBRE, no rozando',
      enlLlano.estado.partes.relieve.estado === 'libre',
      enlLlano.estado.partes.relieve.estado + ' (ν ' + relLlano.nuReal.toFixed(3) + ')');
check('y el ν del perfil real se publica igualmente, para poder discutirlo',
      cerca(enlLlano.estado.partes.relieve.nuReal, -0.384071, 1e-5));

const relCerro = RadioPV.relieveDeltaDb(100, 739.475, 739.475, cerro, 2.45e9);
const enlCerro = RadioZigbee.presupuesto({ D: 100, zA: 739.475, zB: 739.475, cruces: [],
                                           perfil: cerro, vanoMinUtil: 0 }, V, PROP, null);
check('un cerro de 3 m sí cobra relieve (16,37 dB)', cerca(relCerro.db, 16.3655, 1e-3), String(relCerro.db));
check('y su estado es TAPADO: pasa de J(0) = 6,03 dB',
      enlCerro.estado.partes.relieve.estado === 'tapado' && enlCerro.estado.estado === 'tapado');
check('el corte del relieve se PIDE al motor, no se teclea',
      cerca(enlCerro.estado.corteDb, RadioPV.perdidaFiloDb(0), 1e-12), String(enlCerro.estado.corteDb));

/* UN RELIEVE PEQUEÑO ES ROZANDO, no tapado: hace falta un caso ENTRE los dos
   cortes o el tramo del medio nunca se ejercita. */
const loma = [];
for (let s = 0; s <= 100; s += 5) loma.push([s, 739 + 0.55 * Math.exp(-Math.pow((s - 50) / 20, 2))]);
const enlLoma = RadioZigbee.presupuesto({ D: 100, zA: 739.475, zB: 739.475, cruces: [],
                                          perfil: loma, vanoMinUtil: 0 }, V, PROP, null);
check('una loma que cobra entre 0 y 6,03 dB sale ROZANDO',
      enlLoma.estado.partes.relieve.estado === 'rozando',
      enlLoma.estado.partes.relieve.estado + ' con ' + Number(enlLoma.relieveDb).toFixed(2) + ' dB');

console.log('\n· 4. LO NO MIRADO NO CUENTA COMO MIRADO\n');

const sinPerfil = RadioZigbee.presupuesto({ D: 60, zA: 0.8, zB: 0.8, cruces: [],
                                            perfil: null, vanoMinUtil: 0 }, V, PROP, null);
check('sin perfil, el relieve entra en `sinMirar` y NO como libre',
      sinPerfil.estado.partes.relieve.estado === null &&
      sinPerfil.estado.sinMirar.indexOf('relieve') >= 0);
check('la vegetación hoy NUNCA se evalúa, y eso también se dice',
      sinPerfil.estado.sinMirar.indexOf('vegetacion') >= 0);
check('así que HOY ningún enlace sale «completo»', sinPerfil.estado.completo === false);
check('y aun así hay estado: libre por los mecanismos que SÍ se han mirado',
      sinPerfil.estado.estado === 'libre');

const demCorto = RadioZigbee.presupuesto({ D: 40, zA: 739.475, zB: 739.475, cruces: [],
                                           perfil: llano.filter(p => p[0] <= 40), vanoMinUtil: 100 },
                                         V, PROP, null);
check('con DEM sin resolución a vano corto, el relieve va a `sinMirar`',
      demCorto.estado.partes.relieve.estado === null &&
      demCorto.estado.sinMirar.indexOf('relieve') >= 0,
      JSON.stringify(demCorto.estado.sinMirar));
check('y su motivo sigue viajando en la salida',
      demCorto.motivos.some(x => x.indexOf('relieve_dem_sin_resolucion') === 0));

console.log('\n· 5. LA PROCEDENCIA SALE DEL DATO\n');

const pr = RadioZigbee.procedencia(PARAMS, V, null);
check('hoy el rótulo es SIN VERIFICAR, porque los parámetros son heredados',
      pr.rotulo === 'SIN VERIFICAR' && pr.nivel === 'heredado', pr.rotulo + ' / ' + pr.nivel);
check('y dice CUÁL es el más débil, no sólo la clase',
      pr.peor.length > 0 && pr.peor.every(x => x.clase === 'heredado'));
check('avisa de que el canal es desconocido y la potencia es cota superior',
      pr.avisos.some(a => /canal/.test(a) && /cota superior/i.test(a)));
check('avisa de que sin sigma no hay probabilidad',
      pr.avisos.some(a => /sigma/.test(a) && /probabilidad/.test(a)));
check('avisa de que la vegetación no está modelada',
      pr.avisos.some(a => /vegetaci/i.test(a)));

const sinClase = JSON.parse(JSON.stringify(PARAMS));
delete sinClase.propagacion.eps_r_suelo.procedencia;
const prSin = RadioZigbee.procedencia(sinClase, V, null);
check('un valor SIN `procedencia` no se da por bueno: el rótulo se cae entero',
      prSin.rotulo === 'PROCEDENCIA DESCONOCIDA' &&
      prSin.sinRotular.indexOf('propagacion.eps_r_suelo') >= 0);

const claseMala = JSON.parse(JSON.stringify(PARAMS));
claseMala.propagacion.eps_r_suelo.procedencia = 'me_lo_ha_dicho_uno';
check('una clase fuera del vocabulario tampoco pasa',
      RadioZigbee.procedencia(claseMala, V, null).rotulo === 'PROCEDENCIA DESCONOCIDA');

const mejor = JSON.parse(JSON.stringify(PARAMS));
for (const k of ['eps_r_suelo', 'sigma_suelo_s_m', 'polarizacion']) mejor.propagacion[k].procedencia = 'medido';
check('con UN solo valor heredado, el rótulo sigue siendo SIN VERIFICAR (manda el más débil)',
      RadioZigbee.procedencia(mejor, V, null).rotulo === 'SIN VERIFICAR');
const todoBien = JSON.parse(JSON.stringify(PARAMS));
(function marca(o) {
  if (o && typeof o === 'object') {
    if (o.procedencia && o.procedencia !== 'pendiente') o.procedencia = 'medido';
    for (const k in o) marca(o[k]);
  }
})(todoBien);
const Vb = Object.assign({}, V, { procedencia: 'medido' });
check('y con TODOS medidos, el rótulo sube a MEDIDO',
      RadioZigbee.procedencia(todoBien, Vb, null).rotulo === 'MEDIDO',
      RadioZigbee.procedencia(todoBien, Vb, null).rotulo);
check('`sigma_db` pendiente NO arrastra el rótulo a NO DISPONIBLE: no entra en el margen',
      RadioZigbee.procedencia(todoBien, Vb, null).nivel === 'medido');

console.log('\n· 6. Y TODO ESO LLEGA A LA PANTALLA\n');

/* El bloque de la app, del `index.html` de verdad. El corte es más ancho que el
   de `test_rf_cobertura.js` porque lo que se prueba aquí —`rfVeredicto`,
   `rfColorVeredicto`, `leyendaRF`— vive DESPUÉS de `rfColor`. */
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const mb = html.match(/const RF_PITCH_M[\s\S]*?\n\}\n\s*(?=\/\* ── MAPA DE CALOR)/);
/* `leyendaRF` vive junto a `renderLegend`, lejos del bloque RF, así que se trae
   aparte y se corre en el MISMO contexto: es la función de la app, no una copia. */
const ml = html.match(/\/\* ══ LA LEYENDA DE LA CAPA RF[\s\S]*?\n\}\n(?=\s*\/\* ══|\s*function renderLegend)/);
check('el bloque RF de la app se localiza en index.html', !!mb);
check('y la leyenda de la capa RF también', !!ml);
if (!mb || !ml) { console.log('\nFALLAN ' + ko); process.exit(1); }
const ctx = {
  console, ZigbeePV, RadioPV, RadioZigbee, JSON, Math, Object, Array, Number, String,
  isFinite, parseFloat, document: { getElementById: () => null },
  S: { motors: [], p: { twid: 12, tlen: 64 }, bifila: null, _rfRows: null, rf: {},
       _radioParams: PARAMS, _radioCalib: null, v: { rf: true } },
};
ctx.window = ctx;
vm.createContext(ctx);
let compila = true;
try { vm.runInContext(mb[0] + '\n' + ml[0], ctx); }
catch (e) { compila = false; check('el bloque compila', false, e.message); }
if (compila) {
  /* `const` en un script de `vm` NO cuelga del contexto —sólo lo hacen `var` y
     las declaraciones de función—, así que las constantes se piden por su
     nombre en vez de leerlas de `ctx`. */
  const EST = vm.runInContext('RF_EST_COLOR', ctx), GRIS = vm.runInContext('RF_EST_GRIS', ctx);
  check('el bloque expone el veredicto y su color',
        typeof ctx.rfVeredicto === 'function' && typeof ctx.rfColorVeredicto === 'function');
  check('y la paleta de estados, con los tres', EST && EST.libre && EST.rozando && EST.tapado);
  const vLibre = { margenDb: 40, estado: { estado: 'libre' } };
  const vTapa = { margenDb: 40, estado: { estado: 'tapado' } };
  check('SIN campaña calibrada, el color es el del ESTADO y no el del dB',
        ctx.rfColorVeredicto(vTapa) === EST.tapado &&
        ctx.rfColorVeredicto(vLibre) === EST.libre);
  check('un margen buenísimo con el enlace TAPADO no se pinta de verde',
        ctx.rfColorVeredicto(vTapa) !== ctx.rfColor(40));
  ctx.S._radioCalib = { campana: 'X', l_mod_db: 0, l_roce_db: 0, offset_db: 0 };
  check('CON campaña calibrada, el dB vuelve a mandar',
        ctx.rfColorVeredicto(vTapa) === ctx.rfColor(40));
  ctx.S._radioCalib = null;
  check('sin veredicto, gris: ni bueno ni malo, DESCONOCIDO',
        ctx.rfColorVeredicto({ margenDb: null, estado: { estado: null } }) === GRIS);
  /* LA ANILLA, Y LA MEDIDA QUE LA CAMBIO. Ponerla por TAPADO habría anillado
     190 de los 215 enlaces de El Burgo, uno de ellos con 48,16 dB de margen:
     «tapado» dice que el rayo directo está cortado, no que el enlace no valga.
     «¿Llega?» es una pregunta de margen, y un margen sin campaña ni canal no es
     una predicción — así que sin calibrar no se anilla nada. */
  check('SIN calibrar, la anilla de «sin enlace» NO se pone, ni siquiera por tapado',
        ctx.rfVeredictoMalo(vTapa) === false && ctx.rfVeredictoMalo(vLibre) === false);
  ctx.S._radioCalib = { campana: 'X', l_mod_db: 0, l_roce_db: 0, offset_db: 0 };
  check('CON campaña, la anilla vuelve y va por el margen',
        ctx.rfVeredictoMalo({ margenDb: 3, estado: null }) === true &&
        ctx.rfVeredictoMalo({ margenDb: 30, estado: null }) === false);
  ctx.S._radioCalib = null;
  check('y nunca por no tener veredicto: desconocido no es malo',
        ctx.rfVeredictoMalo({ margenDb: null, estado: { estado: null } }) === false);
  check('el tapado NO se pinta con el rojo oscuro de la paleta de margen',
        EST.tapado !== ctx.rfColor(-1) && EST.tapado !== ctx.rfColor(3));
  check('y la leyenda dice que tapado no es «sin enlace»',
        /tapado NO es/.test(ctx.leyendaRF()) && /difracci/.test(ctx.leyendaRF()));
  check('y que «¿llega?» no la contesta esta capa sin campaña',
        /¿llega\?/.test(ctx.leyendaRF()));
  check('la leyenda de la capa RF existe y publica el rótulo de procedencia',
        /SIN VERIFICAR/.test(ctx.leyendaRF()));
  check('y publica qué significa el color',
        /libre/.test(ctx.leyendaRF()) && /tapado/.test(ctx.leyendaRF()));
  check('con la capa apagada no dice nada', ctx.leyendaRF() === '' || (function () {
    ctx.S.v.rf = false; const r = ctx.leyendaRF(); ctx.S.v.rf = true; return r === '';
  })());
}

/* LA PUERTA ÚNICA, Y POR QUÉ ESTO ES UNA COMPROBACION DE TEXTO.
   El bucle de dibujado llamaba a `rfMargin` DIRECTAMENTE —el motor ANTIGUO,
   con el sesgo de El Burgo de -33,6 dB dentro— saltándose `rfMargenDe`, así que
   los puntos del mapa y el panel de perfil podían mostrar dos motores distintos
   en el mismo enlace. No se puede comprobar ejecutando `draw()` sin navegador,
   así que se comprueba en el texto: quién llama a `rfMargin` y desde dónde. */
const llamadas = (html.match(/rfMargin\(/g) || []).length;
check('`rfMargin` (motor antiguo) sólo se nombra donde se define y donde el ' +
      'despachador la elige', llamadas === 2 + 1, String(llamadas) + ' apariciones');
check('el bucle de dibujado pasa por `rfVeredicto`, no por `rfMargin`',
      /m\._rfVer *= *\(m\.ncu/.test(html) && /col *= *rfColorVeredicto\(m\._rfVer\)/.test(html) &&
      !/col *= *rfColor\(m\._rfMargin\)/.test(html));

/* ── EL ALCANCE ──────────────────────────────────────────────────────────── */
const PISO_MUT = 10;
console.log('\nalcance: ' + Object.keys(MUTACIONES).length + ' mutaciones declaradas (piso ' +
            PISO_MUT + ') · 3 mecanismos mirados (paneles, relieve, vegetación) de 3 · ' +
            'la pantalla, con el bloque RF del index.html real');
if (Object.keys(MUTACIONES).length < PISO_MUT) {
  console.log('ALCANCE INSUFICIENTE: menos mutaciones que el piso. Esto no ha mirado.');
  process.exit(2);
}

console.log('');
if (ko) { console.log('FALLAN ' + ko + ' de ' + (ok + ko) + ' comprobaciones'); process.exit(1); }
console.log('TODO OK — ' + ok + ' comprobaciones');
