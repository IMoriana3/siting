// SITING AUTOMÁTICO — las plantas de las que hay CAMPO pero todavía no hay red.
//
// Catania entró por aquí y no por el camino de «proyecto real»: su DWG es el de altura de torque
// tube, no uno de comunicaciones, así que trae 0 NCU y las calcula la herramienta. Lo que este
// banco vigila es lo que se puede romper sin que se note:
//
//   1. que el rótulo del botón no mienta sobre CUÁNTA planta hay. Son 1.657 seguidores y solo
//      1.340 tienen la pareja medida en el plano; un rótulo que dijera «1.340 seguidores» a secas
//      se leería como la planta entera y nadie volvería a preguntar por los 317 que faltan.
//   2. que las cuentas del literal cuadren entre sí: filas − sinPar = 2 × seguidores. Si alguien
//      regenera con otro criterio de emparejamiento, esa resta deja de dar y se ve aquí.
//   3. que la rama del diseñador siga leyendo `len`, `wid` y `cuerda`. Sin ellos Catania se
//      dibujaría con la mesa NOMINAL del panel en vez de con la medida en su DWG, y el mapa RF
//      —que mide obstáculos por filas reales— saldría de otra planta.
//   4. que no haya dos motores en el mismo punto, que es la firma de un emparejamiento roto.
//
// La comparación del dato contra su layout NO está aquí: este repo corre solo en su CI, donde
// cobertura-zigbee no existe. Eso lo hace `node tools/gen_siting_auto.mjs catania --verifica`.
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

// ── el literal ──
const i = html.indexOf('const CATANIA=');
check('el literal CATANIA está en index.html', i >= 0);
if (i < 0) { console.log('\nFALLOS: ' + ko); process.exit(1); }
const C = (new Function(html.slice(i, html.indexOf('\n', i)) + '; return CATANIA;'))();

check('trae los puntos de los motores', Array.isArray(C.pts) && C.pts.length > 0, C.pts && C.pts.length);
check('seguidores publicados = puntos que hay', C.seguidores === C.pts.length, [C.seguidores, C.pts.length]);
// la resta que lo dice todo: cada seguidor publicado son DOS filas del plano
check('filas − sin pareja = 2 × seguidores', C.filas - C.sinPar === 2 * C.seguidores,
  { filas: C.filas, sinPar: C.sinPar, seguidores: C.seguidores });
check('está georreferenciada', Number.isFinite(C.ox) && Number.isFinite(C.oy) && C.ox > 0 && C.oy > 0, [C.ox, C.oy]);
check('la envolvente es mayor que la cuerda de una fila', C.wid > C.cuerda, [C.wid, C.cuerda]);
check('y el pasillo que queda es el paso entre filas (5 m)', Math.abs((C.wid - C.cuerda) - 5) < 0.01, C.wid - C.cuerda);

// ── los puntos ──
const malos = C.pts.filter(p => !(Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)));
check('todos los puntos son [x, y, largo] con números', malos.length === 0, malos.slice(0, 3));
const largos = [...new Set(C.pts.map(p => p[2]))].sort((a, b) => a - b);
check('los largos son los dos tipos medidos del DWG, no un valor genérico',
  largos.length === 2 && largos.every(l => l > 30 && l < 70), largos);
const dup = (() => { const v = new Set(); let n = 0;
  for (const p of C.pts) { const k = p[0] + '/' + p[1]; if (v.has(k)) n++; v.add(k); } return n; })();
check('no hay dos motores en el mismo punto', dup === 0, dup);
const fuera = C.pts.filter(p => p[0] < 0 || p[1] < 0);
check('ningún motor cae fuera del campo (la esquina es el (0,0))', fuera.length === 0, fuera.slice(0, 3));

// ── el botón ──
const btn = html.match(/<button data-sc="catania"[^>]*>([\s\S]*?)<\/button>/);
check('hay botón de Catania en el selector de escenarios', !!btn);
if (btn) {
  const txt = btn[1];
  check('el botón dice que es siting automático', /siting autom/i.test(txt), txt.slice(0, 60));
  check('va marcado como `auto`, como los dos FUV', /class="[^"]*\bauto\b/.test(btn[0]), btn[0].slice(0, 70));
  // el rótulo tiene que llevar las DOS cifras: los que hay y el total de la planta
  const mil = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  check('el rótulo dice cuántos seguidores hay', txt.includes(mil(C.seguidores)), txt);
  const total = C.filas / 2;
  check('y cuántos tiene la planta entera, para no leerse como completa', txt.includes(mil(total)), txt);
  check('y cuántos faltan', txt.includes(mil(total - C.seguidores)), txt);
}

// ── la rama del diseñador ──
const rama = html.match(/const AUTO=\{[^}]*\};[\s\S]{0,900}?recompute\(true\); return; \}/);
check('la rama de siting automático se localiza', !!rama);
if (rama) {
  const r = rama[0];
  check('Catania está dada de alta en el registro AUTO', /catania:\s*CATANIA/.test(r), r.slice(0, 60));
  check('y los dos FUV siguen estando', /fuv1:\s*FUV1/.test(r) && /fuv2:\s*FUV2/.test(r));
  check('la rama pasa el largo de cada seguidor al motor', /len:\(p\[2\]/.test(r));
  check('y el ancho de la mesa', /wid:\(P\.wid/.test(r));
  check('y enciende la bífila cuando el literal trae cuerda', /S\.bifila=P\.cuerda\?/.test(r));
  // sin esto, entrar aquí desde otra planta se traía SUS repetidores y el nombre de SU informe
  check('limpia los repetidores de la planta anterior', /S\.reps=\[\]/.test(r));
  check('y el nombre del informe', /S\.projName=P\.name/.test(r));
}

console.log(ko ? `\nFALLOS: ${ko} de ${ok + ko}` : `\nOK — ${ok}/${ok} comprobaciones`);
process.exit(ko ? 1 : 0);
