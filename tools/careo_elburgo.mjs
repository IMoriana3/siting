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
const TELEMETRIA = arg('telemetria', path.join(RAIZ, '..', 'Cobertura-Zigbee', 'trackers_2026-06-17.json'));
const ALTURAS = [0.775, 1.5];
const ANT_REF = 0.775, TILT_REF = 30, ANT_REF_TELE = 0.775;
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
const EST = await import('./estadistica.mjs');
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

/* ── DE QUÉ SEGUIDOR ES CADA SEGMENTO ───────────────────────────────────────
 * `rfRows` los devuelve ordenados y sin dueño. Se rehace la construcción SOLO
 * para indexar extremo→seguidor y se casa por coordenada exacta: es el mismo
 * cálculo, así que los bits coinciden. Si no casan todos, se para. */
const DUENYO = (() => {
  const cu = (BURGO.bifila && BURGO.bifila.cuerda) || 0;
  const k4 = z => z[0] + '|' + z[1] + '|' + z[2] + '|' + z[3];
  const idx = new Map();
  for (let i = 0; i < motors.length; i++) {
    const m = motors[i];
    const Lm = (m.len != null ? m.len : 100), Wm = (m.wid != null ? m.wid : 12);
    const aa = ((m.az || 0)) * Math.PI / 180;
    const ux = Math.cos(aa), uy = -Math.sin(aa), lx = -uy, ly = ux;
    const sep = (cu > 0 && Wm > 0) ? (Wm - cu) : 0;
    for (const o of (sep > 0.05 ? [-sep / 2, sep / 2] : [0])) {
      const cx = m.x + o * ux, cy = m.y + o * uy, hl = Lm / 2;
      idx.set(k4([cx - hl * lx, cy - hl * ly, cx + hl * lx, cy + hl * ly]), i);
    }
  }
  const d = ROWS.segs.map(z => idx.get(k4(z)));
  if (d.some(v => v === undefined)) {
    console.error('el indice de segmentos no casa con rfRows; ha cambiado la construccion en index.html');
    process.exit(2);
  }
  return d;
})();

/* ── LAS BANDAS QUE CRUZA UN ENLACE, DE VERDAD ──────────────────────────────
 * `tilt` puede ser un número (uno para toda la planta) o una función del
 * índice del segmento, que es por donde entra el ángulo por seguidor. */
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
    if (t > 0.001 && t < 0.999 && u >= 0 && u <= 1) {
      const al = typeof tilt === 'function' ? tilt(k) : tilt;
      /* CONTRATO NUEVO: el cruce trae la geometria de la fila y el motor corta
         contra el plano inclinado. `ant` es ahora el EJE del tubo, no la cota de
         la antena: las dos eran la misma cosa por error y de ahi venia que la
         banda degenerase al filo del modelo antiguo. */
      const senPhi = Math.abs(den) / (D * Math.hypot(fx, fy));
      out.push({ s: t * D, zEje: ant, cuerda: CUERDA, alpha: al, senPhi: senPhi });
    }
  }
  out.sort((p, q) => p.s - q.s);
  return out;
}

/* ── 1. EL DEFECTO DE ATRIBUCIÓN, MEDIDO ────────────────────────────────── */
console.log('CAREO CONTRA EL ARBITRO v1 DE EL BURGO');
console.log('exportacion de fecha desconocida · RSSI por enlace MAL ATRIBUIDO');
console.log('UNA MEDIA NO ES VALIDACION: ver el rotulo del final antes de citar nada.\n');
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
/* Las correlaciones van CON SU p-VALOR. Sin él, un r de −0,25 sobre n = 49
   parece un hallazgo y no lo es: no llega a significativo al 5 %. */
const cPad = EST.pearson(enlaces.map(e => e.nodo.padres_distintos || 0), enlaces.map(e => e.med));
const cDis = EST.pearson(enlaces.map(e => Math.log10(e.D)), enlaces.map(e => e.med));
const rPad = cPad.r, rDis = cDis.r;
const di = c => c.r === null ? 'NO CALCULABLE (' + c.motivo + ')'
  : c.r.toFixed(3) + '   p=' + (c.p < 1e-4 ? c.p.toExponential(1) : c.p.toFixed(4)) +
    '   n=' + c.n + (c.p < 0.05 ? '  (significativa)' : '  (NO significativa al 5 %)');
console.log('   r(padres_distintos del nodo, RSSI) = ' + di(cPad));
console.log('   r(log distancia,            RSSI) = ' + di(cDis));
/* LO QUE SOSTIENE LA CONCLUSIÓN NO SON LAS CORRELACIONES —ninguna de las dos
   llega a significativa con n = 49— SINO LA OBSERVACIÓN DIRECTA de arriba: 29
   dB de recorrido entre enlaces de la misma longitud. Eso no necesita
   estadística para leerse. */
console.log('   -> ojo: NINGUNA de las dos es significativa con n=' + cPad.n + '. Lo que sostiene');
console.log('      la conclusion es la observacion directa de arriba -29 dB a la misma');
console.log('      distancia-, no estas correlaciones.\n');

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

/* ── 5. EL ÁNGULO, CERRADO CON LO QUE SE PUEDE Y NO CON LO QUE SE QUIERE ────
 *
 * LAS FECHAS DE LA CAMPAÑA NO ESTÁN EN EL GEOJSON. `periodo_filas_routes` no
 * es un periodo: la línea que lo escribe es `periodo_filas_routes:
 * rutas.filas||0` (index.html:1700), o sea el NÚMERO DE FILAS del CSV de
 * rutas. En todo el fichero no hay una sola fecha ISO. Comprobado.
 *
 * LA TELEMETRÍA DE BASCULACIÓN NO SE PUEDE CRUZAR POR SEGUIDOR, y esto costó
 * un resultado falso antes de verlo:
 *
 *   · el preset de El Burgo tiene 215 seguidores pero sólo 108 etiquetas
 *     distintas: 107 están repetidas. Las dos entradas de cada etiqueta están
 *     a 82–454 m una de otra, así que NO son las dos mitades de la bifila:
 *     son seguidores distintos que comparten número.
 *   · la clave única es (NCU, etiqueta) — 215 de 215 —, porque la renumeración
 *     fue «esclavo corrido DENTRO DE CADA NCU», como dice el propio geojson.
 *   · y la telemetría va de 1 a 109, que no cabe ni en NCU1 (1–108) ni en
 *     NCU2 (1–107). Es una TERCERA numeración, sin correspondencia documentada.
 *
 *   Cruzarla por etiqueta a secas da 202 de 215 «coincidencias» y asigna la
 *   misma serie a dos seguidores que están a 200 m. Eso produce números
 *   plausibles y falsos, que es la peor clase.
 *
 * LO QUE SÍ SE PUEDE USAR es `field`: el ángulo de planta, MEDIDO, cada 5
 * minutos, sin ninguna ambigüedad de numeración. Se pierde la dispersión entre
 * seguidores, y esa pérdida está ACOTADA con el propio fichero: sobre sus 168
 * instantes, la diferencia entre el seguidor más y el menos inclinado es de
 * 2,3° de mediana y 28,0° como máximo, y el máximo se concentra en la hora de
 * transición del backtracking (05:00–06:30). El resto del día la planta va
 * dentro de 1–2° de `field`.
 *
 * SIGUE SIN SER LA DISTRIBUCIÓN DE LA CAMPAÑA: es un día, y llega a las 13:58,
 * así que sobrerrepresenta la mañana. Es el mejor proxy MEDIDO que existe.
 *
 * Se compara MEDIANA CONTRA MEDIANA: lo medido es la mediana del nodo sobre la
 * campaña, así que lo predicho se resume igual sobre los instantes.
 */
let TELE = null;
if (fs.existsSync(TELEMETRIA)) {
  const t = JSON.parse(fs.readFileSync(TELEMETRIA, 'utf8'));
  const horas = Object.keys(t.field || {}).sort();
  /* dispersión entre seguidores, que es la cota del error de usar `field` */
  const disp = [];
  for (const h of horas) {
    const vs = Object.keys(t.trk || {}).map(k => t.trk[k][h])
                     .filter(v => typeof v === 'number').map(Math.abs);
    if (vs.length) disp.push(Math.max(...vs) - Math.min(...vs));
  }
  disp.sort((a, b) => a - b);
  TELE = { fecha: t.date, bucket_s: t.bucket_s, t0: t.t0, t1: t.t1, horas, field: t.field,
           nTrk: Object.keys(t.trk || {}).length,
           dispMediana: disp.length ? disp[Math.floor(disp.length / 2)] : null,
           dispMax: disp.length ? disp[disp.length - 1] : null };
}
console.log('== 5. EL ANGULO MEDIDO (de planta, no por seguidor) ==');
if (!TELE) {
  console.log('   no hay telemetria en ' + TELEMETRIA + ': el angulo se queda barrido.\n');
} else {
  console.log('   telemetria de ' + TELE.fecha + ', cada ' + TELE.bucket_s + ' s, de ' +
              TELE.t0.slice(11, 16) + ' a ' + TELE.t1.slice(11, 16) + ' — ' + TELE.horas.length + ' instantes');
  console.log('   NO se cruza por seguidor: la etiqueta no es unica (clave = NCU+etiqueta) y la');
  console.log('   telemetria usa una tercera numeracion (1..109, fuera de rango en las dos NCU).');
  console.log('   Se usa `field`, el angulo de PLANTA. Lo que se pierde, acotado con el propio');
  console.log('   fichero: dispersion entre seguidores ' + TELE.dispMediana.toFixed(1) +
              ' grados de mediana, ' + TELE.dispMax.toFixed(1) + ' maxima (en el backtracking).');
  informe.telemetria = { fecha: TELE.fecha, t0: TELE.t0, t1: TELE.t1,
    instantes: TELE.horas.length, seguidores_en_fichero: TELE.nTrk,
    cruce_por_seguidor: 'IMPOSIBLE: etiqueta no unica, telemetria en tercera numeracion',
    dispersion_entre_seguidores_mediana_deg: TELE.dispMediana,
    dispersion_entre_seguidores_max_deg: TELE.dispMax, alturas: {} };
  for (const ant of ALTURAS) {
    const dif = enlaces.map(e => {
      const serie = TELE.horas.map(h => {
        const al = Math.abs(TELE.field[h] == null ? 0 : TELE.field[h]);
        return ZB.presupuesto({ D: e.D, zA: ant, zB: ant, cruces: cruces(e.a, e.b, e.D, al, ant) },
                              PRO, PROP, null).prxDbm;
      }).filter(v => typeof v === 'number');
      const predMed = EST.percentil(serie, 0.5);
      e['dTele' + ant] = predMed - e.med;
      return predMed - e.med;
    });
    const r = EST.resumen(dif);
    console.log('   antena ' + ant.toFixed(3) + ' m:  n=' + r.n + '  media ' + r.media.toFixed(2) +
                '  sigma ' + r.sigma.toFixed(2) + '  p10 ' + r.p10.toFixed(1) + '  p50 ' +
                r.p50.toFixed(1) + '  p90 ' + r.p90.toFixed(1) +
                '  [' + r.min.toFixed(1) + ', ' + r.max.toFixed(1) + ']');
    informe.telemetria.alturas[ant] = r;
  }
  console.log('');
}

/* ── 6. LA ESTRUCTURA DEL RESIDUO ───────────────────────────────────────────
 * UNA MEDIA NO VALIDA NADA: +1,1 dB es compatible con acertar y con fallar
 * ±25 dB compensándose. Lo que dice algo es la dispersión y la estructura.
 */
const REF = (TELE ? 'dTele' + ANT_REF_TELE : 'd' + ANT_REF + '_' + TILT_REF);
const res = enlaces.map(e => e[REF]).filter(v => typeof v === 'number');
console.log('== 6. LA ESTRUCTURA DEL RESIDUO ==');
console.log('   (residuo = predicho - medido, con ' +
            (TELE ? 'ANGULO DE PLANTA MEDIDO y antena ' + ANT_REF_TELE + ' m' : 'tilt ' + TILT_REF + ' y antena ' + ANT_REF + ' m') + ')');
const rr = EST.resumen(res);
console.log('   n=' + rr.n + '  media ' + rr.media.toFixed(2) + ' dB  SIGMA ' + rr.sigma.toFixed(2) +
            ' dB  p10 ' + rr.p10.toFixed(1) + '  p50 ' + rr.p50.toFixed(1) + '  p90 ' + rr.p90.toFixed(1));
console.log('   recorrido: ' + rr.min.toFixed(1) + ' a ' + rr.max.toFixed(1) + ' dB');
const hh = EST.histograma(res, 5);
console.log('   histograma (bandas de 5 dB):');
for (const b of hh.bandas) if (b.n) console.log('      [' + String(b.desde).padStart(4) + ',' +
  String(b.hasta).padStart(4) + ')  ' + '#'.repeat(b.n) + ' ' + b.n);

const pre = enlaces.map(e => e[REF]).filter(v => typeof v === 'number');
const idxOk = enlaces.map((e, i) => [e, i]).filter(([e]) => typeof e[REF] === 'number');
const medOk = idxOk.map(([e]) => e.med);
const predOk = idxOk.map(([e]) => e[REF] + e.med);
const pP = EST.pearson(predOk, medOk), pS = EST.spearman(predOk, medOk);
const fmt = c => c.r === null ? 'NO CALCULABLE (' + c.motivo + ')'
  : c.r.toFixed(3) + '  p=' + (c.p < 1e-4 ? c.p.toExponential(1) : c.p.toFixed(4)) + '  n=' + c.n;
console.log('\n   PREDICHO frente a MEDIDO:');
console.log('      Pearson  r = ' + fmt(pP));
console.log('      Spearman r = ' + fmt(pS));

console.log('\n   PENDIENTE DEL RESIDUO contra cada variable (dB por unidad):');
const vars = [
  ['distancia (m)', idxOk.map(([e]) => e.D)],
  ['filas cruzadas reales', idxOk.map(([e]) => e.nReal)],
  ['padres_distintos del nodo', idxOk.map(([e]) => e.nodo.padres_distintos || 0)],
];
informe.residuo = { referencia: REF, resumen: rr, histograma: hh,
  pearson_pred_med: pP, spearman_pred_med: pS, pendientes: {} };
for (const [nom, xs] of vars) {
  const pd = EST.pendiente(xs, pre);
  informe.residuo.pendientes[nom] = pd;
  if (pd.b === null) { console.log('      ' + nom.padEnd(28) + 'NO CALCULABLE (' + pd.motivo + ')'); continue; }
  const sig = pd.p < 0.05 ? '  <- SIGNIFICATIVA' : '';
  console.log('      ' + nom.padEnd(28) + pd.b.toFixed(4).padStart(10) + ' +- ' + pd.se.toFixed(4) +
              '   p=' + (pd.p < 1e-4 ? pd.p.toExponential(1) : pd.p.toFixed(4)) + sig);
}
console.log('');
const conPend = Object.entries(informe.residuo.pendientes).filter(([, v]) => v.p !== null && v.p < 0.05);
if (conPend.length) {
  console.log('   EL RESIDUO TIENE ESTRUCTURA contra: ' + conPend.map(([k]) => k).join(', ') + '.');
  console.log('   Eso significa que EL MODELO REPARTE MAL LA CULPA entre esas variables, y no');
  console.log('   se arregla con un sesgo global. Es lo que la campana de barrido viene a medir.');
} else {
  console.log('   Ninguna pendiente sale significativa al 5 %. Con n=' + rr.n + ' eso NO es');
  console.log('   «no hay estructura»: es «con esta muestra no se detecta».');
}
console.log('');

/* ── 5. DESGLOSE POR FILAS REALES Y POR RÉGIMEN ─────────────────────────── */
console.log('== 7. DESGLOSE (antena ' + ANT_REF + ' m, tilt ' + TILT_REF + ' grados) ==');
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

/* ── EL RÓTULO ──────────────────────────────────────────────────────────────
 * Va al final Y al principio, y dice lo que NO se puede concluir. Un número
 * suelto se cita fuera de contexto: éste tiene que llevar el contexto pegado. */
const _rr = informe.residuo.resumen;
const ROTULO = [
  'ROTULO — LEASE ANTES DE CITAR NINGUN NUMERO DE AQUI',
  '',
  '  UNA MEDIA NO ES UNA VALIDACION. Con sigma ' + _rr.sigma.toFixed(1) + ' dB y un recorrido de ' +
    _rr.min.toFixed(0) + ' a ' + _rr.max.toFixed(0) + ' dB, cualquier media es',
  '  compatible con que el modelo acierte y con que falle en ambos sentidos',
  '  compensandose. La media de este careo es ' + _rr.media.toFixed(1) + ' dB y NO valida el motor.',
  '',
  '  LA CORRELACION PREDICHO-MEDIDO ES NULA: Pearson ' + informe.residuo.pearson_pred_med.r.toFixed(3) +
    ' (p=' + informe.residuo.pearson_pred_med.p.toFixed(2) + '), Spearman ' +
    informe.residuo.spearman_pred_med.r.toFixed(3) + '.',
  '  El modelo no ordena los enlaces como los ordena el arbitro.',
  '',
  '  EL CAREO ES CONTRA UN ESTADISTICO DE NODO, no contra una medida de enlace:',
  '  el `rssi_medido_dbm` de cada linea es la mediana del NODO sobre la campana,',
  '  atribuida a su padre dominante. A 12,0 m hay 29 dB de recorrido entre',
  '  enlaces identicos en longitud.',
  '',
  '  Y ES SOBRE UN ARBITRO v1 DE FECHA DESCONOCIDA: la exportacion no trae',
  '  `generado` ni `spof_frac`, que el exportador actual si escribe.',
  '',
  '  PROVISIONAL. Se repite con el geojson regenerado.'
].join('\n');
console.log('\n' + ROTULO);

if (SALIDA) {
  informe.rotulo = ROTULO;
  informe.rotulo_corto = 'arbitro v1 · fecha desconocida · RSSI por enlace mal atribuido (mediana del nodo) · una media NO es validacion';
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
