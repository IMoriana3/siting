/* EL COMPARADOR DE TECNOLOGÍAS SOBRE UNA PLANTA DE VERDAD — punto 6, fase 4.
 *
 * Corre `radio_tecnologias.js` con el motor REAL del `index.html` (extraído a un
 * `vm`, como el resto de útiles de este repo: no hay segunda implementación) y
 * publica la tabla por criterio.
 *
 * LO QUE VA A SALIR, Y CONVIENE SABERLO ANTES DE MIRARLO: de las cuatro
 * tecnologías declaradas, TRES salen apagadas. `zigbee_std_24` no tiene
 * sensibilidad en el código y no se inventa; LoRa y Wi-SUN no tienen NADA de
 * radio porque no se ha podido leer un datasheet. Eso no es un defecto de este
 * útil: es el estado real, y publicarlo es justo el trabajo.
 *
 * Y el criterio que DECIDIRÍA el ranking —la latencia de la orden de stow hasta
 * la última TCU— no sale para ninguna de las cuatro, porque el tiempo por salto
 * no lo ha medido nadie (`FASE3_LATENCIA_STOW.md` §2.3).
 *
 *   node tools/comparador_tecnologias.mjs                 (El Burgo, 3 horas)
 *   node tools/comparador_tecnologias.mjs --planta ayora
 *   node tools/comparador_tecnologias.mjs --horas 6,9,12,15,18
 *
 * rc = 0 medido · 2 no se ha podido medir (NO es un verde)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { cargaApp, hermano, RAIZ } from './_motor_app.mjs';

const require = createRequire(import.meta.url);
const RT = require(path.join(RAIZ, 'radio_tecnologias.js'));

const DIR = hermano();
if (!DIR) { console.log('SIN ALCANCE: no encuentro el repo hermano con los layouts.'); process.exit(2); }

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const PLANTA = arg('planta', 'elburgo');
const HORAS = arg('horas', '8,12,16').split(',').map(Number);
const DIA = [2026, 5, 21];              // solsticio: el día de mayor recorrido
const ALCANCE_M = Number(arg('alcance', '400'));
const PISO_HORAS = 2;                   // comparar a una hora no compara nada
const PISO_NODOS = 50;                  // con menos, la malla no dice nada de una planta

const f = path.join(DIR, PLANTA + '_layout.json');
if (!fs.existsSync(f)) { console.log('SIN ALCANCE: no hay layout de «' + PLANTA + '» en ' + DIR); process.exit(2); }
const L = JSON.parse(fs.readFileSync(f, 'utf8'));
if (!(L.ncus || []).length) { console.log('SIN ALCANCE: «' + PLANTA + '» no declara NCU.'); process.exit(2); }
if (L.clat == null || L.clon == null) { console.log('SIN ALCANCE: «' + PLANTA + '» no trae clat/clon, y sin eso no hay hora solar.'); process.exit(2); }

let ctx, S, rows;
try { ({ ctx, S, rows } = cargaApp(L)); }
catch (e) { console.log('SIN ALCANCE: no carga el motor — ' + e.message); process.exit(2); }

const P = ctx.S._radioParams;
if (!P) { console.log('SIN ALCANCE: el motor no ha cargado radio_params.json.'); process.exit(2); }
const cuerda = (L.bifila && L.bifila.cuerda) || P.geometria.cuerda_m_defecto.valor;
const paso = (L.pitch != null ? L.pitch : P.geometria.pitch_m_defecto.valor);
const gcr = cuerda / paso;

/* ── LOS NODOS ───────────────────────────────────────────────────────────
 * Las NCU son las RAÍCES y salen del layout: este útil NO propone gateways.
 * Las TCU son los seguidores con NCU asignada. */
const nodos = [];
const raices = [];
for (let k = 0; k < L.ncus.length; k++) {
  const nc = L.ncus[k];
  nodos.push({ id: 'NCU' + (k + 1), x: nc.x, y: nc.n, ncu: k + 1, esNcu: true });
  raices.push('NCU' + (k + 1));
}
for (let i = 0; i < S.motors.length; i++) {
  const m = S.motors[i];
  if (!(m.ncu >= 1 && m.ncu <= L.ncus.length)) continue;
  nodos.push({ id: 'T' + i, x: m.x, y: m.y, i: i, ncu: m.ncu, esNcu: false });
}
if (nodos.length < PISO_NODOS) {
  console.log('ALCANCE INSUFICIENTE: ' + nodos.length + ' nodos y el piso son ' + PISO_NODOS + '.');
  process.exit(2);
}

/* ── ENLAZA, CON EL MOTOR DE VERDAD ──────────────────────────────────────
 * Cambiar de tecnología es cambiar `S.rf.variante`: la capa de `radio_zigbee.js`
 * ya apaga lo que no se sabe. Cambiar de hora es mover `S.rf.sol.horaUTC`, y
 * hay que invalidar `_rfRows` o se pintaría con las filas de la hora anterior. */
let llamadas = 0;
function enlazaDe(variante, hora) {
  const clave = Object.keys(P.tecnologias).find(k => P.tecnologias[k] === variante);
  if (!clave) return null;
  S.rf.variante = clave;
  Object.assign(S.rf.sol, { on: true, lat: L.clat, lon: L.clon, gcr: gcr,
                            horaUTC: Date.UTC(DIA[0], DIA[1], DIA[2], hora, 0) });
  ctx.S._rfRows = null;
  return function (a, b) {
    llamadas++;
    const r = ctx.rfEnlace({ x: a.x, y: a.y, i: a.i }, { x: b.x, y: b.y, i: b.i }, rows);
    if (!r || r.margenDb == null) return { viable: null, margenDb: null };
    return { viable: r.margenDb > 0, margenDb: r.margenDb };
  };
}

const variantes = {};
for (const k of Object.keys(P.tecnologias)) if (k[0] !== '_') variantes[k] = P.tecnologias[k];

console.log('COMPARADOR DE TECNOLOGÍAS · ' + PLANTA.toUpperCase());
console.log('  ' + (nodos.length - raices.length) + ' TCU · ' + raices.length + ' NCU del layout · ' +
            'horas UTC ' + HORAS.join(', ') + ' del ' + DIA[0] + '-' +
            String(DIA[1] + 1).padStart(2, '0') + '-' + DIA[2] + ' · poda a ' + ALCANCE_M + ' m');
console.log('  GCR ' + gcr.toFixed(3) + ' (cuerda ' + cuerda + ' / paso ' + paso + ')\n');

if (HORAS.length < PISO_HORAS) {
  console.log('ALCANCE INSUFICIENTE: ' + HORAS.length + ' hora(s) y el piso son ' + PISO_HORAS + '.');
  process.exit(2);
}

const t0 = Date.now();
let tabla;
try { tabla = RT.compara(PLANTA, nodos, raices, variantes, HORAS, enlazaDe, ALCANCE_M); }
catch (e) { console.log('SIN ALCANCE: ' + e.message); process.exit(2); }
const seg = ((Date.now() - t0) / 1000).toFixed(1);

/* ── LA TABLA ───────────────────────────────────────────────────────────── */
const tecs = tabla.tecnologias;
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const pd = (s, n) => String(s).padStart(n).slice(-n);

function texto(c) {
  if (!c) return '—';
  if (c.min == null) return 'no se puede';
  if (c.min === c.max) return String(c.min);
  return c.min + '–' + c.max;
}

console.log(pad('criterio', 42) + tecs.map(t => pd(t.slice(0, 13), 15)).join('') + '   veredicto');
console.log('─'.repeat(42 + 15 * tecs.length + 3 + 40));
for (const fila of tabla.filas) {
  console.log(pad(fila.rotulo, 42) + tecs.map(t => pd(texto(fila.celdas[t]), 15)).join('') +
              '   ' + fila.veredicto.texto);
}

console.log('\n── POR QUÉ NO SE PUEDE, DONDE NO SE PUEDE ──\n');
const dichos = new Set();
for (const fila of tabla.filas) {
  for (const t of tecs) {
    const c = fila.celdas[t];
    if (!c || c.min != null || !c.motivo) continue;
    const k = t + '|' + c.motivo;
    if (dichos.has(k)) continue;
    dichos.add(k);
    console.log('  ' + pad(t, 16) + c.motivo);
  }
}

console.log('\n── LO QUE VARÍA CON LA HORA, QUE ES EL MOTIVO DE MIRAR VARIAS ──\n');
for (const fila of tabla.filas) {
  for (const t of tecs) {
    const c = fila.celdas[t];
    if (c && c.min != null && c.min !== c.max) {
      console.log('  ' + pad(fila.rotulo, 42) + pad(t, 16) + c.min + ' a ' + c.max + ' ' + (c.unidad || ''));
    }
  }
}
const vivas = tecs.filter(t => tabla.filas.some(f => f.celdas[t] && f.celdas[t].min != null &&
                                                    f.criterio !== 'ncu_necesarias'));
if (!vivas.length) console.log('  (ninguna tecnología tiene bastante parámetro para variar)');
else {
  const mueve = tabla.filas.some(f => tecs.some(t => f.celdas[t] && f.celdas[t].min != null &&
                                                     f.celdas[t].min !== f.celdas[t].max));
  if (!mueve) console.log('  NADA. Y eso también es un resultado — ver abajo.');
}

/* ── EL RESULTADO DEMASIADO BUENO, MIRADO ANTES DE PUBLICARLO ─────────────
 * Un 215 de 215 y un «0 sin camino alternativo» son demasiado redondos para
 * dejarlos pasar. Hay que decir de qué están hechos, porque el denominador y la
 * población no son los que el rótulo sugiere. */
if (tabla.saturacion) {
  console.log('\n── LA HORA, Y POR QUÉ ESTA TABLA NO SE ENTERA ──\n');
  if (tabla.saturacion.saturada) console.log('  LA HORA NO MUEVE ESTA TABLA — Y ESO NO ES QUE LA HORA DÉ IGUAL.\n');
  console.log('  ' + tabla.saturacion.texto.replace(/(.{76}\s)/g, '$1\n  '));
}

console.log('\n── QUÉ SIGNIFICAN ESTOS NÚMEROS, Y QUÉ NO ──\n');

/* 1 · el margen del PEOR enlace de la malla. Si es enorme, el resultado no dice
 *     «esta planta está cubierta con holgura razonable»: dice «con umbral en la
 *     sensibilidad pelada, aquí enlaza casi todo con todo». */
const peorPorHora = [];
for (const h of HORAS) {
  const e = enlazaDe(variantes[tecs[0]], h);
  if (!e) break;
  let peor = Infinity, mejor = -Infinity, viables = 0, mirados = 0;
  const tcus = nodos.filter(n => !n.esNcu);
  for (let i = 0; i < tcus.length; i++) {
    for (let j = i + 1; j < tcus.length; j++) {
      const dx = tcus[i].x - tcus[j].x, dy = tcus[i].y - tcus[j].y;
      if (dx * dx + dy * dy > ALCANCE_M * ALCANCE_M) continue;
      const r = e(tcus[i], tcus[j]);
      if (r.margenDb == null) continue;
      mirados++;
      if (r.viable) { viables++; if (r.margenDb < peor) peor = r.margenDb; }
      if (r.margenDb > mejor) mejor = r.margenDb;
    }
  }
  peorPorHora.push({ h, peor, mejor, viables, mirados });
}
for (const p of peorPorHora) {
  console.log('  ' + String(p.h).padStart(2, '0') + ':00 UTC · ' +
              p.viables.toLocaleString('es') + ' de ' + p.mirados.toLocaleString('es') +
              ' pares enlazan (' + (100 * p.viables / p.mirados).toFixed(1) + ' %) · ' +
              'margen del peor que enlaza ' + (isFinite(p.peor) ? p.peor.toFixed(1) : '—') + ' dB');
}
/* LA HORA SÍ MUEVE ENLACES. Lo que no mueve son los criterios de la tabla, y
   son dos cosas distintas: este bloque estuvo a punto de publicarse diciendo
   «con márgenes así la hora no cambia quién enlaza con quién», y la medida de
   arriba lo desmiente. La cuenta de pares viables cambia; la tabla no, porque
   estos criterios están SATURADOS. Decirlo mal habría escondido justo lo que el
   punto 6 quería ver. */
const vmin = Math.min.apply(null, peorPorHora.map(p => p.viables));
const vmax = Math.max.apply(null, peorPorHora.map(p => p.viables));
console.log('\n  El umbral es `margen > 0`: la SENSIBILIDAD PELADA, sin reserva de');
console.log('  desvanecimiento. Entre la mejor y la peor hora entran y salen ' +
            (vmax - vmin).toLocaleString('es') + ' pares');
console.log('  (' + (100 * (vmax - vmin) / vmax).toFixed(1) + ' % de los viables): LA HORA SÍ MUEVE ENLACES.');
console.log('\n  Lo que NO mueve es esta tabla, y es otra cosa: con ~' +
            Math.round(vmin / 1000) + '.000 enlaces viables sobre');
console.log('  ' + (nodos.length - raices.length) + ' TCU el grafo sigue siendo denso a cualquier hora, así que la cobertura');
console.log('  y los saltos están SATURADOS y no se enteran. O sea que aquí comparar a una');
console.log('  sola hora habría dado la misma tabla — pero no porque la hora dé igual, sino');
console.log('  porque estos criterios no distinguen. En una tecnología con menos margen, o');
console.log('  en una planta más larga, el mismo vaivén sí cambiaría la cobertura.');

console.log('\n  Y LOS SALTOS NO SON LOS DE LA MALLA REAL. Aquí se cuenta el camino MÁS');
console.log('  CORTO sobre TODOS los enlaces viables: es una COTA INFERIOR de la');
console.log('  profundidad, no la que elige el protocolo. Medido en El Burgo sobre la');
console.log('  malla de verdad (`Cobertura-Zigbee/elburgo_real.geojson`, 52 nodos de la');
console.log('  NCU 1): p50 = 4 saltos, p95 = 5, p100 = 6. Esta tabla da menos porque');
console.log('  Zigbee no enruta por el camino más corto, y porque un enlace «viable» a');
console.log('  0 dB de margen no es un enlace que la malla vaya a USAR.');
console.log('\n  Lo mismo vale para «sin camino alternativo»: sobre un grafo casi completo');
console.log('  no hay articulaciones, y eso dice que la REDUNDANCIA POTENCIAL es alta, no');
console.log('  que la malla desplegada sea redundante. Los dos números miden lo que el');
console.log('  campo PERMITE, no lo que el protocolo HACE.');

/* ── ¿CAMBIA EL VEREDICTO SEGÚN EL MÓDULO QUE SE MONTE? ──────────────────── */
console.log('\n── LA SENSIBILIDAD DEL VEREDICTO AL MÓDULO ──\n');
const candidatos = {};
for (const t of tecs) {
  const cb = P.tecnologias[t].candidatos || {};
  const c = (cb.variantes_calculables && cb.variantes_calculables.length)
    ? cb.variantes_calculables : (cb.lista || []);
  candidatos[t] = c.length ? c.map(m => Object.assign({}, P.tecnologias[t], m)) : [P.tecnologias[t]];
}
const sens = RT.sensibilidadAlModulo(PLANTA, nodos, raices, candidatos, HORAS, enlazaDe, ALCANCE_M);
if (!sens.medible) {
  console.log('  NO SE PUEDE MEDIR: ' + sens.motivo);
  console.log('\n  Hacen falta AL MENOS DOS variantes calculables por tecnología, con Ptx,');
  console.log('  sensibilidad por modo y antena de referencia CITADAS. El plan de canal,');
  console.log('  duty-cycle y certificación siguen siendo criterios aparte y no se inventan.');
} else {
  for (const f of sens.filas) {
    console.log('  ' + pad(f.rotulo, 42) + (f.cambia ? 'CAMBIA' : 'igual ') +
                '  mejor: ' + f.conElMejor + '  /  peor: ' + f.conElPeor);
  }
  console.log('\n  ' + (sens.cambiaAlguno
    ? 'EL VEREDICTO DEPENDE DEL MÓDULO. Eso ES el resultado: no hay un «gana X».'
    : 'El veredicto no cambia entre el mejor y el peor candidato de cada tecnología.'));
  console.log('  ' + sens._orden);
}

console.log('\nalcance: ' + tabla.filas.length + ' criterios · ' + tecs.length + ' tecnologías · ' +
            HORAS.length + ' horas (piso ' + PISO_HORAS + ') · ' +
            (nodos.length - raices.length) + ' TCU (piso ' + PISO_NODOS + ') · ' +
            llamadas.toLocaleString('es') + ' enlaces evaluados en ' + seg + ' s');
console.log('NO hay puntuación agregada, a propósito: la tabla es el resultado.');
