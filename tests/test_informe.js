// EL INFORME — punto 8 de la fase 4.
//
// Tres promesas del encargo, y las tres son comprobables sin abrir un navegador:
//
//   1. UN INFORME SIN LA SECCIÓN DE LO QUE FALTA NO SE PUBLICA. No un aviso: una
//      excepción. Un informe que sólo enseña lo que salió es una carta de
//      presentación, y el lector no tiene cómo saber qué no se miró.
//   2. REPRODUCIBLE: mismo escenario y mismo motor, mismo texto BYTE A BYTE. Eso
//      prohíbe relojes dentro del informe y obliga a ordenar lo que se recorre.
//   3. LOS HUECOS SE LISTAN COMO HUECOS, CON SU MOTIVO — no se omiten ni se
//      pintan como ceros.
//
//   node tests/test_informe.js
//   MUTA=<clave> node tests/test_informe.js       (TIENE que salir rojo)
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
  // el reloj vuelve al informe: irreproducible por construcción
  relojDentro: ['radio_informe.js', '"_Mismo escenario y mismo motor dan el mismo informe: no hay ningún reloj dentro._"',
                '"_Generado el " + new Date().toISOString() + "._"'],
  // la puerta de publicación deja de exigir que los huecos estén listados: el
  // informe sale igual aunque se calle alguno
  faltaOpcional: ['radio_informe.js', 'if (noListados.length) {', 'if (false) {'],
  // los huecos se omiten en vez de listarse
  huecosMudos: ['radio_informe.js', 'if (c && c.min == null) h.push({ criterio: f.rotulo, tecnologia: k, motivo: c.motivo });', ''],
  // el listado de huecos deja de ordenarse: mismo contenido, texto distinto
  huecosSinOrden: ['radio_informe.js', 'var ord = huecos.slice().sort(function (a, b) {', 'var ord = huecos.slice().reverse(); if (false) huecos.sort(function (a, b) {'],
  // una celda sin valor se pinta como un guion cualquiera, indistinguible de un cero
  huecoComoGuion: ['radio_informe.js', 'return "**no se puede**";', 'return "-";'],
  // un NaN se imprime como si fuera un dato
  nanComoDato: ['radio_informe.js', 'if (typeof s === "number" && !isFinite(s)) return "—";', ''],
  // el listado se trunca: el informe sale, pero callándose huecos
  huecosTruncados: ['radio_informe.js', 'for (var i = 0; i < ord.length; i++) {', 'for (var i = 0; i < 1; i++) {'],
  // y el informe deja de decir cuántos huecos declara, que es su propia cuenta
  sinCuentaDeHuecos: ['radio_informe.js', '"**Huecos declarados: " + huecos.length + ".** Si esta cifra es 0 y la tabla"', '""'],
};
const MUTA = process.env.MUTA;
let DIR = RAIZ;
if (MUTA) {
  const mu = MUTACIONES[MUTA];
  if (!mu) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'informe-'));
  fs.copyFileSync(path.join(RAIZ, mu[0]), path.join(DIR, mu[0]));
  const dest = path.join(DIR, mu[0]), antes = fs.readFileSync(dest, 'utf8');
  const despues = antes.replace(mu[1], mu[2]);
  if (despues === antes) {
    console.error('la mutacion «' + MUTA + '» no casó con ' + mu[0] + '. Eso es NO COMPROBADO, no rojo.');
    process.exit(2);
  }
  fs.writeFileSync(dest, despues);
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}
const I = require(path.join(DIR, 'radio_informe.js'));
const E = require(path.join(RAIZ, 'radio_escenario.js'));

/* ── LA ENTRADA: un escenario de verdad y una tabla con huecos de verdad ──── */
const escenario = E.captura({
  ahora: '2026-09-24T12:00:00.000Z', planta: 'elburgo', motor: 'nuevo',
  variante: 'zigbee_pro_24', horaUTC: Date.UTC(2026, 5, 21, 12, 0), solOn: true,
  ejeM: 1.8, cuerdaM: 2.38, vegetacion: { modelo: 'ninguna' },
  terreno: { id: 'elburgo_relieve', ok: true, calidad: 'dem 5 m', sha256: 'd'.repeat(64) },
  ncus: [{ id: 'NCU-01', x: 0, y: 0 }, { id: 'NCU-02', x: 100, y: 0 }],
  paramsVersion: '3', paramsSha: 'f'.repeat(64), motorSha: 'a'.repeat(64), motorVersion: 'fase1'
});
const tabla = {
  planta: 'elburgo', horas: [8, 12, 16], tecnologias: ['zigbee_pro_24', 'lora_eu868'],
  filas: [
    /* VA LA PRIMERA EN LA TABLA Y NO LA PRIMERA POR ORDEN, a propósito. Con las
       filas en cualquier otro sitio, dar la vuelta a la lista y ordenarla dan el
       MISMO texto —lo comprobé— y la mutación `huecosSinOrden` salía verde sin
       que ninguna comprobación pudiera verlo. Es la tercera vez hoy que un caso
       de prueba no distingue lo que dice distinguir; el patrón es que los datos
       de juguete salen simétricos si uno no los elige a propósito. */
    { criterio: 'legalidad', rotulo: 'Alcance legal en España',
      veredicto: { texto: 'no comparable: este criterio no se ordena en un número' },
      celdas: { zigbee_pro_24: { min: null, max: null, motivo: 'falta norma' },
                lora_eu868: { min: null, max: null, motivo: 'falta norma' } } },
    { criterio: 'tcu_cubiertas', rotulo: 'TCU cubiertas',
      veredicto: { texto: 'no comparable: sin dato en lora_eu868' },
      celdas: { zigbee_pro_24: { min: 215, max: 215, motivo: null },
                lora_eu868: { min: null, max: null, motivo: 'falta rx_sens_dbm' } } },
    { criterio: 'saltos_max', rotulo: 'saltos, máximo',
      veredicto: { texto: 'no comparable: sin dato en lora_eu868' },
      celdas: { zigbee_pro_24: { min: 1, max: 3, motivo: 'varía con la hora' },
                lora_eu868: { min: null, max: null, motivo: 'falta ptx_dbm' } } },
  ]
};
const alcance = { tcu: 215, ncus: 2, horas: [8, 12, 16], enlaces: 64011, alcanceM: 400,
  umbral: 'margen > 0 (sensibilidad pelada, sin reserva de desvanecimiento)',
  denominador: '215 TCU con NCU asignada; las que no la tienen quedan fuera.',
  sesgo: 'los saltos son el camino más corto sobre todos los enlaces viables: cota inferior.' };
const pasos = [{ que: 'Leer un datasheet de LoRa', como: 'Ptx y sensibilidad por SF, citados.',
                 desbloquea: 'las cuatro filas de `lora_eu868`' }];

const md = I.genera({ escenario: escenario, tabla: tabla, alcance: alcance, pasos: pasos });

/* ── 2 · REPRODUCIBLE ─────────────────────────────────────────────────────── */
check('el mismo escenario da el MISMO informe, byte a byte',
      md === I.genera({ escenario: escenario, tabla: tabla, alcance: alcance, pasos: pasos }));
check('no hay ningún reloj dentro del informe',
      !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(md.replace(/12:00/g, '')),
      (md.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g) || []).join(' '));
check('  y lo dice, para que quien lo lea sepa que puede recrearlo',
      /no hay ningún reloj dentro/.test(md));
check('la fecha que sale es la del ESCENARIO, no la de ahora',
      /2026-09-24 12:00/.test(md), (md.match(/guardado el [^_]*/) || [])[0]);

/* ── LAS CINCO SECCIONES, EN SU ORDEN ─────────────────────────────────────── */
I.SECCIONES.forEach((s, i) => {
  check('está la sección «' + s + '», la ' + (i + 1),
        md.indexOf('## ' + (i + 1) + '. ' + s) >= 0);
});
const pos = I.SECCIONES.map(s => md.indexOf('## ') >= 0 ? md.indexOf(s) : -1);
check('y van en el orden del encargo', pos.every((p, i) => i === 0 || p > pos[i - 1]), pos.join(','));

/* ── 1 · SIN «LO NO MEDIDO» NO SE PUBLICA ────────────────────────────────── */
/* La vía por la que la sección puede quedarse vacía es que alguien la apague,
   y eso lo prueba la mutación `faltaOpcional`, no una llamada de aquí. Lo que sí
   se comprueba aquí es la otra negativa: sin escenario no hay informe. */
let paro = false, msg = '';
try { I.genera({ tabla: tabla }); } catch (e) { paro = true; msg = String(e.message); }
check('sin escenario NO hay informe', paro, 'no se paró');
check('  y el mensaje dice que el punto 7 es la entrada del 8', /punto 7 es la entrada/.test(msg), msg);

/* ── 3 · LOS HUECOS, COMO HUECOS ─────────────────────────────────────────── */
const huecos = I.huecosDeTabla(tabla);
check('los huecos de la tabla se detectan todos', huecos.length === 4, huecos.length);
check('  con su criterio, su tecnología y su motivo',
      huecos.every(h => h.criterio && h.tecnologia && h.motivo));
check('una celda sin valor se escribe «no se puede», no un guion',
      /\*\*no se puede\*\*/.test(md) && !/\| - \|/.test(md));
check('el motivo de cada hueco sale en el informe',
      /falta rx_sens_dbm/.test(md) && /falta ptx_dbm/.test(md));
check('el informe declara CUÁNTOS huecos trae', /Huecos declarados: 4\./.test(md),
      (md.match(/Huecos declarados[^\n]*/) || [])[0]);
check('  y avisa de que un 0 con la tabla llena de huecos sería un defecto suyo',
      /el informe está mintiendo/.test(md));
/* ORDEN MEDIDO, no supuesto: `localeCompare` en español pone «saltos» ANTES que
   «TCU» —compara sin distinguir may��sculas y `s` < `t`—, al revés de lo que yo
   había escrito de cabeza. El banco lo dijo al primer intento. Lo que importa no
   es cuál va primero, sino que el orden NO dependa del recorrido. */
/* EL ORDEN ENTERO, no un par. Mirar sólo dos filas dejaba pasar la mutación:
   con estos datos, ordenar y dar la vuelta ponen las mismas dos primero. Es la
   tercera vez hoy que un caso de prueba no distingue lo que dice distinguir. */
/* SÓLO la sección 4: la 1 también tiene filas con backticks y las colaba. */
const secNM = md.slice(md.indexOf('## 4. Lo no medido'), md.indexOf('## 5. '));
const filasHueco = (secNM.match(/^\| [^|]+ \| `[^`]+` \| [^|]+ \|$/gm) || [])
  .map(l => l.split('|')[1].trim() + '/' + l.split('|')[2].trim().replace(/`/g, ''));
const esperado = I.huecosDeTabla(tabla)
  .map(h => h.criterio + '/' + h.tecnologia)
  .sort((a, b) => a.localeCompare(b));
check('el listado de huecos va ORDENADO ENTERO, no en orden de recorrido',
      filasHueco.join(' ') === esperado.join(' '),
      'sale [' + filasHueco.join(', ') + '] y se esperaba [' + esperado.join(', ') + ']');

/* ── EL ALCANCE, QUE ES UNA SECCIÓN Y NO UNA NOTA AL PIE ──────────────────── */
check('el alcance dice la población y el denominador',
      /215/.test(md) && /denominador/i.test(md));
check('  y el umbral con el que se decidió «enlaza»', /sensibilidad pelada/.test(md));
check('  y el sesgo de la población', /cota inferior/.test(md));
check('la procedencia de cada parámetro sale en la primera sección',
      /sha256 `ffffffffffff…`/.test(md), (md.match(/sha256[^|]*/) || [])[0]);
check('y el commit del motor sale como lo que es: ausente y con motivo',
      /no conoce su propio commit/.test(md));

/* Y LA PUERTA, DISPARADA DE VERDAD: un hueco declarado sin decir de qué va no
   se puede listar, así que el informe NO SE PUBLICA. Sin esto, apagar la puerta
   no lo notaba nadie — su mutación salía verde. */
let noPublica = false, msgP = '';
try {
  I.genera({ escenario: escenario, tabla: tabla, alcance: alcance, pasos: pasos,
             huecosExtra: [{ motivo: 'algo que no se midió, sin decir de qué' }] });
} catch (e) { noPublica = true; msgP = String(e.message); }
check('un hueco que la sección no puede listar IMPIDE publicar', noPublica, 'se publicó igual');
check('  y el mensaje dice que no se publica y por qué',
      /NO SE PUBLICA/.test(msgP) && /carta de presentación/.test(msgP), msgP.slice(0, 120));

/* LA PUERTA DE PUBLICACIÓN, PROBADA DE CERCA. `sinListar` es la que decide, y se
   prueba directamente: a través de todo el generador no se puede llegar a ella
   con la sección incompleta, y una puerta que sólo se ejercita de refilón es una
   puerta que nadie mira. */
check('`sinListar` no encuentra nada que falte cuando la sección los lista todos',
      I.sinListar(md, I.huecosDeTabla(tabla)).length === 0);
check('y CAZA el que se quede fuera',
      I.sinListar('| saltos, máximo | `lora_eu868` | x |', I.huecosDeTabla(tabla)).length === 3,
      I.sinListar('| saltos, máximo | `lora_eu868` | x |', I.huecosDeTabla(tabla)).join(' · '));

/* Sin pasos, el informe lo DICE en vez de callarse la sección. */
const sinPasos = I.genera({ escenario: escenario, tabla: tabla, alcance: alcance, pasos: [] });
check('sin pasos para cerrarlo, se dice que eso es un hueco más',
      /es un hueco más/.test(sinPasos));

/* UN HUECO SE ESCRIBE COMO HUECO, TAMBIÉN EN LA PRIMERA SECCIÓN */
const conHuecos = I.genera({ escenario: E.captura(Object.assign({}, {
  ahora: '2026-09-24T12:00:00.000Z', planta: 'x', variante: 'v',
  paramsSha: 'f'.repeat(64), ejeM: {valor:1.2}, vegetacion: {modelo:null},
  terreno: {id:'t', ok:null, motivo:'no se cargó'} })),
  tabla: tabla, alcance: alcance, pasos: pasos });
/* EL NaN SE PRUEBA CON UN ESCENARIO CRUDO, no con uno de `captura()`: aquél ya
   lo convierte en null, así que por esa vía la guardia del informe no se puede
   ejercitar — su mutación salía verde. Y `genera()` acepta cualquier objeto,
   que para eso es un redactor: un llamante que no pase por `captura` es un caso
   real, no rebuscado. */
const crudo = I.genera({ escenario: { _formato: 1, planta: 'x', variante: 'v',
    eje_m: NaN, cuerda_m: Infinity, params_sha256: 'f'.repeat(64), ncus: [],
    vegetacion: { modelo: null }, terreno: { id: 't', ok: null, motivo: 'no se cargó' } },
  tabla: tabla, alcance: alcance, pasos: pasos });
check('un NaN NUNCA se imprime como dato, ni viniendo de un escenario crudo',
      !/\bNaN\b/.test(crudo) && !/Infinity/.test(crudo),
      (crudo.match(/[^|]*(NaN|Infinity)[^|]*/) || [])[0]);
check('  y tampoco en uno hecho con `captura`', !/\bNaN\b/.test(conHuecos),
      (conHuecos.match(/[^|]*NaN[^|]*/) || [])[0]);
check('la vegetación sin modelo sale «no modelada», no como `{"modelo":null}`',
      /\*\*no modelada\*\*/.test(conHuecos) && !/"modelo":null/.test(conHuecos));
check('la altura de eje dice si es medida o declarada',
      /declarada, no medida|medida en planta|\*\*sin valor\*\*/.test(conHuecos));
check('un terreno que NO se intentó no se lee como uno que falló',
      /no se intentó/.test(conHuecos) && !/se intentó y NO se pudo/.test(conHuecos));

/* ── EL ALCANCE DEL BANCO ─────────────────────────────────────────────────── */
const PISO = 34, PISO_MUT = 8;
console.log('\nalcance: ' + I.SECCIONES.length + ' secciones exigidas · ' +
            Object.keys(MUTACIONES).length + ' mutaciones (piso ' + PISO_MUT + ')');
console.log('');
if (ko) { console.log('FALLAN ' + ko + ' de ' + (ok + ko) + ' comprobaciones'); process.exit(1); }
if (ok < PISO || Object.keys(MUTACIONES).length < PISO_MUT) {
  console.log('ALCANCE INSUFICIENTE: nada ha fallado, pero esto no ha mirado bastante (' +
              ok + ' de ' + PISO + ').');
  process.exit(2);
}
console.log('TODO OK — ' + ok + ' comprobaciones');
