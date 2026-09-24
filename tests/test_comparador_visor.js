// EL COMPARADOR EN EL VISOR — la parte que aporta la INTERFAZ (fase 4, punto 6).
//
// La tabla la calcula `radio_tecnologias.js` y tiene su propio banco. Aquí se
// comprueban las tres cosas que sólo pasan en la página:
//
//   1. UN HUECO SE PINTA COMO HUECO. Ni un cero, ni un guion a secas: «no se
//      puede», y el motivo en el `title` para no tener que ir a buscarlo.
//   2. LA PÁGINA QUEDA COMO ESTABA. Comparar cambia `S.rf.variante` y la hora
//      del sol para poder preguntar por cada tecnología. Si no se devuelven,
//      mirar el comparador cambiaría el mapa de debajo — y eso es el defecto
//      del mapa pintado con el motor antiguo, otra vez.
//   3. LOS GUARDIAS. Menos de dos tecnologías, menos de dos horas, o una planta
//      sin NCU: se dice por qué, no se compara a medias.
//
// EL BLOQUE SE EXTRAE DEL `index.html` REAL, nunca se copia: una copia carearía
// una versión vieja mientras la página evoluciona. Mismo patrón que
// `tests/test_rf_cobertura.js` y `tools/_motor_app.mjs`.
//
//   node tests/test_comparador_visor.js
//   MUTA=<clave> node tests/test_comparador_visor.js     (TIENE que salir rojo)
//
// rc = 0 mide · 1 rojo · 2 no comprobado
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};

const MUTACIONES = {
  // el hueco se pinta como un guion cualquiera: quien lo lea no sabe si es un
  // cero, un fallo o un dato que falta
  huecoMudo: ['no se puede</td>', '&mdash;</td>'],
  // el motivo desaparece del title: el hueco se ve pero no se sabe de qué
  huecoSinMotivo: ['title="\'+esc(c.motivo||"")+\'"', ''],
  // la comparación deja puesta la variante de la última tecnología mirada
  noDevuelveVariante: ['if(antesVar!=null) S.rf.variante = antesVar;', ''],
  // y la hora del sol de la última hora mirada
  noDevuelveHora: ['if(antesSol && S.rf.sol) Object.assign(S.rf.sol, antesSol);', ''],
  // el guardia de las dos horas se cae
  sinGuardiaHoras: ['if(horas.length < 2) return di(', 'if(false) return di('],
  // y la letra pequeña de cómo leer la tabla
  sinLetraPequena: ['<b>Cómo leer esto.</b>', ''],
};
const MUTA = process.env.MUTA;

let html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
if (MUTA) {
  const mu = MUTACIONES[MUTA];
  if (!mu) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  const antes = html;
  html = html.replace(mu[0], mu[1]);
  if (html === antes) {
    console.error('la mutacion «' + MUTA + '» no casó con index.html. Eso es NO COMPROBADO, no rojo.');
    process.exit(2);
  }
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}

const bloque = html.match(/const CMP_ALCANCE_M[\s\S]*?\n}\n\s*(?=\/\* ══ EL VEREDICTO DE UN ENLACE)/);
if (!bloque) {
  console.log('NO SE HA PODIDO COMPROBAR: no localizo el bloque del comparador en index.html.');
  console.log('«No he podido mirar» no es «está bien».');
  process.exit(2);
}

/* ── EL CONTEXTO: lo MÍNIMO de la página, y nada fingido de más ───────────── */
const RT = require(path.join(RAIZ, 'radio_tecnologias.js'));
const casillas = [{ checked: true, value: 'a' }, { checked: true, value: 'b' }];
const els = {};
const elem = (id) => (els[id] = els[id] || { value: '', innerHTML: '', id: id });
const doc = {
  getElementById: (id) => elem(id),
  querySelectorAll: () => casillas,
};
elem('cmp-horas').value = '8,12,16';

const PARAMS = {
  tecnologias: {
    a: { nombre: 'A, con datos', procedencia: 'heredado', f_hz: 2.45e9, ptx_dbm: 19, gtx_dbi: 3, grx_dbi: 3, rx_sens_dbm: -103 },
    b: { nombre: 'B, sin sensibilidad', procedencia: 'pendiente', f_hz: 2.45e9, ptx_dbm: 14, gtx_dbi: 3, grx_dbi: 3, rx_sens_dbm: null },
    _x: { nombre: 'no es una tecnología' }
  }
};
const S = {
  planta: 'juguete', rf: { variante: 'a', sol: { on: true, horaUTC: 12345 } },
  ncus: [{ id: '01', x: 0, y: 0 }],
  motors: [], _rfRows: null, _radioParams: PARAMS
};
for (let i = 0; i < 40; i++) S.motors.push({ ncu: '01', x: i * 10, y: 0 });

let enlaceLlamadas = 0;
const ctx = {
  console, Math, JSON, Object, Array, Number, String, Date, isFinite, parseFloat, RegExp,
  document: doc, S: S, RadioTec: RT,
  rfParamsNuevo: () => S._radioParams,
  tcuPt: (m) => ({ x: m.x, y: m.y }),
  rfRows: () => ({ segs: [], span: 0, idx: null }),
  /* `rfEnlace` de mentira A PROPÓSITO: aquí se comprueba lo que aporta la
     interfaz, no la física. La física tiene sus bancos, y uno de mentira que
     pretendiera serlo sería una segunda implementación. */
  rfEnlace: (a, b) => { enlaceLlamadas++; return { margenDb: Math.hypot(a.x - b.x, a.y - b.y) < 120 ? 20 : -5 }; },
};
ctx.globalThis = ctx;
vm.createContext(ctx);
try { vm.runInContext(bloque[0], ctx); }
catch (e) { console.log('NO SE HA PODIDO COMPROBAR: el bloque no evalúa — ' + e.message); process.exit(2); }

check('el bloque del comparador se extrae y evalúa',
      typeof ctx.cmpCorrer === 'function' && typeof ctx.cmpTabla === 'function');

/* ── 1 · UN HUECO SE PINTA COMO HUECO ────────────────────────────────────── */
const tablaFalsa = {
  tecnologias: ['a', 'b'],
  filas: [{ rotulo: 'TCU cubiertas', veredicto: { texto: 'no comparable: sin dato en b' },
            celdas: { a: { min: 40, max: 40, motivo: null },
                      b: { min: null, max: null, motivo: 'falta rx_sens_dbm — ver `_que_falta`' } } },
           { rotulo: 'saltos, máximo', veredicto: { texto: 'no distinguible con lo medido' },
             celdas: { a: { min: 1, max: 3, motivo: 'varía con la hora' }, b: null } }]
};
const h = ctx.cmpTabla(tablaFalsa);
check('un hueco se pinta «no se puede», no un cero ni un guion',
      /no se puede/.test(h) && !/>0</.test(h), h.slice(0, 120));
check('  y lleva su motivo en el `title`', /title="falta rx_sens_dbm/.test(h),
      (h.match(/title="[^"]*"/g) || []).join(' | ').slice(0, 120));
check('un recorrido se pinta como recorrido, no como su punto medio',
      /1–3/.test(h), h.indexOf('1–3'));
check('el veredicto de cada criterio sale bajo su fila',
      /no distinguible con lo medido/.test(h));
check('y la letra pequeña va JUNTO a la tabla, no en otro documento',
      /Cómo leer esto/.test(h) && /cota inferior/.test(h) && /p100 = 6/.test(h));
check('  incluida la de que no hay puntuación agregada',
      /No hay puntuación agregada/.test(h));
check('el HTML no se puede inyectar desde un motivo',
      !/<script>/.test(ctx.cmpTabla({ tecnologias: ['a'], filas: [{ rotulo: 'x',
        veredicto: { texto: 'y' }, celdas: { a: { min: null, motivo: '<script>ay</script>' } } }] })));

/* ── 2 · LA PÁGINA QUEDA COMO ESTABA ─────────────────────────────────────── */
/* LA VARIANTE DE PARTIDA ES `b` A PROPÓSITO, y la primera versión de este banco
   no lo hacía: ponía `a`, que es justo la última que el comparador llega a
   evaluar —`b` no tiene sensibilidad y se descarta antes de preguntar—, así que
   la comprobación pasaba SOLA, con y sin la línea que devuelve el valor. Un
   caso de prueba que no puede distinguir las dos cosas no prueba ninguna. */
S.rf.variante = 'b'; S.rf.sol.horaUTC = 999;
enlaceLlamadas = 0;
ctx.cmpCorrer();
check('la comparación llega a preguntar por enlaces de verdad', enlaceLlamadas > 0, enlaceLlamadas);
check('y publica una tabla', /TCU cubiertas/.test(els['cmp-out'].innerHTML),
      els['cmp-out'].innerHTML.slice(0, 80));
check('DEVUELVE la variante que había, no la última que miró', S.rf.variante === 'b', S.rf.variante);
check('y la hora del sol que había', S.rf.sol.horaUTC === 999, S.rf.sol.horaUTC);

/* ── 3 · LOS GUARDIAS ────────────────────────────────────────────────────── */
elem('cmp-horas').value = '12';
ctx.cmpCorrer();
check('con una sola hora NO compara, y dice por qué',
      /al menos dos horas/i.test(els['cmp-out'].innerHTML), els['cmp-out'].innerHTML.slice(0, 90));
check('  y nombra los 27,8 dB, que es el motivo', /27,8 dB/.test(els['cmp-out'].innerHTML));
elem('cmp-horas').value = '8,12,16';
casillas[1].checked = false;
ctx.cmpCorrer();
check('con una sola tecnología NO compara, y dice por qué',
      /al menos dos<\/b> tecnolog/i.test(els['cmp-out'].innerHTML), els['cmp-out'].innerHTML.slice(0, 90));
casillas[1].checked = true;
const ncus = S.ncus; S.ncus = [];
ctx.cmpCorrer();
check('sin NCU colocadas NO compara: sin raíz no hay malla',
      /sin raíz/i.test(els['cmp-out'].innerHTML), els['cmp-out'].innerHTML.slice(0, 90));
S.ncus = ncus;

/* Y las casillas: las pendientes se ofrecen igual, rotuladas. Ofrecerlas es el
   punto — que se vea que existen y qué les falta. */
ctx.cmpPinta();
const casillasHtml = els['cmp-tecs'].innerHTML;
check('las casillas salen de radio_params.json, no de una lista escrita aquí',
      /A, con datos/.test(casillasHtml) && /B, sin sensibilidad/.test(casillasHtml));
check('  y las claves internas (las que empiezan por _) no se ofrecen',
      !/no es una tecnología/.test(casillasHtml));
check('  y una tecnología pendiente se OFRECE, rotulada como tal',
      /value="b"/.test(casillasHtml) && /pendiente/.test(casillasHtml));

/* ── EL ALCANCE ─────────────────────────────────────────────────────────── */
const PISO = 17, PISO_MUT = 6;
console.log('\nalcance: 1 bloque extraído del index.html real · ' +
            Object.keys(MUTACIONES).length + ' mutaciones (piso ' + PISO_MUT + ')');
console.log('');
if (ko) { console.log('FALLAN ' + ko + ' de ' + (ok + ko) + ' comprobaciones'); process.exit(1); }
if (ok < PISO || Object.keys(MUTACIONES).length < PISO_MUT) {
  console.log('ALCANCE INSUFICIENTE: nada ha fallado, pero esto no ha mirado bastante (' +
              ok + ' de ' + PISO + ').');
  process.exit(2);
}
console.log('TODO OK — ' + ok + ' comprobaciones');
