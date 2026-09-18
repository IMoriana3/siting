// MAPA DE CALOR DEL MARGEN — y el guardia de que la física no vuelve a ser la mala.
//
// Esta capa se rescató el 18-09 de `siting/demo-siting.html` (SolarGPTfull, 21-08), que nunca
// llegó a main. La capa RF de esta página contesta «¿llega esta TCU a SU NCU?»; el mapa de calor
// contesta la otra mitad: «si pongo el concentrador AQUÍ, hasta dónde llego», que es la pregunta
// con la que se decide dónde va.
//
// LO QUE ESTE BANCO VIGILA, Y ES EL MOTIVO DE ESCRIBIRLO: que el margen salga de `rfMargin` y no
// de una física propia. La copia vieja traía su `covObstacles`, que modelaba las filas como rectas
// verticales infinitas en x = k·pitch — el MISMO defecto RF-01 que este repo ya corrigió y que
// `test_rf_cobertura.js` vigila, con 27 dB de error en los enlaces más despejados de una planta
// girada. Copiarla habría reintroducido el fallo con otro nombre y sin nadie mirándolo.
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
const rf = html.match(/const RF_PITCH_M[\s\S]*?\n}\n(?=\/\* PUNTO DE LA TCU)/);
const cov = html.match(/function covRaster\(\)\{[\s\S]*?function drawCovHeatmap\(\)\{[\s\S]*?\n\}/);
const bnd = html.match(/function bounds\(\)\{.*?\n/);
check('el bloque RF se localiza', !!rf);
check('el bloque del mapa de calor se localiza', !!cov);
check('y bounds() también', !!bnd);
if (!rf || !cov || !bnd) { console.log('\nFALLOS: ' + ko); process.exit(1); }

/* GUARDIA DE ORIGEN, en el texto: si alguien vuelve a traerse la física vieja, aquí se ve antes
   incluso de ejecutar nada. Lo que no puede reaparecer es un modelo de obstáculos propio. */
check('el mapa de calor NO define su propia física de obstáculos',
  !/function covObstacles|function covMargin/.test(html));
check('y pide el margen a rfMargin, que usa las filas reales del layout',
  /rfMargin\(tx,\{x:wx,y:wy\},rows\)/.test(cov[0]));

const ZigbeePV = require(path.join(RAIZ, 'zigbee_pv_model.js'));
let lienzos = 0, ultimaImg = null;
const ctx = {
  console, ZigbeePV, Math, parseInt,
  document: {
    getElementById: id => (id === 'rf-tilt' ? { value: String(ctx._tilt) } : null),
    createElement: () => { lienzos++; const c = { width: 0, height: 0,
      getContext: () => ({
        createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: img => { ultimaImg = img; },
      }) }; return c; },
  },
  _tilt: 30,
  S: null,
};
ctx.window = { ZigbeePV }; ctx.ZigbeePV = ZigbeePV;
vm.createContext(ctx);
try { vm.runInContext(rf[0] + '\n' + bnd[0] + '\n' + cov[0], ctx); }
catch (e) { check('todo compila junto', false, e.message); console.log('\nFALLOS: ' + ko); process.exit(1); }
check('compila y expone covRaster/_covRgb/drawCovHeatmap',
  typeof ctx.covRaster === 'function' && typeof ctx._covRgb === 'function' && typeof ctx.drawCovHeatmap === 'function');

// ── una planta GIRADA, que es donde la física mala se delataba ──────────────
const AZ = 23.7;
function planta(az = AZ, n = 8, len = 64, wid = 12, pitch = 12) {
  const a = az * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a);
  const S = { motors: [], ncus: [], hull: [], bifila: null, p: { twid: wid, tlen: len },
    cov: { on: true, tx: null, placing: false }, _rfRows: null, _covSig: undefined, _covRaster: undefined };
  for (let k = -n; k <= n; k++) S.motors.push({ x: k * pitch * ux, y: k * pitch * uy, len, wid, az });
  return S;
}
ctx.S = planta();

// ── 1) SIN Tx NO HAY MAPA ──────────────────────────────────────────────────
check('sin Tx no se calcula raster ninguno', ctx.covRaster() === null && ctx.S._covRaster === null);
check('y no se gasta un lienzo en ello', lienzos === 0, lienzos);

// ── 2) CON Tx ──────────────────────────────────────────────────────────────
ctx.S.cov.tx = { x: 0, y: 0 };
const R = ctx.covRaster();
check('con Tx sale un raster', !!R && R.nx > 0 && R.ny > 0, R && { nx: R.nx, ny: R.ny });
/* La celda vive entre 4 y 10 m: por debajo cada celda es un predictLink y el coste se dispara;
   por encima se ven los escalones. */
check('la celda se queda entre 4 y 10 m', R.cell >= 4 && R.cell <= 10, R.cell);
check('el raster cubre la planta con su margen de 30 m',
  R.wx0 <= Math.min(...ctx.S.motors.map(m => m.x)) - 29 && R.wW >= 60, { wx0: R.wx0, wW: R.wW });
check('se pinta una imagen del tamaño del raster',
  ultimaImg && ultimaImg.width === R.nx && ultimaImg.height === R.ny, ultimaImg && [ultimaImg.width, ultimaImg.height]);
check('con todas las celdas opacas al 205', ultimaImg.data[3] === 205 && ultimaImg.data[ultimaImg.data.length - 1] === 205);

// ── 3) LA FÍSICA ES LA DEL REPO, celda a celda ─────────────────────────────
/* Ésta es la comprobación por la que existe el fichero. Se recalcula UNA celda a mano con las
   funciones mantenidas y se compara con el píxel que salió. Si alguien mete otro modelo de
   obstáculos —el de x = k·pitch, por ejemplo— el color deja de cuadrar. */
const rows = ctx.rfRows();
/* TODAS las celdas, no una muestra. Con tres muestras esto pasaba en verde teniendo puesta la
   física mala: el color va en CINCO bandas, así que dos modelos distintos caen en la misma banda
   con muchísima facilidad y el banco no se enteraba. Medido: inyectando el modelo viejo con otro
   nombre —para que el guardia de texto no lo viera—, las tres muestras coincidían. Comparando el
   raster entero, no hay dónde esconderse. */
let malas = 0, primera = null;
for (let iy = 0; iy < R.ny; iy++) {
  const wy = R.wy0 + R.wH - (iy + 0.5) * (R.wH / R.ny);
  for (let ix = 0; ix < R.nx; ix++) {
    const wx = R.wx0 + (ix + 0.5) * (R.wW / R.nx);
    const e = ctx._covRgb(ctx.rfColor(ctx.rfMargin(ctx.S.cov.tx, { x: wx, y: wy }, rows)));
    const o = (iy * R.nx + ix) * 4;
    if (ultimaImg.data[o] !== e[0] || ultimaImg.data[o + 1] !== e[1] || ultimaImg.data[o + 2] !== e[2]) {
      if (!malas) primera = { ix, iy, esperado: e, salio: [ultimaImg.data[o], ultimaImg.data[o+1], ultimaImg.data[o+2]] };
      malas++;
    }
  }
}
check('las ' + (R.nx * R.ny) + ' celdas son exactamente rfColor(rfMargin(...)) del repo',
  malas === 0, { celdasMal: malas, primera });

/* Y el contador: el raster tiene que pedirle TODAS sus celdas a `rfMargin`. Si una parte saliera
   de otro sitio, el número no daría. */
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
const ejeFila = { x: Math.sin(a), y: Math.cos(a) };          // a lo largo del tracker (el pasillo)
const ejePaso = { x: Math.cos(a), y: -Math.sin(a) };         // atravesando filas
const D = 90;
const mgParalelo = ctx.rfMargin({ x: 0, y: 0 }, { x: ejeFila.x * D, y: ejeFila.y * D }, rows);
const mgCruzado  = ctx.rfMargin({ x: 0, y: 0 }, { x: ejePaso.x * D, y: ejePaso.y * D }, rows);
check('en planta girada, el enlace por el pasillo es MEJOR que el que cruza filas',
  mgParalelo > mgCruzado, { paralelo: +mgParalelo.toFixed(2), cruzado: +mgCruzado.toFixed(2) });
check('y la diferencia es de verdad, no ruido (>5 dB)',
  mgParalelo - mgCruzado > 5, +(mgParalelo - mgCruzado).toFixed(2));

// ── 4) LA CACHÉ, y lo que TIENE que invalidarla ────────────────────────────
ctx.S._covSig = undefined; ctx.S._covRaster = undefined;
const R1 = ctx.covRaster(), lienzosTras = lienzos;
const R2 = ctx.covRaster();
check('repetir sin cambiar nada no recalcula', R1 === R2 && lienzos === lienzosTras);
/* El tilt entra en la firma porque el mapa cambia ENTERO con él: las filas tapan más o menos
   según cómo estén giradas. Sin el tilt dentro, mover el deslizador no repintaba nada. */
ctx._tilt = -40;
const R3 = ctx.covRaster();
check('cambiar la inclinación SÍ lo recalcula', R3 !== R2 && lienzos === lienzosTras + 1);
ctx._tilt = 30;
ctx.S.cov.tx = { x: 40, y: 15 };
const R4 = ctx.covRaster();
check('y mover el Tx también', R4 !== R3);
const nMotors = ctx.S.motors.length;
ctx.S.motors = ctx.S.motors.slice(0, nMotors - 1); ctx.S._rfRows = null;
const R5 = ctx.covRaster();
check('y quitar seguidores también', R5 !== R4);

console.log('');
if (ko) { console.log('FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'); process.exit(1); }
console.log('OK — ' + ok + '/' + ok + ' comprobaciones');
