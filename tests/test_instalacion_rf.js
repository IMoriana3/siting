// Contrato RF opcional: dos GW -> PE2088 -> un coax y antena común.
// Bancos sintéticos; no utiliza ni publica los CSV de planta.
// node tests/test_instalacion_rf.js
"use strict";
const I = require("../radio_instalacion.js");
const Z = require("../radio_zigbee.js");
let n = 0, errores = 0;
function check(descripcion, pasa, detalle) {
  n++;
  if (!pasa) { errores++; console.log("FAIL " + descripcion + (detalle ? " " + detalle : "")); }
  else console.log("OK   " + descripcion);
}
function cerca(a, b, eps) { return a != null && Math.abs(a - b) <= (eps || 1e-8); }
function falla(fn) { try { fn(); return false; } catch (_) { return true; } }
function plantilla() {
  return {
    id: "NCU-DEMO", tipo: "dos_gateways_una_antena",
    gateways: [
      {id: "G1", puerto: 1, canal: 15, potenciaDbm: null, sensibilidadDbm: null, latiguilloPerdidaDb: null},
      {id: "G2", puerto: 2, canal: 19, potenciaDbm: null, sensibilidadDbm: null, latiguilloPerdidaDb: null}
    ],
    comun: {
      antena: {modelo: "ANT-2.4-CW-HW", gananciaPicoDbi: 3.2, patronDb: null},
      combinador: {modelo: "PE2088", perdidaDb: {min: 3.01, max: 3.51}},
      cable: {modelo: "ZCBEXTANT03 LMR195 4m", perdidaDb: 2.47},
      conexionesPerdidaDb: null
    }
  };
}
function tcu() {
  return {
    id: "T-DEMO", potenciaDbm: null, sensibilidadDbm: null,
    antena: {modelo: "AW5405-11-001-C", gananciaPicoDbi: 1.83, patronDb: null},
    coaxPerdidaDb: null, conexionesPerdidaDb: null
  };
}
const ncu = plantilla(), gw1 = I.extremoGateway(ncu, "G1"), gw2 = I.extremoGateway(ncu, "G2"), tc = I.extremoTcu(tcu());
check("dos gateways con IDs independientes", gw1.id !== gw2.id);
check("dos canales independientes", gw1.canal === 15 && gw2.canal === 19);
check("UNA antena compartida", gw1.comunId === gw2.comunId && gw1.antenaId === "ANT-2.4-CW-HW");
check("un puerto del PE2088 por gateway", gw1.puerto === 1 && gw2.puerto === 2);
check("el combinador se cobra UNA vez (mínimo)", cerca(gw1.perdidaConocidaMinDb, 3.01 + 2.47));
check("el combinador se cobra UNA vez (máximo)", cerca(gw1.perdidaConocidaMaxDb, 3.51 + 2.47));
check("latiguillo y conectores desconocidos NO se dan por cero", gw1.faltan.length === 2);
check("no se heredan 19 ni 8 dBm de otra NCU", gw1.potenciaDbm === null && gw2.potenciaDbm === null);
check("no se inventa ganancia de patrón", gw1.patronDb === null);
check("identidad TCU con otra antena", tc.antenaId === "AW5405-11-001-C" && cerca(tc.gananciaPicoDbi, 1.83));
check("no se acepta gateway sin inventario", falla(function () { I.extremoGateway(ncu, "G3"); }));
const dups = plantilla(); dups.gateways[1].puerto = 1;
check("no se acepta compartir un puerto entre dos GW", falla(function () { I.extremoGateway(dups, "G1"); }));
const malos = plantilla(); malos.comun.cable.perdidaDb = -1;
check("no se aceptan pérdidas negativas", falla(function () { I.extremoGateway(malos, "G1"); }));
let b = I.balance(gw1, tc, 80);
check("sin potencia TX no hay RSSI calculado", b.rssiDbm === null && b.rssiCondicionalDbm === null);
check("el motivo señala la potencia ausente", b.faltan.includes("potencia TX del equipo"));
const ncuC = plantilla(), tcuC = tcu();
ncuC.gateways[0].potenciaDbm = 8;             // caso SINTÉTICO, no El Burgo
ncuC.gateways[0].sensibilidadDbm = -101;
ncuC.gateways[0].latiguilloPerdidaDb = 0;    // sintético explícito
ncuC.comun.conexionesPerdidaDb = 0;          // sintético explícito
ncuC.comun.antena.patronDb = 0;              // dirección del pico sintética
tcuC.potenciaDbm = 5;                       // sintético
tcuC.sensibilidadDbm = -102;                // sintético
tcuC.coaxPerdidaDb = 0;                     // sintético
tcuC.conexionesPerdidaDb = 0;               // sintético
tcuC.antena.patronDb = 0;                   // sintético
const gx = I.extremoGateway(ncuC, "G1"), tx = I.extremoTcu(tcuC);
b = I.balance(gx, tx, 80);
check("se publica intervalo, NO su punto medio", b.rssiDbm === null && b.rssiCondicionalDbm.length === 2);
check("rango sintético: PE2088 + coax en GW→TCU", cerca(b.rssiCondicionalDbm[0], -72.95) && cerca(b.rssiCondicionalDbm[1], -72.45), JSON.stringify(b.rssiCondicionalDbm));
check("la cota superior usa la pérdida mínima", cerca(b.rssiCotaSuperiorDbm, -72.45));
const rev = I.balance(tx, gx, 80);
check("también hay combinador en TCU→GW", cerca(rev.rssiCondicionalDbm[1], -75.45));
check("la potencia TX depende del transmisor", cerca(b.rssiCondicionalDbm[1] - rev.rssiCondicionalDbm[1], 3));
const exacta = plantilla(); exacta.gateways[0] = ncuC.gateways[0]; exacta.comun.combinador.perdidaDb = 3.01;
const be = I.balance(I.extremoGateway(exacta, "G1"), tx, 80);
check("con todas las pérdidas conocidas hay RSSI escalar", cerca(be.rssiDbm, -72.45));
check("margen sale de RSSI menos sensibilidad de RX", cerca(be.margenDb, 29.55));
const sinSens = tcu(); Object.assign(sinSens, tcuC, {sensibilidadDbm: null});
const u = I.balance(I.extremoGateway(exacta, "G1"), I.extremoTcu(sinSens), 80);
check("falta de sensibilidad anula margen, no la predicción RSSI", cerca(u.rssiDbm, -72.45) && u.margenDb === null);
const PROP = {eps_r_suelo: 15, sigma_suelo_s_m: 0.005, polarizacion: "v", sigma_db: null, vegetacion: {modelo: null}};
const V = {nombre: "LEGACY", f_hz: 2.45e9, ptx_dbm: 19, gtx_dbi: 3, grx_dbi: 3, rx_sens_dbm: -103, canal: {valor: 15}};
const E = {D: 100, zA: 2, zB: 2, cruces: []};
const legacy = Z.presupuesto(E, V, PROP, null);
const legacy2 = Z.presupuesto(Object.assign({}, E), V, PROP, null);
check("sin montaje, el camino LEGACY no cambia", legacy.prxDbm === legacy2.prxDbm && legacy.margenDb === legacy2.margenDb);
const montado = Z.presupuesto(Object.assign({}, E, {montajeRf: {tx: gx, rx: tx}}), V, PROP, null);
check("el motor integra el montaje cuando se solicita", !!montado.montajeRf && montado.prxDbm === null);
check("no convierte intervalo condicionado en margen puntual", montado.margenDb === null && montado.motivos.includes("montaje_rf_no_cerrado"));
const completo = Z.presupuesto(Object.assign({}, E, {montajeRf: {tx: I.extremoGateway(exacta, "G1"), rx: tx}}), V, PROP, null);
check("el motor sustituye el default heredado por potencia declarada del montaje", cerca(completo.prxDbm, completo.montajeRf.rssiDbm) && completo.prxDbm !== legacy.prxDbm);
check("el motor calcula margen con receptor real del ejemplo", cerca(completo.margenDb, completo.prxDbm + 102));
console.log("\n" + n + " comprobaciones, " + errores + " fallos");
process.exitCode = errores ? 1 : 0;
