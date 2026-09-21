/* LA ANTENA DE LA TCU NO ESTÁ DONDE EL MOTOR CREÍA.
 *
 * El motor la ponía a una cota fija —`RF_ANT_H = 1.5`, heredada y sin medir— y
 * en el EJE de su fila. Las dos cosas son falsas: el conector cuelga del tubo y
 * GIRA CON ÉL, así que la antena es «anclaje rotado por alfa, más la caída del
 * coax», y eso la desplaza también EN LATERAL.
 *
 * Este banco fija las dos consecuencias que ese cambio trae, y son las dos que
 * el encargo pedía:
 *
 *   1. LA FILA PROPIA. Por el lado alto el módulo se aleja del rayo y queda
 *      libre; por el bajo el módulo baja hacia él, y a partir de cierto alfa la
 *      antena ya no cuelga en el hueco: está DENTRO de la banda.
 *   2. EL CAMPO CERCANO. El cruce de la propia fila cae a menos de 2 lambdas de
 *      la antena, donde el filo de cuchillo no aplica. Lo que sale de ahí tiene
 *      que ser un estado con motivo, no un número de dB.
 *
 * Las cotas NO se afirman aquí: salen de `radio_params.json`, que cita
 * `seguidor.js` y `terreno.html` línea a línea.
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');

/* ── MUTACIONES ───────────────────────────────────────────────────────────
   Cada una rompe UNA afirmación del modelo de antena. Se corren en la CI y se
   exige rc = 1 exacto. */
const MUTACIONES = {
  // el anclaje deja de girar: vuelve la cota fija de siempre
  anclaFija:      ['radio_pv_model.js', /return \{ dz: -r \* Math\.cos\(a\), lateral: r \* Math\.sin\(a\) \};/,
                                        'return { dz: -r, lateral: 0 };'],
  // se pierde el desplazamiento lateral, que es el que decide por qué lado sale
  sinLateral:     ['radio_pv_model.js', /lateral: r \* Math\.sin\(a\)/, 'lateral: 0'],
  // la holgura se mide al suelo y no al borde bajo del módulo
  holguraAlSuelo: ['radio_pv_model.js', /var zBot = -\(cuerdaM \/ 2\) \* Math\.abs\(Math\.sin\(a\)\);/,
                                        'var zBot = 0;'],
  // el campo cercano se mide en metros fijos en vez de en lambdas: deja de
  // depender de la frecuencia, que es justo lo que no se puede hacer
  cercaSinLambda: ['radio_pv_model.js', /return \{ cerca: d < u \* lam,/, 'return { cerca: d < u * 0.1224,'],
  // el patrón vuelve a ser plano aunque se pida dipolo
  patronPlano:    ['radio_pv_model.js', /if \(p !== "dipolo"\) throw/, 'if (true) return 0; if (p !== "dipolo") throw'],
  // el conductor perfecto vuelve a dar NaN en silencio
  conductorNaN:   ['radio_pv_model.js', /if \(epsR === Infinity\) return cx\(1\.0, 0\.0\);/, ''],
};
const MUTA = process.env.MUTA;
const fuentes = {};
function lee(rel) {
  if (fuentes[rel] === undefined) fuentes[rel] = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  return fuentes[rel];
}
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  const antes = lee(m[0]);
  const despues = antes.replace(m[1], m[2]);
  if (despues === antes) { console.error('la mutacion «' + MUTA + '» no casó con el código'); process.exit(2); }
  fuentes[m[0]] = despues;
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}

/* se carga el módulo DEL REPO, con la mutación si la hay, no una copia */
const R = (function () {
  const mod = { exports: {} };
  new Function('module', 'exports', 'window', lee('radio_pv_model.js'))(mod, mod.exports, undefined);
  return mod.exports;
})();
const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8')).geometria;

let ok = 0, ko = 0;
function check(msg, cond, extra) {
  if (cond) { ok++; console.log('  ok   ' + msg); }
  else { ko++; console.log('  FALLO ' + msg + (extra !== undefined ? '  → ' + extra : '')); }
}
const cerca = (a, b, tol) => Math.abs(a - b) < (tol === undefined ? 1e-9 : tol);

const RAD = P.antena_tcu.radio_ancla_m.valor;     // 0,225 m — seguidor.js:340
const CAI = P.antena_tcu.coax_caida_m.valor;      // 0,50 m  — seguidor.js:35
const CUE = P.cuerda_m_defecto.valor;             // 2,38 m
const F24 = 2.45e9;

/* ══ 1. LOS PARÁMETROS SALEN DEL JSON, NO DE AQUÍ ════════════════════════ */
console.log('\n· los parametros vienen con procedencia');
check('radio del anclaje = 0,225 m', cerca(RAD, 0.225), RAD);
check('caida del coax = 0,50 m', cerca(CAI, 0.50), CAI);
check('los dos citan su fichero y linea',
      /seguidor\.js:340/.test(P.antena_tcu.radio_ancla_m._fuente) &&
      /seguidor\.js:35\b/.test(P.antena_tcu.coax_caida_m._fuente));
check('la NCU son 3,15 m con su plano DR_NCU_v0',
      cerca(P.antena_ncu_m.valor, 3.15) && /DR_NCU_v0/.test(P.antena_ncu_m._fuente));
check('la HSU son 6,50 m con su plano FTR.24.00145_5_C',
      cerca(P.antena_hsu_m.valor, 6.50) && /FTR\.24\.00145_5_C/.test(P.antena_hsu_m._fuente));
/* EL COMENTARIO OBSOLETO DE LA FUENTE. `equipos.js:15` dice «~8,3 m» donde el
   código dice 6,50. Mientras siga ahí, el `_ojo` tiene que avisarlo: si alguien
   arregla el comentario y quita el aviso, este banco se lo recuerda. */
check('el _ojo de la HSU avisa del comentario obsoleto de equipos.js:15',
      JSON.stringify(P.antena_hsu_m._ojo).includes('8,3'));

/* ══ 2. EL ANCLAJE GIRA ═══════════════════════════════════════════════════ */
console.log('\n· el anclaje gira con el tubo');
check('a 0° el anclaje esta justo debajo del eje y sin lateral',
      cerca(R.anclaAntena(RAD, 0).dz, -RAD) && cerca(R.anclaAntena(RAD, 0).lateral, 0));
check('a 90° el anclaje esta A LA ALTURA del eje y todo el radio en lateral',
      cerca(R.anclaAntena(RAD, 90).dz, 0, 1e-15) && cerca(R.anclaAntena(RAD, 90).lateral, RAD));
/* Lo que de verdad hay que retener: la vertical se mueve poco y la lateral no. */
const v30 = RAD - Math.abs(R.anclaAntena(RAD, 30).dz);   // cuanto SUBE respecto a 0°
const l30 = R.anclaAntena(RAD, 30).lateral;
check('a 30° sube 3,0 cm en vertical', cerca(v30, 0.0301, 1e-4), (v30 * 100).toFixed(2) + ' cm');
check('a 30° se desplaza 11,3 cm en LATERAL, casi cuatro veces mas',
      cerca(l30, 0.1125, 1e-4) && l30 > 3 * v30, (l30 * 100).toFixed(2) + ' cm');
check('el lateral cae del mismo lado que el borde ALTO del modulo',
      R.anclaAntena(RAD, 30).lateral > 0 && (CUE / 2) * Math.cos(30 * R.GRADO) > 0);

/* La cota, contra la tabla del encargo */
console.log('\n· la cota de la antena, alfa a alfa');
const EJE = 1.5;
[[0, -0.7250], [15, -0.7173], [30, -0.6949], [45, -0.6591], [55, -0.6291], [60, -0.6125]]
  .forEach(function (c) {
    const h = R.alturaAntenaTCU(EJE, RAD, CAI, c[0]);
    check('alfa ' + c[0] + '°: antena a eje ' + c[1].toFixed(4),
          cerca(h - EJE, c[1], 5e-5), (h - EJE).toFixed(4));
  });
check('a 0° es EXACTAMENTE el «tubo − 0,725» de siempre',
      cerca(R.alturaAntenaTCU(EJE, RAD, CAI, 0), EJE - 0.725));

/* ══ 3. LA FILA PROPIA: LOS DOS LADOS ════════════════════════════════════ */
/* EL LADO ALTO: el módulo se ALEJA del rayo. El borde que cuenta es el de
   arriba, que sube (c/2)·sen alfa mientras la antena apenas se mueve, así que
   el despeje CRECE con alfa y el rayo va libre por debajo.
   EL LADO BAJO: el módulo BAJA hacia el rayo. El borde que cuenta es el de
   abajo, y el despeje es la holgura, que se estrecha hasta cambiar de signo. */
console.log('\n· la fila propia, por el lado ALTO (libre) y por el BAJO (cruza)');
[0, 15, 30, 45, 55].forEach(function (al) {
  const b = R.banda(0, CUE, al, -EJE);                       // banda de SU modulo, eje en 0
  const z = R.alturaAntenaTCU(0, RAD, CAI, al);              // antena, respecto al eje
  const alto = R.corta(b, z).borde === b.zBot ? b.zTop - z : null;
  check('alfa ' + String(al).padStart(2) + '° lado ALTO: el borde de arriba se aleja (' +
        (b.zTop - z).toFixed(3) + ' m de despeje)', (b.zTop - z) > 0.7 &&
        (al === 0 || (b.zTop - z) > (R.banda(0, CUE, 0, -EJE).zTop - R.alturaAntenaTCU(0, RAD, CAI, 0))));
});
console.log('');
[[0, 0.7250, 'hueco'], [15, 0.4093, 'hueco'], [30, 0.1001, 'hueco'],
 [45, -0.1824, 'tapado'], [55, -0.3457, 'tapado']].forEach(function (c) {
  const h = R.holguraBajoModulo(RAD, CAI, CUE, c[0]);
  const b = R.banda(0, CUE, c[0], -EJE);
  const est = R.corta(b, R.alturaAntenaTCU(0, RAD, CAI, c[0])).estado;
  check('alfa ' + String(c[0]).padStart(2) + '° lado BAJO: holgura ' +
        (c[1] * 100).toFixed(1) + ' cm → «' + c[2] + '»',
        cerca(h, c[1], 5e-4) && est === c[2], (h * 100).toFixed(1) + ' cm / «' + est + '»');
});

/* EL CAMBIO DE SIGNO, que es el resultado que hay que poder citar */
console.log('\n· y donde cambia de signo');
function cruce(cuerda) {
  let lo = 0, hi = 90;
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2;
    if (R.holguraBajoModulo(RAD, CAI, cuerda, m) > 0) lo = m; else hi = m;
  }
  return lo;
}
check('con cuerda 2,380 m la antena entra en su propia banda a 35,1°',
      cerca(cruce(2.380), 35.09, 0.02), cruce(2.380).toFixed(2) + '°');
check('con cuerda 2,411 m (Fayon) a 34,6°', cerca(cruce(2.411), 34.63, 0.02), cruce(2.411).toFixed(2) + '°');
check('el cruce cae DENTRO del recorrido de trabajo (los seguidores llegan a 55°)',
      cruce(2.380) < 55);
check('por encima del cruce la holgura es negativa en TODO el resto del recorrido',
      [40, 45, 50, 55, 60].every(a => R.holguraBajoModulo(RAD, CAI, CUE, a) < 0));

/* ══ 4. EL CAMPO CERCANO ═════════════════════════════════════════════════ */
console.log('\n· el campo cercano, donde el filo de cuchillo no vale');
const LAM = R.longitudOnda(F24);
check('lambda a 2,45 GHz son 12,24 cm', cerca(LAM, 0.12236, 1e-5), LAM.toFixed(5));
/* el cruce de la propia fila, con la antena en su sitio */
[[15, 90, 0.058], [30, 90, 0.1125], [45, 90, 0.1591], [30, 30, 0.225]].forEach(function (c) {
  const e = R.anclaAntena(RAD, c[0]).lateral;
  const d = e / Math.sin(c[1] * R.GRADO);
  const cc = R.campoCercano(d, 100, F24, P.campo_cercano_lambdas.valor);
  check('alfa ' + c[0] + '°, enlace a ' + c[1] + '° de la fila: cruza su propia fila a ' +
        d.toFixed(3) + ' m = ' + cc.lambdas.toFixed(1) + ' lambdas → campo cercano',
        cerca(d, c[2], 1e-3) && cc.cerca, d.toFixed(3) + ' / ' + cc.lambdas.toFixed(2) + 'L');
});
check('un cruce a 3,0 m (el filaZ de la bifila) NO es campo cercano',
      !R.campoCercano(3.0, 100, F24, 2).cerca);
/* LA FRECUENCIA MANDA, y por eso el umbral va en lambdas: a 868 MHz la misma
   geometría está MÁS cerca en longitudes de onda. */
const c24 = R.campoCercano(0.30, 100, F24, 2), c868 = R.campoCercano(0.30, 100, 868e6, 2);
check('a 30 cm: a 2,45 GHz son 2,5 lambdas (lejos) y a 868 MHz 0,9 (cerca)',
      !c24.cerca && c868.cerca, c24.lambdas.toFixed(2) + 'L vs ' + c868.lambdas.toFixed(2) + 'L');
check('el umbral sale del JSON, no del codigo', P.campo_cercano_lambdas.valor === 2);
check('y el JSON DICE que no esta medido contra campo',
      JSON.stringify(P.campo_cercano_lambdas._ojo).includes('NO ESTÁ MEDIDO'));

/* ══ 5. EL PATRÓN ════════════════════════════════════════════════════════ */
console.log('\n· el patron de antena');
check('en el horizonte vale 0 dB exactos', cerca(R.gananciaPatronDb(0, 'dipolo'), 0));
check('«iso» devuelve 0 en todas las elevaciones',
      [0, 0.3, 1.0, 1.5, -0.8].every(e => R.gananciaPatronDb(e, 'iso') === 0));
check('SOLO RESTA: nunca da un valor positivo',
      [0, 0.05, 0.3, 0.7, 1.0, 1.4, -0.3, -1.0].every(e => R.gananciaPatronDb(e, 'dipolo') <= 0));
check('es PAR en la elevacion (el dipolo no distingue arriba de abajo)',
      [0.2, 0.7, 1.2].every(e => cerca(R.gananciaPatronDb(e, 'dipolo'), R.gananciaPatronDb(-e, 'dipolo'))));
check('en el eje del latigo hay un nulo, acotado a −60 dB',
      R.gananciaPatronDb(Math.PI / 2, 'dipolo') === -60);
check('un patron desconocido LANZA, no cae a plano', (function () {
  try { R.gananciaPatronDb(0.1, 'yagi'); return false; } catch (e) { return /no implementado/.test(e.message); }
})());
/* CUÁNTO VALE DE VERDAD, que es lo que no se puede exagerar */
const dos = (hA, hB, D) => 2 * R.gananciaPatronDb(Math.atan2(hB - hA, D), 'dipolo');
check('en el careo (dos antenas a la MISMA altura) resta CERO EXACTO',
      dos(1.5, 1.5, 12) === 0 && dos(0.775, 0.775, 338) === 0);
check('TCU→NCU a 12 m (1,5 → 3,15 m): −0,24 dB', cerca(dos(1.5, 3.15, 12), -0.238, 5e-3), dos(1.5, 3.15, 12).toFixed(3));
check('TCU→HSU a 12 m (1,5 → 6,50 m): −1,99 dB', cerca(dos(1.5, 6.50, 12), -1.994, 5e-3), dos(1.5, 6.50, 12).toFixed(3));
check('a 100 m ya es despreciable (< 0,05 dB en los dos saltos)',
      Math.abs(dos(1.5, 3.15, 100)) < 0.05 && Math.abs(dos(1.5, 6.50, 100)) < 0.05);

/* ══ 6. EL CONDUCTOR PERFECTO ════════════════════════════════════════════ */
console.log('\n· el conductor perfecto ya no miente');
const g = R.coefReflexion(0.25, Infinity, 5e-3, F24, 'v');
check('Gamma = +1 exacto', g.re === 1 && g.im === 0, JSON.stringify(g));
const pl = R.dosRayosDb(100, 1.5, 1.5, F24, Infinity, 5e-3, 'v');
check('y dos rayos da un numero, no NaN', Number.isFinite(pl), pl);
check('un epsR invalido LANZA en vez de propagar NaN', (function () {
  try { R.coefReflexion(0.25, 0, 5e-3, F24, 'v'); return false; } catch (e) { return /epsR inválido/.test(e.message); }
})());
check('la tierra real sigue dando lo de siempre',
      Number.isFinite(R.dosRayosDb(100, 1.5, 1.5, F24, 15.0, 5e-3, 'v')));

console.log('\n' + (ko ? '✗ ' + ko + ' FALLOS de ' + (ok + ko) : '✓ ' + ok + ' comprobaciones'));
process.exit(ko ? 1 : 0);
