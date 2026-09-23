/* UNA SOLA FUNCIÓN DE DESPEJE, Y QUE SE VEA EN LA CI.
 *
 * El motor tuvo durante meses DOS geometrías para la misma fila:
 *
 *   `banda`  proyectaba el panel como un segmento VERTICAL sobre el eje,
 *   `cortaPanel` corta el rayo contra el plano INCLINADO de verdad.
 *
 * Las dos daban el mismo estado y el mismo despeje —0,000000 m de diferencia—
 * y por eso convivieron sin que nada chillara. Pero no coinciden en DÓNDE ESTÁ
 * EL CANTO que difracta: la banda lo pone en el eje (w = 0) y el plano en el
 * borde real (w = ±(c/2)·cos α). En la fila propia eso lleva d1 de 0,9 λ a
 * 9,3 λ, o sea de «campo cercano, no aplica el filo de cuchillo» a «aplica».
 * Dos funciones que dan el despeje de una fila no son redundancia: son dos
 * respuestas distintas esperando a que alguien llame a la que no toca.
 *
 * La banda no se ha borrado, se ha MUDADO: vive en
 * `tests/referencia_banda_vertical.js` con otro nombre, para poder carearla y
 * para poder publicar el error que se comete al usarla. Lo que esta puerta
 * impide es que vuelva al camino de cálculo.
 *
 * ESTO ES ANÁLISIS DE TEXTO, no de comportamiento: lee el fuente de los dos
 * motores y cuenta. Un banco de números no puede cazar esto, porque el día que
 * vuelva la segunda función los números seguirán saliendo iguales — que es
 * justo lo que pasó.
 */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');

/* ── MUTACIONES ───────────────────────────────────────────────────────────
   Como la puerta lee TEXTO, las mutaciones también son de texto: se aplican
   sobre la copia en memoria del fuente, nunca sobre el fichero del repo.
   Cada una mete de vuelta una forma real de romper la regla. */
const MUTACIONES = {
  // vuelve una segunda función que da el despeje de la fila, con otro nombre
  segundaHolgura: ['radio_pv_model.js', /(\n  function cortaPanel)/,
    '\n  function holguraDeFila(zEje, cuerdaM, alphaDeg, w) {\n' +
    '    var a = alphaDeg * RAD, z = zEje + w * Math.tan(a);\n' +
    '    return { estado: z > 0 ? "libre" : "tapado", despeje: Math.abs(z) };\n' +
    '  }\n$1'],
  // la misma recaída por el lado de Python
  segundaHolguraPy: ['radio_pv_model.py', /(\ndef corta_panel\()/,
    '\ndef holgura_de_fila(z_eje, cuerda_m, alpha_deg, w):\n' +
    '    z = z_eje + w * math.tan(math.radians(alpha_deg))\n' +
    '    return {"estado": "libre" if z > 0 else "tapado", "despeje": abs(z)}\n\n$1'],
  // la banda vuelve al motor por su nombre de siempre
  bandaDeVuelta: ['radio_pv_model.js', /(\n  function cortaPanel)/,
    '\n  function banda(zEje, cuerdaM, alphaDeg, hAntena) {\n' +
    '    var semi = (cuerdaM / 2) * Math.abs(Math.sin(alphaDeg * RAD));\n' +
    '    return { lo: zEje - semi, hi: zEje + semi };\n' +
    '  }\n$1'],
  // la referencia se cuela en el camino de cálculo desde la aplicación
  refEnLaApp: ['radio_zigbee.js', /\? require\("\.\/radio_pv_model\.js"\)/,
    '? require("./tests/referencia_banda_vertical.js")'],
  // el motor exporta la función con nombres distintos en cada idioma: la
  // paridad dejaría de comparar la misma cosa sin que nada lo dijera
  nombresDistintos: ['radio_pv_model.py', /^def corta_panel\(/m, 'def corta_el_panel('],
  // vuelve una SEGUNDA referencia de terreno, con otro nombre
  segundaLisa: ['radio_pv_model.js', /(\n  function tierraLisa)/,
    '\n  function superficieBase(perfil) {\n' +
    '    var n = perfil.length, s = 0;\n' +
    '    for (var i = 0; i < n; i++) s += perfil[i][1];\n' +
    '    return { hst: s / n, hsr: s / n };\n' +
    '  }\n$1'],
  // y la misma recaída por Python
  segundaLisaPy: ['radio_pv_model.py', /(\ndef tierra_lisa\()/,
    '\ndef superficie_base(perfil):\n' +
    '    m = sum(p[1] for p in perfil) / len(perfil)\n' +
    '    return {"hst": m, "hsr": m}\n\n$1'],
  // el `relieveDominante` viejo vuelve al motor
  relieveViejo: ['radio_pv_model.js', /(\n  function tierraLisa)/,
    '\n  function relieveDominante(zA, zB, D, perfil) {\n' +
    '    return perfil && perfil.length ? { s: perfil[0][0], invade: 0 } : null;\n' +
    '  }\n$1'],
  // la referencia se queda huérfana: nadie la carea, o sea que el «vive en el
  // banco con otro nombre» degenera en «se borró y ya». Hay que tocar LOS TRES
  // bancos que la carean: aflojar uno solo no la deja huérfana, y una puerta
  // que solo se puede romper del todo no vale para probar nada a medias.
  refHuerfana: [['tests/test_radio_geom.js', 'tests/test_antena_tcu.js', 'tests/test_radio_malla.js'],
    /['"][^'"]*referencia_banda_vertical\.js['"]/g, "'(ya nadie la carea)'"],
};

const MUTA = process.env.MUTA;
const src = {};                     // fuente en memoria: el repo NO se toca
function lee(rel) {
  if (src[rel] === undefined) {
    const p = path.join(RAIZ, rel);
    src[rel] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  return src[rel];
}
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  for (const f of (Array.isArray(m[0]) ? m[0] : [m[0]])) {
    const antes = lee(f);
    if (antes === null) { console.error('la mutacion «' + MUTA + '» apunta a un fichero que no existe: ' + f); process.exit(2); }
    const despues = antes.replace(m[1], m[2]);
    if (despues === antes) { console.error('la mutacion «' + MUTA + '» no casó con ' + f); process.exit(2); }
    src[f] = despues;
  }
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}

let ok = 0, ko = 0;
function check(q, cond, detalle) {
  if (cond) { ok++; console.log('OK   ' + q); }
  else { ko++; console.log('FAIL ' + q + (detalle != null ? ' -> ' + detalle : '')); }
}

/* ── TROCEAR EL FUENTE EN FUNCIONES ────────────────────────────────────────
   No hace falta un parser: los dos motores tienen una forma fija y conocida.
   En JS las funciones del módulo van a DOS espacios dentro del IIFE, y las
   anidadas a cuatro —`hueco` dentro de `cortaPanel`—, así que cortar por el
   sangrado de dos deja cada anidada DENTRO de la suya, que es lo correcto:
   `hueco` es parte de `cortaPanel`, no una segunda función de despeje.
   En Python las del módulo van a columna 0. */
function troceaJs(texto) {
  const out = [];
  const re = /^  function ([A-Za-z_$][\w$]*)\s*\(/gm;
  const marcas = [];
  let m; while ((m = re.exec(texto)) !== null) marcas.push([m.index, m[1]]);
  for (let i = 0; i < marcas.length; i++) {
    const fin = i + 1 < marcas.length ? marcas[i + 1][0] : texto.length;
    out.push({ nombre: marcas[i][1], cuerpo: texto.slice(marcas[i][0], fin) });
  }
  return out;
}
function troceaPy(texto) {
  const out = [];
  const re = /^def ([A-Za-z_][\w]*)\s*\(/gm;
  const marcas = [];
  let m; while ((m = re.exec(texto)) !== null) marcas.push([m.index, m[1]]);
  for (let i = 0; i < marcas.length; i++) {
    const fin = i + 1 < marcas.length ? marcas[i + 1][0] : texto.length;
    out.push({ nombre: marcas[i][1], cuerpo: texto.slice(marcas[i][0], fin) });
  }
  return out;
}

/* PRODUCIR vs REENVIAR. `difraccionPanelesDetalle` devuelve un `despeje:` en su
   resultado, pero no lo CALCULA: lo copia del que le dio `cortaPanel`. Esa
   forma —`despeje: <algo>.despeje`— se quita antes de contar, porque si no la
   puerta cazaría al mensajero y habría que aflojarla con una excepción por
   nombre, que es como mueren estas puertas. */
function produceDespeje(cuerpo) {
  const limpio = cuerpo
    .replace(/["']?despeje["']?\s*:\s*[A-Za-z_$][\w$.\[\]"']*\.despeje/g, '')
    .replace(/["']despeje["']\s*:\s*[A-Za-z_$][\w$]*\[["']despeje["']\]/g, '');
  return /["']?despeje["']?\s*:/.test(limpio);
}

console.log('· el motor no puede tener dos funciones que den el despeje de una fila\n');

const js = lee('radio_pv_model.js'), py = lee('radio_pv_model.py');
check('los dos motores están donde se espera', js !== null && py !== null);

const jsProd = troceaJs(js).filter(f => produceDespeje(f.cuerpo)).map(f => f.nombre);
const pyProd = troceaPy(py).filter(f => produceDespeje(f.cuerpo)).map(f => f.nombre);
check('en el motor JS el despeje de una fila lo da UNA sola función',
      jsProd.length === 1 && jsProd[0] === 'cortaPanel',
      jsProd.length + ' -> ' + (jsProd.join(', ') || '(ninguna)'));
check('y en el motor Python, la MISMA y una sola',
      pyProd.length === 1 && pyProd[0] === 'corta_panel',
      pyProd.length + ' -> ' + (pyProd.join(', ') || '(ninguna)'));

/* Y que las dos se llamen igual traducidas. Si una se renombra a solas, la
   paridad deja de comparar la misma función y se queda verde igual. */
check('los dos nombres son el mismo traducido (cortaPanel ↔ corta_panel)',
      jsProd.length === 1 && pyProd.length === 1 &&
      pyProd[0] === jsProd[0].replace(/[A-Z]/g, c => '_' + c.toLowerCase()),
      jsProd[0] + ' / ' + pyProd[0]);
check('y las dos salen exportadas',
      /\bcortaPanel\s*:/.test(js) && /["']corta_panel["']|\bcorta_panel\b/.test(py));

/* ── UNA SOLA REFERENCIA DE TERRENO, por la misma razon ───────────────────
   Dos funciones que dan la superficie de referencia de un vano es la misma
   enfermedad que dos que dan el despeje de una fila: una se queda vieja y
   nadie lo nota. Y aqui el sintoma seria peor, porque la resta contra la
   referencia SOLO cancela si la difraccion y los dos rayos usan la MISMA: con
   dos referencias, el perfil plano dejaria de dar 0 y nadie sabria por que.

   `relieveDominante` era la de antes y ya no esta: daba el punto que mas
   invade el rayo y con eso se cobraba un filo por cada punto del terreno, o
   sea 21,66 dB medidos de doble conteo sobre un perfil PLANO. */
function produceLisa(cuerpo) {
  /* PRODUCIR vs REENVIAR, igual que con el despeje: `relieveDeltaDb` devuelve
     `hst`/`hsr` en su salida pero no los CALCULA, los copia de `tierraLisa`.
     Esa forma -`hst: <algo>.hst`- se quita antes de contar. */
  const limpio = cuerpo
    .replace(/["']?hs[tr]["']?\s*:\s*[A-Za-z_$][\w$.\[\]"']*\.hs[tr]/g, '')
    .replace(/["']hs[tr]["']\s*:\s*[A-Za-z_$][\w$]*\[["']hs[tr]["']\]/g, '');
  return /["']?hst["']?\s*:/.test(limpio) && /["']?hsr["']?\s*:/.test(limpio);
}
const jsLisa = troceaJs(js).filter(f => produceLisa(f.cuerpo)).map(f => f.nombre);
const pyLisa = troceaPy(py).filter(f => produceLisa(f.cuerpo)).map(f => f.nombre);
check('en el motor JS la tierra lisa la da UNA sola función',
      jsLisa.length === 1 && jsLisa[0] === 'tierraLisa',
      jsLisa.length + ' -> ' + (jsLisa.join(', ') || '(ninguna)'));
check('y en el motor Python, la MISMA y una sola',
      pyLisa.length === 1 && pyLisa[0] === 'tierra_lisa',
      pyLisa.length + ' -> ' + (pyLisa.join(', ') || '(ninguna)'));
check('y `relieveDominante` no ha vuelto por ningún lado',
      troceaJs(js).concat(troceaPy(py)).every(f =>
        f.nombre !== 'relieveDominante' && f.nombre !== 'relieve_dominante'));

/* ── LOS NOMBRES DE LA BANDA NO VUELVEN AL MOTOR ───────────────────────────
   Por nombre además de por forma: es la recaída más probable, porque el
   historial del repo está lleno de llamadas a `banda(...)` que alguien puede
   resucitar de un `git revert` sin darse cuenta. */
const PROHIBIDOS_JS = ['banda', 'corta', 'difraccionBandasDetalle', 'difraccionBandasDb'];
const PROHIBIDOS_PY = ['banda', 'corta', 'difraccion_bandas_detalle', 'difraccion_bandas_db'];
const vueltosJs = troceaJs(js).map(f => f.nombre).filter(n => PROHIBIDOS_JS.indexOf(n) >= 0);
const vueltosPy = troceaPy(py).map(f => f.nombre).filter(n => PROHIBIDOS_PY.indexOf(n) >= 0);
check('la banda vertical no ha vuelto al motor JS', vueltosJs.length === 0, vueltosJs.join(', '));
check('ni al motor Python', vueltosPy.length === 0, vueltosPy.join(', '));

/* ── LA REFERENCIA SIGUE SIENDO REFERENCIA ─────────────────────────────────
   Dos condiciones, y las dos hacen falta. Que EXISTA y la caree alguien: si no,
   «vive en el banco con otro nombre» se convierte en «se borró», y el error de
   la banda deja de poderse publicar. Y que NO la toque nadie fuera de
   `tests/`: el día que la requiera el visor o una herramienta, vuelve a haber
   dos geometrías en el camino de cálculo aunque el motor solo tenga una. */
const REF = 'tests/referencia_banda_vertical.js';
check('la referencia de la banda sigue existiendo', lee(REF) !== null, REF);

function listaFuentes(dir, acc) {
  acc = acc || [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listaFuentes(p, acc);
    else if (/\.(js|mjs|py|html)$/.test(e.name)) acc.push(path.relative(RAIZ, p));
  }
  return acc;
}
/* LA PUERTA SE EXCLUYE A SÍ MISMA, y no es una excepción de conveniencia: su
   tabla de mutaciones lleva el texto `require("./tests/referencia_banda_vertical.js")`
   como CADENA de reemplazo, así que el barrido la contaba como si la carease.
   Eso dejaba `refHuerfana` VERDE —la mutación quitaba el careo de los tres
   bancos de verdad y la puerta se seguía viendo a sí misma como consumidor—,
   o sea una puerta dormida del mismo tipo que las que esto vigila. Se cazó
   corriendo la mutación, no leyendo el código. */
const YO = path.relative(RAIZ, __filename);
const FUENTES = listaFuentes(RAIZ).filter(f => f !== YO);
/* USAR, no MENCIONAR. Los dos motores nombran la referencia en su cabecera para
   explicar dónde se fue la banda, y esa cita hay que dejarla: es lo único que
   le dice al que llega por qué el motor tiene una sola función. Lo que no puede
   haber es que la CARGUE.

   SE QUITAN LOS COMENTARIOS Y SE BUSCA LA RUTA EN EL CÓDIGO QUE QUEDA. La
   primera versión buscaba la forma `require(...)` y se quedó corta el mismo
   día: `test_radio_geom.js` pasó a cargarla por `vm`, con la ruta en una cadena
   suelta, y la puerta dejó de contarlo como careo. Buscar la ruta en el código
   sin comentarios cubre `require`, `import`, el `vm` y un `readFileSync` que
   venga mañana, sin ir añadiendo formas una a una.

   El quitacomentarios es APROXIMADO —no entiende una `//` dentro de una cadena,
   ni una comilla triple anidada—, y para esto basta: lo único que tiene que
   distinguir es una cita en prosa de una carga de verdad. Si algún día se
   equivoca, se equivoca hacia el lado rojo, que es el que avisa. */
function sinComentarios(texto, rel) {
  if (/\.py$/.test(rel)) {
    return texto.replace(/"""[\s\S]*?"""/g, ' ').replace(/'''[\s\S]*?'''/g, ' ')
                .replace(/#[^\n]*/g, '');
  }
  return texto.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const citan = FUENTES.filter(f => f !== REF &&
  /referencia_banda_vertical/.test(sinComentarios(lee(f) || '', f)));
const fuera = citan.filter(f => !f.startsWith('tests' + path.sep));
check('la referencia la carea al menos un banco', citan.length > 0, citan.join(', ') || '(nadie)');
check('y no la usa nadie fuera de tests/', fuera.length === 0, fuera.join(', ') || null);

console.log('\n' + (ko ? 'FALLA — ' + ko + ' de ' : 'TODO OK — ') + (ok + ko) + ' comprobaciones');
process.exit(ko ? 1 : 0);
