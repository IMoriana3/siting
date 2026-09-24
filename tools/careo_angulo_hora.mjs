/* EL ÁNGULO POR SEGUIDOR Y POR HORA, CONTRA EL TILT FIJO — cuánto mueve.
 *
 * ═══ QUÉ SE COMPARA ═══
 *
 *   ANTES   `rfAngulo(i)` devolvía `rfTilt()`: el deslizador, el MISMO para
 *           todos los seguidores y a todas las horas. 30° por defecto.
 *   AHORA   el ángulo sale de `lib/sol.js` —posición NOAA del sol y el
 *           `singleaxis` de pvlib con backtracking por GCR— para la hora
 *           pedida y con el eje de CADA seguidor.
 *
 * El ángulo entra en el margen por dos sitios, y por eso mueve más de lo que
 * parece: fija la ALTURA DE ANTENA de cada extremo —la antena cuelga del tubo y
 * gira con él— y fija el CANTO por el que difracta cada fila que el enlace
 * cruza. No es un parámetro cosmético.
 *
 * ═══ LO QUE «POR SEGUIDOR» VALE HOY, Y ESTÁ MEDIDO ═══
 *
 * En las DOCE plantas del repo hermano todos los seguidores tienen la MISMA
 * rotación de eje. Como `singleaxis` depende del azimut del eje y de la
 * posición del sol —que sobre 500 m no cambia—, hoy el ángulo sale idéntico
 * para todos: el efecto entero está en la mitad POR HORA. El índice se pasa de
 * verdad igualmente, para el día que llegue una planta con bloques girados
 * distinto. Se dice para que nadie lo lea como un olvido.
 *
 * ═══ EL EMPAREJAMIENTO ═══
 *
 * Cada seguidor con la NCU que su layout le pone, `ncus[t.ncu - 1]`. El layout
 * no declara esa convención; se comprobó por geometría (ver
 * `careo_motores_mapa.mjs`, que publica el careo con «la NCU más cercana»).
 *
 *   node tools/careo_angulo_hora.mjs
 *   node tools/careo_angulo_hora.mjs --planta elburgo   (esa sola, hora a hora)
 *
 * rc = 0 medido · 2 no se ha podido medir (no es un verde)
 */
import fs from 'node:fs';
import path from 'node:path';
import { cargaApp, hermano } from './_motor_app.mjs';

const DIR = hermano();
if (!DIR) { console.log('SIN ALCANCE: no encuentro el repo hermano con los layouts.'); process.exit(2); }

const PISO_PLANTAS = 8;              // MEDIDO: 10 de 12 declaran NCU
const HORAS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const DIA = [2026, 5, 21];           // solsticio de verano: el día de mayor recorrido
const TILT_FIJO = 30;                // lo que el deslizador trae por defecto

const iP = process.argv.indexOf('--planta');
const SOLA = iP >= 0 ? process.argv[iP + 1] : null;

const pad = (s, n) => String(s).padEnd(n), pd = (s, n) => String(s).padStart(n);
const q = (a, x) => a.length ? [...a].sort((u, v) => u - v)[Math.min(a.length - 1, Math.floor(x * a.length))] : null;

console.log('EL ÁNGULO POR SEGUIDOR Y POR HORA, CONTRA EL TILT FIJO DE ' + TILT_FIJO + '°');
console.log('día: ' + DIA[0] + '-' + String(DIA[1] + 1).padStart(2, '0') + '-' + DIA[2] +
            ' (solsticio de verano, el de mayor recorrido del seguidor)\n');

const layouts = fs.readdirSync(DIR).filter(f => /_layout\.json$/.test(f)).sort();
let conNcu = 0, sinNcu = [], sinGeo = [];
const porPlanta = [];

for (const f of layouts) {
  const planta = f.replace('_layout.json', '');
  if (SOLA && planta !== SOLA) continue;
  const L = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!(L.ncus || []).length) { sinNcu.push(planta); continue; }
  if (L.clat == null || L.clon == null) { sinGeo.push(planta); continue; }
  conNcu++;
  let ctx, S, rows;
  try { ({ ctx, S, rows } = cargaApp(L)); } catch (e) { console.log('  ' + planta + ': no carga — ' + e.message); continue; }

  /* EL GCR SALE DE LA GEOMETRÍA DE LA PLANTA, no de un valor cómodo: cuerda
     entre paso. Si el layout no los trae, se usan los defectos del JSON de
     parámetros y SE DICE. */
  const P = ctx.S._radioParams;
  const cuerda = (L.bifila && L.bifila.cuerda) || (P.geometria.cuerda_m_defecto.valor);
  const paso = (L.pitch != null ? L.pitch : P.geometria.pitch_m_defecto.valor);
  const gcr = cuerda / paso;

  const pares = [];
  for (let i = 0; i < S.motors.length; i++) {
    const m = S.motors[i], k = m.ncu;
    if (!(k >= 1 && k <= L.ncus.length)) continue;
    const nc = L.ncus[k - 1];
    pares.push([i, { x: nc.x, y: nc.n }, { x: m.x, y: m.y, i: i }]);
  }
  if (!pares.length) continue;

  /* ANTES: el tilt fijo. */
  S.rf.sol.on = false;
  ctx.S._rfRows = null;
  const antes = new Map();
  for (const [i, a, b] of pares) {
    const r = ctx.rfEnlace(a, b, rows);
    antes.set(i, r.margenDb);
  }

  const filas = [];
  for (const h of HORAS) {
    Object.assign(S.rf.sol, { on: true, lat: L.clat, lon: L.clon, gcr: gcr,
                              horaUTC: Date.UTC(DIA[0], DIA[1], DIA[2], h, 0) });
    ctx.S._rfRows = null;
    const d = [];
    let ang = null, sinSol = 0;
    for (const [i, a, b] of pares) {
      const r = ctx.rfEnlace(a, b, rows);
      if (ang === null) ang = ctx.rfAngulo(i);
      if ((r.motivos || []).some(x => x === 'angulo_sol_bajo_el_horizonte')) sinSol++;
      const v = antes.get(i);
      if (v == null || r.margenDb == null) continue;
      d.push(r.margenDb - v);
    }
    /* LA ELEVACIÓN, para saber cuál es el MEDIODÍA SOLAR de ESTA planta, y si
       el backtracking está corrigiendo a esta hora. Sin esto, «las 12:00» no
       significa lo mismo en El Burgo que en San José. */
    const ps = ctx.Sol.solarPos(S.rf.sol.horaUTC, L.clat, L.clon);
    const zz = 90 - ps.elev;
    const aPuro = ctx.Sol.singleaxis(zz, ps.az, { axisTilt: 0, axisAz: (S.motors[0] && S.motors[0].az) || 0, maxAngle: 60 });
    const aBt = ctx.Sol.singleaxis(zz, ps.az, { axisTilt: 0, axisAz: (S.motors[0] && S.motors[0].az) || 0,
                                                backtrack: true, gcr: gcr, maxAngle: 60 });
    filas.push({ h, ang, n: d.length, sinSol, elev: ps.elev,
                 corrBt: (isFinite(aPuro) && isFinite(aBt)) ? (aBt - aPuro) : 0,
                 p50: q(d, 0.5), p95: q(d, 0.95), min: d.length ? Math.min(...d) : null,
                 max: d.length ? Math.max(...d) : null });
  }
  porPlanta.push({ planta, gcr, n: pares.length, filas });
}

console.log('alcance: ' + conNcu + ' plantas de ' + layouts.length + ' con layout (piso ' + PISO_PLANTAS + ')');
if (sinNcu.length) console.log('  FUERA, sin NCU declarada: ' + sinNcu.join(', '));
if (sinGeo.length) console.log('  FUERA, sin coordenadas (`clat`/`clon`): ' + sinGeo.join(', '));
if (!SOLA && conNcu < PISO_PLANTAS) {
  console.log('\nALCANCE INSUFICIENTE: ' + conNcu + ' plantas y el piso son ' + PISO_PLANTAS + '.');
  process.exit(2);
}

if (SOLA) {
  const p = porPlanta[0];
  if (!p) { console.log('SIN ALCANCE: «' + SOLA + '» no se ha podido medir.'); process.exit(2); }
  console.log('\n── ' + SOLA.toUpperCase() + ', HORA A HORA · ' + p.n + ' enlaces · GCR ' + p.gcr.toFixed(3) + ' ──\n');
  console.log(pad('UTC', 7) + pd('ángulo', 9) + pd('enlaces', 9) + pd('p50 Δ', 9) +
              pd('p95 Δ', 9) + pd('mín Δ', 9) + pd('máx Δ', 9));
  for (const f of p.filas) {
    if (f.sinSol) { console.log(pad(f.h + ':00', 7) + pd('—', 9) + '  (sol bajo el horizonte: se cae al deslizador, con motivo)'); continue; }
    console.log(pad(f.h + ':00', 7) + pd(f.ang == null ? '—' : f.ang.toFixed(1) + '°', 9) + pd(f.n, 9) +
      pd(f.p50 == null ? '—' : f.p50.toFixed(2), 9) + pd(f.p95 == null ? '—' : f.p95.toFixed(2), 9) +
      pd(f.min == null ? '—' : f.min.toFixed(2), 9) + pd(f.max == null ? '—' : f.max.toFixed(2), 9));
  }
  console.log('\nΔ = margen con el ángulo del sol − margen con el tilt fijo de ' + TILT_FIJO + '°, en dB.');
  process.exit(0);
}

console.log('\n── POR PLANTA: cuánto mueve, sobre todas las horas con sol ──\n');
console.log(pad('planta', 12) + pd('enlaces', 9) + pd('GCR', 7) + pd('p50 |Δ|', 10) +
            pd('p95 |Δ|', 10) + pd('máx |Δ|', 10) + pd('hora del máx', 14));
for (const p of porPlanta) {
  const vivas = p.filas.filter(f => !f.sinSol && f.p50 != null);
  if (!vivas.length) { console.log(pad(p.planta, 12) + '  (sin horas con sol)'); continue; }
  const abs = vivas.map(f => Math.max(Math.abs(f.min), Math.abs(f.max)));
  const peor = vivas[abs.indexOf(Math.max(...abs))];
  const p50s = vivas.map(f => Math.abs(f.p50));
  console.log(pad(p.planta, 12) + pd(p.n, 9) + pd(p.gcr.toFixed(3), 7) +
    pd(q(p50s, 0.5).toFixed(2), 10) + pd(q(p50s, 0.95).toFixed(2), 10) +
    pd(Math.max(...abs).toFixed(2), 10) + pd(peor.h + ':00 (' + (peor.ang == null ? '—' : peor.ang.toFixed(0) + '°') + ')', 14));
}

/* ── EL CONTRASTE QUE PIDE EL PUNTO 6 ─────────────────────────────────────
   Mediodía contra las horas en que el backtracking corrige de verdad.

   Y EL MEDIODÍA ES EL SOLAR DE CADA PLANTA, NO LAS 12:00 UTC. La primera
   versión de esta tabla usaba las 12:00 UTC para todas, y eso es un número
   correcto sobre una población mal etiquetada: San José está a −71,8° de
   longitud, así que a las 12:00 UTC es MAÑANA allí y su seguidor va a 51°. La
   tabla daba ×0,9 para esa planta —o sea «a mediodía mueve menos que en el
   borde»— y lo que decía en realidad era que ahí no era mediodía.

   Así que el mediodía se busca: la hora de MAYOR ELEVACIÓN de las barridas. Y
   las horas de backtracking tampoco se suponen: son aquellas en las que el
   ángulo corregido difiere del seguimiento puro, medido hora a hora. */
console.log('\n── EL CONTRASTE: mediodía SOLAR de cada planta contra las horas en que el');
console.log('   backtracking corrige de verdad ──\n');
console.log(pad('planta', 12) + pd('mediodía', 22) + pd('p50 Δ', 9) +
            pd('backtracking', 24) + pd('p50 Δ', 9) + pd('razón', 8));
for (const p of porPlanta) {
  const vivas = p.filas.filter(f => !f.sinSol && f.p50 != null);
  if (!vivas.length) { console.log(pad(p.planta, 12) + '  (sin horas con sol)'); continue; }
  const med = vivas.reduce((a, b) => (b.elev > a.elev ? b : a));
  const bt = vivas.filter(f => Math.abs(f.corrBt) > 0.01);
  if (!bt.length) {
    console.log(pad(p.planta, 12) + pd(med.h + ':00 (' + med.ang.toFixed(0) + '°, el ' + med.elev.toFixed(0) + '°)', 22) +
      pd(med.p50.toFixed(2), 9) + pd('NINGUNA en el barrido', 24) + pd('—', 9) + pd('—', 8));
    continue;
  }
  const b = bt.reduce((x, y) => (Math.abs(y.corrBt) > Math.abs(x.corrBt) ? y : x));
  const r = (Math.abs(b.p50) > 1e-9) ? Math.abs(med.p50 / b.p50) : null;
  console.log(pad(p.planta, 12) + pd(med.h + ':00 (' + med.ang.toFixed(0) + '°, el ' + med.elev.toFixed(0) + '°)', 22) +
    pd(med.p50.toFixed(2), 9) +
    pd(b.h + ':00 (' + b.ang.toFixed(0) + '°, corr ' + b.corrBt.toFixed(0) + '°)', 24) +
    pd(b.p50.toFixed(2), 9) + pd(r == null ? '—' : 'x' + r.toFixed(1), 8));
}
console.log('\nΔ = margen con el ángulo del sol − margen con el tilt fijo de ' + TILT_FIJO + '°, en dB.');
console.log('El ángulo entra por DOS sitios: la altura de antena de cada extremo y el');
console.log('canto por el que difracta cada fila cruzada. No es cosmético.');
