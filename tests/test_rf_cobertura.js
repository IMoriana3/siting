// RF-01 — las filas de módulos eran rectas infinitas. Banco sin navegador.
//
// Por qué existe este fichero: `siting` no tenía NINGUNA prueba. La capa RF
// pinta un mapa de cobertura por TCU y ese mapa se mira para decidir dónde va
// una NCU; se equivocaba en 27 dB y nada lo decía.
//
// Cómo: extrae el bloque RF del index.html REAL —no una copia, que se quedaría
// probando una versión vieja mientras la página evoluciona— y lo corre en un
// contexto con lo justo (`S`, `document`, `ZigbeePV`).
//
//   node tests/test_rf_cobertura.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra ? ' -> ' + extra : '')); }
};

// ── extraer el bloque RF del HTML de verdad ──
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const m = html.match(/const RF_PITCH_M[\s\S]*?\n}\n(?=function rfColor)/);
check('el bloque RF se localiza en index.html', !!m);
if (!m) { console.log('\nFALLOS: ' + ko); process.exit(1); }

const ZigbeePV = require(path.join(RAIZ, 'zigbee_pv_model.js'));
const ctx = {
  console, ZigbeePV, window: { ZigbeePV },
  document: { getElementById: () => ({ value: '30' }) },
  S: { motors: [], p: { twid: 12, tlen: 64 }, bifilo: null, _rfRows: null },
};
vm.createContext(ctx);
try { vm.runInContext(m[0], ctx); } catch (e) { check('el bloque RF compila', false, e.message); }
check('el bloque RF compila y expone rfRows/rfObstacles',
  typeof ctx.rfRows === 'function' && typeof ctx.rfObstacles === 'function');
const S = ctx.S;

// ── utilidades de escenario ──
function plantaGirada(azDeg, n = 6, len = 64, wid = 12, pitch = 12) {
  const a = azDeg * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a);
  S.bifilo = null; S.p = { twid: wid, tlen: len }; S.motors = [];
  for (let k = -n; k <= n; k++)
    S.motors.push({ x: k * pitch * ux, y: k * pitch * uy, len, wid, az: azDeg });
  S._rfRows = null; ctx.rfRows();
  return { a, ejeLargo: { x: Math.sin(a), y: Math.cos(a) } };
}
const margenLimpio = ZigbeePV.predictLink(
  { x: 0, y: 0, ground: 0, h: 1.5 }, { x: 150, y: 0, ground: 0, h: 1.5 },
  ZigbeePV.defaultParamsElBurgo(), null, []).marginDb;

// ── 1) AZIMUT ──────────────────────────────────────────────────────────────
// Un enlace PARALELO a las filas no cruza ninguna. Con las filas modeladas como
// rectas verticales infinitas, en una planta girada barría coordenadas X y se
// llevaba un obstáculo por cada una. Medido contra el código anterior:
//     az=0°  0 obst. ·  0,00 dB     az=23,7°  5 obst. · 27,37 dB  (+12,88 → −14,49)
//     az=10° 2 obst. · 19,50 dB     az=45°    6 obst. · 25,64 dB
// O sea que los enlaces MÁS despejados de una planta girada —los del pasillo—
// se pintaban como sin cobertura.
[0, 10, 23.7, 30, 45].forEach(az => {
  const { ejeLargo } = plantaGirada(az);
  const fin = { x: 150 * ejeLargo.x, y: 150 * ejeLargo.y };
  const obs = ctx.rfObstacles({ x: 0, y: 0 }, fin);
  check(`az=${az}°: un enlace paralelo a las filas no cruza ninguna`,
    obs.length === 0, obs.length + ' obstáculos');
  const mg = ctx.rfMargin({ x: 0, y: 0 }, fin);
  check(`az=${az}°: y por tanto no se le penaliza el margen`,
    Math.abs(mg - margenLimpio) < 0.01,
    mg.toFixed(2) + ' dB frente a ' + margenLimpio.toFixed(2) + ' limpio');
});

// El control, que es lo que impide que "0 obstáculos" sea un fallo disfrazado
// de arreglo: el enlace PERPENDICULAR sí las cruza todas.
{
  const { a } = plantaGirada(23.7);
  const ux = Math.cos(a), uy = -Math.sin(a);
  const obs = ctx.rfObstacles({ x: -90 * ux, y: -90 * uy }, { x: 90 * ux, y: 90 * uy });
  check('az=23,7°: el enlace PERPENDICULAR sí cruza las 13 filas',
    obs.length === 13, obs.length + ' obstáculos');
}

// ── 2) LONGITUD FINITA ─────────────────────────────────────────────────────
// Antes: filas de 64 m centradas en y=0 y un enlace a 500 m al norte contaba
// las 7 y daba −15,53 dB. El enlace no pasa ni cerca.
{
  plantaGirada(0, 3);
  const lejos = ctx.rfObstacles({ x: -40, y: 500 }, { x: 40, y: 500 });
  check('las filas tienen final: un enlace 500 m al norte no cruza ninguna',
    lejos.length === 0, lejos.length + ' obstáculos');
  const cerca = ctx.rfObstacles({ x: -40, y: 0 }, { x: 40, y: 0 });
  check('y el MISMO enlace a la altura de las filas sí las cruza',
    cerca.length === 7, cerca.length + ' obstáculos');
  const borde = ctx.rfObstacles({ x: -40, y: 31.9 }, { x: 40, y: 31.9 });
  check('justo dentro del extremo (y=31,9 de 32) todavía cruza',
    borde.length === 7, borde.length + ' obstáculos');
  const fuera = ctx.rfObstacles({ x: -40, y: 32.1 }, { x: 40, y: 32.1 });
  check('y justo fuera (y=32,1) ya no', fuera.length === 0, fuera.length + ' obstáculos');
}

// ── 3) CALLES Y BLOQUES DESENCAJADOS ───────────────────────────────────────
// Antes contaba 6 filas donde el enlace cruza 3: los dos bloques comparten
// coordenadas X, y con filas infinitas eso basta para contarlos todos.
{
  S.bifilo = null; S.p = { twid: 12, tlen: 64 }; S.motors = [];
  for (let k = -3; k <= -1; k++) S.motors.push({ x: k * 12, y: 0, len: 64, wid: 12, az: 0 });
  for (let k = 1; k <= 3; k++) S.motors.push({ x: k * 12, y: 80, len: 64, wid: 12, az: 0 });
  S._rfRows = null; ctx.rfRows();
  check('con dos bloques desencajados, el enlace por el primero cruza 3',
    ctx.rfObstacles({ x: -40, y: 0 }, { x: 40, y: 0 }).length === 3);
  check('y el enlace por el segundo, otras 3',
    ctx.rfObstacles({ x: -40, y: 80 }, { x: 40, y: 80 }).length === 3);
  check('y por la calle de en medio, ninguna',
    ctx.rfObstacles({ x: -40, y: 40 }, { x: 40, y: 40 }).length === 0);
}

// ── 4) NO REGRESIÓN: las plantas SIN girar no se mueven ────────────────────
// El Burgo y Fayón son az=0 y bífilas. Ahí el modelo viejo acertaba, así que
// esta corrección no puede cambiarles ni un decimal. Congelado con lo MEDIDO
// contra el código anterior (obstáculos y margen por seguidor).
{
  S.p = { twid: 12, tlen: 64 }; S.bifilo = { cuerda: 2.38 }; S.motors = [];
  for (let k = -8; k <= 8; k++) S.motors.push({ x: k * 12, y: 0, len: 64, wid: 12, az: 0 });
  S._rfRows = null; ctx.rfRows();
  const ncu = { x: -100, y: 0 }, obtenido = [];
  for (const mm of S.motors) {
    obtenido.push(mm.x.toFixed(0) + ':' + ctx.rfObstacles(ncu, { x: mm.x, y: mm.y }).length +
      ':' + ctx.rfMargin(ncu, { x: mm.x, y: mm.y }).toFixed(2));
  }
  const ESPERADO = '-96:0:43.62 -84:2:5.36 -72:4:-5.75 -60:6:-15.25 -48:8:-10.75 ' +
    '-36:10:-10.69 -24:12:-11.78 -12:14:-13.19 0:16:-14.66 12:18:-16.11 24:20:-17.50 ' +
    '36:22:-18.82 48:24:-20.06 60:26:-21.24 72:28:-22.35 84:30:-23.40 96:32:-24.40';
  check('una planta az=0 bífila da EXACTAMENTE lo que daba antes',
    obtenido.join(' ') === ESPERADO, '\n     esperado ' + ESPERADO + '\n     obtenido ' + obtenido.join(' '));
  // `segs` con guarda a propósito: si alguien vuelve al modelo viejo, `_rfRows`
  // es un array pelado y esto reventaba a mitad del banco, ocultando el resto
  // de los fallos. Un retroceso tiene que verse ENTERO, no hasta la primera
  // excepción.
  const _segs = (S._rfRows && S._rfRows.segs) || null;
  check('y la bífila aporta DOS bandas por seguidor, no una',
    !!_segs && _segs.length === 2 * S.motors.length,
    _segs ? (_segs.length + ' segmentos para ' + S.motors.length + ' seguidores')
          : 'rfRows() ya no devuelve segmentos: ha vuelto el modelo de rectas infinitas');
}

// ── 5) la distancia sobre el enlace es la ACUMULADA, no la coordenada ──────
{
  S.bifilo = null; S.p = { twid: 12, tlen: 64 }; S.motors = [];
  S.motors.push({ x: 0, y: 0, len: 64, wid: 12, az: 0 });    // fila en x=0, y∈[-32,32]
  S._rfRows = null; ctx.rfRows();
  // Enlace a 45°, de (-30,-30) a (30,30): corta la fila en (0,0), o sea a la
  // MITAD del enlace. Si se usara la coordenada x en vez de la distancia sobre
  // el enlace, saldría 30 en vez de 42,43.
  const obs = ctx.rfObstacles({ x: -30, y: -30 }, { x: 30, y: 30 });
  const D = Math.hypot(60, 60);
  check('el obstáculo va a la mitad del enlace, medido SOBRE el enlace',
    obs.length === 1 && Math.abs(obs[0][0] - D / 2) < 1e-6,
    obs.length ? obs[0][0].toFixed(4) + ' frente a ' + (D / 2).toFixed(4) : 'ninguno');
}

// ── 6) ZOMBI: ¿cazarían estas pruebas la vuelta a las filas infinitas? ─────
// Una prueba que no se puede poner roja no prueba nada. Se reimplementa aquí
// el modelo ANTERIOR —la fila como recta vertical en X— y se comprueba que las
// expectativas de arriba fallarían contra él.
{
  const infinitas = (n, mm, xs) => {
    const dx = mm.x - n.x, D = Math.hypot(mm.x - n.x, mm.y - n.y);
    if (D < 0.5 || Math.abs(dx) < 1e-6) return [];
    const o = [];
    for (const x of xs) { const t = (x - n.x) / dx; if (t > 0.001 && t < 0.999) o.push(t * D); }
    return o;
  };
  const a = 23.7 * Math.PI / 180, ux = Math.cos(a), uy = -Math.sin(a);
  const xs = []; for (let k = -6; k <= 6; k++) xs.push(k * 12 * ux);
  const paralelo = infinitas({ x: 0, y: 0 },
    { x: 150 * Math.sin(a), y: 150 * Math.cos(a) }, xs);
  check('ZOMBI: con filas infinitas, el enlace paralelo SÍ contaba obstáculos',
    paralelo.length > 0,
    'el modelo viejo reimplementado da 0: entonces la prueba de azimut no prueba nada');

  const xs0 = []; for (let k = -3; k <= 3; k++) xs0.push(k * 12);
  const lejos = infinitas({ x: -40, y: 500 }, { x: 40, y: 500 }, xs0);
  check('ZOMBI: con filas infinitas, el enlace a 500 m SÍ las contaba',
    lejos.length === 7, lejos.length + ' — se esperaban las 7 fantasma');
}

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
  : 'OK — ' + ok + '/' + ok + ' comprobaciones'));
process.exit(ko ? 1 : 0);
