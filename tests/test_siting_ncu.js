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
  grab(/const AYORA=.*\n/, 'AYORA'),
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

// ── 1b) SATURACIÓN: el mínimo de NCUs que el radio permite ─────────────────
// 300 seguidores con cap. 160 son DOS NCUs si el radio llega — y la partición
// golosa dejaba fragmentos: medido en este mismo rectángulo, 7 NCUs de
// 58/70/46/68/21/28/9. La pasada de saturación (k-centro con tope de
// capacidad) re-resuelve cada componente con la k mínima que valida radio con
// margen, capacidad y malla conexa.
{
  const motors = reticula({ nx: 50, ny: 6, px: 12, py: 70, L: 64, W: 4 });   // 300 justos, 588x350
  const ncus = sitea(motors, { tlen: 64, twid: 4 });
  const R2 = 250 * 250;
  const fuera = ncus.reduce((a, n) => a + n.motorIdx.filter(i => {
    const dx = motors[i].x - n.x, dy = motors[i].y - n.y; return dx * dx + dy * dy > R2;
  }).length, 0);
  check('300 seguidores en rectángulo: DOS NCUs, no una nube de fragmentos',
    ncus.length === 2, ncus.length + ' NCU (' + ncus.map(n => n.count).join('/') + ') — la partición golosa daba 7');
  check('saturación: ninguna NCU sobre capacidad y nadie fuera de radio',
    ncus.every(n => n.count <= 160) && fuera === 0, ncus.map(n => n.count).join('/') + ' · fuera: ' + fuera);
  // y donde el radio NO da para menos, no se fuerza: planta alargada 984x280,
  // las mitades quedarían a >250 m de su centro -> el mínimo geométrico es 3
  const larga = reticula({ nx: 83, ny: 5, px: 12, py: 70, L: 64, W: 4 }).slice(0, 300);
  const ncus2 = sitea(larga, { tlen: 64, twid: 4 });
  check('planta alargada: 3 NCUs (2 son geométricamente imposibles con radio 250)',
    ncus2.length === 3, ncus2.length + ' NCU (' + ncus2.map(n => n.count).join('/') + ')');
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

// ── 5b) LA GUARDA ES CONFIGURABLE (Parámetros: "Libre NCU" / "Libre HSU") ──
// El 2 y el 6 son los valores de fábrica, no un dogma: cada proyecto pide su
// distancia libre alrededor del equipo. opts.guarda la fija por colocación y
// S.p.clearNCU/clearHSU la llevan desde el panel; la calle objetivo nunca
// baja de la guarda pedida.
{
  const motors = [];
  for (const cx of [0, 12, 24, 36]) for (const cy of [0, 70])
    motors.push({ x: cx, y: cy, len: 64, wid: 8.4, az: 0, pb: null, id: 'M' + (motors.length + 1) });
  const P = { tlen: 64, twid: 8.4 }; ctx.S.p = P;
  const n = { x: 12, y: 15 };                      // encima de una mesa
  ctx.separaDeModulos(n, motors, [], P, 250, { soloGuarda: true, guarda: 5 });
  const h = holg(n.x, n.y, motors, P);
  check('guarda configurable: con 5 m pedidos, el punto legal libra 5', h >= 5 - 1e-9, h.toFixed(2) + ' m');
  // y por el panel: siteAll con S.p.clearNCU=4 en una retícula donde el default 2 daba menos
  const ret = reticula({ nx: 30, ny: 8, px: 12, py: 70, L: 64, W: 4 });
  const ncus = sitea(ret, { tlen: 64, twid: 4, clearNCU: 4 });
  const malas = ncus.filter(x => holg(x.x, x.y, ret, ctx.S.p) < 4 - 1e-9).length;
  check('guarda configurable: siteAll respeta el "Libre NCU" del panel (4 m)', malas === 0, malas + ' por debajo');
}

// ── 5c) GUARDA ALTA: se persigue hasta 180 m antes de rendirse ─────────────
// La guarda configurada es DURA ("si no puede estar a menos, no puede"). Con
// "Libre NCU" 6 en un campo cuyos pasillos dan 4,5 como mucho, el punto legal
// está FUERA del campo — a ~120 m del centro de carga, más allá de la antigua
// prórroga de 90: el último tramo del barrido (hasta BARRIDO_MAX=180) lo
// alcanza y las NCU CUMPLEN, no se quedan a 4,5 con un aviso. Los gateways no
// desbordan jamás por la guarda: el corte es lógico (_gwCut) y se reclava.
{
  const motors = reticula({ nx: 50, ny: 6, px: 12, py: 70, L: 64, W: 4 });
  const ncus = sitea(motors, { tlen: 64, twid: 4, clearNCU: 6 });
  const gwMal = ncus.filter(n => n.gw[0].length > 80 || n.gw[1].length > 80).length;
  const hs = ncus.map(n => holg(n.x, n.y, motors, ctx.S.p));
  check('guarda 6 en campo de 4-5: ningún gateway desborda por perseguirla', gwMal === 0, gwMal + ' GW>80');
  check('el punto legal está a ~120 m y el barrido largo lo alcanza: TODAS a >=6',
    hs.every(h => h >= 6 - 1e-9), hs.map(h => h.toFixed(1)).join(' '));
  // la HSU sí persigue su guarda con la prórroga: naive dentro de la mesa, "Libre HSU" 10
  ctx.S.p = { tlen: 64, twid: 4, radius: 250 };
  const pos = { x: 114, y: 20 };                     // dentro de una mesa
  ctx.separaDeModulos(pos, motors, [], ctx.S.p, 250, { soloGuarda: true, prorroga: true, guarda: 10 });
  const h = holg(pos.x, pos.y, motors, ctx.S.p);
  check('HSU con guarda 10 desde dentro de una mesa: sale hasta los 10 m', h >= 10 - 1e-9, h.toFixed(2) + ' m');
}

// ── 5d) MARGEN GW SIN PUNTO LEGAL: la guarda manda y el GW ni se entera ────
// Bífila densa medida: una NCU de 141 con margen GW de 35 m donde NO existe
// ningún punto con los 2 m. La guarda es dura: la NCU sale del margen a por
// su punto legal — y el reparto en gateways, que es LÓGICO (qué TCU habla
// con qué GW del mismo armario), se reclava en el borde del margen (_gwCut)
// y corta por ahí: ni guarda incumplida ni GW desbordado (antes: 85/56).
{
  const pip = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; };
  const mulberry32 = a => () => { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rnd = mulberry32(4000), R = [[0, 0], [580, 0], [580, 490], [0, 490]], pts = [];
  for (let y = 0; y <= 490; y += 70) for (let x = 0; x <= 580; x += 12)
    if (pip(x, y, R)) pts.push({ x: x + (rnd() - 0.5), y: y + (rnd() - 0.5) * 2 });
  pts.sort((a, b) => a.y - b.y || a.x - b.x);
  const motors = pts.slice(0, 400).map((p, i) => ({ x: p.x, y: p.y, pb: null, id: 'M' + (i + 1), len: 64, wid: 8.4, az: 0 }));
  const ncus = sitea(motors, { tlen: 64, twid: 8.4, clearNCU: 2 });
  const gwMal = ncus.filter(n => n.gw[0].length > 80 || n.gw[1].length > 80).length;
  check('bífila densa: ningún gateway desborda aunque el margen no dé la guarda', gwMal === 0,
    ncus.map(n => n.gw[0].length + '/' + n.gw[1].length).join(' '));
  const hs5d = ncus.map(n => holg(n.x, n.y, motors, ctx.S.p));
  check('y la guarda dura se cumple saliendo del margen', hs5d.every(h => h >= 2 - 1e-9),
    hs5d.map(h => h.toFixed(2)).join(' '));
}

// ── 5e) GUARDA DURA CON EL BORDE A ALCANCE: se cumple, cueste lo que cueste ─
// Planta baja (2 filas): el pasillo interior da 4 como mucho, pero el borde
// está a ~77 m — dentro de la prórroga. Con "Libre NCU" 10 la NCU tiene que
// SALIR del campo hasta los 10 m, no quedarse a 4 con un aviso.
{
  const motors = reticula({ nx: 30, ny: 2, px: 12, py: 70, L: 64, W: 4 });
  const ncus = sitea(motors, { tlen: 64, twid: 4, clearNCU: 10 });
  const hs = ncus.map(n => holg(n.x, n.y, motors, ctx.S.p));
  const R2 = 250 * 250;
  const fuera = ncus.reduce((a, n) => a + n.motorIdx.filter(i => {
    const dx = motors[i].x - n.x, dy = motors[i].y - n.y; return dx * dx + dy * dy > R2;
  }).length, 0);
  check('guarda 10 con borde a alcance: TODAS las NCU a >=10 m', hs.every(h => h >= 10 - 1e-9),
    hs.map(h => h.toFixed(1)).join(' '));
  check('y sin perder cobertura al salir', fuera === 0, fuera + ' TCU fuera');
}

// ── 6) SIN SITIO NO SE MIENTE: guarda inalcanzable, holgura anotada y ROJO ─
// Paso 10,5 con mesa de 8,4: pasillo de 2,1 m -> 1,05 de holgura máxima. En
// una planta que el siting parte en NCUs de borde, el barrido largo (180 m)
// llega al exterior y CUMPLE; para el caso inalcanzable de verdad hace falta
// un punto a >180 m de todo borde: campo denso de ~500x500 y la NCU en el
// centro. Ahí lo honesto es quedarse en el mejor punto, ANOTAR la holgura
// real y que el panel lo ponga en ROJO (guarda dura: por debajo es
// incumplimiento, nunca un "ya vale").
{
  const motors = reticula({ nx: 30, ny: 10, px: 10.5, py: 65, L: 64, W: 8.4 });
  const ncus = sitea(motors, { tlen: 64, twid: 8.4 });
  const dentro = ncus.filter(n => holg(n.x, n.y, motors, ctx.S.p) < 0).length;
  check('denso: ninguna NCU dentro de una mesa', dentro === 0, dentro + ' dentro');
  const cortas = ncus.filter(n => { const h = holg(n.x, n.y, motors, ctx.S.p);
    return h < 2 - 1e-9 && !(n.holgura != null && n.holgura < 2); }).length;
  check('denso: o cumple los 2 m o la holgura real queda anotada para el ROJO',
    cortas === 0, cortas + ' cortas sin anotar');
  // centro de un campo 500x500: el borde queda a ~255 m, fuera incluso del barrido largo
  const grande = reticula({ nx: 48, ny: 8, px: 10.5, py: 65, L: 64, W: 8.4 });
  ctx.S.p = { tlen: 64, twid: 8.4, radius: 250 };
  const n6 = { x: 247, y: 227, motorIdx: [] };
  const cercanos = []; grande.forEach((m, i) => { if (Math.hypot(m.x - 247, m.y - 227) < 120) cercanos.push(i); });
  n6.motorIdx = cercanos;
  ctx.separaDeModulos(n6, grande, cercanos, ctx.S.p, 250, { guarda: 2 });
  const h6 = holg(n6.x, n6.y, grande, ctx.S.p);
  check('inalcanzable de verdad: fuera de mesa, en el mejor punto (~1,05) y anotado <2',
    h6 >= 0 && h6 < 2 && n6.holgura != null && n6.holgura < 2 && Math.abs(n6.holgura - h6) < 0.1,
    'holgura ' + h6.toFixed(2) + ' anotada ' + n6.holgura);
}

// ── 6a) PÁRAMO TRAE SUS COTAS MEDIDAS ──────────────────────────────────────
// "No trae cotas" dejó de ser verdad: el DWG de la planta está medido en la
// cartera (paramo_layout.json: 240 seguidores 1V46 + 156 1V48) y el preset
// lleva ahora el largo por seguidor (46/48 módulos x 1,146 m = 52,72/55,01) y
// la cuerda 1V (2,38 = alto de módulo; el gcr 0,397 del geojson la corrobora:
// 0,397 x paso 6). Emparejado por coordenadas (peor caso 5 cm) porque los IDs
// del preset se repiten por NCU. Con estas cotas los huecos reales entre mesas
// apiladas son ~7 m: el campo es navegable y el reparto se queda cerca del
// centro de carga, legal.
{
  const P = vm.runInContext('PARAMO', ctx);
  const conCotas = P.tcus.filter(t => t[6] != null && t[7] != null).length;
  check('el preset de Páramo trae cotas medidas en los 396 TCU', conCotas === P.tcus.length,
    conCotas + ' de ' + P.tcus.length);
  const largos = [...new Set(P.tcus.map(t => t[6]))].sort();
  check('con los dos largos del DWG (1V46 52,72 · 1V48 55,01)',
    largos.length === 2 && Math.abs(largos[0] - 52.72) < 0.01 && Math.abs(largos[1] - 55.01) < 0.01,
    largos.join(' '));
  const motors = P.tcus.map((t, i) => ({ x: t[0], y: t[1], pb: null, id: 'M' + (i + 1), len: t[6], wid: t[7], az: 0 }));
  const ncus = sitea(motors, { tlen: 64, twid: 4 });
  const hs = ncus.map(n => holg(n.x, n.y, motors, ctx.S.p));
  check('Páramo con cotas reales: todas las NCU libran la guarda cerca del centro de carga',
    hs.every(h => h >= 2 - 1e-9), hs.map(h => h.toFixed(1)).join(' '));
}

// ── 6a2) LAS COTAS DE AYORA SON EL DATO DEL DWG, y nadie las pisa ──────────
// Lección aprendida a base de error propio: el preset de Ayora SIEMPRE trajo
// sus cotas medidas (74,76/56,31/37,85 x 8,384, bífilo 2,384) — lo único roto
// era el DISPLAY del panel, que enseñaba el 64x4 de fábrica. Una "mejora"
// llegó a pisar el dato con una derivación equivocada (paso de módulo de El
// Burgo en vez del módulo ancho de Ayora: 2x28x1,3346=74,76; y el gcr da el
// COLECTOR de 4,77 = 2 filas x 2,384, no la envolvente de 8,384). Este test
// congela el dato para que no vuelva a ocurrir.
{
  const P = vm.runInContext('AYORA', ctx);
  const conCotas = P.tcus.filter(t => t[6] != null && Math.abs(t[7] - 8.384) < 0.001).length;
  check('el preset de Ayora trae el dato del DWG en los 754 TCU (envolvente 8,384)',
    conCotas === P.tcus.length, conCotas + ' de ' + P.tcus.length);
  const largos = [...new Set(P.tcus.map(t => Math.round(t[6] * 100) / 100))].sort((a, b) => a - b);
  check('con los tres largos del DWG (37,85 · 56,31 · 74,76) y bífilo 2,384',
    largos.length === 3 && Math.abs(largos[0] - 37.85) < 0.01 && Math.abs(largos[2] - 74.76) < 0.01 &&
    P.bifilo && Math.abs(P.bifilo.cuerda - 2.384) < 0.001, largos.join(' '));
  // coherencia geométrica del dato: ninguna mesa pisa a su vecina de columna
  const cols = {};
  P.tcus.forEach(t => { (cols[Math.round(t[0] / 3) * 3] = cols[Math.round(t[0] / 3) * 3] || []).push(t); });
  let hueco = 1e9;
  for (const k in cols) { const ts = cols[k].sort((x, y) => x[1] - y[1]);
    for (let i = 1; i < ts.length; i++) { const a = ts[i - 1], b = ts[i];
      if (b[1] - a[1] < 90) hueco = Math.min(hueco, (b[1] - b[6] / 2) - (a[1] + a[6] / 2)); } }
  check('y ninguna mesa solapa a su vecina de columna (bloques punta con punta: 0,09 m)',
    hueco >= 0, hueco.toFixed(2) + ' m');
}

// ── 6b) EL MISMO PÁRAMO SIN COTAS: el caso que destapó el barrido corto ────
// El caso genérico sigue existiendo (un CSV pelado de otra planta): sin cotas
// por TCU la mesa sale de Parámetros (64x4). Con
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

// ── 7c) LAS HSU RODEAN LA PLANTA (sectores, no longitud de perímetro) ──────
// El requisito es meteorológico: viento y nubes entran por cualquier lado, así
// que las estaciones tienen que repartirse alrededor — no dos al norte y
// ninguna al sur. Medido con el reparto anterior (por arco de perímetro) en
// FUV I con 4 HSU: dos salían pegadas (rumbos 34° y 39°) y quedaba un flanco
// de 157° sin estación. Con sectores: ninguna pareja pegada y ningún flanco
// gigante.
{
  const F = vm.runInContext('FUV1', ctx);
  const motors = F.pts.map((p, i) => ({ x: p[0], y: p[1], pb: null, id: 'M' + (i + 1) }));
  const ncus = sitea(motors, { tlen: 64, twid: 4 });
  const hull = ctx.convexHull(motors.map(m => ({ x: m.x, y: m.y })));
  const rsus = ctx.placeRSUs(motors, hull, ncus, 4, 250);
  let cx = 0, cy = 0; for (const m of motors) { cx += m.x; cy += m.y; } cx /= motors.length; cy /= motors.length;
  const angs = rsus.map(r => Math.atan2(r.y - cy, r.x - cx) * 180 / Math.PI).sort((a, b) => a - b);
  let gap = 0, minSep = 360;
  for (let i = 0; i < angs.length; i++) {
    const d = (i + 1 < angs.length ? angs[i + 1] : angs[0] + 360) - angs[i];
    if (d > gap) gap = d; if (d < minSep) minSep = d;
  }
  check('FUV I: 4 HSU y ningún flanco sin estación (hueco angular <= 140°)', rsus.length === 4 && gap <= 140,
    'rumbos ' + angs.map(a => a.toFixed(0)).join(' ') + ' · hueco ' + gap.toFixed(0) + '°');
  check('FUV I: y ninguna pareja pegada (separación mínima >= 30°)', minSep >= 30,
    minSep.toFixed(0) + '° (el reparto por arco daba 5°)');
}
// Planta alargada con 2 HSU: una en cada EXTREMO del eje largo (la fase de los
// sectores va alineada al eje principal), no las dos en el mismo lado.
{
  const motors = reticula({ nx: 40, ny: 2, px: 12, py: 70, L: 64, W: 4 });
  ctx.S.p = { tlen: 64, twid: 4, radius: 250 };
  const hull = ctx.convexHull(motors.map(m => ({ x: m.x, y: m.y })));
  const rsus = ctx.placeRSUs(motors, hull, [], 2, 250);
  const sep = Math.hypot(rsus[0].x - rsus[1].x, rsus[0].y - rsus[1].y);
  check('planta alargada: las 2 HSU van a los dos extremos del eje largo',
    rsus.length === 2 && sep >= 0.6 * 39 * 12, sep.toFixed(0) + ' m entre ellas');
}

// ── 7d) NCU EXTERIOR → HSU INCORPORADA (el caso Bagnarelli) ────────────────
// Una NCU hospeda HSU solo con CIELO ABIERTO: un abanico >=90° sin seguidores
// a <=150 m — el borde real de la planta. Una NCU interior NO puede hospedar.
{
  const motors = reticula({ nx: 10, ny: 4, px: 12, py: 70, L: 64, W: 4 });
  ctx.S.p = { tlen: 64, twid: 4, radius: 250 };
  const hull = ctx.convexHull(motors.map(m => ({ x: m.x, y: m.y })));
  const fuera = { id: 'NCU-01', x: -45, y: 105 };          // fuera del recinto, al oeste
  const rsus = ctx.placeRSUs(motors, hull, [fuera], 2, 250);
  const inc = rsus.filter(r => r.integrada);
  check('NCU exterior: una HSU va incorporada en su poste', inc.length === 1 &&
    inc[0].ncu === 'NCU-01' && inc[0].x === fuera.x && inc[0].y === fuera.y,
    JSON.stringify(rsus.map(r => ({ id: r.id, ncu: r.ncu, integrada: !!r.integrada }))));
  check('y la otra HSU sigue siendo un equipo suelto con su guarda',
    rsus.length === 2 && rsus.some(r => !r.integrada && holg(r.x, r.y, motors, ctx.S.p) >= 2 - 1e-9));
  const dentroNcu = { id: 'NCU-01', x: 54, y: 105 };       // en mitad del campo
  const rsus2 = ctx.placeRSUs(motors, hull, [dentroNcu], 2, 250);
  check('NCU interior: ninguna HSU incorporada', rsus2.filter(r => r.integrada).length === 0);
}

// ── 7e) NADA DE POSTES DESPERDICIADOS (el caso Ayora) ──────────────────────
// Cazado en el desde-cero de Ayora: una HSU suelta a 32 m de la NCU de su
// lóbulo — dos equipos donde cabe uno. El hospedaje va por CIELO ABIERTO (el
// hull convexo dejaba fuera el borde real de una planta cóncava) y hay un
// post-pase de fusión a <=HSU_FUSION. El invariante: ninguna HSU suelta puede
// quedar a <=40 m de una NCU sin HSU que tenga cielo abierto.
{
  const P = vm.runInContext('AYORA', ctx);
  const motors = P.tcus.map((t, i) => ({ x: t[0], y: t[1], pb: null, id: 'M' + (i + 1) }));
  const ncus = sitea(motors, { tlen: 64, twid: 4 });
  ctx.S.p.radius = 250;
  const hull = ctx.convexHull(motors.map(m => ({ x: m.x, y: m.y })));
  const rsus = ctx.placeRSUs(motors, hull, ncus, 12, 250);
  const conHsu = new Set(rsus.filter(r => r.integrada).map(r => r.ncu));
  // el mismo test de cielo abierto que usa la app: abanico >=120° sin seguidores a <=250 m
  const cielo = (p) => {
    const oc = new Uint8Array(72);
    for (const m of motors) { const dx = m.x - p.x, dy = m.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 > 250 * 250 || d2 < 1) continue;
      oc[Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 72) % 72] = 1; }
    let libre = 0, run = 0;
    for (let i = 0; i < 144; i++) { if (oc[i % 72]) run = 0; else if (++run > libre) libre = run; }
    return Math.min(libre, 72) * 5 >= 120;
  };
  const malas = rsus.filter(r => !r.integrada && ncus.some(n => !conHsu.has(n.id) && cielo(n) &&
    Math.hypot(n.x - r.x, n.y - r.y) <= 40));
  check('Ayora: ninguna HSU suelta pegada a una NCU libre (poste compartido)',
    malas.length === 0, malas.map(r => r.id).join(' '));
  check('Ayora: las NCUs de borde de lóbulo hospedan HSU incorporada',
    rsus.some(r => r.integrada), rsus.filter(r => r.integrada).length + ' incorporadas');
}

// ── 7f) EXTERIOR DE GRUPO PERO INTERIOR DE PLANTA: AHÍ NO VA UNA HSU ───────
// Cazado en Ayora, segunda vuelta: la NCU del pasillo ENTRE dos lóbulos es
// exterior de su grupo pero interior de la planta — rodeada de seguidores por
// ambos lados, sin cielo ni viento representativos. No hospeda ni fusiona: su
// abanico libre son dos rendijas de ~15°, no los >=90° del borde real.
{
  const motors = [];
  for (let j = 0; j < 6; j++) for (let i = 0; i < 10; i++) {
    motors.push({ x: i * 12, y: j * 70, len: 64, wid: 4, az: 0, pb: null, id: 'A' + (motors.length + 1) });
    motors.push({ x: 148 + i * 12, y: j * 70, len: 64, wid: 4, az: 0, pb: null, id: 'B' + (motors.length + 1) });
  }
  ctx.S.p = { tlen: 64, twid: 4, radius: 400 };
  const hull = ctx.convexHull(motors.map(m => ({ x: m.x, y: m.y })));
  const pasillo = { id: 'NCU-01', x: 128.5, y: 175 };   // en mitad del pasillo entre bloques
  const rsus = ctx.placeRSUs(motors, hull, [pasillo], 4, 400);
  check('NCU en pasillo entre lóbulos: NO hospeda HSU (interior de planta)',
    rsus.filter(r => r.integrada).length === 0,
    JSON.stringify(rsus.map(r => ({ id: r.id, integrada: !!r.integrada }))));
}

// ── 7g) CRITERIO DE IMPLANTACIÓN: cota, enlace y sectores vacíos ───────────
// La HSU se elige PUNTUANDO candidatos como el ingeniero: poste compartido,
// exposición (arco de cielo), ENLACE por radio a su NCU, COTA del terreno si
// los datos la traen, y centrado del sector.
{
  // cota: con z en el CSV, la HSU del sector va al punto ALTO del flanco
  const motors = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 40; i++)
    motors.push({ x: i * 12, y: j * 70, len: 64, wid: 4, az: 0, pb: null, id: 'M' + (motors.length + 1), z: 0 });
  motors.find(m => m.x === 468 && m.y === 70).z = 9;             // el cerro del flanco este
  ctx.S.p = { tlen: 64, twid: 4, radius: 250, clearHSU: 2 };
  const hull = ctx.convexHull(motors.map(m => ({ x: m.x, y: m.y })));
  const rsus = ctx.placeRSUs(motors, hull, [], 2, 250);
  const este = rsus.reduce((a, b) => a.x > b.x ? a : b);
  check('topografía: la HSU del este se ancla en el punto alto del flanco',
    Math.hypot(este.x - 468, este.y - 70) <= 20, Math.hypot(este.x - 468, este.y - 70).toFixed(1) + ' m del cerro');
}
{
  // enlace y sectores vacíos, sobre las plantas reales: ninguna HSU suelta fuera
  // del radio de su NCU, y las N pedidas salen aunque la forma sea diagonal o
  // cóncava (los sectores vacíos se ensanchan, sin repetir anclas)
  for (const K of ['FUV1', 'AYORA']) {
    const P = vm.runInContext(K, ctx);
    const filas = P.pts || P.tcus;
    const motors = filas.map((t, i) => ({ x: t[0], y: t[1], pb: null, id: 'M' + (i + 1) }));
    const ncus = sitea(motors, { tlen: 64, twid: 4 });
    ctx.S.p.radius = 250;
    const hull = ctx.convexHull(motors.map(m => ({ x: m.x, y: m.y })));
    const rsus = ctx.placeRSUs(motors, hull, ncus, 12, 250);
    const porId = {}; ncus.forEach(n => porId[n.id] = n);
    const lejos = rsus.filter(r => !r.integrada && r.ncu &&
      Math.hypot(porId[r.ncu].x - r.x, porId[r.ncu].y - r.y) > 250);
    check(`${P.name}: las 12 HSU pedidas salen (sectores vacíos ensanchados)`, rsus.length === 12, rsus.length + ' HSU');
    check(`${P.name}: toda HSU suelta enlaza por radio con su NCU`, lejos.length === 0,
      lejos.map(r => r.id).join(' '));
  }
}

// ── 7h) EL INFORME: por NCU y por GW, cuántas TCU, d media, d máxima y HSU ─
// El listado de equipos y su CSV son el INFORME del reparto: cada NCU y cada
// gateway con sus TCU, la distancia MEDIA de trabajo, la MÁS LEJANA con su
// identificador (la que marca el margen del enlace) y las HSU que cuelgan.
{
  const src2 = [
    (html.match(/function tcuPt[\s\S]*?\n\}\n/) || [''])[0],
    (html.match(/function equipmentData[\s\S]*?\n(?=function openEquip)/) || [''])[0],
    (html.match(/function csvEquip[\s\S]*?\n\}\n/) || [''])[0],
  ].join('\n');
  check('se localizan tcuPt/equipmentData/csvEquip', src2.includes('equipmentData') && src2.includes('csvEquip'));
  const cap = { csv: null };
  const c2 = { console, S: null, dlCSV: (n, t) => { cap.csv = t; }, Math };
  vm.createContext(c2);
  vm.runInContext(src2, c2);
  c2.S = {
    bifilo: null, projOX: null, p: { twid: 4, tlen: 64 },
    motors: [
      { x: 30, y: 0, id: 'M1', tcu: 'NCU-01·GW1·T001' },
      { x: 0, y: -40, id: 'M2', tcu: 'NCU-01·GW1·T002' },
      { x: 100, y: 0, id: 'M3', tcu: 'NCU-01·GW2·T003' },
    ],
    ncus: [{ id: 'NCU-01', gz: '', pb: 'PS 1', count: 3, x: 0, y: 0, motorIdx: [0, 1, 2], gw: [[0, 1], [2]] }],
    rsus: [{ id: 'HSU-01', ncu: 'NCU-01', integrada: true, x: 0, y: 0 }],
    reps: [],
  };
  const D = vm.runInContext('equipmentData()', c2);
  const n = D.ncus[0];
  check('informe: TCU, media y máxima de la NCU (con la TCU más lejana nombrada)',
    n.total === 3 && Math.abs(n.g.med - (30 + 40 + 100) / 3) < 0.01 && n.g.max === 100 && /T003/.test(n.g.lejana),
    JSON.stringify(n.g));
  check('informe: cada GW con su cuenta, media y máxima',
    n.gws.length === 2 && n.gws[0].n === 2 && Math.abs(n.gws[0].med - 35) < 0.01 && n.gws[0].max === 40 &&
    n.gws[1].n === 1 && n.gws[1].max === 100, JSON.stringify(n.gws));
  check('informe: las HSU de la NCU, con las incorporadas contadas',
    n.nHsu === 1 && n.hsuInc === 1);
  vm.runInContext('csvEquip()', c2);
  check('CSV del informe: columnas d_media_m, d_max_m, tcu_mas_lejana y n_hsu',
    /n_tcu,d_media_m,d_max_m,tcu_mas_lejana,n_hsu/.test(cap.csv) &&
    /NCU-01,NCU,,PS 1,,3,56\.7,100\.0,NCU-01·GW2·T003,1/.test(cap.csv) &&
    /GW1,Gateway,,PS 1,NCU-01,2,35\.0,40\.0/.test(cap.csv),
    (cap.csv || '').split('\n').slice(0, 4).join(' | '));
}

// ── 9) ISLA PEQUEÑA → REPETIDOR, no NCU ────────────────────────────────────
// Criterio de campo: una isla con pocas TCU no justifica una NCU más (equipo,
// gateway y alimentación); se sirve desde la NCU vecina a través de un
// REPETIDOR — que cubra la isla entera y quede a radio de la anfitriona, con
// la guarda de mesas. Si la isla es grande, o está demasiado lejos, o no hay
// hueco de capacidad, lleva su NCU como siempre. repMax=0 lo desactiva
// (compatibilidad: todos los tests anteriores corren así).
{
  const OPTSR = Object.assign({}, OPTS, { repMax: 12 });
  const base = () => {
    const M = reticula({ nx: 20, ny: 6, px: 12, py: 70, L: 64, W: 4 });          // bloque principal
    for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++)
      M.push({ x: 520 + i * 12, y: 70 + j * 70, len: 64, wid: 4, az: 0, pb: null, id: 'I' + (j * 2 + i + 1) });
    return M;                                                                     // isla de 8 a ~410 m
  };
  ctx.S.p = { tlen: 64, twid: 4, radius: 250, capNCU: 160, capGW: 80, gwAxis: 'EW', clearNCU: 2 };
  const motors = base();
  const ncus = vm.runInContext('(m,o)=>siteAll(m,o)', ctx)(motors, OPTSR);
  const reps = ncus._autoReps || [];
  const isla = motors.map((m, i) => i).filter(i => motors[i].id[0] === 'I');
  check('isla de 8: NINGUNA NCU nueva — la sirve un repetidor', ncus.length === 1 && reps.length === 1,
    ncus.length + ' NCU, ' + reps.length + ' rep');
  const host = ncus[0], rep = reps[0];
  check('las 8 TCU de la isla cuelgan de la NCU anfitriona', isla.every(i => host.motorIdx.includes(i)),
    host.count + ' TCU en la anfitriona');
  const cubreIsla = isla.every(i => Math.hypot(motors[i].x - rep.x, motors[i].y - rep.y) <= 250);
  const enlaza = Math.hypot(host.x - rep.x, host.y - rep.y) <= 250;
  check('el repetidor cubre la isla entera Y enlaza por radio con la anfitriona',
    cubreIsla && enlaza, 'cubre=' + cubreIsla + ' enlaza=' + enlaza);
  check('y no está sobre una mesa (guarda)', holg(rep.x, rep.y, motors, ctx.S.p) >= 2 - 1e-9,
    holg(rep.x, rep.y, motors, ctx.S.p).toFixed(2) + ' m');
  // la malla no "salta un claro": el puente virtual del repetidor la deja conexa
  check('la malla de la anfitriona queda conexa (el claro lo puentea el repetidor)',
    ctx.connectedSet(host.motorIdx, ncus._adj));
  // repMax=0: compatibilidad — la isla lleva su NCU
  const ncus0 = vm.runInContext('(m,o)=>siteAll(m,o)', ctx)(base(), OPTS);
  check('con repMax=0 (o sin él), la isla lleva su NCU como siempre',
    ncus0.length === 2 && (ncus0._autoReps || []).length === 0, ncus0.length + ' NCU');
  // isla DEMASIADO lejos (ningún punto cubre isla y enlaza): NCU propia
  const lejos = reticula({ nx: 20, ny: 6, px: 12, py: 70, L: 64, W: 4 });
  for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++)
    lejos.push({ x: 1100 + i * 12, y: 70 + j * 70, len: 64, wid: 4, az: 0, pb: null, id: 'I' + (j * 2 + i + 1) });
  const ncusL = vm.runInContext('(m,o)=>siteAll(m,o)', ctx)(lejos, OPTSR);
  check('isla fuera del alcance de todo repetidor: NCU propia y 0 repetidores',
    ncusL.length === 2 && (ncusL._autoReps || []).length === 0,
    ncusL.length + ' NCU, ' + (ncusL._autoReps || []).length + ' rep');
}

  check("el panel pinta en ROJO la guarda incumplida (mínimo configurado), no en ámbar",
    html.includes("m de una mesa (mínimo ${_gN} m)") && html.includes("m de una mesa (mínimo ${_gH} m)") &&
    !html.includes("el pasillo no da más"));
  check("el corte lógico _gwCut existe y splitGW corta por él",
    html.includes("n._gwCut=(cSel<cLo||cSel>cHi)") && html.includes("ncu._gwCut!=null"));

// ── 10) SUGERENCIA DE RADIO: ¿cuánto subirlo para ahorrar una NCU? ─────────
// El rectángulo de 640x560 con radio 250 exige 4 NCUs (ninguna puede cubrir
// dos esquinas: los lados miden 560 y 640 > 2R=500). El sondeo con el
// k-centro compartido debe decir que con 280 caben 3 — y callar cuando no
// hay nada que ahorrar (una sola NCU).
{
  const src3 = (html.match(/function sugiereRadio\(\)\{[\s\S]*?\n\}\n/) || [''])[0];
  check('se localiza sugiereRadio', src3.length > 0);
  vm.runInContext(src3, ctx);
  const pip = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; };
  const mulberry32 = a => () => { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rnd = mulberry32(4000), R = [[0, 0], [640, 0], [640, 560], [0, 560]], pts = [];
  for (let y = 0; y <= 560; y += 70) for (let x = 0; x <= 640; x += 12)
    if (pip(x, y, R)) pts.push({ x: x + (rnd() - 0.5), y: y + (rnd() - 0.5) * 2 });
  pts.sort((a, b) => a.y - b.y || a.x - b.x);
  const motors = pts.slice(0, 400).map((p, i) => ({ x: p.x, y: p.y, pb: null, id: 'M' + (i + 1), len: 64, wid: 8.4, az: 0 }));
  const ncus = sitea(motors, { tlen: 64, twid: 8.4, clearNCU: 2 });
  ctx.S.motors = motors; ctx.S.ncus = ncus; ctx.S.p.radius = 250;
  const sug = vm.runInContext('sugiereRadio()', ctx);
  check('rect 640x560: 4 NCUs a radio 250, y la sugerencia encuentra 3 con radio <=280',
    ncus.length === 4 && sug && sug.radio > 250 && sug.radio <= 280 && sug.ncus === 3, JSON.stringify(sug));
  // sin nada que ahorrar: una sola NCU -> sin sugerencia
  const chico = reticula({ nx: 10, ny: 4, px: 12, py: 70, L: 64, W: 4 });
  const ncus2 = sitea(chico, { tlen: 64, twid: 4 });
  ctx.S.motors = chico; ctx.S.ncus = ncus2; ctx.S.p.radius = 250;
  check('planta de 1 NCU: sin sugerencia', ncus2.length === 1 && vm.runInContext('sugiereRadio()', ctx) === null);
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
  check('el informe PDF existe y está cableado: portada + una página por cada dos NCUs',
    /function paginasInforme/.test(html) && /function pdfDesdePaginas/.test(html) &&
    /i\+=2/.test((html.match(/function paginasInforme[\s\S]*?\n\}/)||[''])[0]) &&
    /eq-pdf/.test(html) && /informePDF/.test(html));
}

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
  : 'OK — ' + ok + '/' + ok + ' comprobaciones'));
process.exit(ko ? 1 : 0);
