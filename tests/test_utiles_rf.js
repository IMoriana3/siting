/* LOS DOS UTILES QUE NO VIGILABA NADIE.
 *
 * `tools/careo_elburgo.mjs` sí lo corre `test_careo_elburgo.js`, de punta a
 * punta y con fixtures. Los otros dos no los corría nada:
 *
 *   tools/sensibilidad_eje.mjs   el barrido de altura de eje y vegetación
 *   tools/sin_dato_horas.mjs     cuántas TCU quedan sin dato, y a qué hora
 *
 * Y se nota en lo que tenían dentro. `sin_dato_horas.mjs` hacía
 * `require('/home/user/Siting/radio_pv_model.js')` —RUTA ABSOLUTA, o sea que no
 * arrancaba en ninguna otra máquina ni en la CI— y reventaba con una traza de
 * `node:fs` si le faltaba un argumento. `sensibilidad_eje.mjs` sólo sabía leer
 * el árbitro del repo hermano, así que no se podía correr en ningún banco; ya
 * se subió roto una vez por eso (c62242e).
 *
 * ESTE BANCO LOS EJECUTA DE VERDAD, no comprueba que existan. Contra fixtures
 * que escribe él, y con los números CALCULADOS A MANO abajo — no pidiéndoselos
 * a las mismas funciones que el útil usa, que sería carearse consigo mismo.
 *
 * USO:  node tests/test_utiles_rf.js
 *       MUTA=<clave> node tests/test_utiles_rf.js      (TIENE que salir rojo)
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const RAIZ = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'utiles_'));

/* ── MUTACIONES ───────────────────────────────────────────────────────────
   Sobre una COPIA del útil, en el temporal: el repo no se toca. */
const MUTACIONES = {
  // la antena deja de derivarse del eje y vuelve a la cota fija
  ejeSinAntena:  ['tools/sensibilidad_eje.mjs', /R\.alturaAntenaTCU\(eje, RA, CA, tilt\)/, '0.775'],
  // el barrido de vegetación deja de depender del espesor
  vegPlana:      ['tools/sensibilidad_eje.mjs', /\(base - v \* k\)/, '(base - 0 * k)'],
  // el canto vuelve al EJE: se pierde la huella del panel, que es el cambio entero
  cantoAlEje:    ['tools/sin_dato_horas.mjs', /const d1d = \(lat \+ \(CU \/ 2\) \* Math\.cos\(Math\.abs\(a\) \* RM\.GRADO\)\) \/ senPhi;/,
                                              'const d1d = lat / senPhi;'],
  // el corte de HOY deja de ser proporcional a D: pierde justo lo que el útil
  // viene a enseñar, que la misma geometria entra o sale segun lo largo que sea
  corteFijo:     ['tools/sin_dato_horas.mjs', /if \(d1a \/ D <= 0\.001\) hoyFuera\+\+;/, 'if (d1a <= 0.001) hoyFuera++;'],
  // el rótulo vuelve a ser una cadena fija en vez de salir del layout
  rotuloFijo:    ['tools/sin_dato_horas.mjs', /LAY\.trackers\.length \+ ' seguidores/, "'751 seguidores"],
  // el seno del angulo de cruce se pierde: todo pasa a cruzar perpendicular
  sinSenPhi:     ['tools/sin_dato_horas.mjs', /const d1a = lat \/ senPhi;/, 'const d1a = lat;'],
};

const MUTA = process.env.MUTA;
const mutados = {};
function util(rel) {
  if (!MUTA) return path.join(RAIZ, rel);
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  if (m[0] !== rel) return path.join(RAIZ, rel);
  if (!mutados[rel]) {
    const antes = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    const despues = antes.replace(m[1], m[2]);
    if (despues === antes) { console.error('la mutacion «' + MUTA + '» no casó con ' + rel); process.exit(2); }
    /* La copia va EN EL DIRECTORIO REAL, con otro nombre, porque los dos útiles
       resuelven el motor y `index.html` relativos a su propia ruta: metida en
       el temporal no encontraría nada y la mutación saldría roja por el motivo
       equivocado, que es un verde disfrazado de rojo. Se borra al terminar. */
    const destino = path.join(RAIZ, path.dirname(rel), '.muta_' + path.basename(rel));
    fs.writeFileSync(destino, despues);
    mutados[rel] = destino;
  }
  return mutados[rel];
}
function limpia() { for (const f of Object.values(mutados)) { try { fs.unlinkSync(f); } catch (e) {} } }
process.on('exit', limpia);
if (MUTA) console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');

let ok = 0, ko = 0;
function check(q, cond, detalle) {
  if (cond) { ok++; console.log('OK   ' + q); }
  else { ko++; console.log('FAIL ' + q + (detalle != null ? ' -> ' + detalle : '')); }
}
function corre(rel, args) {
  const r = spawnSync(process.execPath, [util(rel)].concat(args), { encoding: 'utf8' });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* ── LOS NUMEROS, A MANO ───────────────────────────────────────────────────
   Nada de esto sale de `radio_pv_model.js`: si saliera, un motor equivocado
   haría pasar el banco.

   ANTENA DE LA TCU = eje − 0,225·cos α − 0,50
     eje 1,20  α  0°   1,20 − 0,225·1,000000 − 0,50 = 0,4750
     eje 1,20  α 30°   1,20 − 0,225·0,866025 − 0,50 = 0,5051
     eje 1,20  α 55°   1,20 − 0,225·0,573576 − 0,50 = 0,5710
     eje 2,00  α 30°   2,00 − 0,225·0,866025 − 0,50 = 1,3051

   λ a 2,45 GHz = 299792458 / 2,45e9 = 0,122364 m   →  2 λ = 0,244729 m

   CAMPO CERCANO de la fila propia, cruce perpendicular (sen φ = 1):
     canto EN EL EJE        d1 = 0,225·sen α
     canto EN LA HUELLA     d1 = 0,225·sen α + (2,384/2)·cos α
     α = 30°   eje: 0,225·0,500000 = 0,112500          < 0,244729  → CERCA
               huella: 0,1125 + 1,192·0,866025 = 1,1448 > 0,244729  → no

     α = 0,6°  eje: 0,225·0,010472 = 0,002356          < 0,244729  → CERCA
               huella: 0,002356 + 1,192·0,999945 = 1,1943 > 0,244729 → no

   Y CON EL CRUCE OBLICUO, sen φ = |cos rot|. Con rot = 70° sale 0,342020, y
   ahí el mismo lateral se aleja lo bastante para cambiar de veredicto:
     α = 30°,  rot 70°  eje: 0,112500 / 0,342020 = 0,328928 > 0,244729 → NO cerca
     α = 0,6°, rot 70°  eje: 0,002356 / 0,342020 = 0,006889 < 0,244729 → CERCA
   O sea: a 09:00 caen DOS de los tres en campo cercano, y a 14:00 los tres.

   EL CORTE DE HOY, `t > 0,001`, es proporcional a D:
     α = 30°, D =  40 m   0,1125/40  = 0,002813  > 0,001  → NO lo tira
     α = 30°, D = 200 m   0,1125/200 = 0,000563 <= 0,001  → SI lo tira
   La misma geometria, distinto veredicto por lo largo que sea el salto. Eso es
   justo lo que el util existe para enseñar. */
const ANT = { '1.20_0': 0.475, '1.20_30': 0.5051, '1.20_55': 0.5710, '2.00_30': 1.3051 };

console.log('· los dos utiles, ejecutados de verdad\n');

/* ── 1. sensibilidad_eje.mjs ──────────────────────────────────────────────── */
const PARES = [[0, 0, 0.0018, 0], [0, 0, 0.0012, 0.0009], [0.001, 0.0005, 0.003, 0.0005]];
const BURGO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8')
  .match(/^const BURGO=(\{[\s\S]*?\});$/m)[1]);
const feats = [];
PARES.forEach((p, i) => {
  const A = [BURGO.lon + p[0], BURGO.lat + p[1]], B = [BURGO.lon + p[2], BURGO.lat + p[3]];
  feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [A, B] },
    properties: { origen: 'N' + i + 'a', destino: 'N' + i + 'b', rssi_medido_dbm: -70 - i } });
});
const GJ = path.join(TMP, 'fix.geojson');
fs.writeFileSync(GJ, JSON.stringify({ type: 'FeatureCollection', features: feats }));

const s = corre('tools/sensibilidad_eje.mjs', ['--geojson', GJ]);
check('sensibilidad_eje arranca y termina bien', s.rc === 0, 's.rc=' + s.rc + ' ' + s.out.slice(0, 160));

/* la tabla: «  eje  alfa°  antena  n  media  mediana  min  max» */
const filas = [];
for (const l of s.out.split('\n')) {
  const m = l.match(/^\s+(\d\.\d\d)\s+(\d+)°\s+(-?\d+\.\d+)\s+(\d+)\s/);
  if (m) filas.push({ eje: m[1], tilt: m[2], ant: parseFloat(m[3]), n: parseInt(m[4], 10) });
}
check('saca las 9 filas del barrido (3 ejes x 3 alfas)', filas.length === 9, filas.length);
check('y cuenta los ' + PARES.length + ' enlaces del fixture, no los 49 de El Burgo',
      filas.every(f => f.n === PARES.length), filas.map(f => f.n).join(','));

for (const [k, v] of Object.entries(ANT)) {
  const [eje, tilt] = k.split('_');
  const f = filas.find(x => x.eje === eje && x.tilt === tilt);
  check('antena a eje ' + eje + ' y alfa ' + tilt + '° = ' + v.toFixed(4) + ' m (a mano)',
        f && Math.abs(f.ant - v) < 5e-4, f ? f.ant : '(no está la fila)');
}

/* el barrido de vegetación: a v = 0 las tres columnas son la base, y a v > 0 la
   caída tiene que ser LINEAL en v con la pendiente de cada coeficiente. */
const veg = [];
for (const l of s.out.split('\n')) {
  const m = l.match(/^\s+(\d\.\d)\s+(-?\d+\.\d\d)\s+(-?\d+\.\d\d)\s+(-?\d+\.\d\d)\s*$/);
  if (m) veg.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]);
}
check('saca las 4 lineas del barrido de vegetacion', veg.length === 4, veg.length);
if (veg.length === 4) {
  const [v0] = veg;
  check('a v = 0 los tres coeficientes dan la misma base',
        Math.abs(v0[1] - v0[2]) < 1e-9 && Math.abs(v0[2] - v0[3]) < 1e-9, v0.join(' '));
  const malo = veg.slice(1).filter(([v, a, b, c]) =>
    Math.abs((v0[1] - a) - 0.5 * v) > 6e-3 ||
    Math.abs((v0[2] - b) - 1.0 * v) > 6e-3 ||
    Math.abs((v0[3] - c) - 2.0 * v) > 6e-3);
  check('y la caida es 0,5 / 1,0 / 2,0 dB por metro de follaje, exacta',
        malo.length === 0, JSON.stringify(malo));
}
check('y dice que el motor NO modela vegetacion, que es lo que impide citarlo como prediccion',
      /NO modela vegetacion/.test(s.out) && /TANTEO/.test(s.out));

/* ── 2. sin_dato_horas.mjs ────────────────────────────────────────────────── */
/* Fixture con la geometria del cuadro de arriba: NCU en el origen y seguidores
   al este, así que el enlace va justo al oeste y sen φ = |cos rot|.

   EL TERCERO, EL OBLICUO, ESTÁ PORQUE LA MUTACIÓN `sinSenPhi` SALÍA DORMIDA.
   Con A y B solamente, todos los cruces eran perpendiculares (rot = 0, sen φ =
   1) y quitar la división por sen φ no cambiaba un solo número: el banco se
   quedaba verde con el seno del ángulo de cruce borrado. Se cazó CORRIENDO la
   mutación, no leyendo el banco. C cruza casi a lo largo de su fila
   (rot = 70°, sen φ = 0,342), y ahí el seno decide el veredicto. */
const LAY = {
  planta: 'banco',
  ncus: [{ x: 0, n: 0 }],
  trackers: [{ id: 'A', x: 40, n: 0, rot: 0, ncu: 1 },      // corto: HOY no lo tira
             { id: 'B', x: 200, n: 0, rot: 0, ncu: 1 },     // largo: HOY sí lo tira
             { id: 'C', x: 40, n: 0, rot: 70, ncu: 1 }],    // oblicuo: sen φ = 0,342
};
const LAYF = path.join(TMP, 'banco_layout.json');
fs.writeFileSync(LAYF, JSON.stringify(LAY));
const CSVF = path.join(TMP, 'consignas.csv');
fs.writeFileSync(CSVF, ['hora_local,tracker,theta_tcu_deg',
  '09:00,A,30', '09:00,B,30', '09:00,C,30',
  '14:00,A,0.6', '14:00,B,0.6', '14:00,C,0.6',
  '18:00,A,-30', '18:00,B,-30', '18:00,C,-30'].join('\n'));

const d = corre('tools/sin_dato_horas.mjs', [LAYF, CSVF]);
check('sin_dato_horas arranca y termina bien', d.rc === 0, 'rc=' + d.rc + ' ' + d.out.slice(0, 200));
check('y NO dice ya «Ayora» ni «751» corriendo sobre otra planta',
      /banco · 3 seguidores · 9 consignas/.test(d.out) && !/751/.test(d.out),
      d.out.split('\n')[0]);

const horas = {};
for (const l of d.out.split('\n')) {
  const m = l.match(/^\s+(\d\d:\d\d)\s+(-?\d+\.\d)°\s+(\d+) de (\d+).*?(\d+) de \d+.*?(\d+) de \d+/);
  if (m) horas[m[1]] = { alfa: parseFloat(m[2]), hoy: +m[3], n: +m[4], antes: +m[5], despues: +m[6] };
}
check('saca las tres horas', Object.keys(horas).length === 3, Object.keys(horas).join(' '));
for (const [h, esp] of Object.entries({
  /* a mano: HOY tira solo el de 200 m; la banda mete los dos en campo cercano;
     con el canto en la huella no queda ninguno. */
  '09:00': { n: 3, hoy: 1, antes: 2, despues: 0 },
  '14:00': { n: 3, hoy: 3, antes: 3, despues: 0 },   // a 0,6° el lateral es 2,4 mm: caen los tres
  '18:00': { n: 3, hoy: 1, antes: 2, despues: 0 },   // alfa negativo, misma geometria
})) {
  const g = horas[h];
  check(h + ': ' + esp.hoy + ' fuera hoy, ' + esp.antes + ' cerca con el canto en el eje, ' +
        esp.despues + ' con el canto en la huella (a mano)',
        g && g.n === esp.n && g.hoy === esp.hoy && g.antes === esp.antes && g.despues === esp.despues,
        g ? JSON.stringify(g) : '(falta la hora)');
}
/* Y LO QUE EL UTIL EXISTE PARA ENSEÑAR: a 09:00 los dos seguidores tienen la
   MISMA geometria -mismo alfa, misma fila, mismo cruce- y HOY uno entra y el
   otro no, solo por lo largo que es el salto. Si esto deja de pasar, el corte
   ha dejado de ser proporcional a D y el util ya no demuestra nada. */
check('el corte de HOY separa dos enlaces de geometria IDENTICA por su longitud',
      horas['09:00'] && horas['09:00'].hoy === 1 && horas['09:00'].n === 3,
      horas['09:00'] ? JSON.stringify(horas['09:00']) : null);

/* ── 3. FALLAR BIEN, que es la mitad de correr bien ───────────────────────── */
const sinArb = corre('tools/sensibilidad_eje.mjs', ['--geojson', path.join(TMP, 'no-existe.geojson')]);
check('sensibilidad_eje sin arbitro: rc=2 y lo dice, sin traza de node',
      sinArb.rc === 2 && /no encuentro el arbitro/.test(sinArb.out) && !/node:fs/.test(sinArb.out),
      'rc=' + sinArb.rc + ' ' + sinArb.out.slice(0, 90));
const sinArg = corre('tools/sin_dato_horas.mjs', []);
check('sin_dato_horas sin argumentos: rc=2, dice el USO, sin traza de node',
      sinArg.rc === 2 && /USO:/.test(sinArg.out) && !/node:fs/.test(sinArg.out),
      'rc=' + sinArg.rc + ' ' + sinArg.out.slice(0, 90));
const sinCsv = corre('tools/sin_dato_horas.mjs', [LAYF, path.join(TMP, 'no-existe.csv')]);
check('y con el CSV que falta dice CUAL de los dos falta',
      sinCsv.rc === 2 && /CSV de consignas/.test(sinCsv.out), 'rc=' + sinCsv.rc);

/* Ningun util puede llevar una ruta absoluta de la maquina de quien lo escribio:
   `sin_dato_horas.mjs` llevaba `/home/user/Siting/radio_pv_model.js` y por eso
   no arrancaba en ningun otro sitio. Se mira el fuente, porque en ESTA maquina
   la ruta absoluta funciona y el util no fallaria. */
for (const rel of ['tools/sensibilidad_eje.mjs', 'tools/sin_dato_horas.mjs']) {
  const src = fs.readFileSync(path.join(RAIZ, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const abs = (src.match(/['"]\/(home|Users|opt)\/[^'"]*['"]/g) || []);
  check(rel + ' no lleva rutas absolutas de nadie', abs.length === 0, abs.join(' '));
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
console.log('\n' + (ko ? 'FALLA — ' + ko + ' de ' : 'TODO OK — ') + (ok + ko) + ' comprobaciones');
if (MUTA) console.log(ko ? '### bien: la mutacion «' + MUTA + '» sale roja'
                         : '### MAL: la mutacion «' + MUTA + '» pasa desapercibida');
process.exit(ko ? 1 : 0);
