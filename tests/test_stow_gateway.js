// EL REPARTO TCU → GW → NCU, y por qué el agregado de una NCU no es un número.
//
// La orden de stow se manda POR GRUPOS y cada gateway sirve un RANGO de TCU. Si
// dos gateways de la misma NCU están en estados distintos, cualquier estadística
// sobre la NCU entera MEZCLA DOS POBLACIONES. Iñaki lo pidió el 2026-10-01 y
// hasta el 2026-10-03 no se podía hacer, porque faltaba el reparto. Ya está:
//
//     SCADA/tools/tcu-toolbox/plantas/*.json
//     {"nombre": "San Jose NCU18 GW1", "puerto": 503, "tcu_ini": 1, "tcu_fin": 38}
//     {"nombre": "San Jose NCU18 GW2", "puerto": 504, "tcu_ini": 39, "tcu_fin": 122}
//
// ESTE BANCO NO LEE ESE FICHERO. Vive en otro repositorio, y un banco que
// depende de un repo hermano sale verde en una máquina y rojo en la otra —ya
// pasó aquí, y está escrito en el propio workflow—. Así que mide el PARSEO y la
// ASIGNACIÓN contra `tests/fixture_gw/plantas_fixture.json`, que reproduce la
// forma del fichero real más dos casos puestos a propósito: una NCU que el
// fichero NO desglosa por gateway, y una con tres gateways y un hueco.
//
// Las reglas, cada una con su mutación:
//
//   1. el rango es CERRADO        · `fin` acota; sin él todo cae en el primero
//   2. los bordes son del tramo   · 38 es GW1 y 39 es GW2, sin desplazamiento
//   3. sin desglose NO se reparte · una NCU sin «GW» no es una NCU de un gateway
//   4. una velocidad negativa no es un stow · el stow va HACIA la posición
//
//   node tests/test_stow_gateway.js
//   MUTA=<clave> node tests/test_stow_gateway.js      (TIENE que salir rojo)
//
// rc = 0 mide · 1 rojo · 2 no comprobado
'use strict';
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const RAIZ = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixture_gw', 'plantas_fixture.json');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};

/* ── MUTACIONES ─────────────────────────────────────────────────────────── */
const MUTACIONES = {
  // el rango deja de estar acotado por arriba: TODO cae en el primer tramo que
  // empiece por debajo, así que GW1 se come las TCU de GW2 y el reparto miente
  // justo en el sentido que más duele (el gateway averiado absorbe al sano).
  rangoAbierto: ['tools/stow_desde_scada.mjs',
    'const t = tramos.find(x => tcu >= x.ini && tcu <= x.fin);',
    'const t = tramos.find(x => tcu >= x.ini);'],
  // desplaza el borde: la 38 pasa a GW2 y la 39 se queda sin dueño o cambia.
  bordeDesplazado: ['tools/stow_desde_scada.mjs',
    'const t = tramos.find(x => tcu >= x.ini && tcu <= x.fin);',
    'const t = tramos.find(x => tcu > x.ini && tcu <= x.fin);'],
  // una NCU que el fichero no desglosa se trata como si tuviera UN gateway:
  // inventarse que «sin GW en el nombre» significa «un solo gateway».
  sinDesgloseSeInventa: ['tools/stow_desde_scada.mjs',
    '    return { tramos: [], sinGw: sinGw.length };',
    "    return { tramos: sinGw.map(p => ({ gw: 'GW1', puerto: p.puerto ?? null, ini: p.tcu_ini, fin: p.tcu_fin, nombre: p.nombre })), sinGw: 0 };"],
  // deja de filtrar el sentido: un ajuste con velocidad negativa cuenta como
  // stow, así que el gateway averiado aparenta tener una medida.
  cuelaElSentido: ['tools/stow_desde_scada.mjs',
    'const gok = g.filter(t => t.es_stow && t.vel_grados_s > 0);',
    'const gok = g.filter(t => t.es_stow);'],
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

/* El útil es ESM y este banco CommonJS: se carga por un hijo que imprime JSON.
   Así la mutación se mide sobre el fichero de verdad, no sobre una copia. */
function pide(expr) {
  const src =
    "import { mapaGateways, deQuienEs } from " + JSON.stringify(path.join(RAIZ, 'tools', 'stow_desde_scada.mjs')) + ";\n" +
    "const F = " + JSON.stringify(FIXTURE) + ";\n" +
    "console.log(JSON.stringify((" + expr + ")));\n";
  const out = execFileSync('node', ['--input-type=module', '-e', src],
                           { encoding: 'utf8', timeout: 120000 });
  return JSON.parse(out);
}

let base;
try {
  base = pide("{ n18: mapaGateways(F,18), n11: mapaGateways(F,11), n7: mapaGateways(F,7), n4: mapaGateways(F,4), n99: mapaGateways(F,99) }");
} catch (e) {
  console.error('no se ha podido cargar tools/stow_desde_scada.mjs: ' + (e.message || e));
  if (restaurar) restaurar();
  process.exit(2);
}

/* ── 0 · EL FIXTURE ES LO QUE DICE SER ─────────────────────────────────── */
check('el fixture existe y es JSON', fs.existsSync(FIXTURE) && JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).plantas.length === 8);
check('y dice en su cabecera que es un fixture y no dato de planta',
      /FIXTURE DEL BANCO/.test(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))._comentario));

/* ── 1 · EL PARSEO ──────────────────────────────────────────────────────── */
check('NCU18 da DOS tramos', base.n18.tramos.length === 2, base.n18.tramos.length);
check('GW1 es TCU 1–38', base.n18.tramos[0].gw === 'GW1' && base.n18.tramos[0].ini === 1 && base.n18.tramos[0].fin === 38,
      JSON.stringify(base.n18.tramos[0]));
check('GW2 es TCU 39–122', base.n18.tramos[1].gw === 'GW2' && base.n18.tramos[1].ini === 39 && base.n18.tramos[1].fin === 122,
      JSON.stringify(base.n18.tramos[1]));
check('el gateway se distingue por el PUERTO: 503 y 504',
      base.n18.tramos[0].puerto === 503 && base.n18.tramos[1].puerto === 504,
      base.n18.tramos.map(t => t.puerto).join('/'));
check('tres gateways se leen como tres', base.n7.tramos.length === 3, base.n7.tramos.length);
check('y un hueco en los rangos NO se rellena (GW2 empieza en 32, no en 21)',
      base.n7.tramos[1].ini === 32, base.n7.tramos[1].ini);

/* ── 2 · LOS BORDES ────────────────────────────────────────────────────── */
const dq = pide("(() => { const {tramos}=mapaGateways(F,18); return [1,2,37,38,39,40,121,122,123,0,-1].map(t=>[t,deQuienEs(tramos,t)]); })()");
const de = n => (dq.find(x => x[0] === n) || [])[1];
check('la TCU 1 es de GW1', de(1) === 'GW1', de(1));
check('la TCU 38 es de GW1 — el borde es DEL tramo', de(38) === 'GW1', de(38));
check('la TCU 39 es de GW2 — y el siguiente borde también', de(39) === 'GW2', de(39));
check('la TCU 122 es de GW2', de(122) === 'GW2', de(122));
check('la TCU 123 no es de nadie, y no se asigna a ojo', de(123) === null, de(123));
check('la TCU 0 tampoco', de(0) === null, de(0));
check('GW2 no absorbe TCU de GW1 (la 37 sigue en GW1)', de(37) === 'GW1', de(37));
check('GW1 no absorbe TCU de GW2 (la 40 está en GW2)', de(40) === 'GW2', de(40));

/* ── 3 · SIN DESGLOSE NO SE REPARTE ────────────────────────────────────── */
// La trampa: «Ayora NCU4» no lleva «GW» en el nombre. De ahí NO se sigue que
// tenga un solo gateway — se sigue que el fichero no lo desglosa. Suponerlo
// sería meter un dato que nadie ha dado.
check('una NCU sin «GW» en el nombre NO da tramos', base.n4.tramos.length === 0, base.n4.tramos.length);
check('pero SÍ se cuenta que existe, para poder decirlo', base.n4.sinGw === 1, base.n4.sinGw);
check('una NCU que no está da cero y cero', base.n99.tramos.length === 0 && base.n99.sinGw === 0,
      JSON.stringify(base.n99));

/* ── 4 · LAS DOS CANDIDATAS COINCIDEN EN EL CORTE ──────────────────────── */
// Esto es lo que hace SEGURA la atribución del stow del 24-09 sin saber de qué
// NCU salió: las dos NCU cuyo GW1 acaba en 38 coinciden en ese corte, así que
// «TCU 1–38 es el primer gateway» vale para las dos. Lo que las distingue es el
// final de GW2 (122 contra 118).
check('NCU11 y NCU18 coinciden en GW1 = 1–38',
      base.n11.tramos[0].ini === base.n18.tramos[0].ini && base.n11.tramos[0].fin === base.n18.tramos[0].fin,
      JSON.stringify([base.n11.tramos[0], base.n18.tramos[0]]));
check('y se distinguen por el final de GW2 (118 contra 122)',
      base.n11.tramos[1].fin === 118 && base.n18.tramos[1].fin === 122,
      base.n11.tramos[1].fin + '/' + base.n18.tramos[1].fin);

/* ── 5 · EL SENTIDO: UNA VELOCIDAD NEGATIVA NO ES UN STOW ──────────────── */
// Las guardas de racha miran AMPLITUD y AJUSTE, que no llevan signo, así que un
// tramo que se mueve al revés las pasa. Medido el 2026-10-03 sobre el evento
// real: hay exactamente uno, con R² 0,9992 — un ajuste excelente a un movimiento
// en el sentido contrario. Aquí se comprueba sobre el FUENTE, porque el dato de
// campo no está en este repo.
const fuente = fs.readFileSync(path.join(RAIZ, 'tools', 'stow_desde_scada.mjs'), 'utf8');
check('el reparto filtra por signo antes de la estadística',
      /const gok = g\.filter\(t => t\.es_stow && t\.vel_grados_s > 0\);/.test(fuente));
check('y los descartados por sentido se PUBLICAN, no se tiran en silencio',
      /DESCARTADOS POR SENTIDO/.test(fuente));
check('con el motivo escrito: las guardas no llevan signo',
      /AMPLITUD y AJUSTE, que no llevan signo/.test(fuente));

/* ── 6 · SIN MAPA NO SE INVENTA EL CORTE ───────────────────────────────── */
check('sin --mapa el útil dice que NO ha repartido',
      /SIN REPARTO POR GATEWAY: no se ha dado --mapa y --ncu/.test(fuente));
check('y avisa de que el agregado mezcla poblaciones',
      /mezcla poblaciones/.test(fuente));
check('con mapa pero sin desglose, también lo dice',
      /NO SE HA REPARTIDO/.test(fuente) && /No se supone el corte/.test(fuente));
check('las TCU del volcado que no caen en ningún rango se avisan',
      /NO caen en ningún rango/.test(fuente));

/* ── 7 · LO QUE LA TABLA NO PUEDE DECIR, LO DICE ───────────────────────── */
check('la tabla avisa de que «A» mide el ritmo del operador',
      /mide sobre todo SU ritmo/.test(fuente));
check('y de que radio contra equipo sigue sin decidirse',
      /radio contra equipo sigue sin/.test(fuente));

fin();
