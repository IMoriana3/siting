/* ROBUSTEZ — fase 4, punto 4. El modelo contra la malla, en el GRAFO.
 *
 * ═══ LAS DOS COSAS QUE MIDE, Y POR QUÉ LA SEGUNDA ES LA QUE DECIDE ═══
 *
 * 1 · PUNTOS DE CORTE. Y hay que distinguir dos que se parecen y no lo son:
 *
 *     · corte del ÁRBOL DE ENCAMINAMIENTO — trivial. En un árbol TODO nodo
 *       interno es punto de corte: en El Burgo son 30 de 53, y no informan de
 *       nada. El `is_spof` del geojson, además, sólo marca el COORD.
 *     · corte del GRAFO DE ENLACES VIABLES — esto sí. Es el que dice si, al
 *       caerse un nodo, otros se quedan SIN NINGUNA ruta, no sin la que
 *       estaban usando. Es lo que decide dónde va una NCU.
 *
 *     El árbol del geojson no sirve para carear: tiene 30 cortes triviales.
 *     Con los pares OBSERVADOS el grafo real tiene redundancia y la pregunta
 *     vuelve a tener sentido.
 *
 * 2 · EL GRADO, que es lo accionable. Por nodo: vecinos que el modelo da como
 *     viables, frente a vecinos DISTINTOS que la malla usó de verdad.
 *
 *     · un par viable que la malla nunca usó NO es un fallo — la malla elige
 *       el mejor, no todos los posibles;
 *     · pero si el modelo da 60 vecinos donde la malla usó 21, ese FACTOR mide
 *       lo optimista que es el modelo sin tener que llamarlo error;
 *     · y al revés SÍ es error: un par que la malla USÓ y el modelo no da como
 *       viable. Es la clase «lo mata» del punto 3, vista desde el grafo.
 *
 *     Con eso la capa puede decir «este nodo tiene 3 vecinos viables según el
 *     modelo y la malla le ha visto 7», que sirve para mover una NCU. «30
 *     nodos críticos» no sirve para nada.
 *
 *     node tools/robustez_medida.mjs [--pares ../Cobertura-Zigbee/elburgo_pares.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cargaApp, uneNodos, hermano, RAIZ, ic } from './_motor_app.mjs';

const require = createRequire(import.meta.url);
const RM = require(path.join(RAIZ, 'radio_malla.js'));
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const H = hermano();
if (!H) { console.log('SIN MEDIDA: falta el repo hermano.\nNo se ha comparado nada. Esto no es un verde.'); process.exit(2); }
const fLay = path.join(H, 'elburgo_layout.json'), fReal = path.join(H, 'elburgo_real.geojson');
for (const f of [fLay, fReal]) if (!fs.existsSync(f)) {
  console.log('SIN MEDIDA: falta ' + path.basename(f) + '.\nNo se ha comparado nada. Esto no es un verde.'); process.exit(2);
}
const L = JSON.parse(fs.readFileSync(fLay, 'utf8'));
const REAL = JSON.parse(fs.readFileSync(fReal, 'utf8'));
let APP; try { APP = cargaApp(L); } catch (e) { console.log('SIN MEDIDA: ' + e.message); process.exit(2); }
const { ctx } = APP;
const { nodos } = uneNodos(REAL, ctx.S.motors);

/* ── LA ADYACENCIA REAL: de los pares observados, o del árbol si no hay ──── */
const fPares = arg('pares', path.join(H, 'elburgo_pares.json'));
let paresReales = null, manif = null, fuente;
if (fs.existsSync(fPares)) {
  const P = JSON.parse(fs.readFileSync(fPares, 'utf8'));
  manif = P.fuente; paresReales = P.pares.map(p => ({ a: p.a, b: p.b, n: p.n }));
  fuente = 'pares OBSERVADOS (' + paresReales.length + ' pares, ' + path.basename(fPares) + ')';
} else {
  paresReales = REAL.features.filter(f => f.geometry.type === 'LineString')
    .map(f => ({ a: f.properties.origen, b: f.properties.destino, n: null }));
  fuente = 'el ÁRBOL del geojson (' + paresReales.length + ' enlaces) — NO sirve para carear cortes';
}

/* ¿el lado «real» es un ÁRBOL? Entonces el grado de la malla es 1 para casi
   todos los nodos —un padre por TCU— y la razón modelo/malla sale ×51 sin
   significar nada: es la elección de dibujo del fichero, no lo optimista que
   sea el modelo. La primera corrida publicó «p50 ×25,5» y era exactamente
   eso. Con la bandera puesta, el grado NO se publica como medida. */
const ARBOL = !paresReales.some(p => p.n != null) && paresReales.length <= 60;

/* ── EL GRADO REAL: vecinos DISTINTOS que la malla usó, por nodo ─────────── */
const CORTES = [1, 10, 100, 1000];
const gradoReal = new Map(), gradoRealPorFrec = new Map();
for (const p of paresReales) {
  for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) {
    if (!gradoReal.has(x)) { gradoReal.set(x, new Set()); gradoRealPorFrec.set(x, CORTES.map(() => new Set())); }
    gradoReal.get(x).add(y);
    if (p.n != null) CORTES.forEach((c, i) => { if (p.n >= c) gradoRealPorFrec.get(x)[i].add(y); });
  }
}

/* ── EL GRADO DEL MODELO: `vecinosViables` con el rfEnlace de la app ─────── */
const conLayout = [...nodos.entries()].filter(([, v]) => v.i != null);
const nodosRM = conLayout.map(([id, v]) => ({ id, x: ctx.S.motors[v.i].x, y: ctx.S.motors[v.i].y, i: v.i }));
const idx = new Map(nodosRM.map(n => [n.id, n]));
const rows = APP.rows;
const enlaza = (a, b) => {
  const n = { ...ctx.S.motors[a.i], i: a.i }, m = { ...ctx.S.motors[b.i], i: b.i };
  let pr; try { pr = ctx.rfEnlace(n, m, rows); } catch (e) { return { viable: null, margenDb: null }; }
  const mg = pr && pr.margenDb;
  return { viable: mg == null ? null : mg >= 0, margenDb: mg };
};
const an = RM.analiza(nodosRM, enlaza, [], null);

/* ── LA COMPARACIÓN ──────────────────────────────────────────────────────── */
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + ' %' : '—';
const perc = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

console.log('ROBUSTEZ · El Burgo · el modelo contra la malla\n');
console.log('  ═══ ALCANCE ═══');
console.log('    adyacencia real           ' + fuente);
if (manif) {
  console.log('    exportación               ' + (manif.sha256 || '?').slice(0, 12) + ' · ' + manif.filas + ' filas · ' + manif.instantaneas + ' instantáneas');
  console.log('    procedencia               ' + (manif.procedencia && manif.procedencia.declarada ? manif.procedencia.traida : '⚠ SIN DECLARAR'));
}
console.log('    nodos con layout          ' + nodosRM.length + ' de ' + [...nodos.keys()].length);
console.log('    pares evaluados por el modelo ' + an.evaluados + ' · sin veredicto ' + (an.desconocidos || []).length + '\n');

/* 1 · los dos tipos de corte */
const cortesArbol = (() => {
  const ady = new Map();
  for (const p of paresReales) { for (const [x, y] of [[p.a, p.b], [p.b, p.a]]) { if (!ady.has(x)) ady.set(x, []); ady.get(x).push(y); } }
  return RM.articulaciones(ady);
})();
console.log('  ═══ 1 · PUNTOS DE CORTE: dos cosas que se parecen y no lo son ═══');
console.log('    del ÁRBOL / grafo medido  ' + String(cortesArbol.size).padStart(3)
          + '   ' + (ARBOL ? '← TRIVIAL: en un árbol todo nodo interno lo es' : ''));
console.log('    del grafo VIABLE (modelo) ' + String(an.articulaciones.size).padStart(3)
          + '   ← el que decide dónde va una NCU');
console.log('    ¿el grafo del modelo es un árbol? ' + (an.esArbol ? 'SÍ — sus cortes tampoco informan' : 'no, tiene redundancia'));
if (ARBOL) {
  console.log('');
  console.log('    NO SE CAREAN. El árbol del geojson tiene cortes triviales y el `is_spof`');
  console.log('    del fichero sólo marca el COORD. Hace falta la lista de pares observados');
  console.log('    para que el grafo medido tenga redundancia y la pregunta signifique algo.');
}

/* 2 · el grado */
let usadosNoViables = 0, usadosTotal = 0, delCoord = 0;
/* Esto se cuenta SIEMPRE, con árbol o con pares: es la única clase que es un
   ERROR del modelo, y no depende de cómo dibuje el fichero su lado real. Se me
   quedó dentro del `else` del grado y reventaba con el árbol. */
for (const p of paresReales) {
  if (!idx.get(p.a) || !idx.get(p.b)) {
    /* EL COORD NO ES UN SEGUIDOR y no tiene posición en el layout, así que sus
       enlaces NO SE PUEDEN EVALUAR: el modelo necesita dos puntos. Se contaban
       en un «sin nodo» mudo, y eso esconde que la NCU —el nodo del que cuelga
       toda la planta— queda fuera de la comparación entera.
       El layout trae un bloque `comms`; situar ahí el coordinador es lo que lo
       arreglaría, y no se hace a ojo. */
    if ((nodos.get(p.a) || {}).coord || (nodos.get(p.b) || {}).coord) delCoord++;
    continue;
  }
  usadosTotal++;
  if (!(an.ady.get(p.a) || []).includes(p.b)) usadosNoViables++;
}

console.log('\n  ═══ 2 · EL GRADO: lo que el modelo cree frente a lo que la malla usó ═══');
if (ARBOL) {
  console.log('');
  console.log('    NO SE PUBLICA la razón modelo/malla. El lado «real» es el ÁRBOL: un');
  console.log('    padre por TCU, o sea grado 1 en casi todos los nodos. La razón sale');
  console.log('    ×50 y no mide lo optimista que es el modelo — mide que el fichero');
  console.log('    dibuja un árbol. Es el mismo defecto que el p50 = 0,00 m del DEM: un');
  console.log('    número correcto sobre la población equivocada.');
  console.log('');
  console.log('    Con los pares observados el grado real es el de VERDAD —los vecinos');
  console.log('    distintos que la malla usó en 25.766 instantáneas— y la razón pasa a');
  console.log('    significar algo.');
} else {
console.log('');
console.log('    nodo            modelo   malla   razón');
const filas = [];
for (const n of nodosRM) {
  const gm = (an.ady.get(n.id) || []).length;
  const gr = (gradoReal.get(n.id) || new Set()).size;
  if (gr > 0) filas.push({ id: n.id, gm, gr, r: gm / gr, etq: nodos.get(n.id).props.etiqueta || n.id });
}
for (const f of filas.sort((a, b) => b.r - a.r).slice(0, 8))
  console.log('    ' + String(f.etq).padEnd(15) + String(f.gm).padStart(6) + String(f.gr).padStart(8) + '   ×' + f.r.toFixed(1));
if (filas.length > 8) console.log('    … y ' + (filas.length - 8) + ' nodos más');
const rr = filas.map(f => f.r);
console.log('');
console.log('    RAZÓN modelo/malla        p50 ×' + (perc(rr, 0.5) || 0).toFixed(1)
          + ' · p95 ×' + (perc(rr, 0.95) || 0).toFixed(1) + ' · máx ×' + (Math.max(...rr, 0)).toFixed(1));
console.log('    Un par viable que la malla nunca usó NO es un fallo: la malla elige el');
console.log('    mejor, no todos los posibles. Este factor mide lo OPTIMISTA que es el');
console.log('    modelo, que es otra cosa y se publica como tal.');
}
console.log('');
console.log('    LO QUE SÍ ES ERROR — pares que la malla USÓ y el modelo no da viables:');
console.log('      ' + usadosNoViables + ' de ' + usadosTotal + '  ' + pct(usadosNoViables, usadosTotal)
          + '  ' + ic(usadosNoViables, usadosTotal));
console.log('      Es la clase «lo mata» del punto 3, vista desde el grafo.');
if (delCoord) {
  console.log('');
  console.log('    Y ' + delCoord + ' enlace(s) del COORD que NO SE PUEDEN EVALUAR: el coordinador no');
  console.log('    es un seguidor y no tiene posición en el layout, así que el modelo no');
  console.log('    tiene dos puntos que unir. Queda FUERA de la comparación el nodo del');
  console.log('    que cuelga toda la planta. El layout trae un bloque `comms`; situarlo');
  console.log('    ahí es lo que lo arreglaría, y no se hace a ojo.');
}

console.log('\n  ═══ LO QUE ESTO NO DICE ═══');
console.log('    Los pares medidos son pares que la malla USÓ. Un par nunca usado no es');
console.log('    un par imposible: puede que nunca hiciera falta. El sesgo de');
console.log('    supervivencia baja con los pares observados, pero no desaparece.');
process.exit(0);
