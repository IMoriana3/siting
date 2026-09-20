/* radio_malla.js — la MALLA sobre el balance de enlace.
 *
 * Vecinos viables, saltos al coordinador, puntos de articulación y redundancia
 * por TCU. Sin tecnología dentro: recibe una función que dice si un par enlaza
 * y con qué margen, y trabaja sobre eso. Así la misma malla sirve para Zigbee,
 * para Wi-SUN y para cualquier otra cosa mallada de la fase 3, y lo único que
 * cambia es quién contesta a «¿enlazan estos dos?».
 *
 * ═══ LA ADVERTENCIA IMPORTANTE ═══
 *
 * `buildAdjacency` de `index.html` NO es un modelo de radio. Es una ELIPSE:
 *
 *     (dx/reachX)² + (dy/reachY)² ≤ 1
 *
 * y nada más. No mira obstáculos, ni inclinación de las palas, ni relieve, ni
 * frecuencia, ni margen. Es el criterio con el que se reparten las NCUs, y para
 * eso está bien: es barato, es estable y no depende de la hora del día.
 *
 * Así que la malla que prediga la radio y la elipse VAN A DIFERIR SIEMPRE, y no
 * por un error de ninguna de las dos. Lo que hace falta no es decidir cuál gana
 * —son preguntas distintas— sino CUANTIFICAR la diferencia: cuántos pares ve
 * una y no la otra, en qué dirección y con cuánto margen. Eso es `compara()`, y
 * es el resultado que pide el encargo cuando dice «reportar si difieren».
 */
(function (raiz) {
  "use strict";

  /* ── VECINOS VIABLES ──────────────────────────────────────────────────────
   * `nodos` = [{id, x, y, ...}]. `enlaza(a, b)` devuelve {viable, margenDb} —o
   * `viable: null` si no se sabe, que NO es lo mismo que `false`.
   *
   * `alcanceMax` es una poda geométrica, no física: ningún par más lejos que
   * eso se evalúa. Sirve para no hacer N² llamadas caras en San José, que son
   * 2.289 seguidores y por tanto 2.618.316 pares. Si se pone demasiado corto se
   * pierden enlaces de verdad, así que el resultado dice cuántos pares se
   * podaron: un número alto es la señal de que hay que subirlo. */
  function vecinosViables(nodos, enlaza, alcanceMax) {
    var ady = new Map(), margenes = new Map(), desconocidos = [];
    for (var i = 0; i < nodos.length; i++) ady.set(nodos[i].id, []);
    var tope = alcanceMax == null ? Infinity : alcanceMax, tope2 = tope * tope;
    var podados = 0, evaluados = 0;
    for (var a = 0; a < nodos.length; a++) {
      for (var b = a + 1; b < nodos.length; b++) {
        var dx = nodos[a].x - nodos[b].x, dy = nodos[a].y - nodos[b].y;
        if (dx * dx + dy * dy > tope2) { podados++; continue; }
        evaluados++;
        var r = enlaza(nodos[a], nodos[b]);
        if (r.viable === null || r.viable === undefined) {
          desconocidos.push([nodos[a].id, nodos[b].id]);
          continue;                       // «no se sabe» no entra en la malla
        }
        if (!r.viable) continue;
        ady.get(nodos[a].id).push(nodos[b].id);
        ady.get(nodos[b].id).push(nodos[a].id);
        margenes.set(clave(nodos[a].id, nodos[b].id), r.margenDb);
      }
    }
    return { ady: ady, margenes: margenes, podados: podados, evaluados: evaluados,
             desconocidos: desconocidos };
  }

  function clave(a, b) { return a < b ? a + "\u0000" + b : b + "\u0000" + a; }

  /* ── SALTOS AL COORDINADOR ────────────────────────────────────────────────
   * BFS desde las raíces. Un nodo inalcanzable NO es «muchos saltos»: es
   * `null`, y quien lo pinte tiene que distinguirlo de un nodo lejano. */
  function saltos(ady, raices) {
    var d = new Map();
    for (var k of ady.keys()) d.set(k, null);
    var cola = [];
    for (var i = 0; i < raices.length; i++) {
      if (!ady.has(raices[i])) continue;
      d.set(raices[i], 0); cola.push(raices[i]);
    }
    for (var p = 0; p < cola.length; p++) {
      var u = cola[p], du = d.get(u), vs = ady.get(u);
      for (var j = 0; j < vs.length; j++) {
        if (d.get(vs[j]) === null) { d.set(vs[j], du + 1); cola.push(vs[j]); }
      }
    }
    return d;
  }

  /* ── PUNTOS DE ARTICULACIÓN ───────────────────────────────────────────────
   * Hopcroft-Tarjan, ITERATIVO. La versión recursiva revienta la pila en San
   * José, y «funciona en El Burgo» no es que funcione.
   *
   * CUIDADO AL LEER EL RESULTADO: en un ÁRBOL todo nodo interno es articulación
   * por definición, así que si la malla sale árbol esto no informa de nada. Por
   * eso `analiza()` devuelve también `esArbol`, y quien presente el dato tiene
   * que decirlo. Es exactamente el error que se cometería leyendo las 52 líneas
   * de `elburgo_real.geojson` como si fueran la malla: son una por nodo, del
   * padre dominante al hijo, o sea un árbol dibujado, no la conectividad. */
  function articulaciones(ady) {
    var disc = new Map(), low = new Map(), padre = new Map(), art = new Set(), t = 0;
    for (var raizIt of ady.keys()) {
      if (disc.has(raizIt)) continue;
      var raiz = raizIt, hijosRaiz = 0;
      disc.set(raiz, t); low.set(raiz, t); t++; padre.set(raiz, null);
      var pila = [[raiz, 0]];
      while (pila.length) {
        var marco = pila[pila.length - 1], u = marco[0], vs = ady.get(u);
        if (marco[1] < vs.length) {
          var v = vs[marco[1]++];
          if (!disc.has(v)) {
            padre.set(v, u); disc.set(v, t); low.set(v, t); t++;
            if (u === raiz) hijosRaiz++;
            pila.push([v, 0]);
          } else if (v !== padre.get(u)) {
            low.set(u, Math.min(low.get(u), disc.get(v)));
          }
        } else {
          pila.pop();
          if (pila.length) {
            var p = pila[pila.length - 1][0];
            low.set(p, Math.min(low.get(p), low.get(u)));
            if (p !== raiz && low.get(u) >= disc.get(p)) art.add(p);
          }
        }
      }
      if (hijosRaiz > 1) art.add(raiz);
    }
    return art;
  }

  /* ── REDUNDANCIA POR TCU ──────────────────────────────────────────────────
   * La pregunta útil no es «¿cuántos vecinos tiene?» sino «¿SIGUE LLEGANDO al
   * coordinador si cae uno cualquiera de los demás?». Un nodo con seis vecinos
   * que todos pasan por el mismo relé no es redundante.
   *
   * Se mide quitando UN nodo cada vez y rehaciendo el BFS. Es O(N·(N+E)) y en
   * San José son 2.289 nodos, así que sólo se prueba quitando los nodos que SON
   * articulación: los demás, por definición, no desconectan a nadie. Eso baja
   * el coste al número de articulaciones, que es lo que de verdad importa.
   *
   * Devuelve por nodo: `aislaA`, cuántos nodos quedan sin ruta si cae ÉSTE. */
  function redundancia(ady, raices) {
    var base = saltos(ady, raices);
    var vivos = [];
    for (var k of ady.keys()) if (base.get(k) !== null) vivos.push(k);
    var art = articulaciones(ady);
    var aislaA = new Map();
    for (var n of ady.keys()) aislaA.set(n, 0);
    for (var caido of art) {
      if (raices.indexOf(caido) >= 0) continue;         // la raíz aparte
      var sub = new Map();
      for (var u of ady.keys()) {
        if (u === caido) continue;
        sub.set(u, ady.get(u).filter(function (v) { return v !== caido; }));
      }
      var d2 = saltos(sub, raices.filter(function (r) { return r !== caido; }));
      var perdidos = 0;
      for (var i = 0; i < vivos.length; i++) {
        if (vivos[i] !== caido && d2.get(vivos[i]) === null) perdidos++;
      }
      aislaA.set(caido, perdidos);
    }
    return { aislaA: aislaA, articulaciones: art, alcanzables: vivos.length };
  }

  /* ── ANÁLISIS COMPLETO ───────────────────────────────────────────────────── */
  function analiza(nodos, enlaza, raices, alcanceMax) {
    var v = vecinosViables(nodos, enlaza, alcanceMax);
    var aristas = 0;
    for (var vs of v.ady.values()) aristas += vs.length;
    aristas /= 2;
    var s = saltos(v.ady, raices);
    var r = redundancia(v.ady, raices);
    var sinRuta = [];
    for (var k of v.ady.keys()) if (s.get(k) === null) sinRuta.push(k);
    var grados = [];
    for (var g of v.ady.values()) grados.push(g.length);
    return {
      ady: v.ady, margenes: v.margenes, saltos: s,
      nodos: nodos.length, aristas: aristas,
      /* SI ESTO ES `true`, LOS PUNTOS DE ARTICULACIÓN NO INFORMAN DE NADA:
         en un árbol todo nodo interno lo es. Va en la salida a propósito. */
      esArbol: aristas === nodos.length - 1 && sinRuta.length === 0,
      sinRuta: sinRuta, articulaciones: r.articulaciones, aislaA: r.aislaA,
      gradoMin: grados.length ? Math.min.apply(null, grados) : 0,
      gradoMax: grados.length ? Math.max.apply(null, grados) : 0,
      gradoMedio: grados.length ? grados.reduce(function (a, b) { return a + b; }, 0) / grados.length : 0,
      podados: v.podados, evaluados: v.evaluados, desconocidos: v.desconocidos
    };
  }

  /* ── LA ELIPSE FRENTE A LA FÍSICA ─────────────────────────────────────────
   * `adyElipse` es lo que da `buildAdjacency`. Esto NO dice cuál acierta: dice
   * en qué se diferencian, que es lo que se puede afirmar.
   *
   *   soloElipse  pares que la elipse da por buenos y la radio no
   *   soloRadio   pares que la radio da por buenos y la elipse no (suele pasar
   *               a lo largo del pasillo, donde el enlace no cruza ninguna fila
   *               y llega mucho más lejos de lo que la elipse admite)
   *   ambas       los que coinciden
   */
  function compara(adyRadio, adyElipse) {
    var eR = new Set(), eE = new Set();
    for (var [u, vs] of adyRadio) for (var i = 0; i < vs.length; i++) eR.add(clave(u, vs[i]));
    for (var [u2, vs2] of adyElipse) for (var j = 0; j < vs2.length; j++) eE.add(clave(u2, vs2[j]));
    var soloR = [], soloE = [], ambas = 0;
    for (var k of eR) { if (eE.has(k)) ambas++; else soloR.push(k.split("\u0000")); }
    for (var k2 of eE) if (!eR.has(k2)) soloE.push(k2.split("\u0000"));
    return {
      ambas: ambas, soloRadio: soloR, soloElipse: soloE,
      totalRadio: eR.size, totalElipse: eE.size,
      /* Jaccard: 1 = idénticas, 0 = sin nada en común. Un número, para poder
         comparar plantas entre sí sin leerse las listas. */
      jaccard: (eR.size + eE.size - ambas) ? ambas / (eR.size + eE.size - ambas) : 1
    };
  }

  var RadioMalla = {
    vecinosViables: vecinosViables, saltos: saltos, articulaciones: articulaciones,
    redundancia: redundancia, analiza: analiza, compara: compara, clave: clave
  };
  raiz.RadioMalla = RadioMalla;
  if (typeof module !== "undefined" && module.exports) module.exports = RadioMalla;
})(typeof window !== "undefined" ? window : globalThis);
