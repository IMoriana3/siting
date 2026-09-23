/* relieve_incertidumbre.mjs — de metros de error en la cota a dB de relieve.
 *
 * ═══ QUÉ CONTESTA, Y DE DÓNDE SALEN LOS METROS ═══
 *
 * Las ocho plantas que van a llevar terreno SÓLO DE DEM no tienen levantamiento
 * con qué validarlo. Lo que sí se pudo medir, en cobertura-zigbee
 * (`tools/dem_error_vertical.mjs`), es cuánto se equivoca el MISMO producto en
 * las dos plantas donde hay verdad de campo:
 *
 *     planta     cotas   escalón de datum   |err| p50    p95    máx
 *     ayora      3.004        -1,83 m         0,83 m    2,37   3,74
 *     sanjose    9.156        -5,63 m         1,29 m    3,77   6,21
 *
 * Esto traduce ese error a lo único que importa aquí: cuánto puede moverse el
 * `relieveDb`, POR BANDA DE VANO.
 *
 * ═══ EL ESCALÓN NO ENTRA, Y ESO NO ES UN DESCUIDO ═══
 *
 * El escalón de datum —1,83 m en Ayora, 5,63 en San José— es una CONSTANTE, y
 * una constante no mueve el relieve: está medido en `relieve_plantas.mjs`, un
 * desplazamiento uniforme de ±0,80 m cambia el relieve 2,5e-12 dB. La razón es
 * la construcción delta: la tierra lisa se desplaza lo mismo que el perfil y la
 * resta se lo come. Sumar el escalón al error daría metros que no afectan a
 * nada.
 *
 * ═══ Y LA CORRELACIÓN DECIDE EL RESULTADO. ESTÁ MEDIDA ═══
 *
 * El error de un DEM NO es independiente punto a punto, y eso cambia el
 * resultado por completo:
 *
 *   · error INDEPENDIENTE en cada punto del perfil -> añade RUGOSIDAD, que es
 *     justo lo que el relieve cobra: |Δ| p95 de 27 dB en TODAS las bandas.
 *   · error TOTALMENTE CORRELADO -> es el escalón de arriba: 1e-12 dB.
 *
 * O sea que sin saber la correlación, la «cota» va de 0 a 27 dB, que no acota
 * nada. Así que se midió, con los residuos de Ayora y San José y su
 * semivariograma (`cobertura-zigbee/tools/dem_error_vertical.mjs`):
 *
 *     planta     γ(10 m)   meseta   alcance   L de e-plegado
 *     ayora       0,01 m²   1,55     200 m        117 m
 *     sanjose     0,34 m²   3,79     500 m         80 m
 *
 * A 10 m de separación γ vale 0,01 m² en Ayora: los errores de dos puntos
 * vecinos son PRÁCTICAMENTE EL MISMO. El error del DEM es una superficie
 * suave, no ruido.
 *
 * Y eso hunde el número: en la banda de 200–400 m se pasa de 27 dB (indep.) a
 * 3,6 (Ayora, L=117) y 4,4 (San José, L=80). Medir la correlación fue la
 * diferencia entre una cota inútil y una usable.
 *
 * El barrido se mantiene —incluidas las columnas pesimistas— porque publicar
 * sólo la columna buena escondería de qué depende la respuesta.
 *
 *   node tools/relieve_incertidumbre.mjs [--sigma 1.29] [--reps 24]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
/* 1,29 m es el |err| p50 de San José, el PEOR de los dos con verdad de campo.
   Se toma el peor y no la media: esto acota, no describe. */
const SIGMA = parseFloat(arg('sigma', '1.29'));
const REPS = parseInt(arg('reps', '24'), 10);
/* Longitudes de correlación barridas, en metros. 0 = independiente. */
/* MEDIDAS, no elegidas: 117 m en Ayora y 80 en San Jose, del semivariograma de
   los residuos. Se deja el 0 (independiente) y el 30 porque ensenan de que
   depende la respuesta; quitarlos dejaria la columna buena sin contexto. */
const LCORR = arg('lcorr', '0,30,80,117,200').split(',').map(Number);

const TP = require(path.join(RAIZ, 'terreno_planta.js'));
const RPV = require(path.join(RAIZ, 'radio_pv_model.js'));
const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const G = P.geometria;
const F = P.tecnologias.zigbee_pro_24.f_hz;
const ANT = RPV.alturaAntenaTCU(G.eje_tubo_m.valor, G.antena_tcu.radio_ancla_m.valor,
                                G.antena_tcu.coax_caida_m.valor, 30);
const ANT_NCU = G.antena_ncu_m.valor;

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
function preset(nombre) {
  const m = new RegExp('const ' + nombre + '=(\\{.*?\\});', 's').exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

const PLANTAS = [['ayora', 'AYORA'], ['sanjose', 'SANJOSE']];
const faltan = PLANTAS.filter(([p]) => !fs.existsSync(path.join(RAIZ, 'terreno', p + '_relieve.json')));
if (faltan.length) {
  console.log('SIN MEDIDA: falta el terreno de ' + faltan.map(f => f[0]).join(', '));
  console.log('No se ha medido nada. Esto no es un verde.');
  process.exit(0);
}

/* Congruencial lineal con semilla fija: este informe tiene que dar lo mismo en
   cualquier máquina y en cualquier corrida, o no se puede comparar con el de
   ayer. Math.random lo haría irreproducible. */
function azar(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function gauss(rnd) {           // Box–Muller
  const u = Math.max(1e-12, rnd()), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* RUIDO CON LONGITUD DE CORRELACIÓN L: blanco, suavizado con una gaussiana de
   desviación L, y renormalizado a sigma. Renormalizar es imprescindible:
   suavizar baja la varianza, y sin devolverla el barrido mediría «menos ruido»
   en vez de «el mismo ruido, más correlado», que es otra cosa. */
function ruido(n, paso, L, sigma, rnd) {
  const w = []; for (let i = 0; i < n; i++) w.push(gauss(rnd));
  if (!(L > 0)) return w.map(v => v * sigma);
  const r = Math.max(1, Math.round(3 * L / paso)), k = [];
  let sk = 0;
  for (let d = -r; d <= r; d++) { const g = Math.exp(-0.5 * Math.pow(d * paso / L, 2)); k.push(g); sk += g; }
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let d = -r; d <= r; d++) { const j = Math.min(n - 1, Math.max(0, i + d)); s += w[j] * k[d + r]; }
    out[i] = s / sk;
  }
  let s2 = 0; for (const v of out) s2 += v * v;
  const sd = Math.sqrt(s2 / n);
  return sd > 0 ? out.map(v => v * sigma / sd) : out;
}

const pct = (a, p) => { if (!a.length) return null;
  const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const BANDAS = [[0, 50], [50, 100], [100, 200], [200, 400], [400, 800], [800, 1e9]];
const etiq = ([lo, hi]) => (hi > 1e8 ? lo + '+ m' : lo + '-' + hi + ' m');

console.log('error de cota sigma = ' + SIGMA.toFixed(2) + ' m  ·  ' + REPS + ' realizaciones por enlace');
console.log('(sigma = |err| p50 de San José contra levantamiento, el peor de los dos)');
console.log('el escalón de datum NO entra: es constante y no mueve el relieve.\n');

for (const [planta, preNom] of PLANTAS) {
  const pre = preset(preNom);
  if (!pre) { console.log('═══ ' + planta.toUpperCase() + ' ═══  sin preset, se salta\n'); continue; }
  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', planta + '_relieve.sha256.json'), 'utf8'));
  const T = TP.cargaRelieve(JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', planta + '_relieve.json'), 'utf8')));
  const dx = pre.ox - man.cE, dn = pre.oy - man.cN;
  const ncu = {}; for (const n of pre.ncus) ncu[n[0]] = { x: n[3], y: n[4] };

  console.log('═══ ' + planta.toUpperCase() + ' ═══');
  console.log('  |Δ relieveDb| p95 por banda de vano, según la longitud de correlación del error\n');
  console.log('  vano          n   ' + LCORR.map(l => (l === 0 ? 'indep.' : 'L=' + l + ' m').padStart(9)).join(''));

  for (const B of BANDAS) {
    const col = LCORR.map(() => []);
    let n = 0;
    for (const t of pre.tcus) {
      const c = ncu[t[2]]; if (!c) continue;
      const D = Math.hypot(c.x - t[0], c.y - t[1]);
      if (!(D > 1) || D < B[0] || D >= B[1]) continue;
      const pf = TP.perfilEntre(T, t[0] + dx, t[1] + dn, c.x + dx, c.y + dn, {});
      if (!pf.perfil) continue;
      const base = RPV.relieveDeltaDb(D, ANT + pf.zSuelo[0], ANT_NCU + pf.zSuelo[1], pf.perfil, F);
      if (!base || base.db == null) continue;
      n++;
      const rnd = azar(1234567 + n * 7919);
      for (let q = 0; q < LCORR.length; q++) {
        for (let r = 0; r < REPS; r++) {
          const e = ruido(pf.perfil.length, pf.paso, LCORR[q], SIGMA, rnd);
          const p2 = pf.perfil.map((pt, i) => [pt[0], pt[1] + e[i]]);
          /* Las antenas van sobre el suelo PERTURBADO: si el DEM se equivoca,
             se equivoca también bajo la antena. Dejarlas sobre el suelo bueno
             mediría un caso que no existe. */
          const v = RPV.relieveDeltaDb(D, ANT + p2[0][1], ANT_NCU + p2[p2.length - 1][1], p2, F);
          if (v && v.db != null) col[q].push(Math.abs(v.db - base.db));
        }
      }
    }
    if (!n) continue;
    console.log('  ' + etiq(B).padEnd(12) + String(n).padStart(5) + '  '
      + col.map(a => (pct(a, 0.95) == null ? '    -' : pct(a, 0.95).toFixed(2)).padStart(9)).join(''));
  }
  console.log('');
}

console.log('═══ CÓMO SE LEE ESTO ═══');
console.log('');
console.log('  La columna «indep.» es el CASO PEOR: el error del DEM tratado como');
console.log('  independiente punto a punto, que añade rugosidad pura y es justo lo que');
console.log('  el relieve cobra. Ningún DEM real se equivoca así.');
console.log('');
console.log('  Según crece la longitud de correlación el efecto CAE, y en el límite');
console.log('  —error totalmente correlado— es el escalón de datum, o sea 1e-12 dB.');
console.log('');
console.log('  LA LONGITUD DE CORRELACIÓN REAL NO ESTÁ MEDIDA. Se podría, con los');
console.log('  residuos de Ayora y San José, y hasta entonces lo honrado es publicar');
console.log('  el barrido entero y no elegir una columna. Un solo número aquí sería');
console.log('  elegir la respuesta, que es el mismo error que agregar el relieve sin');
console.log('  separar por vano.');
