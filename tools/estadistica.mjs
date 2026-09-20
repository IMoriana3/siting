/* estadistica.mjs — lo justo para describir un residuo sin mentir.
 *
 * POR QUÉ EXISTE. Una media de +1,1 dB no valida nada: es compatible con que
 * el modelo acierte y con que se equivoque ±25 dB compensándose. Lo que dice
 * algo es la DISPERSIÓN y la ESTRUCTURA — si el residuo tiene pendiente contra
 * la distancia o contra las filas cruzadas, el modelo reparte mal la culpa, y
 * eso hay que poder afirmarlo con un número y un p-valor, no con un vistazo.
 *
 * TODO DEVUELVE `null` CON MOTIVO cuando no se puede calcular, nunca NaN. Un
 * NaN se serializa a `null` en el JSON sin decir por qué, y entonces «no se
 * pudo calcular» y «salió cero» se confunden.
 *
 * Y NADA DE AQUÍ SE ESCRIBE DE MEMORIA: la t de Student va por la beta
 * incompleta, con la fracción continua de Lentz, y el banco la carea contra
 * valores de tabla publicados.
 */

export function percentil(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  /* interpolación lineal entre órdenes, que es el método «linear» de toda la
     vida: con n pequeño el percentil sin interpolar salta a trompicones. */
  const h = (s.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return lo === hi ? s[lo] : s[lo] + (h - lo) * (s[hi] - s[lo]);
}

export function resumen(xs) {
  if (!xs.length) return { n: 0, media: null, sigma: null, p10: null, p50: null, p90: null,
                           min: null, max: null, motivo: 'sin datos' };
  const n = xs.length, media = xs.reduce((a, b) => a + b, 0) / n;
  /* sigma MUESTRAL (n−1). Con n = 49 la diferencia frente a n es del 1 %, pero
     el que lee «sigma» espera la muestral y no hay razón para darle otra. */
  const sigma = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - media) ** 2, 0) / (n - 1)) : null;
  const s = [...xs].sort((a, b) => a - b);
  return { n, media, sigma, p10: percentil(xs, 0.10), p50: percentil(xs, 0.50),
           p90: percentil(xs, 0.90), min: s[0], max: s[n - 1], motivo: null };
}

/* Histograma con anchura de banda declarada, no automática: una anchura que
   cambia sola hace que dos ejecuciones no se puedan comparar. */
export function histograma(xs, ancho) {
  if (!xs.length) return { bandas: [], ancho, motivo: 'sin datos' };
  const a = ancho || 5;
  const lo = Math.floor(Math.min(...xs) / a) * a, hi = Math.ceil(Math.max(...xs) / a) * a;
  const bandas = [];
  for (let x = lo; x < hi; x += a) {
    bandas.push({ desde: x, hasta: x + a, n: xs.filter(v => v >= x && v < x + a).length });
  }
  if (bandas.length) bandas[bandas.length - 1].n += xs.filter(v => v === hi).length;
  return { bandas, ancho: a, motivo: null };
}

/* ── LA BETA INCOMPLETA, para el p-valor de la t ──────────────────────────────
   Fracción continua de Lentz. Cita: Numerical Recipes, `betacf`/`betai`. Se
   copia la recurrencia tal cual en vez de aproximar por la normal, porque con
   n = 49 (47 grados de libertad) la normal ya se separa en la tercera cifra y
   un p-valor es justo donde eso importa. */
function lnGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function betacf(a, b, x) {
  const MAX = 200, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;  if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;  if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) return h;
  }
  return h;
}

export function betaIncompleta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a
                                   : 1 - bt * betacf(b, a, 1 - x) / b;
}

/* p a dos colas de la t de Student con `gl` grados de libertad. */
export function pDosColas(t, gl) {
  if (!(gl > 0)) return null;
  return betaIncompleta(gl / 2, 0.5, gl / (gl + t * t));
}

/* ── PEARSON Y SPEARMAN, con su p-valor ──────────────────────────────────── */
function pearsonCrudo(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const p = xs[i] - mx, q = ys[i] - my; sxy += p * q; sxx += p * p; syy += q * q; }
  if (sxx === 0) return { r: null, motivo: 'la primera variable no varia' };
  if (syy === 0) return { r: null, motivo: 'la segunda variable no varia' };
  return { r: sxy / Math.sqrt(sxx * syy), motivo: null };
}

export function pearson(xs, ys) {
  const n = xs.length;
  if (n !== ys.length) return { r: null, p: null, n, motivo: 'longitudes distintas' };
  if (n < 3) return { r: null, p: null, n, motivo: 'menos de 3 puntos' };
  const c = pearsonCrudo(xs, ys);
  if (c.r === null) return { r: null, p: null, n, motivo: c.motivo };
  /* r = ±1 exacto da t infinita: el p es 0 y la fórmula no lo puede evaluar. */
  if (Math.abs(c.r) >= 1) return { r: c.r, p: 0, n, motivo: null };
  const t = c.r * Math.sqrt((n - 2) / (1 - c.r * c.r));
  return { r: c.r, p: pDosColas(t, n - 2), n, motivo: null };
}

/* Rangos con MEDIA EN LOS EMPATES, que es lo que Spearman necesita: darles
   rangos arbitrarios sesga la correlación, y en estos datos hay empates de
   sobra (doce enlaces a 24,0 m exactos). */
export function rangos(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const medio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = medio;
    i = j + 1;
  }
  return r;
}

export function spearman(xs, ys) {
  const n = xs.length;
  if (n !== ys.length) return { r: null, p: null, n, motivo: 'longitudes distintas' };
  if (n < 3) return { r: null, p: null, n, motivo: 'menos de 3 puntos' };
  return pearson(rangos(xs), rangos(ys));
}

/* Pendiente por mínimos cuadrados, con su error típico y su p. Es lo que
   contesta «¿tiene estructura el residuo contra esta variable?» con un número
   en las unidades del problema —dB por metro, dB por fila— en vez de con un
   coeficiente adimensional. */
export function pendiente(xs, ys) {
  const n = xs.length;
  if (n !== ys.length) return { b: null, se: null, p: null, n, motivo: 'longitudes distintas' };
  if (n < 3) return { b: null, se: null, p: null, n, motivo: 'menos de 3 puntos' };
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  if (sxx === 0) return { b: null, se: null, p: null, n, motivo: 'la primera variable no varia' };
  const b = sxy / sxx, a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (a + b * xs[i])) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx);
  if (se === 0) return { b, a, se: 0, p: 0, n, motivo: null };
  return { b, a, se, p: pDosColas(b / se, n - 2), n, motivo: null };
}
