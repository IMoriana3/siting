// `tools/arranques_stow.mjs`: el arranque de cada TCU en un stow real, sacado
// de la rejilla de 30 s del SCADA.
//
// ═══ POR QUÉ ESTE BANCO ES SINTÉTICO, Y POR QUÉ ESO AQUÍ ES LO CORRECTO ═══
//
// Porque es el único sitio donde se conoce la RESPUESTA. En un stow real nadie
// sabe cuándo arrancó cada TCU —si se supiera, este útil no haría falta—, así
// que careándolo contra campo sólo se podría comprobar que no revienta.
//
// Aquí se fabrican TCU con latencias de arranque CONOCIDAS, se muestrean a 30 s
// CON FASE ALEATORIA (que es como llega el dato: el sondeo del SCADA no está
// sincronizado con el stow), se cuantiza el ángulo como lo cuantiza un encoder,
// y se exige que el útil las recupere DENTRO DE LA INCERTIDUMBRE QUE ÉL MISMO
// declara. Ese último matiz es el banco entero: un útil que acierta pero se
// atribuye un error de 0,1 s es tan malo como uno que falla.
//
// ═══ LO QUE ESTE BANCO NO PRUEBA ═══
//
// No prueba que el modelo de giro sea el de la TCU real. Prueba que, SI el giro
// es una rampa, el método la recupera. Que el giro real sea una rampa es lo que
// dirá el R² sobre el fichero de campo, y por eso el útil lo publica en vez de
// tragárselo.
//
//   node tests/test_arranques_stow.js
//   MUTA=<clave> node tests/test_arranques_stow.js       (TIENE que salir rojo)
'use strict';
const path = require('path');
const RAIZ = path.join(__dirname, '..');

let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};

// ── MUTACIONES ───────────────────────────────────────────────────────────────
// Cada una rompe UNA afirmación del útil. Si alguna deja el banco verde, es que
// esa afirmación no la vigila nadie.
const MUTACIONES = {
  // el arranque pasa a ser «la primera muestra en que se movió»: el método
  // tonto que este útil existe para no usar. Tiene que fallar por sesgo.
  arranquePorPrimeraMuestra: [
    /t0 = \(ajSeg\.a0 - aj\.a0 \+ aj\.b \* aj\.tm - ajSeg\.b \* ajSeg\.tm\) \/ D;/,
    't0 = muestras[ini - 1].t_s;'],
  // se quita la segunda recta y se vuelve al corte con el ángulo de la última
  // muestra quieta. Es LA versión anterior de este útil, y traía +0,52 s de
  // sesgo porque la TCU seguía siguiendo al sol. Tiene que salir rojo.
  sinRectaDeSeguimiento: [
    /if \(previas\.length >= 3\) \{/,
    'if (false) {'],
  // se quita el suelo de cuantización: la sigma vuelve a la de mínimos
  // cuadrados, que supone residuos independientes y sale optimista. Medido:
  // la cobertura a 2 sigma cae de ~95 % a 80 %.
  sinSueloDeCuantizacion: [
    /var_t0 = Math\.max\(varOls, varSuelo\);/,
    'var_t0 = varOls;'],
  // las muestras PARCIALES de los extremos vuelven al ajuste: aplanan la
  // pendiente ~5 % y con ella se va la dispersión.
  conMuestrasParciales: [
    /const ajuste = ventana\.slice\(1, -1\);/,
    'const ajuste = ventana;'],
  // la cota deja de existir: una dispersión por debajo de su error se publica
  // como si fuera un valor.
  siempreValor: [
    /const resuelve = d > P\.k_resuelve \* sd;/,
    'const resuelve = true;'],
  // el giro ya empezado deja de rechazarse: en vez de decirlo, revienta al
  // leer muestras[-1]. Sale rojo por excepción, que aquí basta: lo que no
  // puede es devolver un arranque anterior al primer dato.
  extrapolaSinPartida: [
    /if \(iPartida < 0\) return no\('el giro ya estaba en marcha/,
    'if (false) return no(\'el giro ya estaba en marcha'],
};

// ── UNA MUTACIÓN RETIRADA, Y POR QUÉ SE DICE EN VEZ DE BORRARLA ──────────────
//
// `gradosDeLibertad` cambiaba `ssRes/(n-2)` por `ssRes/n` en el ajuste. Se
// probó y **el banco siguió VERDE**: no prueba nada.
//
// Y el motivo no es que al banco le falte una comprobación, es que la
// afirmación ya no depende de eso. Desde que la incertidumbre del arranque se
// toma como el MAYOR entre el residuo de mínimos cuadrados y el suelo de
// cuantización, el suelo manda en todos los casos realistas, así que el n−2 no
// mueve ningún número publicado. R² tampoco lo usa (va por ssRes/ssTot).
//
// Queda escrito en vez de borrado porque una mutación que no mueve lo que la
// puerta mira NO ES EVIDENCIA —novena lección—, y porque si mañana el suelo
// deja de mandar, esta mutación vuelve a valer.

// ── CARGA DEL ÚTIL, con la mutación aplicada si la hay ───────────────────────
const fs = require('fs');
const FUENTE = path.join(RAIZ, 'tools', 'arranques_stow.mjs');
let modulo;
async function cargar() {
  const clave = process.env.MUTA;
  if (!clave) { modulo = await import('file://' + FUENTE); return; }
  const m = MUTACIONES[clave];
  if (!m) { console.log('FAIL mutación desconocida: ' + clave); process.exit(1); }
  const src = fs.readFileSync(FUENTE, 'utf8');
  if (!m[0].test(src)) {
    console.log('FAIL la mutación «' + clave + '» NO CASA con el fuente.');
    console.log('     Una mutación que no casa da tres rojos falsos y no prueba nada.');
    process.exit(1);
  }
  const mutado = src.replace(m[0], m[1]);
  // Se imprime la línea aplicada: una vez un reemplazo voraz pegó el texto al
  // final del fichero y los rojos que salieron no probaban nada.
  const linea = mutado.split('\n').find(l => l.includes(m[1].split('\n')[0].slice(0, 40)));
  console.log('     mutación aplicada: ' + (linea || '(no localizada)').trim());
  const tmp = path.join(require('os').tmpdir(), 'arranques_mut_' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, mutado);
  modulo = await import('file://' + tmp);
}

// ── EL GENERADOR SINTÉTICO ───────────────────────────────────────────────────
// PRNG con semilla: el banco tiene que dar lo mismo en cada corrida, o un rojo
// no se puede reproducir. Es un LCG, que para fases y ruido sobra.
function prng(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const GRADO = Math.PI / 180;

// Una TCU: sigue al sol despacio, y en `t_arranque` gira a `vel` °/s hasta el
// ángulo de stow. Se muestrea cada `periodo` con FASE ALEATORIA y se cuantiza.
function tcuSintetica({ t_arranque, vel_grados_s, ang0_grados = 40, ang_stow_grados = 0,
                        periodo = 30, fase, paso_grados = 0.03, t_fin = 1200,
                        seguimiento_grados_s = 0.0024, ruido_grados = 0, rnd }) {
  const vel = -Math.abs(vel_grados_s) * GRADO;        // hacia el stow, ángulo bajando
  const ang0 = ang0_grados * GRADO, angStow = ang_stow_grados * GRADO;
  const paso = paso_grados * GRADO;
  const seg = seguimiento_grados_s * GRADO;
  const dur = Math.abs((angStow - ang0) / vel);       // cuánto tarda el giro
  const ms = [];
  for (let t = fase; t <= t_fin; t += periodo) {
    let a;
    if (t < t_arranque) a = ang0 + seg * t;                       // seguimiento
    else if (t < t_arranque + dur) a = ang0 + seg * t_arranque + vel * (t - t_arranque);
    else a = angStow;                                             // parado en stow
    if (ruido_grados) a += (rnd() - 0.5) * 2 * ruido_grados * GRADO;
    // cuantización del encoder: el ángulo llega en escalones
    ms.push({ t_s: t, angulo_rad: Math.round(a / paso) * paso, objetivo_rad: angStow });
  }
  return ms;
}

// Una planta: n TCU con las latencias que se le pidan, cada una con su fase.
function plantaSintetica(latencias, opc = {}) {
  const rnd = prng(opc.semilla || 20260924);
  const porTcu = new Map();
  latencias.forEach((lat, k) => {
    porTcu.set('TCU-' + String(k + 1).padStart(3, '0'), tcuSintetica({
      t_arranque: (opc.t0 || 300) + lat,
      vel_grados_s: opc.vel_grados_s || 0.17,
      fase: rnd() * (opc.periodo || 30),                 // FASE ALEATORIA
      rnd, ...opc,
    }));
  });
  return porTcu;
}

// ── LAS PRUEBAS ──────────────────────────────────────────────────────────────
async function main() {
  await cargar();
  const { arranqueDeUnaTcu, dispersionDeArranques, pasoAngular, leeFilas } = modulo;

  // 1 · UNA TCU, latencia conocida. Lo que se exige no es «acierta», sino
  //     «acierta dentro del error que él mismo declara».
  {
    const rnd = prng(7);
    let dentro = 0, n = 0, peor = 0;
    for (let k = 0; k < 40; k++) {
      const tArr = 300 + k * 3.7;                       // arranques variados
      const ms = tcuSintetica({ t_arranque: tArr, vel_grados_s: 0.17, fase: rnd() * 30, rnd });
      const r = arranqueDeUnaTcu(ms);
      if (r.t_arranque_s === null) continue;
      n++;
      const err = Math.abs(r.t_arranque_s - tArr);
      peor = Math.max(peor, err);
      if (err <= 2 * r.sigma_s) dentro++;
    }
    check('1 · las 40 TCU sintéticas se miden (ninguna se cae)', n === 40, n + '/40');
    // Con 2 sigma se espera ~95 %; se exige 90 % para no hacer el banco frágil,
    // pero MUY por encima de lo que daría un método sesgado.
    check('1 · el arranque cae dentro de 2 sigma en ≥90 % de los casos',
          n > 0 && dentro / n >= 0.90, (dentro + '/' + n));
    // Y el error absoluto tiene que batir claramente los 30 s del muestreo: si
    // no, este útil no aporta nada sobre «la primera muestra en que se movió».
    check('1 · el peor error absoluto bate el muestreo de 30 s', peor < 10, peor.toFixed(2) + ' s');
  }

  // 2 · LA VELOCIDAD, que es el otro entregable: cierra el 0,2/0,17/0,1538/0,0667.
  {
    const rnd = prng(11);
    const casos = [0.200, 0.170, 0.1538, 0.0667];
    for (const v of casos) {
      const ms = tcuSintetica({ t_arranque: 300, vel_grados_s: v, fase: rnd() * 30, rnd });
      const r = arranqueDeUnaTcu(ms);
      const err = r.vel_grados_s === null ? null : Math.abs(Math.abs(r.vel_grados_s) - v);
      check('2 · recupera ' + v.toFixed(4) + ' °/s dentro del 1 %',
            err !== null && err < v * 0.01, err === null ? r.motivo : err.toFixed(5));
    }
  }

  // 3 · LA DISPERSIÓN, que es lo que se busca de verdad.
  {
    // Caso MINUTOS: la radio SÍ estaría en el camino crítico.
    const lat = [0, 12, 31, 55, 78, 96, 121, 150];
    const p = plantaSintetica(lat, { semilla: 3 });
    const d = dispersionDeArranques(p);
    check('3 · caso MINUTOS: se miden las 8 TCU', d.n_medidas === 8, d.n_medidas + '/8 · ' + JSON.stringify(d.caidas));
    check('3 · caso MINUTOS: publica un valor, no una cota', d.dispersion_s !== null, d.motivo);
    check('3 · caso MINUTOS: la dispersión recupera los 150 s',
          d.dispersion_s !== null && Math.abs(d.dispersion_s - 150) < 5,
          d.dispersion_s === null ? d.motivo : d.dispersion_s.toFixed(2));
    check('3 · caso MINUTOS: nombra la primera y la última TCU',
          d.primera_tcu === 'TCU-001' && d.ultima_tcu === 'TCU-008',
          d.primera_tcu + ' → ' + d.ultima_tcu);
  }

  // 4 · EL CASO QUE NO SE RESUELVE, y que TIENE que salir como cota.
  //     Ocho TCU arrancando casi a la vez: eso es «la radio no está en el
  //     camino crítico», y el útil no puede inventarse un número.
  //
  //     CON RUIDO, Y ES EL PUNTO. La primera versión de esta prueba usaba la
  //     señal limpia y salió ROJA: sobre un giro perfectamente recto el útil
  //     resuelve dispersiones de décimas de segundo, así que publicaba un valor
  //     con razón. Eso no demuestra que el mecanismo de la cota sobre, demuestra
  //     que el banco limpio HALAGA — un giro real trae viento, carga y jitter de
  //     reloj. Se le pone ruido angular y entonces la cota es lo correcto.
  {
    const p = plantaSintetica([0, 0.2, 0.1, 0.3, 0.15, 0.25, 0.05, 0.35],
                              { semilla: 5, ruido_grados: 0.25 });
    const d = dispersionDeArranques(p);
    check('4 · dispersión por debajo del error: NO publica valor', d.dispersion_s === null, String(d.dispersion_s));
    check('4 · publica una cota en su lugar', typeof d.cota_s === 'number' && d.cota_s > 0, String(d.cota_s));
    check('4 · y dice por qué', /no supera/.test(d.motivo || ''), d.motivo);
  }

  // 5 · EL VACÍO ES ERROR, en sus tres formas.
  {
    const a = dispersionDeArranques(new Map());
    check('5 · cero TCU: motivo, no cero', a.dispersion_s === null && /cero no es/.test(a.motivo || ''), a.motivo);

    const b = dispersionDeArranques(plantaSintetica([0], { semilla: 9 }));
    check('5 · una sola TCU: no hay dispersión que dar',
          b.dispersion_s === null && /necesita dos/.test(b.motivo || ''), b.motivo);

    const c = arranqueDeUnaTcu([{ t_s: 0, angulo_rad: 0.5 }, { t_s: 30, angulo_rad: 0.5 }]);
    check('5 · muestras insuficientes: motivo con el número',
          c.t_arranque_s === null && /muestras/.test(c.motivo || ''), c.motivo);
  }

  // 6 · LO QUE HAY QUE RECHAZAR, y que un útil descuidado aceptaría.
  {
    // 6a · el giro ya estaba en marcha en la primera muestra: extrapolar aquí
    //      inventa un arranque anterior al dato.
    const rnd = prng(13);
    const enMarcha = tcuSintetica({ t_arranque: 0, vel_grados_s: 0.17, fase: 5, rnd, t_fin: 600 });
    const r6a = arranqueDeUnaTcu(enMarcha);
    check('6a · giro ya empezado: se rechaza en vez de extrapolar',
          r6a.t_arranque_s === null && /ya estaba en marcha/.test(r6a.motivo || ''), r6a.motivo);

    // 6b · giro con parada en medio: no es una rampa, y el arranque extrapolado
    //      de media rampa no vale.
    const ms = [];
    for (let t = 0; t <= 900; t += 30) {
      let a;
      if (t < 120) a = 40 * GRADO;
      else if (t < 300) a = (40 - 0.17 * (t - 120)) * GRADO;
      else if (t < 600) a = (40 - 0.17 * 180) * GRADO;          // PARADA
      else a = (40 - 0.17 * 180 - 0.17 * (t - 600)) * GRADO;
      ms.push({ t_s: t, angulo_rad: Math.round(a / (0.03 * GRADO)) * (0.03 * GRADO) });
    }
    const r6b = arranqueDeUnaTcu(ms);
    const rechazado = r6b.t_arranque_s === null;
    check('6b · giro con parada: se rechaza o se mide sólo el primer tramo',
          rechazado || Math.abs(r6b.t_arranque_s - 120) < 15,
          rechazado ? r6b.motivo : r6b.t_arranque_s.toFixed(1));

    // 6c · una TCU que no se movió: no es un arranque en t=0, es que no hay.
    const quieta = [];
    for (let t = 0; t <= 600; t += 30) quieta.push({ t_s: t, angulo_rad: 0.7 });
    const r6c = arranqueDeUnaTcu(quieta);
    check('6c · TCU que no se movió: motivo, no un arranque',
          r6c.t_arranque_s === null && /no se movió|no varía|no hubo giro/.test(r6c.motivo || ''), r6c.motivo);

    // 6d · muestras desordenadas: se dice, no se ordena por detrás. Ordenar en
    //      silencio taparía un fichero mal exportado.
    const desord = [{ t_s: 0, angulo_rad: 0.7 }, { t_s: 60, angulo_rad: 0.6 },
                    { t_s: 30, angulo_rad: 0.65 }, { t_s: 90, angulo_rad: 0.55 },
                    { t_s: 120, angulo_rad: 0.5 }, { t_s: 150, angulo_rad: 0.45 }];
    const r6d = arranqueDeUnaTcu(desord);
    check('6d · muestras desordenadas: se dice en vez de ordenarlas calladamente',
          r6d.t_arranque_s === null && /no creciente|desordenado/.test(r6d.motivo || ''), r6d.motivo);
  }

  // 7 · LA CUANTIZACIÓN SE MIDE, no se supone. Es lo que evita repetir la
  //     escala retractada de 1.910 pulsos / 55° (FASE3 §2.4).
  {
    const rnd = prng(17);
    for (const paso of [0.03, 0.01, 0.0367]) {
      const ms = tcuSintetica({ t_arranque: 300, vel_grados_s: 0.17, fase: rnd() * 30,
                                paso_grados: paso, rnd });
      const q = pasoAngular(ms);
      check('7 · mide el paso ' + paso + '° del encoder',
            q.paso_grados !== null && Math.abs(q.paso_grados - paso) / paso < 0.02,
            q.paso_grados === null ? q.motivo : q.paso_grados.toFixed(5));
    }
    // Y con ruido por encima de la cuantización, NO se presenta como el paso.
    const conRuido = tcuSintetica({ t_arranque: 300, vel_grados_s: 0.17, fase: 3,
                                    paso_grados: 0.0001, ruido_grados: 0.02, rnd });
    const qr = pasoAngular(conRuido);
    check('7 · con ruido por encima del escalón lo dice, no lo vende como paso',
          qr.motivo !== null && /SUELO/.test(qr.motivo), qr.motivo);
  }

  // 8 · EL MAPEO DE COLUMNAS NO SE ADIVINA. Sin CSV real en la cartera,
  //     cualquier nombre por defecto sería inventado.
  {
    let lanzo = false, msg = '';
    try { leeFilas('a,b\n1,2\n', {}); } catch (e) { lanzo = true; msg = e.message; }
    check('8 · sin mapeo de columnas, falla en vez de adivinar',
          lanzo && /no se adivina/i.test(msg), msg);

    let lanzo2 = false, msg2 = '';
    try { leeFilas('hora,tcu,ang\n0,T1,0.70\n', { tcu: 'tcu', t: 'hora', angulo: 'NO_EXISTE' }); }
    catch (e) { lanzo2 = true; msg2 = e.message; }
    check('8 · columna declarada que no está: lo dice y enseña la cabecera',
          lanzo2 && /no está en la cabecera/.test(msg2), msg2);

    const p = leeFilas('hora;tcu;ang\n0;T1;0.70\n30;T1;0.65\n0;T2;0.70\n',
                       { tcu: 'tcu', t: 'hora', angulo: 'ang' });
    check('8 · con el mapeo declarado, agrupa por TCU',
          p.size === 2 && p.get('T1').length === 2, p.size + ' TCU');
  }

  // 9 · Y LA DEFINICIÓN DE LA VELOCIDAD SALE ESCRITA, que es lo que faltaba en
  //     la validación de campo y por lo que dos lecturas no coincidían.
  {
    const d = dispersionDeArranques(plantaSintetica([0, 40, 90], { semilla: 21 }));
    check('9 · publica la definición de la velocidad, no sólo el número',
          /mínimos cuadrados/.test((d.velocidad_grados_s || {}).definicion || ''),
          JSON.stringify((d.velocidad_grados_s || {}).definicion));
  }

  console.log('\n' + ok + ' comprobaciones OK, ' + ko + ' FAIL');
  // EL PISO: el vacío no puede pasar por verde. Si el banco deja de ejecutar
  // pruebas —un import roto, un return temprano—, 0 FAIL no es «todo bien».
  const PISO = 25;
  if (ok + ko < PISO) {
    console.log('FAIL alcance insuficiente: ' + (ok + ko) + ' comprobaciones, piso ' + PISO);
    process.exit(2);
  }
  process.exit(ko ? 1 : 0);
}

main().catch(e => { console.log('FAIL excepción: ' + (e && e.stack || e)); process.exit(1); });
