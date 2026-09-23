/* a5_repecho_local.mjs — lo que cuesta el canto ÚNICO de Bullington.
 *
 * ═══ DE DÓNDE SALE ESTA PREGUNTA ═══
 *
 * A4 se cerró con una medida: el suelo bajo la placa manda en 652 de 28.321
 * cruces, pero meterlo como filo propio sería doble conteo contra los dos
 * rayos. Al cerrarlo quedó declarada UNA incertidumbre, y no como tarea:
 *
 *   «el relieve usa Bullington, un canto equivalente ÚNICO para todo el vano,
 *    así que un repecho local justo donde el rayo pasa bajo un panel se
 *    PROMEDIA en ese canto en vez de resolverse.»
 *
 * Esto la cuantifica. La pregunta no es «¿se podría resolver?» —claro que sí—
 * sino «¿cuánto se pierde por no resolverlo, y hay alguna forma de resolverlo
 * que no dependa de cómo se muestreó el DEM?».
 *
 *   node tools/a5_repecho_local.mjs [--densidades 0.5,1,2,4]
 *
 * ═══ LA CONDICIÓN QUE MANDA, Y POR QUÉ NO ES NEGOCIABLE ═══
 *
 * Deygout resolvería el repecho. Y está descartado con número: sobre el MISMO
 * perfil da 1,10 dB con 2 puntos y 22,74 con 80, porque recursiona sobre un
 * canto dominante y sobre muestras correlacionadas de una superficie continua
 * cada nivel vuelve a cobrar el mismo relieve. Un relieve que depende de cómo
 * se muestreó el terreno no es relieve: es un número que elige quien elige el
 * paso de la malla.
 *
 * Así que CUALQUIER alternativa se mide igual: el mismo perfil a varias
 * densidades. Si el resultado se mueve con la densidad, se descarta por el
 * mismo motivo, sin discusión. Por eso este útil mide las dos cosas a la vez
 * —cuánto cambia el resultado, y cuánto se mueve con el muestreo— en vez de
 * medir primero y preguntarse después.
 *
 * ═══ QUÉ ES «RESOLVERLO APARTE», AQUÍ ═══
 *
 * Epstein–Peterson sobre los máximos locales del perfil: cada canto cobra su
 * propio ν sobre el SUBVANO entre el canto anterior y el siguiente. Se elige
 * este y no Deygout a propósito: Epstein–Peterson NO recursiona, así que es el
 * candidato con más posibilidades de sobrevivir a la prueba de densidad. Si ni
 * siquiera éste sobrevive, el resultado ya no es «hay que buscar otro»: es que
 * el camino entero está cerrado.
 *
 * La referencia NO cambia: `liso` es una recta y no tiene máximos locales, así
 * que `Bullington(liso)` es idéntico en los dos lados y la construcción delta
 * se mantiene. Lo único que se cambia es cómo se trata el perfil REAL.
 *
 * ═══ QUÉ CUENTA COMO «REPECHO CERCA DEL PUNTO DE PASO» ═══
 *
 * No un umbral en metros elegido a ojo, que sería otra constante inventada: el
 * radio de la PRIMERA ZONA DE FRESNEL en ese punto, que es la escala física
 * sobre la que un obstáculo importa. Un máximo local cuenta si cae dentro de
 * ese radio de un cruce de fila por debajo del cual pasa el rayo, Y está a más
 * de ese radio del canto de Bullington —o sea, es un repecho que el canto
 * único SE COMIÓ, no el que ya está representando—.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DENS = arg('densidades', '0.5,1,2,4').split(',').map(Number).filter(v => v > 0);

const TP = require(path.join(RAIZ, 'terreno_planta.js'));
const RPV = require(path.join(RAIZ, 'radio_pv_model.js'));
const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const G = P.geometria;
/* `f_hz` es un número pelado en la variante, NO un `{valor:…}` como los de
   `geometria`. Se leyó mal la primera vez y el motor lo cazó al vuelo: `fHz`
   no tiene defecto, así que un `undefined` revienta con su mensaje en vez de
   predecir a 2,4 GHz por accidente. */
const F = P.tecnologias.zigbee_pro_24.f_hz;
if (!(F > 0)) { console.error('radio_params.json: f_hz no es un número'); process.exit(2); }
const EJE = G.eje_tubo_m.valor;
const CUERDA = G.cuerda_m_defecto.valor;
const TILT = 30;
const ANT = RPV.alturaAntenaTCU(EJE, G.antena_tcu.radio_ancla_m.valor,
                                G.antena_tcu.coax_caida_m.valor, TILT);
const ANT_NCU = G.antena_ncu_m.valor;
const zBotRel = EJE - (CUERDA / 2) * Math.abs(Math.sin(TILT * Math.PI / 180));

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
function preset(nombre) {
  const m = new RegExp('const ' + nombre + '=(\\{.*?\\});', 's').exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}
/* `rfRows()` SE SACA DEL index.html, no se reimplementa — misma razón que en
   `a4_suelo_bajo_placa.mjs` y en `careo_elburgo.mjs`. */
const mRows = html.match(/function rfRows\(\)\{[\s\S]*?\n}\n/);
if (!mRows) { console.error('no encuentro rfRows() en index.html'); process.exit(2); }

const PLANTAS = [['ayora', 'AYORA'], ['sanjose', 'SANJOSE']];
const faltan = PLANTAS.filter(([p]) => !fs.existsSync(path.join(RAIZ, 'terreno', p + '_relieve.json')));
if (faltan.length) {
  console.log('SIN MEDIDA: falta el terreno de ' + faltan.map(f => f[0]).join(', '));
  console.log('No se ha medido nada. Esto no es un verde.');
  process.exit(0);
}

const pct = (a, p) => { if (!a.length) return null;
  const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f3 = v => (v == null ? '   -   ' : (v >= 0 ? '+' : '') + v.toFixed(3));

/* ── EPSTEIN–PETERSON SOBRE LOS MÁXIMOS LOCALES ───────────────────────────
   Cada canto cobra su ν sobre el subvano entre el canto anterior y el
   siguiente, con los extremos del vano como vecinos de los cantos de las
   puntas. No recursiona: cada canto se cobra UNA vez. */
function epsteinPeterson(D, zA, zB, cantos, fHz) {
  if (!cantos.length) return 0.0;
  const xs = [0, ...cantos.map(c => c.s), D];
  const zs = [zA, ...cantos.map(c => c.z), zB];
  let tot = 0.0;
  for (let i = 1; i < xs.length - 1; i++) {
    const d1 = xs[i] - xs[i - 1], d2 = xs[i + 1] - xs[i];
    if (!(d1 > 0) || !(d2 > 0)) continue;
    const zRef = zs[i - 1] + (zs[i + 1] - zs[i - 1]) * d1 / (d1 + d2);
    const v = RPV.nu(zs[i] - zRef, d1, d2, fHz);
    if (v > -0.78) tot += RPV.perdidaFiloDb(v);
  }
  return tot;
}

/* Los máximos locales que DIFRACTAN: estrictamente por encima de los dos
   vecinos y con ν contra el rayo directo por encima del corte de P.526. Un
   máximo que no difracta no es un repecho, es ruido de la malla. */
function repechos(D, zA, zB, real, fHz) {
  const out = [];
  for (let i = 1; i < real.length - 1; i++) {
    if (!(real[i].z > real[i - 1].z) || !(real[i].z > real[i + 1].z)) continue;
    const s = real[i].s;
    const v = RPV.nu(real[i].z - RPV.alturaRayo(zA, zB, D, s), s, D - s, fHz);
    if (v > -0.78) out.push({ s: s, z: real[i].z, v: v });
  }
  return out;
}

/* La misma construcción `real`/`liso` que usa `relieveDeltaDb`. Se rehace aquí
   porque el motor no la expone, y se deja DICHO: si `relieveDeltaDb` cambia su
   forma de construirlas, esto mide otra cosa. El banco lo vigila comprobando
   que `unico` reproduce `relieveDeltaDb` EXACTAMENTE en cada enlace — si se
   separan, este útil se para en vez de publicar números que no son del motor. */
function cantosDe(D, zA, zB, perfil) {
  const rec = RPV.recortaPerfil(perfil, D);
  if (rec === null) return null;
  const L = RPV.tierraLisa(rec);
  if (L === null) return null;
  const d0 = rec[0][0], pend = (L.hsr - L.hst) / L.D;
  const real = [], liso = [];
  for (let i = 0; i < rec.length; i++) {
    const s = rec[i][0] - d0;
    if (s <= 0 || s >= D) continue;
    real.push({ s: s, z: rec[i][1] });
    liso.push({ s: s, z: L.hst + pend * s });
  }
  return { real, liso, L };
}

function corta(ax, ay, bx, by, r) {
  const x1 = r[0], y1 = r[1], x2 = r[2], y2 = r[3];
  const rx = bx - ax, ry = by - ay, sx = x2 - x1, sy = y2 - y1;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((x1 - ax) * sy - (y1 - ay) * sx) / den;
  const v = ((x1 - ax) * ry - (y1 - ay) * rx) / den;
  if (t < 0 || t > 1 || v < 0 || v > 1) return null;
  return t * Math.hypot(rx, ry);
}

console.log('tilt ' + TILT + '° · antena TCU ' + ANT.toFixed(4) + ' m · NCU ' + ANT_NCU.toFixed(2)
          + ' m · f ' + (F / 1e9).toFixed(2) + ' GHz');
console.log('densidades de muestreo probadas (× el paso del fichero): ' + DENS.join(', ') + '\n');

let nCasos = 0, nEnlCaso = 0, nEnl = 0;
const dif = [], difCaso = [];
const spreadU = [], spreadA = [], finoU = [], finoA = [];
let discrepa = 0;

for (const [planta, preNom] of PLANTAS) {
  const pre = preset(preNom);
  if (!pre) { console.log('═══ ' + planta.toUpperCase() + ' ═══  sin preset, se salta\n'); continue; }
  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', planta + '_relieve.sha256.json'), 'utf8'));
  const T = TP.cargaRelieve(JSON.parse(fs.readFileSync(path.join(RAIZ, 'terreno', planta + '_relieve.json'), 'utf8')));
  const dx = pre.ox - man.cE, dn = pre.oy - man.cN;

  const motors = pre.tcus.map((t, i) => ({ id: 'T' + i, x: t[0], y: t[1],
    len: t[6] != null ? t[6] : undefined, wid: t[7] != null ? t[7] : undefined,
    az: t[8] != null ? t[8] : undefined }));
  const ctx = { S: { bifila: pre.bifila || null, motors, p: { tlen: 100, twid: 12 } }, Math };
  vm.createContext(ctx);
  vm.runInContext(mRows[0] + '\nvar __R = rfRows();', ctx);
  const RR = ctx.__R;
  if (!RR || !Array.isArray(RR.segs) || !RR.segs.length || RR.segs[0].length < 4) {
    console.error('rfRows() ya no devuelve {segs:[[x1,y1,x2,y2,...]]}: ha cambiado en index.html');
    process.exit(2);
  }
  const ROWS = RR.segs;

  const ncu = {}; for (const n of pre.ncus) ncu[n[0]] = { x: n[3], y: n[4] };
  let nCasosP = 0, nEnlCasoP = 0, nEnlP = 0;
  const difP = [];

  for (const t of pre.tcus) {
    const c = ncu[t[2]]; if (!c) continue;
    const ax = t[0], ay = t[1], bx = c.x, by = c.y;
    const D = Math.hypot(bx - ax, by - ay);
    if (!(D > 1)) continue;
    const pf = TP.perfilEntre(T, ax + dx, ay + dn, bx + dx, by + dn, {});
    if (!pf.perfil) continue;
    nEnlP++; nEnl++;
    const zA = pf.zSuelo[0] + ANT, zB = pf.zSuelo[1] + ANT_NCU;

    const C = cantosDe(D, zA, zB, pf.perfil);
    if (C === null) continue;
    const bu = RPV.bullingtonDetalle(D, zA, zB, C.real, F);
    const liso = RPV.bullingtonDb(D, zA, zB, C.liso, F);

    /* GUARDIA: `unico` TIENE que ser lo que devuelve el motor. Si no lo es,
       esta medida no habla del motor y no vale de nada. */
    const rel = RPV.relieveDeltaDb(D, ANT + pf.zSuelo[0], ANT_NCU + pf.zSuelo[1], pf.perfil, F);
    const unico = Math.max(bu.db - liso, 0);
    if (rel && rel.db != null && Math.abs(unico - rel.db) > 1e-9) discrepa++;

    const reps = repechos(D, zA, zB, C.real, F);
    const aparte = Math.max(epsteinPeterson(D, zA, zB, reps, F) - liso, 0);
    dif.push(aparte - unico); difP.push(aparte - unico);

    /* ¿Hay repecho CERCA de un paso por debajo de panel, y lejos del canto? */
    let esCaso = false;
    for (const r of ROWS) {
      const s = corta(ax, ay, bx, by, r);
      if (s === null || s <= 0.5 || s >= D - 0.5) continue;
      const u = s / D;
      const zSuelo = TP.cotaEn(T, ax + dx + (bx - ax) * u, ay + dn + (by - ay) * u);
      if (zSuelo === null) continue;
      const zRayo = zA + (zB - zA) * u;
      if (!(zRayo > zSuelo) || !(zSuelo + zBotRel > zRayo)) continue;   // no pasa por debajo
      const r1 = RPV.radioFresnel(s, D - s, F);
      for (const rp of reps) {
        if (Math.abs(rp.s - s) > r1) continue;
        if (bu.sB != null && Math.abs(rp.s - bu.sB) <= r1) continue;    // ya lo representa el canto
        nCasos++; nCasosP++; esCaso = true;
      }
    }
    if (esCaso) { nEnlCaso++; nEnlCasoP++; difCaso.push(aparte - unico); }

    /* ── LA PRUEBA DE DENSIDAD ────────────────────────────────────────────
       El MISMO vano a varios pasos de muestreo. Lo que se mira no es el valor
       sino cuánto se MUEVE: si se mueve, el método no vale. */
    const vU = [], vA = [];
    for (const k of DENS) {
      const p2 = TP.perfilEntre(T, ax + dx, ay + dn, bx + dx, by + dn, { paso: T.paso * k });
      if (!p2.perfil) { vU.length = 0; break; }
      const C2 = cantosDe(D, zA, zB, p2.perfil);
      if (C2 === null) { vU.length = 0; break; }
      const l2 = RPV.bullingtonDb(D, zA, zB, C2.liso, F);
      vU.push(Math.max(RPV.bullingtonDb(D, zA, zB, C2.real, F) - l2, 0));
      vA.push(Math.max(epsteinPeterson(D, zA, zB, repechos(D, zA, zB, C2.real, F), F) - l2, 0));
    }
    if (vU.length === DENS.length) {
      spreadU.push(Math.max(...vU) - Math.min(...vU));
      spreadA.push(Math.max(...vA) - Math.min(...vA));
      /* Y EL MISMO RECORRIDO SIN DECIMAR. Con paso 4× sobre una malla de 6 m se
         muestrea cada 24 m: ahí el perfil PIERDE cimas de verdad, así que parte
         del movimiento no es del método sino del DEM adelgazado. Separando las
         densidades que NO deciman (k ≤ 1) se ve cuánto es de cada cosa, que es
         lo único que permite decir si Bullington aguanta o no. */
      const fU = [], fA = [];
      for (let q = 0; q < DENS.length; q++) if (DENS[q] <= 1) { fU.push(vU[q]); fA.push(vA[q]); }
      if (fU.length > 1) {
        finoU.push(Math.max(...fU) - Math.min(...fU));
        finoA.push(Math.max(...fA) - Math.min(...fA));
      }
    }
  }

  console.log('═══ ' + planta.toUpperCase() + ' ═══  ' + nEnlP + ' enlaces con terreno'
            + '  ·  terreno ' + man.tipo + ' ' + man.productor);
  console.log('  repechos que el canto único se comió, cerca de un paso bajo panel: '
            + nCasosP + '  (en ' + nEnlCasoP + ' enlaces)');
  if (difP.length) console.log('  Δ(aparte − único) sobre TODOS los enlaces: p50 ' + f3(pct(difP, 0.5))
            + ' · p95 ' + f3(pct(difP, 0.95)) + ' · máx ' + f3(Math.max(...difP)) + ' dB');
  console.log('');
}

if (discrepa) {
  console.error('PARADO: `unico` no reproduce `relieveDeltaDb` en ' + discrepa + ' enlaces.');
  console.error('La construcción real/liso de este útil se ha separado del motor.');
  process.exit(2);
}

console.log('═══ TOTAL ═══');
console.log('  enlaces con terreno                     ' + nEnl.toLocaleString('es'));
console.log('  repechos comidos por el canto único     ' + nCasos.toLocaleString('es')
          + '  (en ' + nEnlCaso + ' enlaces)');
console.log('  `unico` reproduce el motor en los ' + nEnl.toLocaleString('es') + ' enlaces: sí\n');

if (dif.length) {
  console.log('  Δ = resolver aparte (Epstein–Peterson) − canto único, en dB');
  console.log('    (el p05 va porque E–P no siempre cobra MÁS: sobre un perfil sin');
  console.log('     máximos locales no cobra nada y sale por debajo del canto único)');
  console.log('                             p05      p50      p95      máx');
  console.log('    todos los enlaces    ' + f3(pct(dif, 0.05)).padStart(8)
            + f3(pct(dif, 0.5)).padStart(9)
            + f3(pct(dif, 0.95)).padStart(9) + f3(Math.max(...dif)).padStart(9));
  if (difCaso.length) console.log('    sólo los con repecho ' + f3(pct(difCaso, 0.05)).padStart(8)
            + f3(pct(difCaso, 0.5)).padStart(9)
            + f3(pct(difCaso, 0.95)).padStart(9) + f3(Math.max(...difCaso)).padStart(9));
}

console.log('\n═══ LA PRUEBA QUE DECIDE: ¿se mueve con el muestreo? ═══');
console.log('  Mismo vano a ' + DENS.join('×, ') + '× el paso del fichero. Se mide el RECORRIDO');
console.log('  del resultado entre densidades, no su valor.\n');
console.log('                              p50      p95      máx     (dB)');
if (spreadU.length) {
  console.log('  todas las densidades (incluye 4×, que DECIMA el DEM a 24 m):');
  console.log('    canto único (Bullington)' + f3(pct(spreadU, 0.5)).padStart(9)
            + f3(pct(spreadU, 0.95)).padStart(9) + f3(Math.max(...spreadU)).padStart(9));
  console.log('    resuelto aparte (E–P)   ' + f3(pct(spreadA, 0.5)).padStart(9)
            + f3(pct(spreadA, 0.95)).padStart(9) + f3(Math.max(...spreadA)).padStart(9));
  if (finoU.length) {
    console.log('  sólo densidades que NO deciman (≤ 1×), o sea mismo terreno:');
    console.log('    canto único (Bullington)' + f3(pct(finoU, 0.5)).padStart(9)
              + f3(pct(finoU, 0.95)).padStart(9) + f3(Math.max(...finoU)).padStart(9));
    console.log('    resuelto aparte (E–P)   ' + f3(pct(finoA, 0.5)).padStart(9)
              + f3(pct(finoA, 0.95)).padStart(9) + f3(Math.max(...finoA)).padStart(9));
  }
} else {
  console.log('    SIN DATOS: ningún enlace pudo medirse a las ' + DENS.length + ' densidades.');
}

/* ═══ Y DELTA-BULLINGTON, QUE ERA EL CANDIDATO A MIRAR ════════════════════
   Verificado contra la implementación oficial del SG3 de la UIT y contra
   pycraf, no de memoria. itu.int está bloqueado desde este contenedor, así
   que la cita es de código que implementa la Recomendación, y se dice. */
console.log('\n═══ ¿Y DELTA-BULLINGTON? ═══');
console.log('  P.1812: Lbulla50 y Lbulls50 en la ec. (21), Ldsph50 en la (27), y el');
console.log('  modelo completo en la (39):   Ld50 = Lbulla + max(Ldsph − Lbulls, 0)');
console.log('');
console.log('  ESTE MOTOR YA HACE LA PARTE DELTA: `relieveDb` es exactamente');
console.log('  Bullington(real) − Bullington(liso), o sea Lbulla − Lbulls, recortado');
console.log('  en cero. Lo único que delta-Bullington añade encima es Ldsph.');
console.log('');
console.log('  Y Ldsph NO PUEDE RESOLVER UN REPECHO, por construcción: no recibe el');
console.log('  perfil. Su firma en pycraf es');
console.log('    _diffraction_spherical_earth_loss_helper(dist, freq, a_p, h_te, h_re,');
console.log('                                             omega_frac, pol)');
console.log('  — distancia, frecuencia, radio terrestre efectivo, alturas de antena');
console.log('  efectivas, fracción de mar y polarización. Ni un dato del terreno.');
console.log('');
console.log('  Es un SUELO de trayecto, igual para todos los enlaces que compartan');
console.log('  (D, f, htE, hrE). No sabe dónde está el repecho, así que no puede');
console.log('  resolverlo. Delta-Bullington queda descartado para esto — no por');
console.log('  inestable, sino porque no es lo que hace.');

console.log('\n═══ VEREDICTO ═══');
if (!dif.length || !spreadU.length) {
  console.log('  NO SE HA MEDIDO NADA. Esto no es un verde.');
} else {
  const pEnl = (100 * nEnlCaso / nEnl).toFixed(1);
  console.log('');
  console.log('  1 · EL EFECTO EXISTE Y NO ES DESPRECIABLE. El canto único se come ' + nCasos);
  console.log('      repechos en ' + nEnlCaso + ' de ' + nEnl.toLocaleString('es') + ' enlaces (' + pEnl + ' %), y ahí resolverlos');
  console.log('      aparte cambia el resultado en ' + f3(pct(difCaso, 0.5)) + ' dB de mediana (p95 '
            + f3(pct(difCaso, 0.95)) + ').');
  console.log('      O sea NO se cierra por pequeño: no son cuatro casos y 0,3 dB.');
  console.log('');
  console.log('  2 · PERO NO HAY FORMA ESTABLE DE COBRARLO. Sobre el MISMO terreno, sólo');
  console.log('      cambiando a qué paso se muestrea —sin decimar, 0,5× y 1×—:');
  console.log('        canto único   p95 ' + f3(pct(finoU, 0.95)) + ' dB   máx ' + f3(Math.max(...finoU)));
  console.log('        E–P           p95 ' + f3(pct(finoA, 0.95)) + ' dB   máx ' + f3(Math.max(...finoA)));
  console.log('      E–P se mueve MÁS que el propio efecto que pretende corregir.');
  console.log('');
  console.log('  3 · Y LA CAUSA NO ERA LA RECURSIÓN. Deygout se descartó por recursionar');
  console.log('      (1,10 dB con 2 puntos, 22,74 con 80). Epstein–Peterson NO recursiona');
  console.log('      y falla igual. Luego el problema no es el esquema: es ENUMERAR');
  console.log('      MÁXIMOS LOCALES. El número de máximos de una superficie continua');
  console.log('      muestreada crece con la densidad, así que cualquier método que los');
  console.log('      cuente hereda la dependencia. La familia entera está cerrada, no');
  console.log('      sólo Deygout.');
  console.log('');
  console.log('  4 · LÍMITE DECLARADO DEL MODELO, que es lo que queda:');
  console.log('');
  console.log('        «Un repecho local cerca del punto donde el rayo pasa bajo un');
  console.log('         panel se promedia en el canto equivalente. Afecta al ' + pEnl + ' % de');
  console.log('         los enlaces; ahí el relieve puede quedarse CORTO en el orden');
  console.log('         de ' + pct(difCaso, 0.5).toFixed(0) + ' dB (p95 ' + pct(difCaso, 0.95).toFixed(0) + '). No se corrige porque ningún método');
  console.log('         conocido da esa corrección de forma estable: sobre el mismo');
  console.log('         terreno se mueve hasta ' + Math.max(...finoA).toFixed(0) + ' dB sólo con cambiar el muestreo.»');
  console.log('');
  console.log('  Vale más un límite acotado y dicho que una corrección que depende de');
  console.log('  cómo se muestreó el terreno.');
  console.log('');
  console.log('  Y UNA CORRECCIÓN A LO QUE ESTE REPO DECÍA: `radio_pv_model.js` afirma');
  console.log('  que Bullington es «invariante al muestreo». No lo es del todo — se');
  console.log('  mueve hasta ' + f3(Math.max(...finoU)) + ' dB sin decimar y ' + f3(Math.max(...spreadU)) + ' decimando a 4×. Es invariante');
  console.log('  en CONSTRUCCIÓN (no recursiona), pero sus rectas de máxima pendiente');
  console.log('  se leen sobre muestras. La diferencia con E–P sigue siendo de un');
  console.log('  factor ' + (pct(finoA, 0.95) / Math.max(pct(finoU, 0.95), 1e-9)).toFixed(0) + ' en p95, que es lo que decide — pero «invariante» era');
  console.log('  demasiado, y el número lo dice.');
}
