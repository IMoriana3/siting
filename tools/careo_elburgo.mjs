/* careo_elburgo.mjs — el motor contra las 49 medidas reales de El Burgo.
 *
 * ═══ LEA ESTO ANTES QUE NINGÚN NÚMERO ═══
 *
 * EL ÁRBITRO v1 NO ES UNA MEDIDA POR ENLACE, Y ESO LIMITA LO QUE SE PUEDE
 * CONCLUIR. El `rssi_medido_dbm` de cada LineString del geojson NO es el RSSI
 * de ese enlace: es la MEDIANA DEL NODO sobre toda la campaña, atribuida a su
 * padre dominante (defecto conocido, punto 6 de la auditoría del recolector).
 * Un nodo que tuvo 24 padres distintos mezcla en esa mediana enlaces a los 24.
 *
 * Esto no es teoría: se mide abajo, y es demoledor. A 12,0 m exactos hay siete
 * enlaces que van de −58 a −87 dBm. Veintinueve decibelios a la MISMA
 * distancia. Ningún modelo de propagación explica eso ni debe intentarlo.
 *
 * Así que este careo dice cuánto se desvía el motor de un ESTADÍSTICO DE NODO,
 * no de una medida de enlace. Sirve para acotar el orden de magnitud del
 * optimismo del modo teórico; NO sirve para calibrar, y por eso existe la hoja
 * de barrido. Se repetirá con el geojson regenerado cuando llegue.
 *
 * ═══ QUÉ HACE BIEN, Y QUÉ CAMBIA FRENTE AL CAREO ANTERIOR ═══
 *
 * FILAS CRUZADAS REALES. El careo anterior suponía cruce perpendicular con
 * paso de 12 m. Eso es EXACTAMENTE el defecto RF-01 que este repo ya corrigió
 * —una retícula fija contaba 45 filas donde hay 90—. Aquí las filas salen de
 * `rfRows()` del propio `index.html` y se cruzan contra los extremos REALES de
 * cada enlace, que vienen en el LineString del geojson.
 *
 * DOS INCÓGNITAS, BARRIDAS EN VEZ DE ELEGIDAS:
 *
 *   · LA ALTURA DE ANTENA no está confirmada. `radio_params.json` la hereda a
 *     1,5 m del modelo antiguo y el ajuste de cobertura-rf-fv usó 0,775 m
 *     (viga 1,50 − caída 0,725). Se saca el careo a las DOS, lado a lado.
 *   · EL ÁNGULO de las palas durante la campaña no se sabe: la mediana del
 *     nodo promedia 8.053 instantes que abarcan el día entero, con las palas
 *     desde planas hasta de canto. Se barre.
 *
 * GEORREFERENCIACIÓN VALIDADA ANTES DE CALCULAR. El geojson va en lon/lat y el
 * layout en metros locales. La conversión se comprueba contra el propio
 * `distancia_m` del fichero, y si no cuadra el programa PARA en vez de sacar
 * números sin sentido.
 *
 *   node tools/careo_elburgo.mjs --geojson ../Cobertura-Zigbee/elburgo_real.geojson
 *   node tools/careo_elburgo.mjs --geojson <ruta> --json careo.json
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const GEOJSON = arg('geojson', path.join(RAIZ, '..', 'Cobertura-Zigbee', 'elburgo_real.geojson'));
const SALIDA = arg('json', null);
const ALTURAS = [0.775, 1.5];
const TILTS = [0, 30, 55, 90];
const TOL_GEO_M = 1.0;          // desvío admisible de la conversión, ver abajo

if (!fs.existsSync(GEOJSON)) {
  console.error('no encuentro el arbitro en ' + GEOJSON + '\n' +
    'Vive en el repo cobertura-zigbee. Pasa su ruta con --geojson.');
  process.exit(2);
}

/* ── CÓDIGO REAL DE LOS DOS SITIOS, no copias ───────────────────────────── */
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const genSiting = fs.readFileSync(path.join(RAIZ, 'tools', 'gen_siting.mjs'), 'utf8');
const saca = (txt, re, quien) => { const m = txt.match(re);
  if (!m) { console.error('no encuentro ' + quien); process.exit(2); } return m[0]; };
const srcUtm = saca(genSiting, /function utm\(lat, lon, zona, sur\) \{[\s\S]*?\n\}/, 'utm() en gen_siting.mjs');
const srcRows = saca(html, /function rfRows\(\)\{[\s\S]*?\n}\n/, 'rfRows() en index.html');
const BURGO = JSON.parse(saca(html, /^const BURGO=(\{[\s\S]*?\});$/m, 'el preset BURGO').replace(/^const BURGO=/, '').replace(/;$/, ''));

const RPV = await import('../radio_pv_model.js');
const ZB = (await import('../radio_zigbee.js')).default;
const ML = (await import('../radio_malla.js')).default;
const R = RPV.default ?? RPV;
const PARAMS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const PRO = PARAMS.tecnologias.zigbee_pro_24;
const PROP = {
  eps_r_suelo: PARAMS.propagacion.eps_r_suelo.valor,
  sigma_suelo_s_m: PARAMS.propagacion.sigma_suelo_s_m.valor,
  polarizacion: PARAMS.propagacion.polarizacion.valor,
  sigma_db: PARAMS.propagacion.sigma_db.valor,
  vegetacion: { modelo: PARAMS.vegetacion.modelo.valor }
};
const CUERDA = (BURGO.bifila && BURGO.bifila.cuerda) || PARAMS.geometria.cuerda_m_defecto.valor;

/* ── GEOMETRÍA DE LA PLANTA ─────────────────────────────────────────────── */
const motors = BURGO.tcus.map((t, i) => ({ id: 'T' + i, x: t[0], y: t[1],
  len: t[6] != null ? t[6] : undefined, wid: t[7] != null ? t[7] : undefined,
  az: t[8] != null ? t[8] : undefined }));
const ctx = { S: { bifila: BURGO.bifila || null, motors, p: { tlen: 100, twid: 12 } }, Math };
vm.createContext(ctx);
vm.runInContext(srcUtm + '\n' + srcRows + '\nvar __R = rfRows();', ctx);
const ROWS = ctx.__R;
/* dirección de las filas, del primer segmento: es la que decide el régimen */
const s0 = ROWS.segs[0];
const DIR_FILA = [s0[2] - s0[0], s0[3] - s0[1]];

/* ── EL ÁRBITRO, Y LA VALIDACIÓN DE LA CONVERSIÓN ───────────────────────── */
const G = JSON.parse(fs.readFileSync(GEOJSON, 'utf8'));
const nodos = new Map();
for (const f of G.features) if (f.geometry.type === 'Point') nodos.set(f.properties.id, f.properties);
const zona = Math.floor((BURGO.lon + 180) / 6) + 1;
const local = c => { const [E, N] = ctx.utm(c[1], c[0], zona, false); return [E - BURGO.ox, N - BURGO.oy]; };

const enlaces = [];
let peorGeo = 0;
for (const f of G.features) {
  if (f.geometry.type !== 'LineString') continue;
  const p = f.properties;
  const a = local(f.geometry.coordinates[0]), b = local(f.geometry.coordinates[1]);
  const D = Math.hypot(a[0] - b[0], a[1] - b[1]);
  peorGeo = Math.max(peorGeo, Math.abs(D - p.distancia_m));
  if (p.rssi_medido_dbm == null) continue;
  enlaces.push({ a, b, D, med: p.rssi_medido_dbm, origen: p.origen, destino: p.destino,
                 dNom: p.distancia_m, nodo: nodos.get(p.destino) || {} });
}
/* SI LA CONVERSIÓN NO CUADRA, SE PARA. Comparar la distancia que sale de las
   coordenadas convertidas contra la que el propio fichero anota es la única
   comprobación independiente que hay, y sin ella todo lo de abajo sería ruido
   con pinta de resultado. */
if (peorGeo > TOL_GEO_M) {
  console.error('LA CONVERSION lon/lat -> metros locales NO CUADRA: el peor desvio\n' +
    'frente al `distancia_m` del propio fichero es ' + peorGeo.toFixed(2) + ' m (tolerancia ' +
    TOL_GEO_M + ' m).\nSin eso, ningun numero de este careo vale. Revisa ox/oy/zona del preset.');
  process.exit(2);
}

/* ── LAS BANDAS QUE CRUZA UN ENLACE, DE VERDAD ──────────────────────────── */
function cruces(a, b, D, tilt, ant) {
  const ex = b[0] - a[0], ey = b[1] - a[1], segs = ROWS.segs;
  const xlo = Math.min(a[0], b[0]) - ROWS.span, xhi = Math.max(a[0], b[0]);
  const ylo = Math.min(a[1], b[1]), yhi = Math.max(a[1], b[1]);
  let lo = 0, hi = segs.length;
  while (lo < hi) { const md = (lo + hi) >> 1; if (Math.min(segs[md][0], segs[md][2]) < xlo) lo = md + 1; else hi = md; }
  const out = [];
  for (let k = lo; k < segs.length; k++) {
    const s = segs[k];
    if (Math.min(s[0], s[2]) > xhi) break;
    if (Math.max(s[1], s[3]) < ylo || Math.min(s[1], s[3]) > yhi) continue;
    const fx = s[2] - s[0], fy = s[3] - s[1];
    const den = ex * fy - ey * fx; if (Math.abs(den) < 1e-12) continue;
    const wx = s[0] - a[0], wy = s[1] - a[1];
    const t = (wx * fy - wy * fx) / den, u = (wx * ey - wy * ex) / den;
    if (t > 0.001 && t < 0.999 && u >= 0 && u <= 1) out.push({ s: t * D, banda: R.banda(ant, CUERDA, tilt, 0) });
  }
  out.sort((p, q) => p.s - q.s);
  return out;
}

/* ── 1. EL DEFECTO DE ATRIBUCIÓN, MEDIDO ────────────────────────────────── */
console.log('CAREO CONTRA EL ARBITRO v1 DE EL BURGO');
console.log('exportacion de fecha desconocida · RSSI por enlace MAL ATRIBUIDO\n');
console.log('== 1. POR QUE ESTE ARBITRO NO ES UNA MEDIDA POR ENLACE ==');
const porD = new Map();
for (const e of enlaces) {
  const k = e.dNom.toFixed(1);
  if (!porD.has(k)) porD.set(k, []); porD.get(k).push(e);
}
const grupos = [...porD.entries()].filter(([, v]) => v.length >= 3)
  .sort((x, y) => y[1].length - x[1].length);
for (const [d, v] of grupos) {
  const r = v.map(e => e.med).sort((x, y) => x - y);
  console.log('   a ' + d + ' m hay ' + v.length + ' enlaces, de ' + r[0] + ' a ' + r[r.length - 1] +
              ' dBm  ->  ' + (r[r.length - 1] - r[0]) + ' dB de recorrido A LA MISMA DISTANCIA');
}
/* Pearson, devolviendo `null` —no NaN— cuando una de las dos variables no
   varía. Con datos reales no pasa, pero un NaN se serializa a `null` en el
   JSON sin decir por qué, y entonces «no se pudo calcular» y «salió cero» se
   confunden. El banco cubre el caso degenerado a propósito. */
const corr = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return { r: null, motivo: 'menos de 3 puntos' };
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const p = xs[i] - mx, q = ys[i] - my; sxy += p * q; sxx += p * p; syy += q * q; }
  if (sxx === 0) return { r: null, motivo: 'la primera variable no varia' };
  if (syy === 0) return { r: null, motivo: 'la segunda variable no varia' };
  return { r: sxy / Math.sqrt(sxx * syy), motivo: null };
};
const di = (c) => c.r === null ? 'NO CALCULABLE (' + c.motivo + ')' : c.r.toFixed(3);
const cPad = corr(enlaces.map(e => e.nodo.padres_distintos || 0), enlaces.map(e => e.med));
const cDis = corr(enlaces.map(e => Math.log10(e.D)), enlaces.map(e => e.med));
const rPad = cPad.r, rDis = cDis.r;
console.log('   r(padres_distintos del nodo, RSSI) = ' + di(cPad));
console.log('   r(log distancia,            RSSI) = ' + di(cDis));
if (rPad !== null && rDis !== null && Math.abs(rPad) >= Math.abs(rDis) * 0.8)
  console.log('   -> cuantos padres tuvo el nodo explica el «RSSI del enlace» tanto como la distancia.');
else if (rPad === null || rDis === null)
  console.log('   -> una de las dos no se puede calcular; ver el motivo arriba.');
else console.log('   -> aqui los padres pesan menos que la distancia.');
console.log('');

/* ── 2. FILAS REALES FRENTE A LA SUPOSICIÓN DE 12 m ─────────────────────── */
console.log('== 2. FILAS CRUZADAS: REALES frente a la suposicion de paso 12 m (el defecto RF-01) ==');
let sumReal = 0, sumSup = 0, peorDif = 0;
for (const e of enlaces) {
  const real = cruces(e.a, e.b, e.D, 30, 0.775).length;
  const sup = Math.max(0, Math.floor(e.D / 12.0));
  e.nReal = real; e.nSup = sup;
  sumReal += real; sumSup += sup; peorDif = Math.max(peorDif, Math.abs(real - sup));
}
console.log('   total de filas cruzadas: REALES ' + sumReal + '  ·  supuestas ' + sumSup +
            '  (' + (sumSup / sumReal).toFixed(2) + ' veces)');
console.log('   peor diferencia en un solo enlace: ' + peorDif + ' filas');
const reparto = new Map();
for (const e of enlaces) { const k = e.nReal + '>' + e.nSup; reparto.set(k, (reparto.get(k) || 0) + 1); }
console.log('   enlaces donde NO coinciden: ' + enlaces.filter(e => e.nReal !== e.nSup).length + ' de ' + enlaces.length + '\n');

/* ── 3. RÉGIMEN ─────────────────────────────────────────────────────────── */
console.log('== 3. REGIMEN DEL ENLACE ==');
for (const e of enlaces) {
  const rg = R.regimen(e.b[0] - e.a[0], e.b[1] - e.a[1], DIR_FILA[0], DIR_FILA[1], 10);
  e.reg = rg.tipo; e.ang = rg.anguloDeg;
}
const pas = enlaces.filter(e => e.reg === 'pasillo'), cru = enlaces.filter(e => e.reg === 'cruza');
console.log('   pasillo (a menos de 10 grados de las filas): ' + pas.length +
            '  ·  cruza: ' + cru.length);
if (pas.length) console.log('     los de pasillo cruzan ' +
  (pas.reduce((a, e) => a + e.nReal, 0) / pas.length).toFixed(2) + ' filas de media');
if (cru.length) console.log('     los de cruce cruzan ' +
  (cru.reduce((a, e) => a + e.nReal, 0) / cru.length).toFixed(2) + ' filas de media\n');

/* ── 4. EL CAREO, A DOS ALTURAS Y VARIOS ÁNGULOS ────────────────────────── */
console.log('== 4. EL CAREO: (predicho - medido), en dB ==');
console.log('   la altura de antena NO esta confirmada, asi que van las dos.');
console.log('   el angulo de la campana tampoco se sabe: la mediana promedia 8.053 instantes.\n');
const est = a => { const s = [...a].sort((x, y) => x - y);
  return { n: a.length, media: a.reduce((x, y) => x + y, 0) / a.length,
           med: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] }; };
const informe = { arbitro: 'v1', geojson: GEOJSON, alturas: {}, };
for (const ant of ALTURAS) {
  console.log('   ── ANTENA A ' + ant.toFixed(3) + ' m ──');
  console.log('      tilt   n    media   mediana      min      max');
  informe.alturas[ant] = {};
  for (const tilt of TILTS) {
    const dif = enlaces.map(e => {
      const p = ZB.presupuesto({ D: e.D, zA: ant, zB: ant, cruces: cruces(e.a, e.b, e.D, tilt, ant) },
                               PRO, PROP, null);
      e['d' + ant + '_' + tilt] = p.prxDbm - e.med;
      return p.prxDbm - e.med;
    });
    const s = est(dif);
    informe.alturas[ant][tilt] = s;
    console.log('      ' + String(tilt).padStart(3) + '  ' + String(s.n).padStart(3) +
                s.media.toFixed(1).padStart(9) + s.med.toFixed(1).padStart(10) +
                s.min.toFixed(1).padStart(9) + s.max.toFixed(1).padStart(9));
  }
  console.log('');
}
const m0 = informe.alturas[0.775][30].media, m1 = informe.alturas[1.5][30].media;
console.log('   CUANTO CAMBIA LA ALTURA, a 30 grados: ' + m0.toFixed(2) + ' dB con la antena a');
console.log('   0,775 m frente a ' + m1.toFixed(2) + ' dB con la antena a 1,5 m  ->  ' +
            Math.abs(m1 - m0).toFixed(2) + ' dB de diferencia.');
console.log('   Con 0,725 m de duda en el montaje, el careo se mueve eso. Hay que confirmarlo.\n');

/* ── 5. DESGLOSE POR FILAS REALES Y POR RÉGIMEN ─────────────────────────── */
const ANT_REF = 0.775, TILT_REF = 30;
console.log('== 5. DESGLOSE (antena ' + ANT_REF + ' m, tilt ' + TILT_REF + ' grados) ==');
console.log('   por FILAS CRUZADAS REALES:');
console.log('      filas   n    media   mediana');
const maxF = Math.max(...enlaces.map(e => e.nReal));
for (let k = 0; k <= maxF; k++) {
  const a = enlaces.filter(e => e.nReal === k).map(e => e['d' + ANT_REF + '_' + TILT_REF]);
  if (!a.length) continue;
  const s = est(a);
  console.log('      ' + String(k).padStart(5) + String(s.n).padStart(4) +
              s.media.toFixed(1).padStart(9) + s.med.toFixed(1).padStart(10));
}
console.log('   por REGIMEN:');
for (const [nom, grp] of [['pasillo', pas], ['cruza', cru]]) {
  if (!grp.length) { console.log('      ' + nom.padEnd(8) + ' (ninguno)'); continue; }
  const s = est(grp.map(e => e['d' + ANT_REF + '_' + TILT_REF]));
  console.log('      ' + nom.padEnd(8) + String(s.n).padStart(4) +
              s.media.toFixed(1).padStart(9) + s.med.toFixed(1).padStart(10));
}

console.log('\nROTULO: arbitro v1, exportacion de fecha desconocida, RSSI por enlace mal');
console.log('atribuido (mediana del NODO). Provisional. Se repite con el regenerado.');

if (SALIDA) {
  informe.rotulo = 'arbitro v1 · exportacion de fecha desconocida · RSSI por enlace mal atribuido (mediana del nodo)';
  informe.filas_reales_total = sumReal;
  informe.filas_supuestas_12m_total = sumSup;
  informe.r_padres_rssi = rPad; informe.r_logd_rssi = rDis;
  informe.r_padres_motivo = cPad.motivo; informe.r_logd_motivo = cDis.motivo;
  informe.regimen = { pasillo: pas.length, cruza: cru.length };
  informe.peor_desvio_geo_m = peorGeo;
  /* detalle por enlace: es lo que el banco compara contra su propio cálculo a
     lo bruto, sin poda ni búsqueda binaria. Dos implementaciones de lo mismo
     se separan solas, y la que se separa es la que nadie mira. */
  informe.enlaces = enlaces.map(e => ({
    origen: e.origen, destino: e.destino, D: e.D, dNom: e.dNom, med: e.med,
    filasReales: e.nReal, filasSupuestas12m: e.nSup, regimen: e.reg, anguloFilaDeg: e.ang
  }));
  fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 2));
  console.error('escrito ' + SALIDA);
}
