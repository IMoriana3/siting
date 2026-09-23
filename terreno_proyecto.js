/* terreno_proyecto.js — el terreno de una planta, cargado con el proyecto.
 *
 * ┌─ QUÉ RESUELVE, Y POR QUÉ NO ERA TRIVIAL ───────────────────────────────────┐
 * │ `terreno_planta.js` sabe MUESTREAR un `<planta>_relieve.json`. Lo que no    │
 * │ había era de dónde sale ese fichero en la app y en qué sistema de           │
 * │ coordenadas está: el motor lo consumía en los útiles y la pantalla no.      │
 * │                                                                            │
 * │ Decisión tomada: **el fichero viaja con el proyecto**, como artefacto       │
 * │ versionado junto a su preset, con su sha y la versión de quien lo produjo.  │
 * │ cobertura-zigbee lo genera, esto lo consume y COMPRUEBA EL SHA.             │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ LOS DOS SISTEMAS DE COORDENADAS, Y QUE CASAN ═══
 *
 * El preset de la app y el layout de cobertura-zigbee usan el MISMO CRS pero
 * ORÍGENES DISTINTOS: el preset lleva `ox`/`oy` (UTM del origen local de la
 * app) y el terreno lleva `cE`/`cN` (UTM del centro del campo). Así que
 *
 *     x_terreno = x_app + (ox − cE)
 *     n_terreno = y_app + (oy − cN)
 *
 * y no hace falta teclear ningún desfase: sale de los dos artefactos.
 *
 * **MEDIDO ANTES DE ESCRIBIR ESTO**, careando las 751 TCU del preset de Ayora
 * contra los 751 trackers del layout: tras aplicar ese desfase, cada TCU cae a
 * **0,141 m** de su tracker, y el residuo es **exactamente (−0,100, −0,100) m
 * con dispersión CERO** en las 108 muestreadas. O sea que no es ruido ni un
 * giro: es un desfase constante de 10 cm, probablemente del redondeo de `ox`/
 * `oy` a un decimal. A 6 m de paso de malla el terreno no cambia en 10 cm, así
 * que no se corrige —corregir a ciegas sería inventar cuál de los dos tiene
 * razón— pero SE DECLARA, y `residuoAlinear()` lo deja medible.
 */
(function (raiz) {
  "use strict";

  var TP = raiz.TerrenoPlanta || (typeof require !== "undefined" ? require("./terreno_planta.js") : null);

  var MOTIVOS = {
    SIN_DECLARAR: "relieve_planta_sin_terreno_declarado",
    NO_LLEGA:     "relieve_fichero_no_disponible",
    SHA:          "relieve_sha_no_cuadra",
    FORMA:        "relieve_fichero_con_forma_inesperada",
    SIN_ORIGEN:   "relieve_preset_sin_origen_utm"
  };

  /* Caché por sha, para que abrir dos veces la misma planta no baje el fichero
     dos veces.
     ─────────────────────────────────────────────────────────────────────────
     GUARDA EL TERRENO Y NADA MÁS, y esto nació de un fallo que cazó el banco.
     La primera versión cacheaba el resultado ENTERO, `dx`/`dn` incluidos — y
     esos NO son del terreno, son del PRESET: salen de `ox − cE`. Dos proyectos
     distintos sobre el mismo terreno se habrían llevado el desfase del otro, y
     el relieve habría salido del sitio equivocado sin que nada avisara.
     Ahora se cachea `{T, man, shaVerificado}` y el desfase se calcula en cada
     llamada, que es donde se conoce el preset.
     ─────────────────────────────────────────────────────────────────────────
     Y LO QUE LA CACHÉ NO PUEDE VER: si el fichero cambia SIN cambiar su
     manifiesto, la segunda carga de la misma sesión lo sirve de memoria sin
     volver a comprobar el sha. Es deliberado —el manifiesto ES la identidad
     del terreno— y la primera carga sí lo caza. */
  var cache = {};

  function claveDe(man) { return (man && man.sha256) || null; }

  /* sha256 del TEXTO, que es lo que firma el productor. `crypto.subtle` sólo
     existe en contexto seguro (https o localhost): si no está, NO se finge que
     se comprobó — se dice, y el terreno se usa igualmente pero rotulado como
     «sha no verificable», que es distinto de «sha correcto». */
  function sha256Hex(texto) {
    var subtle = raiz.crypto && raiz.crypto.subtle;
    if (!subtle) return Promise.resolve(null);
    var bytes = new TextEncoder().encode(texto);
    return subtle.digest("SHA-256", bytes).then(function (buf) {
      var v = new Uint8Array(buf), s = "";
      for (var i = 0; i < v.length; i++) s += v[i].toString(16).padStart(2, "0");
      return s;
    }).catch(function () { return null; });
  }

  /* El desfase entre el sistema del preset y el del terreno. Devuelve null si
     al preset le falta el origen UTM: sin él no se puede situar nada, y
     situarlo «a ojo» sería poner el terreno donde no está. */
  function desfase(preset, man) {
    if (!preset || preset.ox == null || preset.oy == null) return null;
    if (!man || typeof man.cE !== "number" || typeof man.cN !== "number") return null;
    return { dx: preset.ox - man.cE, dn: preset.oy - man.cN };
  }

  /* CARGA PEREZOSA: no se baja nada hasta que se abre esa planta, y se avisa
     del progreso porque son 1,5–2 MB y un parón mudo se lee como que la app se
     ha colgado. `onProgreso(fraccion|null, texto)` — la fracción es null
     mientras el servidor no diga `Content-Length`. */
  function carga(preset, opciones) {
    opciones = opciones || {};
    var prog = opciones.onProgreso || function () {};
    var base = opciones.base || "terreno/";
    var decl = preset && preset.terreno;
    if (!decl || !decl.manifiesto) {
      return Promise.resolve({ ok: false, motivo: MOTIVOS.SIN_DECLARAR,
                               detalle: "el preset de esta planta no declara terreno" });
    }
    var fetchFn = opciones.fetch || raiz.fetch;

    return fetchFn(base + decl.manifiesto, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("manifiesto HTTP " + r.status); return r.json(); })
      .then(function (man) {
        var k = claveDe(man);
        if (k && cache[k]) {
          var dC = desfase(preset, cache[k].man);
          if (!dC) return { ok: false, motivo: MOTIVOS.SIN_ORIGEN,
                            detalle: "el preset no trae ox/oy, o el manifiesto no trae cE/cN" };
          prog(1, "terreno ya cargado");
          return { ok: true, T: cache[k].T, man: cache[k].man,
                   dx: dC.dx, dn: dC.dn, shaVerificado: cache[k].shaVerificado };
        }
        /* EL SHA DECLARADO EN EL PRESET MANDA SOBRE EL DEL MANIFIESTO. Si sólo
           se comprobara el manifiesto contra el fichero, cambiar los dos a la
           vez pasaría desapercibido: el preset es quien fija QUÉ terreno
           espera este proyecto. */
        if (decl.sha256 && man.sha256 && decl.sha256 !== man.sha256) {
          return { ok: false, motivo: MOTIVOS.SHA,
                   detalle: "el preset espera " + decl.sha256.slice(0, 12) +
                            "… y el manifiesto trae " + man.sha256.slice(0, 12) + "…" };
        }
        prog(0, "bajando el terreno de " + (man.planta || "la planta") + "…");
        return descarga(fetchFn, base + man.fichero, man.bytes, prog).then(function (texto) {
          if (texto === null) {
            return { ok: false, motivo: MOTIVOS.NO_LLEGA, detalle: base + man.fichero };
          }
          return sha256Hex(texto).then(function (sha) {
            if (sha !== null && man.sha256 && sha !== man.sha256) {
              return { ok: false, motivo: MOTIVOS.SHA,
                       detalle: "el fichero da " + sha.slice(0, 12) + "… y el manifiesto dice " +
                                man.sha256.slice(0, 12) + "…" };
            }
            var obj;
            try { obj = JSON.parse(texto); } catch (e) {
              return { ok: false, motivo: MOTIVOS.FORMA, detalle: "no es JSON válido" };
            }
            var T = TP.cargaRelieve(obj);
            if (!T) return { ok: false, motivo: MOTIVOS.FORMA, detalle: "cargaRelieve lo rechaza" };
            var d = desfase(preset, man);
            if (!d) return { ok: false, motivo: MOTIVOS.SIN_ORIGEN,
                             detalle: "el preset no trae ox/oy, o el manifiesto no trae cE/cN" };
            /* UN SOLO SITIO donde se decide si el sha se verificó. Estuvo en
               dos —la caché y el retorno— y una mutación que cambiaba uno se
               quedaba tapada por el otro: el banco no la cazaba. */
            var verificado = (sha !== null);
            if (k) cache[k] = { T: T, man: man, shaVerificado: verificado };
            prog(1, "terreno listo");
            return { ok: true, T: T, man: man, dx: d.dx, dn: d.dn,
                     shaVerificado: verificado };
          });
        });
      })
      .catch(function (e) {
        return { ok: false, motivo: MOTIVOS.NO_LLEGA, detalle: String(e && e.message || e) };
      });
  }

  /* Descarga con progreso. Si el navegador no da `body.getReader()` o no hay
     `Content-Length`, se cae a `text()` y el progreso va sin fracción: es
     preferible a no enseñar nada. */
  function descarga(fetchFn, url, bytesEsperados, prog) {
    return fetchFn(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) return null;
      var total = bytesEsperados || parseInt(r.headers.get("Content-Length") || "0", 10) || 0;
      if (!r.body || !r.body.getReader) { prog(null, "bajando el terreno…"); return r.text(); }
      var reader = r.body.getReader(), trozos = [], leidos = 0;
      return (function bucle() {
        return reader.read().then(function (p) {
          if (p.done) return new TextDecoder().decode(concat(trozos, leidos));
          trozos.push(p.value); leidos += p.value.length;
          prog(total ? Math.min(0.99, leidos / total) : null,
               "bajando el terreno… " + (leidos / 1048576).toFixed(1) + " MB" +
               (total ? " de " + (total / 1048576).toFixed(1) : ""));
          return bucle();
        });
      })();
    });
  }
  function concat(trozos, n) {
    var out = new Uint8Array(n), o = 0;
    for (var i = 0; i < trozos.length; i++) { out.set(trozos[i], o); o += trozos[i].length; }
    return out;
  }

  /* El perfil de un enlace, con los extremos en coordenadas de la APP. Devuelve
     lo mismo que `perfilEntre` más las cotas de suelo, para que quien llame
     ponga las antenas SOBRE el suelo y no sobre el cero — que es la avería que
     sale a 0,0029 dB con la antena 739 m bajo tierra. */
  function perfilDeEnlace(cargado, ax, ay, bx, by, opts) {
    if (!cargado || !cargado.ok) {
      return { perfil: null, motivo: (cargado && cargado.motivo) || MOTIVOS.SIN_DECLARAR };
    }
    return TP.perfilEntre(cargado.T,
      ax + cargado.dx, ay + cargado.dn,
      bx + cargado.dx, by + cargado.dn, opts);
  }

  /* Lo que la pantalla tiene que poder decir: qué terreno se está usando. NO
     es cosmético — un mapa de cobertura pintado con el terreno de otra planta,
     o con un DEM global en vez del levantamiento, se lee igual de bien y dice
     otra cosa. */
  function rotulo(cargado) {
    if (!cargado) return { texto: "sin terreno", detalle: "no se ha intentado cargar", ok: false };
    if (!cargado.ok) {
      return { texto: "sin terreno", ok: false,
               motivo: cargado.motivo,
               detalle: ({
                 "relieve_planta_sin_terreno_declarado": "esta planta no tiene levantamiento validado",
                 "relieve_fichero_no_disponible": "el fichero de terreno no llegó",
                 "relieve_sha_no_cuadra": "el sha del terreno NO cuadra: no se usa",
                 "relieve_fichero_con_forma_inesperada": "el fichero de terreno no tiene la forma esperada",
                 "relieve_preset_sin_origen_utm": "el proyecto no trae origen UTM: no se puede situar el terreno"
               })[cargado.motivo] || cargado.detalle || "" };
    }
    var m = cargado.man;
    var TIPOS = { empalme: "DEM + levantamiento", levantamiento: "levantamiento", dem: "DEM global", curvas: "curvas de nivel" };
    var c = m.calidad || null;
    /* LA CALIDAD NO ES UN ADORNO, Y VA EN EL TEXTO CORTO.
       Un terreno empalmado valida a 0,030 m y uno de solo DEM a 0,78–1,20:
       ×17 a ×28. Pintados igual, quien mira el mapa no puede saber cuál está
       viendo — y la diferencia decide si el relieve sirve para colocar una NCU
       o sólo para saber que hay una loma. Si el fichero no dice nada de
       calidad, se dice ESO, que tampoco es lo mismo que estar validado. */
    var val = c ? (c.validado === true) : null;
    var marca = val === true ? "validado" : (val === false ? "⚠ SIN VALIDAR" : "⚠ calidad no declarada");
    return {
      ok: true,
      texto: (m.planta || "?") + " · " + (TIPOS[m.tipo] || m.tipo || "?") + " · " + marca,
      detalle: (m.productor || "productor desconocido") + " · " + (m.generado || "sin fecha") +
               " · malla " + m.nx + "×" + m.nn + " a " + m.paso + " m" +
               (c && c.px_tesela_m ? " · píxel " + c.px_tesela_m + " m" : "") +
               (m.eje_m != null ? " · eje " + m.eje_m.toFixed(2) + " m"
                                + (m.eje_medido === false ? " DECLARADO" : "") : "") +
               (cargado.shaVerificado ? " · sha ✓" : " · sha NO verificable aquí"),
      validado: val,
      /* EL AVISO, que es lo que de verdad hay que leer antes de fiarse. */
      aviso: val === true
        ? (c.p50_m != null ? "validado contra " + (c.n_cotas || "?") + " cotas medidas, |err| p50 "
                           + c.p50_m.toFixed(3) + " m" : "validado")
        : (c && c.motivo ? c.motivo : "este terreno no se ha validado contra cotas medidas"),
      tipo: m.tipo, sha: m.sha256, shaVerificado: cargado.shaVerificado
    };
  }

  /* ═══ EL ± DEL RELIEVE, PARA PONERLO AL LADO DEL VALOR ═══════════════════
   *
   * Un relieve de 8 dB con ±1 y otro con ±13 no se presentan igual, y hasta
   * ahora la pantalla no tenía forma de distinguirlos. Esto devuelve, para un
   * vano de D metros, el ± que lleva el terreno cargado.
   *
   * Sale de `calidad.z_db.p90_db`, que el productor escribe en el fichero: el
   * p90 de |relieve con terreno empalmado − relieve con solo DEM|, medido
   * sobre 400 vanos por banda en Ayora y San José. Se coge el PEOR de las
   * plantas medidas, no el más cómodo.
   *
   * Devuelve null cuando el fichero no lo trae —y eso NO es «± cero»: es «no
   * se sabe», y quien lo pinte tiene que decir eso y no un cero tranquilizador.
   */
  function incertidumbreDb(cargado, D) {
    if (!cargado || !cargado.ok || !(D > 0)) return null;
    var c = cargado.man && cargado.man.calidad;
    var z = c && c.z_db && c.z_db.p90_db;
    if (!z) return null;
    var mejorClave = null, mejorHi = Infinity;
    for (var k in z) {
      if (!Object.prototype.hasOwnProperty.call(z, k)) continue;
      var p = k.split("-");
      var lo = parseFloat(p[0]), hi = parseFloat(p[1]);
      if (!(lo >= 0) || !(hi > lo)) continue;
      if (D >= lo && D < hi) { mejorClave = k; mejorHi = hi; break; }
      /* Por encima de la última banda se usa la última: extrapolar a cero
         sería regalar certidumbre justo donde menos la hay. */
      if (D >= hi && hi < mejorHi) { /* no hace nada: se resuelve abajo */ }
    }
    if (mejorClave === null) {
      var ultLo = -Infinity;
      for (var k2 in z) {
        if (!Object.prototype.hasOwnProperty.call(z, k2)) continue;
        var lo2 = parseFloat(k2.split("-")[0]);
        if (lo2 > ultLo) { ultLo = lo2; mejorClave = k2; }
      }
      if (mejorClave === null) return null;
    }
    var v = z[mejorClave];
    if (!v || !v.length) return null;
    var peor = v[0];
    for (var i = 1; i < v.length; i++) if (v[i] > peor) peor = v[i];
    return { z90: peor, banda: mejorClave,
             de: (c.z_db.medido_en || []).join("+") || "?",
             extrapolado: !(D >= parseFloat(mejorClave.split("-")[0])
                         && D < parseFloat(mejorClave.split("-")[1])) };
  }

  /* Para poder MEDIR el desfase residual entre los dos sistemas en vez de
     confiar en él: devuelve, por cada punto de la app, la distancia al punto
     más cercano de una lista de referencia ya en coordenadas del terreno. */
  function residuoAlinear(cargado, puntosApp, refTerreno) {
    if (!cargado || !cargado.ok || !puntosApp || !puntosApp.length || !refTerreno || !refTerreno.length) return null;
    var out = [];
    for (var i = 0; i < puntosApp.length; i++) {
      var x = puntosApp[i].x + cargado.dx, n = puntosApp[i].y + cargado.dn, mejor = Infinity;
      for (var j = 0; j < refTerreno.length; j++) {
        var d = Math.pow(refTerreno[j].x - x, 2) + Math.pow(refTerreno[j].n - n, 2);
        if (d < mejor) mejor = d;
      }
      out.push(Math.sqrt(mejor));
    }
    out.sort(function (a, b) { return a - b; });
    return { n: out.length, p50: out[out.length >> 1], max: out[out.length - 1] };
  }

  var TerrenoProyecto = {
    MOTIVOS: MOTIVOS,
    carga: carga,
    perfilDeEnlace: perfilDeEnlace,
    rotulo: rotulo,
    incertidumbreDb: incertidumbreDb,
    desfase: desfase,
    residuoAlinear: residuoAlinear,
    _cache: cache,
    _version: "fase1"
  };
  raiz.TerrenoProyecto = TerrenoProyecto;
  if (typeof module !== "undefined" && module.exports) module.exports = TerrenoProyecto;
})(typeof window !== "undefined" ? window : globalThis);
