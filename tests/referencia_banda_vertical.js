/* LA BANDA VERTICAL — REFERENCIA, NO MOTOR.
 *
 * Esto NO es el camino de calculo. El motor corta contra el PLANO INCLINADO
 * (`cortaPanel`), porque la banda colapsa el panel sobre el eje de la fila y
 * para la fila propia eso pone el canto difractante donde no esta: la antena
 * queda a 0,113 m del eje y el panel llega a +-1,19·cos alfa, diez veces mas
 * lejos. Ver `radio_pv_model.js`.
 *
 * VIVE AQUI Y CON OTRO NOMBRE a proposito. El motor no puede tener DOS
 * funciones que den el despeje de una fila: el dia que existan las dos, una se
 * queda vieja y nadie lo nota. Hay una puerta en la CI que lo exige.
 *
 * PARA QUE SIRVE ENTONCES. Para carearla: banda y plano tienen que coincidir en
 * ESTADO y en DESPEJE —medido, 0,000000 m de diferencia, incluido el caso
 * tapado— y diferir SOLO en donde ponen el canto. Si algun dia dejaran de
 * coincidir en lo primero, uno de los dos tiene un error, y este fichero es lo
 * que permite verlo. Su valor es el careo, no el calculo.
 *
 * Copiado VERBATIM del motor al sacarlo, con los comentarios originales.
 */
'use strict';
const GRADO = Math.PI / 180;

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

function difraccionBandasRef(D, zA, zB, cruces, fHz, prof, maxProf) {
    var p = prof || 0, tope = maxProf == null ? 3 : maxProf;
    var vacio = { totalDb: 0.0, dominante: null, izquierda: null, derecha: null,
                  profundidad: p, motivo: null };
    if (!cruces || !cruces.length) { vacio.motivo = "sin cruces"; return vacio; }
    if (p >= tope) { vacio.motivo = "tope de recursion (" + tope + ")"; return vacio; }
    if (D <= 0) { vacio.motivo = "tramo de longitud nula"; return vacio; }
    var mejorV = -1e9, mejor = -1, mejorS = 0;
    for (var i = 0; i < cruces.length; i++) {
      var s = cruces[i].s;
      if (s <= 0 || s >= D) continue;
      var z = alturaRayo(zA, zB, D, s);
      var c = corta(cruces[i].banda, z);
      var v = nu(-c.despeje, s, D - s, fHz);      // despeje positivo ⇒ ν negativo
      if (v > mejorV) { mejorV = v; mejor = i; mejorS = s; }
    }
    if (mejor < 0) { vacio.motivo = "ningun cruce cae dentro del tramo"; return vacio; }
    if (mejorV <= -0.78) {
      vacio.motivo = "el dominante despeja (nu = " + mejorV.toFixed(3) + " <= -0,78)";
      return vacio;
    }
    var zDom = alturaRayo(zA, zB, D, mejorS);
    var cDom = corta(cruces[mejor].banda, zDom);
    var bordeDom = cDom.borde;
    var perdidaDom = perdidaFiloDb(mejorV);
    var izq = [], der = [];
    for (var k = 0; k < cruces.length; k++) {
      if (k === mejor) continue;
      if (cruces[k].s < mejorS) izq.push(cruces[k]);
      else der.push({ s: cruces[k].s - mejorS, banda: cruces[k].banda });
    }
    /* los sub-tramos van del extremo al BORDE del dominante, que es donde se
       reconstruye el rayo. Igual que el Deygout del modelo antiguo. */
    var dIzq = difraccionBandasRef(mejorS, zA, bordeDom, izq, fHz, p + 1, tope);
    var dDer = difraccionBandasRef(D - mejorS, bordeDom, zB, der, fHz, p + 1, tope);
    return {
      totalDb: perdidaDom + dIzq.totalDb + dDer.totalDb,
      dominante: { indice: mejor, s: mejorS, zRayo: zDom, nu: mejorV,
                   perdidaDb: perdidaDom, estado: cDom.estado,
                   despeje: cDom.despeje, borde: bordeDom, banda: cruces[mejor].banda },
      izquierda: dIzq, derecha: dDer, profundidad: p, motivo: null
    };
  }

function difraccionBandasRefDb(D, zA, zB, cruces, fHz, prof, maxProf) {
    return difraccionBandasRef(D, zA, zB, cruces, fHz, prof, maxProf).totalDb;
  }

/* los ayudantes de TECNOLOGIA los pide prestados al motor: `nu`,
   `perdidaFiloDb` y `alturaRayo` NO se duplican aqui, que seria justo el error
   que este fichero existe para no cometer. */
const RPV = require('../radio_pv_model.js');
const nu = RPV.nu, perdidaFiloDb = RPV.perdidaFiloDb, alturaRayo = RPV.alturaRayo;

module.exports = { banda, corta, difraccionBandasRef, difraccionBandasRefDb, GRADO };
