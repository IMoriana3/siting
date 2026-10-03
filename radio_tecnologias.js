/* radio_tecnologias.js — EL COMPARADOR POR CRITERIO. Punto 6 de la fase 4.
 *
 * ═══ LA REGLA QUE DA FORMA A TODO ESTE FICHERO ═══
 *
 * NO HAY ÍNDICE ÚNICO. Ni puntuación, ni ranking, ni «LoRa 7,4 / Zigbee 8,1».
 * Una tabla por criterio, y donde la incertidumbre tape la diferencia se dice
 * «no distinguible con lo medido». Un número agregado esconde de qué está
 * hecho, y esconder de qué está hecho un número es el defecto que esta fase
 * lleva entera quitando: el sesgo que no se reproducía, la `p` que valía 100 %
 * siempre, el mapa pintado con el motor viejo.
 *
 * Hay una puerta que lo vigila: el banco comprueba que la salida NO trae ningún
 * campo que agregue criterios. Si alguien añade un `puntuacion` más adelante,
 * se entera.
 *
 * ═══ LA SEGUNDA REGLA: UN HUECO NO SE RELLENA ═══
 *
 * Cada criterio DECLARA qué parámetros necesita. Si a una tecnología le falta
 * uno, ese criterio sale con `valor: null` y el motivo diciendo QUÉ falta y DE
 * QUÉ DOCUMENTO sale. Nunca un número con un valor por defecto: eso convierte
 * «no lo sé» en «lo he calculado», que es la avería que `radio_params.json`
 * existe para impedir.
 *
 * Hoy, con los parámetros que hay, esto significa que LoRa y Wi-SUN salen
 * apagadas en todo lo que es balance. Es el estado real, no una carencia de
 * este fichero.
 *
 * ═══ LA TERCERA: A VARIAS HORAS, NO A UNA ═══
 *
 * El ángulo de las mesas mueve el margen hasta 27,8 dB (medido en el punto 2).
 * Comparar tecnologías a una hora fija no compara tecnologías: compara horas.
 * Así que cada criterio que dependa de la radio se evalúa a VARIAS horas y se
 * publica su recorrido [min, max], y la comparación usa el recorrido — no el
 * punto medio, que volvería a esconder la variación.
 *
 * ═══ QUÉ NO HACE ═══
 *
 * No sabe de radio. Recibe `enlazaDe(variante, hora)`, que devuelve la función
 * `enlaza(a, b)` que pide `radio_malla.js`. Misma disciplina que la malla: así
 * el comparador sirve igual para Zigbee, LoRa o lo que venga, y no hay una
 * segunda copia de la física esperando a quedarse vieja.
 */
(function (raiz) {
  "use strict";

  var RM = (raiz && raiz.RadioMalla) ? raiz.RadioMalla
         : (typeof require === "function" ? require("./radio_malla.js") : null);
  if (!RM) throw new Error("radio_tecnologias: falta `radio_malla.js`.");

  /* ── LA CELDA ────────────────────────────────────────────────────────────
   * Siempre la misma forma, tenga valor o no. `valor === null` es «no se puede
   * calcular» y SIEMPRE lleva motivo; el que la pinte no tiene que adivinar si
   * un hueco es un cero. */
  function celda(valor, unidad, procedencia, extra) {
    var c = { valor: valor, unidad: unidad || null, procedencia: procedencia || null,
              motivo: null, min: null, max: null };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) c[k] = extra[k];
    return c;
  }
  function falta(motivo, unidad) {
    return celda(null, unidad || null, "pendiente", { motivo: motivo });
  }

  /* ── EL LÍMITE RADIADO, Y LA TRAMPA DE LA UNIDAD ──────────────────────────
   *
   * LAS DOS NORMAS NO DAN LA POTENCIA EN LA MISMA UNIDAD, y eso no es un
   * detalle de formato:
   *
   *     EN 300 328   (2,4 GHz)   20 dBm   e.i.r.p.   referida a la ISOTRÓPICA
   *     EN 300 220-2 (868 MHz)   25 mW    e.r.p.     referida al DIPOLO
   *
   * Un dipolo de media onda tiene 2,15 dBi sobre la isotrópica, así que
   *
   *     e.i.r.p. = e.r.p. + 2,15 dB
   *
   * Y ESO ES JUSTO LO QUE ESTE CRITERIO PEDÍA MAL. El campo que exigía se
   * llamaba `erp_max_dbm`: meter ahí los 20 dBm e.i.r.p. de la EN 300 328
   * junto a los 14 dBm e.r.p. de la EN 300 220 habría comparado isotrópica
   * contra dipolo — 2,15 dB de error, callado, en la fila que dice si algo es
   * legal. Es la misma avería que el `slice(-n)` de la tabla: un número que
   * parece bien y está mal.
   *
   * Aquí se normaliza todo a e.i.r.p. y la conversión va rotulada en la celda.
   *
   * LOS 2,15 dB NO SALEN DE NINGUNA DE LAS DOS NORMAS: son la ganancia del
   * dipolo de media onda, que es una definición, no una lectura. Va dicho
   * porque todo lo demás de este fichero sí sale de un documento citado. */
  var DIPOLO_DBI = 2.15;

  /* El límite aplicable, en e.i.r.p., o `null` si no se puede establecer. */
  function limiteEirp(variante) {
    var r = variante && variante.regimen_regulatorio_eu;
    if (r && r.potencia_max_dbm_eirp != null) {
      var cita = r._potencia_cita || {};
      return { dbm: r.potencia_max_dbm_eirp, unidad_leida: "e.i.r.p.",
               convertido: false, norma: cita.documento || null,
               clausula: cita.clausula || null };
    }
    var c = variante && variante.ciclo_trabajo_eu;
    if (c && c.sub_bandas && variante.f_hz != null) {
      var f = variante.f_hz, elegida = null;
      for (var i = 0; i < c.sub_bandas.length; i++) {
        var b = c.sub_bandas[i];
        if (!b.rango_hz || b.erp_max_mw == null) continue;
        if (f < b.rango_hz[0] || f > b.rango_hz[1]) continue;
        /* VARIAS SUB-BANDAS SOLAPAN: P y Q comparten 869,7-870,0 MHz con 5 y
           25 mW. Se coge LA MÁS RESTRICTIVA. Quedarse con la generosa sería
           elegir el límite que más conviene, que no es leer una norma. */
        if (elegida == null || b.erp_max_mw < elegida.erp_max_mw) elegida = b;
      }
      if (elegida) {
        var erpDbm = 10 * Math.log(elegida.erp_max_mw) / Math.LN10;
        return { dbm: erpDbm + DIPOLO_DBI, unidad_leida: "e.r.p.",
                 convertido: true, erp_dbm: erpDbm, dipolo_dbi: DIPOLO_DBI,
                 sub_banda: elegida.banda, erp_max_mw: elegida.erp_max_mw,
                 norma: (elegida._cita && elegida._cita.documento) || null,
                 clausula: (elegida._cita && elegida._cita.clausula) || null };
      }
    }
    return null;
  }

  /* ¿Es legal el punto de trabajo declarado? Verdicto, no número: el criterio
     no se ordena de más a menos (`MEJOR_ES_MAS.legalidad` es `null`).
     DOS DERIVACIONES, las dos rotuladas en la celda:
       · la e.i.r.p. radiada se toma como `ptx_dbm + gtx_dbi`. NO modela
         pérdidas de cable ni de conector, que RESTARÍAN: así que es una COTA
         SUPERIOR de lo radiado, o sea el lado conservador para decir «cumple».
       · el límite de 868 llega en e.r.p. y se convierte con los 2,15 dB. */
  function legalidadDe(variante) {
    var lim = limiteEirp(variante);
    if (!lim) {
      return falta("el régimen está en el fichero pero no da un límite de " +
                   "potencia aplicable a `f_hz` — ver `regimen_regulatorio_eu` " +
                   "o `ciclo_trabajo_eu` de esta variante", null);
    }
    var eirp = variante.ptx_dbm + variante.gtx_dbi;
    var margen = lim.dbm - eirp;
    var cumple = margen >= 0;
    return celda(cumple ? "cumple" : "NO CUMPLE", null, "derivado", {
      min: cumple ? "cumple" : "NO CUMPLE",
      max: cumple ? "cumple" : "NO CUMPLE",
      eirp_declarada_dbm: eirp,
      limite_eirp_dbm: lim.dbm,
      margen_db: margen,
      canal: valorDe(variante, "canal.valor"),
      norma: lim.norma,
      clausula: lim.clausula,
      _eirp_es_derivada: "ptx_dbm + gtx_dbi, SIN pérdidas de cable ni conector: " +
                         "cota superior de lo radiado.",
      _limite_convertido: lim.convertido
        ? ("la norma da " + lim.erp_max_mw + " mW e.r.p. (" +
           lim.erp_dbm.toFixed(2) + " dBm) en la sub-banda " + lim.sub_banda +
           "; +" + lim.dipolo_dbi + " dB de dipolo para pasarlo a e.i.r.p.")
        : "la norma ya lo da en e.i.r.p.; no se convierte nada",
      motivo: null
    });
  }

  /* ── QUÉ NECESITA CADA CRITERIO ──────────────────────────────────────────
   * Declarado aquí y en un solo sitio. Si un criterio nuevo se olvida de
   * declarar lo suyo, no puede salir: `EXIGE[criterio]` sería `undefined` y el
   * comparador lo dice en vez de calcularlo a ciegas. */
  var BALANCE = ["f_hz", "ptx_dbm", "gtx_dbi", "grx_dbi", "rx_sens_dbm"];
  var EXIGE = {
    tcu_cubiertas:       BALANCE,
    tcu_sin_alternativa: BALANCE,
    ncu_necesarias:      BALANCE,
    saltos_max:          BALANCE,
    saltos_mediano:      BALANCE,
    /* `t_salto_s` NO LO TIENE NINGUNA DE LAS TRES, y es el que decide el
       ranking entero. `FASE3_LATENCIA_STOW.md` §2.3: «NO MEDIDO — el tiempo por
       salto […] ningún .ps1 de campo, ningún útil y ningún banco de esta
       cartera instrumenta un round-trip». Va declarado para que la tabla diga
       que falta, en vez de callarse el criterio más importante. */
    latencia_stow:       BALANCE.concat(["t_salto_s"]),
    /* DOS TASAS, Y HACEN FALTA LAS DOS. `tasa_bps` es la capacidad de la RADIO
       —lo único comparable entre tecnologías, que es para lo que existe el
       campo— y `tasa_serie_bps` es el puerto serie Modbus de la TCU, un límite
       DEL SISTEMA que no se mueve al cambiar de radio. Sin la segunda, este
       criterio publicaría una ocupación de radio que el serie no deja alcanzar:
       un número correcto sobre una pregunta que no es la que importa. */
    telemetria:          ["tasa_bps", "tasa_serie_bps", "carga_util_b", "periodo_s"],
    /* LEGALIDAD. Esto pedía `norma`, `erp_max_dbm` y `ciclo_trabajo`, tres
       campos que NO EXISTEN en `radio_params.json` y que nunca han existido:
       la fila decía «no se puede» por un nombre equivocado, no por un hueco.
       Y el criterio tampoco se calculaba en ninguna parte — sólo declaraba qué
       necesitaría. Corregido el 2026-10-03.

       Lo que de verdad hace falta para decir si un punto de trabajo es legal:

         regimen_eu   la norma y su límite — ya está en el fichero, bajo
                      `regimen_regulatorio_eu` (2,4 GHz) o `ciclo_trabajo_eu`
                      (868 MHz); ver ALTERNATIVAS
         ptx_dbm      la potencia conducida del equipo
         gtx_dbi      la ganancia de la antena, que entra en la radiada
         canal.valor  EL CANAL, y no es un adorno: el comentario del modelo
                      congelado dice «Canal 26: máx +3» frente a los +19
                      declarados. DIECISÉIS dB de diferencia según el canal,
                      así que sin canal no hay límite que comparar. Ese dato
                      sale del bloque 8a (`zigbee_inventario.ps1`), no de aquí.

       O sea que la fila sigue diciendo «no se puede» para Zigbee — pero ahora
       NOMBRA el canal, que es el bloqueo de verdad, en vez de un campo que no
       existe. Una puerta tiene que decir qué le falta, no que le falta algo. */
    legalidad:           ["regimen_eu", "ptx_dbm", "gtx_dbi", "canal.valor"]
  };

  var UNIDAD = {
    tcu_cubiertas: "TCU", tcu_sin_alternativa: "TCU", ncu_necesarias: "NCU",
    saltos_max: "saltos", saltos_mediano: "saltos", latencia_stow: "s",
    telemetria: "% del puerto, por UNA TCU", legalidad: null
  };

  var ROTULO = {
    tcu_cubiertas: "TCU cubiertas",
    tcu_sin_alternativa: "TCU sin camino alternativo",
    ncu_necesarias: "NCU o gateways necesarios",
    saltos_max: "saltos, máximo",
    saltos_mediano: "saltos, mediano",
    latencia_stow: "latencia de la orden de stow hasta la ÚLTIMA TCU",
    telemetria: "capacidad de telemetría usada",
    legalidad: "legalidad en España"
  };

  /* Lee una ruta con puntos: `canal.valor` baja dos niveles. HACE FALTA, y no
     es comodidad: `canal` es un OBJETO cuyo `valor` puede ser `null`, así que
     mirar sólo `variante.canal` daba «está puesto» con el canal sin saber. Un
     hueco envuelto en un objeto es un hueco. */
  function valorDe(variante, ruta) {
    if (!variante) return null;
    var partes = String(ruta).split("."), v = variante;
    for (var i = 0; i < partes.length; i++) {
      if (v == null) return null;
      v = v[partes[i]];
    }
    return v == null ? null : v;
  }

  /* UN REQUISITO QUE SE CUMPLE CON CUALQUIERA DE VARIAS RUTAS. El régimen
     regulatorio vive bajo nombres distintos según la banda porque SON NORMAS
     DISTINTAS: a 2,4 GHz la EN 300 328 (`regimen_regulatorio_eu`) y a 868 MHz
     la EN 300 220 (`ciclo_trabajo_eu`). No se unifican en una sola clave
     porque unificar el nombre insinuaría que es el mismo requisito, y no lo
     es: ni la ventana de observación ni la unidad de potencia coinciden. */
  var ALTERNATIVAS = {
    regimen_eu: ["regimen_regulatorio_eu", "ciclo_trabajo_eu"]
  };

  /* Qué parámetros de una variante están puestos. `null` y `undefined` cuentan
     igual: no está. Un 0 SÍ cuenta —0 dBm es una potencia— y por eso se mira
     `== null` y no la veracidad. */
  function loQueFalta(variante, criterio) {
    var exige = EXIGE[criterio];
    if (!exige) return ["el criterio «" + criterio + "» no declara qué necesita"];
    var f = [];
    for (var i = 0; i < exige.length; i++) {
      var req = exige[i], rutas = ALTERNATIVAS[req] || [req], hay = false;
      for (var j = 0; j < rutas.length; j++) {
        if (valorDe(variante, rutas[j]) != null) { hay = true; break; }
      }
      if (!hay) f.push(req);
    }
    return f;
  }

  function mediana(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ── UNA TECNOLOGÍA, EN UNA PLANTA, A VARIAS HORAS ───────────────────────
   * `enlazaDe(variante, hora)` devuelve la función que pide la malla, o `null`
   * si a esa hora no se puede evaluar. `raices` son las NCU declaradas del
   * layout: NO se inventan posiciones de gateway — si una tecnología pidiera
   * otras, eso es un estudio de implantación y no cabe en esta tabla. */
  function unaTecnologia(nodos, raices, variante, horas, enlazaDe, alcanceMax) {
    var out = {};
    var claves = Object.keys(EXIGE);
    for (var c = 0; c < claves.length; c++) {
      var k = claves[c], f = loQueFalta(variante, k);
      if (f.length) {
        out[k] = falta("falta " + f.join(", ") + " — ver `_que_falta` de esta " +
                       "variante en radio_params.json", UNIDAD[k]);
      }
    }

    /* Si el balance no se puede hacer, no se corre la malla: correrla con
       huecos daría una malla, y una malla es un resultado con pinta de bueno. */
    if (out.tcu_cubiertas) return out;

    var porHora = [];
    for (var h = 0; h < horas.length; h++) {
      var enlaza = enlazaDe(variante, horas[h]);
      if (!enlaza) continue;
      var a = RM.analiza(nodos, enlaza, raices, alcanceMax);
      var ds = [];
      a.saltos.forEach(function (v, k2) { if (v !== null && raices.indexOf(k2) < 0) ds.push(v); });
      porHora.push({
        hora: horas[h],
        cubiertas: nodos.length - raices.length - a.sinRuta.length,
        sinAlternativa: (a.sinAlternativa || []).length,
        saltosMax: ds.length ? Math.max.apply(null, ds) : null,
        saltosMed: mediana(ds),
        esArbol: a.esArbol, desconocidos: a.desconocidos.length
      });
    }

    if (!porHora.length) {
      var m = falta("no se ha podido evaluar a ninguna de las horas pedidas");
      out.tcu_cubiertas = m; out.tcu_sin_alternativa = m;
      out.saltos_max = m; out.saltos_mediano = m; out.ncu_necesarias = m;
      return out;
    }

    function recorrido(campo, unidad) {
      var xs = porHora.map(function (p) { return p[campo]; }).filter(function (x) { return x != null; });
      if (!xs.length) return falta("ninguna hora ha dado valor", unidad);
      var mn = Math.min.apply(null, xs), mx = Math.max.apply(null, xs);
      return celda(mn === mx ? mn : null, unidad, "predicho",
                   { min: mn, max: mx, horas: xs.length,
                     motivo: mn === mx ? null : "varía con la hora: el valor único no existe" });
    }

    out.tcu_cubiertas = recorrido("cubiertas", UNIDAD.tcu_cubiertas);
    out.tcu_sin_alternativa = recorrido("sinAlternativa", UNIDAD.tcu_sin_alternativa);
    out.saltos_max = recorrido("saltosMax", UNIDAD.saltos_max);
    out.saltos_mediano = recorrido("saltosMed", UNIDAD.saltos_mediano);
    /* Las NCU NO SE CALCULAN: son las del layout, que es el documento. Decir
       «harían falta N» es un estudio de implantación, no una lectura. */
    out.ncu_necesarias = celda(raices.length, UNIDAD.ncu_necesarias, "plano",
                               { min: raices.length, max: raices.length,
                                 motivo: "las declaradas en el layout; este comparador NO propone otras" });
    /* ── TELEMETRÍA: cuánta de la capacidad disponible se lleva el sondeo ───
     * Y LO QUE DE VERDAD APORTA, que no es el porcentaje: DECIR CUÁL MANDA.
     * El enlace tiene dos estrangulamientos en serie —la radio y el puerto
     * serie Modbus de la TCU— y manda el más lento. Si manda el serie, este
     * número NO CAMBIA al cambiar de tecnología, así que comparar radios aquí
     * no decide nada; y eso es un resultado, no un empate.
     *
     * Publicarlo sólo contra la radio sería peor que no publicarlo: daría tres
     * columnas distintas sugiriendo que la elección mueve algo que no mueve. */
    if (!out.telemetria) {
      var rf = variante.tasa_bps, ser = variante.tasa_serie_bps;
      var manda = (ser < rf) ? "serie" : "radio";
      var tasaEf = Math.min(rf, ser);
      var pct = 100 * (variante.carga_util_b * 8) / (variante.periodo_s * tasaEf);
      /* ES POR UNA TCU, Y ESO HAY QUE DECIRLO. El dato de partida —44 B cada
         30 s— es de UNA TCU, así que el porcentaje también. La cifra que de
         verdad interesa es la del PUERTO, con todas las TCU que cuelgan de esa
         NCU compartiéndolo; y ésa no se publica aquí porque este comparador NO
         sabe cuántas TCU cuelga cada NCU: sabe cuántas hay y cuántas NCU, no el
         reparto. Repartirlas a partes iguales sería inventarse la asignación.
         Un «0,06 %» sin el «por TCU» al lado se lee como holgura enorme, y con
         145 TCU en un puerto la cuenta es otra. */
      var motivoCuello = manda === "serie"
        ? "EL CUELLO ES EL PUERTO SERIE (" + ser + " b/s) y no la radio (" + rf +
          " b/s): este número no se mueve al cambiar de tecnología, así que aquí " +
          "la comparación entre radios NO decide nada."
        : null;
      out.telemetria = celda(pct, UNIDAD.telemetria, "predicho", {
        min: pct, max: pct, manda: manda, tasa_efectiva_bps: tasaEf,
        por: "una TCU",
        falta_para_el_puerto: "cuántas TCU cuelgan de cada NCU; este comparador no lo sabe y no lo reparte a ojo",
        motivo: motivoCuello
      });
    }

    /* LA LEGALIDAD, si no la ha tumbado ya el bucle de `EXIGE` por un hueco.
       Esto antes NO SE CALCULABA: el criterio declaraba qué necesitaba y nadie
       lo rellenaba nunca, así que la fila salía «no se puede» incluso con el
       dato delante. Y lo que declaraba necesitar —`norma`, `erp_max_dbm`,
       `ciclo_trabajo`— no existe en `radio_params.json`. Corregido el
       2026-10-03; ver el comentario de `EXIGE.legalidad`. */
    if (!out.legalidad) out.legalidad = legalidadDe(variante);

    out._porHora = porHora;
    /* SI LA MALLA ES UN ÁRBOL, «sin camino alternativo» no informa: en un árbol
       lo es todo el que cuelgue de alguien. Va dicho, como en `analiza()`. */
    if (porHora.every(function (p) { return p.esArbol; })) {
      out.tcu_sin_alternativa.motivo =
        "la malla sale ÁRBOL a todas las horas miradas: aquí este criterio no distingue nada";
    }
    return out;
  }

  /* ── EL VEREDICTO POR CRITERIO ───────────────────────────────────────────
   * Tres estados, y ninguno es una puntuación:
   *   no_comparable    a alguna tecnología le falta un dato
   *   no_distinguible  los recorridos se solapan: con lo medido, empatan
   *   gana             un recorrido queda entero por encima (o por debajo)
   *
   * `mejorEsMas` dice de qué lado está lo bueno. Y NO hay desempate: si se
   * solapan, se solapan. */
  var MEJOR_ES_MAS = { tcu_cubiertas: true, tcu_sin_alternativa: false,
                       ncu_necesarias: false, saltos_max: false,
                       saltos_mediano: false, latencia_stow: false,
                       telemetria: false, legalidad: null };

  function veredicto(criterio, porTec) {
    var nombres = Object.keys(porTec), vivos = [], sinDato = [];
    for (var i = 0; i < nombres.length; i++) {
      var c = porTec[nombres[i]];
      if (!c || c.min == null) sinDato.push(nombres[i]); else vivos.push(nombres[i]);
    }
    if (sinDato.length) {
      return { estado: "no_comparable",
               texto: "no comparable: sin dato en " + sinDato.join(", "),
               sinDato: sinDato };
    }
    if (vivos.length < 2) {
      return { estado: "no_comparable", texto: "no comparable: hace falta más de una tecnología con dato",
               sinDato: sinDato };
    }
    var mas = MEJOR_ES_MAS[criterio];
    if (mas == null) {
      return { estado: "no_comparable", texto: "no comparable: este criterio no se ordena en un número",
               sinDato: sinDato };
    }
    /* ¿Hay UNA cuyo recorrido entero sea mejor que el de TODAS las demás? */
    var mejor = null, empate = false;
    for (var a = 0; a < vivos.length; a++) {
      var ga = true;
      for (var b = 0; b < vivos.length; b++) {
        if (a === b) continue;
        var A = porTec[vivos[a]], B = porTec[vivos[b]];
        var domina = mas ? (A.min > B.max) : (A.max < B.min);
        if (!domina) { ga = false; break; }
      }
      if (ga) { mejor = vivos[a]; break; }
    }
    if (mejor) return { estado: "gana", texto: "gana " + mejor, gana: mejor, sinDato: sinDato };

    /* UN EMPATE CON CAUSA NO ES EL MISMO EMPATE. Si en TODAS las tecnologías
       vivas manda el puerto serie, estas columnas no empatan «por poco»:
       empatan porque el número que publican no depende de la radio. Decir
       «no distinguible» a secas invitaría a buscar el desempate donde no lo
       hay; decir por qué cierra la pregunta. */
    var porSerie = vivos.filter(function (n) { return porTec[n].manda === "serie"; });
    if (criterio === "telemetria" && porSerie.length === vivos.length) {
      return { estado: "no_distinguible", mandaElSerie: true, sinDato: sinDato,
               texto: "no distingue, y se sabe por qué: en las " + vivos.length +
                      " manda el PUERTO SERIE de la TCU (" + porTec[vivos[0]].tasa_efectiva_bps +
                      " b/s), no la radio. Cambiar de tecnología no mueve este número." };
    }

    empate = true;
    return { estado: "no_distinguible",
             texto: "no distinguible con lo medido: los recorridos se solapan",
             sinDato: sinDato };
  }

  /* ── LA TABLA ────────────────────────────────────────────────────────────── */
  function compara(planta, nodos, raices, variantes, horas, enlazaDe, alcanceMax) {
    if (!horas || horas.length < 2) {
      throw new Error("radio_tecnologias: hacen falta AL MENOS 2 horas. " +
                      "Comparar tecnologías a una hora fija no compara tecnologías: " +
                      "con hasta 27,8 dB de variación por la hora, compara horas.");
    }
    var nombres = Object.keys(variantes), porTec = {};
    for (var i = 0; i < nombres.length; i++) {
      porTec[nombres[i]] = unaTecnologia(nodos, raices, variantes[nombres[i]],
                                         horas, enlazaDe, alcanceMax);
    }
    var filas = Object.keys(EXIGE).map(function (k) {
      var fila = { criterio: k, rotulo: ROTULO[k], unidad: UNIDAD[k], celdas: {} };
      for (var j = 0; j < nombres.length; j++) fila.celdas[nombres[j]] = porTec[nombres[j]][k];
      fila.veredicto = veredicto(k, fila.celdas);
      return fila;
    });
    /* ── LA HORA, Y POR QUÉ ESTA TABLA NO SE ENTERA ─────────────────────────
     * Si NINGÚN criterio varía entre las horas miradas, la lectura fácil es «la
     * hora da igual». ES FALSA, y la medida lo dice: en El Burgo, entre la mejor
     * y la peor hora entran y salen 1.086 pares de enlace, el 8,1 % de los
     * viables. La hora SÍ mueve enlaces.
     *
     * Lo que pasa es que estos criterios están SATURADOS: con ~12.000 enlaces
     * viables sobre 215 TCU el grafo sigue denso a cualquier hora, así que la
     * cobertura y los saltos no se enteran. Son dos cosas distintas y la tabla
     * tiene que llevar la diferencia encima, no en una nota al pie.
     *
     * Y ESTO CAMBIA EN CUANTO ENTREN LORA Y WI-SUN: a 868 MHz el radio de
     * Fresnel es ~1,7 veces el de 2,45 GHz —la misma geometría despeja menos— y
     * el balance es otro. Con menos margen los criterios dejan de estar
     * saturados, empiezan a separar, y entonces la hora importará también aquí. */
    var conDato = [], varia = false;
    for (var q = 0; q < filas.length; q++) {
      for (var w = 0; w < nombres.length; w++) {
        var cc = filas[q].celdas[nombres[w]];
        if (!cc || cc.min == null) continue;
        if (conDato.indexOf(nombres[w]) < 0) conDato.push(nombres[w]);
        if (cc.min !== cc.max) varia = true;
      }
    }
    var satur = conDato.length && !varia;
    return {
      planta: planta, horas: horas, tecnologias: nombres, filas: filas,
      saturacion: {
        saturada: !!satur,
        conDato: conDato,
        texto: satur
          ? "NINGÚN criterio varía entre las " + horas.length + " horas miradas, y eso NO " +
            "significa que la hora dé igual: significa que estos criterios están SATURADOS " +
            "con la tecnología que sí tiene datos. Medido en El Burgo: entre la mejor y la " +
            "peor hora entran y salen 1.086 pares de enlace, el 8,1 % de los viables. " +
            "Cuando entren LoRa y Wi-SUN —menos margen, y a 868 MHz el radio de Fresnel es " +
            "~1,7 veces mayor— estos criterios dejarán de estar saturados y la hora " +
            "importará también en esta tabla."
          : (conDato.length
              ? "Hay criterios que varían con la hora: el recorrido [min–max] es el resultado, " +
                "no su punto medio."
              : "No hay ninguna tecnología con datos suficientes para saber si la hora mueve algo.")
      },
      /* A PROPÓSITO NO HAY AQUÍ NINGÚN TOTAL. Ver la cabecera. */
      _sin_indice_unico: "no hay puntuación agregada, y el banco lo comprueba"
    };
  }

  /* ── LA SENSIBILIDAD DEL VEREDICTO AL MÓDULO ─────────────────────────────
   *
   * La elección del módulo NO es un detalle de implementación: cambia el
   * veredicto. Un SX1262 a 22 dBm y un módulo a 14 dBm no dan el mismo
   * resultado, y presentar «LoRa» como si fuera una cosa esconde ocho dB.
   *
   * Así que la comparación se corre DOS VECES —con el mejor candidato de cada
   * tecnología y con el peor— y se publica en qué criterios el veredicto
   * CAMBIA. Si cambia, eso ES el resultado: la respuesta no es «gana X», es
   * «depende de qué módulo se monte, y aquí está de cuál».
   *
   * `candidatos[tec]` es una lista de variantes, una por módulo. Con cero o un
   * candidato no hay sensibilidad que medir y se dice, que no es lo mismo que
   * decir que no la hay.
   *
   * EL ORDEN entre candidatos es por PRESUPUESTO DE ENLACE —ptx + ganancias −
   * sensibilidad—, que es lo que mueve la cobertura. No es el único eje (el
   * consumo y la certificación también deciden), pero es el único que este
   * comparador sabe calcular, y por eso se dice cuál usa. */
  function presupuesto(v) {
    var xs = ["ptx_dbm", "gtx_dbi", "grx_dbi"], s = 0;
    for (var i = 0; i < xs.length; i++) { if (v[xs[i]] == null) return null; s += v[xs[i]]; }
    if (v.rx_sens_dbm == null) return null;
    return s - v.rx_sens_dbm;
  }

  function extremos(lista) {
    var conP = lista.map(function (v) { return { v: v, p: presupuesto(v) }; })
                    .filter(function (x) { return x.p != null; });
    if (!conP.length) return null;
    conP.sort(function (a, b) { return a.p - b.p; });
    return { peor: conP[0].v, mejor: conP[conP.length - 1].v,
             peorDb: conP[0].p, mejorDb: conP[conP.length - 1].p, n: conP.length };
  }

  function sensibilidadAlModulo(planta, nodos, raices, candidatos, horas, enlazaDe, alcanceMax) {
    var tecs = Object.keys(candidatos), ext = {}, sinExtremos = [];
    for (var i = 0; i < tecs.length; i++) {
      var e = extremos(candidatos[tecs[i]] || []);
      if (!e || e.n < 2) { sinExtremos.push(tecs[i]); }
      ext[tecs[i]] = e;
    }
    if (sinExtremos.length === tecs.length) {
      return { medible: false,
               motivo: "ninguna tecnología tiene DOS candidatos con presupuesto " +
                       "calculable: sin dos módulos no hay sensibilidad que medir, y eso " +
                       "no es lo mismo que decir que el veredicto no depende del módulo",
               sinExtremos: sinExtremos, filas: [] };
    }
    function corner(cual) {
      var vs = {};
      for (var j = 0; j < tecs.length; j++) {
        var e2 = ext[tecs[j]];
        vs[tecs[j]] = e2 ? e2[cual] : (candidatos[tecs[j]] || [])[0] || {};
      }
      return compara(planta, nodos, raices, vs, horas, enlazaDe, alcanceMax);
    }
    var conMejor = corner("mejor"), conPeor = corner("peor");
    var filas = conMejor.filas.map(function (f, k) {
      var g = conPeor.filas[k];
      var cambia = f.veredicto.estado !== g.veredicto.estado ||
                   f.veredicto.gana !== g.veredicto.gana;
      return { criterio: f.criterio, rotulo: f.rotulo,
               conElMejor: f.veredicto.texto, conElPeor: g.veredicto.texto,
               cambia: cambia };
    });
    return { medible: true, planta: planta, tecnologias: tecs, extremos: ext,
             filas: filas,
             cambiaAlguno: filas.some(function (f) { return f.cambia; }),
             _orden: "los candidatos se ordenan por presupuesto de enlace " +
                     "(ptx + ganancias − sensibilidad); el consumo y la certificación " +
                     "NO entran en ese orden y hay que mirarlos aparte" };
  }

  var RadioTec = { compara: compara, unaTecnologia: unaTecnologia, veredicto: veredicto,
                   loQueFalta: loQueFalta, EXIGE: EXIGE, ROTULO: ROTULO,
                   MEJOR_ES_MAS: MEJOR_ES_MAS, celda: celda, falta: falta,
                   presupuesto: presupuesto, extremos: extremos,
                   sensibilidadAlModulo: sensibilidadAlModulo,
                   valorDe: valorDe, ALTERNATIVAS: ALTERNATIVAS,
                   limiteEirp: limiteEirp, legalidadDe: legalidadDe,
                   DIPOLO_DBI: DIPOLO_DBI };
  raiz.RadioTec = RadioTec;
  if (typeof module !== "undefined" && module.exports) module.exports = RadioTec;
})(typeof window !== "undefined" ? window : globalThis);
