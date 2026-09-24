/* EL MOTOR DE LA APP, CARGADO UNA SOLA VEZ Y EN UN SOLO SITIO.
 *
 * `medido_vs_predicho.mjs` y `robustez_medida.mjs` necesitan los dos lo mismo:
 * el bloque RF del `index.html` REAL corriendo en un contexto `vm`, con una
 * planta cargada en `S.motors` y los parámetros de radio puestos.
 *
 * Vive aquí para que sea UNA carga y no dos. Dos copias de este arranque
 * divergirían en silencio —una cargaría los parámetros y la otra no, y sus
 * números dejarían de ser comparables sin que nada lo dijera—, que es
 * exactamente lo que `test_una_holgura.js` vigila en el motor y lo que vale
 * igual aquí.
 *
 * NO REIMPLEMENTA NADA: extrae el bloque del HTML de verdad, como hace
 * `tests/test_rf_cobertura.js` y como hace `careo_terreno_3d.mjs` con `relAt`.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function hermano() {
  return [path.join(RAIZ, '..', 'Cobertura-Zigbee'), path.join(RAIZ, '..', 'cobertura-zigbee')]
    .find(p => fs.existsSync(p)) || null;
}

/* Devuelve {ctx, S, motors, rows} o lanza con un mensaje que el que llama
   convierte en rc = 2. Nunca devuelve a medias. */
export function cargaApp(layout) {
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const bloque = html.match(/const RF_PITCH_M[\s\S]*?\n}\n(?=function rfColor)/);
  if (!bloque) throw new Error('no localizo el bloque RF en index.html (¿se ha renombrado `rfColor`?)');

  const ctx = {
    console, require, Math, JSON, Object, Array, Number, String, isFinite, parseFloat,
    RadioPV: require(path.join(RAIZ, 'radio_pv_model.js')),
    RadioZigbee: require(path.join(RAIZ, 'radio_zigbee.js')),
    ZigbeePV: require(path.join(RAIZ, 'zigbee_pv_model.js')),
    document: { getElementById: () => null },
    S: { motors: [], p: { twid: 12, tlen: 64 }, bifila: null, _rfRows: null, rf: {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  try { vm.runInContext(bloque[0], ctx); }
  catch (e) { throw new Error('el bloque RF no compila fuera del navegador: ' + e.message); }

  /* Los parámetros de radio: la app los pide por `fetch`. Sin ellos
     `rfVariante()` da null y TODOS los enlaces salen «no evaluado» — pasó de
     verdad, y el informe publicó 49 de 49 sin veredicto como si fuera un
     resultado. */
  ctx.S._radioParams = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
  if (!ctx.rfVariante()) throw new Error('los parámetros de radio no cargan: rfVariante() da null');

  ctx.S.motors = layout.trackers.map(t => ({ x: t.x, y: t.n, az: t.rot || 0, id: String(t.id),
                                             ncu: t.ncu, gw: t.gw, desig: t.desig }));
  ctx.S._rfRows = null;
  return { ctx, S: ctx.S, motors: ctx.S.motors, rows: ctx.rfRows() };
}

/* LA CLAVE DE UN SEGUIDOR ES (NCU, ESCLAVO), NO EL ESCLAVO A SECAS.
   `numeracion.regla` de los layouts: «esclavo CORRIDO dentro de cada NCU», o
   sea que el 58 existe en la NCU 1 y en la NCU 2. Con la clave sólo por
   esclavo, 28 nodos de El Burgo apuntaban al seguidor equivocado y el informe
   daba un 91,8 % de aciertos perfectamente creíble. Va aquí para que los dos
   útiles usen la misma. */
export const claveTcu = (ncu, esclavo) => String(Number(ncu)) + ':' + String(Number(esclavo));

/* Une los nodos de una malla medida con los seguidores del layout, por la
   clave declarada. Devuelve {nodos, sinCruzar, desigDiscrepa} — el que llama
   decide qué hace con los dos últimos, pero NO se emparejan por cercanía. */
export function uneNodos(real, motors) {
  const porId = new Map(motors.map((m, i) => [claveTcu(m.ncu, m.id), i]));
  const nodos = new Map(), sinCruzar = [], desigDiscrepa = [];
  for (const f of real.features) {
    if (f.geometry.type !== 'Point') continue;
    const p = f.properties, m = /TCU_SUNNER_ID_(\d+)/.exec(p.id || '');
    if (!m) { nodos.set(p.id, { coord: true, props: p }); continue; }
    const i = porId.get(claveTcu(p.ncu, m[1]));
    if (i == null) { sinCruzar.push(p.id); continue; }
    if (p.desig && motors[i].desig && p.desig !== motors[i].desig)
      desigDiscrepa.push(p.id + ': real ' + p.desig + ' ≠ layout ' + motors[i].desig);
    nodos.set(p.id, { i, props: p });
  }
  return { nodos, sinCruzar, desigDiscrepa };
}

/* Wilson al 95 %. Un porcentaje sobre pocos casos sin su intervalo no
   distingue un modelo bueno de uno mediocre. */
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const d = n + z * z, c = (k + z * z / 2) / d;
  const h = (z / d) * Math.sqrt(k * (n - k) / n + z * z / 4);
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
export const ic = (k, n) => { const w = wilson(k, n); return w ? '[' + (100 * w[0]).toFixed(1) + '–' + (100 * w[1]).toFixed(1) + ' %]' : ''; };
