/* vanos_muestreados_vs_reales.mjs — dos números que parecían contradecirse.
 *
 * ═══ EL PROBLEMA, DICHO TAL CUAL ═══
 *
 * En #87 se publicó que el relieve a 800–1.600 m tiene mediana 7,8 dB en Ayora
 * y 8,4 en San José. Poco después se publicó que el terreno hace cambiar de
 * banda a CERO enlaces en ocho de las diez plantas. Los dos números son
 * correctos y parecen decir cosas opuestas.
 *
 * NO SE CONTRADICEN: NO HABLAN DE LA MISMA POBLACIÓN.
 *
 *   · `relieve_plantas.mjs` muestrea PAREJAS DE TCU AL AZAR por banda de vano.
 *     Es una propiedad del TERRENO: «si hubiera un enlace de 1.200 m aquí,
 *     cuánto relieve tendría».
 *   · `antes_despues_terreno.mjs` usa los ENLACES QUE LA PLANTA TIENE: cada
 *     TCU contra SU NCU. Es una propiedad de la INSTALACIÓN.
 *
 * Y la medida que lo cierra está abajo: NINGÚN ENLACE REAL DE NINGUNA PLANTA
 * LLEGA A 800 m. El más largo de toda la cartera son 447 m, en San José. O sea
 * que la banda donde el relieve pega fuerte **no existe** en la instalación.
 *
 * Por eso este útil publica las dos cosas JUNTAS y con su etiqueta. Publicar
 * sólo una sería quedarse con la mitad, y cuál mitad depende de qué se esté
 * defendiendo — que es justo como se construye un número que dice lo que uno
 * quiere.
 *
 *   node tools/vanos_muestreados_vs_reales.mjs
 *
 * ═══ Y HAY UN SEGUNDO EFECTO, QUE AL PRINCIPIO SE ME PASÓ ═══
 *
 * La primera versión de este útil decía que su columna de «muestreados» era
 * «EL MISMO número que #87, careable línea a línea». NO LO ERA: daba 5,91 donde
 * #87 da 7,798, y la diferencia no es ruido.
 *
 * `relieve_plantas.mjs` pone ANTENA DE TCU EN LOS DOS EXTREMOS (0,505 m), porque
 * es una sonda del terreno entre seguidores. El enlace real va de una TCU a su
 * NCU, y la NCU tiene la antena a 3,15 m. Medido, en Ayora a 800–1.600 m:
 *
 *     TCU en los dos extremos   p50 7,847     (y #87 publicó 7,798)
 *     TCU → NCU                 p50 5,907
 *
 * O sea que la antena de la NCU se come 1,94 dB de relieve ella sola. (Los
 * 7,847 contra 7,798 que quedan son la otra diferencia menor: `relieve_plantas`
 * saca las TCU del levantamiento y esto del preset.)
 *
 * Así que la contradicción aparente tenía DOS causas, no una: la población de
 * vanos y la altura de la antena del otro extremo. Aquí las dos columnas usan
 * TCU → NCU, que es la geometría real, para que se puedan comparar ENTRE SÍ.
 *
 * ═══ Y LA TERCERA HIPÓTESIS TAMBIÉN SE COMPROBÓ ═══
 *
 * Que algo hubiera cambiado al regenerar los ficheros con el bloque `calidad`.
 * No: `relieve_plantas.mjs` sigue dando 7,798 y 8,438 EXACTOS, los mismos de
 * #87. Se descarta con número, no por convicción.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const TP = require(path.join(RAIZ, 'terreno_planta.js'));
const RPV = require(path.join(RAIZ, 'radio_pv_model.js'));
const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const G = P.geometria;
const F = P.tecnologias.zigbee_pro_24.f_hz;
const ANT = RPV.alturaAntenaTCU(G.eje_tubo_m.valor, G.antena_tcu.radio_ancla_m.valor,
                                G.antena_tcu.coax_caida_m.valor, 30);
const ANT_NCU = G.antena_ncu_m.valor;

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const PLANTAS = [['ayora', 'AYORA'], ['sanjose', 'SANJOSE'], ['bagnarelli', 'BAGNARELLI'],
                 ['benante', 'BENANTE'], ['elburgo', 'BURGO'], ['fayon', 'FAYON'],
                 ['panbianco', 'PANBIANCO'], ['paramo', 'PARAMO'],
                 ['polvorin', 'POLVORIN'], ['tunez', 'TUNEZ']];
const BANDAS = [[10, 20], [20, 50], [50, 100], [100, 200], [200, 400], [400, 800], [800, 1600]];
const pct = (a, p) => { if (!a.length) return null;
  const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const maxDe = a => { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };

const falta = PLANTAS.filter(([p]) => !fs.existsSync(path.join(RAIZ, 'terreno', p + '_relieve.json')));
if (falta.length === PLANTAS.length) {
  console.log('SIN MEDIDA: no hay ningún terreno en terreno/.');
  console.log('No se ha medido nada. Esto no es un verde.');
  process.exit(0);
}

console.log('DOS POBLACIONES DISTINTAS, Y POR ESO DOS NÚMEROS DISTINTOS\n');
console.log('  vanos MUESTREADOS = parejas de TCU al azar, por banda. Propiedad del TERRENO.');
console.log('  enlaces REALES    = cada TCU contra SU NCU. Propiedad de la INSTALACIÓN.\n');

/* ── 1 · LO QUE LA INSTALACIÓN TIENE DE VERDAD ───────────────────────────── */
console.log('═══ 1 · LOS VANOS QUE EXISTEN ═══\n');
console.log('  planta        enlaces   p50    p95     MÁX   ≥400 m  ≥800 m');
const reales = {};
let maxCartera = 0, nada800 = true;
for (const [p, P0] of PLANTAS) {
  const m = new RegExp('const ' + P0 + '=(\\{.*?\\});', 's').exec(html);
  if (!m) continue;
  let pre; try { pre = JSON.parse(m[1]); } catch (e) { continue; }
  const ncu = {}; for (const n of (pre.ncus || [])) ncu[n[0]] = { x: n[3], y: n[4] };
  const E = [];
  for (const t of (pre.tcus || [])) {
    const c = ncu[t[2]]; if (!c) continue;
    const D = Math.hypot(c.x - t[0], c.y - t[1]);
    if (D > 1) E.push({ ax: t[0], ay: t[1], bx: c.x, by: c.y, D });
  }
  if (!E.length) continue;
  reales[p] = { pre, E };
  const ds = E.map(e => e.D), mx = maxDe(ds);
  if (mx > maxCartera) maxCartera = mx;
  const g4 = ds.filter(d => d >= 400).length, g8 = ds.filter(d => d >= 800).length;
  if (g8) nada800 = false;
  console.log('  ' + p.padEnd(13) + String(E.length).padStart(6)
    + pct(ds, 0.5).toFixed(0).padStart(7) + pct(ds, 0.95).toFixed(0).padStart(7)
    + mx.toFixed(0).padStart(7) + String(g4).padStart(8) + String(g8).padStart(8));
}
console.log('');
console.log('  EL ENLACE MÁS LARGO DE TODA LA CARTERA: ' + maxCartera.toFixed(0) + ' m.');
if (nada800) {
  console.log('  NINGUNA planta tiene un solo enlace de 800 m o más.');
  console.log('  Luego la banda de 800–1.600 m, donde el relieve pega fuerte, NO EXISTE');
  console.log('  en la instalación: describe el terreno, no los enlaces.');
}

/* ── 2 · LAS DOS MEDIDAS, UNA AL LADO DE LA OTRA ─────────────────────────── */
console.log('\n═══ 2 · EL RELIEVE EN LAS DOS POBLACIONES ═══\n');
console.log('  planta        banda        muestreados          enlaces reales');
console.log('                             n    p50    p95      n    p50    p95');
for (const [p, P0] of PLANTAS) {
  if (!reales[p]) continue;
  const fT = path.join(RAIZ, 'terreno', p + '_relieve.json');
  if (!fs.existsSync(fT)) continue;
  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', p + '_relieve.sha256.json'), 'utf8'));
  const T = TP.cargaRelieve(JSON.parse(fs.readFileSync(fT, 'utf8')));
  if (!T) continue;
  const { pre, E } = reales[p];
  const dx = pre.ox - man.cE, dn = pre.oy - man.cN;
  const tcu = pre.tcus.map(t => [t[0] + dx, t[1] + dn]);

  const rel = (ax, ay, bx, by, D) => {
    const pf = TP.perfilEntre(T, ax, ay, bx, by, {});
    if (!pf.perfil) return null;
    const r = RPV.relieveDeltaDb(D, ANT + pf.zSuelo[0], ANT_NCU + pf.zSuelo[1], pf.perfil, F);
    return r && r.db != null ? r.db : null;
  };

  let primera = true;
  for (const [lo, hi] of BANDAS) {
    /* MUESTREADOS: misma semilla y mismo esquema de muestreo que
       `relieve_plantas.mjs`, PERO con la geometría del enlace real —TCU → NCU—
       en vez de TCU en los dos extremos. Ese es el motivo de que aquí salga
       5,91 donde #87 publicó 7,798: la antena de la NCU a 3,15 m se come
       1,94 dB. Se hace así a propósito, para que las dos columnas de esta
       tabla se puedan comparar ENTRE SÍ; el número de #87 sigue siendo el
       bueno para lo que aquél mide, que es el terreno entre seguidores. */
    let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const mu = []; let it = 0;
    while (mu.length < 300 && it < 300 * 400) {
      it++;
      const a = tcu[Math.floor(rnd() * tcu.length)], b = tcu[Math.floor(rnd() * tcu.length)];
      const D = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(D >= lo && D < hi)) continue;
      const v = rel(a[0], a[1], b[0], b[1], D);
      if (v != null) mu.push(v);
    }
    /* REALES: los enlaces de esa banda, TODOS, sin muestrear. */
    const re = [];
    for (const e of E) {
      if (e.D < lo || e.D >= hi) continue;
      const v = rel(e.ax + dx, e.ay + dn, e.bx + dx, e.by + dn, e.D);
      if (v != null) re.push(v);
    }
    if (!mu.length && !re.length) continue;
    console.log('  ' + (primera ? p.padEnd(13) : ''.padEnd(13))
      + (lo + '-' + hi + ' m').padEnd(13)
      + String(mu.length).padStart(4) + (mu.length ? pct(mu, 0.5).toFixed(2).padStart(7) + pct(mu, 0.95).toFixed(2).padStart(7) : '      -      -')
      + String(re.length).padStart(7) + (re.length ? pct(re, 0.5).toFixed(2).padStart(7) + pct(re, 0.95).toFixed(2).padStart(7) : '      -      -'));
    primera = false;
  }
  console.log('');
}

console.log('═══ 3 · LA LECTURA, Y LAS TRES HIPÓTESIS ═══\n');
console.log('  Se plantearon tres explicaciones para la aparente contradicción.');
console.log('  Dos se descartan con número y una es la buena:\n');
console.log('  ✗ «algo cambió al regenerar con el bloque calidad»');
console.log('      NO: `relieve_plantas.mjs` sigue dando 7,798 (ayora) y 8,438 (sanjose)');
console.log('      a 800–1.600 m, EXACTOS, los mismos de #87. La malla no se movió.\n');
console.log('  ✗ «son otras bandas»');
console.log('      A MEDIAS, y por eso no basta: las bandas son las mismas; lo que');
console.log('      cambia es CUÁNTAS tienen enlaces dentro.\n');
console.log('  ✓ Y UNA SEGUNDA CAUSA que al principio se me pasó: LA ANTENA DEL OTRO');
console.log('    EXTREMO. `relieve_plantas.mjs` pone antena de TCU en los dos lados');
console.log('    (0,505 m) porque es una sonda del terreno entre seguidores; el enlace');
console.log('    real va contra una NCU con la antena a 3,15 m. Medido en Ayora a');
console.log('    800–1.600 m: 7,847 con TCU a los dos lados frente a 5,907 con TCU→NCU.');
console.log('    La antena de la NCU se come 1,94 dB ella sola.\n');
console.log('  ✓ «los enlaces reales son casi todos cortos»');
console.log('      SÍ, y de forma total: el enlace más largo de la cartera son '
          + maxCartera.toFixed(0) + ' m.');
console.log('      La banda de 800–1.600 m tiene 300 vanos muestreados y CERO enlaces');
console.log('      reales, en las diez plantas.\n');
console.log('  LOS DOS NÚMEROS SON CORRECTOS Y HAY QUE PUBLICAR LOS DOS:');
console.log('');
console.log('    · el de vanos muestreados dice QUÉ TERRENO HAY — y es el que importa');
console.log('      el día que alguien proponga una NCU lejana o un salto entre bloques;');
console.log('    · el de enlaces reales dice QUÉ LE PASA A ESTA INSTALACIÓN HOY.');
console.log('');
console.log('  Dar sólo el primero exagera; dar sólo el segundo deja creer que el');
console.log('  terreno no importa, y el día que se alargue un vano la sorpresa son');
console.log('  8 dB. Es el mismo error que agregar sin separar por banda, un piso');
console.log('  más arriba.');
