/* EL INFORME DE UNA PLANTA, EN MARKDOWN — punto 8 de la fase 4.
 *
 * Toma el ESCENARIO del punto 7 como entrada, corre el comparador del punto 6 y
 * redacta. No calcula nada por su cuenta: si calculara, habría dos motores.
 *
 *   node tools/informe.mjs --planta elburgo            (escenario armado aquí)
 *   node tools/informe.mjs --escenario escenario.json  (el guardado en el visor)
 *   node tools/informe.mjs --planta elburgo --salida informe.md
 *
 * REPRODUCIBLE: mismo escenario y mismo motor dan el MISMO texto, byte a byte.
 * No hay ningún reloj dentro —la fecha que sale es la del escenario— y el
 * escenario armado aquí deja `_guardado` a `null` a propósito: un informe que
 * cambia cada vez que se corre no se puede carear con nada.
 *
 * rc = 0 escrito · 1 el informe NO SE PUEDE PUBLICAR (huecos sin listar) ·
 * 2 no se ha podido hacer (sin layout, sin motor, sin parámetros)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { cargaApp, hermano, RAIZ } from './_motor_app.mjs';

const require = createRequire(import.meta.url);
const RT = require(path.join(RAIZ, 'radio_tecnologias.js'));
const RE = require(path.join(RAIZ, 'radio_escenario.js'));
const RI = require(path.join(RAIZ, 'radio_informe.js'));

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const PLANTA = arg('planta', 'elburgo');
const SALIDA = arg('salida', null);
const FICH_ESC = arg('escenario', null);
const HORAS = arg('horas', '8,12,16').split(',').map(Number);
const DIA = [2026, 5, 21];
const ALCANCE_M = Number(arg('alcance', '400'));

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

const DIR = hermano();
if (!DIR) { console.log('SIN ALCANCE: no encuentro el repo hermano con los layouts.'); process.exit(2); }

let escGuardado = null;
if (FICH_ESC) {
  try { escGuardado = JSON.parse(fs.readFileSync(FICH_ESC, 'utf8')); }
  catch (e) { console.log('SIN ALCANCE: no se puede leer «' + FICH_ESC + '»: ' + e.message); process.exit(2); }
  const v = RE.valida(escGuardado);
  if (!v.ok) { console.log('SIN ALCANCE: ese escenario no es utilizable, le falta ' + v.faltan.join(', ')); process.exit(2); }
}
const planta = escGuardado ? escGuardado.planta : PLANTA;

const f = path.join(DIR, planta + '_layout.json');
if (!fs.existsSync(f)) { console.log('SIN ALCANCE: no hay layout de «' + planta + '» en ' + DIR); process.exit(2); }
const L = JSON.parse(fs.readFileSync(f, 'utf8'));
if (!(L.ncus || []).length) { console.log('SIN ALCANCE: «' + planta + '» no declara NCU.'); process.exit(2); }
if (L.clat == null || L.clon == null) { console.log('SIN ALCANCE: «' + planta + '» no trae clat/clon.'); process.exit(2); }

let ctx, S, rows;
try { ({ ctx, S, rows } = cargaApp(L)); }
catch (e) { console.log('SIN ALCANCE: no carga el motor — ' + e.message); process.exit(2); }
const P = ctx.S._radioParams;
if (!P) { console.log('SIN ALCANCE: el motor no ha cargado radio_params.json.'); process.exit(2); }

const cuerda = (L.bifila && L.bifila.cuerda) || P.geometria.cuerda_m_defecto.valor;
const paso = (L.pitch != null ? L.pitch : P.geometria.pitch_m_defecto.valor);
const gcr = cuerda / paso;

/* ── EL ESCENARIO ─────────────────────────────────────────────────────────
 * O el que viene del visor, o uno armado aquí con los mismos campos y con los
 * SHA de los ficheros del repo — los de verdad, no los que los ficheros dicen
 * de sí mismos. `_guardado` va a `null`: ver la cabecera. */
const horas = escGuardado && escGuardado.hora_utc != null ? HORAS : HORAS;
/* `alturaEje` devuelve {valor, medida, motivo}, no un número: pasarlo tal cual
   dejaba un `NaN` impreso en el informe. Cazado leyendo el informe de verdad. */
const ejeInfo = ctx.RadioPV.alturaEje(null, P.geometria.eje_tubo_m.valor);
const esc = escGuardado || RE.captura({
  ahora: null,
  planta: planta, motor: 'nuevo', variante: 'zigbee_pro_24',
  horaUTC: Date.UTC(DIA[0], DIA[1], DIA[2], HORAS[0], 0), solOn: true,
  ejeM: ejeInfo.valor, ejeMedida: ejeInfo.medida, ejeMotivo: ejeInfo.motivo,
  cuerdaM: cuerda,
  vegetacion: { modelo: P.vegetacion.modelo.valor },
  terreno: { id: planta + '_relieve', ok: null, calidad: null, sha256: null,
             motivo: 'este útil no carga el relieve: el informe lo dice en vez de suponerlo' },
  ncus: L.ncus.map((n, i) => ({ id: 'NCU' + (i + 1), x: n.x, y: n.n })),
  paramsVersion: P.version,
  paramsSha: sha(fs.readFileSync(path.join(RAIZ, 'radio_params.json'))),
  motorSha: sha(fs.readFileSync(path.join(RAIZ, 'radio_pv_model.js'))),
  motorVersion: (ctx.RadioPV && ctx.RadioPV._version) || null
});

/* ── LA TABLA ─────────────────────────────────────────────────────────────── */
const nodos = [], raices = [];
L.ncus.forEach((nc, k) => { nodos.push({ id: 'NCU' + (k + 1), x: nc.x, y: nc.n }); raices.push('NCU' + (k + 1)); });
for (let i = 0; i < S.motors.length; i++) {
  const m = S.motors[i];
  if (!(m.ncu >= 1 && m.ncu <= L.ncus.length)) continue;
  nodos.push({ id: 'T' + i, x: m.x, y: m.y, i: i });
}
let llamadas = 0;
function enlazaDe(variante, hora) {
  const clave = Object.keys(P.tecnologias).find(k => P.tecnologias[k] === variante);
  if (!clave) return null;
  S.rf.variante = clave;
  Object.assign(S.rf.sol, { on: true, lat: L.clat, lon: L.clon, gcr: gcr,
                            horaUTC: Date.UTC(DIA[0], DIA[1], DIA[2], hora, 0) });
  ctx.S._rfRows = null;
  return (a, b) => {
    llamadas++;
    const r = ctx.rfEnlace({ x: a.x, y: a.y, i: a.i }, { x: b.x, y: b.y, i: b.i }, rows);
    if (!r || r.margenDb == null) return { viable: null, margenDb: null };
    return { viable: r.margenDb > 0, margenDb: r.margenDb };
  };
}
const variantes = {};
for (const k of Object.keys(P.tecnologias)) if (k[0] !== '_') variantes[k] = P.tecnologias[k];

let tabla;
try { tabla = RT.compara(planta, nodos, raices, variantes, HORAS, enlazaDe, ALCANCE_M); }
catch (e) { console.log('SIN ALCANCE: ' + e.message); process.exit(2); }

/* ── LOS PASOS PARA CERRARLO, SACADOS DE LOS HUECOS Y NO ESCRITOS A MANO ──── */
const huecos = RI.huecosDeTabla(tabla);
const faltantes = new Set();
for (const h of huecos) (String(h.motivo || '').match(/falta ([^—]+)/) || [, ''])[1]
  .split(',').map(s => s.trim()).filter(Boolean).forEach(x => faltantes.add(x));
const pasos = [];
if ([...faltantes].some(x => /rx_sens_dbm|ptx_dbm|f_hz/.test(x))) {
  pasos.push({ que: 'Elegir el módulo de cada tecnología y leer su datasheet',
               como: 'Ptx, sensibilidad POR MODO (SF y ancho de banda en LoRa, modo PHY en Wi-SUN), ' +
                     'plan de canal, consumo y certificación EU, con la cita: documento, página y fecha.',
               desbloquea: 'las filas de balance de `lora_eu868` y `wisun_fan_863`' });
}
if ([...faltantes].some(x => /t_salto_s/.test(x))) {
  pasos.push({ que: 'Medir el tiempo por salto',
               como: 'Un round-trip instrumentado en planta. Hoy no lo mide ningún .ps1, ningún útil ' +
                     'ni ningún banco de la cartera (FASE3_LATENCIA_STOW.md §2.3).',
               desbloquea: 'la latencia de stow, que es el criterio que decidiría el ranking' });
}
if ([...faltantes].some(x => /norma|erp_max_dbm|ciclo_trabajo/.test(x))) {
  pasos.push({ que: 'Verificar la regulación contra la norma',
               como: 'ETSI EN 300 220-2 / CEPT ERC REC 70-03 para 863-870 MHz y EN 300 328 para 2,4 GHz. ' +
                     'Desde el entorno de este repo no hay acceso a etsi.org.',
               desbloquea: 'la fila de legalidad en España' });
}
if ([...faltantes].some(x => /tasa_bps|carga_util_b|periodo_s/.test(x))) {
  pasos.push({ que: 'Declarar la carga de telemetría real',
               como: 'Tamaño de trama, periodo y número de TCU por NCU, de la configuración de planta.',
               desbloquea: 'la fila de capacidad de telemetría' });
}

const alcance = {
  tcu: nodos.length - raices.length, ncus: raices.length, horas: HORAS,
  enlaces: llamadas, alcanceM: ALCANCE_M,
  umbral: 'margen > 0 — la sensibilidad pelada, SIN reserva de desvanecimiento',
  denominador: 'las ' + (nodos.length - raices.length) + ' TCU con NCU asignada en el layout; ' +
    'las que no la tienen quedan fuera y no cuentan ni arriba ni abajo.',
  sesgo: 'los saltos son el camino MÁS CORTO sobre todos los enlaces viables: una COTA INFERIOR. ' +
    'La malla medida de El Burgo da p50 = 4 y p100 = 6, porque Zigbee no enruta por el más corto. ' +
    'Y «sin camino alternativo» sobre un grafo denso habla de redundancia POTENCIAL, no de la desplegada.'
};

let md;
try { md = RI.genera({ escenario: esc, tabla: tabla, alcance: alcance, pasos: pasos }); }
catch (e) { console.log('NO SE PUBLICA: ' + e.message); process.exit(1); }

if (SALIDA) { fs.writeFileSync(SALIDA, md); console.log('escrito en ' + SALIDA + ' (' + md.length + ' bytes)'); }
else process.stdout.write(md);
