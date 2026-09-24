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

    /* EL DETALLE, no sólo el dB: de su `nuMax` sale el ESTADO del enlace frente
       a los paneles. `difraccionPanelesDb` es una envoltura de esto, así que el
       número no cambia ni un bit — lo que cambia es que ya no se tira el resto
       del resultado. */
    var detPan = RPV.difraccionPanelesDetalle(D, zA, zB, cruces, f);
    var difrac = detPan.totalDb;

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
    var salidaSinMargen = false;             // dato mezclado: se para, ver abajo
    var htE = zA, hrE = zB;                  // sin perfil, el suelo es la cota 0
    if (!enlace.perfil || !enlace.perfil.length) {
      motivos.push("relieve_no_evaluado_sin_perfil");
    } else {
      relieveDet = RPV.relieveDeltaDb(D, zA, zB, enlace.perfil, f);
      if (relieveDet === null) {
        /* El perfil no cubre el vano entero -o tiene menos de dos puntos-. No
           se ha mirado nada, y eso NO es un 0: se dice, igual que la ausencia. */
        motivos.push("relieve_perfil_no_cubre_el_vano");
      } else if (relieveDet.db === null) {
        /* ALTURAS MEZCLADAS, Y AQUI SE PARA EL BALANCE ENTERO.
         *
         * `relieveDeltaDb` ha visto la antena por debajo de su propia tierra
         * lisa, o sea que `zA`/`zB` no vienen en el dato del perfil. Eso no
         * estropea solo el relieve: `dosRayosDb` recibiria como altura sobre el
         * suelo una cota sobre el nivel del mar -739 m en Ayora-, y el resultado
         * seria un margen con pinta de bueno salido de una antena enterrada.
         *
         * Asi que se devuelve SIN MARGEN, con el motivo, igual que se hace sin
         * sensibilidad y con el balance incompleto. Es el unico sitio del
         * relieve donde no vale con anotar y seguir, porque el dato malo se
         * propaga al rebote y no se queda en su termino. */
        motivos.push("relieve_" + relieveDet.motivo);
        salidaSinMargen = true;
      } else {
        relieve = relieveDet.db;
        htE = relieveDet.htE;
        hrE = relieveDet.hrE;

        /* ═══ EL UMBRAL DE VANO CORTO DE UN TERRENO SIN RESOLUCION ═══════════
         *
         * Con terreno de SOLO DEM, por debajo de cierto vano el relieve que
         * sale no es impreciso: es INVENTADO. Medido comparando el terreno
         * empalmado -verdad de campo- contra el mismo sitio con solo DEM,
         * sobre 400 vanos por banda:
         *
         *   vano        relieve VERDADERO p95    el que da el DEM solo p95
         *   30-50 m           0,00 dB                    9,89 dB
         *   50-75 m           2,54                      11,10
         *   75-100 m          1,21                      13,14
         *
         * O sea que a 30-50 m el relieve de verdad es CERO EXACTO y el DEM
         * cobra hasta 9,89 dB. Eso no es ruido alrededor de un valor: es un
         * termino entero que no existe, pintandose en el mapa.
         *
         * Asi que quien carga el terreno declara `vanoMinUtil` -del propio
         * fichero, `calidad.vano_min_util_m`- y por debajo el relieve va a 0
         * CON MOTIVO. Cero y no `null`: `null` es «no se ha mirado», y aqui se
         * ha mirado y la respuesta es que no hay termino.
         *
         * Y LAS ALTURAS SE QUEDAN, que es lo que hace esto correcto y no un
         * apagon. Poner el relieve a cero NO es ignorar el terreno: `htE`/`hrE`
         * siguen saliendo de la tierra lisa del perfil y alimentan los dos
         * rayos. Esa parte SI es fiable a vano corto, porque el error del DEM
         * esta correlado en 80-117 m -medido con el semivariograma- y un vano
         * por debajo de eso cae DENTRO de la longitud de correlacion: los dos
         * extremos se desplazan casi lo mismo y el desplazamiento comun no
         * mueve el balance. Lo que no sobrevive es la DIFERENCIA punto a punto
         * a lo largo del perfil, que es justo de lo que vive la difraccion. */
        if (enlace.vanoMinUtil > 0 && D < enlace.vanoMinUtil) {
          relieve = 0;
          motivos.push("relieve_dem_sin_resolucion_a_este_vano");
        }
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
    salida.estado = estadoDelEnlace(detPan, relieve, relieveDet, veg, motivos);

    /* Antes que nada: si las alturas venian mezcladas, no hay balance que dar.
       Va aqui y no arriba para que `salida` lleve igualmente los terminos
       calculados y el motivo, que es lo que se necesita para diagnosticarlo. */
    if (salidaSinMargen) return salida;

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
    /* ══ A2: LA GANANCIA DE PATRÓN, QUE ESTABA DEFINIDA Y NO SE USABA ═══════
     *
     * `gananciaPatronDb` existía en el motor, exportada y con su caso en la
     * paridad desde la fase 2 — y el balance NUNCA la llamaba: sumaba
     * `gtx + grx` planos. O sea una absorción del inventario (A2) a medias:
     * escrita, probada, y sin efecto en ningún número.
     *
     * `gtx_dbi`/`grx_dbi` son la ganancia de PICO de la antena. El patrón es el
     * factor RELATIVO a ese pico en la dirección del enlace, así que se suma:
     * `gtx + patrón` es la ganancia real hacia donde apunta el enlace.
     *
     * CON ALTURAS IGUALES ES 0,000 dB EXACTO, que es por lo que entre dos TCU
     * no cambia nada. Donde cambia es en TCU→NCU, donde 0,505 m contra 3,15 m
     * sí es una elevación.
     *
     * Y ES PREREQUISITO DE SUB-GHz: a 868 MHz la antena es otra, con otro
     * patrón, y una ganancia plana es optimista de una forma que no se traslada.
     * Lo dice el propio inventario al declarar A2.
     *
     * SIN PATRÓN DECLARADO NO SE PONE 0 EN SILENCIO: se trata como isótropa y
     * se anota el motivo, que es lo que hace el resto del motor con todo lo que
     * no sabe. */
    var pat = RPV.gananciaPatronEnlace(D, zA, zB, enlace.patron || null);
    if (enlace.patron == null) motivos.push("patron_de_antena_no_declarado");
    salida.patron = { nombre: enlace.patron || null, elevDeg: pat.elevRad * 180 / Math.PI,
                      porExtremoDb: pat.porExtremoDb, totalDb: pat.totalDb };
    salida.prxDbm = variante.ptx_dbm + variante.gtx_dbi + variante.grx_dbi + pat.totalDb - perdida;

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

  /* ══ EL ESTADO DEL ENLACE, Y POR QUE NO SALE DEL ν DEL TERRENO ═══════════
   *
   * Tres mecanismos pueden estorbar un enlace: los PANELES, el RELIEVE y la
   * VEGETACION. El estado del enlace es el PEOR de los tres, y aparte va si se
   * han podido mirar los tres o no — que son dos afirmaciones distintas y hasta
   * hoy sólo se publicaba la segunda.
   *
   * PANELES: directo del ν dominante de Deygout. Es geometría y longitud de
   * onda, no depende de nada que aquí esté sin calibrar.
   *
   * RELIEVE: SE LEE DEL dB, NO DE SU ν, y esto es lo que casi se cuela.
   * `relieveDeltaDb` publica ahora `nuReal`, el ν del filo equivalente del
   * perfil REAL, y clasificar con él parece lo natural. Medido antes de
   * escribirlo: con perfil PLANO a cota 739 y antenas a 0,475 m sobre 100 m,
   *
   *       relieveDb = 0,0000     nuReal = -0,384  →  «rozando»
   *
   * O sea que TODA PLANTA LLANA saldría rozando. Y no es un fallo del ν: a 100 m
   * el primer Fresnel mide 1,75 m y unas antenas a 0,475 m lo invaden de verdad.
   * Lo que pasa es que ESE suelo ya está cobrado: `dosRayosDb` supone un plano
   * reflectante debajo y modela su efecto entero. Es el mismo doble conteo que
   * el comentario del relieve lleva avisando en dB —21,66 dB medidos a 100 m— y
   * que por eso hace el relieve POR DIFERENCIA contra la tierra lisa.
   *
   * Así que el estado del relieve se lee de la MISMA magnitud que su dB, sobre
   * la misma curva J(ν) y en los MISMOS dos puntos de corte que los paneles:
   *
   *       relieve = 0            libre     (J(-0,78) = 0)
   *       0 < relieve <= J(0)    rozando   (J(0) = 6,0329 dB)
   *       relieve > J(0)         tapado
   *
   * El umbral NO se escribe: se pide, `RPV.perdidaFiloDb(0)`. Un 6,03 tecleado
   * aquí es una tercera copia de la curva esperando a separarse.
   *
   * ESTO ES UNA DERIVACION Y VA DICHO: el relieve es una RESTA de dos pérdidas
   * de difracción, no J(ν) de un filo suelto, así que leerlo en la curva es una
   * lectura razonada, no una identidad. Se declara aquí y en la leyenda.
   *
   * VEGETACION: hoy NUNCA se evalúa —`vegetacion.modelo` es `null` en
   * `radio_params.json`—, así que hoy NINGUN enlace está completo. Eso no se
   * disimula: sale en `sinMirar` y se cuenta en la leyenda.
   *
   * `estado: null` es «no se ha podido mirar ninguno», que no es un veredicto. */
  function estadoDelEnlace(detPan, relieveDb, relieveDet, veg, motivos) {
    var sinMirar = [], partes = {};

    partes.paneles = { estado: RPV.estadoDeNu(detPan ? detPan.nuMax : null),
                       nu: detPan ? detPan.nuMax : null };

    var corte = RPV.perdidaFiloDb(0);
    if (relieveDb == null) {
      partes.relieve = { estado: null, db: null, nuReal: relieveDet ? relieveDet.nuReal : null };
      sinMirar.push("relieve");
    } else if (hayMotivo(motivos, "relieve_dem_sin_resolucion")) {
      /* el DEM da un relieve INVENTADO a vano corto —hasta 9,89 dB medidos
         donde el verdadero es 0,00—, así que ese 0 no es un veredicto */
      partes.relieve = { estado: null, db: relieveDb, nuReal: relieveDet ? relieveDet.nuReal : null };
      sinMirar.push("relieve");
    } else {
      partes.relieve = { estado: relieveDb <= 0 ? "libre" : (relieveDb <= corte ? "rozando" : "tapado"),
                         db: relieveDb, nuReal: relieveDet ? relieveDet.nuReal : null };
    }

    if (veg == null) { partes.vegetacion = { estado: null, db: null }; sinMirar.push("vegetacion"); }
    else partes.vegetacion = { estado: veg <= 0 ? "libre" : (veg <= corte ? "rozando" : "tapado"), db: veg };

    var peor = RPV.peorEstado([partes.paneles.estado, partes.relieve.estado, partes.vegetacion.estado]);
    return { estado: peor, completo: sinMirar.length === 0, sinMirar: sinMirar,
             corteDb: corte, partes: partes };
  }
  function hayMotivo(motivos, pre) {
    for (var i = 0; i < motivos.length; i++) if (motivos[i].indexOf(pre) === 0) return true;
    return false;
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

  /* ══ LA PROCEDENCIA, ROTULADA SIEMPRE ════════════════════════════════════
   *
   * «Etiqueta de procedencia siempre visible». Hasta hoy el motor SI sabía con
   * qué estaba calculando —`modo` va en cada salida desde la fase 2— y la
   * pantalla no lo enseñaba en ningún sitio: el mapa pintaba las mismas cinco
   * bandas de color con parámetros calibrados y sin ellos.
   *
   * LA CLASE SALE DEL JSON, NO DE AQUI. Cada valor de `radio_params.json` lleva
   * `procedencia` con un vocabulario cerrado (ver su bloque `_procedencias`).
   * Esta función no interpreta prosa: lee la clase, y un valor que tenga
   * `valor` y no tenga `procedencia` NO se salta —sale como desconocida, con su
   * ruta—, que es lo que impide que un parámetro nuevo entre sin rotular.
   *
   * MANDA EL MAS DEBIL. Un balance con trece valores de datasheet y uno copiado
   * del código de hace dos años vale lo que el copiado. Promediar procedencias
   * es exactamente el defecto de los agregados: un número correcto calculado
   * sobre la población equivocada.
   *
   * `sigma_db` y `vegetacion.modelo` NO entran en esta cuenta aunque estén
   * pendientes: no participan en el margen —uno da la probabilidad y el otro su
   * propio término— y ya salen con motivo propio. Meterlos aquí dejaría el
   * rótulo clavado en NO DISPONIBLE y taparía el estado real del resto. */
  var ORDEN_PROC = ["medido", "calibrado", "plano", "datasheet", "norma",
                    "declarado", "heredado", "pendiente"];
  var ROTULO_PROC = { medido: "MEDIDO", calibrado: "CALIBRADO", plano: "TEÓRICO",
                      datasheet: "TEÓRICO", norma: "TEÓRICO",
                      declarado: "SIN VERIFICAR", heredado: "SIN VERIFICAR",
                      pendiente: "NO DISPONIBLE" };

  function procedencia(params, variante, calib) {
    if (!params) return { nivel: null, rotulo: "PROCEDENCIA DESCONOCIDA",
                          peor: [], sinRotular: [], campana: null,
                          avisos: ["los parámetros de radio no están cargados"] };
    var vistos = [], sinRotular = [];
    function mira(ruta, o) {
      if (o == null) return;
      if (typeof o !== "object") return;
      if (o.procedencia) { vistos.push({ ruta: ruta, clase: o.procedencia }); return; }
      /* un valor declarado y sin clase: se DICE, no se da por bueno */
      if (Object.prototype.hasOwnProperty.call(o, "valor")) sinRotular.push(ruta);
    }
    var G = params.geometria || {};
    mira("geometria.eje_tubo_m", G.eje_tubo_m);
    mira("geometria.cuerda_m_defecto", G.cuerda_m_defecto);
    mira("geometria.campo_cercano_lambdas", G.campo_cercano_lambdas);
    mira("geometria.patron_antena", G.patron_antena);
    if (G.antena_tcu) {
      mira("geometria.antena_tcu.radio_ancla_m", G.antena_tcu.radio_ancla_m);
      mira("geometria.antena_tcu.coax_caida_m", G.antena_tcu.coax_caida_m);
    }
    var P = params.propagacion || {};
    mira("propagacion.eps_r_suelo", P.eps_r_suelo);
    mira("propagacion.sigma_suelo_s_m", P.sigma_suelo_s_m);
    mira("propagacion.polarizacion", P.polarizacion);
    if (variante) {
      if (variante.procedencia) vistos.push({ ruta: "tecnologias." + (variante.nombre || "?"), clase: variante.procedencia });
      else sinRotular.push("tecnologias." + (variante.nombre || "?"));
    }

    var avisos = [];
    if (variante && (variante.canal == null || variante.canal.valor == null))
      avisos.push("canal desconocido: la potencia declarada es COTA SUPERIOR, con hasta 16 dB de recorrido");
    if (P.sigma_db == null || P.sigma_db.valor == null || (typeof P.sigma_db === "number" ? false : P.sigma_db.valor == null))
      avisos.push("sigma sin calibrar: no hay probabilidad de enlace");
    if (params.vegetacion && params.vegetacion.modelo && params.vegetacion.modelo.valor == null)
      avisos.push("vegetación no modelada: el follaje no entra en el balance");

    var peorI = -1;
    for (var i = 0; i < vistos.length; i++) {
      var k = ORDEN_PROC.indexOf(vistos[i].clase);
      if (k < 0) { sinRotular.push(vistos[i].ruta + " (clase «" + vistos[i].clase + "» fuera del vocabulario)"); continue; }
      if (k > peorI) peorI = k;
    }
    if (sinRotular.length || peorI < 0) {
      return { nivel: null, rotulo: "PROCEDENCIA DESCONOCIDA", peor: [],
               sinRotular: sinRotular, campana: null,
               avisos: avisos.concat(["hay " + sinRotular.length + " valor(es) sin `procedencia` en radio_params.json"]) };
    }
    var nivel = ORDEN_PROC[peorI];
    var peor = [];
    for (var j = 0; j < vistos.length; j++) if (vistos[j].clase === nivel) peor.push(vistos[j]);
    var c = correcciones(calib);
    return { nivel: nivel, rotulo: ROTULO_PROC[nivel], peor: peor, sinRotular: [],
             campana: c.modo === CALIBRADO ? c.campana : null, avisos: avisos };
  }

  /* ¿ES VIABLE? Un enlace es viable si su margen llega al umbral. Sin margen
     —sin sensibilidad— la respuesta NO es `false`: es `null`, «no se sabe», y
     quien lo consuma tiene que decidir qué hacer con eso en vez de tratarlo
     como un enlace muerto. */
  function viable(p, umbralDb) {
    if (p.margenDb == null) return null;
    return p.margenDb >= (umbralDb == null ? 0 : umbralDb);
  }

  /* ═══ EL CENSO DE MOTIVOS ══════════════════════════════════════════════════
   *
   * ESTO EXISTE POR UN DEFECTO QUE ESTUVO UN MES A LA VISTA SIN VERSE.
   *
   * `recortaPerfil` rechazaba 568 de 6.036 enlaces —el 9,4 %— por un déficit de
   * 2,13e-13 m, y esos enlaces salían con el motivo
   * `relieve_perfil_no_cubre_el_vano`, o sea SIN término de relieve, con el
   * terreno delante. El motivo estaba ahí, en cada enlace, desde el primer día.
   * Lo que NO había era nadie que los contara.
   *
   * Un 9,4 % en «no cubre el vano» impreso al pie del informe de #87 habría
   * saltado a la vista. Un motivo por enlace que nadie agrega es un dato que
   * existe y no se lee.
   *
   * Así que esto cuenta, y quien publique un informe o pinte un mapa lo
   * publica. Devuelve `{ n, motivos: {clave: cuenta}, conMargen, sinMargen }`.
   *
   * Y SE DEVUELVE TAMBIÉN `n`, no sólo el mapa: sin el total, «312 sin perfil»
   * no dice si es de 400 enlaces o de 40.000. Un recuento sin denominador es
   * la misma media que este repo lleva toda la fase quitando. */
  function censoMotivos(presupuestos) {
    var out = { n: 0, motivos: {}, conMargen: 0, sinMargen: 0 };
    if (!presupuestos || !presupuestos.length) return out;
    for (var i = 0; i < presupuestos.length; i++) {
      var p = presupuestos[i];
      if (!p) continue;
      out.n++;
      if (p.margenDb == null) out.sinMargen++; else out.conMargen++;
      var ms = p.motivos || [];
      for (var j = 0; j < ms.length; j++) out.motivos[ms[j]] = (out.motivos[ms[j]] || 0) + 1;
    }
    return out;
  }

  /* El censo en una línea, ordenado de más a menos y CON PORCENTAJE. El
     porcentaje es lo que convierte «568» en «9,4 %», que es el número que
     habría hecho saltar a alguien. */
  function censoTexto(censo, soloPrefijo) {
    if (!censo || !censo.n) return "sin enlaces";
    var pares = [];
    for (var k in censo.motivos) {
      if (!Object.prototype.hasOwnProperty.call(censo.motivos, k)) continue;
      if (soloPrefijo && k.indexOf(soloPrefijo) !== 0) continue;
      pares.push([k, censo.motivos[k]]);
    }
    if (!pares.length) return "ningun motivo (de " + censo.n + " enlaces)";
    pares.sort(function (a, b) { return b[1] - a[1]; });
    var t = [];
    for (var i = 0; i < pares.length; i++) {
      t.push(pares[i][0] + " " + pares[i][1] + " (" + (100 * pares[i][1] / censo.n).toFixed(1) + " %)");
    }
    return t.join(" · ") + "   [de " + censo.n + " enlaces]";
  }

  var RadioZigbee = {
    TEORICO: TEORICO, CALIBRADO: CALIBRADO,
    correcciones: correcciones, cuenta: cuenta, presupuesto: presupuesto,
    viable: viable, erf: erf, phi: phi, estadoDelEnlace: estadoDelEnlace,
    procedencia: procedencia, ORDEN_PROC: ORDEN_PROC, ROTULO_PROC: ROTULO_PROC,
    censoMotivos: censoMotivos, censoTexto: censoTexto
  };
  raiz.RadioZigbee = RadioZigbee;
  if (typeof module !== "undefined" && module.exports) module.exports = RadioZigbee;
})(typeof window !== "undefined" ? window : globalThis);
