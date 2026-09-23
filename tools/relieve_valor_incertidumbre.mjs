/* relieve_valor_incertidumbre.mjs — «el relieve vale 8 dB ± Z».
 *
 * ═══ QUÉ CONTESTA, Y POR QUÉ NO VALE EL ÚTIL DE AL LADO ═══
 *
 * `relieve_incertidumbre.mjs` propaga un error de cota SINTÉTICO —ruido
 * gaussiano con una longitud de correlación medida— y dice cuánto se mueve el
 * relieve. Está bien, pero sigue siendo un MODELO: hay que suponer la forma del
 * error.
 *
 * Esto no supone nada. Usa los dos terrenos de verdad de la misma planta:
 *
 *     <planta>_relieve.json           el EMPALMADO (levantamiento + DEM)
 *     <planta>_demsolo_relieve.json   el mismo sitio con SOLO DEM
 *
 * y calcula el relieve con los dos sobre los MISMOS vanos. La diferencia es
 * exactamente lo que se pierde por no tener levantamiento — el error real, con
 * su forma real, sin modelo por medio.
 *
 * Y eso es lo que hace falta para el rótulo de las OCHO plantas que sólo tienen
 * DEM: ellas van a llevar el terreno pobre, y el ± que se les pone sale de
 * medir el pobre contra el bueno donde se puede.
 *
 *   node tools/relieve_valor_incertidumbre.mjs [--hermano ../Cobertura-Zigbee]
 *
 * ═══ POR QUÉ VANOS AL AZAR Y NO LOS ENLACES REALES ═══
 *
 * Porque los enlaces TCU→su NCU se acaban a 400–800 m, y la pregunta incluye la
 * banda de 800–1.600 m. Se muestrea igual que `relieve_plantas.mjs` —parejas de
 * TCU al azar con semilla fija, por banda— para que el número salga comparable
 * con el que ya se publicó ahí.
 *
 * ═══ NO CORRE EN CI ═══
 *
 * Necesita el fichero `_demsolo`, que es un artefacto de MEDIDA y vive en el
 * repo hermano: no se publica, porque nadie debe consumir el terreno pobre de
 * una planta que tiene el bueno. Sin hermano, este útil lo dice y sale con 0
 * sin fingir que ha medido algo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const HERMANO = arg('hermano', path.join(RAIZ, '..', 'Cobertura-Zigbee'));
const NVANO = parseInt(arg('n', '400'), 10);

const TP = require(path.join(RAIZ, 'terreno_planta.js'));
const RPV = require(path.join(RAIZ, 'radio_pv_model.js'));
const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const G = P.geometria;
const F = P.tecnologias.zigbee_pro_24.f_hz;
const ANT = RPV.alturaAntenaTCU(G.eje_tubo_m.valor, G.antena_tcu.radio_ancla_m.valor,
                                G.antena_tcu.coax_caida_m.valor, 30);
const ANT_NCU = G.antena_ncu_m.valor;

const PLANTAS = ['ayora', 'sanjose'];
const BANDAS = [[10, 20], [20, 50], [50, 100], [100, 200], [200, 400], [400, 800], [800, 1600]];

const faltan = PLANTAS.filter(p => !fs.existsSync(path.join(HERMANO, p + '_demsolo_relieve.json')));
if (faltan.length) {
  console.log('SIN MEDIDA: falta el terreno «solo DEM» de ' + faltan.join(', ') + ' en ' + HERMANO);
  console.log('  Se genera en el hermano con:');
  console.log('    node tools/relieve_de_dem.mjs <planta> --forzar-dem-solo \\');
  console.log('         --sufijo _demsolo --comoel <planta>_relieve.json --write');
  console.log('No se ha medido nada. Esto no es un verde.');
  process.exit(0);
}

const pct = (a, p) => { if (!a.length) return null;
  const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const maxDe = a => { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };

console.log('el relieve con terreno EMPALMADO frente al mismo sitio con SOLO DEM');
console.log('antena TCU ' + ANT.toFixed(4) + ' m · NCU ' + ANT_NCU.toFixed(2) + ' m · '
          + NVANO + ' vanos por banda, semilla fija\n');

const resumen = {};
for (const planta of PLANTAS) {
  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', planta + '_relieve.sha256.json'), 'utf8'));
  const TA = TP.cargaRelieve(JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', planta + '_relieve.json'), 'utf8')));
  const TB = TP.cargaRelieve(JSON.parse(fs.readFileSync(path.join(HERMANO, planta + '_demsolo_relieve.json'), 'utf8')));
  if (!TA || !TB) { console.log('  ' + planta + ': un terreno no valida. Se salta.'); continue; }
  /* LAS DOS MALLAS TIENEN QUE SER LA MISMA, o los perfiles se muestrean en
     sitios distintos y la diferencia mezcla error con desplazamiento. */
  for (const k of ['x0', 'n0', 'paso', 'nx', 'nn']) {
    if (TA[k] !== TB[k]) {
      console.error(planta + ': las dos mallas no coinciden en «' + k + '». ABORTA.');
      process.exit(2);
    }
  }
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const nom = planta === 'ayora' ? 'AYORA' : 'SANJOSE';
  const m = new RegExp('const ' + nom + '=(\\{.*?\\});', 's').exec(html);
  if (!m) { console.log('  ' + planta + ': sin preset. Se salta.'); continue; }
  const pre = JSON.parse(m[1]);
  const dx = pre.ox - man.cE, dn = pre.oy - man.cN;
  const tcu = pre.tcus.map(t => [t[0] + dx, t[1] + dn]);

  console.log('═══ ' + planta.toUpperCase() + ' ═══  ' + tcu.length + ' TCU · terreno '
            + man.tipo + ' ' + man.productor);
  console.log('\n  vano           n   relieve p50   ±Z (p90)   ±Z (máx)   peso de Z');
  resumen[planta] = {};

  for (const [lo, hi] of BANDAS) {
    let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const vals = [], difs = [];
    let intentos = 0;
    while (vals.length < NVANO && intentos < NVANO * 200) {
      intentos++;
      const a = tcu[Math.floor(rnd() * tcu.length)], b = tcu[Math.floor(rnd() * tcu.length)];
      const D = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(D >= lo && D < hi)) continue;
      const pa = TP.perfilEntre(TA, a[0], a[1], b[0], b[1], {});
      const pb = TP.perfilEntre(TB, a[0], a[1], b[0], b[1], {});
      if (!pa.perfil || !pb.perfil) continue;
      const ra = RPV.relieveDeltaDb(D, ANT + pa.zSuelo[0], ANT_NCU + pa.zSuelo[1], pa.perfil, F);
      const rb = RPV.relieveDeltaDb(D, ANT + pb.zSuelo[0], ANT_NCU + pb.zSuelo[1], pb.perfil, F);
      if (!ra || ra.db == null || !rb || rb.db == null) continue;
      vals.push(ra.db); difs.push(Math.abs(rb.db - ra.db));
    }
    if (!vals.length) continue;
    const v = pct(vals, 0.5), z90 = pct(difs, 0.90), zmx = maxDe(difs);
    /* EL PESO DE Z: la incertidumbre comparada con el propio valor. Es lo que
       dice si el número sirve para decidir algo o no. */
    const peso = v > 0.05 ? (z90 / v) : null;
    console.log('  ' + (lo + '-' + hi + ' m').padEnd(13) + String(vals.length).padStart(4)
      + v.toFixed(2).padStart(13) + z90.toFixed(2).padStart(11) + zmx.toFixed(2).padStart(11)
      + (peso == null ? '        —' : ('×' + peso.toFixed(1)).padStart(11)));
    resumen[planta][lo + '-' + hi] = { n: vals.length, valor: v, z90: z90, zmax: zmx, peso: peso };
  }
  console.log('');
}

console.log('═══ CÓMO SE LEE, Y QUÉ SIGNIFICA «PESO DE Z» ═══');
console.log('');
console.log('  «relieve p50» es lo que vale el término con el terreno BUENO.');
console.log('  «±Z» es cuánto cambia si en vez del bueno se usa SOLO DEM — o sea,');
console.log('  lo que se paga por no tener levantamiento, medido y no supuesto.');
console.log('');
console.log('  «peso de Z» es Z dividido por el valor. Por debajo de ×0,3 el término');
console.log('  se puede usar para decidir; cerca o por encima de ×1 la incertidumbre');
console.log('  es del tamaño del efecto y el número NO decide nada: dice que hace');
console.log('  falta un levantamiento, no dónde poner la NCU.');
console.log('');
console.log('  Este ± es el que va en `calidad` de las ocho plantas que sólo tienen');
console.log('  DEM, y en pantalla al lado del valor. Un relieve de 8 dB con ±6 no se');
console.log('  presenta igual que uno con ±1.');
