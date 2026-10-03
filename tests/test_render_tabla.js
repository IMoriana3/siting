// CÓMO SE ESCRIBE UN NÚMERO EN UNA COLUMNA ESTRECHA — banco de `_render_tabla.js`.
//
// Este banco no vigila aritmética: vigila que la TABLA no publique un número
// que no es el número. Sale de una avería medida el 2026-10-03 en
// `tools/comparador_tecnologias.mjs`, que publicaba
//
//     capacidad de telemetría usada            111111111111111
//
// cuando el valor es 0,0611 %. Causa: `padStart(n).slice(-n)` se queda la COLA
// de la cadena, así que a "0.06111111111111111" le comía el "0.06".
//
// Las tres reglas, cada una con su mutación:
//
//   1. no decapitar      · si no cabe, se conserva la CABEZA (la magnitud)
//   2. el corte se ve    · una celda recortada lleva «…»
//   3. redondear primero · un float se formatea ANTES de medir si cabe
//
// Y la cuarta, que es la que de verdad importa: NINGUNA cadena de salida puede
// ser un número distinto del de entrada. Eso se comprueba a lo bruto, sobre un
// barrido de valores, porque es la propiedad y no un caso.
//
//   node tests/test_render_tabla.js
//   MUTA=<clave> node tests/test_render_tabla.js      (TIENE que salir rojo)
//
// rc = 0 mide · 1 rojo · 2 no comprobado
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};

/* ── MUTACIONES ─────────────────────────────────────────────────────────── */
const MUTACIONES = {
  // LA AVERÍA ORIGINAL, tal cual estaba: alinear a la derecha quedándose la
  // cola. Es la que publicaba "111111111111111".
  decapita: ['tools/_render_tabla.js',
             "    if (s.length <= n) return s.padStart(n);\n    return (s.slice(0, n - 1) + '…').padStart(n);",
             '    return s.padStart(n).slice(-n);'],
  // recorta por donde toca, pero SIN marcar: el lector no puede saber que
  // falta algo, que es la mitad del problema
  recortaSinMarcar: ['tools/_render_tabla.js',
                     "return (s.slice(0, n - 1) + '…').padStart(n);",
                     'return s.slice(0, n).padStart(n);'],
  // no redondea: el float entra entero en la columna y vuelve a no caber
  sinRedondeo: ['tools/_render_tabla.js',
                "    if (typeof x !== 'number' || !isFinite(x)) return String(x);",
                '    return String(x);'],
};

const MUTA = process.env.MUTA;
let restaurar = null;
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('MUTA desconocida: ' + MUTA + ' (hay: ' + Object.keys(MUTACIONES).join(', ') + ')'); process.exit(2); }
  const f = path.join(RAIZ, m[0]);
  const antes = fs.readFileSync(f, 'utf8');
  if (!antes.includes(m[1])) {
    console.error('la mutación «' + MUTA + '» no encaja en ' + m[0] + ': el texto a sustituir ya no está.');
    console.error('NO se ha medido nada. Arregla la mutación o el banco.');
    process.exit(2);
  }
  fs.writeFileSync(f, antes.replace(m[1], m[2]));
  restaurar = () => fs.writeFileSync(f, antes);
  console.log('── MUTADO: ' + MUTA + ' (' + m[0] + ') — este banco TIENE que salir rojo ──\n');
}

function fin() {
  if (restaurar) restaurar();
  console.log('\n' + ok + ' ok · ' + ko + ' fail');
  if (ko > 0) { console.log('ROJO'); process.exit(1); }
  console.log('MIDE'); process.exit(0);
}

let R;
try {
  delete require.cache[require.resolve(path.join(RAIZ, 'tools', '_render_tabla.js'))];
  R = require(path.join(RAIZ, 'tools', '_render_tabla.js'));
} catch (e) {
  console.error('no se ha podido cargar tools/_render_tabla.js: ' + e.message);
  if (restaurar) restaurar();
  process.exit(2);
}

/* ── 1 · EL CASO QUE SE MIDIÓ ───────────────────────────────────────────── */
// 44 B cada 30 s sobre un puerto de 19 200 b/s. Es el número real de la tabla.
const PCT = 100 * (44 * 8) / (30 * 19200);
check('el caso medido no es 0 ni entero (si no, no probaría nada)',
      PCT > 0 && !Number.isInteger(PCT), PCT);

const vista = R.paraLaVista(PCT);
check('0,0611 % se formatea legible antes de la columna', vista === '0.0611', vista);

const celda = R.pd(vista, 15);
check('la celda mide exactamente 15', celda.length === 15, celda.length);
check('la celda NO es la cola decapitada',
      celda.trim() !== '111111111111111' && !/^1+$/.test(celda.trim()), JSON.stringify(celda));
check('la celda conserva el valor íntegro', celda.trim() === '0.0611', JSON.stringify(celda));

/* ── 2 · EL CASO QUE NO SALTA A LA VISTA ────────────────────────────────── */
// "111111111111111" se ve raro. Esto no: 12,345678901234567 decapitado da
// "345678901234567", que parece un número válido. Es el caso caro.
const trampa = 12.345678901234567;
const celdaTrampa = R.pd(R.paraLaVista(trampa), 15);
check('el caso disfrazado no sale como "345678901234567"',
      celdaTrampa.trim() !== '345678901234567', JSON.stringify(celdaTrampa));
check('y conserva la magnitud (empieza por 12)',
      celdaTrampa.trim().startsWith('12'), JSON.stringify(celdaTrampa));

/* ── 2 bis · `pd` A PELO, QUE ES LA ÚNICA FORMA DE MEDIRLA ──────────────── */
// ESTO SALIÓ DE QUE EL BANCO SE QUEDÓ VERDE. Medido el 2026-10-03: con sólo las
// comprobaciones de arriba, DOS de las tres mutaciones (`decapita` y
// `recortaSinMarcar`) no lo ponían rojo. El motivo, medido y no supuesto:
//
//     paraLaVista(0.06111111111111111) -> "0.0611"   (6 caracteres)
//
// y la columna mide 15, así que CABE DE SOBRA y `pd` no entra nunca en su rama
// de recorte. El redondeo salvaba el caso real POR SÍ SOLO, de modo que el
// banco medía UNA guarda creyendo medir dos. Cobertura mutua, igual que en
// `test_stow_desde_scada.js`.
//
// La tabla, medida con las dos mutaciones por separado y juntas:
//
//     redondeo   pd        resultado del banco
//     ─────────────────────────────────────────
//     bien       bien      24 ok · 0 fail
//     bien       roto      24 ok · 0 fail   <-- la avería pasaba desapercibida
//     roto       bien      22 ok · 2 fail
//     roto       roto      rojo
//
// Para medir `pd` hay que DARLE algo que no quepa, sin pasar por el redondeo.
// Eso es lo que hace esta sección, y es la que pone rojas las otras dos.
const CRUDO = String(PCT);                     // "0.06111111111111111", 19 caracteres
check('el crudo no cabe en la columna (si cupiera, esto no probaría nada)',
      CRUDO.length > 15, CRUDO.length);
const celdaCrudo = R.pd(CRUDO, 15);
check('pd a pelo mide 15', celdaCrudo.length === 15, celdaCrudo.length);
check('pd a pelo NO decapita: no sale "111111111111111"',
      celdaCrudo !== '111111111111111' && !/^1+$/.test(celdaCrudo.trim()),
      JSON.stringify(celdaCrudo));
check('pd a pelo conserva la CABEZA, que es donde vive la magnitud',
      celdaCrudo.trim().startsWith('0.06'), JSON.stringify(celdaCrudo));
check('pd a pelo MARCA el recorte', celdaCrudo.includes('…'), JSON.stringify(celdaCrudo));

// y el caso disfrazado, también a pelo
const CRUDO_TRAMPA = String(12.345678901234567);
const celdaCrudoTrampa = R.pd(CRUDO_TRAMPA, 15);
check('pd a pelo no convierte 12,34... en "345678901234567"',
      celdaCrudoTrampa.trim() !== '345678901234567', JSON.stringify(celdaCrudoTrampa));
check('pd a pelo conserva el 12', celdaCrudoTrampa.trim().startsWith('12'), JSON.stringify(celdaCrudoTrampa));
check('pd a pelo marca también aquí', celdaCrudoTrampa.includes('…'), JSON.stringify(celdaCrudoTrampa));

// un texto largo que no es número: mismo trato
const celdaTexto = R.pd('no se puede medir esto de ninguna manera', 15);
check('un texto largo se recorta a 15', celdaTexto.length === 15, celdaTexto.length);
check('un texto largo conserva el principio', celdaTexto.startsWith('no se puede'), JSON.stringify(celdaTexto));
check('un texto largo lleva marca', celdaTexto.includes('…'), JSON.stringify(celdaTexto));

/* ── 3 · LA PROPIEDAD, SOBRE UN BARRIDO ─────────────────────────────────── */
// La regla de verdad: para CUALQUIER valor, lo que sale de la celda, leído como
// número, tiene que ser el valor de entrada a su precisión — o estar marcado
// como recortado. Lo que NUNCA puede pasar es salir un número distinto y limpio.
const BARRIDO = [
  0, 1, -1, 0.5, 0.0611111111111111, 12.345678901234567, 215, 1086, 20912,
  1 / 3, 2 / 3, 99.995, 100.004, 0.000123456789, -0.0611111111111111,
  123456789.123456, 1e-7, 8.1, 63.1, 0.198, 2.38,
];
let mentiras = [];
for (const x of BARRIDO) {
  const s = R.pd(R.paraLaVista(x), 15);
  if (s.length !== 15) { mentiras.push([x, s, 'no mide 15']); continue; }
  const t = s.trim();
  if (t.includes('…')) continue;              // recortado Y marcado: legal
  const leido = Number(t);
  if (!isFinite(leido)) { mentiras.push([x, s, 'no se relee como número']); continue; }
  // tolerancia: la del redondeo de presentación a su escala, no más
  const abs = Math.abs(x);
  const tol = abs >= 100 ? 0.05 : abs >= 1 ? 0.005 : abs >= 0.01 ? 0.00005 : 5e-7;
  if (Math.abs(leido - x) > tol) mentiras.push([x, s, 'releído = ' + leido]);
}
check('ningún valor del barrido sale como un número distinto y limpio (' + BARRIDO.length + ' valores)',
      mentiras.length === 0, JSON.stringify(mentiras.slice(0, 4)));

/* ── 4 · LOS ENTEROS NO SE ADORNAN ──────────────────────────────────────── */
check('215 TCU se escriben 215, no 215,00', R.paraLaVista(215) === '215', R.paraLaVista(215));
check('0 se escribe 0', R.paraLaVista(0) === '0', R.paraLaVista(0));

/* ── 5 · LO QUE NO ES NÚMERO PASA TAL CUAL ──────────────────────────────── */
check('«no se puede» no se toca', R.paraLaVista('no se puede') === 'no se puede');
check('«no se puede» cabe en 15 sin marca', R.pd('no se puede', 15).trim() === 'no se puede');
check('el guión de «no aplica» no se toca', R.paraLaVista('—') === '—');
check('NaN no se disfraza de número', R.paraLaVista(NaN) === 'NaN', R.paraLaVista(NaN));
check('Infinity no se disfraza de número', R.paraLaVista(Infinity) === 'Infinity');

/* ── 6 · ALINEAR A LA IZQUIERDA CORTA POR EL FINAL, Y SE MARCA ──────────── */
// En los rótulos SÍ se puede perder la cola —«latencia de la orden de stow
// hasta la ÚLTIMA TCU» no cabe en 42— pero el recorte tiene que verse.
const rot = 'latencia de la orden de stow hasta la ÚLTIMA TCU';
const rotCortado = R.pi(rot, 42);
check('un rótulo largo se corta a 42', rotCortado.length === 42, rotCortado.length);
check('y empieza por el principio', rotCortado.startsWith('latencia de la orden'), rotCortado);
check('y lleva la marca de recorte', rotCortado.includes('…'), JSON.stringify(rotCortado));
const rotCorto = R.pi('TCU cubiertas', 42);
check('un rótulo que cabe no se marca', rotCorto.length === 42 && !rotCorto.includes('…'));
check('y conserva el texto', rotCorto.trim() === 'TCU cubiertas', rotCorto.trim());

/* ── 7 · LA TABLA DE VERDAD, DE PUNTA A PUNTA ───────────────────────────── */
// Que las funciones estén bien no basta: hay que ver que el útil las usa. Se
// corre el comparador y se mira SU salida.
const { execFileSync } = require('child_process');
let salida = null;
try {
  salida = execFileSync('node', [path.join(RAIZ, 'tools', 'comparador_tecnologias.mjs')],
                        { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  salida = (e.stdout || '') + (e.stderr || '');
}
if (!salida || !salida.includes('COMPARADOR DE TECNOLOGÍAS')) {
  console.error('el comparador no ha dado tabla; NO se ha medido el extremo a extremo.');
  if (restaurar) restaurar();
  process.exit(2);
}
const filaTel = (salida.split('\n').find(l => l.includes('capacidad de telemetría')) || '');
check('la tabla real trae la fila de telemetría', filaTel.length > 0);
check('y NO publica "111111111111111"', !filaTel.includes('111111111111111'), filaTel.trim());
check('y sí publica 0.0611', filaTel.includes('0.0611'), filaTel.trim());
check('ninguna celda de la tabla es una ristra de un solo dígito',
      !/\s(\d)\1{8,}\s/.test(salida),
      (salida.match(/\s(\d)\1{8,}\s/) || [''])[0]);

fin();
