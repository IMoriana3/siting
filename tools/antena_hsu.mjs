/* antena_hsu.mjs — cuánto mueve el margen la altura de antena de la HSU.
 *
 * ═══ DE DÓNDE SALE LA PREGUNTA ═══
 *
 * El plano FTR.24.00145_5_C («Montaje HSU», 8000 con niveles 4500/1000) trae
 * DOS cotas, y durante un tiempo se usó la que no era:
 *
 *   hsuTowerH   8,00 m   la torre de celosía triangular autoportante
 *   hsuAntY     6,50 m   los DOS látigos, en su propio brazo a media torre
 *
 * Los látigos estuvieron arriba, junto al anemómetro ultrasónico, y de ahí
 * venía el 8. Se bajaron a 6,50 al centro del elemento (confirmado por Ignacio,
 * ago-2026). `cobertura-zigbee/equipos.js` lo recogió, pero la capa de enlaces
 * de la meteo de `terreno.html` se quedó con un **8 literal** — y ese número NO
 * era un rótulo: es el 5º argumento de `link()`, que va directo a
 * `linkClearance()` y decide rojo/ámbar/verde. La misma página ya usaba 6,50 en
 * `cobAnchors()`, así que sus dos capas discrepaban 1,50 m entre sí.
 *
 * ═══ QUÉ MIDE ESTO ═══
 *
 * El margen del motor para el salto HSU→NCU con las dos cotas, sobre los
 * enlaces REALES de la cartera: para cada HSU de cada layout, su NCU más
 * cercana. No es un barrido de distancias inventadas.
 *
 *   node tools/antena_hsu.mjs [--hermano ../Cobertura-Zigbee]
 *                             [--torre 8.00] [--antena 6.50] [--ncu 3.15]
 *
 * ═══ MEDIDO EL 2026-09-23 — 40 enlaces, 10 plantas ═══
 *
 *   mediana  −1,37 dB        mínimo  −15,18 dB        máximo  +11,57 dB
 *
 * Y NO ES MONÓTONO, que es lo que hay que entender antes de leer la tabla: a
 * estas distancias el rayo directo y el reflejado en el suelo entran y salen de
 * fase, así que bajar la antena 1,50 m sube o baja el margen más de 10 dB según
 * dónde caiga el enlace en el patrón de lóbulos. Los peores: Panbianco a
 * 333,1 m pierde 15,18 dB y San José a 319,1 m pierde 12,13.
 *
 * O sea que **no se puede resumir en un signo**: «la cota buena da menos
 * margen» es falso en 16 de los 40 (sube en 16, baja en 24). Lo que sí se puede decir es que la cota
 * equivocada movía el margen DECENAS de veces el ruido del modelo, y que por
 * eso no era un detalle de dibujo.
 *
 * ═══ LO QUE ESTE ÚTIL NO HACE ═══
 *
 * No mira obstáculos: va con `cruces: []` y `perfil: null`, o sea suelo plano y
 * sin filas por medio. El salto HSU→NCU real cruza filas, y eso añade
 * difracción que aquí no está. Sirve para acotar lo que mueve LA ALTURA, que es
 * la pregunta; no para predecir el enlace.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const RZ = require(path.join(RAIZ, 'radio_zigbee.js'));
const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const V = P.tecnologias.zigbee_pro_24;
const PROP = { eps_r_suelo: P.propagacion.eps_r_suelo.valor,
               sigma_suelo_s_m: P.propagacion.sigma_suelo_s_m.valor,
               polarizacion: P.propagacion.polarizacion.valor,
               sigma_db: P.propagacion.sigma_db.valor,
               vegetacion: { modelo: P.vegetacion.modelo.valor } };

const HERMANO = arg('hermano', path.join(RAIZ, '..', 'Cobertura-Zigbee'));
const TORRE = parseFloat(arg('torre', '8.00'));
const ANTENA = parseFloat(arg('antena', '6.50'));
const NCU = parseFloat(arg('ncu', '3.15'));

if (!fs.existsSync(HERMANO)) {
  console.log('SIN MEDIDA: falta el repo hermano en ' + HERMANO + ' (de ahí salen los layouts).');
  console.log('No se ha medido nada. Esto no es un verde.');
  /* rc = 2, NO 0: «no comprobado» tiene que salir DISTINTO de «comprobado y
     pasa». Con rc = 0 este util imprimia «Esto no es un verde» y la CI lo
     pintaba verde igual — el agregador lee el codigo de salida, no el texto.
     Es el mismo defecto que #738 arreglo en el banco de configuracion. */
  process.exit(2);
}

const enlaces = [];
for (const f of fs.readdirSync(HERMANO).filter(x => x.endsWith('_layout.json'))) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(HERMANO, f), 'utf8')); } catch (e) { continue; }
  const meteo = d.meteo || [], ncus = d.ncus || [];
  for (const h of meteo) {
    let best = Infinity;
    for (const c of ncus) best = Math.min(best, Math.hypot(h.x - c.x, h.n - c.n));
    /* Se descartan los vanos por debajo de 1 m: son HSU plantadas encima de su
       NCU en el layout, y ahí el modelo de dos rayos no dice nada útil. Se
       cuentan aparte en vez de colarse en la mediana. */
    if (isFinite(best) && best > 1) enlaces.push([f.replace('_layout.json', ''), best]);
  }
}
// rc = 2 por lo mismo: sin enlaces no se ha medido nada.
if (!enlaces.length) { console.log('SIN MEDIDA: ningún layout del hermano trae meteo y NCU a la vez.'); console.log('No se ha medido nada. Esto no es un verde.'); process.exit(2); }

const pct = (a, p) => { const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log('variante: ' + (V.nombre || 'zigbee_pro_24') + '  ·  NCU a ' + NCU.toFixed(2) + ' m'
          + '  ·  suelo plano, sin filas cruzadas (ver cabecera)');
console.log(enlaces.length + ' enlaces HSU→NCU más cercana, de ' + new Set(enlaces.map(e => e[0])).size + ' plantas\n');
console.log('  planta          D(m)   margen ' + TORRE.toFixed(2) + ' m   margen ' + ANTENA.toFixed(2) + ' m     delta');

const dif = [];
for (const [pl, D] of enlaces.sort((a, b) => a[1] - b[1])) {
  const a = RZ.presupuesto({ D, zA: TORRE, zB: NCU, cruces: [], perfil: null }, V, PROP, null);
  const b = RZ.presupuesto({ D, zA: ANTENA, zB: NCU, cruces: [], perfil: null }, V, PROP, null);
  if (a.margenDb === null || b.margenDb === null) {
    console.log('  ' + pl.padEnd(13) + D.toFixed(1).padStart(7) + '   sin margen: ' + a.motivos.join(','));
    continue;
  }
  const d = b.margenDb - a.margenDb;
  dif.push(d);
  console.log('  ' + pl.padEnd(13) + D.toFixed(1).padStart(7) + a.margenDb.toFixed(2).padStart(14)
            + b.margenDb.toFixed(2).padStart(16) + (d >= 0 ? '+' : '') + d.toFixed(2).padStart(9));
}
if (!dif.length) { console.log('\nningún enlace dio margen: revisa la variante'); process.exit(1); }

const suben = dif.filter(v => v > 0).length;
console.log('\n  delta  p50 ' + pct(dif, 0.5).toFixed(2) + ' dB  ·  mín ' + Math.min(...dif).toFixed(2)
          + '  ·  máx ' + Math.max(...dif).toFixed(2) + '  dB');
console.log('  la cota buena SUBE el margen en ' + suben + ' de ' + dif.length
          + ' y lo BAJA en ' + (dif.length - suben) + '.');
console.log('  NO se puede resumir en un signo: son dos rayos, y a estas distancias');
console.log('  el directo y el reflejado entran y salen de fase con la altura.');
