// MAPA DE CALOR — los dos modos, la paleta que se ve, y el guardia de que la física no vuelve a
// ser la mala.
//
// La capa se rescató el 18-09 de `siting/demo-siting.html` (SolarGPTfull, 21-08), que nunca llegó
// a main. El 19-09 se le añadió el modo SALTOS y se le cambió la paleta. Este banco vigila tres
// cosas distintas, y conviene no mezclarlas:
//
//   1. MODO MARGEN: que el margen salga de `rfMargin` y no de una física propia. La copia vieja
//      traía su `covObstacles`, que modelaba las filas como rectas verticales infinitas en
//      x = k·pitch — el MISMO defecto RF-01 que este repo ya corrigió y que `test_rf_cobertura.js`
//      vigila, con 27 dB de error en los enlaces más despejados de una planta girada. Copiarla
//      habría reintroducido el fallo con otro nombre y sin nadie mirándolo.
//
//   2. MODO SALTOS: que los saltos salgan de `buildAdjacency` —la misma adyacencia con la que la
//      página reparte las NCUs— y que el campo sobre la rejilla sea EXACTAMENTE la anchura desde
//      el Tx. Se recalcula aquí, por separado y a lo bruto (O(n²)), y se compara celda a celda.
//
//   3. LA PALETA: que las bandas se distingan EN PANTALLA. La capa va translúcida sobre el
//      lienzo, y con la mezcla la escala vieja se aplastaba: «verde claro» y «verde» acababan a
//      ΔE 9,7 y «sin enlace» y «justo justo» a 14,7 — indistinguibles. De ahí el «no entiendo
//      esos gráficos» del 19-09. El banco mide la distancia de color DESPUÉS de mezclar y exige
//      un suelo; la prueba de que el suelo no es de adorno es que la paleta vieja lo suspende, y
//      eso también se comprueba aquí abajo.
//
//   node tests/test_cov_heatmap.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
/* El bloque RF llega hasta el comentario de la TCU y se lleva por delante toda la capa de calor,
   que vive entre medias. Es lo que se quiere: se ejecuta el código REAL, no una copia. */
const rf = html.match(/const RF_PITCH_M[\s\S]*?\n}\n(?=\/\* PUNTO DE LA TCU)/);
const bnd = html.match(/function bounds\(\)\{.*?\n/);
const adyac = html.match(/function buildAdjacency\([\s\S]*?\n}\n/);
const tcupt = html.match(/function tcuPt\(m\)\{[\s\S]*?\n}\n/);
check('el bloque RF + capa de calor se localiza', !!rf);
check('bounds() se localiza', !!bnd);
check('buildAdjacency se localiza', !!adyac);
check('tcuPt se localiza', !!tcupt);
if (!rf || !bnd || !adyac || !tcupt) { console.log('\nFALLOS: ' + ko); process.exit(1); }

/* GUARDIAS DE ORIGEN, en el texto: si alguien vuelve a traerse la física vieja o a duplicar la
   adyacencia, aquí se ve antes incluso de ejecutar nada. */
check('el mapa de calor NO define su propia física de obstáculos',
  !/function covObstacles|function covMargin/.test(html));
check('el modo Margen pide el margen a rfMargin, con las filas reales del layout',
  /rfMargin\(tx,\{x:wx,y:wy\},rows\)/.test(rf[0]));
check('el modo Saltos NO duplica la adyacencia: usa buildAdjacency',
  /buildAdjacency\(pts, *pts\.map\(\(_,i\)=>i\), *S\.p\.reachX, *S\.p\.reachY\)/.test(rf[0])
  && !/function covAdjacency|function covVecinos/.test(html));
/* Con la capa puesta el layout va en gris. Si vuelve a pintarse por NCU (o por la capa RF, que usa
   la misma escala de color), el dibujo tiene dos escalas rojo/verde encima y no se lee ninguna. */
check('con la capa puesta, los seguidores se pintan neutros',
  /if\(S\.cov\.on *&& *!dim\) *col *= *COV_NEUTRO;/.test(html));
/* Los parches de power block van ENCIMA de la capa (relleno .14 + borde .5): si se siguen
   pintando, tiñen el mapa y los colores dejan de ser los que promete la leyenda — medido en El
   Burgo, la mitad norte se iba a azul y la sur a verde. */
check('con la capa puesta, los parches de power block no se pintan',
  /if\(S\.v\.blocks *&& *!S\.cov\.on\)\{/.test(html));
/* Y la leyenda no puede seguir prometiendo el color por NCU mientras están en gris. */
check('con la capa puesta, la leyenda retira «Motor (color = NCU)» y los power blocks',
  /S\.cov\.on *\? *"" *:\s*`<div class="li">[\s\S]{0,200}Motor \(color = NCU\)/.test(html)
  && /if\(pbs\.length *&& *S\.v\.blocks *&& *!S\.cov\.on\)\{/.test(html));
/* El raster se escribe OPACO y la transparencia la pone el dibujado: si la opacidad se reparte
   entre los dos sitios, `covEnPantalla` miente y la leyenda deja de cuadrar con el dibujo. */
check('las celdas del raster se escriben opacas (alfa 255)',
  (rf[0].match(/img\.data\[o\+3\]=255/g) || []).length === 2, (rf[0].match(/img\.data\[o\+3\]=\d+/g) || []));
check('y la única transparencia es COV_ALPHA, en el dibujado',
  /ctx\.globalAlpha=COV_ALPHA/.test(rf[0]) && !/globalAlpha=0?\.\d/.test(rf[0]));

// ── el entorno: se ejecuta el código real con lo mínimo alrededor ────────────
const ZigbeePV = require(path.join(RAIZ, 'zigbee_pv_model.js'));
let lienzos = 0, ultimaImg = null;
const ctx = {
  console, ZigbeePV, Math, parseInt, Map, Set, Int32Array, Infinity,
  document: {
    getElementById: id => (id === 'rf-tilt' ? { value: String(ctx._tilt) } : null),
    createElement: () => { lienzos++; return { width: 0, height: 0,
      getContext: () => ({
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: img => { ultimaImg = img; },
      }) }; },
  },
  Uint8ClampedArray,
  _tilt: 30,
  S: null,
};
ctx.window = { ZigbeePV }; ctx.ZigbeePV = ZigbeePV;
vm.createContext(ctx);
try { vm.runInContext(adyac[0] + '\n' + rf[0] + '\n' + bnd[0] + '\n' + tcupt[0], ctx); }
catch (e) { check('todo compila junto', false, e.message); console.log('\nFALLOS: ' + ko); process.exit(1); }
check('compila y expone los dos modos',
  ['covRaster', '_covRgb', 'drawCovHeatmap', 'covColorMargen', 'covColorSaltos', 'covEnPantalla',
   'covSaltos', 'covCampoSaltos', 'covModo'].every(f => typeof ctx[f] === 'function'));
/* Las `function` del script sí cuelgan del contexto, pero las `const` no: viven en el ámbito
   léxico del script, igual que en la página. Para leer la paleta hay que preguntarla dentro. */
const K = vm.runInContext('({COV_ALPHA,COV_LIENZO,COV_NEUTRO,COV_MARGEN,COV_SALTOS,COV_LEJOS})', ctx);
check('la paleta está declarada y es legible',
  !!K && Array.isArray(K.COV_MARGEN) && Array.isArray(K.COV_SALTOS) && typeof K.COV_LEJOS === 'string');

// ── una planta GIRADA, que es donde la física mala se delataba ──────────────
const AZ = 23.7;
function planta(az = AZ, n = 8, len = 64, wid = 12, pitch = 12) {
  const a = az * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a);
  const S = { motors: [], ncus: [], hull: [], bifila: null,
    p: { twid: wid, tlen: len, reachX: 40, reachY: 90 },
    cov: { on: true, tx: null, placing: false, modo: 'margen' },
    _rfRows: null, _covSig: undefined, _covRaster: undefined };
  for (let k = -n; k <= n; k++) S.motors.push({ x: k * pitch * ux, y: k * pitch * uy, len, wid, az });
  return S;
}
ctx.S = planta();

// ═══════════════ 1) MODO MARGEN — lo que ya se vigilaba ═══════════════════════
check('sin Tx no se calcula raster ninguno', ctx.covRaster() === null && ctx.S._covRaster === null);
check('y no se gasta un lienzo en ello', lienzos === 0, lienzos);

ctx.S.cov.tx = { x: 0, y: 0 };
const R = ctx.covRaster();
check('con Tx sale un raster', !!R && R.nx > 0 && R.ny > 0, R && { nx: R.nx, ny: R.ny });
check('y viene etiquetado con su modo', R.modo === 'margen', R.modo);
/* La celda vive entre 4 y 10 m: por debajo cada celda es un predictLink y el coste se dispara;
   por encima se ven los escalones. */
check('la celda se queda entre 4 y 10 m', R.cell >= 4 && R.cell <= 10, R.cell);
check('el raster cubre la planta con su margen de 30 m',
  R.wx0 <= Math.min(...ctx.S.motors.map(m => m.x)) - 29 && R.wW >= 60, { wx0: R.wx0, wW: R.wW });
check('se pinta una imagen del tamaño del raster',
  ultimaImg && ultimaImg.width === R.nx && ultimaImg.height === R.ny, ultimaImg && [ultimaImg.width, ultimaImg.height]);
check('con todas las celdas opacas', ultimaImg.data[3] === 255 && ultimaImg.data[ultimaImg.data.length - 1] === 255);

/* LA FÍSICA ES LA DEL REPO, CELDA A CELDA. Ésta es la comprobación por la que nació el fichero.
   TODAS las celdas, no una muestra: con tres muestras esto pasaba en verde teniendo puesta la
   física mala, porque el color va en cinco bandas y dos modelos distintos caen en la misma banda
   con muchísima facilidad. Medido entonces: inyectando el modelo viejo con otro nombre —para que
   el guardia de texto no lo viera— las tres muestras coincidían. Con el raster entero no hay
   dónde esconderse. */
const rows = ctx.rfRows();
let malas = 0, primera = null;
for (let iy = 0; iy < R.ny; iy++) {
  const wy = R.wy0 + R.wH - (iy + 0.5) * (R.wH / R.ny);
  for (let ix = 0; ix < R.nx; ix++) {
    const wx = R.wx0 + (ix + 0.5) * (R.wW / R.nx);
    const e = ctx._covRgb(ctx.covColorMargen(ctx.rfMargin(ctx.S.cov.tx, { x: wx, y: wy }, rows)));
    const o = (iy * R.nx + ix) * 4;
    if (ultimaImg.data[o] !== e[0] || ultimaImg.data[o + 1] !== e[1] || ultimaImg.data[o + 2] !== e[2]) {
      if (!malas) primera = { ix, iy, esperado: e, salio: [ultimaImg.data[o], ultimaImg.data[o + 1], ultimaImg.data[o + 2]] };
      malas++;
    }
  }
}
check('las ' + (R.nx * R.ny) + ' celdas son exactamente covColorMargen(rfMargin(...)) del repo',
  malas === 0, { celdasMal: malas, primera });

const realMargin = ctx.rfMargin; let llamadas = 0;
ctx.rfMargin = (...a) => { llamadas++; return realMargin(...a); };
ctx.S._covSig = null; ctx.covRaster();
check('todas las celdas pasan por rfMargin, ni una menos', llamadas === R.nx * R.ny, { llamadas, celdas: R.nx * R.ny });
ctx.rfMargin = realMargin;

/* EL FONDO DEL ASUNTO, con la planta girada 23,7°: un enlace PARALELO a las filas no cruza
   ninguna, y uno PERPENDICULAR las cruza todas. Con el modelo viejo —rectas verticales en
   x = k·pitch— el paralelo se llevaba un obstáculo por cada coordenada X barrida y salía PEOR que
   el perpendicular, que es justo al revés de lo que pasa en el campo. */
const a = AZ * Math.PI / 180;
const ejeFila = { x: Math.sin(a), y: Math.cos(a) };
const ejePaso = { x: Math.cos(a), y: -Math.sin(a) };
const D = 90;
const mgParalelo = ctx.rfMargin({ x: 0, y: 0 }, { x: ejeFila.x * D, y: ejeFila.y * D }, rows);
const mgCruzado = ctx.rfMargin({ x: 0, y: 0 }, { x: ejePaso.x * D, y: ejePaso.y * D }, rows);
check('en planta girada, el enlace por el pasillo es MEJOR que el que cruza filas',
  mgParalelo > mgCruzado, { paralelo: +mgParalelo.toFixed(2), cruzado: +mgCruzado.toFixed(2) });
check('y la diferencia es de verdad, no ruido (>5 dB)',
  mgParalelo - mgCruzado > 5, +(mgParalelo - mgCruzado).toFixed(2));

// ═══════════════ 2) MODO SALTOS ═══════════════════════════════════════════════
/* Referencia independiente: la misma definición, escrita aparte y a lo bruto. Si `covSaltos` y
   `covCampoSaltos` se apoyaran en otra vecindad —o se les colara un salto de más—, esto no
   cuadraría. */
function saltosRef(S, tx) {
  const pts = S.motors.map(m => ctx.tcuPt(m));
  const rx2 = S.p.reachX ** 2, ry2 = S.p.reachY ** 2;
  const cerca = (p, q) => ((p.x - q.x) ** 2) / rx2 + ((p.y - q.y) ** 2) / ry2 <= 1;
  const hop = pts.map(p => (cerca(p, tx) ? 1 : 0));
  for (let cambio = true; cambio;) {
    cambio = false;
    for (let i = 0; i < pts.length; i++) {
      if (!hop[i]) continue;
      for (let j = 0; j < pts.length; j++)
        if (!hop[j] && cerca(pts[i], pts[j])) { hop[j] = hop[i] + 1; cambio = true; }
    }
  }
  return { pts, hop, cerca };
}
function campoRef(S, tx, g) {
  const { pts, hop, cerca } = saltosRef(S, tx);
  const H = new Array(g.nx * g.ny).fill(0);
  for (let iy = 0; iy < g.ny; iy++) {
    const wy = g.wy0 + g.wH - (iy + 0.5) * (g.wH / g.ny);
    for (let ix = 0; ix < g.nx; ix++) {
      const wx = g.wx0 + (ix + 0.5) * (g.wW / g.nx), P = { x: wx, y: wy };
      let mejor = 0;
      if (cerca(P, tx)) mejor = 1;
      for (let i = 0; i < pts.length; i++)
        if (hop[i] && cerca(P, pts[i]) && (!mejor || hop[i] + 1 < mejor)) mejor = hop[i] + 1;
      H[iy * g.nx + ix] = mejor;
    }
  }
  return H;
}

/* Un caso a mano, para que la referencia no se valide sola: cuatro seguidores en fila E-O con
   paso 35 m (< reachX 40) y el Tx 35 m por detrás del primero, para que el Tx alcance SOLO al
   primero. Entonces salen 1, 2, 3 y 4 saltos, uno por eslabón. */
ctx.S = planta();
ctx.S.motors = [0, 1, 2, 3].map(k => ({ x: k * 35, y: 0, len: 64, wid: 12, az: 0 }));
ctx.S.cov.tx = { x: -35, y: 0 };
check('cadena de 4 con paso 35 m: los saltos salen 1,2,3,4',
  JSON.stringify([...ctx.covSaltos(ctx.S.cov.tx).hop]) === '[1,2,3,4]', [...ctx.covSaltos(ctx.S.cov.tx).hop]);
/* Y si el paso pasa del alcance E-W, la cadena se rompe donde tiene que romperse. */
ctx.S.motors[2].x = 200;                       // 165 m del anterior: fuera de los 40
ctx.S.motors[3].x = 235;
check('con un claro mayor que el alcance, lo de detrás deja de alcanzarse',
  JSON.stringify([...ctx.covSaltos(ctx.S.cov.tx).hop]) === '[1,2,0,0]', [...ctx.covSaltos(ctx.S.cov.tx).hop]);
/* La elipse es ANISÓTROPA: 40 E-W pero 90 N-S. Un vecino a 60 m al norte se alcanza; a 60 m al
   este, no. Si alguien la vuelve circular, esto cae. */
ctx.S.motors = [{ x: 0, y: 0, len: 64, wid: 12, az: 0 }, { x: 0, y: 60, len: 64, wid: 12, az: 0 },
                { x: 60, y: 0, len: 64, wid: 12, az: 0 }];
const aniso = [...ctx.covSaltos({ x: 0, y: 0 }).hop];
check('la vecindad es la elipse 40 E-W / 90 N-S, no un círculo',
  aniso[0] === 1 && aniso[1] === 1 && aniso[2] === 0, aniso);

// la planta girada entera, contra la referencia
ctx.S = planta();
ctx.S.cov.modo = 'saltos';
ctx.S.cov.tx = { x: 0, y: 0 };
ctx.S._covSig = null; ctx.S._covRaster = undefined;
const RS = ctx.covRaster();
check('en modo Saltos también sale raster, etiquetado', !!RS && RS.modo === 'saltos', RS && RS.modo);
/* Saltos es geometría pura: tiene que salir aunque no haya núcleo físico cargado. Y Margen, sin
   él, tiene que rendirse en vez de pintar cualquier cosa. */
const nucleo = ctx.window.ZigbeePV;
ctx.window.ZigbeePV = null; ctx.S._covSig = null;
check('Saltos se pinta aunque no haya núcleo físico cargado', !!ctx.covRaster());
ctx.S.cov.modo = 'margen'; ctx.S._covSig = null;
check('y Margen, sin núcleo físico, se rinde en vez de inventarse un mapa', ctx.covRaster() === null);
ctx.window.ZigbeePV = nucleo; ctx.S.cov.modo = 'saltos'; ctx.S._covSig = null; ctx.covRaster();

const ref = saltosRef(ctx.S, ctx.S.cov.tx);
const mio = [...ctx.covSaltos(ctx.S.cov.tx).hop];
check('los saltos de cada TCU coinciden con la referencia independiente',
  JSON.stringify(mio) === JSON.stringify(ref.hop), { mio: mio.slice(0, 12), ref: ref.hop.slice(0, 12) });
check('y alguno hay a más de un salto (si no, el caso no prueba nada)',
  Math.max(...mio) >= 3, Math.max(...mio));

const gRS = { wx0: RS.wx0, wy0: RS.wy0, wW: RS.wW, wH: RS.wH, nx: RS.nx, ny: RS.ny };
const Hmio = ctx.covCampoSaltos(ctx.S.cov.tx, gRS), Href = campoRef(ctx.S, ctx.S.cov.tx, gRS);
let dif = 0, prim = null;
for (let k = 0; k < Href.length; k++) if (Hmio[k] !== Href[k]) { if (!dif) prim = { k, mio: Hmio[k], ref: Href[k] }; dif++; }
check('las ' + Href.length + ' celdas del campo de saltos coinciden con la referencia',
  dif === 0, { celdasMal: dif, primera: prim });
check('hay celdas a las que no llega (si todo llegara, el campo no probaría nada)',
  Href.some(v => v === 0) && Href.some(v => v >= 2), { sin: Href.filter(v => !v).length, max: Math.max(...Href) });

/* Y el pintado en modo Saltos usa covColorSaltos sobre ese campo, celda a celda. */
let malasS = 0;
for (let k = 0; k < Href.length; k++) {
  const e = ctx._covRgb(ctx.covColorSaltos(Href[k])), o = k * 4;
  if (ultimaImg.data[o] !== e[0] || ultimaImg.data[o + 1] !== e[1] || ultimaImg.data[o + 2] !== e[2]) malasS++;
}
check('el raster de Saltos es exactamente covColorSaltos(campo)', malasS === 0, malasS);

/* Los escalones. Que 1 tenga color propio y que el tramo ancho no se coma al de al lado. */
check('los escalones de saltos son 1 · 2-3 · 4-6 · 7-10 · 11+',
  K.COV_SALTOS.length === 5 && K.COV_SALTOS.slice(0, 4).map(b => b.max).join(',') === '1,3,6,10'
  && K.COV_SALTOS[4].max === Infinity, K.COV_SALTOS.map(b => b.max));
check('y cada escalón cae en la banda que le toca',
  [[1, 0], [2, 1], [3, 1], [4, 2], [6, 2], [7, 3], [10, 3], [11, 4], [40, 4]]
    .every(([h, i]) => ctx.covColorSaltos(h) === K.COV_SALTOS[i].src),
  [1, 2, 3, 4, 6, 7, 10, 11, 40].map(h => ctx.covColorSaltos(h)));
check('1 salto tiene color propio y 2 ya es otro',
  ctx.covColorSaltos(1) !== ctx.covColorSaltos(2));
check('«no llega» (0) no se confunde con ninguna banda',
  K.COV_SALTOS.every(b => ctx.covColorSaltos(0) !== b.src) && ctx.covColorSaltos(0) === K.COV_LEJOS);
check('por encima del último escalón no se sale de la tabla',
  ctx.covColorSaltos(99) === K.COV_SALTOS[K.COV_SALTOS.length - 1].src);

// ═══════════════ 3) LA PALETA, tal como se VE ════════════════════════════════
/* ΔE (CIE76) sobre el color MEZCLADO, que es el que llega al ojo. El suelo de 22 no es un número
   redondo elegido a gusto: la paleta vieja marcaba 9,7 en su peor par y la nueva marca 28,6, así
   que 22 separa una de otra con holgura por los dos lados. Abajo se comprueba que la vieja lo
   suspende: un guardia que nunca se ha visto fallar no es un guardia. */
const SUELO_DE = 22;
function lab(c) {
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [r, g, b] = c.map(v => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047,
        Y = r * 0.2126 + g * 0.7152 + b * 0.0722,
        Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const rgbDe = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
const mezcla = (h, alfa, fondo) => rgbDe(h).map((v, i) => alfa * v + (1 - alfa) * fondo[i]);
const dE = (x, y, alfa, fondo) => {
  const A = lab(mezcla(x, alfa, fondo)), B = lab(mezcla(y, alfa, fondo));
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};
function peorPar(srcs, alfa, fondo) {
  let peor = Infinity, par = null;
  for (let i = 0; i < srcs.length; i++) for (let j = i + 1; j < srcs.length; j++) {
    const d = dE(srcs[i], srcs[j], alfa, fondo);
    if (d < peor) { peor = d; par = [srcs[i], srcs[j]]; }
  }
  return { peor: +peor.toFixed(1), par };
}
const A = K.COV_ALPHA, F = K.COV_LIENZO;
check('la capa se mezcla con una opacidad declarada y un fondo declarado',
  typeof A === 'number' && A > 0 && A <= 1 && Array.isArray(F) && F.length === 3, { A, F });
/* El fondo declarado tiene que ser el que `draw()` pinta de verdad, o toda la cuenta es mentira. */
const lienzoReal = (html.match(/ctx\.fillStyle="(#[0-9a-f]{6})";\s*ctx\.fillRect\(0,0,W,H\)/i) || [])[1];
check('COV_LIENZO es el color con el que draw() limpia el lienzo',
  !!lienzoReal && JSON.stringify(rgbDe(lienzoReal)) === JSON.stringify(F), { declarado: F, real: lienzoReal });

const pm = peorPar(K.COV_MARGEN.map(b => b.src), A, F);
check('las bandas de Margen se distinguen en pantalla (ΔE ≥ ' + SUELO_DE + ')', pm.peor >= SUELO_DE, pm);
const ps = peorPar(K.COV_SALTOS.map(b => b.src).concat([K.COV_LEJOS]), A, F);
check('las bandas de Saltos, con el «no llega», también', ps.peor >= SUELO_DE, ps);

/* EL GUARDIA, NEGATIVO. La paleta que había —y su opacidad— tiene que suspender este mismo
   listón; si no, el listón no mide nada. */
const VIEJA = ['#7a1d1d', '#e0322c', '#e0a72c', '#7bbf5a', '#2f9e54'];
const pv = peorPar(VIEJA, 0.402, [250, 251, 252]);
check('y la paleta vieja SUSPENDE ese mismo listón (por eso no se veía)', pv.peor < SUELO_DE, pv);

/* covEnPantalla es lo que enseña la leyenda: tiene que dar exactamente la mezcla, o la leyenda
   vuelve a no cuadrar con el dibujo, que es el fallo que se estaba arreglando. */
let malCol = null;
for (const b of K.COV_MARGEN.concat(K.COV_SALTOS).concat([{ src: K.COV_LEJOS }])) {
  const esperado = '#' + mezcla(b.src, A, F).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  if (ctx.covEnPantalla(b.src) !== esperado) malCol = { src: b.src, dio: ctx.covEnPantalla(b.src), esperado };
}
check('covEnPantalla devuelve el color mezclado, que es el que se ve', !malCol, malCol);

/* El gris del layout no puede confundirse con ninguna banda: si se parece a una, los seguidores
   desaparecen justo encima de ella. Se mide en luminosidad, que es lo que separa una silueta. */
const Lg = lab(rgbDe(K.COV_NEUTRO))[0];
const dL = K.COV_MARGEN.concat(K.COV_SALTOS).map(b => Math.abs(lab(mezcla(b.src, A, F))[0] - Lg));
check('el gris de los seguidores se despega de todas las bandas (ΔL ≥ 8)',
  Math.min(...dL) >= 8, +Math.min(...dL).toFixed(1));

// ═══════════════ 4) LA CACHÉ, y lo que TIENE que invalidarla ═════════════════
ctx.S = planta();
ctx.S.cov.tx = { x: 0, y: 0 };
ctx.S._covSig = undefined; ctx.S._covRaster = undefined;
const R1 = ctx.covRaster(), lienzosTras = lienzos;
const R2 = ctx.covRaster();
check('repetir sin cambiar nada no recalcula', R1 === R2 && lienzos === lienzosTras);
/* El tilt entra en la firma porque el mapa del margen cambia ENTERO con él. */
ctx._tilt = -40;
const R3 = ctx.covRaster();
check('cambiar la inclinación SÍ lo recalcula', R3 !== R2 && lienzos === lienzosTras + 1);
ctx._tilt = 30;
ctx.S.cov.tx = { x: 40, y: 15 };
check('y mover el Tx también', ctx.covRaster() !== R3);
const R4 = ctx.covRaster();
ctx.S.motors = ctx.S.motors.slice(0, ctx.S.motors.length - 1); ctx.S._rfRows = null;
const R5 = ctx.covRaster();
check('y quitar seguidores también', R5 !== R4);
/* Lo nuevo: el modo y los alcances. Sin ellos en la firma, pulsar «Saltos» o tocar el alcance
   dejaba el raster viejo en pantalla — el mismo dibujo con otra leyenda, que es peor que nada. */
ctx.S.cov.modo = 'saltos';
const R6 = ctx.covRaster();
check('cambiar de modo recalcula', R6 !== R5 && R6.modo === 'saltos', R6 && R6.modo);
ctx.S.p.reachX = 25;
const R7 = ctx.covRaster();
check('y tocar el alcance E-W también', R7 !== R6);
ctx.S.p.reachY = 50;
check('y el N-S', ctx.covRaster() !== R7);

console.log('');
if (ko) { console.log('FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'); process.exit(1); }
console.log('OK — ' + ok + '/' + ok + ' comprobaciones');
