/* terreno_planta.js — la cota del suelo de una planta, de UNA sola fuente.
 *
 * ┌─ QUÉ FICHERO SE LEE, Y POR QUÉ ÉSE ────────────────────────────────────────┐
 * │ `<planta>_relieve.json` de cobertura-zigbee. NO es un formato nuevo: es el  │
 * │ que ya existe, ya lo escribe `tools/kml_curvas_a_cotas.mjs` y ya lo         │
 * │ CONSUME EL 3D (`terreno.html`, `relAt`), hoy con `dicayagua_relieve.json`   │
 * │ declarado en su registro de plantas.                                       │
 * │                                                                            │
 * │ Un fichero por planta, dos consumidores. Inventar aquí un segundo formato  │
 * │ sería exactamente la avería que este repo persigue: dos caminos que dan la  │
 * │ misma magnitud y se separan sin que nadie lo note.                          │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * EL MUESTREO ES EL MISMO, TRANSCRITO. `cotaEn` de aquí y `relAt` del 3D tienen
 * que dar el MISMO número sobre el MISMO fichero, o «una sola fuente» es
 * mentira. La regla del 3D, verbatim:
 *
 *     fi = (x − x0)/paso, fj = (n − n0)/paso, i0 = floor(fi), j0 = floor(fj)
 *     fuera de [0, nx−2] x [0, nn−2]  ->  null
 *     alguna de las cuatro esquinas a null  ->  null
 *     si no, bilineal sobre z[j*nx + i]
 *
 * `tests/test_terreno_planta.js` carea las dos transcripciones sobre casos con
 * el valor calculado a mano, y hay una mutación por cada rama.
 *
 * ┌─ EL NULO NO SE RELLENA ────────────────────────────────────────────────────┐
 * │ El propio fichero declara de sus huecos «null = sin dato, usar DEM». El 3D  │
 * │ tiene DEM (teselas Terrarium por red). ESTE REPO NO TIENE NINGUNO. Así que  │
 * │ donde el fichero dice «no sé», aquí se dice «no sé»: cota null, perfil      │
 * │ null, `relieveDb` null CON MOTIVO. Rellenar el hueco —con el vecino, con la │
 * │ media, con una recta— sería geometría inventada, y no se hace.              │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ LA COTA ES ABSOLUTA, Y ESTO YA MORDIÓ UNA VEZ ────────────────────────────┐
 * │ `z` va en METROS SOBRE EL NIVEL DEL MAR. El motor quiere `zA`/`zB` en el    │
 * │ MISMO dato que el perfil, o sea COTA DEL SUELO + altura de antena. Pasarle  │
 * │ el perfil absoluto con la antena a 0,475 m sobre CERO da la antena por      │
 * │ debajo de su propia referencia: medido en el banco de A3, el relieve salía  │
 * │ −5,61 dB con un cerro de 5 m y −12,07 dB con uno de 10. Por eso             │
 * │ `perfilEntre` devuelve `zSuelo` de los dos extremos: para que quien llame   │
 * │ no tenga que acordarse.                                                     │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * QUÉ PLANTAS TIENEN TERRENO VALIDADO, HOY. Las que dice
 * `cobertura-zigbee/censo_relieve_cartera.csv`, que es un censo medido y no una
 * lista de deseos: **ayora** (cobertura 100,0 %) y **sanjose** (95,3 %) son las
 * únicas EVALUADAS con levantamiento. Las otras nueve están SIN LEVANTAMIENTO.
 * Dicayagua trae curvas de nivel propias —y es la que hoy tiene el fichero—
 * pero es una oferta de estructura FIJA, sin TCU ni radio.
 *
 * O sea que hoy el número honesto para casi toda la cartera es `relieveDb =
 * null` con motivo, y eso NO es un fallo de este módulo: es el estado del dato.
 */
(function (raiz) {
  "use strict";

  /* Motivos, en un solo sitio para que el banco y la app digan lo mismo. */
  var MOTIVOS = {
    SIN_FICHERO:  "relieve_sin_terreno_validado",
    FUERA:        "relieve_vano_fuera_de_la_malla",
    HUECO:        "relieve_hueco_en_el_vano",
    VANO_NULO:    "relieve_vano_de_longitud_cero"
  };

  /* Valida la forma del fichero. Se es estricto A PROPÓSITO: una malla con
     `z.length` distinto de `nx*nn` se muestrea sin quejarse y devuelve cotas de
     otra fila, que es el fallo silencioso más caro que hay aquí. */
  function cargaRelieve(obj) {
    if (!obj || typeof obj !== "object") return null;
    var req = ["x0", "n0", "paso", "nx", "nn"], i;
    for (i = 0; i < req.length; i++) {
      if (typeof obj[req[i]] !== "number" || !isFinite(obj[req[i]])) return null;
    }
    if (!(obj.paso > 0) || !(obj.nx >= 2) || !(obj.nn >= 2)) return null;
    if (!Array.isArray(obj.z) || obj.z.length !== obj.nx * obj.nn) return null;
    return {
      planta: obj.planta || null,
      crs: obj.crs || null,
      cE: typeof obj.cE === "number" ? obj.cE : null,
      cN: typeof obj.cN === "number" ? obj.cN : null,
      x0: obj.x0, n0: obj.n0, paso: obj.paso, nx: obj.nx, nn: obj.nn,
      z: obj.z,
      fuente: obj.fuente || null,
      nota: obj.nota || null
    };
  }

  /* LA MISMA CUENTA QUE `relAt` DEL 3D. Si esto cambia, cambia allí. */
  function cotaEn(T, x, n) {
    if (!T) return null;
    var fi = (x - T.x0) / T.paso, fj = (n - T.n0) / T.paso;
    var i0 = Math.floor(fi), j0 = Math.floor(fj);
    if (i0 < 0 || j0 < 0 || i0 + 1 >= T.nx || j0 + 1 >= T.nn) return null;
    var a = T.z[j0 * T.nx + i0],     b = T.z[j0 * T.nx + i0 + 1];
    var c = T.z[(j0 + 1) * T.nx + i0], d = T.z[(j0 + 1) * T.nx + i0 + 1];
    if (a == null || b == null || c == null || d == null) return null;
    var tx = fi - i0, tn = fj - j0;
    return (a * (1 - tx) + b * tx) * (1 - tn) + (c * (1 - tx) + d * tx) * tn;
  }

  /* EL PASO DEL PERFIL ES EL PASO DEL FICHERO, y no es pereza.
   *
   * Sobre una recta que no va paralela a los ejes, la bilineal es una CUÁDRICA
   * del parámetro: muestrear más fino que la malla SÍ cambia el perfil, y puede
   * subir el canto que ve Bullington. Pero lo que encuentra no es terreno, es la
   * propia interpolación: la malla de Dicayagua tiene 10 m de paso y las curvas
   * de las que sale están a 2 m de equidistancia vertical. Dar 1 m de paso sería
   * presentar como relieve la forma del interpolador.
   *
   * Así que por defecto se muestrea al paso del fichero, el perfil devuelve el
   * `paso` que usó para que quien lo lea pueda decir a qué resolución está, y
   * `opts.paso` queda abierto para MEDIR la sensibilidad —que es lo que hace
   * `tools/perfil_terreno.mjs`— en vez de afirmar que no la hay.
   *
   * Los dos EXTREMOS entran siempre, pase lo que pase con el paso: el motor
   * recorta el perfil al vano (`recortaPerfil`) y sin el punto final no llega.
   */
  function perfilEntre(T, xa, na, xb, nb, opts) {
    opts = opts || {};
    if (!T) return { perfil: null, motivo: MOTIVOS.SIN_FICHERO };
    var D = Math.hypot(xb - xa, nb - na);
    if (!(D > 0)) return { perfil: null, motivo: MOTIVOS.VANO_NULO };
    var paso = (typeof opts.paso === "number" && opts.paso > 0) ? opts.paso : T.paso;
    var nSeg = Math.max(1, Math.ceil(D / paso));
    var perfil = [], k, s, u, z, huecoFuera = false, hueco = false;
    for (k = 0; k <= nSeg; k++) {
      u = k / nSeg;
      s = u * D;
      z = cotaEn(T, xa + (xb - xa) * u, na + (nb - na) * u);
      if (z === null) {
        /* SE DISTINGUE «fuera de la malla» de «hueco dentro». No es cosmética:
           fuera de la malla es «este vano no le toca a este fichero», y un
           hueco dentro es «el levantamiento no llegó ahí». La primera se
           arregla con otro fichero y la segunda con otro levantamiento. */
        if (dentroDeLaMalla(T, xa + (xb - xa) * u, na + (nb - na) * u)) hueco = true;
        else huecoFuera = true;
        continue;
      }
      perfil.push([s, z]);
    }
    /* PRECEDENCIA, cuando el vano se sale Y ADEMÁS pisa un hueco: manda
       «fuera». Los dos son ciertos, así que había que elegir uno y dejarlo
       escrito, porque si depende de cuál aparece antes el motivo cambia con la
       dirección del enlace. Manda «fuera» porque es lo que se puede afirmar del
       FICHERO —no cubre este vano—, mientras que el hueco es del
       LEVANTAMIENTO, y no se diagnostica un levantamiento en un trozo que el
       fichero ni siquiera alcanza. */
    if (hueco || huecoFuera) {
      return { perfil: null, motivo: huecoFuera ? MOTIVOS.FUERA : MOTIVOS.HUECO };
    }
    return {
      perfil: perfil,
      motivo: null,
      paso: D / nSeg,
      n: perfil.length,
      zSuelo: [perfil[0][1], perfil[perfil.length - 1][1]],
      D: D
    };
  }

  /* Dentro del rectángulo muestreable, que NO es el rectángulo de la malla: el
     último nodo de cada eje no tiene vecino con el que interpolar, así que la
     bilineal acaba en nx−1 / nn−1. Es la misma frontera que aplica `cotaEn`. */
  function dentroDeLaMalla(T, x, n) {
    if (!T) return false;
    var i0 = Math.floor((x - T.x0) / T.paso), j0 = Math.floor((n - T.n0) / T.paso);
    return i0 >= 0 && j0 >= 0 && i0 + 1 < T.nx && j0 + 1 < T.nn;
  }

  /* Cobertura de un fichero sobre una lista de puntos {x, n}: cuántos caen en
     nodo con dato. Sirve para decir «este terreno cubre el 95,3 % de esta
     planta» con el número medido, no copiado del censo. */
  function cobertura(T, puntos) {
    var con = 0, fuera = 0, huecos = 0, i, z;
    if (!T || !puntos || !puntos.length) return { n: 0, con: 0, fuera: 0, huecos: 0, frac: null };
    for (i = 0; i < puntos.length; i++) {
      z = cotaEn(T, puntos[i].x, puntos[i].n);
      if (z !== null) con++;
      else if (dentroDeLaMalla(T, puntos[i].x, puntos[i].n)) huecos++;
      else fuera++;
    }
    return { n: puntos.length, con: con, fuera: fuera, huecos: huecos, frac: con / puntos.length };
  }

  var TerrenoPlanta = {
    MOTIVOS: MOTIVOS,
    cargaRelieve: cargaRelieve,
    cotaEn: cotaEn,
    dentroDeLaMalla: dentroDeLaMalla,
    perfilEntre: perfilEntre,
    cobertura: cobertura,
    _version: "fase1"
  };
  raiz.TerrenoPlanta = TerrenoPlanta;
  /* misma salida doble que el resto del motor: la página con <script>, los
     bancos con require(). */
  if (typeof module !== "undefined" && module.exports) module.exports = TerrenoPlanta;
})(typeof window !== "undefined" ? window : globalThis);
