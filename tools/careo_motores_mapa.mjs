/* QUÉ SE HA ESTADO VIENDO EN EL MAPA — el motor antiguo contra el nuevo.
 *
 * ═══ POR QUÉ EXISTE ═══
 *
 * Hasta el 2026-09-24 el bucle de dibujado de `index.html` pintaba los puntos
 * TCU con `rfMargin(...)` DIRECTAMENTE: el modelo CONGELADO, el que lleva
 * `EL_BURGO_BIAS_DB` dentro. Se saltaba `rfMargenDe`, que es la puerta única y
 * la que elige motor. El panel de perfil sí pasaba por la puerta. O sea que el
 * color del punto y el número del panel podían venir de dos motores distintos
 * en el mismo enlace.
 *
 * Ya está arreglado. Esto NO arregla nada: MIDE cuánto se separaban, para
 * saber qué hay que volver a mirar de lo que se miró estos días.
 *
 * ═══ CÓMO ═══
 *
 * Se llama a los dos motores EXACTAMENTE como los llamaba el bucle de
 * dibujado: `n` es la NCU declarada del layout y `m` el punto de la TCU, los
 * dos tal cual, sin `antenaM` ni índice de seguidor — porque eso es lo que el
 * dibujado les pasaba. Reconstruir una llamada «mejor» mediría otra cosa.
 *
 *     viejo   rfMargin(n, m, rows)      → ZigbeePV.defaultParamsElBurgo()
 *     nuevo   rfEnlace(n, m, rows)      → RadioZigbee.presupuesto()
 *
 * El bloque RF sale del `index.html` REAL por `_motor_app.mjs`, como el resto
 * de los útiles: reimplementarlo aquí mediría mi opinión sobre el motor.
 *
 * ═══ EL EMPAREJAMIENTO, Y POR QUÉ NO SE EMPAREJA POR CERCANÍA ═══
 *
 * Cada seguidor va con la NCU que SU PROPIO LAYOUT le pone: `ncus[t.ncu - 1]`.
 * Emparejar por cercanía sería inventar el reparto —y además mediría otra cosa,
 * porque un reparto real manda seguidores a una NCU que no es la más próxima
 * cuando la de al lado está llena—.
 *
 * `t.gw` NO SIRVE PARA ESTO, aunque lo parezca: en el layout es un NÚMERO de
 * gateway (1, 2, 3...), no la cadena «NCU1-GW2» que trae la malla MEDIDA de El
 * Burgo. Usar `ncuDeLayout(layout, t.gw)` dejaba 5.976 seguidores sin
 * emparejar y la tabla salía de 3 plantas mientras el alcance decía 10.
 *
 * Y EL LAYOUT NO DECLARA QUÉ ES `t.ncu`: no hay bloque de numeración que lo
 * diga. Así que no se supone, SE COMPRUEBA por geometría, y el resultado va
 * publicado abajo con el informe. Medido el 2026-09-24 sobre las diez plantas:
 * bajo la hipótesis del índice, el p50 de la distancia seguidor→NCU coincide
 * con el de «la NCU más cercana» (Ayora 119,6 contra 118,3 m · San José 159,1
 * contra 150,2) y el emparejamiento cae en la más cercana entre el 79 % y el
 * 100 % de las veces. Un índice equivocado daría cientos de metros y ~0 %. El
 * 6-21 % que no es la más cercana es lo que hace un reparto con capacidad: son
 * evidencia A FAVOR, no en contra.
 *
 * Dos plantas (catania, dicayagua) no declaran NCU ninguna y quedan fuera — se
 * DICE, con su recuento, en vez de barrerse.
 *
 *   node tools/careo_motores_mapa.mjs
 *
 * rc = 0 medido · 2 no se ha podido medir (no es un verde)
 */
import fs from 'node:fs';
import path from 'node:path';
import { cargaApp, hermano } from './_motor_app.mjs';

const DIR = hermano();
if (!DIR) { console.log('SIN ALCANCE: no encuentro el repo hermano con los layouts.'); process.exit(2); }

const PISO_PLANTAS = 8;   // MEDIDO el 2026-09-24: 10 plantas declaran NCU de 12
const BANDAS = [[0, 25], [25, 50], [50, 75], [75, 100], [100, 150], [150, 250], [250, 1e9]];
const UMBRAL_ANILLA = 8;  // el mismo con el que el mapa anillaba «sin enlace»

const layouts = fs.readdirSync(DIR).filter(f => /_layout\.json$/.test(f)).sort();
if (!layouts.length) { console.log('SIN ALCANCE: no hay layouts en ' + DIR); process.exit(2); }

const pad = (s, n) => String(s).padEnd(n), pd = (s, n) => String(s).padStart(n);
const cuantil = (a, q) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };

console.log('QUÉ SE HA ESTADO VIENDO EN EL MAPA');
console.log('el color del punto TCU lo daba `rfMargin` (modelo CONGELADO, con el sesgo de');
console.log('El Burgo de −33,6 dB dentro) mientras el panel usaba el motor nuevo.\n');

const todo = [];
let conNcu = 0, sinNcu = [], sinGw = 0;
for (const f of layouts) {
  const planta = f.replace('_layout.json', '');
  const layout = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  if (!(layout.ncus || []).length) { sinNcu.push(planta); continue; }
  conNcu++;
  let ctx, S, rows;
  try { ({ ctx, S, rows } = cargaApp(layout)); }
  catch (e) { console.log('  ' + planta + ': no carga — ' + e.message); continue; }
  for (let i = 0; i < S.motors.length; i++) {
    const m = S.motors[i];
    const k = m.ncu;
    const nc = (k != null && k >= 1 && k <= layout.ncus.length) ? layout.ncus[k - 1] : null;
    if (!nc) { sinGw++; continue; }
    const n = { x: nc.x, y: nc.n };            // tal cual lo pasaba el dibujado
    const p = { x: m.x, y: m.y };
    const viejo = ctx.rfMargin(n, p, rows);
    const nuevo = ctx.rfEnlace(n, p, rows).margenDb;
    todo.push({ planta, D: Math.hypot(p.x - n.x, p.y - n.y), viejo, nuevo });
  }
}

console.log('alcance: ' + conNcu + ' plantas con NCU declarada de ' + layouts.length +
            ' con layout (piso ' + PISO_PLANTAS + ') · ' + todo.length + ' enlaces');
if (sinNcu.length) console.log('  FUERA, por no declarar NCU en su layout: ' + sinNcu.join(', '));
if (sinGw) console.log('  ' + sinGw + ' seguidores cuyo `ncu` no cae en el rango de las declaradas');
console.log('  emparejados por `ncus[t.ncu - 1]`: el layout NO declara la convención, se');
console.log('  confirma por geometría (ver la cabecera de este fichero).');
if (conNcu < PISO_PLANTAS) {
  console.log('\nALCANCE INSUFICIENTE: ' + conNcu + ' plantas y el piso son ' + PISO_PLANTAS + '.');
  console.log('No se ha mirado bastante. Esto no es un verde.');
  process.exit(2);
}

/* LOS QUE EL MOTOR NUEVO NO EVALÚA. El viejo SIEMPRE da un número, así que
   donde el nuevo dice «no lo sé» el mapa estaba enseñando un dB igualmente. */
const mudos = todo.filter(x => x.nuevo == null);
const pares = todo.filter(x => x.nuevo != null && x.viejo != null);

console.log('\n── LA DIFERENCIA, POR BANDA DE DISTANCIA ──');
console.log('viejo − nuevo, en dB:  NEGATIVO = el mapa pintaba MENOS margen del que da el');
console.log('motor nuevo, o sea que era PESIMISTA. (El modelo congelado lleva dentro');
console.log('EL_BURGO_BIAS_DB = −33,6 dB, así que el signo es el esperado.)\n');
console.log(pad('banda (m)', 12) + pd('enlaces', 9) + pd('p50', 9) + pd('p95', 9) +
            pd('mín', 9) + pd('máx', 9) + pd('cambia color', 14) + pd('cruza 8 dB', 12));
for (const [a, b] of BANDAS) {
  const s = pares.filter(x => x.D >= a && x.D < b);
  if (!s.length) continue;
  const d = s.map(x => x.viejo - x.nuevo);
  const banda = v => v < 0 ? 0 : v < 8 ? 1 : v < 16 ? 2 : v < 25 ? 3 : 4;
  const cambia = s.filter(x => banda(x.viejo) !== banda(x.nuevo)).length;
  const cruza = s.filter(x => (x.viejo < UMBRAL_ANILLA) !== (x.nuevo < UMBRAL_ANILLA)).length;
  console.log(pad((b > 1e8 ? a + '+' : a + '–' + b), 12) + pd(s.length, 9) +
    pd(cuantil(d, 0.5).toFixed(1), 9) + pd(cuantil(d, 0.95).toFixed(1), 9) +
    pd(Math.min(...d).toFixed(1), 9) + pd(Math.max(...d).toFixed(1), 9) +
    pd(cambia + ' (' + (100 * cambia / s.length).toFixed(0) + ' %)', 14) +
    pd(cruza + ' (' + (100 * cruza / s.length).toFixed(0) + ' %)', 12));
}

const dAll = pares.map(x => x.viejo - x.nuevo);
const bandaG = v => v < 0 ? 0 : v < 8 ? 1 : v < 16 ? 2 : v < 25 ? 3 : 4;
const cambiaT = pares.filter(x => bandaG(x.viejo) !== bandaG(x.nuevo)).length;
const cruzaT = pares.filter(x => (x.viejo < UMBRAL_ANILLA) !== (x.nuevo < UMBRAL_ANILLA)).length;
console.log('\n' + pad('TODAS', 12) + pd(pares.length, 9) +
  pd(cuantil(dAll, 0.5).toFixed(1), 9) + pd(cuantil(dAll, 0.95).toFixed(1), 9) +
  pd(Math.min(...dAll).toFixed(1), 9) + pd(Math.max(...dAll).toFixed(1), 9) +
  pd(cambiaT + ' (' + (100 * cambiaT / pares.length).toFixed(0) + ' %)', 14) +
  pd(cruzaT + ' (' + (100 * cruzaT / pares.length).toFixed(0) + ' %)', 12));

console.log('\n── POR PLANTA ──\n');
console.log(pad('planta', 12) + pd('enlaces', 9) + pd('p50', 9) + pd('p95', 9) + pd('cambia color', 14) + pd('cruza 8 dB', 12));
for (const planta of [...new Set(pares.map(x => x.planta))]) {
  const s = pares.filter(x => x.planta === planta);
  const d = s.map(x => x.viejo - x.nuevo);
  const cambia = s.filter(x => bandaG(x.viejo) !== bandaG(x.nuevo)).length;
  const cruza = s.filter(x => (x.viejo < UMBRAL_ANILLA) !== (x.nuevo < UMBRAL_ANILLA)).length;
  console.log(pad(planta, 12) + pd(s.length, 9) + pd(cuantil(d, 0.5).toFixed(1), 9) +
    pd(cuantil(d, 0.95).toFixed(1), 9) +
    pd(cambia + ' (' + (100 * cambia / s.length).toFixed(0) + ' %)', 14) +
    pd(cruza + ' (' + (100 * cruza / s.length).toFixed(0) + ' %)', 12));
}

if (mudos.length) {
  console.log('\n── Y LOS QUE EL MOTOR NUEVO NO EVALÚA ──');
  console.log(mudos.length + ' de ' + todo.length + ' enlaces (' +
              (100 * mudos.length / todo.length).toFixed(1) + ' %) salen SIN MARGEN con el motor');
  console.log('nuevo, y el mapa les estaba pintando el dB del viejo igualmente: un número');
  console.log('donde la respuesta honrada es «no lo sé».');
}

/* LOS EXTREMOS, APARTE Y CON NOMBRE. Un p50 de 20 dB no dice que haya plantas
   donde el motor viejo se descuelga del todo, y las hay. */
const gordos = pares.filter(x => Math.abs(x.viejo - x.nuevo) > 60);
if (gordos.length) {
  const porPl = {};
  for (const g of gordos) porPl[g.planta] = (porPl[g.planta] || 0) + 1;
  console.log('\n── DONDE EL MOTOR VIEJO SE DESCUELGA DEL TODO ──');
  console.log(gordos.length + ' de ' + pares.length + ' enlaces (' +
              (100 * gordos.length / pares.length).toFixed(2) + ' %) con más de 60 dB de diferencia:');
  for (const k of Object.keys(porPl)) {
    const tot = pares.filter(x => x.planta === k).length;
    console.log('  ' + pad(k, 12) + porPl[k] + ' de ' + tot + ' (' +
                (100 * porPl[k] / tot).toFixed(0) + ' % de la planta)');
  }
  const peor = gordos.sort((a, b) => (a.viejo - a.nuevo) - (b.viejo - b.nuevo))[0];
  console.log('  el peor: ' + peor.planta + ', ' + peor.D.toFixed(0) + ' m — el mapa pintaba ' +
              peor.viejo.toFixed(1) + ' dB donde el motor nuevo da ' + peor.nuevo.toFixed(1) + '.');
  console.log('  Son valores IMPOSIBLES del motor congelado, no del nuevo: una planta así se');
  console.log('  veía entera en rojo oscuro. Lo que se decidiera mirándola hay que rehacerlo.');
}

console.log('\n«cambia color» = el punto cambia de banda en la paleta de `rfColor`.');
console.log('«cruza 8 dB»   = el punto entra o sale de la anilla de «sin enlace» que');
console.log('                 el mapa dibujaba con ese umbral.');
