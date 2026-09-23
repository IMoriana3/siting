/* ficha_planta_dem.mjs — la ficha de una planta con terreno SOLO DEM.
 *
 * ═══ PARA QUÉ ═══
 *
 * Las ocho plantas sin levantamiento van a llevar terreno de DEM. La pregunta
 * que hay que contestar planta por planta no es «¿cuánto relieve hay?» sino
 * «¿sirve para decidir algo?», y eso son tres números juntos:
 *
 *   1 · cuántos enlaces CAMBIAN DE BANDA en el mapa al meter el terreno;
 *   2 · cuánto se mueve el margen, por banda de vano;
 *   3 · cuánto de ese movimiento queda DENTRO de la incertidumbre del propio
 *       terreno — el ±Z medido en Ayora y San José comparando el empalmado
 *       contra el DEM solo (`relieve_valor_incertidumbre.mjs`).
 *
 * Si (2) y (3) son del mismo tamaño, el terreno NO decide el mapa: dice que
 * hace falta un levantamiento. Eso es un resultado, no un fallo.
 *
 *   node tools/ficha_planta_dem.mjs <PRESET> [--hermano ../Cobertura-Zigbee]
 *
 * ═══ DE DÓNDE SALE EL ±Z, Y POR QUÉ NO ES DE ESTA PLANTA ═══
 *
 * De ninguna de las ocho se puede sacar: no tienen levantamiento contra el que
 * comparar. El ±Z que se usa aquí es el MEDIDO en las dos que sí lo tienen,
 * sobre el mismo producto (solo DEM), y va rotulado como tal en cada línea.
 * Es la mejor cota que hay, no una garantía para esta planta.
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
const PRESET = (process.argv.slice(2).find(a => !a.startsWith('--')
  && process.argv[process.argv.indexOf(a) - 1] !== '--hermano') || '').toUpperCase();
if (!PRESET) { console.error('uso: node tools/ficha_planta_dem.mjs <PRESET>'); process.exit(2); }

const TP = require(path.join(RAIZ, 'terreno_planta.js'));
const RZ = require(path.join(RAIZ, 'radio_zigbee.js'));
const RPV = require(path.join(RAIZ, 'radio_pv_model.js'));
const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const V = P.tecnologias.zigbee_pro_24;
const PROP = { eps_r_suelo: P.propagacion.eps_r_suelo.valor,
               sigma_suelo_s_m: P.propagacion.sigma_suelo_s_m.valor,
               polarizacion: P.propagacion.polarizacion.valor,
               sigma_db: P.propagacion.sigma_db.valor,
               vegetacion: { modelo: P.vegetacion.modelo.valor } };
const G = P.geometria;
const ANT = RPV.alturaAntenaTCU(G.eje_tubo_m.valor, G.antena_tcu.radio_ancla_m.valor,
                                G.antena_tcu.coax_caida_m.valor, 30);
const ANT_NCU = G.antena_ncu_m.valor;

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
function bandas() {
  const i = html.indexOf('const COV_MARGEN='), j = html.indexOf('];', i);
  if (i < 0 || j < 0) { console.error('no encuentro COV_MARGEN en index.html'); process.exit(2); }
  return new Function('return ' + html.slice(i + 'const COV_MARGEN='.length, j + 1))();
}
const COV = bandas();
const banda = mg => { if (mg == null) return 'sin margen';
  for (const b of COV) if (mg < b.lim) return b.txt; return COV[COV.length - 1].txt; };

const m = new RegExp('const ' + PRESET + '=(\\{.*?\\});', 's').exec(html);
if (!m) { console.error('no encuentro el preset ' + PRESET + ' en index.html'); process.exit(2); }
const pre = JSON.parse(m[1]);
const planta = (pre.sc || PRESET).toLowerCase();

/* EL TERRENO. Se busca en `terreno/` de este repo y, si no está, en el hermano
   —porque los ocho aún no se han publicado aquí—. Si no está en ninguno, se
   dice y se sale: una ficha sin terreno no es una ficha vacía, es que no se ha
   medido nada. */
const cand = [path.join(RAIZ, 'terreno', planta + '_relieve.json'),
              path.join(HERMANO, planta + '_relieve.json')];
const fT = cand.find(f => fs.existsSync(f));
if (!fT) {
  console.log('SIN MEDIDA: no encuentro ' + planta + '_relieve.json ni en terreno/ ni en el hermano.');
  console.log('No se ha medido nada. Esto no es un verde.');
  process.exit(0);
}
const fM = fT.replace('_relieve.json', '_relieve.sha256.json');
const man = JSON.parse(fs.readFileSync(fM, 'utf8'));
const T = TP.cargaRelieve(JSON.parse(fs.readFileSync(fT, 'utf8')));
if (!T) { console.error(planta + ': cargaRelieve dice NO VALIDO. ABORTA.'); process.exit(2); }
const dx = pre.ox - man.cE, dn = pre.oy - man.cN;

/* ±Z MEDIDO en Ayora y San José, por banda de vano (p90 de |empalmado − solo
   DEM|). NO es de esta planta y se dice en cada línea. */
const Z = {
  '0-50':    { ay: 0.00, sj: 6.57 },
  '50-100':  { ay: 0.00, sj: 8.07 },
  '100-200': { ay: 3.74, sj: 12.94 },
  '200-400': { ay: 5.00, sj: 13.14 },
  '400-800': { ay: 4.37, sj: 12.94 },
  '800+':    { ay: 4.59, sj: 12.87 }
};
const BANDAS = [[0, 50], [50, 100], [100, 200], [200, 400], [400, 800], [800, 1e9]];
const claveZ = ([lo, hi]) => (hi > 1e8 ? '800+' : lo + '-' + hi);
const etiq = ([lo, hi]) => (hi > 1e8 ? lo + '+ m' : lo + '-' + hi + ' m');
const pct = (a, p) => { if (!a.length) return null;
  const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f2 = v => (v == null ? '  -  ' : (v >= 0 ? '+' : '') + v.toFixed(2));

const cal = man.calidad || {};
console.log('═══ FICHA DE ' + PRESET + ' ═══');
console.log('  terreno: ' + man.tipo + ' · ' + man.productor + ' · ' + man.generado);
console.log('  malla ' + man.nx + '×' + man.nn + ' a ' + man.paso + ' m'
          + (cal.px_tesela_m ? ' · píxel de tesela ' + cal.px_tesela_m + ' m' : ''));
console.log('  CALIDAD: ' + (cal.validado ? 'validado' : '⚠ SIN VALIDAR')
          + (cal.motivo ? ' — ' + cal.motivo : ''));
let zmin = Infinity, zmax = -Infinity;
for (const v of T.z) if (v != null) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
console.log('  desnivel de la malla: ' + (zmax - zmin).toFixed(1) + ' m\n');

const ncu = {}; for (const n of pre.ncus) ncu[n[0]] = { x: n[3], y: n[4] };
const enl = [];
for (const t of pre.tcus) {
  const c = ncu[t[2]]; if (!c) continue;
  const D = Math.hypot(c.x - t[0], c.y - t[1]);
  if (D > 1) enl.push({ ax: t[0], ay: t[1], bx: c.x, by: c.y, D });
}
console.log('  ' + enl.length + ' enlaces TCU → su NCU\n');
console.log('  vano          n   cambian   Δmargen p50     p05      p95    ±Z ay / sj   ¿decide?');

let totC = 0, tot = 0;
const veredicto = [];
for (const B of BANDAS) {
  const dif = []; let cambian = 0, n = 0, sin = 0;
  for (const e of enl) {
    if (e.D < B[0] || e.D >= B[1]) continue;
    n++;
    const sinT = RZ.presupuesto({ D: e.D, zA: ANT, zB: ANT_NCU, cruces: [], perfil: null }, V, PROP, null);
    const pf = TP.perfilEntre(T, e.ax + dx, e.ay + dn, e.bx + dx, e.by + dn, {});
    if (!pf.perfil) { sin++; continue; }
    const conT = RZ.presupuesto({ D: e.D, zA: ANT + pf.zSuelo[0], zB: ANT_NCU + pf.zSuelo[1],
                                  cruces: [], perfil: pf.perfil,
                                  vanoMinUtil: (cal && cal.vano_min_util_m) || 0 }, V, PROP, null);
    if (conT.margenDb == null || sinT.margenDb == null) { sin++; continue; }
    dif.push(conT.margenDb - sinT.margenDb);
    if (banda(conT.margenDb) !== banda(sinT.margenDb)) cambian++;
  }
  if (!n) continue;
  tot += n; totC += cambian;
  const z = Z[claveZ(B)];
  const efecto = dif.length ? Math.max(Math.abs(pct(dif, 0.05) || 0), Math.abs(pct(dif, 0.95) || 0)) : 0;
  /* ¿DECIDE? El efecto (lo que mueve el terreno) contra la incertidumbre del
     propio terreno. Se usa el ±Z PEOR de las dos plantas medidas: esta planta
     no tiene el suyo, y coger el mejor sería elegir la respuesta cómoda. */
  const zPeor = Math.max(z.ay, z.sj);
  const decide = efecto > 2 * zPeor ? 'sí' : (efecto > zPeor ? 'justo' : 'NO');
  veredicto.push({ B, efecto, zPeor, decide, n, cambian });
  console.log('  ' + etiq(B).padEnd(12) + String(n).padStart(4) + String(cambian).padStart(9)
    + f2(pct(dif, 0.5)).padStart(13) + f2(pct(dif, 0.05)).padStart(9) + f2(pct(dif, 0.95)).padStart(9)
    + ('±' + z.ay.toFixed(1) + '/' + z.sj.toFixed(1)).padStart(13)
    + ('  ' + decide).padEnd(9) + (sin ? '  (' + sin + ' sin perfil)' : ''));
}

console.log('\n  TOTAL: ' + totC + ' de ' + tot + ' enlaces cambian de banda en el mapa ('
          + (tot ? (100 * totC / tot).toFixed(1) : '0') + ' %)\n');

console.log('═══ VEREDICTO ═══\n');
/* SÓLO CUENTAN LAS BANDAS DONDE EL TERRENO HACE ALGO.
   La primera versión de esto miraba TODAS las bandas marcadas «NO» y titulaba
   con ellas — y en Fayón acabó citando la de 0–50 m, donde el terreno mueve
   1,4 dB, mientras la de 100–200 movía 16,9 de mediana. Un umbral crudo
   eligiendo la banda trivial y contradiciendo su propia tabla.
   Una banda donde el efecto es ruido no dice nada sobre si el término sirve:
   dice que ahí no hay término. Se miran las que mueven más de 3 dB. */
const RELEVANTE = 3;
const activas = veredicto.filter(v => v.efecto > RELEVANTE);
if (!veredicto.length) {
  console.log('  NO SE HA MEDIDO NADA. Esto no es un veredicto.');
} else if (!activas.length) {
  console.log('  EL TERRENO APENAS MUEVE EL MAPA aquí: ninguna banda pasa de ' + RELEVANTE + ' dB.');
  console.log('  Los vanos son cortos y el relieve a esas distancias es cero o casi, así que');
  console.log('  el ±Z tampoco importa. No hace falta levantamiento POR ESTO.');
} else {
  const peorEf = Math.max(...activas.map(v => v.efecto));
  const dudosas = activas.filter(v => v.efecto <= 2 * v.zPeor);
  console.log('  EL TERRENO SÍ MUEVE EL MAPA, y mucho:');
  console.log('');
  for (const v of activas)
    console.log('    ' + etiq(v.B).padEnd(12) + 'mueve hasta ' + v.efecto.toFixed(1)
      + ' dB   ·   ±Z del propio terreno ' + v.zPeor.toFixed(1) + ' dB   ·   '
      + (v.efecto > 2 * v.zPeor ? 'el efecto MANDA sobre el error'
        : 'efecto y error del MISMO orden'));
  console.log('');
  if (dudosas.length) {
    console.log('  Y AHÍ ESTÁ EL PROBLEMA. En ' + (dudosas.length === activas.length ? 'todas esas' : 'algunas de esas')
      + ' bandas el efecto y la incertidumbre');
    console.log('  del propio terreno son del mismo orden. El SIGNO se ve —el terreno quita');
    console.log('  margen, no lo da— pero CUÁNTO no: los ' + peorEf.toFixed(0) + ' dB podrían ser '
      + (peorEf - Math.max(...dudosas.map(v => v.zPeor))).toFixed(0) + ' o ' + peorEf.toFixed(0) + '.');
    console.log('');
    console.log('  Para pintar un mapa eso vale: el enlace sale rojo igual. Para DECIDIR');
    console.log('  dónde va una NCU, no: la diferencia entre «le faltan 4 dB» y «le faltan');
    console.log('  17» es la diferencia entre subir la antena y mover la caseta.');
    console.log('');
    console.log('  ESTA ES LA PLANTA DONDE ANTES HACE FALTA UN LEVANTAMIENTO. Con él el ±Z');
    console.log('  baja de metros a centímetros —Ayora y San José validan a 0,030 y 0,074 m');
    console.log('  empalmadas, frente a 0,78 y 1,20 con solo DEM— y el término pasa a');
    console.log('  decidir en vez de a sugerir.');
  } else {
    console.log('  Y el efecto MANDA sobre el error en todas las bandas que importan, así');
    console.log('  que el término se puede usar para decidir, siempre con el ± al lado.');
  }
  /* Y EL AVISO DE LOS VANOS CORTOS, que es del DEM y no de esta planta: ahí el
     relieve verdadero es CERO EXACTO y el DEM solo se lo inventa. */
  const cortas = veredicto.filter(v => v.B[1] <= 100 && v.zPeor > 1);
  if (cortas.length) {
    console.log('');
    console.log('  ⚠ Y OJO A LOS VANOS CORTOS: con terreno empalmado el relieve a menos de');
    console.log('  100 m sale CERO EXACTO, pero el DEM solo llega a inventarse hasta '
      + Math.max(...cortas.map(v => v.zPeor)).toFixed(1) + ' dB');
    console.log('  ahí (medido en San José). O sea que en esas bandas el terreno de DEM no');
    console.log('  es que sea impreciso: es que puede cobrar relieve donde no hay ninguno.');
  }
}
console.log('');
console.log('  ⚠ El ±Z de las columnas NO es de esta planta: es el medido en Ayora y San');
console.log('  José comparando el terreno empalmado contra el mismo sitio con solo DEM');
console.log('  (`relieve_valor_incertidumbre.mjs`). Es la mejor cota que hay, no una');
console.log('  garantía. Se usa el PEOR de los dos, no el más cómodo.');
