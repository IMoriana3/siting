/* radio_informe.js — EL INFORME. Punto 8 de la fase 4.
 *
 * Markdown, a partir del ESCENARIO del punto 7 y de la tabla del punto 6. Nada
 * se calcula aquí: esto redacta. Si calculara, habría dos motores que se
 * separarían en silencio, que es lo que esta fase lleva entera cerrando.
 *
 * ═══ LA REGLA QUE MANDA ═══
 *
 * UN INFORME SIN LA SECCIÓN DE LO QUE FALTA NO SE PUBLICA. No es una
 * recomendación: `genera()` LANZA si esa sección no se puede escribir. Un
 * informe que sólo enseña lo que salió es una carta de presentación, no un
 * informe, y el lector no tiene cómo saber qué no se miró.
 *
 * ═══ REPRODUCIBLE, Y QUÉ SIGNIFICA ═══
 *
 * El mismo escenario y el mismo motor dan el MISMO texto, byte a byte. Eso
 * obliga a dos cosas que parecen detalles y no lo son:
 *
 *   · NADA DE «generado el <ahora>». La fecha que sale es la del escenario, que
 *     es un dato de entrada. Un reloj dentro del informe lo hace irreproducible
 *     por construcción y deja el banco sin nada que exigir.
 *   · LAS CLAVES, ORDENADAS. Recorrer un objeto en orden de inserción da textos
 *     distintos para el mismo contenido.
 *
 * Hay banco que lo exige, y una mutación que mete un reloj para comprobar que
 * el banco lo caza.
 */
(function (raiz) {
  "use strict";

  var VERSION = 1;

  /* Las cinco secciones que el encargo pide, en este orden y con estos nombres.
     Declaradas aquí para que `genera()` no pueda olvidarse de una: se recorre
     esta lista y falta la que falte. */
  var SECCIONES = [
    "Escenario y procedencia",
    "Resultado por criterio",
    "Alcance",
    "Lo no medido",
    "Qué haría falta para cerrarlo"
  ];
  var SIN_ESTA_NO_SE_PUBLICA = "Lo no medido";

  /* UN HUECO SE ESCRIBE COMO HUECO: `null`, `undefined` y `NaN` salen «—». Un
   «NaN» impreso se lee como un dato, y no lo es. */
function esc(s) {
  if (s == null) return "—";
  if (typeof s === "number" && !isFinite(s)) return "—";
  return String(s);
}
  function fila(cs) { return "| " + cs.join(" | ") + " |"; }

  function celdaTexto(c) {
    if (!c) return "—";
    if (c.min == null) return "**no se puede**";
    return c.min === c.max ? String(c.min) : (c.min + "–" + c.max);
  }

  /* ── 1 · ESCENARIO Y PROCEDENCIA ──────────────────────────────────────── */
  function secEscenario(e) {
    var l = ["| campo | valor | procedencia |", "|---|---|---|"];
    l.push(fila(["planta", esc(e.planta), "escenario"]));
    l.push(fila(["motor", esc(e.motor), "escenario"]));
    l.push(fila(["variante de radio", "`" + esc(e.variante) + "`", "escenario"]));
    l.push(fila(["hora (UTC, ms)", esc(e.hora_utc),
                 e.hora_utc == null ? "**sin hora**: el ángulo del seguidor no está fijado" : "escenario"]));
    l.push(fila(["altura de eje (m)", esc(e.eje_m),
                 e.eje_m == null ? "**sin valor**"
                   : (e.eje_medida === true ? "medida en planta"
                      : "**declarada, no medida**" + (e.eje_motivo ? " · " + esc(e.eje_motivo) : ""))]));
    l.push(fila(["cuerda (m)", esc(e.cuerda_m), "escenario"]));
    var veg = e.vegetacion || {};
    var vegNula = !e.vegetacion || veg.modelo == null;
    l.push(fila(["vegetación", vegNula ? "**no modelada**" : "`" + esc(veg.modelo) + "`",
                 vegNula ? "sin modelo declarado en `radio_params.json`: el motor NO la cuenta, y lo dice"
                         : "escenario"]));
    var t = e.terreno || {};
    l.push(fila(["terreno", esc(t.id), t.ok === true ? "cargado · calidad: " + esc(t.calidad)
      : (t.ok === false ? "**se intentó y NO se pudo**: " + esc(t.motivo)
                        : "**no se intentó**: " + esc(t.motivo))]));
    l.push(fila(["NCU", (e.ncus || []).length + " posiciones", "escenario (del layout)"]));
    l.push(fila(["`radio_params.json`", "v" + esc(e.params_version),
                 e.params_sha256 ? "sha256 `" + String(e.params_sha256).slice(0, 12) + "…`"
                                 : "**sin sha**: " + esc(e._params_sha_motivo)]));
    l.push(fila(["motor", esc(e.motor_version),
                 e.motor_sha256 ? "sha256 `" + String(e.motor_sha256).slice(0, 12) + "…`"
                                : "**sin sha**"]));
    l.push(fila(["commit del motor", "—", esc(e._motor_commit_motivo)]));
    return l.join("\n");
  }

  /* ── 2 · RESULTADO POR CRITERIO ───────────────────────────────────────── */
  function secResultado(t) {
    if (!t || !t.filas || !t.filas.length) return "_No hay tabla: no se ha podido comparar nada._";
    var tec = t.tecnologias.slice();
    var l = [fila(["criterio"].concat(tec).concat(["veredicto"])),
             fila(["---"].concat(tec.map(function () { return "---"; })).concat(["---"]))];
    for (var i = 0; i < t.filas.length; i++) {
      var f = t.filas[i];
      l.push(fila([f.rotulo].concat(tec.map(function (x) { return celdaTexto(f.celdas[x]); }))
                            .concat([f.veredicto ? f.veredicto.texto : "—"])));
    }
    l.push("");
    l.push("**No hay puntuación agregada, a propósito.** Un número único esconde de qué");
    l.push("está hecho, y de eso va todo este documento.");
    return l.join("\n");
  }

  /* ── 3 · ALCANCE: QUÉ POBLACIÓN Y QUÉ DENOMINADOR ─────────────────────── */
  function secAlcance(a) {
    a = a || {};
    var l = [];
    l.push("| qué | cuánto |");
    l.push("|---|---|");
    l.push(fila(["TCU en la población", esc(a.tcu)]));
    l.push(fila(["NCU (raíces)", esc(a.ncus)]));
    l.push(fila(["horas evaluadas", (a.horas || []).length ? a.horas.join(", ") + " UTC" : "—"]));
    l.push(fila(["pares de enlace evaluados", esc(a.enlaces)]));
    l.push(fila(["poda geométrica", a.alcanceM == null ? "—" : a.alcanceM + " m"]));
    l.push(fila(["umbral de «enlaza»", esc(a.umbral)]));
    if (a.denominador) { l.push(""); l.push("**El denominador:** " + a.denominador); }
    if (a.sesgo) { l.push(""); l.push("**Sesgo de la población:** " + a.sesgo); }
    return l.join("\n");
  }

  /* ── 4 · LO NO MEDIDO ─────────────────────────────────────────────────── */
  function huecosDeTabla(t) {
    var h = [];
    if (!t || !t.filas) return h;
    for (var i = 0; i < t.filas.length; i++) {
      var f = t.filas[i];
      for (var j = 0; j < t.tecnologias.length; j++) {
        var k = t.tecnologias[j], c = f.celdas[k];
        if (c && c.min == null) h.push({ criterio: f.rotulo, tecnologia: k, motivo: c.motivo });
      }
    }
    return h;
  }
  function secNoMedido(huecos, extra) {
    var l = [];
    if (!huecos.length && !(extra || []).length) {
      l.push("_Nada. Todos los criterios de la tabla tienen valor para todas las");
      l.push("tecnologías comparadas._");
      return l.join("\n");
    }
    l.push("| criterio | tecnología | por qué no se puede |");
    l.push("|---|---|---|");
    /* ORDENADO, no en orden de recorrido: el mismo contenido tiene que dar el
       mismo texto. */
    var ord = huecos.slice().sort(function (a, b) {
      return (a.criterio + a.tecnologia).localeCompare(b.criterio + b.tecnologia);
    });
    for (var i = 0; i < ord.length; i++) {
      l.push(fila([ord[i].criterio, "`" + ord[i].tecnologia + "`", esc(ord[i].motivo)]));
    }
    for (var j = 0; j < (extra || []).length; j++) {
      l.push(fila([extra[j].criterio || "—", extra[j].tecnologia || "—", esc(extra[j].motivo)]));
    }
    return l.join("\n");
  }

  /* ── 5 · QUÉ HARÍA FALTA PARA CERRARLO ────────────────────────────────── */
  function secCerrar(pasos) {
    if (!pasos || !pasos.length) {
      return "_Sin pasos declarados._ Y eso, con huecos en la tabla, es un hueco más:\n" +
             "si no se sabe qué haría falta, el informe no dice cómo salir de aquí.";
    }
    return pasos.map(function (p, i) {
      return (i + 1) + ". **" + esc(p.que) + "** — " + esc(p.como) +
             (p.desbloquea ? "  \n   Desbloquea: " + esc(p.desbloquea) : "");
    }).join("\n");
  }

  /* QUÉ HUECOS NO APARECEN EN LA SECCIÓN. Función aparte y exportada para que
     el banco pueda probarla DIRECTAMENTE: una puerta que sólo se puede ejercitar
     a través de todo el generador es una puerta que nadie mira de cerca. */
  function sinListar(seccion, huecos) {
    var fuera = [], s = String(seccion || "");
    for (var n = 0; n < (huecos || []).length; n++) {
      var h = huecos[n];
      if (s.indexOf(String(h.tecnologia)) < 0 || s.indexOf(String(h.criterio)) < 0) {
        fuera.push(h.criterio + " / " + h.tecnologia);
      }
    }
    return fuera;
  }

  /* ── EL INFORME ───────────────────────────────────────────────────────── */
  function genera(d) {
    d = d || {};
    var e = d.escenario;
    if (!e) throw new Error("radio_informe: sin escenario no hay informe. El punto 7 es la entrada del 8.");
    var huecos = huecosDeTabla(d.tabla).concat(d.huecosExtra || []);
    var cuerpo = {
      "Escenario y procedencia": secEscenario(e),
      "Resultado por criterio": secResultado(d.tabla),
      "Alcance": secAlcance(d.alcance),
      "Lo no medido": secNoMedido(huecosDeTabla(d.tabla), d.huecosExtra),
      "Qué haría falta para cerrarlo": secCerrar(d.pasos)
    };
    /* LA PUERTA DEL PUNTO 8. No es un aviso: es una excepción.
     *
     * Y NO COMPRUEBA QUE LA SECCIÓN EXISTA, sino que LISTE LOS HUECOS QUE HAY.
     * La primera versión sólo miraba que el texto no estuviera vacío, y eso era
     * CÓDIGO MUERTO: `secNoMedido` nunca devuelve vacío —cuando no hay huecos
     * escribe «Nada»—, así que la excepción no podía saltar nunca. Una promesa
     * que no puede dispararse es peor que una puerta sin probar, y la cazó su
     * propia mutación al salir verde. */
    for (var i = 0; i < SECCIONES.length; i++) {
      var s = SECCIONES[i];
      if (typeof cuerpo[s] !== "string" || !cuerpo[s].trim()) {
        throw new Error("radio_informe: falta la sección «" + s + "».");
      }
    }
    var noListados = sinListar(cuerpo[SIN_ESTA_NO_SE_PUBLICA], huecos);
    if (noListados.length) {
      throw new Error("radio_informe: NO SE PUBLICA. Hay " + noListados.length +
        " hueco(s) que la sección «" + SIN_ESTA_NO_SE_PUBLICA + "» no lista: " +
        noListados.join("; ") + ". Un informe que sólo enseña lo que salió es una " +
        "carta de presentación, no un informe.");
    }
    var out = [];
    out.push("# Informe de cobertura · " + esc(e.planta));
    out.push("");
    out.push("_Generado por `radio_informe.js` v" + VERSION + " a partir del escenario " +
             "guardado" + (e._guardado ? " el " + String(e._guardado).slice(0, 16).replace("T", " ") : "") + "._");
    out.push("_Mismo escenario y mismo motor dan el mismo informe: no hay ningún reloj dentro._");
    out.push("");
    for (var k = 0; k < SECCIONES.length; k++) {
      out.push("## " + (k + 1) + ". " + SECCIONES[k]);
      out.push("");
      out.push(cuerpo[SECCIONES[k]]);
      out.push("");
    }
    out.push("---");
    out.push("");
    out.push("**Huecos declarados: " + huecos.length + ".** Si esta cifra es 0 y la tabla");
    out.push("trae «no se puede» en alguna celda, el informe está mintiendo y hay un defecto");
    out.push("en el generador, no en los datos.");
    return out.join("\n") + "\n";
  }

  var RadioInf = { VERSION: VERSION, SECCIONES: SECCIONES,
                   SIN_ESTA_NO_SE_PUBLICA: SIN_ESTA_NO_SE_PUBLICA,
                   genera: genera, huecosDeTabla: huecosDeTabla, sinListar: sinListar };
  raiz.RadioInf = RadioInf;
  if (typeof module !== "undefined" && module.exports) module.exports = RadioInf;
})(typeof window !== "undefined" ? window : globalThis);
