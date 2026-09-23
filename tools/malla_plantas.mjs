/* malla_plantas.mjs — la ELIPSE frente a la FÍSICA, planta por planta.
 *
 * LA PREGUNTA. `buildAdjacency`, con la que la página reparte las NCUs, decide
 * si dos seguidores se ven con una ELIPSE: 40 m E-W y 90 m N-S, y nada más. No
 * mira obstáculos, ni inclinación de las palas, ni relieve, ni frecuencia, ni
 * margen. El motor nuevo sí. ¿Cuánto se diferencian, y en qué dirección?
 *
 * NO SE TRATA DE DECIDIR CUÁL ACIERTA. Son preguntas distintas: la elipse
 * responde «¿reparto estas NCUs de forma estable y barata?» y la física
 * responde «¿llega la señal ahora mismo?». Lo que se puede afirmar —y es lo
 * que esto imprime— es en qué se diferencian y cuánto.
 *
 * ═══ LO QUE ESTE INFORME SUPONE, DICHO ANTES QUE NINGÚN NÚMERO ═══
 *
 *   TERRENO LLANO. Los presets de `index.html` no traen cota por seguidor, así
 *   que aquí todos están a 0. El encargo permite el terreno llano SOLO como
 *   caso de comparación declarado, y esto es esa declaración. En una planta con
 *   desnivel los números de abajo cambian y no se sabe cuánto.
 *
 *   EL ÁNGULO. Sin `--consignas` va UNO SOLO para toda la planta, el de
 *   `--tilt`, y eso es una foto, no un día. Con `--consignas` va POR SEGUIDOR
 *   Y POR HORA, que es lo que pide el encargo.
 *
 *   Las consignas NO se calculan aquí. Salen de
 *   `cobertura-zigbee/tools/export_consignas.mjs`, que ya corre el modelo de
 *   backtracking de verdad y cuyo signo está careado contra campo: θ<0 = ESTE,
 *   medido sobre 743 seguidores de Ayora con mediana 0,33° contra el
 *   diagnóstico real. Reescribir eso aquí sería tener dos backtrackings que se
 *   separan solos, que es el error que este repo ya se ha comido con la física.
 *
 *     node tools/export_consignas.mjs --planta ayora --fecha 2026-06-21 \
 *          --pol pairwise --paso 60 --salida consignas.csv
 *
 *   MODO TEÓRICO. Sin campaña de calibración, `l_mod_db`, `l_roce_db` y
 *   `offset_db` valen cero. Cero no es «no hay pérdida por mesa»: es «no se ha
 *   medido».
 *
 *   VARIANTE PRO. La estándar no tiene sensibilidad leída de datasheet y por
 *   tanto no da margen; no se puede comparar lo que no existe.
 *
 * Y EL UMBRAL VA COMO CURVA, no como un número elegido. Cuál es el margen que
 * cuenta como «enlace viable» no está en ningún sitio del repo y no me lo voy a
 * inventar: se barre de 0 a 30 dB y se ve cómo se mueve todo.
 *
 *   node tools/malla_plantas.mjs                       (todas, tilt 30°)
 *   node tools/malla_plantas.mjs --planta AYORA --tilt 0
 *   node tools/malla_plantas.mjs --planta AYORA --consignas consignas.csv
 *   node tools/malla_plantas.mjs --alcance 250 --json informe.json
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const TILT = +arg('tilt', 30);
const ALCANCE = +arg('alcance', 200);
const SOLO = arg('planta', null);
const SALIDA = arg('json', null);
const CONSIGNAS = arg('consignas', null);
const UMBRALES = [0, 5, 10, 15, 20, 25, 30];

/* ── LAS CONSIGNAS, SI LAS HAY ──────────────────────────────────────────────
 * CSV de `export_consignas.mjs`: una fila por (seguidor, hora). Se indexa por
 * hora y por id de seguidor, que es el mismo `tracker` que trae el preset de
 * Siting en `tcus[i][4]` — el cruce es exacto, no por posición.
 *
 * SE USA `theta_sim_deg`, no `theta_tcu_deg`. Son el mismo ángulo con el signo
 * cambiado (θ<0 = ESTE en la TCU), y aquí sólo importa el VALOR ABSOLUTO,
 * porque la banda es `eje ± (c/2)·|sen α|` y no distingue a qué lado cae. Dicho
 * para que nadie tenga que deducirlo del código. */
function leeConsignas(ruta) {
  const txt = fs.readFileSync(ruta, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const cab = txt[0].split(',');
  const iH = cab.indexOf('hora_local'), iT = cab.indexOf('tracker'),
        iA = cab.indexOf('theta_sim_deg'), iP = cab.indexOf('politica');
  if (iH < 0 || iT < 0 || iA < 0) {
    console.error('el CSV de consignas no trae hora_local / tracker / theta_sim_deg');
    process.exit(2);
  }
  const porHora = new Map(); const pols = new Set();
  for (let k = 1; k < txt.length; k++) {
    const c = txt[k].split(',');
    if (iP >= 0) pols.add(c[iP]);
    if (!porHora.has(c[iH])) porHora.set(c[iH], new Map());
    porHora.get(c[iH]).set(c[iT], +c[iA]);
  }
  if (pols.size > 1) {
    console.error('el CSV mezcla ' + pols.size + ' politicas (' + [...pols].join(', ') +
                  '). Exportalo con una sola --pol: mezclarlas daria una malla que no existe.');
    process.exit(2);
  }
  return { porHora, politica: [...pols][0] || null };
}

/* ── EL CÓDIGO REAL DE LA PÁGINA, no una copia ──────────────────────────────
   Mismo mecanismo que `tests/test_cov_heatmap.js`: se extrae el bloque del
   HTML y se ejecuta. Si alguien cambia `rfRows` o `buildAdjacency`, esto
   cambia con ellos. */
const CONS = CONSIGNAS ? leeConsignas(CONSIGNAS) : null;

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const trozo = (re, nombre) => {
  const m = html.match(re);
  if (!m) { console.error('no encuentro ' + nombre + ' en index.html'); process.exit(2); }
  return m[0];
};
const srcRows = trozo(/function rfRows\(\)\{[\s\S]*?\n}\n/, 'rfRows');
const srcAdj = trozo(/function buildAdjacency\([\s\S]*?\n}\n/, 'buildAdjacency');

const PRESETS = {};
for (const n of ['AYORA', 'PARAMO', 'SANJOSE', 'BURGO', 'CATANIA']) {
  const m = html.match(new RegExp('^const ' + n + '=(\\{[\\s\\S]*?\\});$', 'm'));
  if (m) PRESETS[n] = JSON.parse(m[1]);
}

const RPV = (await import('../radio_pv_model.js')).default ?? (await import('../radio_pv_model.js'));
const ZB = (await import('../radio_zigbee.js')).default ?? (await import('../radio_zigbee.js'));
const ML = (await import('../radio_malla.js')).default ?? (await import('../radio_malla.js'));
const PARAMS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const PRO = PARAMS.tecnologias.zigbee_pro_24;
const PROP = {
  eps_r_suelo: PARAMS.propagacion.eps_r_suelo.valor,
  sigma_suelo_s_m: PARAMS.propagacion.sigma_suelo_s_m.valor,
  polarizacion: PARAMS.propagacion.polarizacion.valor,
  sigma_db: PARAMS.propagacion.sigma_db.valor,
  vegetacion: { modelo: PARAMS.vegetacion.modelo.valor }
};
const ANT_H = PARAMS.geometria.ant_h_m.valor;
const CUERDA_DEF = PARAMS.geometria.cuerda_m_defecto.valor;

/* ── LAS BANDAS QUE CRUZA UN ENLACE ─────────────────────────────────────────
 * Misma intersección que `rfObstacles` —recta del enlace contra el segmento de
 * la fila, con su criterio t∈(0.001,0.999) y u∈[0,1]— pero devolviendo una
 * BANDA en vez de una cota. No se puede llamar a `rfObstacles` tal cual porque
 * devuelve `[t*D, top]` y descarta de qué seguidor era el segmento: sin eso no
 * hay ángulo por seguidor, que es el punto de la fase 1. La construcción de los
 * segmentos —azimut, largo, desdoble de bifila— sí se reutiliza entera.
 */
/* ── DE QUÉ SEGUIDOR ES CADA SEGMENTO ───────────────────────────────────────
 * `rfRows` devuelve los segmentos ORDENADOS y sin decir de quién es cada uno,
 * y sin eso no hay ángulo por seguidor. En vez de tocar `index.html` o de
 * reescribir la construcción, se rehace SÓLO para construir un índice
 * extremo→seguidor y se casa contra los segmentos de verdad por coordenada
 * exacta: los dos cálculos son el mismo, así que los bits coinciden.
 *
 * Y SE COMPRUEBA QUE CASAN TODOS. Si alguien cambia la fórmula de `rfRows`,
 * esto no se desincroniza en silencio: se cae aquí mismo, diciendo cuántos
 * segmentos se quedaron sin dueño. */
function indiceSegmentos(R, motors, bifila) {
  const cu = (bifila && bifila.cuerda) || 0;
  const k4 = s => s[0] + '|' + s[1] + '|' + s[2] + '|' + s[3];
  const idx = new Map();
  let emitidos = 0;
  for (let i = 0; i < motors.length; i++) {
    const m = motors[i];
    const Lm = (m.len != null ? m.len : 100), Wm = (m.wid != null ? m.wid : 12);
    const a = ((m.az || 0)) * Math.PI / 180;
    const ux = Math.cos(a), uy = -Math.sin(a);
    const lx = -uy, ly = ux;
    const sep = (cu > 0 && Wm > 0) ? (Wm - cu) : 0;
    const offs = (sep > 0.05) ? [-sep / 2, sep / 2] : [0];
    for (const o of offs) {
      const cx = m.x + o * ux, cy = m.y + o * uy, hl = Lm / 2;
      idx.set(k4([cx - hl * lx, cy - hl * ly, cx + hl * lx, cy + hl * ly]), i);
      emitidos++;
    }
  }
  const duenyo = new Array(R.segs.length);
  let huerfanos = 0;
  for (let k = 0; k < R.segs.length; k++) {
    const d = idx.get(k4(R.segs[k]));
    if (d === undefined) huerfanos++; else duenyo[k] = d;
  }
  if (huerfanos || emitidos !== R.segs.length) {
    console.error('el indice de segmentos no casa con rfRows: ' + huerfanos +
                  ' huerfanos de ' + R.segs.length + ' (rehechos ' + emitidos + ').\n' +
                  'Ha cambiado la construccion de segmentos en index.html y esto hay que ponerlo al dia.');
    process.exit(2);
  }
  return duenyo;
}

function bandasQueCruza(n, m, R, cuerda, tilt) {
  const D = Math.hypot(m.x - n.x, m.y - n.y);
  if (D < 0.5) return { D, cruces: [] };
  const segs = R.segs, ex = m.x - n.x, ey = m.y - n.y;
  const xlo = Math.min(n.x, m.x) - R.span, xhi = Math.max(n.x, m.x);
  const ylo = Math.min(n.y, m.y), yhi = Math.max(n.y, m.y);
  let lo = 0, hi = segs.length;
  while (lo < hi) { const md = (lo + hi) >> 1; if (Math.min(segs[md][0], segs[md][2]) < xlo) lo = md + 1; else hi = md; }
  const cruces = [];
  for (let k = lo; k < segs.length; k++) {
    const s = segs[k];
    if (Math.min(s[0], s[2]) > xhi) break;
    if (Math.max(s[1], s[3]) < ylo || Math.min(s[1], s[3]) > yhi) continue;
    const fx = s[2] - s[0], fy = s[3] - s[1];
    const den = ex * fy - ey * fx; if (Math.abs(den) < 1e-12) continue;
    const wx = s[0] - n.x, wy = s[1] - n.y;
    const t = (wx * fy - wy * fx) / den;
    const u = (wx * ey - wy * ex) / den;
    if (t > 0.001 && t < 0.999 && u >= 0 && u <= 1) {
      /* eje del seguidor = altura del tubo de torsión. Se toma la misma que la
         antena porque es de donde cuelga la TCU (viga 1,50 − caída 0,725).
         `tilt` puede ser un número (uno para toda la planta) o una función del
         índice del segmento, que es como entra el ángulo por seguidor. */
      const al = typeof tilt === 'function' ? tilt(k) : tilt;
      /* CONTRATO NUEVO: geometria de la fila, no una banda ya resuelta. */
      const senPhi = Math.abs(den) / (D * Math.hypot(fx, fy));
      cruces.push({ s: t * D, zEje: ANT_H, cuerda: cuerda, alpha: al, senPhi: senPhi });
    }
  }
  cruces.sort((a, b) => a.s - b.s);
  return { D, cruces };
}

function analizaPlanta(nombre, P) {
  const cuerda = (P.bifila && P.bifila.cuerda) || CUERDA_DEF;
  const motors = P.tcus.map((t, i) => ({
    id: 'T' + i, tr: t[4], x: t[0], y: t[1], ncu: t[2],
    len: t[6] != null ? t[6] : undefined, wid: t[7] != null ? t[7] : undefined,
    az: t[8] != null ? t[8] : undefined
  }));
  /* rfRows REAL, con su contexto mínimo */
  const ctx = { S: { bifila: P.bifila || null, motors, p: { tlen: 100, twid: 12 } }, Math };
  vm.createContext(ctx);
  vm.runInContext(srcRows + '\nvar __R = rfRows();', ctx);
  const R = ctx.__R;

  vm.runInContext(srcAdj + '\nvar __adj = buildAdjacency(S.motors, S.motors.map((_,i)=>i), 40, 90);', ctx);
  const adjIdx = ctx.__adj;
  const adyElipse = new Map();
  for (const [i, vs] of adjIdx) adyElipse.set('T' + i, vs.map(j => 'T' + j));

  /* de qué seguidor es cada segmento: sin esto no hay ángulo por seguidor */
  const duenyo = indiceSegmentos(R, motors, P.bifila);

  /* Las horas a recorrer. Sin consignas, una sola con el ángulo declarado. */
  const horas = CONS ? [...CONS.porHora.keys()].sort() : ['(sin hora)'];
  const instantes = [];
  const t0 = Date.now();
  let evaluados = 0, podados = 0, sinConsigna = 0;
  const tope2 = ALCANCE * ALCANCE;

  for (const hora of horas) {
    const porTcu = CONS ? CONS.porHora.get(hora) : null;
    /* el ángulo del seguidor dueño de ese segmento, en valor absoluto: la banda
       es `eje ± (c/2)·|sen α|` y no distingue a qué lado cae */
    const tiltDe = porTcu
      ? (k => { const v = porTcu.get(motors[duenyo[k]].tr);
                if (v === undefined) { sinConsigna++; return TILT; } return Math.abs(v); })
      : TILT;
    const margenes = new Map();
    let angMin = Infinity, angMax = -Infinity;
    if (porTcu) for (const m of motors) {
      const v = porTcu.get(m.tr);
      if (v !== undefined) { angMin = Math.min(angMin, Math.abs(v)); angMax = Math.max(angMax, Math.abs(v)); }
    }
    for (let a = 0; a < motors.length; a++) {
      for (let b = a + 1; b < motors.length; b++) {
        const dx = motors[a].x - motors[b].x, dy = motors[a].y - motors[b].y;
        if (dx * dx + dy * dy > tope2) { if (!instantes.length) podados++; continue; }
        if (!instantes.length) evaluados++;
        const { D, cruces } = bandasQueCruza(motors[a], motors[b], R, cuerda, tiltDe);
        const p = ZB.presupuesto({ D, zA: ANT_H, zB: ANT_H, cruces }, PRO, PROP, null);
        margenes.set(ML.clave(motors[a].id, motors[b].id), p.margenDb);
      }
    }
    const filas = [];
    for (const u of UMBRALES) {
      const ady = new Map();
      for (const m of motors) ady.set(m.id, []);
      for (let a = 0; a < motors.length; a++) {
        for (let b = a + 1; b < motors.length; b++) {
          const mg = margenes.get(ML.clave(motors[a].id, motors[b].id));
          if (mg == null || mg < u) continue;
          ady.get(motors[a].id).push(motors[b].id);
          ady.get(motors[b].id).push(motors[a].id);
        }
      }
      let aristas = 0; for (const vs of ady.values()) aristas += vs.length; aristas /= 2;
      const cmp = ML.compara(ady, adyElipse);
      filas.push({ umbral: u, aristasRadio: aristas, aristasElipse: cmp.totalElipse,
                   ambas: cmp.ambas, soloRadio: cmp.soloRadio.length,
                   soloElipse: cmp.soloElipse.length, jaccard: cmp.jaccard });
    }
    instantes.push({ hora, angMin: isFinite(angMin) ? angMin : null,
                     angMax: isFinite(angMax) ? angMax : null, filas });
  }
  return { nombre, tcus: motors.length, segmentos: R.segs.length, cuerda,
           evaluados, podados, sinConsigna, ms: Date.now() - t0, instantes };
}

const informe = [];
for (const [n, P] of Object.entries(PRESETS)) {
  if (SOLO && n !== SOLO) continue;
  if (!P.tcus || !P.tcus.length) continue;
  process.stderr.write('  ' + n + '… ');
  informe.push(analizaPlanta(n, P));
  process.stderr.write(informe[informe.length - 1].ms + ' ms\n');
}

console.log('LA ELIPSE FRENTE A LA FISICA — margen PRO, modo TEORICO');
console.log('supuestos: terreno LLANO, sin calibracion, poda geometrica a ' + ALCANCE + ' m.');
console.log('angulo:    ' + (CONS
  ? 'POR SEGUIDOR Y POR HORA, de ' + CONSIGNAS + ' (politica ' + CONS.politica + ')'
  : 'UNO SOLO (' + TILT + ' grados) para toda la planta — es una foto, no un dia'));
console.log('elipse de buildAdjacency: 40 m E-W x 90 m N-S\n');
for (const p of informe) {
  console.log('== ' + p.nombre + ' == ' + p.tcus + ' TCUs, ' + p.segmentos +
              ' segmentos de fila, cuerda ' + p.cuerda + ' m');
  console.log('   pares evaluados ' + p.evaluados + ' (podados ' + p.podados + ')' +
              (p.instantes.length > 1 ? ' x ' + p.instantes.length + ' instantes' : '') +
              ' en ' + p.ms + ' ms' +
              (p.sinConsigna ? ' · ' + p.sinConsigna + ' consultas SIN consigna (cayeron al tilt por defecto)' : ''));
  if (p.instantes.length === 1) {
    console.log('   umbral   radio   elipse    ambas  solo radio  solo elipse  Jaccard');
    for (const f of p.instantes[0].filas) {
      console.log('   ' + String(f.umbral).padStart(4) + ' dB' +
                  String(f.aristasRadio).padStart(8) + String(f.aristasElipse).padStart(9) +
                  String(f.ambas).padStart(9) + String(f.soloRadio).padStart(12) +
                  String(f.soloElipse).padStart(13) + f.jaccard.toFixed(3).padStart(9));
    }
  } else {
    /* EL DÍA ENTERO. Una fila por instante, y para cada umbral cuántos enlaces
       quedan. Lo que se busca aquí es la VARIACIÓN: si la malla no se mueve en
       todo el día, el ángulo no manda y el modelo de banda sobra; si se mueve
       mucho, un solo ángulo era una foto engañosa. */
    console.log('   hora    |ang| min-max        enlaces viables por umbral (dB)');
    console.log('                            ' + UMBRALES.map(u => String(u).padStart(8)).join(''));
    for (const it of p.instantes) {
      console.log('   ' + it.hora.padEnd(8) +
                  (it.angMin == null ? '—' : it.angMin.toFixed(1) + '–' + it.angMax.toFixed(1) + '°').padEnd(18) +
                  it.filas.map(f => String(f.aristasRadio).padStart(8)).join(''));
    }
    for (const u of [0, 15, 30]) {
      const v = p.instantes.map(it => it.filas.find(f => f.umbral === u).aristasRadio);
      const mn = Math.min(...v), mx = Math.max(...v);
      console.log('   a ' + String(u).padStart(2) + ' dB: de ' + mn + ' a ' + mx +
                  ' enlaces en el dia (' + (mn ? '×' + (mx / mn).toFixed(2) : 'de 0 a ' + mx) + ')');
    }
  }
  console.log('');
}
if (SALIDA) {
  fs.writeFileSync(SALIDA, JSON.stringify({
    generado: new Date().toISOString().slice(0, 19) + 'Z',
    supuestos: { terreno: 'llano', angulo: CONS ? 'por seguidor y hora' : 'uno solo',
                 tilt_deg: CONS ? null : TILT, consignas: CONSIGNAS, politica: CONS && CONS.politica, modo: 'TEORICO', variante: 'zigbee_pro_24',
                 alcance_poda_m: ALCANCE, elipse: { reachX: 40, reachY: 90 } },
    plantas: informe
  }, null, 2));
  console.error('escrito ' + SALIDA);
}
