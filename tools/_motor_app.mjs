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
    /* EL SOL, para el ángulo por seguidor y por hora. Es la COPIA FIJADA de
       Cobertura-Zigbee, careada byte a byte por `tests/test_sol_pin.js`. */
    Sol: require(path.join(RAIZ, 'lib', 'sol.js')),
    RadioPV: require(path.join(RAIZ, 'radio_pv_model.js')),
    RadioZigbee: require(path.join(RAIZ, 'radio_zigbee.js')),
    ZigbeePV: require(path.join(RAIZ, 'zigbee_pv_model.js')),
    document: { getElementById: () => null },
    S: { motors: [], p: { twid: 12, tlen: 64 }, bifila: null, _rfRows: null,
         rf: { motor: 'nuevo', variante: 'zigbee_pro_24',
               sol: { on: false, lat: null, lon: null, horaUTC: null, gcr: null,
                      axisTilt: 0, axisAz: 0, backtrack: true, maxAngle: 60 } } },
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
/* la cota de la antena de la NCU, leída del JSON versionado y no escrita aquí */
export const ANTENA_NCU_M = (() => {
  const p = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
  const v = p.geometria && p.geometria.antena_ncu_m;
  if (!v || !(v.valor > 0)) throw new Error('radio_params.json no trae `geometria.antena_ncu_m`');
  return v.valor;
})();

export const claveTcu = (ncu, esclavo) => String(Number(ncu)) + ':' + String(Number(esclavo));

/* ── EL COORDINADOR, QUE ES LA NCU ───────────────────────────────────────
   El COORD de la malla medida NO es un seguidor y no tiene índice en
   `S.motors`, así que sus enlaces quedaban fuera de toda comparación — y son
   justo los que importan, porque elegir dónde va la NCU es para lo que existe
   Siting.

   SU POSICIÓN ESTÁ DECLARADA, no se deduce de sus hijos: `<planta>_layout.json`
   trae un bloque `ncus` con `{x, n, name}`. En El Burgo son dos, y CUÁL es el
   coordinador lo dice el DATO: los 52 enlaces medidos llevan `gw: "NCU1-GW2"`.
   Comprobado además por geometría —el residuo de la posición del COORD del
   geojson contra la NCU 1 del layout es p50 1,04 m sobre 51 TCU, y contra la
   NCU 2 sería 180 m—, que es confirmación independiente, no la fuente.

   OJO CON ESE 1,04 m: los seguidores cuadran entre los dos ficheros a 0,16 m y
   la NCU a 1,04. La posición de la NCU se conoce con MENOS precisión que la de
   un seguidor, y sobre un enlace de 29 m eso no es despreciable. Va dicho.

   SU ANTENA VA A 3,15 m, no a 0,48: `radio_params.json` → `antena_ncu_m`, con
   su cita («código: Cobertura-Zigbee/equipos.js `ncuAntY: 3.15` — CENTRO del
   látigo»). La física de un TCU→NCU no es la de un TCU→TCU. */
export function ncuDeLayout(layout, gw) {
  const ncus = layout.ncus || [];
  if (!ncus.length) return null;
  if (ncus.length === 1) return { ...ncus[0], idx: 0, porQue: 'el layout declara una sola NCU' };
  const m = /NCU\s*(\d+)/i.exec(String(gw || ''));
  if (!m) return null;
  const i = ncus.findIndex(n => new RegExp('NCU\\s*' + m[1] + '\\b', 'i').test(n.name || ''));
  return i < 0 ? null : { ...ncus[i], idx: i, porQue: 'los enlaces medidos declaran gw «' + gw + '»' };
}

/* Une los nodos de una malla medida con los seguidores del layout, por la
   clave declarada. Devuelve {nodos, sinCruzar, desigDiscrepa} — el que llama
   decide qué hace con los dos últimos, pero NO se emparejan por cercanía.
   `ncu` (opcional) da posición al COORD para que sus enlaces se evalúen. */
export function uneNodos(real, motors, ncu) {
  const porId = new Map(motors.map((m, i) => [claveTcu(m.ncu, m.id), i]));
  const nodos = new Map(), sinCruzar = [], desigDiscrepa = [];
  for (const f of real.features) {
    if (f.geometry.type !== 'Point') continue;
    const p = f.properties, m = /TCU_SUNNER_ID_(\d+)/.exec(p.id || '');
    if (!m) {
      /* el COORD con posición declarada entra como un nodo más, con su cota de
         antena propia; sin ella se queda fuera y SE DICE por qué */
      nodos.set(p.id, ncu
        ? { coord: true, props: p, pos: { x: ncu.x, y: ncu.n }, antenaM: ANTENA_NCU_M, esEquipo: true, ncu }
        : { coord: true, props: p, sinPos: 'el layout no declara la posición de su NCU' });
      continue;
    }
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
