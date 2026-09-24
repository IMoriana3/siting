// `tools/stow_desde_scada.mjs`: de la exportación del SCADA a un stow medido.
//
// ═══ QUÉ VIGILA ESTE BANCO Y QUÉ NO ═══
//
// `test_arranques_stow.js` ya vigila el AJUSTE: dado un tramo de giro, que el
// cruce de rectas recupere el arranque dentro de la incertidumbre que declara.
// Aquí se vigila la mitad de ARRIBA, que es donde estaban las trampas reales
// del fichero del 2026-09-24:
//
//   1. una racha de UNA muestra con `sec = 5` no es un stow —y en aquel fichero
//      había 84, todas dos minutos ANTES de que el operador pulsara nada;
//   2. `sec = 5` con el ángulo quieto tampoco lo es: la TCU acepta la posición
//      y en MANUAL no gira;
//   3. un ajuste impecable sobre el giro EQUIVOCADO no es un stow: la TCU 84
//      giró 46,3° con R² = 0,9989 volviendo al seguimiento, con `sec = 0`;
//   4. y el log distingue `safe position 0` de `safe position 5`. Confundirlas
//      mueve el instante de referencia dos minutos.
//
// Los casos son SINTÉTICOS, con la respuesta conocida, y reproducen la forma
// del fichero real: rejilla de 30 s, ángulo en grados con dos decimales,
// `main_state` que no pasa a AUTO hasta después de la orden.
//
//   node tests/test_stow_desde_scada.js
//   MUTA=<clave> node tests/test_stow_desde_scada.js      (TIENE que salir rojo)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};

// ── MUTACIONES ───────────────────────────────────────────────────────────────
// Cada una rompe UNA afirmación. Si alguna deja el banco verde, esa afirmación
// no la vigila nadie.
//
// ═══ POR QUÉ LAS DOS GUARDAS DE RACHA SE PRIVAN JUNTAS ═══
//
// Porque medido sobre el fichero del 2026-09-24 se CUBREN LA UNA A LA OTRA, y
// quitar una sola no cambia un solo veredicto:
//
//     min_muestras_racha   grados_movimiento   stows medidos
//            2                    10                75
//            2                     0                75
//            1                    10                75
//            1                     0             ►   3
//
// Quitando sólo `min_muestras_racha`, el artefacto de una muestra entra como
// racha pero cae por no moverse el ángulo; quitando sólo `grados_movimiento`,
// la racha corta ya no entra porque dura menos de dos sondeos. Hacen falta las
// dos fuera para que la racha elegida pase a ser el artefacto y el ajuste
// quede fuera de ella: 72 de 75 stows se pierden.
//
// Una mutación que quite sólo una de las dos SALE VERDE Y NO PRUEBA NADA. Eso
// ya pasó en la primera versión de este banco, y se arregló midiendo la tabla
// de arriba en vez de suponerla.
const MUTACIONES = {
  // sin NINGUNA de las dos guardas de racha: la racha elegida pasa a ser el
  // artefacto de la orden de posición 0, y el giro real cae fuera de ella.
  sinGuardasDeRacha: M => { M.min_muestras_racha = 1; M.grados_movimiento = 0; },
  // no ata el ajuste a la racha de sec=5: entra cualquier giro bien ajustado,
  // sea stow o vuelta al seguimiento. Es el caso TCU 84.
  sinAtarALaRacha: M => { M.sin_atar = true; },
  // el lector del log no mira la posición pedida: 0 y 5 pasan por lo mismo.
  confundePos0ConPos5: M => { M.pos_indiferente = true; },
};
const MUTA = process.env.MUTA || '';
const M = { min_muestras_racha: null, grados_movimiento: null, sin_atar: false, pos_indiferente: false };
if (MUTA) {
  if (!MUTACIONES[MUTA]) { console.log('FAIL mutación desconocida: ' + MUTA); process.exit(1); }
  MUTACIONES[MUTA](M);
}

// ── FABRICAR UN FICHERO DE TCU ───────────────────────────────────────────────
const CAB = 'datetime;main_state;backtracking;wind_from_east;active_security_position;' +
            'angle;target_angle;soc;remaining_capacity;ps_voltage;ps_current;voltage;current;' +
            'motor_voltage;motor_current;motor_current_peak;motor_state;motor_pwm;' +
            'daily_motor_power_consumption;pcb_temp;battery_temp;alarms_1;alarms_2;hw_alarms;' +
            'system_monitor_status;system_monitor_flags;power_section_alarms';

const T0 = Date.UTC(2026, 8, 24, 14, 40, 0) / 1000;   // 2026-09-24 14:40:00
const reloj = t => new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' ');

// Una TCU sintética: sigue al sol hasta `t_arranque`, luego gira a `vel` °/s
// hasta `objetivo`. `sec5_desde` y `auto_desde` se declaran aparte a propósito,
// porque en el fichero real NO coinciden.
function tcuSintetica({ ang0 = -55, objetivo = 10, vel = 0.18, t_arranque,
                        sec5_desde, sec5_hasta = null, auto_desde, periodo = 30,
                        fase = 0, blips = [], n = 80 }) {
  const filas = [CAB];
  for (let i = 0; i < n; i++) {
    const t = T0 + fase + i * periodo;
    const dt = t - (T0 + t_arranque);
    let ang = ang0 + 0.0024 * (t - T0);                 // seguimiento solar
    if (dt > 0) ang = Math.min(objetivo, ang0 + 0.0024 * (t_arranque) + vel * dt);
    const q = Math.round(ang * 100) / 100;              // dos decimales, como el CSV
    let sec = (sec5_desde != null && t >= T0 + sec5_desde &&
               (sec5_hasta == null || t <= T0 + sec5_hasta)) ? 5 : 0;
    if (blips.some(b => Math.abs(t - (T0 + b)) < 1)) sec = 5;   // el artefacto
    const modo = (auto_desde != null && t >= T0 + auto_desde) ? 'AUTO' : 'MANUAL';
    const mot = (dt > 0 && q < objetivo) ? 'WEST' : 'OFF';
    filas.push([reloj(t), modo, 'false', 'false', sec, q.toFixed(2), objetivo.toFixed(2),
      '100', '5851', '0', '1', '26664', '-25', '0', '0', '0', mot, '0.00', '0',
      '22.4', '26.3', '4', '0', '0', '0', '34', '0'].join(';'));
  }
  return filas.join('\n') + '\n';
}

function logSintetico(lineas) { return lineas.join('\n') + '\n'; }

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const mod = await import('../tools/stow_desde_scada.mjs');
  const { leeEventos, leeTcu, rachasSec, stowDeUnaTcu, analiza, POR_DEFECTO, fechaLocal } = mod;

  // Los parámetros con los que se llama, con la mutación aplicada si la hay.
  const opc = {};
  if (M.min_muestras_racha != null) opc.min_muestras_racha = M.min_muestras_racha;
  if (M.grados_movimiento != null) opc.grados_movimiento = M.grados_movimiento;

  // La mutación `sinAtarALaRacha` no es un parámetro del útil —el útil ATA
  // siempre—, así que se simula sobre su salida: sin atadura, basta un ajuste
  // bueno para llamarlo stow, HAYA O NO racha de sec=5. Las dos mitades son
  // necesarias: «no hay racha» y «el giro cae fuera de ella» son el mismo
  // defecto, y una mutación que sólo tocara la segunda dejaría verde el caso
  // de la TCU 84, que es justo el que originó esta guarda.
  const atadura = r => M.sin_atar
    ? (r.t_arranque_s !== null && r.r2 >= (opc.r2_min ?? POR_DEFECTO.r2_min))
    : r.es_stow;
  const evalua = (filas) => {
    const r = stowDeUnaTcu(filas, opc);
    const v = atadura(r);
    return v === r.es_stow ? r : { ...r, es_stow: v, motivo_no: v ? null : r.motivo_no };
  };

  // 1 · UN STOW LIMPIO SE MIDE, y la velocidad sale donde se puso.
  {
    const f = leeTcu(tcuSintetica({ t_arranque: 300, sec5_desde: 270, auto_desde: 300, vel: 0.18, objetivo: 10 }));
    const r = evalua(f);
    check('1 · un stow limpio se reconoce', r.es_stow === true, r.motivo_no);
    check('2 · la velocidad sale a menos del 2 % de la puesta',
          r.vel_grados_s != null && Math.abs(r.vel_grados_s - 0.18) / 0.18 < 0.02,
          r.vel_grados_s);
    check('3 · el arranque cae a menos de 3 sigmas del puesto',
          r.t_arranque_s != null && Math.abs(r.t_arranque_s - (T0 + 300)) <= 3 * r.sigma_s,
          (r.t_arranque_s - (T0 + 300)).toFixed(2) + ' s, sigma ' + (r.sigma_s || 0).toFixed(2));
  }

  // 4-5 · EL ARTEFACTO DE UNA MUESTRA NO ES UN STOW. Es el caso de las 84
  //       rachas del 2026-09-24: `sec = 5` en un único sondeo, dos minutos
  //       antes, con el ángulo quieto.
  {
    const f = leeTcu(tcuSintetica({ t_arranque: 300, sec5_desde: 270, auto_desde: 300, blips: [120] }));
    const R = rachasSec(f);
    const cortas = R.filter(x => x.n === 1);
    check('4 · el blip aparece como racha de UNA muestra', cortas.length === 1, JSON.stringify(R.map(x => x.n)));
    const r = evalua(f);
    check('5 · el blip no adelanta el arranque',
          r.es_stow === true && r.t_sec5_sostenido_s > T0 + 200,
          r.t_sec5_sostenido_s != null ? (r.t_sec5_sostenido_s - T0) + ' s' : String(r.motivo_no));
    check('6 · y se cuenta como transitorio descartado', r.n_transitorios === 1, r.n_transitorios);
  }

  // 7 · UNA TCU QUE ACEPTA LA POSICIÓN Y NO GIRA NO ES UN STOW. Caso real:
  //     TCU 39 y TCU 110, seis minutos a `sec = 5`, en MANUAL, motor OFF.
  //     OJO CON LO QUE ESTO PRUEBA Y LO QUE NO: aquí el veredicto lo pone el
  //     ajuste, que no encuentra giro que ajustar, no el umbral de grados. Se
  //     deja escrito para que nadie lo lea como la prueba de ese umbral —el
  //     umbral se prueba en la 27 y en la mutación `sinGuardasDeRacha`.
  {
    const f = leeTcu(tcuSintetica({ t_arranque: 1e9, sec5_desde: 270, auto_desde: null, objetivo: 10 }));
    const r = evalua(f);
    check('7 · sec=5 sostenido pero SIN girar no cuenta como stow',
          r.es_stow === false, r.motivo_no);
  }

  // 8-9 · UN GIRO BUENO FUERA DE LA RACHA NO ES UN STOW. Es la TCU 84: vuelve
  //       al seguimiento con `sec = 0`, R² = 0,9989, y sin la atadura se cuela
  //       con un número precioso. Las dos formas del mismo defecto: sin racha
  //       ninguna, y con racha pero el giro fuera.
  {
    const f = leeTcu(tcuSintetica({ t_arranque: 300, sec5_desde: null, auto_desde: 300, objetivo: 55 }));
    const r = evalua(f);
    check('8 · un giro con sec=0 en todo el fichero no cuenta como stow',
          r.es_stow === false, r.motivo_no);
    check('8b · y el ajuste SÍ sale bueno, o sea que lo rechaza la atadura y no el ajuste',
          r.t_arranque_s !== null && r.r2 >= 0.98, `t0=${r.t_arranque_s} R²=${r.r2}`);
  }
  {
    // HAY racha de sec=5 (t = 270…600), pero el giro ocurre a t = 1500, fuera.
    const f = leeTcu(tcuSintetica({ t_arranque: 1500, sec5_desde: 270, sec5_hasta: 600,
                                    auto_desde: 1500, objetivo: 55, n: 90 }));
    const R = rachasSec(f);
    check('9 · el caso tiene de verdad una racha sostenida antes del giro',
          R.some(x => x.n >= 2), JSON.stringify(R.map(x => x.n)));
    const r = evalua(f);
    check('9b · un giro FUERA de la racha de sec=5 no cuenta como stow',
          r.es_stow === false, r.motivo_no);
  }

  // 10-13 · EL LOG. La posición pedida importa: 0 y 5 son órdenes contrarias.
  {
    const texto = logSintetico([
      '2026-09-24 14:42:38;Requesting safe position 0, wind_from_east: 0, for TCU 39. Reason: Default choice',
      '2026-09-24 14:44:18;Position 5 enabled for group 1 by "admin (Administrator)" from the web interface',
      '2026-09-24 14:44:38;Requesting safe position 5, wind_from_east: 0, for TCU 39. Reason: Request from group',
      '2026-09-24 14:44:55;Failed to set the security position for TCU 13',
      '2026-09-24 14:44:59;Group 1 sent to AUTO by "admin (Administrator)" from the web interface',
      '2026-09-24 14:45:21;Sent 9 out of 14 trackers to AUTO mode',
    ]);
    const ev = leeEventos(texto);
    check('10 · lee las dos peticiones y distingue su posición',
          ev.peticiones.length === 2 && ev.peticiones[0].posicion === 0 && ev.peticiones[1].posicion === 5,
          JSON.stringify(ev.peticiones.map(p => p.posicion)));
    check('11 · lee el clic de grupo, el AUTO y el fallo',
          ev.grupos.length === 1 && ev.auto.length === 1 && ev.fallos.length === 1 && ev.fallos[0].tcu === 13,
          `${ev.grupos.length}/${ev.auto.length}/${ev.fallos.length}`);
    check('12 · «Sent N out of M» no se confunde con una petición',
          ev.peticiones.every(p => Number.isFinite(p.tcu)) && ev.peticiones.length === 2,
          ev.peticiones.length);
    // La referencia buena es la petición de posición 5, no la de 0: van 120 s
    // separadas y confundirlas adelanta el reloj ese tanto.
    const pos5 = M.pos_indiferente ? ev.peticiones[0] : ev.peticiones.find(p => p.posicion === 5);
    check('13 · la referencia es la petición de posición 5',
          pos5 && pos5.t === fechaLocal('2026-09-24 14:44:38'),
          pos5 ? reloj(pos5.t) : 'ninguna');
  }

  // 14 · EL MAPEO DE COLUMNAS NO SE ADIVINA: con una cabecera que no las trae,
  //      falla en vez de devolver vacío.
  {
    let salto = false;
    try { leeTcu('a;b;c\n1;2;3\n'); } catch (e) { salto = /no está en la cabecera/.test(String(e.message)); }
    check('14 · con la cabecera equivocada falla, no devuelve vacío', salto === true);
  }

  // 15 · LA HORA SIN ZONA SE LEE COMO LITERAL, y las diferencias no dependen
  //      del origen.
  {
    const a = fechaLocal('2026-09-24 14:44:18'), b = fechaLocal('2026-09-24 14:44:43');
    check('15 · las diferencias de hora salen exactas', b - a === 25, b - a);
    check('16 · una hora mal formada devuelve null', fechaLocal('ayer') === null);
  }

  // 17-20 · LA CARPETA ENTERA, con tres TCU de comportamiento distinto.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stow-'));
    fs.writeFileSync(path.join(dir, 'TCU_001_2026-09-24.csv'),
      tcuSintetica({ t_arranque: 300, sec5_desde: 270, auto_desde: 300, blips: [120] }));
    fs.writeFileSync(path.join(dir, 'TCU_002_2026-09-24.csv'),
      tcuSintetica({ t_arranque: 1e9, sec5_desde: 270, auto_desde: null }));          // acepta y no gira
    fs.writeFileSync(path.join(dir, 'TCU_003_2026-09-24.csv'),
      tcuSintetica({ t_arranque: 600, sec5_desde: 570, auto_desde: 600, vel: 0.17 }));
    fs.writeFileSync(path.join(dir, 'NCU_EVENT_LOG_2026-09-24.csv'), logSintetico([
      '2026-09-24 14:42:00;Requesting safe position 0, wind_from_east: 0, for TCU 1. Reason: Default choice',
      '2026-09-24 14:44:30;Requesting safe position 5, wind_from_east: 0, for TCU 1. Reason: Request from group',
      '2026-09-24 14:44:31;Requesting safe position 5, wind_from_east: 0, for TCU 2. Reason: Request from group',
      '2026-09-24 14:49:30;Requesting safe position 5, wind_from_east: 0, for TCU 3. Reason: Request from group',
    ]));
    const { tcus, eventos } = analiza(dir, opc);
    const porId = Object.fromEntries(tcus.map(t => [t.tcu, t]));
    const stows = tcus.filter(atadura);
    check('17 · lee las tres TCU de la carpeta', tcus.length === 3, tcus.length);
    check('18 · sólo dos son stow', stows.length === 2, stows.map(t => t.tcu).join(','));
    check('19 · la que acepta y no gira sale con su motivo escrito',
          porId[2] && porId[2].es_stow === false && !!porId[2].motivo_no, porId[2] && porId[2].motivo_no);
    check('20 · el transitorio se cuenta y no se traga',
          porId[1] && porId[1].n_transitorios === 1, porId[1] && porId[1].n_transitorios);
    check('21 · la petición de posición 5 se pega a su TCU',
          porId[1] && porId[1].t_peticion5_s === fechaLocal('2026-09-24 14:44:30'),
          porId[1] && porId[1].t_peticion5_s);
    check('22 · el periodo de sondeo se mide, no se supone',
          porId[1] && porId[1].periodo_sondeo_s === 30, porId[1] && porId[1].periodo_sondeo_s);
    check('23 · las velocidades distintas salen distintas',
          porId[1].vel_grados_s > porId[3].vel_grados_s,
          `${porId[1].vel_grados_s} vs ${porId[3].vel_grados_s}`);
    check('24 · el log de la carpeta se lee entero', eventos.peticiones.length === 4, eventos.peticiones.length);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 25 · UNA CARPETA SIN LOG FALLA, no devuelve un análisis a medias.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stow-'));
    fs.writeFileSync(path.join(dir, 'TCU_001_2026-09-24.csv'),
      tcuSintetica({ t_arranque: 300, sec5_desde: 270, auto_desde: 300 }));
    let salto = false;
    try { analiza(dir, opc); } catch (e) { salto = /EVENT_LOG/.test(String(e.message)); }
    check('25 · sin log de eventos falla en vez de seguir', salto === true);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 26 · UNA CARPETA VACÍA FALLA. El vacío es error, no «cero stows».
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stow-'));
    let salto = false;
    try { analiza(dir, opc); } catch (e) { salto = /ningún TCU_/.test(String(e.message)); }
    check('26 · una carpeta sin TCU falla', salto === true);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 27 · EL UMBRAL DE «ÁNGULO MOVIÉNDOSE» NO ESTÁ AJUSTADO. Entre 1° y 40° el
  //      veredicto no cambia: hay un abismo entre los 0,1° de un artefacto y
  //      los 40-102° de un giro. Si esto dejara de cumplirse, el umbral habría
  //      pasado a decidir, y eso hay que verlo.
  {
    const f = leeTcu(tcuSintetica({ t_arranque: 300, sec5_desde: 270, auto_desde: 300, blips: [120] }));
    const veredictos = [1, 5, 10, 20, 40].map(u => stowDeUnaTcu(f, { ...opc, grados_movimiento: u }).es_stow);
    check('27 · el veredicto no depende del umbral entre 1° y 40°',
          veredictos.every(v => v === true), JSON.stringify(veredictos));
  }

  // 28 · Y LOS PARÁMETROS SALEN PUBLICADOS, no escondidos en el código.
  {
    check('28 · el útil publica sus parámetros por defecto',
          POR_DEFECTO && POR_DEFECTO.min_muestras_racha === 2 && POR_DEFECTO.grados_movimiento === 10,
          JSON.stringify(POR_DEFECTO));
  }

  // 29-31 · LAS DOS GUARDAS SE CUBREN LA UNA A LA OTRA, y eso se comprueba con
  //         valores EXPLÍCITOS —no con los mutados— para que quede escrito como
  //         propiedad del útil y no como efecto de esta corrida. Es la tabla del
  //         encabezado, medida también aquí en pequeño.
  {
    const f = leeTcu(tcuSintetica({ t_arranque: 300, sec5_desde: 270, auto_desde: 300, blips: [120] }));
    const v = (n, g) => stowDeUnaTcu(f, { min_muestras_racha: n, grados_movimiento: g }).es_stow;
    check('29 · con cualquiera de las dos guardas puesta, el stow se reconoce',
          v(2, 10) === true && v(2, 0) === true && v(1, 10) === true,
          `${v(2, 10)}/${v(2, 0)}/${v(1, 10)}`);
    check('30 · con las DOS quitadas, el artefacto se lleva el veredicto',
          v(1, 0) === false, v(1, 0));
    check('31 · o sea: privar una sola guarda NO prueba nada de la otra',
          v(2, 0) === v(1, 10));
  }

  console.log('\n' + ok + ' comprobaciones OK, ' + ko + ' FAIL');
  // EL PISO: el vacío no puede pasar por verde.
  const PISO = 33;
  if (ok + ko < PISO) {
    console.log('FAIL alcance insuficiente: ' + (ok + ko) + ' comprobaciones, piso ' + PISO);
    process.exit(2);
  }
  process.exit(ko ? 1 : 0);
}

main().catch(e => { console.log('FAIL excepción: ' + (e && e.stack || e)); process.exit(1); });
