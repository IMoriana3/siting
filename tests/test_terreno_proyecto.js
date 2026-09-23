/* EL TERRENO QUE VIAJA CON EL PROYECTO, Y EL SHA QUE LO VIGILA.
 *
 * `terreno_proyecto.js` es el puente entre el artefacto que produce
 * cobertura-zigbee y la pantalla: lo baja cuando se abre esa planta, comprueba
 * su sha, alinea los dos sistemas de coordenadas y dice por pantalla QUÉ
 * terreno se está usando.
 *
 * ═══ LO QUE SE PRUEBA, Y CON QUÉ ═══
 *
 * Con un `fetch` DE MENTIRA, no con la red: así se pueden provocar los casos
 * que en la vida real sólo se ven el día malo —el sha que no cuadra, el
 * fichero que no llega, el JSON roto— sin esperar a que pasen.
 *
 * Y el artefacto de prueba se construye AQUÍ, pequeño, con su sha256 calculado
 * de verdad por `node:crypto`. No se usa el fichero real de 1,5 MB: un banco
 * que dependa de él sale verde en esta máquina y rojo en la CI, que es la
 * avería que este repo ya se comió una vez.
 *
 * ═══ EL SHA SE COMPRUEBA POR DOS LADOS, Y NO ES REDUNDANTE ═══
 *
 *   · el del PRESET contra el del MANIFIESTO — el preset fija qué terreno
 *     espera ESTE proyecto; sin esto, cambiar los dos a la vez colaría;
 *   · el del MANIFIESTO contra el FICHERO — lo que de verdad se va a usar.
 *
 * USO:  node tests/test_terreno_proyecto.js
 *       MUTA=<clave> node tests/test_terreno_proyecto.js      (TIENE que salir rojo)
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const RAIZ = path.join(__dirname, '..');

const MUTACIONES = {
  // el sha del fichero deja de comprobarse: un terreno cambiado cuela
  shaFicheroCiego: ['terreno_proyecto.js', /if \(sha !== null && man\.sha256 && sha !== man\.sha256\) \{/, 'if (false) {'],
  // ...y el del preset contra el manifiesto, que es el otro lado
  shaPresetCiego:  ['terreno_proyecto.js', /if \(decl\.sha256 && man\.sha256 && decl\.sha256 !== man\.sha256\) \{/, 'if (false) {'],
  // el desfase entre sistemas se pierde: el terreno se sitúa donde no está
  sinDesfase:      ['terreno_proyecto.js', /return \{ dx: preset\.ox - man\.cE, dn: preset\.oy - man\.cN \};/,
                                           'return { dx: 0, dn: 0 };'],
  // un preset sin origen UTM deja de ser un problema y se sitúa a ojo
  origenAOjo:      ['terreno_proyecto.js', /if \(!preset \|\| preset\.ox == null \|\| preset\.oy == null\) return null;/,
                                           'if (!preset) return null; if (preset.ox == null) preset = { ox: 0, oy: 0 };'],
  /* el rótulo deja de distinguir de qué está hecho el terreno.
     EL ANCLA SE MOVIÓ AL AÑADIR LA CALIDAD al texto y la mutación salió rc = 2
     —«ya no casa»—, que es lo que la regla de «rc = 1 EXACTO» existe para
     cazar. Se re-ancla en el trozo que de verdad distingue el tipo. */
  rotuloMudo:      ['terreno_proyecto.js', /\(TIPOS\[m\.tipo\] \|\| m\.tipo \|\| "\?"\) \+ " · " \+ marca,/,
                                           '"terreno",'],
  /* LA CALIDAD DESAPARECE DEL RÓTULO: un terreno de solo DEM se presentaría
     igual que uno validado contra levantamiento, que es de ×17 a ×28 peor. */
  calidadMuda:     ['terreno_proyecto.js', /var marca = val === true \? "validado" : \(val === false \? "⚠ SIN VALIDAR" : "⚠ calidad no declarada"\);/,
                                           'var marca = "validado";'],
  /* EL ± DEL RELIEVE DEJA DE PUBLICARSE. Nada más se rompe: el mapa sigue
     pintando igual y los bancos del relieve siguen verdes. Lo único que se
     pierde es que un relieve de 8 dB con ±13 se enseñe como si fuera exacto. */
  sinIncertidumbre:['terreno_proyecto.js', /if \(!z\) return null;/, 'if (!z) return null; return null;'],
  /* Y SE COGE EL MEJOR DE LOS DOS EN VEZ DEL PEOR. Ayora da ±3,74 donde San
     José da ±12,94: quedarse con el cómodo cuenta menos de un tercio del
     error, y nadie lo notaría porque el número sigue saliendo. */
  incertidumbreComoda: ['terreno_proyecto.js', /for \(var i = 1; i < v\.length; i\+\+\) if \(v\[i\] > peor\) peor = v\[i\];/,
                                           'for (var i = 1; i < v.length; i++) if (v[i] < peor) peor = v[i];'],
  // «no se pudo verificar el sha» se presenta como verificado
  shaFingido:      ['terreno_proyecto.js', /var verificado = \(sha !== null\);/, 'var verificado = true;'],
  // la planta sin terreno deja de decirlo y se calla
  sinTerrenoMudo:  ['terreno_proyecto.js', /motivo: MOTIVOS\.SIN_DECLARAR,\s*\n\s*detalle: "el preset de esta planta no declara terreno" \}\);/,
                                           'motivo: null, detalle: "" });'],
};
const MUTA = process.env.MUTA;
let casada = false;
function fuenteDe(rel) {
  let t = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  if (!MUTA) return t;
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  if (m[0] !== rel) return t;
  const antes = t; t = t.replace(m[1], m[2]);
  if (t === antes) { console.error('la mutacion «' + MUTA + '» no casó con ' + rel); process.exit(2); }
  casada = true;
  console.log('### MUTACION «' + MUTA + '» PUESTA en ' + rel + ': este banco TIENE que salir rojo\n');
  return t;
}

/* ── EL ARTEFACTO DE PRUEBA ───────────────────────────────────────────────
   Malla 5×5 a 6 m con una rampa suave, para que el relieve salga 0 exacto y se
   note si el muestreo cae donde no debe. Los orígenes son los REALES de Ayora,
   para que el desfase que se comprueba sea el de verdad: el preset de la app
   declara ox/oy y el terreno cE/cN, y entre ellos hay 1.238,55 / 1.392,15 m. */
const OX = 657843.2, OY = 4330114.3, CE = 659081.75, CN = 4331506.45;
const DX = OX - CE, DN = OY - CN;                    // −1238.55, −1392.15
const z = [];
for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) z.push(+(739.23 + 0.05 * i * 6).toFixed(2));
const RELIEVE = { planta: 'banco', crs: 'EPSG:25830', cE: CE, cN: CN,
                  x0: -24, n0: -24, paso: 6, nx: 9, nn: 9,
                  productor: 'banco v1', tipo: 'empalme', generado: '2026-09-23',
                  eje_m: 1.2, eje_medido: false, z: z };
const TEXTO = JSON.stringify(RELIEVE);
const SHA = crypto.createHash('sha256').update(TEXTO, 'utf8').digest('hex');
const MAN = { fichero: 'banco_relieve.json', sha256: SHA, bytes: TEXTO.length,
              productor: 'banco v1', tipo: 'empalme', generado: '2026-09-23',
              planta: 'banco', crs: 'EPSG:25830', cE: CE, cN: CN, paso: 6, nx: 9, nn: 9,
              eje_m: 1.2, eje_medido: false };

/* ── EL FETCH DE MENTIRA ──────────────────────────────────────────────────
   Sirve lo que se le diga y apunta qué se le pidió: así se comprueba también
   que NO se baja el fichero grande hasta que hace falta. */
function hazFetch(tabla) {
  const pedidos = [];
  const f = function (url) {
    pedidos.push(String(url));
    const v = tabla[String(url)];
    if (v === undefined) return Promise.resolve({ ok: false, status: 404 });
    if (v instanceof Error) return Promise.reject(v);
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: k => (k.toLowerCase() === 'content-length' ? String(Buffer.byteLength(v)) : null) },
      json: () => Promise.resolve(JSON.parse(v)),
      text: () => Promise.resolve(v),
      body: null            // sin streaming: se ejercita la rama de `text()`
    });
  };
  f.pedidos = pedidos;
  return f;
}

/* ── EL CONTEXTO ──────────────────────────────────────────────────────────
   `crypto.subtle` de node vale: es la misma API que el navegador. Se pasa a
   propósito para ejercitar la verificación de verdad y no la rama del «no se
   puede verificar». */
function nuevoCtx() {
  const ctx = { console: console, module: { exports: {} },
                TextEncoder: TextEncoder, TextDecoder: TextDecoder,
                crypto: { subtle: crypto.webcrypto.subtle } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'terreno_planta.js'), 'utf8'), ctx);
  ctx.require = function (m) { if (/terreno_planta/.test(m)) return ctx.TerrenoPlanta; throw new Error('require inesperado: ' + m); };
  vm.runInContext(fuenteDe('terreno_proyecto.js'), ctx);
  return ctx;
}
const ctx0 = nuevoCtx();
if (MUTA && !casada) { console.error('la mutacion «' + MUTA + '» no llegó a ponerse'); process.exit(2); }
const R = require(path.join(RAIZ, 'radio_pv_model.js'));

let ok = 0, ko = 0;
function check(q, cond, detalle) {
  if (cond) { ok++; console.log('OK   ' + q); }
  else { ko++; console.log('FAIL ' + q + (detalle != null ? ' -> ' + detalle : '')); }
}
const PRESET = { ox: OX, oy: OY, sc: 'banco', name: 'Banco 00000',
                 terreno: { manifiesto: 'banco_relieve.sha256.json', sha256: SHA } };
const TABLA = { 'terreno/banco_relieve.sha256.json': JSON.stringify(MAN),
                'terreno/banco_relieve.json': TEXTO };

(async function () {
  const TP = ctx0.TerrenoProyecto;

  /* ══ 1 · EL CAMINO BUENO, Y QUE LA CARGA ES PEREZOSA ═══════════════════ */
  console.log('\n── 1 · carga, sha y pereza ──');
  const f1 = hazFetch(TABLA);
  const pasos = [];
  const c1 = await TP.carga(PRESET, { fetch: f1, onProgreso: (fr, t) => pasos.push([fr, t]) });
  check('carga con el sha bueno', c1.ok === true, c1.motivo + ' ' + c1.detalle);
  check('y dice que el sha SE verificó', c1.shaVerificado === true);
  check('pide el manifiesto ANTES que el fichero grande',
        f1.pedidos[0].endsWith('.sha256.json'), f1.pedidos.join(' · '));
  check('y sólo pide dos cosas: manifiesto y fichero', f1.pedidos.length === 2, f1.pedidos.length);
  check('avisa del progreso', pasos.length >= 2, JSON.stringify(pasos));
  check('y el último progreso es el 100 %', pasos[pasos.length - 1][0] === 1, JSON.stringify(pasos[pasos.length - 1]));

  /* La segunda carga del MISMO sha no vuelve a bajar nada. */
  const f2 = hazFetch(TABLA);
  const c1b = await TP.carga(PRESET, { fetch: f2 });
  check('la segunda vez NO baja el fichero otra vez', f2.pedidos.length === 1 && c1b.ok,
        f2.pedidos.join(' · '));

  /* ══ 2 · EL DESFASE ENTRE SISTEMAS ════════════════════════════════════ */
  console.log('\n── 2 · los dos sistemas de coordenadas ──');
  check('el desfase sale de los artefactos, no tecleado: dx = ox − cE',
        Math.abs(c1.dx - DX) < 1e-9 && Math.abs(c1.dn - DN) < 1e-9, c1.dx + ' / ' + c1.dn);
  check('y vale −1.238,55 / −1.392,15 m, que es el de Ayora',
        Math.abs(c1.dx + 1238.55) < 1e-6 && Math.abs(c1.dn + 1392.15) < 1e-6, c1.dx + ' / ' + c1.dn);
  /* Un punto en coordenadas de la APP tiene que muestrear el terreno en el
     sitio correcto: se comprueba contra `cotaEn` llamado a mano con el desfase
     ya aplicado, que es la cuenta que esto promete hacer. */
  const px = 1238.55 + 0, py = 1392.15 + 0;        // → (0,0) en el terreno
  const directo = ctx0.TerrenoPlanta.cotaEn(c1.T, 0, 0);
  const porElPuente = TP.perfilDeEnlace(c1, px, py, px + 12, py, {});
  check('un punto de la app muestrea el terreno donde toca',
        porElPuente.perfil && Math.abs(porElPuente.perfil[0][1] - directo) < 1e-9,
        (porElPuente.perfil ? porElPuente.perfil[0][1] : porElPuente.motivo) + ' vs ' + directo);

  /* ══ 3 · LA CADENA HASTA EL RELIEVE ═══════════════════════════════════ */
  console.log('\n── 3 · el perfil llega al motor ──');
  const p = TP.perfilDeEnlace(c1, px, py, px + 24, py + 24, {});
  check('sale perfil', !!p.perfil, p.motivo);
  const rel = R.relieveDeltaDb(p.D, p.zSuelo[0] + 0.475, p.zSuelo[1] + 0.475, p.perfil, 2.45e9);
  check('y el motor lo acepta', rel !== null && rel.db !== null, rel && rel.motivo);
  check('con una rampa uniforme el relieve es ~0', Math.abs(rel.bruto) < 1e-9, rel.bruto);

  /* ══ 4 · LO QUE LA PANTALLA TIENE QUE DECIR ═══════════════════════════ */
  console.log('\n── 4 · el rótulo ──');
  const rot = TP.rotulo(c1);
  check('el rótulo dice la planta', /banco/.test(rot.texto), rot.texto);
  check('y DE QUÉ está hecho el terreno', /DEM \+ levantamiento/.test(rot.texto), rot.texto);
  check('el detalle trae el productor', /banco v1/.test(rot.detalle), rot.detalle);
  check('y la malla y el eje', /9×9 a 6 m/.test(rot.detalle) && /1\.20 m DECLARADO/.test(rot.detalle), rot.detalle);
  check('y que el sha se verificó', /sha ✓/.test(rot.detalle), rot.detalle);

  /* ══ 5 · LOS CAMINOS MALOS, QUE SON LA MITAD DEL TRABAJO ══════════════ */
  console.log('\n── 5 · lo que pasa cuando algo no cuadra ──');

  /* CADA CASO MALO EN CONTEXTO LIMPIO, y la razón es que la caché es legítima:
     está indexada por el sha del MANIFIESTO, así que un fichero cambiado sin
     cambiar su manifiesto se sirve de memoria en la segunda carga de la misma
     sesión. Eso es correcto en producción —el manifiesto ES la identidad— pero
     aquí taparía justo lo que se quiere probar. Se descubrió corriéndolo: los
     cuatro casos malos salían verdes por la caché del caso bueno de arriba. */
  const limpio = () => nuevoCtx().TerrenoProyecto;

  /* El fichero cambiado: mismo manifiesto, otro contenido. */
  const c2 = await limpio().carga(PRESET, { fetch: hazFetch(Object.assign({}, TABLA,
    { 'terreno/banco_relieve.json': TEXTO.replace('739.23', '839.23') })) });
  check('un terreno CAMBIADO no se usa: el sha no cuadra',
        c2.ok === false && c2.motivo === TP.MOTIVOS.SHA, c2.motivo + ' ' + c2.detalle);
  check('y el rótulo lo dice, no se lo calla',
        /sha del terreno NO cuadra/.test(TP.rotulo(c2).detalle), TP.rotulo(c2).detalle);

  /* El manifiesto cambiado: el preset ya no lo reconoce. */
  const c3 = await limpio().carga(PRESET, { fetch: hazFetch(Object.assign({}, TABLA,
    { 'terreno/banco_relieve.sha256.json': JSON.stringify(Object.assign({}, MAN, { sha256: 'f'.repeat(64) })) })) });
  check('un MANIFIESTO cambiado tampoco: el preset fija qué terreno espera',
        c3.ok === false && c3.motivo === TP.MOTIVOS.SHA, c3.motivo + ' ' + c3.detalle);

  /* EL CASO QUE DISCRIMINA EL SHA DEL PRESET, y sin él la mutación
     `shaPresetCiego` salía DORMIDA: el manifiesto y el fichero son COHERENTES
     ENTRE SÍ, pero no son el terreno que este proyecto espera. Es lo que pasa
     cuando alguien regenera el terreno y no actualiza el preset. Sin esta
     comprobación se usaría el nuevo callando. */
  const REL2 = Object.assign({}, RELIEVE, { generado: '2026-10-01' });
  const TEXTO2 = JSON.stringify(REL2);
  const SHA2 = crypto.createHash('sha256').update(TEXTO2, 'utf8').digest('hex');
  const c3b = await limpio().carga(PRESET, { fetch: hazFetch({
    'terreno/banco_relieve.sha256.json': JSON.stringify(Object.assign({}, MAN, { sha256: SHA2, bytes: TEXTO2.length })),
    'terreno/banco_relieve.json': TEXTO2 }) });
  check('un terreno REGENERADO sin actualizar el preset NO se usa',
        c3b.ok === false && c3b.motivo === TP.MOTIVOS.SHA, c3b.motivo + ' ' + c3b.detalle);
  check('y el motivo dice que es el PRESET el que no cuadra',
        /el preset espera/.test(String(c3b.detalle)), c3b.detalle);

  /* El fichero que no llega. */
  const c4 = await limpio().carga(PRESET, { fetch: hazFetch({ 'terreno/banco_relieve.sha256.json': JSON.stringify(MAN) }) });
  check('si el fichero no llega, se dice',
        c4.ok === false && c4.motivo === TP.MOTIVOS.NO_LLEGA, c4.motivo);

  /* La planta que no declara terreno: el caso de OCHO de las diez plantas. */
  const c5 = await TP.carga({ ox: 0, oy: 0, sc: 'elburgo' }, { fetch: hazFetch(TABLA) });
  check('una planta SIN terreno declarado lo dice con su motivo',
        c5.ok === false && c5.motivo === TP.MOTIVOS.SIN_DECLARAR, c5.motivo);
  check('y su rótulo explica por qué, en castellano y no un código',
        /no tiene levantamiento validado/.test(TP.rotulo(c5).detalle), TP.rotulo(c5).detalle);
  check('y pedir un perfil a una planta sin terreno devuelve motivo, no un cero',
        TP.perfilDeEnlace(c5, 0, 0, 12, 0, {}).perfil === null);

  /* Un preset sin origen UTM: no se puede situar el terreno. Situarlo a ojo
     sería pintar el relieve de otro sitio. */
  const c6 = await limpio().carga({ sc: 'x', terreno: { manifiesto: 'banco_relieve.sha256.json', sha256: SHA } },
                                  { fetch: hazFetch(TABLA) });
  check('sin origen UTM en el preset, NO se sitúa a ojo',
        c6.ok === false && c6.motivo === TP.MOTIVOS.SIN_ORIGEN, c6.motivo + ' ' + c6.detalle);

  /* Y LA CACHÉ NO PUEDE LLEVARSE EL DESFASE DE OTRO PRESET. Este es el fallo
     que cazó este banco: la primera versión cacheaba `dx`/`dn`, que salen del
     PRESET y no del terreno, así que un segundo proyecto sobre el mismo
     terreno habría muestreado donde no era, sin que nada avisara. */
  const OTRO = { ox: OX + 500, oy: OY - 300, sc: 'otro', name: 'Otro',
                 terreno: { manifiesto: 'banco_relieve.sha256.json', sha256: SHA } };
  const cOtro = await TP.carga(OTRO, { fetch: hazFetch(TABLA) });   // MISMO sha: entra por caché
  check('un segundo proyecto sobre el MISMO terreno recibe SU desfase, no el del primero',
        cOtro.ok && Math.abs(cOtro.dx - (DX + 500)) < 1e-9 && Math.abs(cOtro.dn - (DN - 300)) < 1e-9,
        cOtro.dx + ' / ' + cOtro.dn + ' (el primero era ' + c1.dx + ' / ' + c1.dn + ')');

  /* El JSON roto. */
  const c7 = await TP.carga(PRESET, { fetch: hazFetch(Object.assign({}, TABLA,
    { 'terreno/banco_relieve.json': TEXTO })) , base: 'terreno/' });
  check('(control) el mismo fichero bueno sigue cargando', c7.ok === true, c7.motivo);

  /* ══ 6 · EL SHA NO VERIFICABLE NO SE PRESENTA COMO VERIFICADO ═════════ */
  console.log('\n── 6 · sin crypto.subtle ──');
  const ctxSin = (function () {
    const c = { console: console, module: { exports: {} },
                TextEncoder: TextEncoder, TextDecoder: TextDecoder, crypto: {} };
    c.globalThis = c; vm.createContext(c);
    vm.runInContext(fs.readFileSync(path.join(RAIZ, 'terreno_planta.js'), 'utf8'), c);
    c.require = m => c.TerrenoPlanta;
    vm.runInContext(fuenteDe('terreno_proyecto.js'), c);
    return c;
  })();
  const c8 = await ctxSin.TerrenoProyecto.carga(PRESET, { fetch: hazFetch(TABLA) });
  check('sin crypto.subtle el terreno se usa igualmente', c8.ok === true, c8.motivo);
  check('pero NO se dice que el sha esté verificado', c8.shaVerificado === false, c8.shaVerificado);
  check('y el rótulo lo distingue',
        /sha NO verificable/.test(ctxSin.TerrenoProyecto.rotulo(c8).detalle),
        ctxSin.TerrenoProyecto.rotulo(c8).detalle);

  /* ══ 7 · LA CALIDAD Y EL ±, QUE ES LO QUE DECIDE SI EL RELIEVE SIRVE ═══
     Un terreno empalmado valida a 0,030 m y uno de solo DEM a 0,78–1,20: de
     ×17 a ×28. Si los dos se presentan igual, quien mira el mapa no puede
     saber cuál tiene delante. */
  console.log('\n── 7 · el rótulo de calidad y el ± del relieve ──');
  const TPm = ctx0.TerrenoProyecto;
  const rotCal = (cal) => TPm.rotulo({ ok: true, shaVerificado: true,
                                    man: Object.assign({}, MAN, { calidad: cal }) });

  const VALIDADO = { validado: true, metodo: 'contra cotas as-built',
                     n_cotas: 3004, p50_m: 0.030, p95_m: 0.114 };
  const Z_DB = { nota: 'medido en otras plantas', medido_en: ['ayora', 'sanjose'],
                 p90_db: { '20-50': [0.00, 6.57], '100-200': [3.74, 12.94],
                           '800-1600': [4.59, 12.87] } };
  const SOLODEM = { validado: false, motivo: 'sin levantamiento', px_tesela_m: 7.2, z_db: Z_DB };

  check('un terreno VALIDADO lo dice', /validado/.test(rotCal(VALIDADO).texto)
        && !/SIN VALIDAR/.test(rotCal(VALIDADO).texto), rotCal(VALIDADO).texto);
  check('y con su error medido al lado', /0\.030/.test(rotCal(VALIDADO).aviso), rotCal(VALIDADO).aviso);
  check('uno de solo DEM sale SIN VALIDAR', /SIN VALIDAR/.test(rotCal(SOLODEM).texto), rotCal(SOLODEM).texto);
  check('con el motivo, no en la consola', /sin levantamiento/.test(rotCal(SOLODEM).aviso), rotCal(SOLODEM).aviso);
  check('validado true/false se distingue del «no lo dice»',
        rotCal(VALIDADO).validado === true && rotCal(SOLODEM).validado === false);

  /* EL TEST QUE DE VERDAD IMPORTA: un fichero SIN bloque de calidad no puede
     presentarse como validado. Es el caso del terreno viejo, y el que se
     colaría sin darse cuenta. */
  const sinCal = rotCal(undefined);
  check('sin bloque de calidad NO se presenta como validado',
        !/^.*· validado$/.test(sinCal.texto) && /no declarada/.test(sinCal.texto), sinCal.texto);
  check('y `validado` sale null, que no es false', sinCal.validado === null, sinCal.validado);

  const car = { ok: true, shaVerificado: true, man: Object.assign({}, MAN, { calidad: SOLODEM }) };
  const z150 = TPm.incertidumbreDb(car, 150);
  check('el ± sale de la banda del vano', z150 && z150.banda === '100-200', z150);
  check('y se coge el PEOR de las plantas medidas, no el cómodo',
        z150 && Math.abs(z150.z90 - 12.94) < 1e-9, z150 && z150.z90);
  const z40 = TPm.incertidumbreDb(car, 40);
  check('otra banda, otro ±', z40 && Math.abs(z40.z90 - 6.57) < 1e-9, z40 && z40.z90);
  check('por encima de la última banda NO se extrapola a cero',
        (() => { const z = TPm.incertidumbreDb(car, 5000); return z && z.z90 > 0 && z.extrapolado === true; })(),
        TPm.incertidumbreDb(car, 5000));
  check('sin bloque z_db devuelve null, NO cero',
        TPm.incertidumbreDb({ ok: true, man: Object.assign({}, MAN, { calidad: VALIDADO }) }, 150) === null);

  console.log('');
  if (MUTA) console.log(ko ? '### bien: la mutacion «' + MUTA + '» sale roja'
                           : '### MAL: la mutacion «' + MUTA + '» pasa desapercibida');
  console.log(ko ? 'FALLAN ' + ko + ' de ' + (ok + ko) : 'TODO OK — ' + ok + ' comprobaciones');
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('EXCEPCION: ' + (e && e.stack || e)); process.exit(1); });
