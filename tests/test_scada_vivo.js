// SCADA EN VIVO — el sondeo, el índice Modbus y qué se enseña cuando la red se cae.
//
// Por qué existe: esta capa se rescató el 18-09 de `siting/demo-siting.html`, una copia de esta
// misma aplicación que se quedó en una rama vieja de SolarGPTfull (21-08) y nunca llegó a main.
// Allí no tenía ninguna prueba. Aquí sí, porque lo que pinta se mira para decidir si un seguidor
// está bien o mal, y equivocarse en eso manda a alguien al campo a mirar la TCU que no es.
//
// Sin navegador, como el resto del repo: se extrae el bloque del index.html REAL —no una copia,
// que se quedaría probando una versión vieja mientras la página evoluciona— y se corre en un
// contexto con lo justo.
//
//   node tests/test_scada_vivo.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
};

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const m = html.match(/function buildScadaIndex\(\)\{[\s\S]*?function scadaStop\(\)\{[\s\S]*?\n\}/);
check('el bloque SCADA se localiza en index.html', !!m);
const mc = html.match(/function motorColor\(m\)\{[\s\S]*?\n\}/);
check('y motorColor también', !!mc);
if (!m || !mc) { console.log('\nFALLOS: ' + ko); process.exit(1); }

// ── el andamiaje: lo justo para que el bloque viva ──
let pintados = 0, chip = { innerHTML: '', remove(){ chip.quitado = true; } };
const timers = [];
const ctx = {
  console, Date,
  draw: () => { pintados++; },
  setInterval: (f, ms) => { timers.push(ms); return timers.length; },
  clearInterval: () => { timers.pop(); },
  localStorage: { store: {}, setItem(k, v){ this.store[k] = v; }, getItem(k){ return this.store[k] || null; } },
  prompt: () => null,
  document: {
    getElementById: id => (id === 'scada-chip' ? (chip.quitado ? null : chip) : (id === 'tooltip' ? { parentNode: { appendChild(){} } } : null)),
    createElement: () => ({ style: {}, set innerHTML(v){ chip.innerHTML = v; }, get innerHTML(){ return chip.innerHTML; }, remove(){ chip.quitado = true; } }),
  },
  S: null, fetch: null,
  hueColor: () => '#hue', S_dummy: null,
};
ctx.window = ctx;
vm.createContext(ctx);
try { vm.runInContext(m[0] + '\n' + mc[0], ctx); }
catch (e) { check('el bloque compila', false, e.message); console.log('\nFALLOS: ' + ko); process.exit(1); }
check('el bloque compila y expone lo suyo',
  ['buildScadaIndex','scadaOf','scadaTip','fmtAge','scadaChip','scadaPoll','scadaStart','scadaStop','motorColor']
    .every(f => typeof ctx[f] === 'function'));

const nuevoS = () => ({
  motors: [], ncus: [], ncuColor: {}, v: { gw: false },
  scada: { on: false, url: null, interval: 20, data: {}, last: null, err: null, timer: null },
});

// ── 1) EL ÍNDICE MODBUS ────────────────────────────────────────────────────
// Es una CONVENCIÓN, no un dato: 1..N dentro de CADA NCU, ordenando por (GW, nº en GW). Si esto
// numerase de corrido por toda la planta, cada seguidor leería el estado de otro.
ctx.S = nuevoS();
ctx.S.motors = [
  { ncu: 'NCU-2', gw: 2, tn: 1 }, { ncu: 'NCU-1', gw: 1, tn: 2 },
  { ncu: 'NCU-1', gw: 2, tn: 1 }, { ncu: 'NCU-1', gw: 1, tn: 1 },
  { ncu: 'NCU-2', gw: 1, tn: 5 }, { ncu: null, gw: 1, tn: 9 },
];
ctx.buildScadaIndex();
const idx = ctx.S.motors.map(x => x.scadaIdx);
check('numera dentro de cada NCU, no de corrido',
  Math.max(...ctx.S.motors.filter(x => x.ncu === 'NCU-1').map(x => x.scadaIdx)) === 3 &&
  Math.max(...ctx.S.motors.filter(x => x.ncu === 'NCU-2').map(x => x.scadaIdx)) === 2, idx);
check('cada NCU empieza por 1',
  ctx.S.motors.filter(x => x.ncu === 'NCU-1').some(x => x.scadaIdx === 1) &&
  ctx.S.motors.filter(x => x.ncu === 'NCU-2').some(x => x.scadaIdx === 1), idx);
const n1 = ctx.S.motors.filter(x => x.ncu === 'NCU-1').sort((a, b) => a.scadaIdx - b.scadaIdx);
check('ordena por GW y luego por número dentro del GW',
  JSON.stringify(n1.map(x => [x.gw, x.tn])) === JSON.stringify([[1,1],[1,2],[2,1]]), n1.map(x => [x.gw, x.tn]));
check('un seguidor sin NCU no recibe índice', ctx.S.motors[5].scadaIdx === undefined, ctx.S.motors[5].scadaIdx);

// ── 2) LA BÚSQUEDA ─────────────────────────────────────────────────────────
ctx.S.scada.data = { 'NCU-1|2': { health: 'ok', tilt_angle: 12.34, target_angle: 12.5, soc: 87 } };
check('scadaOf encuentra el suyo', ctx.scadaOf(n1[1]) && ctx.scadaOf(n1[1]).soc === 87);
check('y devuelve null si ese no vino en el sondeo', ctx.scadaOf(n1[0]) === null);
check('y null si el seguidor ni siquiera tiene NCU', ctx.scadaOf({ ncu: null, scadaIdx: 3 }) === null);

// ── 3) LA EDAD, en unidades que se leen de un vistazo ──────────────────────
check('edad en segundos por debajo de 2 min', ctx.fmtAge(95) === '95 s', ctx.fmtAge(95));
check('en minutos hasta 2 h', ctx.fmtAge(600) === '10 min', ctx.fmtAge(600));
check('y en horas a partir de ahí', ctx.fmtAge(9000) === '2.5 h', ctx.fmtAge(9000));

// ── 4) EL GLOBO ────────────────────────────────────────────────────────────
ctx.S.scada.on = false;
check('con el SCADA apagado el globo no dice nada de SCADA', ctx.scadaTip(n1[1]) === '');
ctx.S.scada.on = true;
check('un seguidor sin dato lo dice, en vez de callar', /sin datos SCADA/.test(ctx.scadaTip(n1[0])));
const tipOk = ctx.scadaTip(n1[1]);
check('con dato enseña estado, ángulo contra objetivo y SoC',
  /OK/.test(tipOk) && /12\.3.*12\.5/.test(tipOk) && /SoC 87%/.test(tipOk), tipOk);
/* UNA TCU OFFLINE NO TIENE ÁNGULO QUE ENSEÑAR. Lo último que se sabe de ella es cuánto lleva
   callada; pintar un ángulo viejo como si fuera de ahora es peor que no pintar nada. */
ctx.S.scada.data['NCU-1|1'] = { health: 'offline', comms_age_s: 4200, tilt_angle: 30, soc: 50 };
const tipOff = ctx.scadaTip(n1[0]);
check('offline enseña desde cuándo está callada', /sin comms 70 min/.test(tipOff), tipOff);
check('y NO enseña ángulo ni SoC viejos', !/ngulo/.test(tipOff) && !/SoC/.test(tipOff), tipOff);
ctx.S.scada.data['NCU-1|3'] = { health: 'alarm', tilt_angle: 5, target_angle: 5, alarms: 'VIENTO' };
check('una alarma se ve', /VIENTO/.test(ctx.scadaTip(n1[2])), ctx.scadaTip(n1[2]));

// ── 5) EL COLOR EN EL PLANO ────────────────────────────────────────────────
check('con el SCADA en vivo el color lo manda el estado, no el reparto por NCU',
  ctx.motorColor(n1[1]) === '#1f9d57' && ctx.motorColor(n1[2]) === '#e0322c' && ctx.motorColor(n1[0]) === '#9aa6b2',
  [ctx.motorColor(n1[1]), ctx.motorColor(n1[2]), ctx.motorColor(n1[0])]);
/* Gris CLARO ≠ gris de offline: «no vino en el sondeo» y «el SCADA dice que está caída» son cosas
   distintas y no pueden pintarse igual, o se sale a campo a mirar la que no es. */
check('un seguidor sin dato va en gris CLARO, distinto del gris de offline',
  ctx.motorColor({ ncu: 'NCU-9', scadaIdx: 1 }) === '#c4ccd4');
ctx.S.scada.on = false;
check('con el SCADA apagado vuelve el color de reparto', ctx.motorColor(n1[1]) === '#hue', ctx.motorColor(n1[1]));

// ── 6) EL SONDEO ───────────────────────────────────────────────────────────
(async () => {
  ctx.S = nuevoS(); ctx.S.scada.on = true; ctx.S.scada.url = 'http://scada.local/';
  chip.innerHTML = ''; chip.quitado = false;
  ctx.fetch = async () => ({ ok: true, json: async () => ({ count: 3, trackers: [
    { ncu: 'NCU-1', tcu: 1, health: 'ok' }, { ncu: 'NCU-1', tcu: 2, health: 'warn' },
    { ncu: 'NCU-2', tcu: 1, health: 'offline' } ] }) });
  const antes = pintados;
  await ctx.scadaPoll();
  check('el sondeo guarda cada TCU por NCU|índice', Object.keys(ctx.S.scada.data).length === 3 &&
    ctx.S.scada.data['NCU-1|2'].health === 'warn', Object.keys(ctx.S.scada.data));
  check('cuenta por estado en el chip', /1<\/span> \/ <span[^>]*>1<\/span> \/ <span[^>]*>0<\/span> \/ <span[^>]*>1 off/.test(chip.innerHTML), chip.innerHTML);
  check('y repinta el plano', pintados === antes + 1);
  check('sin error pendiente', ctx.S.scada.err === null && ctx.S.scada.last instanceof Date);

  /* LO QUE PASA CUANDO SE CAE LA RED, que es la mitad que se olvida: los datos BUENOS se quedan.
     Vaciarlos pintaría toda la planta en gris, como si se hubieran caído los 3.000 seguidores,
     cuando lo caído es el camino hasta el SCADA. El chip dice desde cuándo son los últimos. */
  const buenos = JSON.stringify(ctx.S.scada.data), ultimo = ctx.S.scada.last;
  ctx.fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
  await ctx.scadaPoll();
  check('un 502 NO borra los últimos datos buenos', JSON.stringify(ctx.S.scada.data) === buenos);
  check('lo dice en el chip, con la hora del último dato bueno',
    /error: HTTP 502/.test(chip.innerHTML) && /último dato/.test(chip.innerHTML), chip.innerHTML);
  check('y el último sello de tiempo no se toca', ctx.S.scada.last === ultimo);

  ctx.fetch = async () => { throw new Error('ECONNREFUSED'); };
  await ctx.scadaPoll();
  check('y si no hay ni red, igual: datos intactos y error a la vista',
    JSON.stringify(ctx.S.scada.data) === buenos && /ECONNREFUSED/.test(chip.innerHTML), chip.innerHTML);

  // ── 7) ENCENDER Y APAGAR ─────────────────────────────────────────────────
  ctx.S = nuevoS();
  ctx.S.motors = [{ ncu: 'NCU-1', gw: 1, tn: 1 }];
  ctx.fetch = async () => ({ ok: true, json: async () => ({ count: 0, trackers: [] }) });
  const arrancado = ctx.scadaStart('http://scada.local/api/');
  check('arranca con la URL que se le da', arrancado === true && ctx.S.scada.on === true && ctx.S.scada.url === 'http://scada.local/api/');
  check('deja el índice hecho al arrancar', ctx.S.motors[0].scadaIdx === 1);
  check('y programa el sondeo a su intervalo', timers[timers.length - 1] === 20000, timers);
  check('la URL se recuerda para la próxima', ctx.localStorage.store.scadaApiUrl === 'http://scada.local/api/');
  check('sin URL no arranca', ctx.scadaStart('') === false);

  chip.quitado = false;
  ctx.scadaStop();
  check('al parar se apaga, se quita el temporizador y se borra el chip',
    ctx.S.scada.on === false && ctx.S.scada.timer === null && chip.quitado === true);

  console.log('');
  if (ko) { console.log('FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'); process.exit(1); }
  console.log('OK — ' + ok + '/' + ok + ' comprobaciones');
})();
