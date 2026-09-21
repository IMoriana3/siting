/* radio_zigbee.js — la capa ZIGBEE sobre el motor de radio.
 *
 * QUÉ ES ESTO Y QUÉ NO. `radio_pv_model.js` es el motor: geometría y ecuaciones
 * de pérdida, sin saber qué radio hay puesta. Esto de aquí es lo que SÍ depende
 * de la radio —potencia, ganancias, sensibilidad, umbral— para Zigbee 2,4 GHz,
 * y nada más. Cuando entren LoRa y Wi-SUN (fase 3) serán ficheros hermanos de
 * éste sobre el MISMO motor, no otro motor.
 *
 * LAS DOS VARIANTES, que es lo que pide el encargo: la planta entera con
 * XBee-PRO, o la planta entera con XBee estándar. No una mezcla: mientras no
 * esté el inventario de campo no se sabe qué hay puesto en cada TCU, y una
 * mezcla inventada es peor que dos cotas honestas.
 *
 * LO QUE NO SE SABE APAGA LO QUE DEPENDE, EN VEZ DE RELLENARSE:
 *
 *   · sin `rx_sens_dbm` NO HAY MARGEN. Se devuelve `null` con su motivo, no un
 *     número. Hoy le pasa a la variante estándar: la sensibilidad del XBee no
 *     PRO no está en el código y no se escribe de memoria.
 *   · sin JSON de `calibra_barrido.py` el modo es TEÓRICO: `l_mod_db`,
 *     `l_roce_db` y `offset_db` valen 0 y la salida lo dice. Cero no es «no hay
 *     pérdida por mesa», es «no se ha medido», y por eso va rotulado.
 *   · sin `sigma_db` no hay probabilidad de enlace. Un margen es un número; una
 *     probabilidad necesita saber cuánto se mueve, y eso sale de la campaña.
 *
 * NINGÚN SESGO GLOBAL. Ver la nota de TRASPASO sobre el −33,6 y el −16,58.
 */
(function (raiz) {
  "use strict";

  var RPV = (typeof require !== "undefined" && typeof module !== "undefined")
    ? require("./radio_pv_model.js")
    : raiz.RadioPV;
  if (!RPV) throw new Error("radio_zigbee: falta radio_pv_model");

  /* Modo de operación, que acompaña a TODA salida. Quien la consuma no puede
     no enterarse de si está mirando una predicción calibrada o teórica. */
  var TEORICO = "TEORICO", CALIBRADO = "CALIBRADO";

  /* Correcciones empíricas. Las tres salen del ajuste de la hoja de barrido
     (`calibra_barrido.py`) y NINGUNA tiene valor por defecto distinto de cero:
       l_mod_db   por cada mesa que el rayo ATRAVIESA
       l_roce_db  por cada mesa que cruza POR DEBAJO (tubo, hincas, canto)
       offset_db  lo que quede sin explicar
     Sin campaña, las tres a cero Y ROTULADO. */
  function correcciones(calib) {
    if (!calib) return { lMod: 0, lRoce: 0, offset: 0, modo: TEORICO, campana: null, version: null };
    var falta = ["l_mod_db", "l_roce_db", "offset_db"].filter(function (k) {
      return calib[k] == null;
    });
    if (falta.length) {
      throw new Error("radio_zigbee: el JSON de calibración no trae " + falta.join(", ") +
                      ". Un JSON a medias es peor que ninguno: o calibra o no calibra.");
    }
    return {
      lMod: calib.l_mod_db, lRoce: calib.l_roce_db, offset: calib.offset_db,
      modo: CALIBRADO, campana: calib.campana || null, version: calib.version || null
    };
  }

  /* CUÁNTAS MESAS ATRAVIESA Y CUÁNTAS ROZA. La distinción no es cosmética: es
   * la que separa `l_mod_db` de `l_roce_db`, y el ajuste sólo las puede separar
   * si alguien midió los mismos pares con las palas planas y de canto. Aquí
   * sale gratis, porque `cortaPanel()` ya lo sabe: "tapado" es atravesar y
   * "hueco" es rozar por debajo.
   *
   * SOBRE EL PANEL REAL, no sobre la banda vertical. El cruce trae su propia
   * geometria -{s, zEje, cuerda, alpha, senPhi}- y el corte se resuelve con el
   * plano inclinado, que es donde esta el canto de verdad. */
  function cuenta(D, zA, zB, cruces) {
    var atraviesa = 0, roza = 0, porEncima = 0, fuera = 0;
    for (var i = 0; i < cruces.length; i++) {
      var cr = cruces[i], sp = cr.senPhi;
      if (!(sp > 0)) { fuera++; continue; }
      var c = RPV.cortaPanel(cr.zEje, cr.cuerda, cr.alpha,
                             -cr.s * sp, (D - cr.s) * sp, zA, zB);
      if (c.wBorde == null) { fuera++; continue; }
      var sB = cr.s + c.wBorde / sp;
      if (sB <= 0 || sB >= D) { fuera++; continue; }
      if (c.estado === "tapado") atraviesa++;
      else if (c.estado === "hueco") roza++;
      else porEncima++;
    }
    return { atraviesa: atraviesa, roza: roza, porEncima: porEncima, fuera: fuera };
  }

  /* EL BALANCE DE UN ENLACE.
   *
   *   Prx = Ptx + Gtx + Grx − (dos rayos + difracción por PANELES + vegetación
   *                            + l_mod·atraviesa + l_roce·roza + offset)
   *   margen = Prx − sensibilidad
   *
   * `enlace` = {D, zA, zB, cruces, perfil}. Las alturas son ABSOLUTAS (cota del
   * terreno + altura de antena), igual que las bandas: mezclar relativas y
   * absolutas es el error que hace que el relieve no cuente. */
  function presupuesto(enlace, variante, propagacion, calib) {
    if (!variante) throw new Error("radio_zigbee: falta la variante");
    var f = variante.f_hz;
    RPV.longitudOnda(f);                       // lanza si falta la frecuencia
    var c = correcciones(calib);
    var motivos = [];

    var D = enlace.D, zA = enlace.zA, zB = enlace.zB;
    var cruces = enlace.cruces || [];
    var n = cuenta(D, zA, zB, cruces);

    var difrac = RPV.difraccionPanelesDb(D, zA, zB, cruces, f);

    /* EL RELIEVE, CONTRA LA TIERRA LISA.
     *
     * SIN PERFIL NO SE DICE 0, SE DICE QUE NO SE HA MIRADO. Tres estados:
     *
     *   perfil AUSENTE   nadie ha mirado el terreno. Es el caso de TODOS los
     *                    enlaces del mapa hoy: `index.html` pasa `perfil: null`.
     *   perfil que NO PISA el vano   tampoco se ha mirado nada.
     *   perfil DENTRO del vano       un numero, y si sale 0 ese 0 SI significa
     *                    «llano», porque es exacto por construccion.
     *
     * Misma disciplina que la vegetacion de abajo. Un cero callado es la forma
     * mas barata de mentir en un balance.
     *
     * ───────────────────────────────────────────────────────────────────────
     * POR QUE CONTRA LA TIERRA LISA Y NO CONTRA LA COTA CERO. Porque
     * `dosRayosDb` YA supone un plano reflectante debajo y modela su efecto
     * entero. Pasarle el terreno como cotas absolutas a un filo de cuchillo
     * cobra OTRA VEZ ese mismo plano. Medido, antena a 0,475 m (eje 1,20) y
     * perfil PLANO a cota 0, con 11 puntos de perfil: 21,66 dB de doble conteo
     * a 100 m. Con un solo punto medio eran 2,84. Ni uno ni otro es terreno:
     * es el suelo que los dos rayos ya tienen puesto.
     *
     * La referencia es la RECTA DE MINIMOS CUADRADOS del perfil -ITU-R
     * P.1812-6, Anexo 1, Adjunto 1, §5.6.1, ec. (85)-(88)- y el relieve es lo
     * que el terreno real cobra POR ENCIMA de esa recta. Con perfil plano o en
     * rampa, real y referencia son la misma cuenta y sale 0 EXACTO, sin umbral.
     *
     * Y LAS ALTURAS DE ANTENA DE LOS DOS RAYOS VAN SOBRE ESA MISMA RECTA
     * (`htE`, `hrE`, ec. (94)), no sobre la cota cero: si la referencia de la
     * difraccion y la del rebote fueran distintas, la resta no cancelaria. */
    var relieve = null, relieveDet = null;   // `null` = no evaluado, como la vegetacion
    var htE = zA, hrE = zB;                  // sin perfil, el suelo es la cota 0
    if (!enlace.perfil || !enlace.perfil.length) {
      motivos.push("relieve_no_evaluado_sin_perfil");
    } else {
      relieveDet = RPV.relieveDeltaDb(D, zA, zB, enlace.perfil, f);
      if (relieveDet === null) {
        /* El perfil no cubre el vano entero -o tiene menos de dos puntos-. No
           se ha mirado nada, y eso NO es un 0: se dice, igual que la ausencia. */
        motivos.push("relieve_perfil_no_cubre_el_vano");
      } else {
        relieve = relieveDet.db;
        htE = relieveDet.htE;
        hrE = relieveDet.hrE;
      }
    }

    var dosRayos = RPV.dosRayosDb(D, htE, hrE, f, propagacion.eps_r_suelo,
                                  propagacion.sigma_suelo_s_m, propagacion.polarizacion);

    /* VEGETACIÓN: `null` si no hay modelo. NO se suma como 0 callando. */
    var veg = RPV.vegetacionDb(enlace.vegetacionM || 0, f,
                               (propagacion.vegetacion && propagacion.vegetacion.modelo) || null);
    if (veg === null) motivos.push("vegetacion_no_modelada");

    var perdida = dosRayos + difrac + (relieve || 0) + c.lMod * n.atraviesa + c.lRoce * n.roza
                + c.offset + (veg || 0);

    var salida = {
      modo: c.modo, variante: variante.nombre || null,
      distanciaM: D, mesas: n,
      dosRayosDb: dosRayos, difraccionDb: difrac, relieveDb: relieve,
      vegetacionDb: veg, perdidaTotalDb: perdida,
      prxDbm: null, margenDb: null, pEnlace: null, motivos: motivos,
      calibracion: c.modo === CALIBRADO ? { version: c.version, campana: c.campana } : null
    };

    if (variante.ptx_dbm == null || variante.gtx_dbi == null || variante.grx_dbi == null) {
      motivos.push("balance_incompleto");
      return salida;
    }

    /* EL CANAL. Si no se sabe en cuál trabaja la planta, la potencia declarada
     * es una COTA SUPERIOR y no una predicción: el comentario del modelo
     * congelado dice «Canal 26: máx +3», y el canal 26 está en el borde de la
     * banda, donde la máscara de emisión obliga a bajar. Entre +19 y +3 hay
     * DIECISÉIS dB en toda la planta, más que cualquier otro parámetro de aquí.
     * Sale del `CH` del inventario; mientras no esté, se dice. */
    if (variante.canal == null || variante.canal.valor == null) {
      motivos.push("canal_desconocido_ptx_es_cota_superior");
    }
    salida.prxDbm = variante.ptx_dbm + variante.gtx_dbi + variante.grx_dbi - perdida;

    /* SIN SENSIBILIDAD NO HAY MARGEN. Es el caso de la variante estándar hoy, y
       devolver aquí un número supuesto sería exactamente el fallo que el
       encargo prohíbe: un número sin procedencia que luego nadie distingue. */
    if (variante.rx_sens_dbm == null) {
      motivos.push("sin_sensibilidad_no_hay_margen");
      return salida;
    }
    salida.margenDb = salida.prxDbm - variante.rx_sens_dbm;

    /* Y sin sigma no hay probabilidad: un margen dice dónde está la media, no
       cuánto se mueve. */
    var sigma = propagacion.sigma_db;
    if (sigma == null) motivos.push("sin_sigma_no_hay_probabilidad");
    else salida.pEnlace = phi(salida.margenDb / sigma);
    return salida;
  }

  /* CDF normal. Cita: zigbee_pv_model.js `_phi` y su `erf` de Abramowitz-Stegun
     7.1.26, copiada operación a operación para que el gemelo Python coincida. */
  function erf(x) {
    var t = 1 / (1 + 0.3275911 * Math.abs(x));
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
                 + 0.254829592) * t * Math.exp(-x * x);
    return x >= 0 ? y : -y;
  }
  function phi(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

  /* ¿ES VIABLE? Un enlace es viable si su margen llega al umbral. Sin margen
     —sin sensibilidad— la respuesta NO es `false`: es `null`, «no se sabe», y
     quien lo consuma tiene que decidir qué hacer con eso en vez de tratarlo
     como un enlace muerto. */
  function viable(p, umbralDb) {
    if (p.margenDb == null) return null;
    return p.margenDb >= (umbralDb == null ? 0 : umbralDb);
  }

  var RadioZigbee = {
    TEORICO: TEORICO, CALIBRADO: CALIBRADO,
    correcciones: correcciones, cuenta: cuenta, presupuesto: presupuesto,
    viable: viable, erf: erf, phi: phi
  };
  raiz.RadioZigbee = RadioZigbee;
  if (typeof module !== "undefined" && module.exports) module.exports = RadioZigbee;
})(typeof window !== "undefined" ? window : globalThis);
