/* radio_escenario.js — EL ESCENARIO GUARDABLE. Punto 7 de la fase 4.
 *
 * Un escenario es TODO lo que hace falta para volver a ver exactamente lo mismo:
 * planta, tecnología, variante de radio, fecha y hora, altura de eje,
 * vegetación, terreno usado y su calidad, posiciones de NCU, y la versión de los
 * parámetros CON SU SHA.
 *
 * ═══ POR QUÉ EL SHA Y NO LA VERSIÓN ═══
 *
 * `radio_params.json` trae un campo `version`. No basta: se puede cambiar un
 * valor sin tocar la versión, y entonces dos escenarios «de la v3» pintan cosas
 * distintas sin que nada lo diga. Lo que ata es el SHA256 del contenido — el
 * mismo criterio que el candado del canon en `cobertura-rf-fv`.
 *
 * Y el commit del motor, que el encargo también pide, esta página NO LO SABE:
 * un HTML servido desde Pages no conoce su propio commit. Lo que sí puede saber
 * es el SHA de los bytes del motor, que identifica MÁS y no menos. Así que se
 * guarda eso, y `motor_commit` queda a `null` con su motivo en vez de inventado.
 *
 * ═══ LA REGLA QUE ORDENA EL RESTO ═══
 *
 * UN SHA QUE FALTA NO COMPARA IGUAL. Si al guardar no se pudo calcular —sin
 * `crypto.subtle`, sin red— el escenario lo dice, y al abrirlo `carea()` NO
 * responde «son los mismos parámetros»: responde que no se puede saber. Un
 * hueco que se lee como coincidencia es peor que no guardar nada.
 *
 * ═══ NADA DE ALMACENAMIENTO DEL NAVEGADOR ═══
 *
 * Ni `localStorage`, ni `sessionStorage`, ni IndexedDB. Lo que vive en un
 * navegador se pierde sin avisar y no se puede pasar a otro, o sea que no es un
 * escenario compartible. URL si cabe, y si no un JSON que se descarga. Hay un
 * banco que comprueba que este fichero NO los nombra.
 */
(function (raiz) {
  "use strict";

  var VERSION_FORMATO = 1;
  /* MEDIDO, no elegido de memoria: IE imponía 2.083 y sigue siendo el límite
     práctico que citan los navegadores modernos para que una URL viaje entera
     por correo, chat y registros. Por encima de esto no se promete que quepa, y
     se ofrece el JSON. */
  var LIMITE_URL = 2000;

  /* JSON ESTABLE: claves ordenadas, a todos los niveles. Sin esto, dos capturas
     del mismo estado dan textos distintos y sus shas no coinciden — y el banco
     que exige que el mismo escenario dé el mismo informe (punto 8) sería
     imposible de cumplir. */
  function estable(v) {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(estable);
    var o = {}, ks = Object.keys(v).sort();
    for (var i = 0; i < ks.length; i++) o[ks[i]] = estable(v[ks[i]]);
    return o;
  }

  /* LO QUE UN ESCENARIO TIENE QUE TRAER. Declarado aquí y en un solo sitio; la
     validación y el careo leen de esta lista, así que añadir un campo al
     escenario sin añadirlo aquí no puede pasar desapercibido. */
  var CAMPOS = [
    "planta", "motor", "variante", "hora_utc", "eje_m", "vegetacion",
    "terreno", "ncus", "params_sha256", "params_version", "motor_sha256"
  ];
  /* Y los que, faltando, dejan el escenario IRREPRODUCIBLE. Los demás se pueden
     echar en falta y seguir: éstos no. */
  var IMPRESCINDIBLES = ["planta", "variante", "params_sha256"];

  /* UN NÚMERO QUE NO ES UN NÚMERO ES UN HUECO, NO UN NÚMERO. `Number(x)` de un
     objeto da `NaN`, y un `NaN` viaja por el escenario y acaba impreso en el
     informe como «NaN» — que se lee como un dato. Pasó de verdad: `alturaEje()`
     devuelve `{valor, medida, motivo}` y aquí se le hacía `Number()`. */
  function num(x) { var n = Number(x); return Number.isFinite(n) ? n : null; }

  function captura(f) {
    f = f || {};
    var e = {
      _formato: VERSION_FORMATO,
      _guardado: f.ahora || null,
      planta: f.planta == null ? null : String(f.planta),
      motor: f.motor == null ? null : String(f.motor),
      variante: f.variante == null ? null : String(f.variante),
      /* LA HORA VA EN UTC Y EN MILISEGUNDOS, no «12:00». Un «12:00» no dice de
         qué planta ni de qué día, y el ángulo del seguidor depende de los dos:
         el mediodía SOLAR de San José no es el de El Burgo. */
      hora_utc: num(f.horaUTC),
      sol_on: !!f.solOn,
      eje_m: num(f.ejeM),
      /* La cota del eje viene DECLARADA, no medida, en casi todas las plantas.
         El escenario guarda las dos cosas para que el informe no la presente
         como una medida de campo. */
      eje_medida: f.ejeMedida === undefined ? null : !!f.ejeMedida,
      eje_motivo: f.ejeMotivo == null ? null : String(f.ejeMotivo),
      cuerda_m: num(f.cuerdaM),
      vegetacion: f.vegetacion == null ? null : f.vegetacion,
      /* EL TERRENO CON SU CALIDAD, no sólo su nombre: un escenario que diga
         «con terreno» sin decir CUÁL ni si se pudo cargar no reproduce nada. */
      terreno: f.terreno == null ? null : {
        id: f.terreno.id == null ? null : String(f.terreno.id),
        ok: (f.terreno.ok === undefined || f.terreno.ok === null) ? null : !!f.terreno.ok,
        calidad: f.terreno.calidad == null ? null : String(f.terreno.calidad),
        sha256: f.terreno.sha256 == null ? null : String(f.terreno.sha256),
        motivo: f.terreno.motivo == null ? null : String(f.terreno.motivo)
      },
      ncus: (f.ncus || []).map(function (n) {
        return { id: String(n.id), x: num(n.x), y: num(n.y) };
      }),
      params_version: f.paramsVersion == null ? null : String(f.paramsVersion),
      params_sha256: f.paramsSha == null ? null : String(f.paramsSha),
      motor_sha256: f.motorSha == null ? null : String(f.motorSha),
      motor_version: f.motorVersion == null ? null : String(f.motorVersion),
      /* No se inventa: esta página no conoce su commit. Ver la cabecera. */
      motor_commit: null,
      _motor_commit_motivo: "un HTML servido desde Pages no conoce su propio commit; " +
        "lo que ata es `motor_sha256`, que identifica los bytes exactos del motor"
    };
    if (e.params_sha256 == null) {
      e._params_sha_motivo = f.paramsShaMotivo ||
        "no se pudo calcular el sha de radio_params.json";
    }
    return estable(e);
  }

  function valida(e) {
    var faltan = [], avisos = [];
    if (!e || typeof e !== "object") return { ok: false, faltan: ["(no es un escenario)"], avisos: [] };
    if (e._formato !== VERSION_FORMATO) {
      avisos.push("el escenario es del formato " + e._formato + " y esta página usa el " +
                  VERSION_FORMATO);
    }
    for (var i = 0; i < CAMPOS.length; i++) {
      var k = CAMPOS[i];
      if (e[k] === undefined || e[k] === null ||
          (Array.isArray(e[k]) && !e[k].length)) {
        if (IMPRESCINDIBLES.indexOf(k) >= 0) faltan.push(k); else avisos.push("sin " + k);
      }
    }
    return { ok: !faltan.length, faltan: faltan, avisos: avisos,
             reproducible: !faltan.length && e.params_sha256 != null };
  }

  function aTexto(e) { return JSON.stringify(estable(e)); }

  /* ── LA URL, SI CABE ─────────────────────────────────────────────────────
   * base64url sobre el JSON. No se comprime a propósito: una compresión propia
   * es un formato que hay que mantener y que se queda vieja, y el caso que no
   * cabe ya tiene salida (el JSON que se descarga). */
  function b64url(s) {
    var b = (typeof btoa === "function")
      ? btoa(unescape(encodeURIComponent(s)))
      : Buffer.from(s, "utf8").toString("base64");
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function deB64url(s) {
    var b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return (typeof atob === "function")
      ? decodeURIComponent(escape(atob(b)))
      : Buffer.from(b, "base64").toString("utf8");
  }

  function aUrl(e, base) {
    var t = aTexto(e), c = b64url(t);
    var url = (base || "") + "#esc=" + c;
    return { cabe: url.length <= LIMITE_URL, url: url, bytes: url.length,
             limite: LIMITE_URL,
             motivo: url.length <= LIMITE_URL ? null :
               "el escenario ocupa " + url.length + " caracteres y el límite práctico son " +
               LIMITE_URL + ": descárgalo como JSON" };
  }

  function deUrl(hash) {
    var m = String(hash || "").match(/[#&]esc=([A-Za-z0-9\-_]+)/);
    if (!m) return null;
    var e;
    try { e = JSON.parse(deB64url(m[1])); }
    catch (err) { throw new Error("el escenario de la URL no se puede leer: " + err.message); }
    return e;
  }

  /* ── EL CAREO AL ABRIR UNO VIEJO ─────────────────────────────────────────
   * Devuelve SIEMPRE uno de tres estados, y «no se puede saber» es uno de
   * ellos. NUNCA se pinta con los parámetros de hoy diciendo que son los de
   * entonces: eso es exactamente lo que pasó con las capturas del motor
   * antiguo, y es el motivo por el que este punto existe. */
  function carea(e, ahora) {
    ahora = ahora || {};
    var d = [];
    function cmp(campo, entonces, hoy) {
      if (entonces == null || hoy == null) {
        d.push({ campo: campo, entonces: entonces, ahora: hoy, estado: "no_se_puede_saber" });
      } else if (String(entonces) !== String(hoy)) {
        d.push({ campo: campo, entonces: entonces, ahora: hoy, estado: "difiere" });
      }
    }
    cmp("params_sha256", e && e.params_sha256, ahora.paramsSha);
    cmp("motor_sha256", e && e.motor_sha256, ahora.motorSha);
    if (e && ahora.paramsVersion != null && e.params_version != null &&
        e.params_version !== ahora.paramsVersion) {
      d.push({ campo: "params_version", entonces: e.params_version,
               ahora: ahora.paramsVersion, estado: "difiere" });
    }
    var difieren = d.filter(function (x) { return x.estado === "difiere"; });
    var ciegos = d.filter(function (x) { return x.estado === "no_se_puede_saber"; });
    var estado = difieren.length ? "difiere" : (ciegos.length ? "no_se_puede_saber" : "igual");
    return {
      estado: estado, diferencias: d,
      /* El texto que la página enseña, aquí y no en la página, para que el banco
         pueda exigirlo sin abrir un navegador. */
      texto: estado === "igual"
        ? "los parámetros son los mismos que cuando se guardó"
        : estado === "difiere"
          ? "LOS PARÁMETROS HAN CAMBIADO desde que se guardó este escenario (" +
            difieren.map(function (x) { return x.campo; }).join(", ") +
            "). Lo que se pinte ahora NO es lo que se vio entonces: recalcula o " +
            "vuelve a aquellos parámetros."
          : "NO SE PUEDE SABER si los parámetros son los mismos (" +
            ciegos.map(function (x) { return x.campo; }).join(", ") +
            " sin valor). Esto NO es «son iguales».",
      /* Y lo único que la página puede ofrecer con honradez cuando no coinciden. */
      ofrecer: estado === "igual" ? null : "recalcular"
    };
  }

  var RadioEsc = {
    VERSION_FORMATO: VERSION_FORMATO, LIMITE_URL: LIMITE_URL, CAMPOS: CAMPOS,
    IMPRESCINDIBLES: IMPRESCINDIBLES,
    captura: captura, valida: valida, aTexto: aTexto, aUrl: aUrl, deUrl: deUrl,
    carea: carea, estable: estable
  };
  raiz.RadioEsc = RadioEsc;
  if (typeof module !== "undefined" && module.exports) module.exports = RadioEsc;
})(typeof window !== "undefined" ? window : globalThis);
