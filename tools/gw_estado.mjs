/* LAS CUENTAS SOBRE EL `zigbee_state` DE UN GATEWAY ZIGBEE.
 *
 * ═══ POR QUÉ ESTO NO VIVE DENTRO DEL BANCO ═══
 *
 * Porque entonces no habría nada que mutar. Un banco que calcula Y comprueba
 * sus propias cuentas no tiene cómo demostrar que la cuenta es la que dice:
 * cualquier mutación cambiaría las dos mitades a la vez y saldría verde. Las
 * cuentas van aquí, el careo contra lo publicado va en
 * `tests/test_gateway_estado.js`, y las mutaciones muerden este fichero.
 *
 * ═══ EL ERROR QUE ESTO EXISTE PARA NO REPETIR ═══
 *
 * El 2026-10-05, con el volcado de los dos gateways de San José NCU 18 delante,
 * la primera lectura fue «GW1 falla 25 veces más que GW2»: 30 805 fallos de ACK
 * contra 1 227. Es FALSO, y no por poco. Los dos contadores son ACUMULADOS
 * DESDE ARRANQUES DISTINTOS —GW1 llevaba 9,9 días encendido y GW2 3,3—, así que
 * comparar los totales compara tres días con diez. Normalizados por su base de
 * tiempo son 8,4 veces, no 25.
 *
 * Y hay una segunda normalización que NO es obvia cuál toca: GW1 lleva 38 TCU y
 * GW2 lleva 84. Si el tráfico escala con el número de nodos, lo que hay que
 * comparar es fallos por nodo y por segundo, y entonces son 18,6 veces. Las dos
 * cuentas se publican CON SU SUPUESTO, porque no se sabe cómo escala el sondeo:
 *
 *    8,4 x   si los dos gateways cursan tráfico comparable
 *   18,6 x   si el tráfico escala con el número de nodos
 *   25,1 x   NO ES NINGUNA DE LAS DOS: es el error de no normalizar
 */

/* IEEE 802.15.4 en la banda de 2,4 GHz: 16 canales, del 11 al 26, separados
   5 MHz. No es una estimación, es la rejilla de la norma. */
export const CANAL_BASE = 11;
export const CANAL_TOPE = 26;
export const F_CANAL_11_MHZ = 2405;
export const PASO_CANAL_MHZ = 5;

export function mhzDeCanal(k) {
  if (!Number.isInteger(k) || k < CANAL_BASE || k > CANAL_TOPE) return null;
  return F_CANAL_11_MHZ + PASO_CANAL_MHZ * (k - CANAL_BASE);
}

/* La tasa de fallos de ACK, que es lo único comparable entre dos gateways con
   uptimes distintos. `uptime_s` es la ÚNICA base de tiempo disponible: estos
   equipos no tienen reloj —su `datetime` es «1970 (based on uptime)»— así que
   no hay forma de fechar nada de lo que publican. */
export function tasas(gw) {
  if (gw == null || !Number.isFinite(gw.ack_failures) || !Number.isFinite(gw.uptime_s) ||
      gw.uptime_s <= 0) return null;
  const porSegundo = gw.ack_failures / gw.uptime_s;
  const nodos = Number.isFinite(gw.nodos) && gw.nodos > 0 ? gw.nodos : null;
  return {
    porSegundo,
    porDia: porSegundo * 86400,
    porDiaYNodo: nodos === null ? null : porSegundo * 86400 / nodos,
    dias: gw.uptime_s / 86400,
  };
}

/* Cuántas veces peor es `a` que `b`, normalizado por tiempo. */
export function ratioPorTiempo(a, b) {
  const ta = tasas(a), tb = tasas(b);
  if (!ta || !tb || tb.porSegundo === 0) return null;
  return ta.porSegundo / tb.porSegundo;
}

/* Lo mismo, normalizado además por número de nodos. Devuelve null si alguno de
   los dos no declara cuántos nodos lleva: un ratio por nodo calculado sin saber
   los nodos sería un número con pinta de bueno. */
export function ratioPorTiempoYNodo(a, b) {
  const ta = tasas(a), tb = tasas(b);
  if (!ta || !tb || ta.porDiaYNodo === null || tb.porDiaYNodo === null ||
      tb.porDiaYNodo === 0) return null;
  return ta.porDiaYNodo / tb.porDiaYNodo;
}

/* El ratio EN BRUTO. Existe con nombre propio y documentado como trampa para
   que nadie lo vuelva a usar por descuido creyendo que compara algo. */
export function ratioEnBruto(a, b) {
  if (!b || b.ack_failures === 0) return null;
  return a.ack_failures / b.ack_failures;
}

/* En qué campos coinciden dos gateways. Sirve para la afirmación «todo lo
   configurable es idéntico en los dos», que es la que descarta de un golpe
   firmware, modelo, potencia configurada y tamaño de trama como causa de la
   avería. Devuelve las dos listas, no un booleano: saber CUÁLES difieren es el
   dato, y un `true/false` lo perdería. */
export function careo(a, b, campos) {
  const iguales = [], distintos = [];
  for (const c of campos) {
    if (a[c] === undefined || b[c] === undefined) continue;
    (a[c] === b[c] ? iguales : distintos).push(c);
  }
  return { iguales, distintos };
}

/* LA VENTANA DE ARRANQUE, no un instante.
 *
 * El gateway no tiene reloj, así que su arranque sólo se puede situar restando
 * el uptime del momento del volcado — y del volcado se sabe el DÍA, no la hora.
 * Así que esto devuelve el intervalo [lo más temprano, lo más tarde] que el
 * arranque pudo caer, y quien lo use tiene que razonar sobre el intervalo. Un
 * instante único aquí sería una precisión inventada.
 */
export function ventanaDeArranque(uptime_s, diaDelVolcadoISO) {
  if (!Number.isFinite(uptime_s) || uptime_s <= 0) return null;
  const d0 = Date.parse(diaDelVolcadoISO + 'T00:00:00Z');
  if (!Number.isFinite(d0)) return null;
  const ms = uptime_s * 1000;
  return {
    masTemprano: new Date(d0 - ms),                    // el volcado a las 00:00
    masTarde:    new Date(d0 + 86399999 - ms),         // el volcado a las 23:59:59
  };
}

/* ¿Puede el contador de este gateway abarcar un suceso de una fecha dada?
 * Sólo si el arranque MÁS TARDÍO posible es anterior al suceso; si el arranque
 * más temprano ya es posterior, el contador no lo vio y punto. El caso
 * intermedio -no se puede decidir con el día del volcado- devuelve "quiza", que
 * no es ni sí ni no y hay que tratarlo como lo que es.
 */
export function abarcaElSuceso(uptime_s, diaDelVolcadoISO, diaDelSucesoISO) {
  const v = ventanaDeArranque(uptime_s, diaDelVolcadoISO);
  if (!v) return null;
  const finDelSuceso = Date.parse(diaDelSucesoISO + 'T23:59:59Z');
  const iniDelSuceso = Date.parse(diaDelSucesoISO + 'T00:00:00Z');
  if (v.masTemprano.getTime() > finDelSuceso) return 'no';
  if (v.masTarde.getTime() < iniDelSuceso) return 'si';
  return 'quiza';
}
