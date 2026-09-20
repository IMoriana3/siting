/* radio_pv_model.js — motor de radio para plantas FV. GEOMETRÍA y TECNOLOGÍA
 * separadas, que es la idea entera de este fichero.
 *
 * ┌─ POR QUÉ UNO NUEVO, Y NO UN CAMBIO EN EL DE ANTES ─────────────────────────┐
 * │ `zigbee_pv_model.js` queda CONGELADO byte a byte: lo fija por sha256 el    │
 * │ candado `siting/zigbee_pv_model.lock.json` de SolarGPTfull y lo carea su   │
 * │ `tests/test_paridad_rf_zigbee.py` EJECUTANDO el JS real contra             │
 * │ `factiun_core.rf`, con 0,000000 dB de diferencia. Tocarlo —aunque fuera    │
 * │ para dejar un envoltorio— cambia el sha256 y rompe las dos cosas.          │
 * │ Sigue disponible en la UI como «modelo antiguo (A)», rotulado, para poder  │
 * │ comparar.                                                                  │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * LA SEPARACIÓN, Y POR QUÉ IMPORTA
 *
 *   GEOMETRÍA   no sabe de radios. Dónde está cada cosa, qué corta el enlace y
 *               a qué altura. Vale igual para Zigbee, LoRa o Wi-SUN, y es lo
 *               ÚNICO que se traslada de una banda a otra.
 *   TECNOLOGÍA  balance, banda, protocolo y regulación. Depende de la radio y
 *               NO se traslada: ni la potencia, ni la sensibilidad, ni una
 *               calibración hecha a 2,4 GHz.
 *
 * SIN SESGO GLOBAL. El modelo antiguo lleva `EL_BURGO_BIAS_DB` para recentrar
 * la predicción sobre lo medido. Aquí no hay. Cuando haya campaña, sus
 * parámetros entran por `radio_params.json` con su versión y su origen, no
 * como un número que empuja el resultado hasta que cuadre.
 *
 * ── ESTADO ──────────────────────────────────────────────────────────────────
 * Fase 1, parte 1 de 2: GEOMETRÍA. La parte de TECNOLOGÍA (banda, Fresnel,
 * dos rayos, difracción, vegetación) viene detrás y consumirá esto.
 */
(function (raiz) {
  "use strict";

  /* ═══ GEOMETRÍA ═══════════════════════════════════════════════════════════
     Nada de aquí abajo sabe en qué frecuencia se emite. Si algo lo necesita,
     está en el sitio equivocado. */

  var GRADO = Math.PI / 180;

  /* LA BANDA, que es el cambio de fondo frente al modelo antiguo.
   *
   * El modelo A trataba cada fila como un FILO DE CUCHILLO a la altura del
   * borde superior del módulo, y ese filo subía DESDE EL SUELO. O sea: un rayo
   * que pasara por debajo del panel se contaba como tapado. Eso es falso y es
   * lo que tumbó el careo contra el 3D: bajo un seguidor hay HUECO, y por ahí
   * pasa señal.
   *
   * Un seguidor inclinado α, con cuerda `c` y eje a altura `eje`, ocupa en
   * vertical una BANDA centrada en el eje:
   *
   *        zTop = eje + (c/2)·|sen α|          ← borde de arriba
   *        zBot = eje − (c/2)·|sen α|          ← borde de abajo
   *
   * y por debajo de `zBot` hay hueco hasta el suelo, SALVO lo que ocupen el
   * tubo de torsión y las hincas, que son estrechos y se tratan aparte.
   *
   * Nótese que con α = 0 (plano) la banda degenera en una línea a la altura
   * del eje: no es que no tape nada, es que tapa un plano horizontal, y para
   * un enlace casi horizontal eso es justo lo que ocurre.
   *
   * `alphaDeg` es el ángulo DE ESE SEGUIDOR en ESE INSTANTE, no uno global:
   * el modelo A usaba un único `#rf-tilt` para toda la planta, y en una planta
   * con backtracking eso no existe ni un solo minuto del día. */
  function banda(eje, cuerdaM, alphaDeg, sueloM) {
    var semi = (cuerdaM / 2) * Math.abs(Math.sin(alphaDeg * GRADO));
    var suelo = sueloM == null ? 0 : sueloM;
    return {
      eje: eje,
      semi: semi,
      zBot: eje - semi,
      zTop: eje + semi,
      suelo: suelo,
      /* hueco libre bajo el panel. Puede ser 0 si el seguidor está tan bajo o
         tan inclinado que la banda llega al suelo. Nunca negativo. */
      hueco: Math.max(0, eje - semi - suelo)
    };
  }

  /* DÓNDE ESTÁ EL RAYO al llegar a esa banda. Recta entre las dos antenas, en
     el plano vertical que las une. `s` es la distancia recorrida desde A. */
  function alturaRayo(zA, zB, D, s) {
    if (D <= 0) return zA;
    return zA + (zB - zA) * (s / D);
  }

  /* CÓMO CORTA LA BANDA AL RAYO. Tres respuestas posibles, y la diferencia
   * entre ellas es la que el modelo A no sabía dar:
   *
   *   "tapado"  el rayo entra en la banda: hay material delante
   *   "hueco"   el rayo pasa POR DEBAJO de la banda, por el hueco del seguidor
   *   "libre"   el rayo pasa POR ENCIMA
   *
   * Y en los dos últimos casos se devuelve el despeje CON SIGNO respecto al
   * borde que tiene más cerca, que es lo que luego pide la difracción: positivo
   * si el rayo va por fuera de la banda, negativo si va por dentro.
   *
   * OJO al caso "hueco": el borde que cuenta es `zBot`, no el suelo. Un rayo
   * que pasa rozando por debajo del panel está difractando en el BORDE INFERIOR
   * del módulo, no en el terreno. */
  function corta(b, zRayo) {
    if (zRayo > b.zTop) return { estado: "libre", despeje: zRayo - b.zTop, borde: b.zTop };
    if (zRayo < b.zBot) {
      /* por debajo del panel, pero ¿queda dentro del hueco o ya está bajo
         tierra? Lo segundo es el terreno tapando, y eso no lo decide la banda:
         lo decide el relieve, que va aparte. */
      return { estado: "hueco", despeje: b.zBot - zRayo, borde: b.zBot, bajoSuelo: zRayo < b.suelo };
    }
    /* dentro de la banda: el despeje es negativo y se mide al borde MÁS
       PRÓXIMO, porque por ahí es por donde se escapa la energía. */
    var dTop = b.zTop - zRayo, dBot = zRayo - b.zBot;
    var borde = dTop <= dBot ? b.zTop : b.zBot;
    return { estado: "tapado", despeje: -Math.min(dTop, dBot), borde: borde };
  }

  /* EL RÉGIMEN DEL ENLACE. Un enlace que va POR EL PASILLO entre dos filas no
   * cruza ninguna, y su física es otra: casi espacio libre con dos rayos. Uno
   * que CRUZA filas se come una banda por cada cruce. Confundirlos es lo que
   * hacía que el mapa de margen pintase el 96 % de El Burgo bajo 0 dB mientras
   * la malla real funcionaba.
   *
   * Se decide por el ángulo del enlace con la dirección de las filas: si es
   * menor que `tolGrados`, va por pasillo. La tolerancia es un parámetro
   * porque depende del ancho del pasillo y del largo del enlace, no una
   * constante universal. */
  function regimen(dxEnlace, dyEnlace, dxFila, dyFila, tolGrados) {
    var n1 = Math.hypot(dxEnlace, dyEnlace), n2 = Math.hypot(dxFila, dyFila);
    if (n1 < 1e-9 || n2 < 1e-9) return { tipo: "degenerado", anguloDeg: null };
    var cos = Math.abs((dxEnlace * dxFila + dyEnlace * dyFila) / (n1 * n2));
    var ang = Math.acos(Math.min(1, Math.max(-1, cos))) / GRADO;   // 0 = paralelo
    var tol = tolGrados == null ? 10 : tolGrados;
    return { tipo: ang <= tol ? "pasillo" : "cruza", anguloDeg: ang };
  }

  /* EL RELIEVE ENTRE NODOS. El modelo A trabajaba con `ground: 0` — terreno
   * llano— y eso en una planta con desnivel no es una simplificación, es otra
   * planta. Aquí el terreno entra como perfil muestreado y se trata como lo que
   * es: un obstáculo más, pero CONTINUO, no una banda.
   *
   * Devuelve el punto que más invade el rayo, que es el que manda en Deygout. */
  function relieveDominante(zA, zB, D, perfil) {
    if (!perfil || !perfil.length) return null;
    var peor = null;
    for (var i = 0; i < perfil.length; i++) {
      var s = perfil[i][0], zSuelo = perfil[i][1];
      if (s <= 0 || s >= D) continue;
      var invade = zSuelo - alturaRayo(zA, zB, D, s);
      if (peor === null || invade > peor.invade) peor = { s: s, zSuelo: zSuelo, invade: invade };
    }
    return peor;
  }

  /* ═══ TECNOLOGÍA ══════════════════════════════════════════════════════════
     Aquí SÍ manda la frecuencia, y por eso `fHz` es argumento OBLIGATORIO en
     todo lo de abajo. El modelo antiguo lo lleva con valor por defecto
     (`fHz = 2.45e9`), que es cómodo y es justo como una banda se cuela sin que
     nadie la elija: basta olvidarse del parámetro. Sin defecto, olvidarlo es un
     `NaN` ruidoso en vez de una predicción de 2,4 GHz disfrazada de LoRa.

     LAS FÓRMULAS SON LAS QUE YA USA EL REPO, y se citan en vez de escribirse de
     memoria: salen de `zigbee_pv_model.js`, que está pinchado a 0,000000 dB
     contra `factiun_core.rf` por el banco de paridad de SolarGPTfull. Lo que
     cambia aquí NO es la física del filo: es QUÉ se le da como obstáculo —una
     banda con su hueco en vez de un filo que sube desde el suelo—. */

  var C_LUZ = 299792458;

  function exigeF(fHz) {
    if (!(fHz > 0)) throw new Error("radio_pv_model: falta fHz. La frecuencia no tiene valor por defecto a propósito.");
    return fHz;
  }

  /* λ = c/f. Cita: zigbee_pv_model.js `wavelength`. */
  function longitudOnda(fHz) { return C_LUZ / exigeF(fHz); }

  /* Espacio libre. Cita: zigbee_pv_model.js `fsplDb`, con la constante −147,55
     que es la forma de la fórmula con f en Hz y d en metros. */
  function fsplDb(dM, fHz) {
    return 20 * Math.log10(Math.max(dM, 1e-3)) + 20 * Math.log10(exigeF(fHz)) - 147.55;
  }

  /* Radio de la n-ésima zona de Fresnel. Cita: zigbee_pv_model.js `fresnelRadius`.
     Depende de λ, así que a 868 MHz es ~1,7 veces el de 2,45 GHz: la misma
     geometría despeja MENOS en sub-GHz, y eso es exactamente lo que no se puede
     trasladar de una banda a otra. */
  function radioFresnel(d1, d2, fHz, n) {
    var nn = n == null ? 1 : n;
    return Math.sqrt((nn * longitudOnda(fHz) * d1 * d2) / (d1 + d2));
  }

  /* Punto de ruptura de dos rayos: 4·h1·h2/λ. Cita: zigbee_pv_model.js
     `breakpointDistance`. */
  function distanciaRuptura(ht, hr, fHz) {
    return (4 * ht * hr) / longitudOnda(fHz);
  }

  /* ── DOS RAYOS ───────────────────────────────────────────────────────────
   * Directo más reflejado en el suelo, que es lo que de verdad domina un enlace
   * casi horizontal a metro y medio del suelo. Por debajo del punto de ruptura
   * las dos contribuciones se suman y se restan con la distancia —de ahí los
   * lóbulos—, y por encima el reflejado cancela y la pérdida crece con d⁴.
   *
   * Cita: zigbee_pv_model.js `twoRayPlDb` y `reflectionCoefficient`, con su
   * aritmética compleja mínima copiada OPERACIÓN A OPERACIÓN. No se sustituye
   * por la biblioteca compleja del lenguaje aunque sea más corta: el gemelo
   * Python tiene que dar el mismo número, y `cSqrt` de aquí no es `cmath.sqrt`.
   *
   * Aquí SÍ se le exige `fHz`, a diferencia del original, que lo lleva con
   * defecto 2.45e9 junto con epsR, sigma y pol. */
  function cx(re, im) { return { re: re, im: im || 0 }; }
  function cAdd(a, b) { return cx(a.re + b.re, a.im + b.im); }
  function cSub(a, b) { return cx(a.re - b.re, a.im - b.im); }
  function cMul(a, b) { return cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
  function cScale(a, s) { return cx(a.re * s, a.im * s); }
  function cAbs(a) { return Math.hypot(a.re, a.im); }
  function cDiv(a, b) {
    var d = b.re * b.re + b.im * b.im;
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  }
  function cSqrt(z) {
    var r = Math.hypot(z.re, z.im);
    var re = Math.sqrt((r + z.re) / 2);
    var im = Math.sqrt((r - z.re) / 2);
    if (z.im < 0) im = -im;
    return cx(re, im);
  }
  function cExp(z) {
    var e = Math.exp(z.re);
    return cx(e * Math.cos(z.im), e * Math.sin(z.im));
  }

  /* Coeficiente de reflexión de Fresnel en el suelo. `pol` "v" o "h". */
  function coefReflexion(theta, epsR, sigma, fHz, pol) {
    var lam = longitudOnda(fHz);
    var eps = cx(epsR, -60.0 * lam * sigma);
    var s = Math.sin(theta);
    var cos2 = Math.pow(Math.cos(theta), 2);
    var root = cSqrt(cSub(eps, cx(cos2, 0)));
    if (String(pol == null ? "v" : pol).toLowerCase().indexOf("v") === 0) {
      var es = cScale(eps, s);
      return cDiv(cSub(es, root), cAdd(es, root));
    }
    return cDiv(cSub(cx(s, 0), root), cAdd(cx(s, 0), root));
  }

  function dosRayosDb(dM, ht, hr, fHz, epsR, sigma, pol) {
    exigeF(fHz);
    var d = Math.max(dM, 1e-3);
    var lam = longitudOnda(fHz);
    var dLos = Math.hypot(d, ht - hr);
    var dRef = Math.hypot(d, ht + hr);
    var theta = Math.atan2(ht + hr, d);
    var gamma = coefReflexion(theta, epsR, sigma, fHz, pol);
    var dphi = (2 * Math.PI * (dRef - dLos)) / lam;
    var refl = cScale(cMul(gamma, cExp(cx(0, -dphi))), 1 / dRef);
    var campo = cAdd(cx(1 / dLos, 0), refl);
    return -20 * Math.log10((lam / (4 * Math.PI)) * cAbs(campo));
  }

  /* Pérdida por filo de cuchillo, aproximación de ITU-R P.526. Cita:
     zigbee_pv_model.js `knifeEdgeLossDb` — misma expresión, mismo corte en
     ν = −0,78. */
  function perdidaFiloDb(v) {
    if (v <= -0.78) return 0.0;
    return 6.9 + 20 * Math.log10(Math.sqrt(Math.pow(v - 0.1, 2) + 1) + v - 0.1);
  }

  /* El parámetro ν de difracción. `hTapa` es cuánto INVADE el obstáculo el rayo:
     positivo si tapa, negativo si hay despeje. Cita: zigbee_pv_model.js `vParam`. */
  function nu(hTapa, d1, d2, fHz) {
    if (d1 <= 0 || d2 <= 0) return -1e9;
    return hTapa * Math.sqrt((2 * (d1 + d2)) / (longitudOnda(fHz) * d1 * d2));
  }

  /* DIFRACCIÓN POR BANDAS, con Deygout. Aquí es donde el cambio de geometría se
   * nota en el número.
   *
   * El modelo antiguo recibe `[[x, cotaSuperior]]` y mide la invasión contra esa
   * cota, con el filo subiendo desde el suelo. Éste recibe BANDAS y le pregunta
   * a `corta()` por el borde que toca: si el rayo va por el hueco, difracta en
   * el borde INFERIOR del módulo; si va por encima, en el superior; y si va
   * dentro, por el más próximo.
   *
   * Deygout: se busca el obstáculo dominante (el de ν mayor), se cobra su
   * pérdida y se repite a los dos lados. `maxProf` acota la recursión igual que
   * en el modelo antiguo (3). */
  /* HAY UNA SOLA IMPLEMENTACIÓN, y devuelve el DETALLE. `difraccionBandasDb`
   * es una envoltura que se queda con el total.
   *
   * El detalle no es un adorno: el panel de perfil tiene que poder señalar cuál
   * fue el obstáculo dominante y cómo se partió el enlace, que es lo que hace
   * entendible el número. Calcularlo por un segundo camino sería tener dos
   * Deygout que se separan solos — el error que este repo ya se ha comido con
   * la física y con el recuento de filas. */
  function difraccionBandasDetalle(D, zA, zB, cruces, fHz, prof, maxProf) {
    var p = prof || 0, tope = maxProf == null ? 3 : maxProf;
    var vacio = { totalDb: 0.0, dominante: null, izquierda: null, derecha: null,
                  profundidad: p, motivo: null };
    if (!cruces || !cruces.length) { vacio.motivo = "sin cruces"; return vacio; }
    if (p >= tope) { vacio.motivo = "tope de recursion (" + tope + ")"; return vacio; }
    if (D <= 0) { vacio.motivo = "tramo de longitud nula"; return vacio; }
    var mejorV = -1e9, mejor = -1, mejorS = 0;
    for (var i = 0; i < cruces.length; i++) {
      var s = cruces[i].s;
      if (s <= 0 || s >= D) continue;
      var z = alturaRayo(zA, zB, D, s);
      var c = corta(cruces[i].banda, z);
      var v = nu(-c.despeje, s, D - s, fHz);      // despeje positivo ⇒ ν negativo
      if (v > mejorV) { mejorV = v; mejor = i; mejorS = s; }
    }
    if (mejor < 0) { vacio.motivo = "ningun cruce cae dentro del tramo"; return vacio; }
    if (mejorV <= -0.78) {
      vacio.motivo = "el dominante despeja (nu = " + mejorV.toFixed(3) + " <= -0,78)";
      return vacio;
    }
    var zDom = alturaRayo(zA, zB, D, mejorS);
    var cDom = corta(cruces[mejor].banda, zDom);
    var bordeDom = cDom.borde;
    var perdidaDom = perdidaFiloDb(mejorV);
    var izq = [], der = [];
    for (var k = 0; k < cruces.length; k++) {
      if (k === mejor) continue;
      if (cruces[k].s < mejorS) izq.push(cruces[k]);
      else der.push({ s: cruces[k].s - mejorS, banda: cruces[k].banda });
    }
    /* los sub-tramos van del extremo al BORDE del dominante, que es donde se
       reconstruye el rayo. Igual que el Deygout del modelo antiguo. */
    var dIzq = difraccionBandasDetalle(mejorS, zA, bordeDom, izq, fHz, p + 1, tope);
    var dDer = difraccionBandasDetalle(D - mejorS, bordeDom, zB, der, fHz, p + 1, tope);
    return {
      totalDb: perdidaDom + dIzq.totalDb + dDer.totalDb,
      dominante: { indice: mejor, s: mejorS, zRayo: zDom, nu: mejorV,
                   perdidaDb: perdidaDom, estado: cDom.estado,
                   despeje: cDom.despeje, borde: bordeDom, banda: cruces[mejor].banda },
      izquierda: dIzq, derecha: dDer, profundidad: p, motivo: null
    };
  }

  function difraccionBandasDb(D, zA, zB, cruces, fHz, prof, maxProf) {
    return difraccionBandasDetalle(D, zA, zB, cruces, fHz, prof, maxProf).totalDb;
  }

  /* VEGETACIÓN. Declarada y NO implementada, a propósito: el encargo pide un
   * modelo de follaje estándar CITADO y dependiente de la frecuencia, y no se
   * escribe un coeficiente sin tener la recomendación delante (candidata:
   * ITU-R P.833). Con el parámetro a `null` en radio_params.json, esto devuelve
   * `null` —no 0 dB— para que quien lo consuma tenga que decir «no modelada»
   * en vez de dar por despejado lo que no se ha mirado. */
  function vegetacionDb(espesorM, fHz, modelo) {
    if (!modelo) return null;
    throw new Error("radio_pv_model: modelo de vegetación «" + modelo + "» no implementado todavía");
  }

  var RadioPV = {
    GRADO: GRADO,
    // geometría
    banda: banda,
    alturaRayo: alturaRayo,
    corta: corta,
    regimen: regimen,
    relieveDominante: relieveDominante,
    // tecnología
    C_LUZ: C_LUZ,
    longitudOnda: longitudOnda,
    fsplDb: fsplDb,
    radioFresnel: radioFresnel,
    distanciaRuptura: distanciaRuptura,
    perdidaFiloDb: perdidaFiloDb,
    coefReflexion: coefReflexion,
    dosRayosDb: dosRayosDb,
    nu: nu,
    difraccionBandasDb: difraccionBandasDb,
    difraccionBandasDetalle: difraccionBandasDetalle,
    vegetacionDb: vegetacionDb,
    _version: "fase1"
  };
  raiz.RadioPV = RadioPV;
  /* misma salida doble que el modelo antiguo: la página lo carga con <script> y
     los bancos con require(). */
  if (typeof module !== "undefined" && module.exports) module.exports = RadioPV;
})(typeof window !== "undefined" ? window : globalThis);
