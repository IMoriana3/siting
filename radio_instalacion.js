/* radio_instalacion.js — montaje RF por extremo, sin geometría ni propagación.
 *
 * NCU: dos gateways distintos -> PE2088 reversible -> una antena y un cable
 * comunes. El PE2088 cobra una división de ~3 dB POR TRAYECTO por cada
 * extremo NCU atravesado, en TX o RX. Nunca "3 dB por cada gateway" en
 * un enlace que sólo conecta con uno.
 *
 * SIN DATOS NO HAY RSSI ÚNICO: se publica un intervalo CONDICIONAL a pérdidas
 * desconocidas nulas y ganancia de pico; NO es un intervalo de medida.
 * La atribución del montaje a una NCU concreta es trabajo del inventario:
 * este módulo no asume que todas las NCU ni las TCU llevan el mismo hardware.
 */
(function (raiz) {
  "use strict";

  function numero(v, nombre) {
    if (v == null) return null;
    if (typeof v !== "number" || !isFinite(v)) throw new Error(nombre + ": no es numero finito");
    return v;
  }
  function perdida(v, nombre) {
    if (v == null) return null;
    var r = typeof v === "number" ? {min: v, max: v} : v;
    if (!r || typeof r !== "object") throw new Error(nombre + ": rango invalido");
    var min = numero(r.min, nombre + ".min"), max = numero(r.max, nombre + ".max");
    if (min === null || max === null || min < 0 || max < min)
      throw new Error(nombre + ": perdida no negativa, minimo <= maximo");
    return {min: min, max: max};
  }
  function patron(v, nombre) {
    var n = numero(v, nombre);
    if (n !== null && n > 0) throw new Error(nombre + ": la correccion frente al pico no puede ser positiva");
    return n;
  }
  function cadena(partes) {
    var min = 0, max = 0, faltan = [], detalle = [];
    partes.forEach(function (p) {
      var r = perdida(p.valor, p.nombre);
      if (r === null) faltan.push(p.nombre);
      else {
        min += r.min; max += r.max;
        detalle.push({nombre: p.nombre, minDb: r.min, maxDb: r.max});
      }
    });
    return {min: min, max: max, faltan: faltan, detalle: detalle};
  }
  function extremoGateway(ncu, gatewayId) {
    if (!ncu || ncu.tipo !== "dos_gateways_una_antena" ||
        !Array.isArray(ncu.gateways) || ncu.gateways.length !== 2 ||
        !ncu.comun || !ncu.comun.antena || !ncu.comun.cable || !ncu.comun.combinador)
      throw new Error("NCU: falta topologia de dos GW y UNA antena comun");
    var ids = ncu.gateways.map(function (g) { return g.id; });
    var puertos = ncu.gateways.map(function (g) { return g.puerto; });
    if (ids.some(function (v) { return !v; }) || ids[0] === ids[1] ||
        puertos[0] == null || puertos[1] == null || puertos[0] === puertos[1])
      throw new Error("NCU: IDs y puertos del combinador deben ser distintos");
    var gw = ncu.gateways.filter(function (g) { return g.id === gatewayId; })[0];
    if (!gw) throw new Error("NCU: gateway no inventariado: " + gatewayId);
    if (gw.canal != null && (numero(gw.canal, "canal") < 11 || gw.canal > 26))
      throw new Error("NCU: canal 802.15.4 fuera de 11-26");
    var c = cadena([
      {nombre: "PE2088", valor: ncu.comun.combinador.perdidaDb},
      {nombre: "cable exterior", valor: ncu.comun.cable.perdidaDb},
      {nombre: "latiguillo interno " + gatewayId, valor: gw.latiguilloPerdidaDb},
      {nombre: "conectores/adaptadores", valor: ncu.comun.conexionesPerdidaDb}
    ]);
    return {
      tipo: "GW", id: gatewayId, ncuId: ncu.id, puerto: gw.puerto, canal: gw.canal,
      antenaId: ncu.comun.antena.modelo, comunId: ncu.id + ":antena",
      potenciaDbm: numero(gw.potenciaDbm, "potencia GW"),
      sensibilidadDbm: numero(gw.sensibilidadDbm, "sensibilidad GW"),
      gananciaPicoDbi: numero(ncu.comun.antena.gananciaPicoDbi, "ganancia antena GW"),
      patronDb: patron(ncu.comun.antena.patronDb, "patron GW"),
      perdidaConocidaMinDb: c.min, perdidaConocidaMaxDb: c.max,
      faltan: c.faltan, componentes: c.detalle
    };
  }
  function extremoTcu(tcu) {
    if (!tcu || !tcu.id || !tcu.antena) throw new Error("TCU: falta identidad o antena");
    var c = cadena([
      {nombre: "coax/instalacion TCU", valor: tcu.coaxPerdidaDb},
      {nombre: "conectores TCU", valor: tcu.conexionesPerdidaDb}
    ]);
    return {
      tipo: "TCU", id: tcu.id, antenaId: tcu.antena.modelo,
      potenciaDbm: numero(tcu.potenciaDbm, "potencia TCU"),
      sensibilidadDbm: numero(tcu.sensibilidadDbm, "sensibilidad TCU"),
      gananciaPicoDbi: numero(tcu.antena.gananciaPicoDbi, "ganancia antena TCU"),
      patronDb: patron(tcu.antena.patronDb, "patron TCU"),
      perdidaConocidaMinDb: c.min, perdidaConocidaMaxDb: c.max,
      faltan: c.faltan, componentes: c.detalle
    };
  }
  function balance(tx, rx, perdidaPropagacionDb) {
    if (!tx || !rx) throw new Error("balance RF: faltan extremos");
    var lp = numero(perdidaPropagacionDb, "perdida de propagacion");
    if (lp === null) throw new Error("balance RF: falta perdida de propagacion");
    var faltan = (tx.faltan || []).map(function (n) { return "TX: " + n; })
      .concat((rx.faltan || []).map(function (n) { return "RX: " + n; }));
    if (tx.potenciaDbm == null) faltan.push("potencia TX del equipo");
    if (tx.gananciaPicoDbi == null) faltan.push("ganancia de antena TX");
    if (rx.gananciaPicoDbi == null) faltan.push("ganancia de antena RX");
    if (tx.patronDb == null) faltan.push("patron/direccion TX");
    if (rx.patronDb == null) faltan.push("patron/direccion RX");
    var rssi = null, margen = null, intervalo = null, cotaSuperior = null;
    var sensibilidad = rx.sensibilidadDbm;
    if (sensibilidad == null) faltan.push("sensibilidad RX del equipo");
    if (tx.potenciaDbm != null && tx.gananciaPicoDbi != null && rx.gananciaPicoDbi != null) {
      // En la cota usamos ganancias de PICO y las pérdidas físicas conocidas.
      // Ninguna pérdida omitida se finge cero para publicar el RSSI calculado.
      var cima = tx.potenciaDbm + tx.gananciaPicoDbi + rx.gananciaPicoDbi - lp;
      cotaSuperior = cima - tx.perdidaConocidaMinDb - rx.perdidaConocidaMinDb;
      var ptr = tx.patronDb == null ? 0 : tx.patronDb;
      var prr = rx.patronDb == null ? 0 : rx.patronDb;
      intervalo = [
        cima + ptr + prr - tx.perdidaConocidaMaxDb - rx.perdidaConocidaMaxDb,
        cima + ptr + prr - tx.perdidaConocidaMinDb - rx.perdidaConocidaMinDb
      ];
      if (!faltan.length && intervalo[0] === intervalo[1]) {
        rssi = intervalo[0];
        margen = rssi - sensibilidad;
      }
    }
    return {
      tx: tx.id, rx: rx.id, mismaAntenaCompartida: !!(tx.comunId && tx.comunId === rx.comunId),
      rssiDbm: rssi, margenDb: margen,
      rssiCondicionalDbm: intervalo,
      rssiCotaSuperiorDbm: cotaSuperior,
      sensibilidadRxDbm: sensibilidad == null ? null : sensibilidad,
      faltan: faltan,
      nota: "Rango condicional: supone cero perdidas adicionales desconocidas; no sustituye RSSI medido ni un margen completo."
    };
  }
  var api = {extremoGateway: extremoGateway, extremoTcu: extremoTcu, balance: balance};
  raiz.RadioInstalacion = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
