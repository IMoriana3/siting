// El ÍNDICE ESPACIAL de `rfObstacles`, y que no cambie ni un obstáculo.
//
// POR QUÉ EXISTE ESTE BANCO. `rfObstacles` decide qué filas corta un enlace, y
// de eso sale el mapa de calor entero. Meterle un índice es una optimización
// pura: si cambia UN solo obstáculo, el mapa cambia y nadie se entera, porque
// un mapa de calor no tiene un valor «correcto» que mirar a ojo.
//
// LA REFERENCIA NO ES EL CÓDIGO ANTERIOR —que ya no está— SINO LA FUERZA
// BRUTA: se recorren TODOS los segmentos, sin índice, sin binaria y sin caja,
// y se exige que el resultado coincida obstáculo a obstáculo. Dos caminos para
// lo mismo se separan solos, y el que se separa es el que nadie mira.
//
// POR QUÉ EL ÍNDICE. Medido sobre San José (2.289 seguidores, 4.578 segmentos):
// el barrido anterior examinaba 1.321 segmentos por enlace para encontrar 34,9
// cruces, y el 71,6 % se rechazaban DESPUÉS de mirarlos. El mapa de calor
// entero tardaba 31,8 s y el 94 % del tiempo era esta búsqueda, no la física.
// Con el índice: 3,0 s y 36,4 us por celda, contra un suelo de 34,2 us que es
// la difracción sobre los 35 obstáculos que el enlace cruza de verdad.
//
// LA VELOCIDAD NO SE MIDE AQUÍ, se mide el NÚMERO DE CANDIDATOS, que es
// determinista. Un tope de milisegundos en una CI compartida es un banco que
// parpadea, y un banco que parpadea acaba desactivado.
//
//   node tests/test_rf_indice.js
//   MUTA=<clave> node tests/test_rf_indice.js       (TIENE que salir rojo)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};

const MUTACIONES = {
  // el índice deja de construirse: se cae al barrido completo. El resultado
  // sigue siendo correcto pero se miran los 4.578 segmentos de cada enlace
  sinIndice:    [/const idx=\{cel:cel,g:g,marca:new Int32Array\(segs\.length\)\.fill\(-1\),sello:0\};/,
                 'const idx=null;'],
  // el recorrido de la línea no avanza en y: se pierden las filas de media
  // planta en cuanto el enlace no es horizontal
  ddaSinY:      [/if\(tX<tY\)\{cx\+=sx;tX\+=dX;\} else \{cy\+=sy;tY\+=dY;\}/,
                 'cx+=sx;tX+=dX;'],
  // el sello de visitados deja de comprobarse: un segmento que este en varias
  // celdas del recorrido se cuenta DOS veces, y el enlace se come obstaculos
  // duplicados. (Aqui estuvo una mutacion `sinOrdenar` que salia DORMIDA:
  // resulto que el `cand.sort` no hacia nada -0 empates en 893.872 obstaculos-
  // y se quito del codigo en vez de forzar el banco para cazarla.)
  sinDedupe:    [/if\(marca\[k\]!==sello\)\{marca\[k\]=sello;cand\.push\(k\);\}/,
                 'cand.push(k);'],
  // el sello de visitados no se renueva: a partir del segundo enlace no se
  // recoge ningún candidato nuevo
  selloFijo:    [/const \{cel,g,marca\}=R\.idx, sello=R\.idx\.sello\+\+;/,
                 'const {cel,g,marca}=R.idx, sello=0;'],
  // la celda se hace enorme: sigue siendo correcto pero deja de podar
  celdaEnorme:  [/const cel=50, g=new Map\(\);/, 'const cel=100000, g=new Map();'],
};
const MUTA = process.env.MUTA;
let html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  const antes = html;
  html = html.replace(m[0], m[1]);
  if (html === antes) { console.error('la mutacion «' + MUTA + '» no casó con el código'); process.exit(2); }
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}

const srcRows = html.match(/function rfRows\(\)\{[\s\S]*?\n}\n/);
const srcObst = html.match(/function rfObstacles\([\s\S]*?\n}\n/);
check('rfRows y rfObstacles se localizan', !!srcRows && !!srcObst);
if (!srcRows || !srcObst) { console.log('\nFALLOS: ' + ko); process.exit(1); }
check('rfObstacles NO conserva el barrido por binaria sobre todo el vector',
      !/while\(lo<hi\)\{ const md=\(lo\+hi\)>>1;/.test(srcObst[0]));

function planta(nombre) {
  const m = html.match(new RegExp('^const ' + nombre + '=(\\{[\\s\\S]*?\\});$', 'm'));
  if (!m) return null;
  const P = JSON.parse(m[1]);
  if (!P.tcus || !P.tcus.length) return null;
  const motors = P.tcus.map((t, i) => ({ id: 'T' + i, x: t[0], y: t[1],
    len: t[6], wid: t[7], az: t[8] }));
  const ctx = { S: { bifila: P.bifila || null, motors, p: { tlen: 100, twid: 12 } }, Math };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'zigbee_pv_model.js'), 'utf8'), ctx);
  vm.runInContext('const RF_PITCH_M=12.0, RF_CHORD_M=2.38, RF_ANT_H=1.5;\n' +
    'function rfTilt(){return 30;}\n' + srcRows[0] + srcObst[0] + '\nvar R=rfRows();', ctx);
  return { ctx, P, motors, R: ctx.R };
}

// ── LA REFERENCIA: FUERZA BRUTA SOBRE TODOS LOS SEGMENTOS ───────────────────
// Ni índice, ni binaria, ni caja. Es lenta y es la verdad.
function bruto(segs, n, m, top) {
  const D = Math.hypot(m.x - n.x, m.y - n.y);
  if (D < 0.5) return [];
  const ex = m.x - n.x, ey = m.y - n.y, obs = [];
  for (const s of segs) {
    const fx = s[2] - s[0], fy = s[3] - s[1];
    const den = ex * fy - ey * fx; if (Math.abs(den) < 1e-12) continue;
    const wx = s[0] - n.x, wy = s[1] - n.y;
    const t = (wx * fy - wy * fx) / den, u = (wx * ey - wy * ex) / den;
    if (t > 0.001 && t < 0.999 && u >= 0 && u <= 1) obs.push([t * D, top]);
  }
  obs.sort((p, q) => p[0] - q[0]);
  return obs;
}

// ── EL ÍNDICE EXISTE Y ES COHERENTE ─────────────────────────────────────────
console.log('\n· el indice');
const SJ = planta('SANJOSE');
check('San José se monta: 2.289 seguidores, 4.578 segmentos',
      SJ && SJ.motors.length === 2289 && SJ.R.segs.length === 4578,
      SJ && SJ.motors.length + '/' + SJ.R.segs.length);
check('rfRows devuelve el indice', !!(SJ.R.idx && SJ.R.idx.g && SJ.R.idx.marca), Object.keys(SJ.R || {}).join(','));
if (SJ.R.idx) {
  let total = 0;
  for (const v of SJ.R.idx.g.values()) total += v.length;
  check('todo segmento esta apuntado al menos una vez',
        total >= SJ.R.segs.length, total + ' apuntes para ' + SJ.R.segs.length + ' segmentos');
  check('y la celda es la medida: 50 m', SJ.R.idx.cel === 50, SJ.R.idx.cel);
  // cada segmento tiene que estar en TODAS las celdas que toca su caja
  const cel = SJ.R.idx.cel;
  let malColocados = 0;
  for (let k = 0; k < SJ.R.segs.length; k++) {
    const s = SJ.R.segs[k];
    const x0 = Math.floor(Math.min(s[0], s[2]) / cel), x1 = Math.floor(Math.max(s[0], s[2]) / cel);
    const y0 = Math.floor(Math.min(s[1], s[3]) / cel), y1 = Math.floor(Math.max(s[1], s[3]) / cel);
    for (let cx = x0; cx <= x1 && !malColocados; cx++) for (let cy = y0; cy <= y1; cy++) {
      const v = SJ.R.idx.g.get(cx + ',' + cy);
      if (!v || v.indexOf(k) < 0) { malColocados++; break; }
    }
  }
  check('cada segmento esta en TODAS las celdas que toca su caja', malColocados === 0, malColocados);
}

// ── IDENTIDAD CONTRA LA FUERZA BRUTA, EN CUATRO PLANTAS ─────────────────────
console.log('\n· el mismo resultado que mirar todos los segmentos');
const N = 600;
for (const nom of ['SANJOSE', 'AYORA', 'BURGO', 'PARAMO']) {
  const P = planta(nom);
  if (!P) { check(nom + ': se monta', false); continue; }
  const xs = P.motors.map(m => m.x), ys = P.motors.map(m => m.y);
  const a = { x: Math.min(...xs), y: Math.min(...ys) }, b = { x: Math.max(...xs), y: Math.max(...ys) };
  const tx = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  /* generador determinista: un banco que cambie de casos cada vez no es un
     banco, es una lotería */
  let sem = 20260920;
  const rnd = () => { sem = (sem * 1103515245 + 12345) & 0x7fffffff; return sem / 0x7fffffff; };
  const top = P.ctx.ZigbeePV.rowTopElev(0, 1.5, (P.P.bifila && P.P.bifila.cuerda) || 2.38, 30);
  let dif = 0, obst = 0, vacios = 0;
  P.ctx.__tx = tx;
  for (let i = 0; i < N; i++) {
    /* se sale del vallado a propósito: los enlaces que empiezan o acaban fuera
       son los que más fácil se pierden al podar */
    const m = { x: a.x - 80 + rnd() * ((b.x - a.x) + 160), y: a.y - 80 + rnd() * ((b.y - a.y) + 160) };
    P.ctx.__m = m;
    const conIdx = vm.runInContext('rfObstacles(__tx,__m,R)', P.ctx);
    const ref = bruto(P.R.segs, tx, m, top);
    obst += ref.length;
    if (!ref.length) vacios++;
    if (conIdx.length !== ref.length ||
        conIdx.some((o, j) => o[0] !== ref[j][0] || o[1] !== ref[j][1])) dif++;
  }
  check(nom.padEnd(8) + ' ' + N + ' enlaces, MISMOS obstaculos que a lo bruto', dif === 0,
        dif + ' discrepan · ' + (obst / N).toFixed(1) + ' obstaculos/enlace');
  check(nom.padEnd(8) + ' y los casos cruzan filas de verdad (no todo vacio)',
        obst / N > 3 && vacios < N * 0.6, (obst / N).toFixed(1) + ' obst · ' + vacios + ' vacios');
}

// ── LA PODA FUNCIONA: EL NÚMERO DE CANDIDATOS ───────────────────────────────
// Determinista, a diferencia de un tope de milisegundos.
console.log('\n· la poda, contada (no cronometrada)');
{
  const P = planta('SANJOSE');
  const segs = P.R.segs, idx = P.R.idx;
  const xs = P.motors.map(m => m.x), ys = P.motors.map(m => m.y);
  const a = { x: Math.min(...xs), y: Math.min(...ys) }, b = { x: Math.max(...xs), y: Math.max(...ys) };
  const tx = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let sem = 777, cand = 0;
  const rnd = () => { sem = (sem * 1103515245 + 12345) & 0x7fffffff; return sem / 0x7fffffff; };
  /* se recorre la línea igual que `rfObstacles`, sólo para CONTAR */
  for (let i = 0; i < 400; i++) {
    const m = { x: a.x + rnd() * (b.x - a.x), y: a.y + rnd() * (b.y - a.y) };
    if (!idx) { cand += segs.length; continue; }
    const cel = idx.cel, vistos = new Set();
    let cx = Math.floor(tx.x / cel), cy = Math.floor(tx.y / cel);
    const cxF = Math.floor(m.x / cel), cyF = Math.floor(m.y / cel);
    const ex = m.x - tx.x, ey = m.y - tx.y, sx = ex > 0 ? 1 : -1, sy = ey > 0 ? 1 : -1;
    let tX = ex !== 0 ? (((ex > 0 ? cx + 1 : cx) * cel - tx.x) / ex) : Infinity;
    let tY = ey !== 0 ? (((ey > 0 ? cy + 1 : cy) * cel - tx.y) / ey) : Infinity;
    const dX = ex !== 0 ? Math.abs(cel / ex) : Infinity, dY = ey !== 0 ? Math.abs(cel / ey) : Infinity;
    for (let pasos = 0; ; pasos++) {
      const v = idx.g.get(cx + ',' + cy);
      if (v) for (const k of v) vistos.add(k);
      if ((cx === cxF && cy === cyF) || pasos > 5000) break;
      if (tX < tY) { cx += sx; tX += dX; } else { cy += sy; tY += dY; }
    }
    cand += vistos.size;
  }
  const porEnlace = cand / 400;
  /* el barrido anterior miraba 1.321. El tope de 250 deja margen de sobra y
     sigue siendo diez veces menos: si alguien rompe la poda, se ve. */
  check('en San José se miran menos de 250 segmentos por enlace (antes 1.321)',
        porEnlace < 250, porEnlace.toFixed(0) + ' por enlace de ' + segs.length);
  console.log('     (medido: ' + porEnlace.toFixed(0) + ' candidatos por enlace, de ' + segs.length + ' segmentos)');
}

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
                       : 'TODO OK — ' + ok + ' comprobaciones'));
if (MUTA) {
  console.log(ko ? '### bien: la mutacion «' + MUTA + '» sale roja'
                 : '### MAL: la mutacion «' + MUTA + '» pasa desapercibida');
}
process.exit(ko ? 1 : 0);
