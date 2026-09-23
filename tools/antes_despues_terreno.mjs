/* antes_despues_terreno.mjs — qué cambia en la app al meterle el terreno.
 *
 * ═══ QUÉ CONTESTA ═══
 *
 * El mapa de cobertura pintaba TODOS los enlaces con `relieveDb = null` porque
 * `index.html` pasaba `perfil: null`. Ahora Ayora y San José tienen terreno y
 * el perfil entra. Esto dice, sobre los enlaces REALES de esas dos plantas:
 *
 *   · cuántos CAMBIAN DE BANDA en el mapa —que es lo que se ve en pantalla—;
 *   · cuánto se mueve el margen, **por banda de vano**;
 *   · y cuántos se quedan sin relieve, con su motivo.
 *
 *   node tools/antes_despues_terreno.mjs [--hermano ../Cobertura-Zigbee]
 *
 * ═══ POR QUÉ POR BANDA DE VANO, Y NO UN NÚMERO ═══
 *
 * Porque el relieve crece con la longitud del vano: a 12 m sale CERO EXACTO y a
 * 800–1600 m la mediana pasa de 7,8 dB. Un agregado sobre todos los enlaces
 * dice lo que uno quiera según cuántos vanos cortos traiga la muestra, que es
 * el mismo error que ya mordió en el careo de El Burgo —media +1,1 dB
 * escondiendo +27,1 con 0 filas cruzadas y −28,4 con 24—.
 *
 * ═══ LO QUE ESTE ÚTIL NO HACE ═══
 *
 * No pinta el mapa: replica el balance enlace a enlace con las MISMAS bandas
 * que usa la leyenda (`COV_MARGEN`, extraídas del propio `index.html` para que
 * no puedan separarse de él) y sin filas cruzadas. El mapa de la app además
 * cruza filas, así que sus números absolutos serán otros; lo que aquí se mide
 * es **lo que aporta el terreno**, con todo lo demás igual a los dos lados.
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

const TP = require(path.join(RAIZ, 'terreno_planta.js'));
const RZ = require(path.join(RAIZ, 'radio_zigbee.js'));
const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const V = P.tecnologias.zigbee_pro_24;
const PROP = { eps_r_suelo: P.propagacion.eps_r_suelo.valor,
               sigma_suelo_s_m: P.propagacion.sigma_suelo_s_m.valor,
               polarizacion: P.propagacion.polarizacion.valor,
               sigma_db: P.propagacion.sigma_db.valor,
               vegetacion: { modelo: P.vegetacion.modelo.valor } };

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

/* LAS BANDAS SE EXTRAEN DEL PROPIO index.html. Re-teclearlas aquí sería la
   segunda fuente de siempre: el día que alguien mueva un escalón, este informe
   seguiría contando con los viejos y diría que no cambió nada. */
function bandas() {
  const i = html.indexOf('const COV_MARGEN=');
  const j = html.indexOf('];', i);
  if (i < 0 || j < 0) { console.error('no encuentro COV_MARGEN en index.html'); process.exit(2); }
  const txt = html.slice(i + 'const COV_MARGEN='.length, j + 1);
  return new Function('return ' + txt.replace(/Infinity/g, 'Infinity'))();
}
const COV = bandas();
const banda = mg => { if (mg == null) return 'sin margen';
  for (const b of COV) if (mg < b.lim) return b.txt; return COV[COV.length - 1].txt; };

/* Y EL PRESET, también del propio index.html: es el que la app usa. */
function preset(nombre) {
  const m = new RegExp('const ' + nombre + '=(\\{.*?\\});', 's').exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

/* La altura de antena, como la calcula la app: del eje del tubo, con el alfa
   del seguidor. Se usa el mismo defecto declarado y tilt 30°, que es el del
   careo de referencia — lo que importa aquí es que sea IGUAL a los dos lados. */
const RPV = require(path.join(RAIZ, 'radio_pv_model.js'));
const G = P.geometria;
const EJE = G.eje_tubo_m.valor;
const ANT = RPV.alturaAntenaTCU(EJE, G.antena_tcu.radio_ancla_m.valor,
                                G.antena_tcu.coax_caida_m.valor, 30);
const ANT_NCU = G.antena_ncu_m.valor;

const pct = (a, p) => { if (!a.length) return null;
  const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f2 = v => (v == null ? '  -  ' : (v >= 0 ? '+' : '') + v.toFixed(2));

const PLANTAS = [['ayora', 'AYORA'], ['sanjose', 'SANJOSE']];
const faltan = PLANTAS.filter(([p]) => !fs.existsSync(path.join(RAIZ, 'terreno', p + '_relieve.json')));
if (faltan.length) {
  console.log('SIN MEDIDA: falta ' + faltan.map(f => f[0]).join(', ') + ' en terreno/');
  console.log('No se ha medido nada. Esto no es un verde.');
  process.exit(0);
}

console.log('antena TCU ' + ANT.toFixed(4) + ' m (eje ' + EJE.toFixed(2) + ' DECLARADO, tilt 30°)'
          + ' · antena NCU ' + ANT_NCU.toFixed(2) + ' m · sin filas cruzadas\n');

for (const [planta, preNom] of PLANTAS) {
  const pre = preset(preNom);
  if (!pre) { console.log('═══ ' + planta.toUpperCase() + ' ═══  sin preset en index.html, se salta\n'); continue; }
  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', planta + '_relieve.sha256.json'), 'utf8'));
  const T = TP.cargaRelieve(JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', planta + '_relieve.json'), 'utf8')));
  const dx = pre.ox - man.cE, dn = pre.oy - man.cN;

  /* Cada TCU contra SU NCU, que es lo que pinta el mapa. */
  const ncu = {}; for (const n of pre.ncus) ncu[n[0]] = { x: n[3], y: n[4] };
  const enlaces = [];
  for (const t of pre.tcus) {
    const c = ncu[t[2]]; if (!c) continue;
    enlaces.push({ ax: t[0], ay: t[1], bx: c.x, by: c.y,
                   D: Math.hypot(c.x - t[0], c.y - t[1]) });
  }

  console.log('═══ ' + planta.toUpperCase() + ' ═══  ' + enlaces.length + ' enlaces TCU→su NCU'
            + '  ·  terreno ' + man.tipo + ' ' + man.productor);

  const BANDAS = [[0, 50], [50, 100], [100, 200], [200, 400], [400, 800], [800, 1e9]];
  console.log('\n  vano          n   cambian   Δmargen p50    p05      p95    sin relieve');
  let totCambian = 0, totSin = {}, tot = 0;
  for (const [lo, hi] of BANDAS) {
    const dif = []; let cambian = 0, sin = 0, n = 0;
    for (const e of enlaces) {
      if (e.D < lo || e.D >= hi) continue;
      n++;
      const sinT = RZ.presupuesto({ D: e.D, zA: ANT, zB: ANT_NCU, cruces: [], perfil: null }, V, PROP, null);
      const pf = TP.perfilEntre(T, e.ax + dx, e.ay + dn, e.bx + dx, e.by + dn, {});
      if (!pf.perfil) { sin++; totSin[pf.motivo] = (totSin[pf.motivo] || 0) + 1; continue; }
      const conT = RZ.presupuesto({ D: e.D, zA: ANT + pf.zSuelo[0], zB: ANT_NCU + pf.zSuelo[1],
                                    cruces: [], perfil: pf.perfil }, V, PROP, null);
      if (conT.margenDb == null || sinT.margenDb == null) {
        sin++; totSin[(conT.motivos || []).find(m => /relieve/.test(m)) || 'sin_margen'] =
          (totSin[(conT.motivos || []).find(m => /relieve/.test(m)) || 'sin_margen'] || 0) + 1;
        continue;
      }
      dif.push(conT.margenDb - sinT.margenDb);
      if (banda(conT.margenDb) !== banda(sinT.margenDb)) cambian++;
    }
    tot += n; totCambian += cambian;
    if (!n) continue;
    console.log('  ' + ((hi > 1e8 ? lo + '+ m' : lo + '-' + hi + ' m')).padEnd(12)
      + String(n).padStart(4) + String(cambian).padStart(9)
      + f2(pct(dif, 0.5)).padStart(13) + f2(pct(dif, 0.05)).padStart(9)
      + f2(pct(dif, 0.95)).padStart(9) + String(sin).padStart(13));
  }
  console.log('\n  TOTAL: ' + totCambian + ' de ' + tot + ' enlaces cambian de banda en el mapa ('
            + (100 * totCambian / tot).toFixed(1) + ' %)');
  if (Object.keys(totSin).length) console.log('  sin relieve: ' + JSON.stringify(totSin));
  console.log('');
}
console.log('NO SE AGREGA entre bandas: el relieve crece con el vano, y un promedio');
console.log('sobre todos los enlaces da el número que uno quiera según la muestra.');
