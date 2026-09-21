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

  /* ── LA ALTURA DEL EJE DEL TUBO, POR PLANTA ──────────────────────────────
   * NUNCA una constante global escondida. Se pide con el `montaje` de la planta
   * delante, y si la planta no la declara se cae al defecto CON MOTIVO, para
   * que la salida pueda rotularse «declarada» en vez de pasar por medida.
   *
   * El hueco por planta ya existe y está vacío: `montaje.module_height` en
   * `Cobertura-Zigbee/plantas_indice.json` vale `null` en las once, y su
   * generador lo dice — `montaje_edm.mjs:133`, «null · no se ha medido la
   * altura del tubo en ninguna planta».
   *
   * QUÉ DECIDE ESTA COTA, medido y no supuesto: NO decide dónde cae el canto
   * respecto a la antena. Subir el eje sube la banda y la antena a la vez, así
   * que la difracción es invariante por traslación — 0,00e+0 dB entre 1,50 y
   * 2,00 sobre las 49 de El Burgo. Lo que decide es el REBOTE EN EL SUELO:
   * 4,8–5,8 dB por enlace. Y eso la acopla al relieve, no al panel. */
  function alturaEje(montaje, defectoM) {
    var v = montaje && montaje.module_height;
    if (typeof v === "number" && isFinite(v) && v > 0) {
      return { valor: v, medida: true, motivo: null };
    }
    if (!(defectoM > 0)) {
      throw new Error("radio_pv_model: falta la altura del eje y no hay defecto declarado");
    }
    return { valor: defectoM, medida: false,
             motivo: "altura_de_eje_declarada_no_medida_en_esta_planta" };
  }

  /* ── DÓNDE ESTÁ LA ANTENA DE LA TCU ──────────────────────────────────────
   * NO es una cota fija. El conector cuelga del TUBO y GIRA CON ÉL; del
   * conector baja el coax, que cuelga en vertical por su peso. Así que la
   * antena es «anclaje rotado por α, más la caída del coax hacia abajo».
   *
   * PROCEDENCIA, y es geometría de plano, no un supuesto:
   *   · el anclaje está en el marco local del seguidor en (tcuX−0,16, −0,225, 0)
   *     — Cobertura-Zigbee/seguidor.js:340. La X local es EL EJE DEL TUBO
   *     (`tcuX: 1.4`, «TCU desplazada a lo largo del tubo, junto al motor»), así
   *     que lo que cuenta para el giro es el RADIO en el plano perpendicular:
   *     0,225 m por debajo del eje.
   *   · el giro es `makeRotationX(−α)` en ese marco canónico
   *     — Cobertura-Zigbee/terreno.html:1907.
   *   · el coax cuelga 0,50 m — `antHang: 0.50`, seguidor.js:35.
   *   · y el 3D ya lo dibuja así: `aTip = [ax, ay − hang, az]` con (ax,ay,az)
   *     el conector YA rotado — terreno.html:1925. Esta función es esa misma
   *     cuenta, para que el motor y el dibujo no se separen.
   *
   * Rotación de (0, −r, 0) alrededor de X por −α:  y' = −r·cos α, z' = +r·sen α.
   *
   * LA VERTICAL SE MUEVE POCO Y LA LATERAL NO: r·(1−cos α) son 3 cm a 30° y
   * 22,5 a 90°, pero r·sen α son 11 cm a 30°, y ESE es el que decide por qué
   * lado de su propia fila sale el rayo. Ver `holguraBajoModulo`. */
  function anclaAntena(radioM, alphaDeg) {
    var a = alphaDeg * GRADO, r = radioM;
    return { dz: -r * Math.cos(a), lateral: r * Math.sin(a) };
  }

  /* Cota de la antena de la TCU sobre el suelo de SU seguidor. */
  function alturaAntenaTCU(ejeM, radioM, caidaM, alphaDeg) {
    return ejeM + anclaAntena(radioM, alphaDeg).dz - caidaM;
  }

  /* ¿CUELGA LA ANTENA EN EL HUECO DE SU PROPIO MÓDULO, O DENTRO DE LA BANDA?
   *
   * Positivo = cuelga por debajo del borde bajo, en el hueco. Negativo = el
   * látigo está DENTRO de la banda que barre su propio panel, entre el módulo
   * y el suelo.
   *
   * Y esto cambia de signo en operación, que es lo que obliga a tenerlo:
   *
   *     α       antena      borde bajo    holgura
   *     0°      −0,725        0,000       +72,5 cm
   *    30°      −0,695       −0,595       +10,0 cm
   *    45°      −0,659       −0,842       −18,2 cm
   *    55°      −0,629       −0,975       −34,6 cm
   *
   * El cambio de signo está en α ≈ 35,1° con cuerda 2,380 m (34,6° con 2,411),
   * y los seguidores trabajan hasta 55–60°. O sea que «el rayo sale por el
   * hueco de debajo del panel» deja de ser cierto en la mitad alta del
   * recorrido, justo donde el panel más tapa. */
  function holguraBajoModulo(radioM, caidaM, cuerdaM, alphaDeg) {
    var a = alphaDeg * GRADO;
    var zAnt = anclaAntena(radioM, alphaDeg).dz - caidaM;   // respecto al eje
    var zBot = -(cuerdaM / 2) * Math.abs(Math.sin(a));      // idem
    return zBot - zAnt;
  }

  /* ── EL PANEL DE VERDAD: UN PLANO INCLINADO, NO UN SEGMENTO VERTICAL ──────
   *
   * `banda()` proyecta el panel como un segmento VERTICAL sobre el eje de la
   * fila. Para una fila lejana da igual —el rayo la cruza casi en el eje y la
   * huella de ±(c/2)·cos α es pequeña frente al vano—, pero para la fila PROPIA
   * es falso: la antena está a 0,113 m del eje y el panel llega a ±1,19·cos α,
   * o sea DIEZ VECES más lejos. Colapsar eso al eje pone el borde difractante
   * donde no está.
   *
   * AQUÍ SE CORTA CON EL PLANO. En el plano perpendicular a la fila, con
   *
   *     w = distancia perpendicular CON SIGNO al eje, positiva hacia el borde ALTO
   *
   * el panel es el segmento
   *
   *     z(w) = zEje + w·tan α,     |w| ≤ semiW = (c/2)·cos α
   *
   * cuyos extremos están en (±semiW, zEje ± semiZ) con semiZ = (c/2)·sen α.
   * Y el rayo, que también es una recta en (w, z) porque las dos coordenadas
   * son afines en el parámetro del enlace:
   *
   *     zRayo(w) = zA + (zB − zA)·(w − wA)/(wB − wA)
   *
   * EL ÁNGULO DE CRUCE ENTRA SOLO: quien llama pasa `wA`/`wB` medidos con la
   * perpendicular a ESA fila, y la distancia recorrida hasta un `w` es
   * (w − wA)/sen φ. Así que la misma función vale para un enlace perpendicular
   * a la fila y para uno que la corta de refilón.
   *
   * QUÉ DEVUELVE Y POR QUÉ NO ES LO MISMO QUE `corta()`:
   *   · el VEREDICTO (tapado / pasa por debajo / pasa por encima) coincide con
   *     el de la banda, comprobado; lo que NO coincide es
   *   · `wBorde`, la posición del borde por el que difracta. La banda lo pone
   *     en w = 0 y el panel lo pone en w = ±(c/2)·cos α. Para la fila propia
   *     eso cambia d1 de 0,113 m a 1,14 m —de 0,9 λ a 9,3 λ—, y con ello ν y
   *     el veredicto de campo cercano.
   */
  function cortaPanel(zEje, cuerdaM, alphaDeg, wA, wB, zA, zB) {
    var a = alphaDeg * GRADO;
    var semiW = (cuerdaM / 2) * Math.cos(a);
    var semiZ = (cuerdaM / 2) * Math.sin(a);
    var dw = wB - wA;
    if (Math.abs(dw) < 1e-12) {
      /* el enlace va paralelo a la fila: nunca la cruza. No es «libre», es que
         esta fila no es un obstáculo de este enlace. */
      return { estado: "paralelo", despeje: null, borde: null, wBorde: null, motivo: "enlace_paralelo_a_la_fila" };
    }
    /* tramo de `w` que el rayo comparte con la huella del panel */
    var w0 = Math.min(wA, wB), w1 = Math.max(wA, wB);
    var lo = Math.max(w0, -semiW), hi = Math.min(w1, semiW);
    if (lo > hi) {
      return { estado: "fuera", despeje: null, borde: null, wBorde: null, motivo: "el_enlace_no_pisa_la_huella" };
    }
    /* hueco = rayo − panel, afín en w, así que su mínimo está en un extremo */
    function hueco(w) {
      var zR = zA + (zB - zA) * ((w - wA) / dw);
      return zR - (zEje + w * Math.tan(a));
    }
    var hLo = hueco(lo), hHi = hueco(hi);
    /* EL CANTO POR EL QUE DIFRACTA es el que deja MENOS hueco, y el despeje va
       CON SIGNO respecto a él. Mismo convenio que `corta()`: positivo = el rayo
       pasa por fuera, negativo = va por dentro y ése es el fondo que tiene que
       rodear.
       ATRAVESAR el panel se detecta por el CAMBIO DE SIGNO dentro de la huella,
       no por el despeje.
       AQUÍ HUBO UN FALLO MÍO: la primera versión devolvía `despeje: 0` para el
       caso tapado, o sea ν = 0 y 6,03 dB FIJOS tapara lo que tapara. Medido:
       α = 39,07°, 45° y 55° daban los tres 6,03 dB mientras el rayo pasaba a
       7,5, 18,2 y 34,6 cm del canto. Se perdía la profundidad entera. */
    var cruza = (hLo > 0) !== (hHi > 0);
    var wB2 = Math.abs(hLo) <= Math.abs(hHi) ? lo : hi;
    var h = Math.abs(hLo) <= Math.abs(hHi) ? hLo : hHi;
    /* EN LA TANGENCIA EXACTA LA ETIQUETA NO ESTÁ DETERMINADA, y se dice en vez
       de fingir una convención. Justo en la transición de α el rayo roza el
       canto: el despeje es 0 y el signo de `hueco()` en ese extremo depende del
       último bit. NO se le pone un épsilon —sería un umbral inventado— porque
       el NÚMERO es el mismo por los dos lados: despeje 0, luego ν 0 y la misma
       pérdida. Lo único que cambia es la palabra. */
    return {
      estado: cruza ? "tapado" : (h > 0 ? "libre" : "hueco"),
      /* MISMO SIGNO QUE `corta()`: positivo = el rayo pasa por FUERA (libre o
         por el hueco), negativo = va por dentro. Devolver `h` con su signo
         crudo invertia el convenio para el caso «hueco», porque ahi el rayo
         esta por DEBAJO del plano y `z_rayo − z_panel` sale negativo aunque
         el rayo este limpio. Cazado por el banco. */
      despeje: cruza ? -Math.min(Math.abs(hLo), Math.abs(hHi)) : Math.abs(h),
      borde: zEje + wB2 * Math.tan(a),
      wBorde: wB2,
      motivo: null
    };
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
    /* CONDUCTOR PERFECTO: Γ = +1, sin dependencia del ángulo. Es la cota
       superior del rebote, el caso de referencia que se enseña junto a la
       tierra real. Absorbido de cobertura-rf-fv `reflection_coefficient`, y su
       argumento para tenerlo en el núcleo es el bueno: «evita que cada página
       se escriba su propio dos rayos con suelo perfecto», que es justo la
       avería que la consolidación viene a cerrar.

       Sin esto el canon NO fallaba: MENTÍA EN SILENCIO. Medido ejecutándolo,
       `cSub(eps, cx(cos2,0))` daba Infinity, `cSqrt` lo propagaba y en `cDiv`
       salía Infinity − Infinity = NaN; `dosRayosDb(100, 1.5, 1.5, 2.45e9,
       Infinity, ...)` devolvía NaN y ese NaN viajaba hasta el margen sin que
       nada lo dijera. */
    if (epsR === Infinity) return cx(1.0, 0.0);
    /* Y un epsR que no sea un número LANZA, en vez de propagar NaN. Mismo
       criterio que `exigeF`: olvidarse de un parámetro tiene que hacer ruido. */
    if (!(epsR > 0)) throw new Error("radio_pv_model: epsR inválido (" + epsR + "). Use Infinity para conductor perfecto.");
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
  /* ── PATRÓN DE ANTENA ────────────────────────────────────────────────────
   * La ganancia NO es un escalar. La Jinchang JCW435700RA es un dipolo de ~λ/2
   * —lo dice su propia ficha, citada en cobertura-rf-fv
   * python/zigbee_pv_model.py:270— y un dipolo tiene su máximo en el horizonte
   * y un NULO en su propio eje. Tratar sus 3 dBi como un número suelto es
   * optimista en todo salto con elevación.
   *
   *     F(e) = cos((π/2)·sen e) / cos e ,  e = elevación sobre el horizonte
   *
   * Normalizado a F(0) = 1, así que en el horizonte vale 0 dB y los 3 dBi de
   * catálogo siguen siendo los de catálogo: esto SOLO RESTA, que es lo que
   * tiene que hacer una corrección de patrón sobre la ganancia de pico.
   *
   * POR QUÉ ENTRA AHORA, dicho sin adornarlo: a 2,45 GHz casi no mueve nada.
   * Medido sobre las geometrías reales, 2·gEl vale −0,24 dB en el peor
   * TCU→NCU (12 m) y −1,99 en el peor TCU→HSU (12 m), y CERO EXACTO en todo el
   * careo de El Burgo, donde las dos antenas van a la misma altura. Entra
   * porque `gtx_dbi` como escalar NO SE PUEDE LLEVAR A SUB-GHZ: en LoRa o
   * Wi-SUN la antena es otra, con otro patrón, y hoy no hay dónde declararlo.
   *
   * LO QUE NO MODELA, declarado: el látigo cuelga de la viga y BASCULA con la
   * mesa, así que su eje no es exactamente la vertical. Se toma vertical.
   *
   * Y SE APLICA POR RAYO, no por enlace. cobertura-rf-fv lo aplica una sola vez
   * con la elevación del rayo DIRECTO (python/zigbee_pv_model.py:362) y luego
   * suma un modelo de dos rayos cuyo reflejado sale con OTRO ángulo —a 12 m con
   * antenas a 1,5 m, 14° contra 0°—. Eso es incoherente con el propio modelo al
   * que se suma, así que aquí la función toma la elevación y quien la llama la
   * aplica al rayo que toca. */
  function gananciaPatronDb(elevRad, patron) {
    var p = patron == null ? "iso" : String(patron);
    if (p === "iso") return 0;
    if (p !== "dipolo") throw new Error("radio_pv_model: patrón de antena «" + p + "» no implementado");
    var c = Math.cos(elevRad);
    if (Math.abs(c) < 1e-9) return -60;                 // el nulo del eje, acotado
    var f = Math.cos((Math.PI / 2) * Math.sin(elevRad)) / c;
    return 20 * Math.log10(Math.max(Math.abs(f), 1e-3));
  }

  /* ── EL CAMPO CERCANO, QUE ES DONDE EL FILO DE CUCHILLO DEJA DE VALER ─────
   * P.526 supone que el obstáculo está lejos de los dos extremos en longitudes
   * de onda. Cerca no hay «filo»: hay una antena metida debajo de una placa.
   *
   * EL CORTE DE ANTES NO ERA FÍSICO. `rfObstacles` descartaba por `t > 0,001`,
   * o sea el 0,1 % del enlace: 1,2 cm en un salto de 12 m y 33,8 cm en uno de
   * 338. Proporcional al enlace, no a λ.
   *
   * HOY NO SE NOTABA, y conviene saber por qué: los extremos se ponían en el
   * MOTOR, que está sobre el eje de la fila. Medidos 4.676 enlaces en El Burgo,
   * 620 en Ayora, 446 en San José y 3.710 en Páramo: CERO cruces por debajo de
   * 10 λ, y el más próximo a 3,0 m (24 λ), que es el `filaZ` de la bífila.
   *
   * SE NOTA EN CUANTO LA ANTENA SE PONE EN SU SITIO. Con el desplazamiento
   * lateral r·sen α, el enlace cruza el eje de SU PROPIA fila a (r·sen α)/sen φ,
   * con φ el ángulo entre el enlace y la fila:
   *
   *     α      perpendicular      φ=60°       φ=30°
   *    15°      0,058 (0,5 λ)   0,067 (0,5)  0,116 (1,0)
   *    30°      0,112 (0,9 λ)   0,130 (1,1)  0,225 (1,8)
   *    45°      0,159 (1,3 λ)   0,184 (1,5)  0,318 (2,6)
   *
   * O sea DENTRO del campo cercano en todo el recorrido útil. Por eso el corte
   * va en λ y no en `t`, y por eso lo que se devuelve es un ESTADO con motivo y
   * no un número de dB: bajo su propio panel la antena no está difractando en
   * un filo, y fabricar un dB ahí sería inventar. */
  function campoCercano(d1, d2, fHz, umbralLambdas) {
    var lam = longitudOnda(fHz);
    var u = umbralLambdas == null ? 2 : umbralLambdas;
    var d = Math.min(d1, d2);
    return { cerca: d < u * lam, distanciaM: d, lambdas: d / lam, umbralLambdas: u };
  }

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
    cortaPanel: cortaPanel,
    alturaEje: alturaEje,
    regimen: regimen,
    relieveDominante: relieveDominante,
    anclaAntena: anclaAntena,
    alturaAntenaTCU: alturaAntenaTCU,
    holguraBajoModulo: holguraBajoModulo,
    campoCercano: campoCercano,
    gananciaPatronDb: gananciaPatronDb,
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
