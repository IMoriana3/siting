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

  var RadioPV = {
    GRADO: GRADO,
    banda: banda,
    alturaRayo: alturaRayo,
    corta: corta,
    regimen: regimen,
    relieveDominante: relieveDominante,
    _version: "fase1-geometria"
  };
  raiz.RadioPV = RadioPV;
  /* misma salida doble que el modelo antiguo: la página lo carga con <script> y
     los bancos con require(). */
  if (typeof module !== "undefined" && module.exports) module.exports = RadioPV;
})(typeof window !== "undefined" ? window : globalThis);
