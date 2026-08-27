// NCU-01 — el siting dejaba NCUs pegadas (o encima) de las mesas. Banco sin navegador.
//
// Por qué existe este fichero: la queja de campo es literal — "pone NCUs sobre
// trackers". Tres agujeros medidos sobre el código anterior:
//   1. la espiral de separaDeModulos se conformaba con el PRIMER punto a 2 m de
//      una mesa, aunque a pocos metros hubiera un pasillo ancho o una calle
//      (los proyectos reales entregan las NCU a 4-22 m de la mesa más cercana);
//   2. cambiar las cotas de mesa del panel solo REDIBUJABA: la guarda quedaba
//      calculada con las cotas viejas y al ensanchar la mesa las NCU aparecían
//      pintadas encima;
//   3. las colocaciones que no pasaban por placeCut no tenían guarda ninguna:
//      el clic manual, el arrastre, la HSU a 7 m fijos y las NCU nuevas del
//      autositing conservador (ciegas a las mesas ya cubiertas);
//   4. el barrido moría a 30 m: en Páramo (sin cotas por TCU, el modelo del
//      panel funde las filas en un bloque macizo) los caminos de verdad están
//      a 57-85 m y las NCU se quedaban plantadas SOBRE las filas — y encima
//      de una mesa no se monta nada, sin excepciones.
//
// Cómo: extrae el núcleo de siting del index.html REAL —no una copia— y lo corre
// en un contexto con lo justo (`S`).
//
//   node tests/test_siting_ncu.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra ? ' -> ' + extra : '')); }
};

// ── extraer los bloques del HTML de verdad ──
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const grab = (re, name) => {
  const m = html.match(re);
  check('se localiza el bloque: ' + name, !!m);
  return m ? m[0] : '';
};
const src = [
  grab(/const dist2=[\s\S]*?const centroid=.*\n/, 'utilidades'),
  grab(/const FUV1=.*\n/, 'FUV1'),
  grab(/const FUV2=.*\n/, 'FUV2'),
  grab(/const PARAMO=.*\n/, 'PARAMO'),
  grab(/function convexHull[\s\S]*?function polyPerimeter.*\n/, 'convexHull'),
  grab(/function buildAdjacency[\s\S]*?\n(?=function nextNcuId)/, 'núcleo (adyacencia→relax)'),
  grab(/function siteAll[\s\S]*?\n(?=function suggestRSU)/, 'siteAll'),
  grab(/const HSU_OFFSET[\s\S]*?\n(?=\/\* ===================== Generador)/, 'placeRSUs'),
].join('\n');
if (ko) { console.log('\nFALLOS: ' + ko); process.exit(1); }

const ctx = { console, S: { p: { tlen: 64, twid: 4 } } };
vm.createContext(ctx);
try { vm.runInContext(src, ctx); } catch (e) { check('el núcleo compila', false, e.message); }
check('el núcleo compila y expone siteAll/separaDeModulos/dModulo/placeRSUs',
  typeof ctx.siteAll === 'function' && typeof ctx.separaDeModulos === 'function' &&
  typeof ctx.dModulo === 'function' && typeof ctx.placeRSUs === 'function');
if (ko) { console.log('\nFALLOS: ' + ko); process.exit(1); }

// ── utilidades de escenario ──
// retícula az=0: columnas a paso px (E-O), mesas de len x wid con centros a paso py (N-S)
function reticula({ nx, ny, px, py, L, W, conDims = true }) {
  const M = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const m = { x: i * px, y: j * py, pb: null, id: 'M' + (M.length + 1) };
    if (conDims) { m.len = L; m.wid = W; m.az = 0; }
    M.push(m);
  }
  return M;
}
function holg(x, y, motors, P) {
  let d = Infinity;
  for (const m of motors) { const e = ctx.dModulo(x, y, m, P); if (e < d) d = e; }
  return d;
}
const OPTS = { radius: 250, capNCU: 160, capGW: 80, reachX: 40, reachY: 90, gwAxis: 'EW' };
function sitea(motors, P) {
  ctx.S.p = Object.assign({ radius: 250, capNCU: 160, capGW: 80, gwAxis: 'EW' }, P);
  return vm.runInContext('(m,o)=>siteAll(m,o)', ctx)(motors, OPTS);
}

// ── 1) NINGUNA NCU DENTRO DE UNA MESA, Y GUARDA DE 2 m DONDE EL CAMPO LA DA ──
{
  const casos = [
    ['retícula 64x4', reticula({ nx: 30, ny: 8, px: 12, py: 70, L: 64, W: 4 }), { tlen: 64, twid: 4 }],
    ['tipo El Burgo 64x8,4', reticula({ nx: 30, ny: 8, px: 12, py: 70, L: 64, W: 8.4 }), { tlen: 64, twid: 8.4 }],
    ['CSV pelado (cotas del panel)', reticula({ nx: 30, ny: 8, px: 12, py: 70, conDims: false }), { tlen: 64, twid: 4 }],
  ];
  for (const [nombre, motors, P] of casos) {
    const ncus = sitea(motors, P);
    const dentro = ncus.filter(n => holg(n.x, n.y, motors, ctx.S.p) < 0).length;
    const justas = ncus.filter(n => holg(n.x, n.y, motors, ctx.S.p) < 2 - 1e-9).length;
    check(`${nombre}: ninguna NCU dentro de una mesa`, dentro === 0, dentro + ' dentro');
    check(`${nombre}: todas libran los 2 m (el campo los da)`, justas === 0, justas + ' por debajo');
    const R2 = 250 * 250;
    const fuera = ncus.reduce((a, n) => a + n.motorIdx.filter(i => {
      const dx = motors[i].x - n.x, dy = motors[i].y - n.y; return dx * dx + dy * dy > R2;
    }).length, 0);
    check(`${nombre}: separar de las mesas no saca a nadie del radio`, fuera === 0, fuera + ' TCU fuera');
  }
}

// ── 2) FUV I / FUV II (los datos reales del siting automático) ─────────────
for (const K of ['FUV1', 'FUV2']) {
  const P = vm.runInContext(K, ctx);
  const motors = P.pts.map((p, i) => ({ x: p[0], y: p[1], pb: null, id: 'M' + (i + 1) }));
  const ncus = sitea(motors, { tlen: 64, twid: 4 });
  const dentro = ncus.filter(n => holg(n.x, n.y, motors, ctx.S.p) < 0).length;
  const justas = ncus.filter(n => holg(n.x, n.y, motors, ctx.S.p) < 2 - 1e-9).length;
  const gwMal = ncus.filter(n => n.gw[0].length > 80 || n.gw[1].length > 80).length;
  check(`${P.name}: ninguna NCU dentro de una mesa`, dentro === 0, dentro + ' dentro');
  check(`${P.name}: todas libran los 2 m`, justas === 0, justas + ' por debajo');
  check(`${P.name}: buscar la calle no desborda ningún gateway`, gwMal === 0, gwMal + ' GW>80');
}

// ── 3) NIVEL CALLE: mejor el pasillo ancho que rozar la fila ───────────────
// 4 columnas de mesas 64x8,4 a paso 12 (pasillo E-O de 3,6 m: holgura máx 1,8)
// y campo abierto al este de la última columna. El punto de partida, en el
// pasillo central, ya "cumplía" para el código viejo en cuanto encontraba 2 m
// en el hueco N-S; el diseñador de verdad lo saca a la calle (>=6 m).
{
  const motors = [];
  for (const cx of [0, 12, 24, 36]) for (const cy of [0, 70])
    motors.push({ x: cx, y: cy, len: 64, wid: 8.4, az: 0, pb: null, id: 'M' + (motors.length + 1) });
  const P = { tlen: 64, twid: 8.4 }; ctx.S.p = P;
  const n = { x: 18, y: 15 };                      // pasillo entre columnas 2 y 3: holgura 1,8
  ctx.separaDeModulos(n, motors, [], P, 250);
  const h = holg(n.x, n.y, motors, P);
  check('automático: sale del pasillo estrecho a la calle (>=6 m)', h >= 6 - 1e-9, h.toFixed(2) + ' m');
  // ZOMBI: el código viejo paraba en el PRIMER punto con 2 m (el hueco N-S a
  // (18,35), holgura 3,5) y jamás llegaba a la calle. Si esta comprobación se
  // puede pasar quedándose a menos de 6 m, no prueba nada.
  check('ZOMBI: el hueco N-S del punto viejo NO llega a los 6 m',
    holg(18, 35, motors, P) < 6, holg(18, 35, motors, P).toFixed(2) + ' m');
}

// ── 4) FRONTERA GW RESPETADA: con ejeCorte, la calle no descoloca el corte ──
// El mismo escenario: sin restricción se va a la calle del este (mueve mucho
// la x); con ejeCorte "EW" —la frontera de los 2 gateways es x=NCU— el nivel
// calle queda vetado en x y se conforma con el hueco N-S, que sí libra los 2 m.
{
  const motors = [];
  for (const cx of [0, 12, 24, 36]) for (const cy of [0, 70])
    motors.push({ x: cx, y: cy, len: 64, wid: 8.4, az: 0, pb: null, id: 'M' + (motors.length + 1) });
  const P = { tlen: 64, twid: 8.4 }; ctx.S.p = P;
  const libre = { x: 18, y: 15 };
  ctx.separaDeModulos(libre, motors, [], P, 250);
  check('sin ejeCorte: la calle está en otra columna (|Δx| > 6)', Math.abs(libre.x - 18) > 6,
    'Δx=' + Math.abs(libre.x - 18).toFixed(1));
  const corte = { x: 18, y: 15 };
  ctx.separaDeModulos(corte, motors, [], P, 250, { ejeCorte: 'EW' });
  const h = holg(corte.x, corte.y, motors, P);
  check('con ejeCorte EW: no mueve la frontera más de la tolerancia', Math.abs(corte.x - 18) <= 6 + 1e-9,
    'Δx=' + Math.abs(corte.x - 18).toFixed(1));
  check('y aún así libra la guarda dura de 2 m', h >= 2 - 1e-9, h.toFixed(2) + ' m');
}

// ── 5) MANUAL (soloGuarda): corregir lo imprescindible, respetar la mano ───
{
  const motors = [];
  for (const cx of [0, 12, 24, 36]) for (const cy of [0, 70])
    motors.push({ x: cx, y: cy, len: 64, wid: 8.4, az: 0, pb: null, id: 'M' + (motors.length + 1) });
  const P = { tlen: 64, twid: 8.4 }; ctx.S.p = P;
  // clic ENCIMA de una mesa: se saca al punto legal más cercano, sin perseguir la calle
  const enMesa = { x: 12, y: 15 };
  ctx.separaDeModulos(enMesa, motors, [], P, 250, { soloGuarda: true });
  const h1 = holg(enMesa.x, enMesa.y, motors, P);
  const d1 = Math.hypot(enMesa.x - 12, enMesa.y - 15);
  check('clic sobre una mesa: la NCU sale a un punto legal (>=2 m)', h1 >= 2 - 1e-9, h1.toFixed(2) + ' m');
  check('y el desplazamiento es el mínimo, no la calle', d1 <= 25, d1.toFixed(1) + ' m recorridos');
  // clic en un punto LEGAL aunque justo: la mano del usuario no se toca
  const legal = { x: 18, y: 35 };                  // el hueco N-S: 3,5 m de holgura
  ctx.separaDeModulos(legal, motors, [], P, 250, { soloGuarda: true });
  check('clic en punto legal: no se toca (la posición es del usuario)',
    legal.x === 18 && legal.y === 35, `se movió a (${legal.x.toFixed(1)},${legal.y.toFixed(1)})`);
}

// ── 6) SIN SITIO NO SE MIENTE: pasillo < 2·guarda, holgura anotada ─────────
// Paso 10,5 con mesa de 8,4: pasillo de 2,1 m -> 1,05 de holgura máxima. No hay
// punto legal que cubra al grupo; lo honesto es quedarse en el mejor punto,
// ANOTAR la holgura real y que el panel avise (ámbar <2 m, rojo encima).
{
  const motors = reticula({ nx: 30, ny: 10, px: 10.5, py: 65, L: 64, W: 8.4 });
  const ncus = sitea(motors, { tlen: 64, twid: 8.4 });
  const dentro = ncus.filter(n => holg(n.x, n.y, motors, ctx.S.p) < 0).length;
  check('denso: ni aun así ninguna NCU dentro de una mesa', dentro === 0, dentro + ' dentro');
  const anotadas = ncus.filter(n => n.holgura != null && n.holgura < 2).length;
  check('denso: la holgura incumplida queda anotada para el aviso del panel',
    anotadas === ncus.length, anotadas + ' de ' + ncus.length + ' anotadas');
}

// ── 6b) PÁRAMO DESDE CERO: el caso que destapó el barrido corto ────────────
// Páramo no trae cotas por TCU, así que la mesa sale de Parámetros (64x4). Con
// filas a ~60 m y paso 7, ese modelo funde las filas en un bloque macizo con
// pasillos de 3 m — y el barrido de 30 m moría antes de llegar a los caminos
// (a 57-85 m del centro de carga), dejando las NCU SOBRE las filas, a 1,5 m
// (medido). La planta entregada monta sus NCU en esos caminos, a ~12 m. Con la
// prórroga, el reparto desde cero cae prácticamente donde el proyecto real:
// la NCU del PS 1 a <15 m de la real (494,279) y la del PS 3 a <10 m de la
// real (178,154).
{
  const P = vm.runInContext('PARAMO', ctx);
  const psOf = {}; P.ncus.forEach(n => { psOf[n[0]] = 'PS ' + n[1]; });
  const motors = P.tcus.map((t, i) => ({ x: t[0], y: t[1], pb: psOf[t[2]] || null, id: 'M' + (i + 1) }));
  const t0 = Date.now();
  const ncus = sitea(motors, { tlen: 64, twid: 4 });
  const ms = Date.now() - t0;
  const hs = ncus.map(n => holg(n.x, n.y, motors, ctx.S.p));
  check('Páramo: ninguna NCU dentro de una mesa', hs.every(h => h >= 0), hs.map(h => h.toFixed(1)).join(' '));
  check('Páramo: todas libran los 2 m (los caminos existen y ahora se alcanzan)',
    hs.every(h => h >= 2 - 1e-9), hs.map(h => h.toFixed(1)).join(' '));
  check('Páramo: la mayoría llega al camino (>=6 m), como la planta entregada',
    hs.filter(h => h >= 6 - 1e-9).length >= 3, hs.map(h => h.toFixed(1)).join(' '));
  const gwMal = ncus.filter(n => n.gw[0].length > 80 || n.gw[1].length > 80).length;
  check('Páramo: alcanzar el camino no desborda ningún gateway (margen GW exacto)', gwMal === 0, gwMal + ' GW>80');
  check('Páramo: y no se tarda una vida (<6 s el reparto entero)', ms < 6000, ms + ' ms');
}

// ── 6c) ENCIMA DE UNA MESA ES INADMISIBLE, la cobertura se sacrifica antes ─
// Un bloque macizo de verdad (mesas solapadas en x: paso 3 con ancho 4) y un
// grupo de radio 30: TODOS los puntos que cubren caen dentro de una mesa. El
// código anterior dejaba la NCU ahí dentro; ahora sale al primer punto legal
// aunque pierda cobertura — la cobertura se arregla (repetidor, otra NCU) y el
// panel la canta; una NCU dentro de una mesa no se puede montar.
{
  const motors = [];
  for (let i = -14; i <= 14; i++) motors.push({ x: i * 3, y: 0, len: 64, wid: 4, az: 0, pb: null, id: 'M' + (motors.length + 1) });
  const P = { tlen: 64, twid: 4 }; ctx.S.p = P;
  const idx0 = motors.findIndex(m => m.x === 0);
  const n = { x: 0, y: 0 };
  ctx.separaDeModulos(n, motors, [idx0], P, 30);
  const h = holg(n.x, n.y, motors, P);
  check('bloque macizo: la NCU NUNCA queda dentro de una mesa', h >= 2 - 1e-9, h.toFixed(2) + ' m');
}

// ── 7) LA HSU TAMPOCO SE PLANTA SOBRE UNA MESA ─────────────────────────────
// El desplazamiento fijo de 7 m se mide desde el CENTRO del seguidor: cuando la
// dirección "hacia afuera" apunta a lo largo de la mesa (64 m), los 7 m caen
// DENTRO de la propia mesa. Medido sobre el código anterior en este escenario:
// 2 de las 4 HSU dentro de una mesa (holgura -2,28 m) y las otras 2 a 1,18 m.
{
  const motors = reticula({ nx: 8, ny: 4, px: 12, py: 70, L: 64, W: 8.4 });
  const P = { tlen: 64, twid: 8.4, radius: 250 }; ctx.S.p = P;
  const hull = ctx.convexHull(motors);
  const ncus = [{ id: 'NCU-01', x: 42, y: 105 }];
  const rsus = ctx.placeRSUs(motors, hull, ncus, 4, 250);
  const malas = rsus.filter(r => holg(r.x, r.y, motors, P) < 2 - 1e-9);
  check('las HSU libran los 2 m a toda mesa', rsus.length === 4 && malas.length === 0,
    rsus.length + ' HSU, ' + malas.length + ' sin guarda: ' +
    malas.map(r => r.id + ' h=' + holg(r.x, r.y, motors, P).toFixed(2)).join(' '));
}

// ── 7b) HSU EN EL BLOQUE MACIZO (el caso Páramo de la captura de campo) ────
// Con las filas fundidas por las cotas del panel, los 7 m fijos dejaban la HSU
// dentro de la banda de mesas. La guarda con prórroga la saca al primer punto
// legal hacia afuera.
{
  const motors = [];
  for (const cy of [0, 60, 120]) for (let i = 0; i < 30; i++)
    motors.push({ x: i * 7, y: cy, len: 64, wid: 4, az: 0, pb: null, id: 'M' + (motors.length + 1) });
  const P = { tlen: 64, twid: 4, radius: 250 }; ctx.S.p = P;
  const hull = ctx.convexHull(motors);
  const ncus = [{ id: 'NCU-01', x: 101.5, y: 60 }];
  const rsus = ctx.placeRSUs(motors, hull, ncus, 3, 250);
  const malas = rsus.filter(r => holg(r.x, r.y, motors, P) < 2 - 1e-9);
  check('bloque macizo: ninguna HSU queda sobre las mesas', rsus.length === 3 && malas.length === 0,
    rsus.length + ' HSU, malas: ' + malas.map(r => r.id + ' h=' + holg(r.x, r.y, motors, P).toFixed(2)).join(' '));
}

// ── 8) CABLEADO: los caminos que no pasan por placeCut llevan la guarda ────
// Comprobaciones de FUENTE, no de comportamiento: placeNCUat/addNCU/arrastre/
// autoSite viven pegados al DOM y no se pueden ejecutar aquí. Si alguien quita
// la llamada, esto se pone rojo y el porqué está en la cabecera del fichero.
{
  const bloque = (re) => (html.match(re) || [''])[0];
  check('placeNCUat (clic) pasa por la guarda',
    /separaDeModulos/.test(bloque(/function placeNCUat[\s\S]*?\n}\n/)));
  check('addNCU (botón) pasa por la guarda',
    /separaDeModulos/.test(bloque(/function addNCU[\s\S]*?\n}\n/)));
  check('el arrastre de NCU pasa por la guarda al soltar',
    /separaDeModulos/.test(bloque(/pointerup[\s\S]*?mode==="ncu"[\s\S]*?applyNumbering\(\)/)));
  check('el autositing conservador re-libra las NCU nuevas contra la planta ENTERA',
    /_nueva[\s\S]*?separaDeModulos/.test(bloque(/function autoSite[\s\S]*?\n}\n/)));
  check('cambiar las cotas de mesa re-libra las NCU (no solo redibuja)',
    /separaDeModulos/.test(bloque(/\["tlen","twid"\]\.forEach[\s\S]*?draw\(\); \}\)\); \}\);/)));
  check('el panel avisa de NCU encima de una mesa',
    /encima de una mesa/.test(html));
}

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
  : 'OK — ' + ok + '/' + ok + ' comprobaciones'));
process.exit(ko ? 1 : 0);
