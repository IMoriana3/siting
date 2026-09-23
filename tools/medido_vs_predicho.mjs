/* MEDIDO FRENTE A PREDICHO — fase 4, punto 3.
 *
 * ═══ QUÉ COMPARA, Y CONTRA QUÉ ═══
 *
 * La malla que la planta USA DE VERDAD, contra lo que el modelo dice de esos
 * mismos enlaces. El dato de campo es `elburgo_real.geojson`, que sale de
 * 8.053 instantáneas y 406.457 filas de rutas del recolector.
 *
 * ═══ LA TRAMPA DE LA POBLACIÓN, Y POR QUÉ NO SE PUBLICA «SIN RESPALDO» ═══
 *
 * El geojson dibuja 52 enlaces: UNO POR TCU, su padre dominante. Es un ÁRBOL de
 * encaminamiento, no el conjunto de enlaces viables. Y los propios nodos
 * declaran `padres_distintos` entre 6 y 30 —mediana 18, unos 950 en total—, o
 * sea que la malla CONOCE ~950 relaciones padre-hijo y dibuja 52.
 *
 * Por eso aquí NO se publica «predicciones sin respaldo» como si fueran
 * errores: contar las predicciones que sobran de los 52 mediría la elección de
 * dibujo del fichero, no el modelo. Es el mismo defecto que el p50 = 0,00 m del
 * DEM —un número correcto sobre la población equivocada— y está escrito en
 * `proyectos/docs/puertas-y-alcance.md`.
 *
 * Las clases que SÍ significan algo:
 *
 *   ACIERTO        enlace medido que el modelo da viable
 *   LO MATA        enlace que la planta usa y el modelo declara tapado
 *                  ← la clase que vale: un fallo del modelo, sin discusión
 *   NO EVALUADO    el modelo no da veredicto (falta perfil, parámetros…)
 *
 * ═══ LA LISTA COMPLETA, QUE ES LO QUE FALTA ═══
 *
 * `--pares <fichero>` acepta la lista de pares OBSERVADOS con su frecuencia, y
 * entonces la clase «lo mata» pasa de 52 casos a ~950. Ese fichero sale de
 * `zigbee_routes.csv` —el crudo del recolector, que NO está en el repo— con
 * `cobertura-zigbee/tools/pares_observados.mjs`. Mientras no esté, esto corre
 * con los 52 y lo DICE.
 *
 *     node tools/medido_vs_predicho.mjs
 *     node tools/medido_vs_predicho.mjs --pares ../Cobertura-Zigbee/elburgo_pares.json
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const HERMANO = [path.join(RAIZ, '..', 'Cobertura-Zigbee'), path.join(RAIZ, '..', 'cobertura-zigbee')]
  .find(p => fs.existsSync(p));
if (!HERMANO) {
  console.log('SIN CAREO: falta el repo hermano, de donde salen el layout y la malla medida.');
  console.log('No se ha comparado nada. Esto no es un verde.');
  process.exit(2);
}
const fReal = path.join(HERMANO, 'elburgo_real.geojson');
const fLay = path.join(HERMANO, 'elburgo_layout.json');
for (const f of [fReal, fLay]) if (!fs.existsSync(f)) {
  console.log('SIN CAREO: falta ' + path.basename(f) + '.');
  console.log('No se ha comparado nada. Esto no es un verde.');
  process.exit(2);
}

/* ── 1 · EL MOTOR DE LA APP, EXTRAÍDO DEL index.html DE VERDAD ────────────
   No se reimplementa `rfCruces`/`rfEnlace`: se ejecuta el bloque RF del HTML
   real en un contexto `vm`, igual que hace `tests/test_rf_cobertura.js`. Una
   segunda implementación mediría otra cosa que la app, que es justo lo que
   `test_una_holgura.js` existe para impedir. */
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const bloque = html.match(/const RF_PITCH_M[\s\S]*?\n}\n(?=function rfColor)/);
if (!bloque) {
  console.log('SIN CAREO: no localizo el bloque RF en index.html (¿se ha renombrado `rfColor`?).');
  process.exit(2);
}
const L = JSON.parse(fs.readFileSync(fLay, 'utf8'));
const REAL = JSON.parse(fs.readFileSync(fReal, 'utf8'));

const ctx = {
  console, require, Math, JSON, Object, Array, Number, String, isFinite, parseFloat,
  RadioPV: require(path.join(RAIZ, 'radio_pv_model.js')),
  RadioZigbee: require(path.join(RAIZ, 'radio_zigbee.js')),
  ZigbeePV: require(path.join(RAIZ, 'zigbee_pv_model.js')),
  document: { getElementById: () => null },
  fetch: undefined,
  S: { motors: [], p: { twid: 12, tlen: 64 }, bifila: null, _rfRows: null, rf: {} },
};
ctx.window = ctx;
vm.createContext(ctx);
try { vm.runInContext(bloque[0], ctx); }
catch (e) { console.log('SIN CAREO: el bloque RF no compila fuera del navegador: ' + e.message); process.exit(2); }

/* ── 2 · LA PLANTA, EN EL ESTADO DE LA APP ───────────────────────────────── */
/* Los parámetros de radio: la app los pide por `fetch` y aquí se cargan del
   fichero. Sin ellos `rfVariante()` da null y TODOS los enlaces salen «no
   evaluado» — que fue exactamente lo que pasó en la primera corrida: 49 de 49
   sin veredicto, y el informe lo publicó como si fuera un resultado. */
ctx.S._radioParams = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));

ctx.S.motors = L.trackers.map(t => ({ x: t.x, y: t.n, az: t.rot || 0, id: String(t.id),
                                      ncu: t.ncu, gw: t.gw, desig: t.desig }));
ctx.S._rfRows = null;

/* ── 3 · LA UNIÓN DE NODOS, DECLARADA Y NO POR CERCANÍA ──────────────────
   `elburgo_layout.json` → `numeracion.identificador`: «el id de cada seguidor
   es su NÚMERO DE ESCLAVO a secas, que es como lo nombra el equipo
   (TCU_SUNNER_ID_nnn)». Se une por ahí, y `desig` corrobora por los dos lados.
   Emparejar por proximidad está PROHIBIDO en este repo, y con razón: el propio
   fichero avisa de que las etiquetas se renumeraron. */
/* LA CLAVE ES (NCU, ESCLAVO), NO EL ESCLAVO A SECAS. `numeracion.regla` lo
   dice: «esclavo CORRIDO dentro de cada NCU», o sea que el 58 existe en la NCU
   1 y en la NCU 2. Con la clave sólo por esclavo, el Map se quedaba con el
   último y 28 nodos apuntaban al seguidor equivocado — sin ruido ninguno: el
   informe daba 91,8 % de aciertos.
   Lo cazó el careo de `desig`, que estaba puesto justo para eso: 28
   discrepancias del tipo «real 1.10.58 ≠ layout 2.10.58». Y lo confirmó medir
   MI distancia contra la `distancia_m` del fichero: ratios de 1,00 en los que
   acertaban y de hasta 33,8 en los que no. Un factor uniforme habría sido un
   problema de sistema de coordenadas; factores dispares son identidad. */
const clave = (ncu, esclavo) => String(Number(ncu)) + ':' + String(Number(esclavo));
const porId = new Map(ctx.S.motors.map((m, i) => [clave(m.ncu, m.id), i]));
const nodos = new Map(), sinCruzar = [], desigDiscrepa = [];
for (const f of REAL.features) {
  if (f.geometry.type !== 'Point') continue;
  const p = f.properties, m = /TCU_SUNNER_ID_(\d+)/.exec(p.id || '');
  if (!m) { if (p.role !== 'COORD') sinCruzar.push(p.id); nodos.set(p.id, { coord: true, props: p }); continue; }
  const i = porId.get(clave(p.ncu, m[1]));
  if (i == null) { sinCruzar.push(p.id); continue; }
  if (p.desig && ctx.S.motors[i].desig && p.desig !== ctx.S.motors[i].desig)
    desigDiscrepa.push(p.id + ': real ' + p.desig + ' ≠ layout ' + ctx.S.motors[i].desig);
  nodos.set(p.id, { i, props: p });
}

/* ── 4 · LOS PARES A EVALUAR ─────────────────────────────────────────────
   Dos fuentes, y se dice cuál se ha usado. Sin `--pares`, los 52 del árbol. */
const fPares = arg('pares', null);
let pares, fuente, aviso = null;
if (fPares && fs.existsSync(fPares)) {
  const P = JSON.parse(fs.readFileSync(fPares, 'utf8'));
  pares = (P.pares || P).map(x => ({ a: x.hijo || x[0], b: x.padre || x[1], n: x.n || x[2] || null }));
  fuente = 'lista de pares observados (' + path.basename(fPares) + ')';
} else {
  pares = REAL.features.filter(f => f.geometry.type === 'LineString')
    .map(f => ({ a: f.properties.origen, b: f.properties.destino, n: null,
                 rssi: f.properties.rssi_medido_dbm, d: f.properties.distancia_m }));
  fuente = 'el ÁRBOL del geojson: un enlace por TCU, su padre dominante';
  if (fPares) aviso = 'se pidió --pares ' + fPares + ' y ese fichero NO existe: se ha usado el árbol.';
}

/* ── 4bis · LAS DOS PUERTAS DE LA UNIÓN ──────────────────────────────────
   Las dos cazaron el mismo defecto y son INDEPENDIENTES, que es lo que las
   hace valer: `desig` compara etiquetas y la distancia compara geometría. Con
   la clave mala salían 28 discrepancias de desig y ratios de hasta 33,8; con
   la buena, cero y 1,00. Van como PUERTA y no como aviso, porque un informe
   con la unión mal hecha da un 91,8 % de aciertos que parece perfectamente
   razonable. */
if (desigDiscrepa.length) {
  console.log('ROJO · la unión de nodos no cuadra: ' + desigDiscrepa.length + ' desig discrepantes.');
  for (const d of desigDiscrepa.slice(0, 5)) console.log('    ' + d);
  console.log('  La clave es (NCU, esclavo): el número de esclavo se repite entre NCU.');
  process.exit(1);
}
/* LA EXCEPCIÓN DECLARADA. `TCU_SUNNER_ID_108` está en distinto sitio en el
   layout que en el censo medido: careando los 52 nodos distancia a distancia
   entre los dos ficheros, 51 coinciden con residuo máximo de 0,16 m y éste da
   18,30 m. La unión NO es el problema —su `desig` (1.18.108) cuadra por los
   dos lados—: lo que discrepa es la POSICIÓN, y son dos artefactos nuestros
   contradiciéndose.
   No se decide aquí cuál manda. Se declara, se excluye del veredicto, se
   cuenta aparte, y si algún día el residuo baja de 1 m esto se pone ROJO
   pidiendo que se quite la excepción — igual que las exenciones de
   `factiun-cartera/tests/correr.sh`. */
const FUERA_POS = { 'TCU_SUNNER_ID_108': 'posición discrepante entre layout y censo medido: residuo 18,30 m contra 0,16 m del resto. Pendiente de decidir cuál manda.' };
{
  const malas = [];
  for (const par of pares) {
    if (par.d == null) continue;                       // la lista de pares no trae distancia
    const A = nodos.get(par.a), B = nodos.get(par.b);
    if (!A || !B || A.i == null || B.i == null) continue;
    const a = ctx.S.motors[A.i], b = ctx.S.motors[B.i];
    const mia = Math.hypot(a.x - b.x, a.y - b.y);
    const r = par.d > 0 ? mia / par.d : null;
    const exento = FUERA_POS[par.a] || FUERA_POS[par.b];
    if (r != null && (r < 0.9 || r > 1.1)) { if (!exento) malas.push({ par, d: par.d, mia, r }); }
    else if (exento) malas.push({ par, d: par.d, mia, r, resuelto: true });
  }
  const conD = pares.filter(x => x.d != null).length;
  console.log('  unión comprobada: ' + (conD - malas.length) + ' de ' + conD
            + ' enlaces con la distancia del fichero a menos del 10 %');
  const resueltos = malas.filter(m => m.resuelto), rotos = malas.filter(m => !m.resuelto);
  for (const k of Object.keys(FUERA_POS))
    console.log('  ⚠ ' + k + ' EXCLUIDO: ' + FUERA_POS[k]);
  if (resueltos.length) {
    console.log('ROJO · ' + resueltos.length + ' enlace(s) exentos que YA cuadran: quita su excepción de FUERA_POS.');
    process.exit(1);
  }
  if (rotos.length) {
    const malas = rotos;
    console.log('ROJO · ' + malas.length + ' enlaces cuya geometría NO cuadra con `distancia_m`:');
    for (const m of malas.slice(0, 5))
      console.log('    ' + m.par.a + ' → ' + m.par.b + ': fichero ' + m.d + ' m, calculado '
                + m.mia.toFixed(0) + ' m (×' + m.r.toFixed(1) + ')');
    console.log('  Factores dispares = identidad de nodos mal resuelta. Un factor uniforme');
    console.log('  sería un problema de sistema de coordenadas.');
    process.exit(1);
  }
  console.log('');
}

/* ── 5 · EVALUAR CON EL rfEnlace DE LA APP ──────────────────────────────── */
const rows = ctx.rfRows();
const clases = { acierto: [], mata: [], noEval: [], sinNodo: [], excluido: [] };
for (const par of pares) {
  const A = nodos.get(par.a), B = nodos.get(par.b);
  if (FUERA_POS[par.a] || FUERA_POS[par.b]) { clases.excluido.push(par); continue; }
  if (!A || !B || A.coord || B.coord || A.i == null || B.i == null) { clases.sinNodo.push(par); continue; }
  const n = { ...ctx.S.motors[A.i], i: A.i }, m = { ...ctx.S.motors[B.i], i: B.i };
  let pr; try { pr = ctx.rfEnlace(n, m, rows); } catch (e) { clases.noEval.push({ ...par, err: e.message }); continue; }
  const mg = pr && pr.margenDb;
  if (mg == null) clases.noEval.push({ ...par, motivos: pr && pr.motivos });
  else if (mg >= 0) clases.acierto.push({ ...par, mg, D: pr.D });
  else clases.mata.push({ ...par, mg, D: pr.D, motivos: pr.motivos });
}

/* ── 6 · INFORME, con los denominadores delante ─────────────────────────── */
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + ' %' : '—';
console.log('MEDIDO FRENTE A PREDICHO · El Burgo\n');
console.log('  ═══ ALCANCE ═══');
console.log('    plantas con malla medida      1 de 10   (sólo El Burgo tiene `_real.geojson`)');
console.log('    fuente de los pares           ' + fuente);
if (aviso) console.log('    ⚠ ' + aviso);
console.log('    instantáneas / filas de ruta  ' + (REAL.snapshots || '?') + ' / ' + (REAL.periodo_filas_routes || '?'));
console.log('    nodos cruzados                ' + [...nodos.values()].filter(v => v.i != null).length
          + ' de ' + REAL.features.filter(f => f.geometry.type === 'Point').length);
if (sinCruzar.length) console.log('    ⚠ sin cruzar                  ' + sinCruzar.length + ': ' + sinCruzar.slice(0, 4).join(', '));
if (desigDiscrepa.length) console.log('    ⚠ desig discrepante           ' + desigDiscrepa.length + ': ' + desigDiscrepa.slice(0, 2).join(' · '));
const N = pares.length;
console.log('    pares evaluados               ' + (N - clases.sinNodo.length - clases.excluido.length) + ' de ' + N
          + (clases.excluido.length ? '   (' + clases.excluido.length + ' excluido(s) por posición discrepante)' : '') + '\n');

console.log('  ═══ VEREDICTO ═══');
const ev = N - clases.sinNodo.length - clases.excluido.length;
console.log('    ACIERTO       ' + String(clases.acierto.length).padStart(4) + '  ' + pct(clases.acierto.length, ev).padEnd(8) + ' el modelo da viable un enlace que la planta usa');
console.log('    LO MATA       ' + String(clases.mata.length).padStart(4) + '  ' + pct(clases.mata.length, ev).padEnd(8) + ' ← la clase que vale: el modelo tapa un enlace REAL');
console.log('    NO EVALUADO   ' + String(clases.noEval.length).padStart(4) + '  ' + pct(clases.noEval.length, ev).padEnd(8) + ' el modelo no da veredicto');
if (clases.sinNodo.length) console.log('    sin nodo      ' + String(clases.sinNodo.length).padStart(4) + '           un extremo no cruza con el layout');

if (clases.mata.length) {
  console.log('\n  ═══ LOS QUE EL MODELO MATA ═══');
  console.log('    hijo → padre              D(m)   margen   motivos');
  for (const x of clases.mata.sort((p, q) => p.mg - q.mg).slice(0, 12))
    console.log('    ' + ((nodos.get(x.a).props.etiqueta || x.a) + ' → ' + (nodos.get(x.b).props.etiqueta || x.b)).padEnd(24)
      + String(x.D.toFixed(0)).padStart(5) + '  ' + x.mg.toFixed(2).padStart(7) + '   ' + (x.motivos || []).slice(0, 2).join(', '));
  if (clases.mata.length > 12) console.log('    … y ' + (clases.mata.length - 12) + ' más');
}

console.log('\n  ═══ LO QUE ESTO NO DICE ═══');
console.log('    NO se publica «predicciones sin respaldo». El geojson dibuja un ÁRBOL');
console.log('    —un padre por TCU— y los nodos declaran entre 6 y 30 padres distintos');
console.log('    cada uno, unos 950 en total. Contar las predicciones que sobran de los');
console.log('    52 mediría la elección de dibujo del fichero, no el modelo.');
if (!fPares) {
  console.log('');
  console.log('    LA LISTA COMPLETA HACE FALTA, y sale de `zigbee_routes.csv` —el crudo');
  console.log('    del recolector, que NO está en el repo—. Con ella la clase «lo mata»');
  console.log('    pasa de ' + ev + ' casos a ~950, y se puede decir si el ' + pct(clases.mata.length, ev) + ' de hoy era');
  console.log('    representativo o un artefacto del árbol.');
}
process.exit(0);
