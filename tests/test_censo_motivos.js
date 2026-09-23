/* EL CENSO DE MOTIVOS TIENE QUE SALIR PUBLICADO, NO EN UN LOG.
 *
 * ═══ POR QUÉ ESTE BANCO EXISTE ═══
 *
 * `recortaPerfil` rechazaba 568 de 6.036 enlaces reales —el 9,4 %— por un
 * déficit de 2,13e-13 m. Esos enlaces salían con el motivo
 * `relieve_perfil_no_cubre_el_vano`, o sea SIN término de relieve, con el
 * terreno delante y desde el primer día.
 *
 * El motivo estaba. En cada enlace. Lo que NO había era nadie que los contara.
 * Un «9,4 % no cubre el vano» al pie del informe de #87 habría saltado a la
 * vista de cualquiera.
 *
 * Así que esto no comprueba que el censo se pueda calcular: comprueba que SE
 * PUBLICA. Un contador correcto que nadie imprime no habría cazado nada.
 *
 * ═══ QUÉ SE EXIGE, Y DÓNDE ═══
 *
 *   · `censoMotivos`/`censoTexto` cuentan bien y traen el DENOMINADOR;
 *   · `tools/antes_despues_terreno.mjs` lo imprime EN SU SALIDA, corriéndolo
 *     de verdad y leyendo su stdout — no mirando su código fuente;
 *   · `index.html` acumula el censo en `rfEnlace` —la única puerta por la que
 *     pasan todos los enlaces— y lo pinta en la leyenda.
 *
 * USO:  node tests/test_censo_motivos.js
 *       MUTA=<clave> node tests/test_censo_motivos.js   (TIENE que salir rojo)
 */
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const RAIZ = path.join(__dirname, '..');

const MUTACIONES = {
  // el censo deja de traer el denominador: «568» sin saber de cuántos
  sinDenominador: ['radio_zigbee.js', /return t\.join\(" · "\) \+ "   \[de " \+ censo\.n \+ " enlaces\]";/,
                                      'return t.join(" · ");'],
  // ...o pierde el porcentaje, que es lo que convierte 568 en 9,4 %
  sinPorcentaje:  ['radio_zigbee.js', /" \(" \+ \(100 \* pares\[i\]\[1\] \/ censo\.n\)\.toFixed\(1\) \+ " %\)"/, '""'],
  // el censo deja de contar los enlaces sin margen, que son justo los mudos
  sinMudos:       ['radio_zigbee.js', /if \(p\.margenDb == null\) out\.sinMargen\+\+; else out\.conMargen\+\+;/,
                                      'out.conMargen++;'],
  // y el informe deja de imprimirlo: el contador existe y nadie lo ve
  informeMudo:    ['tools/antes_despues_terreno.mjs',
                   /console\.log\('  CENSO DE MOTIVOS DE RELIEVE: ' \+ RZ\.censoTexto\(censo, 'relieve'\)\);/,
                   ';'],
};
const MUTA = process.env.MUTA;
let casada = false;
const copias = [];
function ponMutacion() {
  if (!MUTA) return;
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  const f = path.join(RAIZ, m[0]);
  const orig = fs.readFileSync(f, 'utf8');
  const nuevo = orig.replace(m[1], m[2]);
  if (nuevo === orig) { console.error('la mutacion «' + MUTA + '» no casó con ' + m[0]); process.exit(2); }
  copias.push([f, orig]);
  fs.writeFileSync(f, nuevo);
  casada = true;
  console.log('### MUTACION «' + MUTA + '» PUESTA en ' + m[0] + ': este banco TIENE que salir rojo\n');
}
function quitaMutacion() { for (const [f, o] of copias) fs.writeFileSync(f, o); }
process.on('exit', quitaMutacion);
process.on('SIGINT', function () { quitaMutacion(); process.exit(130); });
ponMutacion();
if (MUTA && !casada) { console.error('la mutacion no llegó a ponerse'); process.exit(2); }

let ok = 0, ko = 0;
const check = (q, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + q); }
  else { ko++; console.log('FAIL ' + q + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};

/* ── 1 · EL CENSO CUENTA BIEN ─────────────────────────────────────────── */
console.log('· el censo cuenta, y trae el denominador');
const RZ = require(path.join(RAIZ, 'radio_zigbee.js'));
{
  const P = [
    { margenDb: 10, motivos: ['relieve_no_evaluado_sin_perfil'] },
    { margenDb: 12, motivos: ['relieve_no_evaluado_sin_perfil', 'vegetacion_no_modelada'] },
    { margenDb: null, motivos: ['relieve_antena_bajo_la_tierra_lisa'] },
    { margenDb: 5, motivos: [] }
  ];
  const c = RZ.censoMotivos(P);
  check('cuenta los enlaces', c.n === 4, c.n);
  check('y los que se quedan sin margen', c.sinMargen === 1 && c.conMargen === 3, c);
  check('cuenta cada motivo', c.motivos.relieve_no_evaluado_sin_perfil === 2, c.motivos);
  check('el censo vacio no revienta', RZ.censoMotivos([]).n === 0 && RZ.censoMotivos(null).n === 0);

  const txt = RZ.censoTexto(c, 'relieve');
  check('el texto trae el PORCENTAJE, no solo la cuenta', /50\.0 %/.test(txt), txt);
  check('y el DENOMINADOR: sin el, «568» no dice si es de 6.000 o de 600',
        /de 4 enlaces/.test(txt), txt);
  check('filtra por prefijo', !/vegetacion/.test(txt), txt);
  check('ordena de mas a menos', txt.indexOf('sin_perfil') < txt.indexOf('tierra_lisa'), txt);
}

/* ── 2 · Y EL INFORME LO IMPRIME, CORRIÉNDOLO DE VERDAD ───────────────── */
console.log('\n· el informe lo publica EN SU SALIDA');
{
  /* Se ejecuta el útil y se lee su stdout. Mirar su código fuente no valdría:
     lo que se exige es que el número LLEGUE a quien lee el informe. */
  const r = cp.spawnSync(process.execPath, [path.join(RAIZ, 'tools', 'antes_despues_terreno.mjs')],
                         { encoding: 'utf8', timeout: 900000 });
  const salida = (r.stdout || '') + (r.stderr || '');
  check('el informe arranca', r.status === 0, r.status);
  if (/SIN MEDIDA/.test(salida)) {
    /* Sin terreno no hay informe, y eso NO es un aprobado: se dice. */
    check('SIN TERRENO: no se ha podido comprobar que lo publique', false, 'falta terreno/');
  } else {
    check('imprime el CENSO DE MOTIVOS', /CENSO DE MOTIVOS/.test(salida));
    check('con porcentaje', /\d+\.\d %\)/.test(salida));
    check('y con el denominador', /de \d+ enlaces/.test(salida));
    check('y cuantos se quedan sin margen', /sin margen: \d+ de \d+/.test(salida));
    /* EL CASO QUE DE VERDAD IMPORTA: que un motivo REAL aparezca contado. Con
       terreno de solo DEM, la puerta de vano corto dispara y tiene que verse. */
    check('un motivo real sale contado, no solo la cabecera',
          /relieve_dem_sin_resolucion_a_este_vano \d+ \(\d+\.\d %\)/.test(salida),
          (salida.match(/CENSO[^\n]*/g) || []).slice(0, 2));
  }
}

/* ── 3 · Y LA APP, QUE ES DONDE SE MIRA ──────────────────────────────── */
console.log('\n· la app lo acumula y lo pinta');
{
  const H = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  check('el censo se acumula en rfEnlace, la unica puerta por la que pasan todos',
        /S\._censo\.n\+\+/.test(H) && H.indexOf('S._censo.n++') > H.indexOf('function rfEnlace'));
  check('se REINICIA en cada pintado (si no, cuenta el mismo enlace muchas veces)',
        /function censoArranca\(\)\{\s*S\._censo=\{n:0/.test(H));
  check('y se arranca antes de construir el raster', /censoArranca\(\);/.test(H));
  check('la leyenda lo pinta', /motivos de relieve:/.test(H));
  /* Y NO EN LA CONSOLA: un `console.log` no lo lee quien decide donde va la
     NCU. Se comprueba que el texto del censo no acabe SOLO en consola. */
  check('no se publica solo por consola',
        H.indexOf('motivos de relieve:') > 0 && !/console\.log\([^)]*motivos de relieve/.test(H));
}

console.log('');
console.log(ko ? 'FALLAN ' + ko + ' de ' + (ok + ko) : 'TODO OK — ' + ok + ' comprobaciones');
if (MUTA) console.log(ko ? '### bien: la mutacion «' + MUTA + '» sale roja'
                         : '### MAL: la mutacion «' + MUTA + '» pasa desapercibida');
process.exit(ko ? 1 : 0);
