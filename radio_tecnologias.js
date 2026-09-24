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
    telemetria:          ["tasa_bps", "carga_util_b", "periodo_s"],
    legalidad:           ["norma", "erp_max_dbm", "ciclo_trabajo"]
  };

  var UNIDAD = {
    tcu_cubiertas: "TCU", tcu_sin_alternativa: "TCU", ncu_necesarias: "NCU",
    saltos_max: "saltos", saltos_mediano: "saltos", latencia_stow: "s",
    telemetria: "% de la disponible", legalidad: null
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

  /* Qué parámetros de una variante están puestos. `null` y `undefined` cuentan
     igual: no está. Un 0 SÍ cuenta —0 dBm es una potencia— y por eso se mira
     `== null` y no la veracidad. */
  function loQueFalta(variante, criterio) {
    var exige = EXIGE[criterio];
    if (!exige) return ["el criterio «" + criterio + "» no declara qué necesita"];
    var f = [];
    for (var i = 0; i < exige.length; i++) {
      var v = variante ? variante[exige[i]] : null;
      if (v == null) f.push(exige[i]);
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
                   sensibilidadAlModulo: sensibilidadAlModulo };
  raiz.RadioTec = RadioTec;
  if (typeof module !== "undefined" && module.exports) module.exports = RadioTec;
})(typeof window !== "undefined" ? window : globalThis);
