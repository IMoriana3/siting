/* stow_desde_scada.mjs — un stow real, reconstruido de la exportación del SCADA:
 * un CSV por TCU más el LOG DE EVENTOS de la NCU.
 *
 * `arranques_stow.mjs` contesta CUÁNDO arrancó una TCU a partir de su ángulo.
 * Esto es la otra mitad: de dónde salen esas muestras, qué cuenta como stow y
 * contra qué instante se mide la latencia. Y esa segunda mitad es donde están
 * las trampas, porque los tres candidatos a «cuándo se dio la orden» dan
 * respuestas que se diferencian en media hora.
 *
 * ═══ EL FICHERO NO TRAE EL ESTADO DE LA INSTALACIÓN. PREGÚNTALO ═══
 *
 * Las cifras de abajo están medidas sobre la exportación del 2026-09-24, que
 * resultó venir de una NCU **con incidencias declaradas** — se supo DESPUÉS de
 * publicar el reparto de tiempos como si fuera el comportamiento normal.
 *
 * Un CSV no tiene columna para «este equipo estaba averiado». Antes de publicar
 * una LATENCIA, una DISPERSIÓN o una TASA DE FALLO sacadas de aquí, hay que
 * preguntar por el estado de la instalación y de sus gateways. La VELOCIDAD DE
 * GIRO no lo necesita: se mide dentro de cada TCU, contra su propio sondeo, y
 * una NCU lenta no frena un motor.
 *
 * Y este útil ayuda a verlo, porque separa por TCU y publica el motivo de cada
 * descarte: en aquel fichero había DOS POBLACIONES —84 TCU con ~3.380 filas al
 * día y 38 con 21 a 175— y los 13 fallos de orden caían, los 13, en la segunda.
 * Mirar el reparto de `n_filas` antes de promediar nada es medio diagnóstico.
 * El reparto TCU → gateway, que sería el otro medio, NO está en la exportación.
 *
 * ═══ LOS TRES ANCLAJES, Y POR QUÉ NO SON INTERCAMBIABLES ═══
 *
 *   1. El CLIC DEL OPERADOR   `Position 5 enabled for group N …`
 *   2. La ORDEN A LA TCU      `Requesting safe position 5, … for TCU N`
 *   3. El PASO A AUTO         `Group N sent to AUTO`, y en el CSV `main_state`
 *
 * Medido el 2026-09-24: 1 y 2 caben en 46 s, y 3 se estira 1.168 s. Una TCU con
 * `sec = 5` y en MANUAL **no gira**: se queda en el ángulo de seguimiento con el
 * motor parado. O sea que la latencia «orden → giro» mide, sobre todo, cuánto
 * tardó el operador en mandar los grupos a AUTO. Es un número real y no es
 * latencia de radio. Se publican los tres tramos por separado, nunca sumados en
 * uno solo.
 *
 * ═══ LA PERTENENCIA A GRUPO NO ESTÁ EN EL LOG, Y NO SE ADIVINA ═══
 *
 * El log trae los diez `Position 5 enabled for group N` por un lado y las
 * peticiones POR TCU por otro. Ninguna línea dice a qué grupo pertenece una
 * TCU. Emparejar cada TCU con «el grupo cuyo clic la precede» sería inventar la
 * pertenencia a partir del orden de una cola, y la cola no va por grupos: entre
 * los clics siguen saliendo peticiones del ciclo anterior.
 *
 * Así que el anclaje por TCU es el 2 —la orden a ESA TCU, que sí está escrita—
 * y el clic del operador se publica como TRAMO, no por TCU.
 *
 * ═══ UNA SOLA MUESTRA CON sec = 5 NO ES UN STOW ═══
 *
 * Medido el 2026-09-24: 84 rachas de una única muestra, y **82 caen en el mismo
 * segundo (±1 s) que una `Requesting safe position 0`** del log — la orden
 * CONTRARIA. Leer la primera aparición de `5` como el arranque adelanta el
 * reloj dos minutos y pone el arranque ANTES de que el operador pulsara nada.
 *
 * NO SE AFIRMA POR QUÉ. La correspondencia está medida; el mecanismo que la
 * produce (lectura del registro durante la transacción, valor intermedio, otra
 * cosa) NO se deduce de estos ficheros y aquí no se nombra. Para descartarlas
 * basta el hecho, y el hecho es que duran un sondeo.
 *
 * ═══ Y EL AJUSTE TIENE QUE CAER DENTRO DE LA RACHA ═══
 *
 * Sin esta atadura el ajuste coge el giro más rápido de la ventana, sea o no un
 * stow. Caso real: la TCU 84 del 2026-09-24 gira 46,3° a las 15:15 con R² =
 * 0,9989 —un ajuste impecable— pero con `sec = 0` y `target_angle = +55`. Es
 * una vuelta al seguimiento. Un ajuste bueno sobre el giro equivocado da un
 * número redondo y falso, que es peor que no dar ninguno.
 */

import fs from 'node:fs';
import path from 'node:path';
import { arranqueDeUnaTcu } from './arranques_stow.mjs';

/* ── PARÁMETROS, todos declarados y ninguno «el que salió bien» ────────────── */
export const POR_DEFECTO = {
  /* Muestras mínimas de una racha de `sec = 5` para no ser un transitorio. 2 es
     «duró más de un sondeo», que es exactamente lo que separa las 84 rachas de
     una muestra de las 98 largas. No hay nada que ajustar entre medias. */
  min_muestras_racha: 2,
  /* Grados que el ángulo tiene que recorrer dentro de la racha para que sea un
     giro y no una TCU que acepta la posición y se queda quieta. Los blips dan
     0,0–0,1° y los giros reales 40–102°: entre 1° y 40° el recuento no cambia.
     Se comprueba en el banco.

     ── Y LAS DOS GUARDAS DE ARRIBA SE CUBREN LA UNA A LA OTRA ──
     Medido sobre el fichero del 2026-09-24, quitar UNA SOLA no cambia ningún
     veredicto:

         min_muestras_racha   grados_movimiento   stows medidos
                2                    10                 75
                2                     0                 75
                1                    10                 75
                1                     0              ►    3

     Sin la primera, el artefacto entra como racha pero cae por no moverse;
     sin la segunda, ya no entra porque dura menos de dos sondeos. Hacen falta
     las dos fuera para que la racha elegida pase a ser el artefacto y el giro
     real quede fuera de ella. Está escrito aquí porque una mutación que quite
     sólo una sale VERDE y no prueba nada — y eso pasó en la primera versión del
     banco. */
  grados_movimiento: 10,
  /* R² mínimo, el mismo que `arranques_stow.mjs` usa para su propio ajuste. */
  r2_min: 0.98,
};

const GRADO_A_RAD = Math.PI / 180;

/* El CSV del SCADA trae el ángulo en GRADOS con dos decimales. El mapa Modbus
 * rotula `30506` como «current angle in RADIANS», así que la exportación ya
 * convierte. `arranqueDeUnaTcu` espera radianes; se convierte a la entrada y la
 * herramienta probada no se toca. */

/* ── EL LOG DE EVENTOS ─────────────────────────────────────────────────────── */
export function leeEventos(texto) {
  const ev = { peticiones: [], grupos: [], auto: [], fallos: [] };
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const corte = linea.indexOf(';');
    if (corte < 0) continue;
    const t = fechaLocal(linea.slice(0, corte));
    if (t === null) continue;
    const txt = linea.slice(corte + 1);
    let m;
    if ((m = txt.match(/^Requesting safe position (\d+), wind_from_east: (\d+), for TCU (\d+)\. Reason: (.+)$/))) {
      ev.peticiones.push({ t, posicion: +m[1], tcu: +m[3], razon: m[4] });
    } else if ((m = txt.match(/^Position (\d+) enabled for group (\d+)/))) {
      ev.grupos.push({ t, posicion: +m[1], grupo: +m[2] });
    } else if ((m = txt.match(/^Group (\d+) sent to AUTO/))) {
      ev.auto.push({ t, grupo: +m[1] });
    } else if ((m = txt.match(/^Failed to set the security position for TCU (\d+)$/))) {
      ev.fallos.push({ t, tcu: +m[1] });
    }
  }
  return ev;
}

/* Las horas vienen SIN ZONA, en hora local de planta. Se leen como UTC a
 * propósito: todo lo que se calcula son DIFERENCIAS dentro del mismo fichero, y
 * una diferencia no depende del origen. Interpretar la zona sin que el dato la
 * declare sería inventarla, y además metería el cambio de hora. */
function fechaLocal(s) {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
}
export { fechaLocal };

/* ── UN CSV DE TCU ─────────────────────────────────────────────────────────── */
/* El mapeo de columnas se declara, no se adivina: es la misma regla que
 * `arranques_stow.mjs`. Estos son los nombres de la exportación del 2026-09-24. */
export const COLUMNAS = {
  t: 'datetime', angulo: 'angle', objetivo: 'target_angle',
  seguridad: 'active_security_position', modo: 'main_state', motor: 'motor_state',
};

export function leeTcu(texto, mapa = COLUMNAS) {
  const lineas = texto.split(/\r?\n/).filter(l => l.trim());
  if (lineas.length < 2) throw new Error('el CSV no tiene filas de datos');
  const cab = lineas[0].split(';').map(s => s.trim());
  const idx = {};
  for (const [k, nombre] of Object.entries(mapa)) {
    const j = cab.indexOf(nombre);
    if (j < 0) throw new Error(`la columna «${nombre}» (${k}) no está en la cabecera: ${cab.join(', ')}`);
    idx[k] = j;
  }
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const c = lineas[i].split(';');
    const t = fechaLocal(c[idx.t] || '');
    const a = Number(c[idx.angulo]);
    if (t === null || !Number.isFinite(a)) continue;
    filas.push({
      t, angulo: a, objetivo: Number(c[idx.objetivo]),
      seguridad: Number(c[idx.seguridad]), modo: (c[idx.modo] || '').trim(),
      motor: (c[idx.motor] || '').trim(),
    });
  }
  filas.sort((x, y) => x.t - y.t);
  return filas;
}

/* ── RACHAS DE `active_security_position` = 5 ──────────────────────────────── */
export function rachasSec(filas, valor = 5) {
  const out = [];
  let i = 0;
  while (i < filas.length) {
    if (filas[i].seguridad !== valor) { i++; continue; }
    let j = i;
    while (j + 1 < filas.length && filas[j + 1].seguridad === valor) j++;
    const seg = filas.slice(i, j + 1);
    const angs = seg.map(r => r.angulo);
    out.push({
      ini: filas[i].t, fin: filas[j].t, n: j - i + 1,
      recorrido: Math.max(...angs) - Math.min(...angs),
    });
    i = j + 1;
  }
  return out;
}

/* ── UNA TCU ENTERA ────────────────────────────────────────────────────────── */
export function stowDeUnaTcu(filas, opc = {}) {
  const P = { ...POR_DEFECTO, ...opc };
  const R = rachasSec(filas);
  const transitorios = R.filter(r => r.n < P.min_muestras_racha);
  const sostenida = R.find(r => r.n >= P.min_muestras_racha && r.recorrido >= P.grados_movimiento) || null;

  const periodo = periodoMediano(filas);
  const aj = arranqueDeUnaTcu(filas.map(f => ({ t_s: f.t, angulo_rad: f.angulo * GRADO_A_RAD })));

  /* La atadura: el arranque tiene que caer DENTRO de la racha sostenida. Se
     tolera un periodo de sondeo por delante, porque el cruce de rectas cae por
     construcción ANTES del primer sondeo que ve el giro. */
  let es_stow = false, motivo_no = null;
  if (!sostenida) {
    motivo_no = R.length
      ? `sólo rachas de sec=5 que no son giro (${R.length}: n=${R.map(r => r.n).join(',')}, recorrido máx ${Math.max(...R.map(r => r.recorrido)).toFixed(2)}°)`
      : 'nunca aparece sec=5 en la ventana';
  } else if (aj.t_arranque_s === null) {
    motivo_no = aj.motivo;
  } else if (aj.r2 < P.r2_min) {
    motivo_no = `R² ${aj.r2.toFixed(4)} < ${P.r2_min}`;
  } else if (aj.t_arranque_s < sostenida.ini - periodo || aj.t_arranque_s > sostenida.fin) {
    motivo_no = 'el giro ajustado cae FUERA de la racha de sec=5: no es un stow';
  } else {
    es_stow = true;
  }

  const primeraAuto = filas.find(f => f.modo === 'AUTO');
  return {
    es_stow, motivo_no, periodo_sondeo_s: periodo,
    n_transitorios: transitorios.length,
    t_sec5_sostenido_s: sostenida ? sostenida.ini : null,
    t_primera_auto_s: primeraAuto ? primeraAuto.t : null,
    t_arranque_s: aj.t_arranque_s, sigma_s: aj.sigma_s,
    vel_grados_s: aj.vel_grados_s, r2: aj.r2, n_ajuste: aj.n_ajuste,
    recorrido_grados: filas.length
      ? +(Math.max(...filas.map(f => f.angulo)) - Math.min(...filas.map(f => f.angulo))).toFixed(2) : null,
  };
}

function periodoMediano(filas) {
  const d = [];
  for (let i = 1; i < filas.length; i++) d.push(filas[i].t - filas[i - 1].t);
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

/* ── LA CARPETA ENTERA ─────────────────────────────────────────────────────── */
export function analiza(dir, { desde, hasta, ...opc } = {}) {
  const ficheros = fs.readdirSync(dir).filter(f => /^TCU_\d+_.*\.csv$/i.test(f)).sort();
  if (!ficheros.length) throw new Error(`no hay ningún TCU_*.csv en ${dir}`);
  const logs = fs.readdirSync(dir).filter(f => /EVENT_LOG/i.test(f));
  if (logs.length !== 1) throw new Error(`hace falta exactamente un *EVENT_LOG*.csv en ${dir}, hay ${logs.length}`);
  const ev = leeEventos(fs.readFileSync(path.join(dir, logs[0]), 'utf8'));

  const primeraPeticion5 = new Map();
  for (const p of ev.peticiones) {
    if (p.posicion === 5 && !primeraPeticion5.has(p.tcu)) primeraPeticion5.set(p.tcu, p.t);
  }

  const tcus = [];
  for (const f of ficheros) {
    const id = Number(f.match(/^TCU_(\d+)_/i)[1]);
    let filas = leeTcu(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (desde != null) filas = filas.filter(r => r.t >= desde);
    if (hasta != null) filas = filas.filter(r => r.t <= hasta);
    const r = filas.length ? stowDeUnaTcu(filas, opc)
      : { es_stow: false, motivo_no: 'sin ninguna fila en la ventana', n_transitorios: 0,
          t_sec5_sostenido_s: null, t_primera_auto_s: null, t_arranque_s: null,
          sigma_s: null, vel_grados_s: null, r2: null, n_ajuste: 0,
          periodo_sondeo_s: null, recorrido_grados: null };
    tcus.push({ tcu: id, n_filas: filas.length, t_peticion5_s: primeraPeticion5.get(id) ?? null, ...r });
  }
  return { tcus, eventos: ev };
}

/* ── CLI ───────────────────────────────────────────────────────────────────── */
/* ── EL REPARTO TCU → GATEWAY, LEÍDO Y NO TECLEADO ────────────────────────
 *
 * La orden de stow se manda POR GRUPOS y cada gateway sirve un RANGO de TCU, así
 * que un número agregado sobre toda la NCU mezcla gateways que pueden estar en
 * estados distintos. Eso lo pidió Iñaki el 2026-10-01 y hasta hoy no se podía
 * hacer porque faltaba el reparto. YA ESTÁ EN LOS REPOS, dicho por él el
 * 2026-10-03 y localizado el mismo día:
 *
 *     SCADA/tools/tcu-toolbox/plantas/*.json
 *
 *     {"nombre": "San Jose NCU18 GW1", "puerto": 503, "tcu_ini": 1, "tcu_fin": 38}
 *     {"nombre": "San Jose NCU18 GW2", "puerto": 504, "tcu_ini": 39, "tcu_fin": 122}
 *
 * TRES COSAS QUE ESE FICHERO ENSEÑA, y que no estaban escritas en ningún sitio:
 *
 *   · son TRES niveles, TCU → GW → NCU: una NCU tiene VARIOS gateways, así que
 *     «gateway» y «NCU» no son sinónimos —en San José hay 21 NCU y 34 parejas
 *     NCU+GW nombradas—;
 *   · el gateway se distingue por el PUERTO MODBUS sobre la misma IP: 503 es el
 *     GW1 y 504 el GW2. La IP identifica la NCU, el puerto el gateway;
 *   · el reparto es por RANGO CONTIGUO de número de TCU, no por una lista.
 *
 * ESTO NO ADIVINA NADA. Se le pasa el fichero y la NCU, y los rangos salen de
 * ahí. Sin `--mapa` no reparte: publica el agregado y dice que no ha repartido,
 * porque inventarse el corte sería justo lo que este útil existe para no hacer.
 */
export function mapaGateways(fichero, ncu) {
  const d = JSON.parse(fs.readFileSync(fichero, 'utf8'));
  const ps = Array.isArray(d.plantas) ? d.plantas : [];
  const re = new RegExp('NCU\\s*' + ncu + '\\s+GW\\s*(\\d+)', 'i');
  const tramos = [];
  for (const p of ps) {
    const m = re.exec(String(p.nombre || ''));
    if (!m) continue;
    if (p.tcu_ini == null || p.tcu_fin == null) continue;
    tramos.push({ gw: 'GW' + m[1], puerto: p.puerto ?? null,
                  ini: p.tcu_ini, fin: p.tcu_fin, nombre: p.nombre });
  }
  if (!tramos.length) {
    /* UNA NCU SIN «GW» EN EL NOMBRE NO ES UNA NCU DE UN SOLO GATEWAY: es una
       NCU cuyo fichero no lo desglosa. Ayora y Fayón se nombran «Ayora NCU4»,
       sin GW, y de ahí NO se sigue que tengan uno solo. No se reparte. */
    const sinGw = ps.filter(p => new RegExp('NCU\\s*' + ncu + '(\\D|$)', 'i').test(String(p.nombre || '')));
    return { tramos: [], sinGw: sinGw.length };
  }
  return { tramos, sinGw: 0 };
}
export const deQuienEs = (tramos, tcu) => {
  const t = tramos.find(x => tcu >= x.ini && tcu <= x.fin);
  return t ? t.gw : null;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
  const sueltos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { i++; continue; }
    sueltos.push(argv[i]);
  }
  const dir = sueltos[0];
  if (!dir) {
    console.error('uso: node tools/stow_desde_scada.mjs <carpeta con TCU_*.csv y *EVENT_LOG*.csv> [desde] [hasta]');
    console.error('     [--mapa <tcu-toolbox/plantas/X.json> --ncu <n>]   reparte por gateway');
    process.exit(2);
  }
  const fMapa = opt('mapa'), nNcu = opt('ncu');
  const desde = sueltos[1] ? fechaLocal(sueltos[1]) : undefined;
  const hasta = sueltos[2] ? fechaLocal(sueltos[2]) : undefined;
  const { tcus, eventos } = analiza(dir, { desde, hasta });
  const hh = t => t == null ? '—' : new Date(Math.round(t) * 1000).toISOString().slice(11, 19);
  const cuant = xs => {
    const s = [...xs].sort((a, b) => a - b); const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, min: s[0], p05: q(0.05), med: q(0.5), p95: q(0.95), max: s[s.length - 1] };
  };
  const ok = tcus.filter(t => t.es_stow);
  console.log(`ficheros TCU            : ${tcus.length}`);
  console.log(`transitorios descartados: ${tcus.reduce((a, t) => a + t.n_transitorios, 0)}`);
  console.log(`STOWS MEDIDOS           : ${ok.length}`);
  if (!ok.length) { console.log('ningún stow medible.'); process.exit(1); }
  const v = cuant(ok.map(t => t.vel_grados_s));
  console.log(`velocidad °/s  p05 ${v.p05.toFixed(4)}  mediana ${v.med.toFixed(4)}  p95 ${v.p95.toFixed(4)}  max ${v.max.toFixed(4)}`);
  console.log(`55° →          p05 ${(55 / v.p05).toFixed(0)} s  mediana ${(55 / v.med).toFixed(0)} s  p95 ${(55 / v.p95).toFixed(0)} s`);
  const con = ok.filter(t => t.t_peticion5_s != null);
  if (con.length) {
    const A = cuant(con.map(t => t.t_arranque_s - t.t_peticion5_s));
    const B = cuant(con.filter(t => t.t_sec5_sostenido_s != null).map(t => t.t_sec5_sostenido_s - t.t_peticion5_s));
    const C = cuant(con.filter(t => t.t_primera_auto_s != null).map(t => t.t_arranque_s - t.t_primera_auto_s));
    console.log(`\nA· petición → arranque   mediana ${A.med.toFixed(1)} s  (min ${A.min.toFixed(1)}, max ${A.max.toFixed(1)})`);
    console.log(`B· petición → sec=5      mediana ${B.med.toFixed(1)} s  (min ${B.min.toFixed(1)}, max ${B.max.toFixed(1)})`);
    console.log(`C· AUTO → arranque       mediana ${C.med.toFixed(1)} s  (min ${C.min.toFixed(1)}, max ${C.max.toFixed(1)})`);
    const t0 = con.map(t => t.t_arranque_s).sort((a, b) => a - b);
    console.log(`\núltima − primera TCU     ${(t0[t0.length - 1] - t0[0]).toFixed(1)} s   (${hh(t0[0])} → ${hh(t0[t0.length - 1])})`);
  }
  const g = eventos.grupos.map(x => x.t), au = eventos.auto.map(x => x.t);
  if (g.length) console.log(`clics de grupo           ${(Math.max(...g) - Math.min(...g)).toFixed(0)} s   (${hh(Math.min(...g))} → ${hh(Math.max(...g))})`);
  if (au.length) console.log(`«sent to AUTO»           ${(Math.max(...au) - Math.min(...au)).toFixed(0)} s   (${hh(Math.min(...au))} → ${hh(Math.max(...au))})`);
  console.log(`fallos «Failed to set the security position»: ${eventos.fallos.length} sobre ${new Set(eventos.fallos.map(f => f.tcu)).size} TCU`);

  /* ── EL REPARTO POR GATEWAY ────────────────────────────────────────────── */
  if (!fMapa || !nNcu) {
    console.log('\nSIN REPARTO POR GATEWAY: no se ha dado --mapa y --ncu.');
    console.log('Todo lo de arriba es el AGREGADO de la NCU, y si sus gateways');
    console.log('están en estados distintos, mezcla poblaciones.');
  } else {
    const { tramos, sinGw } = mapaGateways(fMapa, nNcu);
    if (!tramos.length) {
      console.log(`\nNO SE HA REPARTIDO: «${fMapa}» no desglosa gateways para la NCU ${nNcu}` +
                  (sinGw ? ` (hay ${sinGw} entrada(s) de esa NCU, pero sin «GW» en el nombre).` : '.'));
      console.log('Una NCU que el fichero no desglosa NO es una NCU de un gateway: es un dato');
      console.log('que falta. No se supone el corte.');
    } else {
      console.log(`\n── REPARTO POR GATEWAY · ${path.basename(fMapa)} · NCU ${nNcu} ──\n`);
      for (const t of tramos) {
        console.log(`  ${t.gw}  puerto ${t.puerto}  TCU ${t.ini}–${t.fin}  (${t.fin - t.ini + 1})   «${t.nombre}»`);
      }
      const huerfanas = tcus.map(t => t.tcu).filter(id => deQuienEs(tramos, id) == null);
      if (huerfanas.length) {
        console.log(`\n  OJO: ${huerfanas.length} TCU del volcado NO caen en ningún rango: ` +
                    huerfanas.slice(0, 12).join(', ') + (huerfanas.length > 12 ? '…' : ''));
        console.log('  Eso o el mapa no es de esta NCU, o el reparto ha cambiado. No se reparten a ojo.');
      }
      const porGw = new Map();
      for (const t of tcus) {
        const gw = deQuienEs(tramos, t.tcu);
        if (!gw) continue;
        if (!porGw.has(gw)) porGw.set(gw, []);
        porGw.get(gw).push(t);
      }
      const fallosPorGw = new Map();
      for (const f of eventos.fallos) {
        const gw = deQuienEs(tramos, f.tcu) || '(fuera de rango)';
        fallosPorGw.set(gw, (fallosPorGw.get(gw) || 0) + 1);
      }
      /* UNA VELOCIDAD NEGATIVA NO ES UN STOW. El stow va HACIA la posición de
         seguridad; un ajuste con pendiente negativa describe movimiento en el
         otro sentido. Las guardas de racha miran la AMPLITUD (`grados_movimiento`)
         y el ajuste (`r2_min`), que son magnitudes sin signo, así que un tramo
         que se mueve al revés las pasa. Se cuenta aparte y NO entra en la
         estadística: medido el 2026-10-03, hay exactamente uno. */
      const noFisico = tcus.filter(t => t.es_stow && t.vel_grados_s < 0);
      console.log('');
      console.log('  gateway   TCU  stows  vel med °/s   55°(s)    B· pet→sec5    C· AUTO→arranque     fallos');
      console.log('  ' + '─'.repeat(96));
      for (const gw of [...porGw.keys()].sort()) {
        const g = porGw.get(gw);
        const gok = g.filter(t => t.es_stow && t.vel_grados_s > 0);
        const gv = gok.length ? cuant(gok.map(t => t.vel_grados_s)) : null;
        const gcon = gok.filter(t => t.t_peticion5_s != null);
        const gb = gcon.filter(t => t.t_sec5_sostenido_s != null);
        const gc = gcon.filter(t => t.t_primera_auto_s != null);
        const B2 = gb.length ? cuant(gb.map(t => t.t_sec5_sostenido_s - t.t_peticion5_s)) : null;
        const C2 = gc.length ? cuant(gc.map(t => t.t_arranque_s - t.t_primera_auto_s)) : null;
        const nf = fallosPorGw.get(gw) || 0;
        const tf = new Set(eventos.fallos.filter(f => deQuienEs(tramos, f.tcu) === gw).map(f => f.tcu)).size;
        console.log('  ' + gw.padEnd(9) +
          String(g.length).padStart(4) + String(gok.length).padStart(7) +
          (gv ? gv.med.toFixed(4) : '—').padStart(13) +
          (gv ? (55 / gv.med).toFixed(0) : '—').padStart(9) +
          (B2 ? `   ${B2.med.toFixed(1)} (${B2.min.toFixed(0)}–${B2.max.toFixed(0)})` : '   —').padEnd(17) +
          (C2 ? `  ${C2.med.toFixed(1)} (${C2.min.toFixed(1)}–${C2.max.toFixed(1)})` : '  —').padEnd(21) +
          `${nf} sobre ${tf} TCU`);
      }
      if (noFisico.length) {
        console.log('');
        console.log(`  DESCARTADOS POR SENTIDO: ${noFisico.length} ajuste(s) con velocidad NEGATIVA, o sea`);
        console.log('  movimiento en el sentido contrario al stow. No son stows y no entran arriba:');
        for (const t of noFisico) {
          console.log(`    TCU ${t.tcu} (${deQuienEs(tramos, t.tcu) || 'fuera de rango'})  ` +
                      `${t.vel_grados_s.toFixed(4)} °/s  R² ${t.r2.toFixed(4)}`);
        }
        console.log('  Las guardas de racha miran AMPLITUD y AJUSTE, que no llevan signo, así que');
        console.log('  un tramo que se mueve al revés las pasa. Por eso se filtra aquí y se dice.');
      }
      console.log('');
      console.log('  LO QUE ESTA TABLA DECIDE: si los fallos se concentran en UN gateway, el');
      console.log('  número publicable es el de los OTROS, y el agregado de arriba no lo es.');
      console.log('  «A· petición → arranque» NO sale en esta tabla a propósito: el propio log');
      console.log('  dice que el operador reparte los grupos a AUTO a lo largo de ~1.168 s, así');
      console.log('  que A mide sobre todo SU ritmo. B y C son las que aíslan la máquina.');
      console.log('  Lo que esta tabla NO dice es POR QUÉ falla ese gateway: la exportación de');
      console.log('  TCU no trae ni una magnitud de radio, así que radio contra equipo sigue sin');
      console.log('  decidirse. Para eso hace falta el volcado del inventario (RSSI y LQI).');
    }
  }
}
