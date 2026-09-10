/* Genera una planta para el SITING AUTOMÁTICO a partir de su layout del DWG.
 *
 * La diferencia con `gen_siting.mjs` no es de formato, es de qué se sabe:
 *
 *   gen_siting.mjs      la planta YA TIENE red. El DWG es de comunicaciones y trae sus NCU, sus
 *                       gateways y su reparto; el generador los COPIA y el siting los enseña.
 *   gen_siting_auto.mjs la planta NO tiene red todavía. Solo hay campo. Se emiten las posiciones
 *                       de los motores y las cotas de la mesa, y las NCU las CALCULA la propia
 *                       herramienta, como en los dos 26127 FUV.
 *
 * Catania es el segundo caso: su plano es el de altura de torque tube, no uno de comunicaciones —0
 * NCU, 0 meteo, 0 repetidores, y `ncu`/`gw` a null en las 3.314 filas—. Por eso se quedó fuera del
 * diseñador; el motivo que se anotó en su ficha ("no hay TCU/NCU") solo vale para el primer camino.
 *
 * UN MOTOR NO ES UNA FILA. En una bífila cada entrada del layout es UN TUBO, y el motor va en el
 * centro de la pareja. Así que aquí SOLO se emiten los seguidores cuya pareja está MEDIDA (campo
 * `par`, que sale de la capa de enlace del DWG). Las filas sin `par` NO se emiten y se cuentan
 * aparte: emparejarlas a ojo movería su motor media distancia entre filas, y eso es inventar.
 *
 *   node tools/gen_siting_auto.mjs catania              informe, no escribe
 *   node tools/gen_siting_auto.mjs catania --write      inyecta el literal y el botón en el siting
 *   node tools/gen_siting_auto.mjs catania --verifica   compara el publicado con el layout de hoy
 *
 * El `--verifica` vive AQUÍ y no en tests/ por una razón práctica: el banco de tests corre en la CI
 * de este repo, donde cobertura-zigbee no está, así que no puede leer el layout. Anunciar que se
 * salta la comparación sería un salto silencioso disfrazado. El banco comprueba lo que se puede
 * comprobar con index.html a solas; esto comprueba el dato contra su origen, donde los dos están.
 *
 * CONVENIO DE COORDENADAS: el mismo que gen_siting.mjs, con el mismo origen —el mínimo se toma
 * sobre TODAS las filas, también las que no se emiten: el campo es el campo, y recortarlo a las
 * emparejadas movería la esquina (0,0) y con ella el UTM de toda la planta.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const RAIZ = new URL('..', import.meta.url).pathname;
const LAYOUTS = '/home/user/Cobertura-Zigbee/';
const DESTINO = RAIZ + 'index.html';
const [planta, ...rest] = process.argv.slice(2);
const WRITE = rest.includes('--write'), VERIFICA = rest.includes('--verifica');
if (!planta) { console.error('uso: node tools/gen_siting_auto.mjs <planta> [--write|--verifica]'); process.exit(2); }

const muere = m => { console.error('ABORTA · ' + m); process.exit(1); };
const marcaDe = v => 'const ' + v + '=';

const L = JSON.parse(readFileSync(LAYOUTS + planta + '_layout.json', 'utf8'));
const trk = L.trackers || [];
if (!trk.length) muere('el layout no trae seguidores');

/* ---------- las guardas ---------- */
if (!L.bifila || !(L.bifila.filas > 1)) muere('el layout no se declara bífila: este generador es para bífilas (una entrada por tubo)');
if (!L.mesa || !L.mesa.tipos) muere('el layout no trae cotas de mesa medidas (`mesa.tipos`): sin ellas no se publica un largo');
if (!isFinite(L.cE) || !isFinite(L.cN)) muere('el layout no trae cE/cN: sin origen UTM la planta no se puede georreferenciar');
const conRot = trk.filter(t => (t.rot || 0) !== 0).length;
if (conRot) muere(conRot + ' filas con rot != 0: este generador no emite azimut por seguidor');

const porId = {};
trk.forEach(t => { porId[t.id] = t; });

const paso = L.bifila.pasoFilas;
if (!(paso > 0)) muere('el layout no declara `bifila.pasoFilas`');

/* ---------- las parejas ---------- */
const vistos = new Set();
const motores = [];
let noReciproco = 0, mixto = 0, malPaso = 0, desfaseMax = 0;
for (const t of trk) {
  if (!t.par || vistos.has(t.id)) continue;
  const o = porId[t.par];
  if (!o) muere('la fila ' + t.id + ' apunta a ' + t.par + ', que no existe');
  if (o.par !== t.id) { noReciproco++; continue; }
  vistos.add(t.id); vistos.add(o.id);
  if (t.tp !== o.tp) { mixto++; continue; }
  const dx = Math.abs(t.x - o.x);
  if (Math.abs(dx - paso) > 0.05) { malPaso++; continue; }
  const dn = Math.abs(t.n - o.n);
  if (dn > desfaseMax) desfaseMax = dn;
  const tipo = L.mesa.tipos[t.tp];
  if (!tipo) muere('el tipo ' + t.tp + ' no está en `mesa.tipos`: no hay largo medido para él');
  motores.push({ x: (t.x + o.x) / 2, n: (t.n + o.n) / 2, largo: +tipo.largo.toFixed(2), tp: t.tp });
}
if (noReciproco) muere(noReciproco + ' emparejamientos NO recíprocos: el dato está mal, no se publica');
if (mixto) muere(mixto + ' parejas con los dos tubos de tipo distinto: el dato está mal, no se publica');
if (malPaso) muere(malPaso + ' parejas cuya separación no es el paso declarado (' + paso + ' m)');
if (!motores.length) muere('ninguna pareja medida: no hay nada que publicar');

const sinPar = trk.filter(t => !t.par).length;

/* ---------- la geometría de la mesa ---------- */
/* ancho = 2·filaZ + cuerda, el mismo modelo que gen_siting: la ENVOLVENTE de las dos filas. El
   siting pinta las dos bandas a ±(ancho−cuerda)/2, así que el pasillo sale exactamente el paso. */
const cuerda = L.mesa.modH;
if (!(cuerda > 0)) muere('el layout no trae `mesa.modH` (la cuerda de una fila)');
const filaZ = (L.mesa.filaZ != null) ? L.mesa.filaZ : (L.filaZ != null ? +L.filaZ : null);
if (!(filaZ > 0)) muere('el layout no trae filaZ');
const ancho = +(2 * filaZ + cuerda).toFixed(3);
if (Math.abs(2 * filaZ - paso) > 0.05) muere('2·filaZ (' + (2 * filaZ) + ') no coincide con el paso declarado (' + paso + ')');

/* ---------- origen ---------- */
const minx = Math.min(...trk.map(t => t.x)), minn = Math.min(...trk.map(t => t.n));
const ox = +(+L.cE.toFixed(1) + minx).toFixed(1), oy = +(+L.cN.toFixed(1) + minn).toFixed(1);

const r1 = v => +v.toFixed(1);
const pts = motores.map(m => [r1(m.x - minx), r1(m.n - minn), m.largo]);

const nomVar = planta.toUpperCase();
const P = { name: L.title || planta, sc: planta, auto: true, ox, oy, cuerda: +cuerda, wid: ancho,
            seguidores: motores.length, filas: trk.length, sinPar, pts };

/* ---------- informe ---------- */
const porTipo = {};
motores.forEach(m => { porTipo[m.tp] = (porTipo[m.tp] || 0) + 1; });
console.log(`planta ${planta} · ${L.crs} · origen UTM del propio layout`);
console.log(`  ${trk.length} filas → ${motores.length} seguidores con pareja MEDIDA · ${sinPar} filas sin pareja, NO se publican`);
console.log(`  por tipo: ${Object.entries(porTipo).map(([k, n]) => k + ' ×' + n).join(' · ')}`);
console.log(`  mesa: ancho ${ancho} m (filas a ±${(paso / 2).toFixed(3)}, cuerda ${cuerda}) · largos ${[...new Set(motores.map(m => m.largo))].join(' · ')} m`);
console.log(`  desfase N-S máximo entre los dos tubos de una pareja: ${desfaseMax.toFixed(3)} m (el motor va en el punto medio)`);
console.log(`  esquina (0,0) en UTM ${ox} ${oy}  ·  campo ${(Math.max(...trk.map(t => t.x)) - minx).toFixed(1)} × ${(Math.max(...trk.map(t => t.n)) - minn).toFixed(1)} m`);

const literal = 'const ' + nomVar + '=' + JSON.stringify(P) + ';';

/* ---------- verificación contra lo publicado ---------- */
if (VERIFICA) {
  const h = readFileSync(DESTINO, 'utf8');
  const i = h.indexOf(marcaDe(nomVar));
  if (i < 0) { console.error('\nno hay ningún ' + nomVar + ' publicado en el siting'); process.exit(1); }
  const VIEJO = (new Function(h.slice(i, h.indexOf('\n', i)) + '; return ' + nomVar + ';'))();
  let ko = 0;
  const chk = (n, cond, extra) => { if (cond) console.log('  ok    ' + n);
    else { ko++; console.log('  FALLA ' + n + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); } };
  chk('mismo número de seguidores', VIEJO.pts.length === pts.length, { publicado: VIEJO.pts.length, ahora: pts.length });
  chk('mismo origen UTM', VIEJO.ox === ox && VIEJO.oy === oy, { publicado: [VIEJO.ox, VIEJO.oy], ahora: [ox, oy] });
  chk('misma envolvente y cuerda', VIEJO.wid === ancho && VIEJO.cuerda === +cuerda, { publicado: [VIEJO.wid, VIEJO.cuerda], ahora: [ancho, +cuerda] });
  chk('mismas cuentas del layout', VIEJO.filas === trk.length && VIEJO.sinPar === sinPar, { publicado: [VIEJO.filas, VIEJO.sinPar], ahora: [trk.length, sinPar] });
  if (VIEJO.pts.length === pts.length) {
    let peor = 0, malLargo = 0;
    for (let k = 0; k < pts.length; k++) {
      peor = Math.max(peor, Math.hypot(VIEJO.pts[k][0] - pts[k][0], VIEJO.pts[k][1] - pts[k][1]));
      if (VIEJO.pts[k][2] !== pts[k][2]) malLargo++;
    }
    chk('cada motor donde estaba (< 0,05 m)', peor < 0.05, { peor: +peor.toFixed(3) });
    chk('cada largo donde estaba', malLargo === 0, { distintos: malLargo });
  }
  console.log(ko ? `\n${ko} DIFERENCIAS: el publicado no es el que sale del layout de hoy` : '\nel publicado coincide con el layout');
  process.exit(ko ? 1 : 0);
}

if (!WRITE) {
  console.log('\n(dry-run: pasa --write para inyectarlo en el siting)');
  console.log(literal.slice(0, 240) + '…');
  process.exit(0);
}

/* ---------- inyección ---------- */
let h = readFileSync(DESTINO, 'utf8');
const i = h.indexOf(marcaDe(nomVar));
if (i >= 0) {
  const j = h.indexOf('\n', i);
  h = h.slice(0, i) + literal + h.slice(j);
} else {
  /* Se cuelga del último literal de planta que haya, para que el orden del fichero siga el de
     siempre y el diff sea una línea. */
  const anc = h.lastIndexOf('const FUV2=');
  if (anc < 0) muere('no encuentro dónde colgar el literal (const FUV2=)');
  const j = h.indexOf('\n', anc);
  h = h.slice(0, j + 1) + literal + '\n' + h.slice(j + 1);
}
/* El botón. `class="wide auto"` es la misma que llevan los dos FUV: siting automático. */
/* El rótulo dice las DOS cifras a propósito: los que hay y los que faltan. «1.340 seguidores» a
   secas se leería como la planta entera, y la planta tiene 1.657. */
const totalSeg = Math.round(trk.length / L.bifila.filas);
/* Separador de miles a mano: el Node de este entorno viene con ICU mínimo y `toLocaleString('es-ES')`
   devolvía «1340», sin punto. */
const mil = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const btn = `          <button data-sc="${planta}" class="wide auto">${P.name} · siting automático<small>${mil(P.seguidores)} de ${mil(totalSeg)} seguidores · NCU calculadas · faltan ${mil(totalSeg - P.seguidores)}, sin emparejar en el plano</small></button>`;
if (!new RegExp(`data-sc="${planta}"`).test(h)) {
  const k = h.indexOf('<button data-sc="fuv1"');
  if (k < 0) muere('no encuentro dónde poner el botón (data-sc="fuv1")');
  const ini = h.lastIndexOf('\n', k) + 1;
  h = h.slice(0, ini) + btn + '\n' + h.slice(ini);
} else {
  h = h.replace(new RegExp(`^.*data-sc="${planta}".*$`, 'm'), btn);
}
writeFileSync(DESTINO, h);
console.log('\nescrito en ' + DESTINO);
