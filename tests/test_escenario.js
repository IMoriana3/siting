// EL ESCENARIO GUARDABLE — punto 7 de la fase 4.
//
// Lo que este banco vigila son las cuatro promesas del encargo, no aritmética:
//
//   1. UN SHA QUE FALTA NO COMPARA IGUAL. Si al guardar no se pudo calcular, al
//      abrir el escenario se dice «no se puede saber», NUNCA «son los mismos».
//   2. AL ABRIR UNO VIEJO CON PARÁMETROS DISTINTOS, SE AVISA Y SE OFRECE
//      RECALCULAR. Nunca se pinta con los de hoy diciendo que son los de
//      entonces — que es literalmente lo que pasó con las capturas del motor
//      antiguo.
//   3. NADA DE ALMACENAMIENTO DEL NAVEGADOR. Ni localStorage, ni sessionStorage,
//      ni IndexedDB: lo que vive en un navegador no se puede pasar a otro.
//   4. EL ESCENARIO LLEVA SU VERSIÓN DE FORMATO, y el mismo estado da el MISMO
//      texto — sin eso, el informe reproducible del punto 8 es imposible.
//
//   node tests/test_escenario.js
//   MUTA=<clave> node tests/test_escenario.js      (TIENE que salir rojo)
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

const MUTACIONES = {
  // un sha que falta pasa a comparar IGUAL: el defecto que convierte «no lo sé»
  // en «coinciden», y el peor de todos porque da confianza
  huecoEsIgual: ['radio_escenario.js', 'd.push({ campo: campo, entonces: entonces, ahora: hoy, estado: "no_se_puede_saber" });', ''],
  // se deja de ofrecer recalcular cuando difieren
  sinRecalcular: ['radio_escenario.js', 'ofrecer: estado === "igual" ? null : "recalcular"', 'ofrecer: null'],
  // el escenario deja de llevar su versión de formato
  sinFormato: ['radio_escenario.js', '_formato: VERSION_FORMATO,', ''],
  // el JSON deja de ser estable: el mismo estado da textos distintos
  textoInestable: ['radio_escenario.js', 'var o = {}, ks = Object.keys(v).sort();', 'var o = {}, ks = Object.keys(v).reverse();'],
  // el sha de los parámetros deja de ser imprescindible: un escenario sin él se
  // declara reproducible
  shaOpcional: ['radio_escenario.js', 'var IMPRESCINDIBLES = ["planta", "variante", "params_sha256"];',
                'var IMPRESCINDIBLES = ["planta", "variante"];'],
  // y la URL deja de decir cuándo NO cabe
  urlSiempreCabe: ['radio_escenario.js', 'cabe: url.length <= LIMITE_URL', 'cabe: true'],
  // LA PÁGINA rellena el hueco del sha en vez de dejarlo a null con su motivo:
  // un escenario que dice tener sha y no lo tiene compara igual contra cualquier
  // cosa, que es el peor de los fallos posibles aquí
  paginaRellenaSha: ['index.html', 'if(!(globalThis.crypto && globalThis.crypto.subtle)) return null;',
                     'if(!(globalThis.crypto && globalThis.crypto.subtle)) return "0".repeat(64);'],
  // y la página se pone a guardar en el navegador
  paginaGuardaEnNavegador: ['index.html', '  out.innerHTML = h; out.appendChild(a);',
                            '  localStorage.setItem("esc", esc_); out.innerHTML = h; out.appendChild(a);'],
};
const MUTA = process.env.MUTA;
let DIR = RAIZ;
if (MUTA) {
  const mu = MUTACIONES[MUTA];
  if (!mu) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'escenario-'));
  // LOS DOS, siempre: hay mutaciones del módulo y mutaciones de la página, y el
  // banco mira los dos ficheros. Copiar sólo el mutado dejaría al otro leyéndose
  // del repo y la mutación miraría a medias.
  for (const f of ['radio_escenario.js', 'index.html']) fs.copyFileSync(path.join(RAIZ, f), path.join(DIR, f));
  const dest = path.join(DIR, mu[0]), antes = fs.readFileSync(dest, 'utf8');
  const despues = antes.replace(mu[1], mu[2]);
  if (despues === antes) {
    console.error('la mutacion «' + MUTA + '» no casó con ' + mu[0] + '. Eso es NO COMPROBADO, no rojo.');
    process.exit(2);
  }
  fs.writeFileSync(dest, despues);
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}
const E = require(path.join(DIR, 'radio_escenario.js'));

/* ── 3 · NADA DE ALMACENAMIENTO DEL NAVEGADOR ───────────────────────────────
   Se mira el fuente, y se mira SIN COMENTARIOS: la cabecera de ese fichero
   nombra los tres a propósito, para decir que no se usan. Buscar el nombre a
   secas daría rojo por la prosa — que es justo la sexta lección del documento
   de puertas. */
const fuente = fs.readFileSync(path.join(DIR, 'radio_escenario.js'), 'utf8');
const sinCom = fuente.replace(/\/\*[\s\S]*?\*\//g, ' ')
                     .split('\n').map(l => l.replace(/(?<!:)\/\/.*$/, '')).join('\n');
for (const malo of ['localStorage', 'sessionStorage', 'indexedDB']) {
  check('el escenario NO usa ' + malo, sinCom.indexOf(malo) < 0);
}
check('  (y el fichero SÍ los nombra, en su cabecera, para decir que no los usa)',
      fuente.indexOf('localStorage') >= 0);

/* ── 4 · FORMATO Y TEXTO ESTABLE ───────────────────────────────────────────── */
const base = {
  planta: 'elburgo', motor: 'nuevo', variante: 'zigbee_pro_24',
  horaUTC: Date.UTC(2026, 5, 21, 12, 0), solOn: true, ejeM: 1.8, cuerdaM: 2.38,
  vegetacion: { modelo: 'ninguna' },
  terreno: { id: 'elburgo_relieve', ok: true, calidad: 'dem 5 m', sha256: 'abc123' },
  ncus: [{ id: 'NCU-01', x: 10, y: 20 }, { id: 'NCU-02', x: 30, y: 40 }],
  paramsVersion: '3', paramsSha: 'f'.repeat(64), motorSha: 'a'.repeat(64), motorVersion: 'fase1'
};
const esc = E.captura(base);
check('el escenario lleva su versión de formato', esc._formato === E.VERSION_FORMATO, esc._formato);
check('y el mismo estado da EXACTAMENTE el mismo texto',
      E.aTexto(E.captura(base)) === E.aTexto(E.captura(base)));
check('  aunque las claves lleguen en otro orden',
      E.aTexto(E.captura(base)) === E.aTexto(E.captura(JSON.parse(JSON.stringify(base)))));
/* LA ESTABILIDAD DE VERDAD SE PRUEBA EN UN OBJETO ANIDADO QUE PASA TAL CUAL.
   Comparar dos llamadas idénticas no prueba nada —salen iguales aunque el orden
   sea arbitrario, mientras sea el MISMO arbitrario— y `captura` reconstruye casi
   todo con claves literales, así que el orden de entrada se pierde. Donde
   sobrevive es en `vegetacion`, que viaja tal cual. Ahí es donde hay que mirar,
   y la primera versión de este banco no lo hacía. */
const vegA = { modelo: 'ninguna', altura_m: 1.2, densidad: 0.3 };
const vegB = {}; Object.keys(vegA).reverse().forEach(k => vegB[k] = vegA[k]);
check('  y un objeto anidado con las claves en otro orden da el MISMO texto',
      E.aTexto(E.captura(Object.assign({}, base, { vegetacion: vegA }))) ===
      E.aTexto(E.captura(Object.assign({}, base, { vegetacion: vegB }))),
      E.aTexto(E.captura(Object.assign({}, base, { vegetacion: vegA }))).slice(0, 90));

/* Lo que el encargo pide que entre, campo a campo. */
for (const k of ['planta', 'variante', 'hora_utc', 'eje_m', 'vegetacion', 'terreno',
                 'ncus', 'params_sha256', 'params_version', 'motor_sha256']) {
  check('entra «' + k + '»', esc[k] !== undefined && esc[k] !== null, JSON.stringify(esc[k]));
}
check('la hora va en UTC absoluto, no como «12:00»', typeof esc.hora_utc === 'number');
check('el terreno va CON SU CALIDAD, no sólo su nombre',
      esc.terreno.calidad === 'dem 5 m' && esc.terreno.ok === true);
check('las NCU van con posición', esc.ncus.length === 2 && esc.ncus[0].x === 10);
check('el commit del motor va a null CON SU MOTIVO, no inventado',
      esc.motor_commit === null && /no conoce su propio commit/.test(esc._motor_commit_motivo || ''));

/* ── 1 · UN SHA QUE FALTA NO COMPARA IGUAL ─────────────────────────────────── */
const sinSha = E.captura(Object.assign({}, base, { paramsSha: null,
  paramsShaMotivo: 'sin crypto.subtle en contexto no seguro' }));
check('un escenario sin sha lo DICE', sinSha.params_sha256 === null &&
      /crypto\.subtle/.test(sinSha._params_sha_motivo || ''), sinSha._params_sha_motivo);
check('  y no se declara reproducible', E.valida(sinSha).reproducible === false);
const c0 = E.carea(sinSha, { paramsSha: 'f'.repeat(64), motorSha: 'a'.repeat(64) });
check('y al abrirlo NO dice «son iguales»', c0.estado === 'no_se_puede_saber', c0.estado);
check('  lo dice con esas palabras, y aclara que no es «son iguales»',
      /NO SE PUEDE SABER/.test(c0.texto) && /NO es «son iguales»/.test(c0.texto), c0.texto);
check('  y ofrece recalcular igualmente', c0.ofrecer === 'recalcular', c0.ofrecer);

/* ── 2 · PARÁMETROS DISTINTOS: SE AVISA Y SE OFRECE RECALCULAR ────────────── */
const igual = E.carea(esc, { paramsSha: 'f'.repeat(64), motorSha: 'a'.repeat(64), paramsVersion: '3' });
check('con los mismos parámetros, dice que son los mismos', igual.estado === 'igual', igual.estado);
check('  y entonces NO ofrece nada', igual.ofrecer === null);
const distinto = E.carea(esc, { paramsSha: '0'.repeat(64), motorSha: 'a'.repeat(64), paramsVersion: '4' });
check('con parámetros distintos, AVISA', distinto.estado === 'difiere', distinto.estado);
check('  y nombra qué ha cambiado',
      distinto.diferencias.some(d => d.campo === 'params_sha256' && d.estado === 'difiere'));
check('  y dice que lo que se pinte NO es lo que se vio entonces',
      /NO es lo que se vio entonces/.test(distinto.texto), distinto.texto);
check('  y ofrece recalcular', distinto.ofrecer === 'recalcular');
check('la versión de parámetros también se carea',
      distinto.diferencias.some(d => d.campo === 'params_version'));

/* ── LA URL, Y CUÁNDO NO CABE ──────────────────────────────────────────────── */
const u = E.aUrl(esc, 'https://x/y');
check('un escenario pequeño CABE en la URL', u.cabe === true, u.bytes + ' de ' + u.limite);
check('  y se puede volver a leer de ella', E.aTexto(E.deUrl(u.url)) === E.aTexto(esc));
const gordo = E.captura(Object.assign({}, base, {
  ncus: Array.from({ length: 200 }, (_, i) => ({ id: 'NCU-' + i, x: i * 13.7, y: i * 21.3 })) }));
const ug = E.aUrl(gordo, 'https://x/y');
check('uno grande NO cabe, y lo dice', ug.cabe === false, ug.bytes + ' de ' + ug.limite);
check('  con el motivo y la salida (descargar el JSON)',
      /descárgalo como JSON/.test(ug.motivo || ''), ug.motivo);
check('una URL sin escenario devuelve null, no revienta', E.deUrl('https://x/y') === null);
let reventó = false;
try { E.deUrl('#esc=noesbase64valido~~'); } catch (e) { reventó = true; }
check('y una URL con basura se queja en vez de devolver medio escenario',
      reventó || E.deUrl('#esc=noesbase64valido~~') === null);

/* ── LA VALIDACIÓN ─────────────────────────────────────────────────────────── */
const v = E.valida(esc);
check('un escenario completo valida', v.ok === true && v.reproducible === true, JSON.stringify(v.faltan));
check('sin planta NO valida', E.valida(E.captura(Object.assign({}, base, { planta: null }))).ok === false);
check('sin sha de parámetros NO valida', E.valida(sinSha).ok === false, JSON.stringify(E.valida(sinSha).faltan));
check('lo que falta pero no es imprescindible sale como AVISO, no como falta',
      E.valida(E.captura(Object.assign({}, base, { motorSha: null }))).ok === true);
check('un formato distinto al de la página se avisa',
      E.valida(Object.assign({}, esc, { _formato: 99 })).avisos.some(a => /formato/.test(a)));
check('y todos los campos declarados en CAMPOS se miran',
      E.CAMPOS.length >= 11 && E.IMPRESCINDIBLES.every(k => E.CAMPOS.indexOf(k) >= 0));


/* ── Y LO QUE LA PÁGINA APORTA, EXTRAÍDO DEL `index.html` REAL ─────────────
   No se reimplanta: se saca el bloque y se mira lo que promete. Lo caro (los
   fetch y `crypto.subtle`) no se finge — se comprueba que el código NO rellena
   un hueco cuando no puede, que es lo único que de verdad importa aquí. */
const HTML = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const bloqueEsc = HTML.match(/async function escSha[\s\S]*?\n}\n\s*(?=\/\* ══ EL VEREDICTO)/);
if (!bloqueEsc) {
  console.log('\nNO SE HA PODIDO COMPROBAR: no localizo el bloque del escenario en index.html.');
  process.exit(2);
}
const B = bloqueEsc[0].replace(/\/\*[\s\S]*?\*\//g, ' ');
check('la página NO guarda el escenario en el navegador',
      !/localStorage|sessionStorage|indexedDB/.test(B));
check('los sha se calculan sobre los BYTES pedidos, no sobre lo que el fichero dice',
      /escBytes\("radio_params\.json"\)/.test(B) && /escBytes\("radio_pv_model\.js"\)/.test(B));
check('si no hay `crypto.subtle`, el sha va a null y NO a un relleno',
      /if\(!\(globalThis\.crypto && globalThis\.crypto\.subtle\)\) return null;/.test(B));
check('y el motivo del hueco lo pone la página, no queda mudo',
      /paramsShaMotivo: pSha \? null : escMotivoSha\(\)/.test(B));
check('al abrir uno viejo NO se tocan los parámetros de hoy',
      !/_radioParams *=/.test(B), (B.match(/_radioParams *=[^;]*/) || [])[0]);
check('el terreno se guarda con su calidad y con el caso «no se intentó» aparte',
      /calidad:/.test(B) && /no se ha cargado terreno/.test(B));

/* ── EL ALCANCE ─────────────────────────────────────────────────────────────── */
const PISO = 44, PISO_MUT = 8;
console.log('\nalcance: ' + E.CAMPOS.length + ' campos declarados · ' +
            Object.keys(MUTACIONES).length + ' mutaciones (piso ' + PISO_MUT + ')');
console.log('');
if (ko) { console.log('FALLAN ' + ko + ' de ' + (ok + ko) + ' comprobaciones'); process.exit(1); }
if (ok < PISO || Object.keys(MUTACIONES).length < PISO_MUT) {
  console.log('ALCANCE INSUFICIENTE: nada ha fallado, pero esto no ha mirado bastante (' +
              ok + ' de ' + PISO + ').');
  process.exit(2);
}
console.log('TODO OK — ' + ok + ' comprobaciones');
