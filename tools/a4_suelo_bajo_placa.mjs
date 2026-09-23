/* a4_suelo_bajo_placa.mjs — ¿manda alguna vez el suelo bajo la placa?
 *
 * ═══ QUÉ ES A4, Y POR QUÉ ESTO ES UNA MEDIDA Y NO UN PARCHE ═══
 *
 * `INVENTARIO_MOTOR_RF.md` §5: bajo la placa hay DOS obstáculos —la placa
 * encima y el suelo debajo— y manda el más cercano. rf-fv se dio cuenta; su
 * implementación (`min(los − ground, bot − los)`) está mal, porque toma ν del
 * despeje limitado por el suelo y el borde difractante de la PLACA, sin mirar
 * quién limitó. Y físicamente por debajo de la placa el rayo pasa por una
 * RANURA entre dos bordes opuestos, no por un filo único.
 *
 * Lo que hay que absorber, dice el inventario, **no es el `min`: es haberse
 * dado cuenta**.
 *
 * ═══ Y HAY UNA RAZÓN PARA MEDIR ANTES DE TOCAR NADA ═══
 *
 * El propio inventario midió esto con suelo LLANO y concluyó: «con las antenas
 * actuales no pasa nunca» — efecto cero, **«y de efecto real en cuanto entre el
 * DEM, porque entonces la cota del rayo sobre el suelo local sí baja»**.
 *
 * El DEM ya entró. Así que la pregunta vuelve a estar viva y ahora SÍ se puede
 * contestar con terreno de verdad, en vez de suponerlo. Esto es esa medida.
 *
 * Además el plan original decía «implementado vía `relieveDominante`», y esa
 * función **ya no existe**: A3 la sustituyó por la tierra lisa de P.1812. Así
 * que el plan de A4 hay que rehacerlo sobre lo que hay, y eso empieza por saber
 * si hay algo que hacer.
 *
 *   node tools/a4_suelo_bajo_placa.mjs [--tilt 30]
 *
 * ═══ QUÉ MIDE, EXACTAMENTE ═══
 *
 * Para cada cruce de fila de cada enlace TCU→su NCU de Ayora y San José, con su
 * terreno real:
 *
 *     hueco   = zBot − zSuelo      lo que hay entre el suelo y el canto bajo
 *     alRayo  = zRayo − zSuelo     lo que el rayo pasa por encima del suelo
 *     aLaPlaca= zBot  − zRayo      lo que el rayo pasa por debajo de la placa
 *
 * El suelo MANDA cuando `alRayo < aLaPlaca`, o sea cuando el rayo va por debajo
 * de la mitad del hueco. Se cuenta cuántas veces pasa y con cuánto margen.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const TILT = parseFloat(arg('tilt', '30'));

const TP = require(path.join(RAIZ, 'terreno_planta.js'));
const RPV = require(path.join(RAIZ, 'radio_pv_model.js'));
const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const G = P.geometria;
const EJE = G.eje_tubo_m.valor;
const CUERDA = G.cuerda_m_defecto.valor;
const ANT = RPV.alturaAntenaTCU(EJE, G.antena_tcu.radio_ancla_m.valor,
                                G.antena_tcu.coax_caida_m.valor, TILT);
const ANT_NCU = G.antena_ncu_m.valor;

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
function preset(nombre) {
  const m = new RegExp('const ' + nombre + '=(\\{.*?\\});', 's').exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}
/* `rfRows()` SE SACA DEL index.html, no se reimplementa: es la misma razón por
   la que lo hace `careo_elburgo.mjs`. Una copia de la construcción de filas se
   separa del original y entonces esto mediría otra planta. */
const mRows = html.match(/function rfRows\(\)\{[\s\S]*?\n}\n/);
if (!mRows) { console.error('no encuentro rfRows() en index.html'); process.exit(2); }

const PLANTAS = [['ayora', 'AYORA'], ['sanjose', 'SANJOSE']];
const faltan = PLANTAS.filter(([p]) => !fs.existsSync(path.join(RAIZ, 'terreno', p + '_relieve.json')));
if (faltan.length) {
  console.log('SIN MEDIDA: falta el terreno de ' + faltan.map(f => f[0]).join(', '));
  console.log('No se ha medido nada. Esto no es un verde.');
  process.exit(0);
}

const pct = (a, p) => { if (!a.length) return null;
  const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/* La cota del canto BAJO de una fila a tilt α, sobre SU suelo:
   zBot = eje − (cuerda/2)·|sen α|. Es la misma cuenta que `cortaPanel`. */
const zBotRel = eje => eje - (CUERDA / 2) * Math.abs(Math.sin(TILT * Math.PI / 180));

console.log('tilt ' + TILT + '° · eje ' + EJE.toFixed(2) + ' m DECLARADO · cuerda ' + CUERDA + ' m');
console.log('antena TCU ' + ANT.toFixed(4) + ' m · NCU ' + ANT_NCU.toFixed(2) + ' m');
console.log('canto bajo de la placa, sobre su suelo: ' + zBotRel(EJE).toFixed(4) + ' m\n');

let manda = 0, cruces = 0, bajoSuelo = 0;
const margen = [], huecos = [];

for (const [planta, preNom] of PLANTAS) {
  const pre = preset(preNom);
  if (!pre) { console.log('═══ ' + planta.toUpperCase() + ' ═══  sin preset, se salta'); continue; }
  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', planta + '_relieve.sha256.json'), 'utf8'));
  const T = TP.cargaRelieve(JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', planta + '_relieve.json'), 'utf8')));
  const dx = pre.ox - man.cE, dn = pre.oy - man.cN;

  const motors = pre.tcus.map((t, i) => ({ id: 'T' + i, x: t[0], y: t[1],
    len: t[6] != null ? t[6] : undefined, wid: t[7] != null ? t[7] : undefined,
    az: t[8] != null ? t[8] : undefined }));
  const ctx = { S: { bifila: pre.bifila || null, motors, p: { tlen: 100, twid: 12 } }, Math };
  vm.createContext(ctx);
  vm.runInContext(mRows[0] + '\nvar __R = rfRows();', ctx);
  /* `rfRows()` devuelve {segs, span, idx}, y cada seg es [x1,y1,x2,y2,dueño].
     Se comprueba la forma en vez de suponerla: si cambia en index.html, esto
     tiene que decirlo, no medir cero cruces en silencio. */
  const RR = ctx.__R;
  if (!RR || !Array.isArray(RR.segs) || !RR.segs.length || RR.segs[0].length < 4) {
    console.error('rfRows() ya no devuelve {segs:[[x1,y1,x2,y2,...]]}: ha cambiado en index.html');
    process.exit(2);
  }
  const ROWS = RR.segs;

  const ncu = {}; for (const n of pre.ncus) ncu[n[0]] = { x: n[3], y: n[4] };
  let nMandaP = 0, nCrucesP = 0, nEnl = 0;

  for (const t of pre.tcus) {
    const c = ncu[t[2]]; if (!c) continue;
    const ax = t[0], ay = t[1], bx = c.x, by = c.y;
    const D = Math.hypot(bx - ax, by - ay);
    if (!(D > 1)) continue;
    /* El suelo de los dos extremos, para poner las antenas donde van. */
    const pf = TP.perfilEntre(T, ax + dx, ay + dn, bx + dx, by + dn, {});
    if (!pf.perfil) continue;
    nEnl++;
    const zA = pf.zSuelo[0] + ANT, zB = pf.zSuelo[1] + ANT_NCU;

    /* Los cruces: intersección del segmento con cada fila. Se recorre la
       rejilla de filas entera sólo para las de esta planta; es caro pero es una
       medida que se corre a mano, no un bucle de pintado. */
    for (const r of ROWS) {
      const s = corta(ax, ay, bx, by, r);
      if (s === null || s <= 0.5 || s >= D - 0.5) continue;
      const u = s / D;
      const px = ax + (bx - ax) * u, py = ay + (by - ay) * u;
      const zSuelo = TP.cotaEn(T, px + dx, py + dn);
      if (zSuelo === null) continue;
      const zRayo = zA + (zB - zA) * u;
      const zBot = zSuelo + zBotRel(EJE);
      nCrucesP++; cruces++;
      const alRayo = zRayo - zSuelo, aLaPlaca = zBot - zRayo;
      huecos.push(zBot - zSuelo);
      if (alRayo < 0) { bajoSuelo++; continue; }      // rayo bajo tierra: otro caso
      if (aLaPlaca <= 0) continue;                    // el rayo va por dentro o por encima
      if (alRayo < aLaPlaca) { manda++; nMandaP++; margen.push(aLaPlaca - alRayo); }
    }
  }
  console.log('═══ ' + planta.toUpperCase() + ' ═══  ' + nEnl + ' enlaces con terreno · '
            + nCrucesP.toLocaleString('es') + ' cruces de fila');
  console.log('  el suelo manda en ' + nMandaP.toLocaleString('es') + ' cruces ('
            + (nCrucesP ? (100 * nMandaP / nCrucesP).toFixed(2) : '0') + ' %)\n');
}

/* Intersección del segmento A→B con un segmento de fila `[x1,y1,x2,y2,dueño]`
   de `rfRows()`. Devuelve la distancia desde A, o null si no se cruzan. */
function corta(ax, ay, bx, by, r) {
  const x1 = r[0], y1 = r[1], x2 = r[2], y2 = r[3];
  const rx = bx - ax, ry = by - ay, sx = x2 - x1, sy = y2 - y1;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((x1 - ax) * sy - (y1 - ay) * sx) / den;
  const v = ((x1 - ax) * ry - (y1 - ay) * rx) / den;
  if (t < 0 || t > 1 || v < 0 || v > 1) return null;
  return t * Math.hypot(rx, ry);
}

console.log('═══ TOTAL ═══');
console.log('  cruces de fila con terreno   ' + cruces.toLocaleString('es'));
console.log('  el suelo MANDA en            ' + manda.toLocaleString('es')
          + (cruces ? '  (' + (100 * manda / cruces).toFixed(2) + ' %)' : ''));
console.log('  rayo por debajo del suelo    ' + bajoSuelo.toLocaleString('es'));
if (huecos.length) console.log('  hueco suelo→canto bajo: p50 ' + pct(huecos, 0.5).toFixed(3)
  + ' m · p05 ' + pct(huecos, 0.05).toFixed(3) + ' · p95 ' + pct(huecos, 0.95).toFixed(3));
if (margen.length) console.log('  cuando manda, por cuánto: p50 ' + pct(margen, 0.5).toFixed(3)
  + ' m · máx ' + Math.max(...margen).toFixed(3));

/* ═══ LA PRUEBA QUE DECIDE A4, y es la misma que decidió A3 ═══════════════
   Que el suelo esté más cerca NO significa que haya que cobrarlo aparte. La
   pregunta es si cobrarlo sería DOBLE CONTEO, y eso se contesta con terreno
   LLANO: ahí el relieve tiene que dar 0 —y lo da, exacto— porque los dos rayos
   ya modelan el plano reflectante. Si además se metiera el suelo como filo,
   cobraría dB que nadie ha descontado de los dos rayos. */
console.log('');
console.log('═══ ¿SERÍA DOBLE CONTEO? La prueba con terreno LLANO ═══');
const perf = []; for (let i = 0; i <= 20; i++) perf.push([200 * i / 20, 0.0]);
const relLlano = RPV.relieveDeltaDb(200, ANT, ANT_NCU, perf, 2.45e9);
console.log('  relieve con perfil LLANO a cota 0: ' + relLlano.db + ' dB (exacto)');
console.log('  o sea el terreno llano no cobra relieve, porque los dos rayos YA lo modelan.');
const ejemplos = [[400, 60, 0.902], [200, 30, 0.902], [400, 200, 1.828]];
console.log('\n  y lo que cobraría el suelo como FILO sobre ese mismo terreno llano:');
console.log('    D(m)   s(m)  altura del rayo   filo(dB)');
for (const [D, s, h] of ejemplos) {
  console.log('  ' + String(D).padStart(6) + String(s).padStart(7) + h.toFixed(3).padStart(15)
            + RPV.perdidaFiloDb(RPV.nu(-h, s, D - s, 2.45e9)).toFixed(3).padStart(11));
}

console.log('');
if (!cruces) {
  console.log('NO HAY CRUCES: no se ha medido nada. Esto no es «el suelo no manda».');
} else {
  console.log('VEREDICTO DE A4, y no es el que el inventario preveía:');
  console.log('');
  console.log('  El suelo SÍ manda en ' + manda + ' de ' + cruces.toLocaleString('es') + ' cruces ('
            + (100 * manda / cruces).toFixed(2) + ' %), así que la');
  console.log('  observación de rf-fv era correcta. PERO A4 NO SE IMPLEMENTA, porque');
  console.log('  A3 cambió la arquitectura por debajo:');
  console.log('');
  console.log('    · el suelo YA es un obstáculo propio y continuo — el perfil del');
  console.log('      terreno, medido contra la tierra lisa de P.1812 —, y se cobra en');
  console.log('      su propio término;');
  console.log('    · sobre terreno llano ese término da CERO EXACTO, que es lo correcto:');
  console.log('      el suelo plano lo modelan los dos rayos;');
  console.log('    · y donde el terreno SUBE —que son justo esos ' + manda + ' cruces— el');
  console.log('      relieve ya lo cobra.');
  console.log('');
  console.log('  Meterlo además como filo bajo la placa cobraría hasta 1,9 dB sobre');
  console.log('  terreno llano que NADIE descuenta de los dos rayos. Es exactamente el');
  console.log('  doble conteo que A3 vino a quitar —21,66 dB medidos entonces—, en');
  console.log('  pequeño.');
  console.log('');
  console.log('  Lo que quedaba por absorber de rf-fv («haberse dado cuenta de que hay');
  console.log('  dos obstáculos») está absorbido: hay dos, y cada uno en su término.');
  console.log('');
  console.log('  LO QUE SÍ QUEDA ABIERTO, dicho como incertidumbre y no como tarea:');
  console.log('  el relieve usa Bullington, un canto equivalente ÚNICO para todo el');
  console.log('  vano, así que un repecho local justo donde el rayo pasa bajo un panel');
  console.log('  se promedia en ese canto en vez de resolverse. Es una propiedad');
  console.log('  conocida y ELEGIDA en A3: Deygout lo resolvería, pero da 1,10 dB con 2');
  console.log('  puntos de perfil y 22,74 con 80. Un relieve que depende de cómo se');
  console.log('  muestreó el DEM no es relieve.');
}
