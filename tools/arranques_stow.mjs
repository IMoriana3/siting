/* arranques_stow.mjs — cuándo arrancó cada TCU en un stow real, a partir de lo
 * que el SCADA ya guarda. Sin cronómetro y sin instrumentar nada.
 *
 * ═══ QUÉ CONTESTA Y QUÉ NO ═══
 *
 * NO contesta `t_salto_s`. Eso sigue PENDIENTE y con él `latencia_stow`: el
 * SCADA muestrea a 30 s y el tramo de radio se mueve en segundos, así que no
 * hay round-trip que sacar de aquí. `FASE3_LATENCIA_STOW.md` §2.3 y §5.
 *
 * SÍ contesta la DISPERSIÓN entre TCU: **el arranque de la última menos el de
 * la primera**. Y para el ranking entre tecnologías eso decide lo que hay que
 * decidir:
 *
 *   · si entre la primera y la última hay SEGUNDOS, la radio no está en el
 *     camino crítico y el ranking por latencia no distingue tecnologías;
 *   · si hay MINUTOS, sí lo está, y entonces sí distingue.
 *
 * Y no necesita la hora de emisión de la NCU, que es lo que no está registrado:
 * una diferencia entre dos arranques no depende del origen de tiempos.
 *
 * ═══ CÓMO SE SACA UN ARRANQUE DE UNA REJILLA DE 30 s ═══
 *
 * No por el primer sondeo en que el ángulo cambió —eso da el arranque con una
 * incertidumbre de 30 s, que es justo la que hay que batir—, sino por RECTA:
 *
 *   1. Durante el giro, `30506` avanza a velocidad casi constante. Se ajusta
 *      una recta por mínimos cuadrados a las muestras EN MOVIMIENTO.
 *   2. Se extrapola esa recta hacia atrás hasta el ÁNGULO DE PARTIDA (el de
 *      seguimiento, justo antes de moverse).
 *   3. El cruce es el arranque, y su incertidumbre sale del ajuste, no del
 *      muestreo: con ~10 muestras la recta queda anclada mucho mejor que 30 s.
 *
 * El muestreo grueso no desaparece: entra como la incertidumbre de la última
 * muestra quieta y como la cuantización del ángulo. Las dos van declaradas en
 * la salida, no absorbidas.
 *
 * ═══ LA CUANTIZACIÓN SE MIDE, NO SE SUPONE ═══
 *
 * `30506` es «current angle in RADIANS», y por debajo hay un encoder. Cuánto
 * vale su paso NO se asume: se mide del propio fichero, como el menor salto no
 * nulo entre muestras consecutivas de la misma TCU.
 *
 * Y se hace así por un motivo escrito: `FASE3_LATENCIA_STOW.md` §2.4 RETRACTA
 * la escala de 1.910 pulsos / 55° que tentaba usar aquí. No hay segunda fuente,
 * `41037` es «maximum west tilt angle» (límite de HARDWARE) mientras que los 55°
 * son `west_sw_limit` (límite de SOFTWARE), y 1910/55 = 34,7273 pulsos/grado no
 * es un número propio de un encoder. El dato medido del fichero no necesita esa
 * suposición, y además dice la verdad si el encoder resulta ser otro.
 *
 * ═══ EL VACÍO ES ERROR ═══
 *
 * Toda TCU que no se pueda medir sale con `t_arranque_s: null` Y SU MOTIVO, y
 * se cuenta aparte. Una dispersión calculada sobre las TCU que sí salieron, sin
 * decir cuántas se cayeron, es una medida de la muestra superviviente.
 *
 * Y si la dispersión no supera su propia incertidumbre, NO se publica un número:
 * se publica `< X s`. Un valor menor que su error no es un valor.
 */

/* ── PARÁMETROS DEL MÉTODO, todos declarados ──────────────────────────────────
 * Ninguno es «el que salió bien». Cada uno dice qué descarta y por qué. */
export const POR_DEFECTO = {
  /* Mínimo de muestras EN MOVIMIENTO para ajustar. Con 2 la recta pasa exacta
     por los dos puntos y el residuo es 0: saldría incertidumbre cero, que es
     mentira. Con 4 ya hay 2 grados de libertad y el residuo significa algo. */
  min_muestras: 4,
  /* Fracción de la velocidad mediana por debajo de la cual una muestra NO se
     considera «en movimiento». No es un umbral de ruido: separa el tramo de
     giro del de seguimiento, que también se mueve, pero ~300 veces más lento
     (0,0024 °/s de seguimiento solar frente a ~0,17 °/s de stow). */
  frac_movimiento: 0.25,
  /* R² mínimo del ajuste. Un giro real es una rampa; si la recta no explica el
     tramo, o hubo parada, o hay dos tramos, o el detector se equivocó de
     ventana. En cualquiera de los tres casos el arranque extrapolado no vale. */
  r2_min: 0.98,
  /* Cuántas veces su propia incertidumbre tiene que valer la dispersión para
     publicarse como número en vez de como cota. 2 es «dos sigmas». */
  k_resuelve: 2,
};

const RAD_A_GRADO = 180 / Math.PI;

/* ── AJUSTE POR MÍNIMOS CUADRADOS, con el tiempo CENTRADO ─────────────────────
 * Centrar en la media anula la covarianza entre ordenada y pendiente, y así la
 * propagación del error al cruce es dos términos en vez de tres. No es un
 * truco: es la misma recta, escrita donde no se enredan. */
function recta(ts, ys) {
  const n = ts.length;
  const tm = ts.reduce((a, b) => a + b, 0) / n;
  const u = ts.map(t => t - tm);
  const Suu = u.reduce((a, x) => a + x * x, 0);
  if (!(Suu > 0)) return null;                 // todas las muestras a la misma hora
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  const b = u.reduce((a, x, i) => a + x * (ys[i] - ym), 0) / Suu;
  const a0 = ym;                               // ordenada EN t = tm, por el centrado
  const pred = u.map(x => a0 + b * x);
  const ssRes = ys.reduce((a, y, i) => a + (y - pred[i]) ** 2, 0);
  const ssTot = ys.reduce((a, y) => a + (y - ym) ** 2, 0);
  if (n <= 2) return null;                     // sin grados de libertad no hay residuo
  const s2 = ssRes / (n - 2);
  return {
    n, tm, a0, b,
    var_a: s2 / n,
    var_b: s2 / Suu,
    /* R² con el caso degenerado dicho: si el ángulo no varió nada, ssTot = 0 y
       R² sería 0/0. Eso no es «ajuste malo», es «no hubo giro». */
    r2: ssTot > 0 ? 1 - ssRes / ssTot : null,
    sigma_residuo: Math.sqrt(s2),
  };
}

/* La mediana, que aquí se usa para la velocidad típica: con una TCU atascada la
   media se va y el umbral de movimiento se rompe para todas las demás. */
function mediana(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ── EL PASO DEL ENCODER, MEDIDO DEL FICHERO ──────────────────────────────────
 * El menor salto no nulo entre muestras consecutivas. Se devuelve junto con
 * cuántos saltos distintos se vieron: si sólo se vio uno, el «mínimo» puede ser
 * el único, y eso no prueba que sea el paso — se dice y no se presume. */
/* EL MENOR SALTO NO ES EL PASO, y creerlo costó un rojo del banco sintético.
 * Durante el seguimiento solar el ángulo avanza ~0,072° por muestra de 30 s;
 * cuantizado a 0,03° eso son saltos de 0,06 y 0,09, y nunca uno de 0,03. El
 * mínimo OBSERVADO es una cota superior del paso, no el paso.
 *
 * Lo que sí lo da es el MÁXIMO COMÚN DIVISOR de los saltos: todos son múltiplos
 * enteros del escalón, así que mcd(0,06 · 0,09 · 5,10) = 0,03. Euclides con
 * tolerancia, porque esto es coma flotante y el resto nunca cae en cero exacto. */
function mcdAprox(xs, tol) {
  let g = xs[0];
  for (const x of xs) {
    let a = Math.max(g, x), b = Math.min(g, x);
    let guardia = 0;
    while (b > tol && guardia++ < 200) { const r = a - Math.floor(a / b) * b; a = b; b = r; }
    g = a;
    if (!(g > tol)) return null;
  }
  return g;
}

export function pasoAngular(muestras) {
  const saltos = [];
  for (let i = 1; i < muestras.length; i++) {
    const d = Math.abs(muestras[i].angulo_rad - muestras[i - 1].angulo_rad);
    if (d > 0) saltos.push(d);
  }
  if (!saltos.length) return { paso_rad: null, n_saltos: 0, motivo: 'el ángulo no cambió en ninguna muestra' };
  const min = Math.min(...saltos);
  /* La tolerancia va relativa al menor salto: absoluta no vale porque estos
     ángulos son radianes y el escalón puede ser 5e-4 o 5e-7 según el encoder. */
  const g = mcdAprox(saltos, min * 1e-3);
  const paso = g && g > 0 ? g : min;

  /* Y la comprobación que separa «cuantizado» de «con ruido»: si los saltos son
     múltiplos ~enteros del mcd, el mcd ES el escalón. Si no lo son, la señal
     trae ruido por encima de la cuantización y lo que se ha medido es un SUELO.
     Sin esto, un mcd numéricamente diminuto se publicaría como paso finísimo. */
  const casan = saltos.filter(d => Math.abs(d / paso - Math.round(d / paso)) < 0.05).length;
  const frac = casan / saltos.length;

  /* Y LA TRAMPA DEL MCD, que también salió del banco: con ruido encima, el mcd
     colapsa a un número diminuto del que TODO es múltiplo, así que `frac` sale
     1 y el «paso» se publicaría finísimo y falso. La señal de que ha colapsado
     es que quede muy por debajo del menor salto observado: en una señal
     cuantizada de verdad, el menor salto ES el escalón o unos pocos escalones. */
  const colapsado = paso < min / 10;
  return {
    paso_rad: colapsado ? min : paso,
    paso_grados: (colapsado ? min : paso) * RAD_A_GRADO,
    menor_salto_rad: min,
    n_saltos: saltos.length,
    frac_multiplos: frac,
    motivo: colapsado
      ? 'el máximo común divisor colapsa muy por debajo del menor salto: la señal trae ruido por encima de la cuantización, así que esto es un SUELO, no el paso del encoder'
      : (frac < 0.8
        ? 'los saltos no son múltiplos de un escalón común: esto es un SUELO de la cuantización, no el paso del encoder'
        : null),
  };
}

/* ── UNA TCU ──────────────────────────────────────────────────────────────────
 * `muestras`: [{ t_s, angulo_rad, objetivo_rad }], ordenadas y de UNA sola TCU.
 * Devuelve siempre un objeto; `t_arranque_s: null` con `motivo` cuando no sale. */
export function arranqueDeUnaTcu(muestras, opc = {}) {
  const P = { ...POR_DEFECTO, ...opc };
  const no = motivo => ({ t_arranque_s: null, sigma_s: null, vel_grados_s: null,
                          sigma_vel_grados_s: null, r2: null, n_ajuste: 0, motivo });

  if (!Array.isArray(muestras) || muestras.length < P.min_muestras + 2) {
    return no(`sólo ${muestras ? muestras.length : 0} muestras: hacen falta al menos ${P.min_muestras + 2}`);
  }

  /* Velocidades entre muestras consecutivas. En rad/s, que es lo que hay. */
  const vel = [];
  for (let i = 1; i < muestras.length; i++) {
    const dt = muestras[i].t_s - muestras[i - 1].t_s;
    if (!(dt > 0)) return no('hay muestras con el tiempo no creciente: el fichero viene desordenado o con duplicados');
    vel.push({ i, v: (muestras[i].angulo_rad - muestras[i - 1].angulo_rad) / dt });
  }

  /* El giro de stow es el tramo rápido, y su SIGNO es el del movimiento
     dominante. Se toma la velocidad de mayor módulo como referencia en vez de
     la mediana de todas: la mayoría de las muestras del día son seguimiento, y
     su mediana no dice nada del giro. */
  const vmax = vel.reduce((a, x) => Math.abs(x.v) > Math.abs(a.v) ? x : a, vel[0]);
  if (vmax.v === 0) return no('el ángulo no se movió en ninguna muestra');
  const signo = Math.sign(vmax.v);
  const umbral = Math.abs(vmax.v) * P.frac_movimiento;

  /* La ventana de giro: el tramo CONTIGUO alrededor de la muestra más rápida en
     el que se sigue superando el umbral y con el mismo signo. Contiguo a
     propósito — coger todas las muestras rápidas del día mezclaría dos giros
     distintos en una sola recta. */
  /* `vel[k]` es el intervalo (muestras[k], muestras[k+1]), o sea que el
     intervalo que TERMINA en muestras[j] es `vel[j-1]`. Se escribe así para que
     los índices de abajo se puedan leer sin contar con los dedos. */
  const intervaloQueTerminaEn = j => vel[j - 1];
  const intervaloQueEmpiezaEn = j => vel[j];
  const cuenta = iv => iv && Math.sign(iv.v) === signo && Math.abs(iv.v) >= umbral;

  let ini = vmax.i, fin = vmax.i;
  while (ini >= 2 && cuenta(intervaloQueTerminaEn(ini - 1))) ini--;
  while (fin + 1 < muestras.length && cuenta(intervaloQueEmpiezaEn(fin))) fin++;

  const ventana = muestras.slice(ini - 1, fin + 1);

  /* ── SE TIRAN LA PRIMERA Y LA ÚLTIMA MUESTRA DE LA VENTANA ─────────────────
   * Y no es una precaución: sin esto la velocidad salía un 5 % baja y la
   * dispersión de 150 s daba 144,6. Lo cazó el banco sintético, que es donde se
   * conoce la respuesta.
   *
   * El motivo es que esas dos muestras son PARCIALES. La TCU arrancó en algún
   * punto DENTRO del primer intervalo rápido, así que la muestra que lo abre
   * todavía está en el ángulo de seguimiento; y llegó al stow en algún punto
   * DENTRO del último, así que la que lo cierra ya está parada. Meterlas en la
   * recta mezcla tramo quieto con tramo en giro y aplana la pendiente.
   *
   * Las de en medio sí están garantizadas sobre la rampa: entre el final del
   * primer intervalo y el principio del último, la TCU se estuvo moviendo todo
   * el tiempo. */
  const ajuste = ventana.slice(1, -1);
  if (ajuste.length < P.min_muestras) {
    return no(`sólo ${ajuste.length} muestras enteramente en movimiento (${ventana.length} en la ventana, menos las dos parciales de los extremos): hacen falta ${P.min_muestras} para que el residuo signifique algo`);
  }

  const aj = recta(ajuste.map(m => m.t_s), ajuste.map(m => m.angulo_rad));
  if (!aj) return no('el ajuste no se pudo hacer (muestras insuficientes o todas a la misma hora)');
  if (aj.r2 === null) return no('el ángulo no varía dentro de la ventana: no hubo giro que ajustar');
  if (aj.r2 < P.r2_min) {
    return no(`el giro no es una rampa limpia (R² = ${aj.r2.toFixed(4)} < ${P.r2_min}): pudo haber parada o dos tramos`);
  }

  /* Si la ventana empieza en la primera muestra del fichero, el giro ya estaba
     en marcha cuando empezó el registro, y extrapolar entonces inventa un
     arranque anterior al dato. */
  const iPartida = ini - 2;
  if (iPartida < 0) return no('el giro ya estaba en marcha en la primera muestra: no hay ángulo de partida registrado');

  /* ── EL ARRANQUE ES EL CRUCE DE DOS RECTAS, NO EL CORTE CON UN ÁNGULO ──────
   * La primera versión extrapolaba la rampa de giro hasta el ángulo de la
   * última muestra quieta. El banco sintético le sacó un SESGO de +0,52 s —
   * sesgo puro: el error medio y el error absoluto medio salían idénticos, así
   * que todos los casos fallaban en el mismo sentido.
   *
   * La causa es física y no se arregla inflando la incertidumbre: entre esa
   * última muestra quieta y el arranque de verdad, la TCU SEGUÍA SIGUIENDO AL
   * SOL. Su ángulo en el instante de arrancar no es el de la muestra, sino ése
   * más lo que avanzó el seguimiento. Extrapolar la rampa hasta un ángulo viejo
   * la lleva demasiado lejos, y como la rampa baja, «demasiado lejos» es
   * «demasiado tarde». Siempre en el mismo sentido: eso es un sesgo.
   *
   * Lo correcto es que el arranque es donde la recta de SEGUIMIENTO y la recta
   * de GIRO se cruzan. Así el seguimiento deja de ser un error y pasa a ser
   * parte del modelo. */
  const previas = muestras.slice(0, iPartida + 1);
  const paso = pasoAngular(muestras);
  let t0, var_t0, metodo, ajSeg = null;

  if (previas.length >= 3) {
    ajSeg = recta(previas.map(m => m.t_s), previas.map(m => m.angulo_rad));
  }

  if (ajSeg && Number.isFinite(ajSeg.b)) {
    /* Cruce de las dos rectas, cada una centrada en su propia media. */
    const D = aj.b - ajSeg.b;
    if (!(Math.abs(D) > 0)) return no('las dos rectas son paralelas: no hay cruce que dar');
    t0 = (ajSeg.a0 - aj.a0 + aj.b * aj.tm - ajSeg.b * ajSeg.tm) / D;
    const varOls = (aj.var_a + ajSeg.var_a
                    + (aj.tm - t0) ** 2 * aj.var_b
                    + (t0 - ajSeg.tm) ** 2 * ajSeg.var_b) / (D * D);
    /* ── Y UN SUELO DE CUANTIZACIÓN, porque el de mínimos cuadrados se queda
     * corto. La fórmula de siempre supone residuos independientes; los de una
     * señal cuantizada no lo son —son una escalera, o sea estructura, no
     * ruido—, así que `s²` sale optimista. Medido en el banco: con la sigma de
     * OLS a secas sólo el 80 % de los casos caía dentro de 2 sigma, cuando 2
     * sigma tiene que cubrir ~95 %.
     *
     * El suelo es lo que daría la cuantización sola: cada ángulo conocido con
     * q/√12, promediado sobre las muestras de cada recta, dividido por la
     * diferencia de pendientes. Se toma el MAYOR de los dos, no la suma: el
     * residuo de OLS ya contiene parte de la cuantización, y sumarlos la
     * contaría dos veces. Una sigma por debajo del suelo del instrumento no es
     * creíble — es la décima lección, aplicada a la propia barra de error. */
    const varPaso = paso.paso_rad ? (paso.paso_rad ** 2) / 12 : 0;
    /* SIN dividir por `n`, y esto también lo midió el banco. La primera versión
       puso `(1/n1 + 1/n2)`, o sea suponiendo que los errores de cuantización se
       promedian como ruido independiente. NO se promedian: dentro de una
       ventana corta, muestras consecutivas caen en el mismo escalón o en el de
       al lado, así que el error es CORRELACIONADO y desplaza la recta entera en
       bloque. Con el 1/n la cobertura a 2 sigma se quedaba en 32 de 40; sin él
       sube a donde tiene que estar. Cada recta se toma con una incertidumbre de
       posición de un escalón completo, que es la hipótesis conservadora. */
    const varSuelo = varPaso * 2 / (D * D);
    var_t0 = Math.max(varOls, varSuelo);
    metodo = 'cruce de la recta de seguimiento con la de giro'
             + (varSuelo > varOls ? ' (la incertidumbre la manda la cuantización, no el residuo)' : '');
  } else {
    /* SIN suficientes muestras de seguimiento no hay segunda recta. Se usa el
       ángulo de la última quieta, SE DICE, y la incertidumbre se infla con el
       término que antes salía como sesgo: lo que el seguimiento avanza en medio
       periodo de muestreo, que es lo que se desconoce. */
    const yPartida = muestras[iPartida].angulo_rad;
    const dtc = (yPartida - aj.a0) / aj.b;
    t0 = aj.tm + dtc;
    const dt = muestras[iPartida + 1].t_s - muestras[iPartida].t_s;
    /* El seguimiento no se supone: se estima de las propias muestras previas si
       las hay, y si no hay ninguna se declara cero y se dice. */
    const vSeg = previas.length >= 2
      ? (previas[previas.length - 1].angulo_rad - previas[0].angulo_rad) /
        (previas[previas.length - 1].t_s - previas[0].t_s)
      : 0;
    const derivaAngular = Math.abs(vSeg) * dt;          // rango del desconocido
    const varDeriva = (derivaAngular ** 2) / 3;         // uniforme en [0, deriva]
    const varPaso = paso.paso_rad ? (paso.paso_rad ** 2) / 12 : 0;
    var_t0 = (aj.var_a + dtc * dtc * aj.var_b + varPaso + varDeriva) / (aj.b * aj.b);
    metodo = previas.length >= 2
      ? 'corte con el ángulo de la última muestra quieta (menos de 3 muestras de seguimiento); la incertidumbre incluye la deriva del seguimiento'
      : 'corte con el ángulo de la última muestra quieta, SIN muestras de seguimiento para estimar su deriva: la incertidumbre NO la cubre';
  }

  return {
    t_arranque_s: t0,
    sigma_s: Math.sqrt(var_t0),
    vel_grados_s: aj.b * RAD_A_GRADO,
    sigma_vel_grados_s: Math.sqrt(aj.var_b) * RAD_A_GRADO,
    vel_seguimiento_grados_s: ajSeg ? ajSeg.b * RAD_A_GRADO : null,
    metodo,
    r2: aj.r2,
    n_ajuste: ajuste.length,
    n_ventana: ventana.length,
    n_seguimiento: previas.length,
    paso_grados: paso.paso_grados,
    t_ultima_quieta_s: muestras[iPartida].t_s,
    t_primera_movida_s: muestras[ini - 1].t_s,
    motivo: null,
  };
}

/* ── LA PLANTA ────────────────────────────────────────────────────────────────
 * `porTcu`: Map o objeto { idTcu: [muestras] }. Devuelve los arranques y LA
 * DISPERSIÓN, que es lo que se buscaba. */
export function dispersionDeArranques(porTcu, opc = {}) {
  const P = { ...POR_DEFECTO, ...opc };
  const entradas = porTcu instanceof Map ? [...porTcu.entries()] : Object.entries(porTcu || {});
  if (!entradas.length) {
    return { medidas: [], caidas: [], dispersion_s: null, cota_s: null,
             motivo: 'no se recibió ninguna TCU: cero no es «todo bien», es que no se ha mirado' };
  }

  const medidas = [], caidas = [];
  for (const [id, ms] of entradas) {
    const r = arranqueDeUnaTcu(ms, P);
    if (r.t_arranque_s === null) caidas.push({ tcu: id, motivo: r.motivo });
    else medidas.push({ tcu: id, ...r });
  }

  const base = {
    n_total: entradas.length,
    n_medidas: medidas.length,
    n_caidas: caidas.length,
    medidas: medidas.sort((a, b) => a.t_arranque_s - b.t_arranque_s),
    caidas,
  };

  if (medidas.length < 2) {
    return { ...base, dispersion_s: null, cota_s: null,
             motivo: `sólo ${medidas.length} TCU medida(s): una dispersión necesita dos` };
  }

  const primera = base.medidas[0], ultima = base.medidas[base.medidas.length - 1];
  const d = ultima.t_arranque_s - primera.t_arranque_s;
  /* La incertidumbre de una diferencia de dos medidas independientes. */
  const sd = Math.sqrt(primera.sigma_s ** 2 + ultima.sigma_s ** 2);

  /* Y AQUÍ NO SE PUBLICA UN NÚMERO QUE NO SE SOSTIENE. Si la dispersión no
     supera k veces su propio error, lo medido es una COTA, no un valor. */
  const resuelve = d > P.k_resuelve * sd;

  return {
    ...base,
    primera_tcu: primera.tcu, ultima_tcu: ultima.tcu,
    dispersion_s: resuelve ? d : null,
    sigma_dispersion_s: sd,
    cota_s: resuelve ? null : P.k_resuelve * sd,
    velocidad_grados_s: {
      p50: mediana(medidas.map(m => m.vel_grados_s)),
      min: Math.min(...medidas.map(m => m.vel_grados_s)),
      max: Math.max(...medidas.map(m => m.vel_grados_s)),
      /* DEFINICIÓN, escrita, porque es lo que faltaba en la validación de campo
         y por lo que dos lecturas del mismo día no coincidían (§2.4):
         pendiente por mínimos cuadrados de `30506` sobre las muestras en
         movimiento contiguo de UN giro, en grados por segundo. Ni diferencia
         punta a punta, ni media de diferencias consecutivas. */
      definicion: 'pendiente por mínimos cuadrados de 30506 sobre las muestras en movimiento contiguo de un giro',
    },
    motivo: resuelve ? null
      : `la dispersión (${d.toFixed(1)} s) no supera ${P.k_resuelve}× su incertidumbre (${sd.toFixed(1)} s): se publica como cota`,
  };
}

/* ── LECTURA DEL CSV ──────────────────────────────────────────────────────────
 * EL MAPEO DE COLUMNAS NO SE ADIVINA. A la hora de escribir esto no hay ningún
 * CSV de stow del SCADA en la cartera, así que cualquier nombre de columna que
 * pusiera aquí sería inventado. Se declara al llamar, y sin declararlo falla.
 *
 * Cuando llegue el fichero real, esto es lo ÚNICO que hay que tocar. */
export function leeFilas(texto, mapa) {
  const faltan = ['tcu', 't', 'angulo'].filter(k => !mapa || !mapa[k]);
  if (faltan.length) {
    throw new Error('mapeo de columnas incompleto: falta ' + faltan.join(', ') +
      '. No se adivina: dime qué columnas trae el CSV del SCADA.');
  }
  const lineas = texto.split(/\r?\n/).filter(l => l.trim());
  if (lineas.length < 2) throw new Error('el CSV no tiene filas de datos');
  const cab = lineas[0].split(/[,;\t]/).map(s => s.trim());
  const idx = {};
  for (const k of ['tcu', 't', 'angulo', 'objetivo']) {
    if (!mapa[k]) continue;
    const j = cab.indexOf(mapa[k]);
    if (j < 0) throw new Error(`la columna «${mapa[k]}» (${k}) no está en la cabecera: ${cab.join(', ')}`);
    idx[k] = j;
  }
  const porTcu = new Map();
  for (let i = 1; i < lineas.length; i++) {
    const c = lineas[i].split(/[,;\t]/);
    const id = (c[idx.tcu] || '').trim();
    const t = Number(c[idx.t]), ang = Number(c[idx.angulo]);
    if (!id || !Number.isFinite(t) || !Number.isFinite(ang)) continue;
    if (!porTcu.has(id)) porTcu.set(id, []);
    porTcu.get(id).push({
      t_s: t, angulo_rad: ang,
      objetivo_rad: idx.objetivo !== undefined ? Number(c[idx.objetivo]) : null,
    });
  }
  for (const ms of porTcu.values()) ms.sort((a, b) => a.t_s - b.t_s);
  return porTcu;
}
