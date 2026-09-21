// `tools/estadistica.mjs`: la estadística con la que se describe el residuo.
//
// POR QUÉ UN BANCO PARA ESTO. Un p-valor mal calculado no se nota: sale un
// número plausible y nadie lo cuestiona. Y de él depende la frase «el residuo
// tiene pendiente contra las filas», que es media conclusión del careo.
//
// LOS VALORES ESPERADOS SON DE TABLA, no de la propia función:
//
//   · la t de Student, contra los cuantiles publicados (t crítico a dos colas
//     con 1, 10 y 47 grados de libertad);
//   · Pearson, contra un caso resuelto a mano donde r se puede calcular con
//     cuatro operaciones;
//   · Spearman, contra un caso con EMPATES, que es donde una implementación
//     descuidada se delata: rangos arbitrarios en vez de la media.
//
//   node tests/test_estadistica.js
//   MUTA=<clave> node tests/test_estadistica.js       (TIENE que salir rojo)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};
const cerca = (a, b, tol) => a !== null && b !== null && Math.abs(a - b) <= tol;

const MUTACIONES = {
  // sigma poblacional en vez de muestral: con n pequeno la diferencia importa
  sigmaPoblacional: [/xs\.reduce\(\(a, b\) => a \+ \(b - media\) \*\* 2, 0\) \/ \(n - 1\)/,
                     'xs.reduce((a, b) => a + (b - media) ** 2, 0) / n'],
  // los empates de Spearman dejan de promediarse: rangos por orden de llegada
  empatesSinMedia:  [/const medio = \(i \+ j\) \/ 2 \+ 1;/, 'const medio = i + 1;'],
  // el p-valor pasa a una cola
  pUnaCola:         [/return betaIncompleta\(gl \/ 2, 0\.5, gl \/ \(gl \+ t \* t\)\);/,
                     'return betaIncompleta(gl / 2, 0.5, gl / (gl + t * t)) / 2;'],
  // los grados de libertad se equivocan en uno
  glMalos:          [/return \{ r: c\.r, p: pDosColas\(t, n - 2\), n, motivo: null \};/,
                     'return { r: c.r, p: pDosColas(t, n - 1), n, motivo: null };'],
  // el percentil deja de interpolar
  sinInterpolar:    [/return lo === hi \? s\[lo\] : s\[lo\] \+ \(h - lo\) \* \(s\[hi\] - s\[lo\]\);/,
                     'return s[lo];'],
  // una variable constante deja de avisar y devuelve NaN disfrazado
  nanCallado:       [/if \(sxx === 0\) return \{ r: null, motivo: 'la primera variable no varia' \};/,
                     ''],
};
const MUTA = process.env.MUTA;
let modulo = path.join(RAIZ, 'tools', 'estadistica.mjs');
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  const antes = fs.readFileSync(modulo, 'utf8');
  const nuevo = antes.replace(m[0], m[1]);
  if (nuevo === antes) { console.error('la mutacion «' + MUTA + '» no casó con el código'); process.exit(2); }
  modulo = path.join(RAIZ, 'tools', '.estadistica_mutada.mjs');
  fs.writeFileSync(modulo, nuevo);
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}
process.on('exit', () => { if (MUTA && fs.existsSync(modulo)) fs.unlinkSync(modulo); });

import(modulo).then(E => {

// ── LA t DE STUDENT, CONTRA TABLA ───────────────────────────────────────────
// Cuantiles críticos a dos colas, de cualquier tabla publicada. Si el p que
// devuelve `pDosColas` en el t crítico no es el alfa de la tabla, está mal.
console.log('· la t de Student, contra cuantiles de tabla');
for (const [gl, t, alfa] of [
  [1,  12.706, 0.05],    // gl=1,  alfa 0,05
  [1,  63.657, 0.01],
  [10,  2.228, 0.05],    // gl=10, alfa 0,05
  [10,  3.169, 0.01],
  [47,  2.012, 0.05],    // gl=47, el de n=49
  [47,  2.685, 0.01],
  [100, 1.984, 0.05],
]) {
  const p = E.pDosColas(t, gl);
  check('gl=' + String(gl).padStart(3) + '  t=' + t + '  ->  p = ' + alfa,
        cerca(p, alfa, 5e-4), p === null ? 'null' : p.toFixed(6));
}
check('t = 0 da p = 1', cerca(E.pDosColas(0, 47), 1, 1e-12), E.pDosColas(0, 47));
check('sin grados de libertad, null (no NaN)', E.pDosColas(2, 0) === null);

// ── PEARSON, CONTRA UN CASO RESUELTO A MANO ─────────────────────────────────
// x = 1..5, y = 2,4,5,4,5. A mano: mx=3, my=4; sxy = (-2)(-2)+(-1)(0)+0(1)+1(0)+2(1) = 6;
// sxx = 4+1+0+1+4 = 10; syy = 4+0+1+0+1 = 6.  r = 6/sqrt(60) = 0,7745967.
console.log('\n· Pearson, contra un caso resuelto a mano');
const px = [1, 2, 3, 4, 5], py = [2, 4, 5, 4, 5];
const pr = E.pearson(px, py);
check('r = 6/sqrt(60) = 0,7745967', cerca(pr.r, 6 / Math.sqrt(60), 1e-12), pr.r);
check('n se informa', pr.n === 5, pr.n);
check('y su p a dos colas con gl = 3', cerca(pr.p, E.pDosColas(pr.r * Math.sqrt(3 / (1 - pr.r ** 2)), 3), 1e-12));
check('correlacion perfecta da r = 1 y p = 0',
      E.pearson([1, 2, 3], [2, 4, 6]).r === 1 && E.pearson([1, 2, 3], [2, 4, 6]).p === 0);
check('perfecta NEGATIVA da r = -1', cerca(E.pearson([1, 2, 3], [6, 4, 2]).r, -1, 1e-12));
const cte = E.pearson([1, 1, 1], [1, 2, 3]);
check('con una variable constante: null CON MOTIVO, no NaN',
      cte.r === null && /no varia/.test(cte.motivo), cte.r + '/' + cte.motivo);
check('con menos de 3 puntos, null con motivo',
      E.pearson([1, 2], [1, 2]).r === null && /3 puntos/.test(E.pearson([1, 2], [1, 2]).motivo));

// ── SPEARMAN, Y LOS EMPATES ─────────────────────────────────────────────────
// Monótona pero no lineal: Spearman = 1 exacto, Pearson NO.
console.log('\n· Spearman, y el trato de los empates');
const mx = [1, 2, 3, 4, 5], my = [1, 4, 9, 16, 25];
check('monotona no lineal: Spearman = 1', cerca(E.spearman(mx, my).r, 1, 1e-12), E.spearman(mx, my).r);
check('...y Pearson NO llega a 1', E.pearson(mx, my).r < 0.99, E.pearson(mx, my).r);
// Rangos con empates: [10,20,20,30] -> 1; 2,5; 2,5; 4
const rg = E.rangos([10, 20, 20, 30]);
check('los empates reciben el rango MEDIO: 1 · 2,5 · 2,5 · 4',
      rg[0] === 1 && rg[1] === 2.5 && rg[2] === 2.5 && rg[3] === 4, rg.join(' '));
const rg2 = E.rangos([5, 5, 5]);
check('tres empates dan todos rango 2', rg2.every(v => v === 2), rg2.join(' '));
// con empates, Spearman tiene que seguir dando 1 en una monotona
check('con empates, una monotona sigue dando Spearman = 1',
      cerca(E.spearman([1, 2, 2, 3], [10, 20, 20, 30]).r, 1, 1e-12),
      E.spearman([1, 2, 2, 3], [10, 20, 20, 30]).r);

// ── RESUMEN Y PERCENTILES ───────────────────────────────────────────────────
console.log('\n· el resumen del residuo');
// 1..11: media 6, mediana 6, p10 = 2, p90 = 10 con interpolacion lineal
const s = E.resumen([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
check('media 6', cerca(s.media, 6, 1e-12), s.media);
check('p50 = 6', cerca(s.p50, 6, 1e-12), s.p50);
check('p10 = 2 y p90 = 10', cerca(s.p10, 2, 1e-12) && cerca(s.p90, 10, 1e-12), s.p10 + '/' + s.p90);
// sigma MUESTRAL de 1..11: sum (x-6)^2 = 110; 110/10 = 11; sqrt = 3,3166248
check('sigma muestral (n-1) = sqrt(11) = 3,3166248', cerca(s.sigma, Math.sqrt(11), 1e-12), s.sigma);
check('sin datos: todo null con motivo', E.resumen([]).media === null && /sin datos/.test(E.resumen([]).motivo));
// percentil con interpolacion: en [0,10] el p25 es 2,5
check('el percentil interpola: p25 de [0,10] es 2,5', cerca(E.percentil([0, 10], 0.25), 2.5, 1e-12),
      E.percentil([0, 10], 0.25));

// ── PENDIENTE ───────────────────────────────────────────────────────────────
console.log('\n· la pendiente del residuo contra una variable');
// y = 3x + 1 exacto: b = 3, error tipico 0, p = 0
const pe = E.pendiente([1, 2, 3, 4], [4, 7, 10, 13]);
check('recta exacta: b = 3', cerca(pe.b, 3, 1e-12), pe.b);
check('y su error tipico es 0', cerca(pe.se, 0, 1e-9), pe.se);
// ruido simetrico alrededor de una horizontal: b = 0
const pl = E.pendiente([1, 2, 3, 4, 5], [5, 3, 5, 3, 5]);
check('sin tendencia, b proximo a 0 y p alto', Math.abs(pl.b) < 0.3 && pl.p > 0.3,
      'b=' + pl.b.toFixed(3) + ' p=' + pl.p.toFixed(3));
check('con x constante, null con motivo',
      E.pendiente([2, 2, 2], [1, 2, 3]).b === null);

// ── HISTOGRAMA ──────────────────────────────────────────────────────────────
console.log('\n· el histograma');
const h = E.histograma([0, 1, 4, 5, 6, 9], 5);
check('con ancho 5, dos bandas: [0,5) y [5,10)', h.bandas.length === 2, JSON.stringify(h.bandas));
check('y reparte 3 y 3', h.bandas[0].n === 3 && h.bandas[1].n === 3, JSON.stringify(h.bandas));
check('el total del histograma es n', h.bandas.reduce((a, b) => a + b.n, 0) === 6);
const h2 = E.histograma([1, 2, 3], 5);
check('el valor del borde superior no se pierde',
      h2.bandas.reduce((a, b) => a + b.n, 0) === 3, JSON.stringify(h2.bandas));

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
                       : 'TODO OK — ' + ok + ' comprobaciones'));
if (MUTA) {
  console.log(ko ? '### bien: la mutacion «' + MUTA + '» sale roja'
                 : '### MAL: la mutacion «' + MUTA + '» pasa desapercibida');
}
process.exit(ko ? 1 : 0);

}).catch(e => { console.error('no carga el modulo: ' + e.message); process.exit(2); });
