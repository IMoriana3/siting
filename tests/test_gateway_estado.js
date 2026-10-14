#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * EL ESTADO DE LOS DOS GATEWAYS DE SAN JOSÉ NCU 18, Y LAS CIFRAS PUBLICADAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * QUÉ MIDE: que cada número del apartado «EL GATEWAY LLEVA SU PROPIO CONTADOR»
 * de `FASE3_LATENCIA_STOW.md` sale de `tests/fixture_gw_estado.json` y no de
 * ningún otro sitio. El documento NO es la fuente: es lo que se carea.
 *
 * POR QUÉ EXISTE. El 2026-09-24 este mismo documento publicó una velocidad de
 * stow —0,1774 °/s, 310 s, R² 0,9987— que NO REPRODUCÍA. Se barrieron 144
 * combinaciones de parámetros y ninguna la daba; había salido de promediar
 * ajustes que incluían uno con velocidad negativa. La cifra estuvo publicada
 * semanas. Desde entonces: toda cifra que salga en un documento se carea
 * PROGRAMÁTICAMENTE contra su fuente, o no se publica.
 *
 * Y el 2026-10-05 pasó la segunda versión del mismo error, en este apartado:
 * la primera lectura del volcado fue «GW1 falla 25 veces más», comparando dos
 * contadores acumulados desde arranques distintos. Lo cazó mirar el `uptime`,
 * que venía en el mismo volcado dos líneas más arriba.
 *
 * rc = 0 MIDE · 1 ROJO · 2 NO COMPROBADO (que no es un verde)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');

const PISO = 34;  // menos comprobaciones que esto = alguien ha borrado alcance
let ok = 0, fallos = 0;
function check(q, cond, extra) {
  if (cond) { ok++; console.log('OK   ' + q + (extra !== undefined ? '  (' + extra + ')' : '')); }
  else      { fallos++; console.log('FAIL ' + q + (extra !== undefined ? '  -> ' + extra : '')); }
}
function cerca(a, b, tol) { return typeof a === 'number' && Math.abs(a - b) <= tol; }

/* ── LA FICHA Y EL MÓDULO. Si falta cualquiera de los dos, rc = 2: este banco
      no puede decir «bien» sobre algo que no ha podido leer. ───────────────── */
const FICHA = path.join(__dirname, 'fixture_gw_estado.json');
const MOD   = path.join(RAIZ, 'tools', 'gw_estado.mjs');
for (const f of [FICHA, MOD]) {
  if (!fs.existsSync(f)) {
    console.error('SIN ALCANCE: no encuentro ' + f + '. El vacío es ERROR, no PASS.');
    process.exit(2);
  }
}
const DOC = path.join(RAIZ, 'FASE3_LATENCIA_STOW.md');
if (!fs.existsSync(DOC)) {
  console.error('SIN ALCANCE: no encuentro ' + DOC + ', que es lo que hay que carear.');
  process.exit(2);
}

/* ── LAS MUTACIONES. Muerden `tools/gw_estado.mjs`, que es donde viven las
      cuentas; el careo contra el documento vive aquí. Si la cuenta y el careo
      estuvieran en el mismo fichero, una mutación movería las dos mitades a la
      vez y el banco saldría verde: eso no mediría nada. ───────────────────── */
const MUTACIONES = {
  /* EL ERROR DE VERDAD, EL QUE SE COMETIÓ: comparar los acumulados sin dividir
     por el uptime. Da 25,1× en vez de 8,4×, un factor 3 de más. */
  sinNormalizar: [/return ta\.porSegundo \/ tb\.porSegundo;/,
                  'return a.ack_failures / b.ack_failures;'],
  /* LA SEGUNDA NORMALIZACIÓN DESAPARECE: el ratio por nodo pasa a ser el de
     tiempo, 8,4 en vez de 18,6, y se pierde que GW2 lleva 2,2 veces más nodos. */
  sinNodos:      [/return ta\.porDiaYNodo \/ tb\.porDiaYNodo;/,
                  'return ta.porSegundo / tb.porSegundo;'],
  /* ...o se calcula un ratio por nodo SIN SABER los nodos, que es el fallo
     tentador: un número con pinta de bueno salido de dividir por nada. */
  nodosInventados: [/porDiaYNodo: nodos === null \? null : porSegundo \* 86400 \/ nodos,/,
                    'porDiaYNodo: porSegundo * 86400 / (nodos === null ? 1 : nodos),'],
  /* LA REJILLA DEL CANAL SE MUEVE. f = 2405 + 5·(k−11) es la de la norma; con
     otro origen, el 15 deja de dar 2425 MHz y toda la discusión de Wi-Fi —que
     es lo que descarta la explicación fácil— se apoya en frecuencias falsas. */
  canalCorrido:  [/return F_CANAL_11_MHZ \+ PASO_CANAL_MHZ \* \(k - CANAL_BASE\);/,
                  'return F_CANAL_11_MHZ + PASO_CANAL_MHZ * k;'],
  /* EL CAREO DE CAMPOS SE VUELVE COMPLACIENTE: todo sale «igual». La
     afirmación «firmware, hardware y potencia declarada son idénticos» —que es
     la que descarta de un golpe cuatro causas— pasaría a ser automática. */
  todoIgual:     [/\(a\[c\] === b\[c\] \? iguales : distintos\)\.push\(c\);/,
                  'iguales.push(c);'],
  /* LA VENTANA DE ARRANQUE SE ENCOGE A UN INSTANTE, ignorando que del volcado
     sólo se sabe el día. Una precisión inventada de hasta 24 horas, justo en la
     cuenta que decide si el contador vio el suceso del 24-09 o no. */
  arranqueExacto:[/masTarde:    new Date\(d0 \+ 86399999 - ms\),/,
                  'masTarde:    new Date(d0 - ms),'],
  /* «QUIZÁ» PASA A CONTAR COMO «NO». Es el vacío-como-PASS de siempre: el caso
     que no se puede decidir con el día del volcado se declararía resuelto. */
  quizaEsNo:     [/return 'quiza';/, "return 'no';"],
};

const MUTA = process.env.MUTA;
let fuente = fs.readFileSync(MOD, 'utf8');   // sólo para mutarlo EN MEMORIA
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  const nuevo = fuente.replace(m[0], m[1]);
  if (nuevo === fuente) { console.error('la mutacion «' + MUTA + '» no casó con el código'); process.exit(2); }
  fuente = nuevo;
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}

/* LA VERSIÓN MUTADA NO TOCA EL DISCO, Y ESO NO ES UN DETALLE.
 *
 * La primera versión de este banco escribía un `.gw_estado.mutado.mjs` al lado
 * del original y lo borraba en un `finally`. **El `finally` no corría**, porque
 * `process.exit()` termina el proceso sin desenrollar la pila — así que cada
 * pasada con mutación dejaba un fuente DELIBERADAMENTE AVERIADO en el árbol de
 * trabajo, sin dueño y sin rastrear.
 *
 * Es exactamente el accidente del 2026-10-03, cuando un `git add -A` capturó
 * `tools/_render_tabla.js` en mitad de una mutación y empujó el renderizador
 * roto a la rama. La marca `.mutaciones-en-curso` existe por eso.
 *
 * Así que aquí no hay fichero que limpiar: el módulo son funciones puras y no
 * importa nada, así que la versión mutada se carga por `data:` URL y vive sólo
 * en memoria. Un fichero que no se escribe no se puede quedar atrás.
 */
const modUrl = MUTA
  ? 'data:text/javascript;base64,' + Buffer.from(fuente, 'utf8').toString('base64')
  : 'file://' + MOD;

(async () => {
try {
  const G = await import(modUrl);
  const ficha = JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  const doc = fs.readFileSync(DOC, 'utf8');

  const gw1 = ficha.gateways.find(g => g.nombre === 'SJ-NCU18-GW1');
  const gw2 = ficha.gateways.find(g => g.nombre === 'SJ-NCU18-GW2');
  check('la ficha trae los dos gateways', !!gw1 && !!gw2);
  if (!gw1 || !gw2) { console.error('SIN ALCANCE: la ficha no trae los dos gateways'); process.exit(2); }

  /* ── LA FICHA NO LLEVA CREDENCIALES NI MAC ─────────────────────────────────
     El volcado del que sale esto lleva cadenas de comunidad SNMP. Esta guarda
     es la que impide que una extracción futura, hecha con prisa, las cuele. */
  const crudo = fs.readFileSync(FICHA, 'utf8');
  for (const prohibido of ['private_community', 'public_community', 'password', 'passwd']) {
    check('la ficha NO lleva `' + prohibido + '`', crudo.indexOf(prohibido) < 0);
  }
  check('la ficha NO lleva ninguna MAC de gateway',
        !/\b([0-9a-f]{2}:){5,7}[0-9a-f]{2}\b/i.test(crudo));
  check('y NO lleva ninguna IP',
        !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(crudo));
  check('pero SÍ lleva la huella del volcado, para poder carearlo',
        /sha256 = [0-9a-f]{64}/.test(crudo));

  /* ── EL CANAL Y SU FRECUENCIA ──────────────────────────────────────────── */
  check('GW1 está en el canal 15', gw1.canal === 15, gw1.canal);
  check('GW2 está en el canal 19', gw2.canal === 19, gw2.canal);
  check('el 15 son 2425 MHz por la rejilla de la norma', G.mhzDeCanal(15) === 2425, G.mhzDeCanal(15));
  check('el 19 son 2445 MHz', G.mhzDeCanal(19) === 2445, G.mhzDeCanal(19));
  check('y el 26 —el que costaba los 16 dB— son 2480', G.mhzDeCanal(26) === 2480, G.mhzDeCanal(26));
  check('NINGUNO de los dos es el 26, así que el castigo de +19 a +3 dBm no aplica',
        gw1.canal !== 26 && gw2.canal !== 26);
  check('fuera de la rejilla 11..26 no se inventa frecuencia',
        G.mhzDeCanal(10) === null && G.mhzDeCanal(27) === null && G.mhzDeCanal(15.5) === null);
  check('el documento publica esos dos pares canal/MHz',
        /15.*2425/.test(doc) && /19.*2445/.test(doc));

  /* ── LAS TRES CUENTAS DEL CONTADOR, CON SU SUPUESTO ────────────────────── */
  const bruto  = G.ratioEnBruto(gw1, gw2);
  const tiempo = G.ratioPorTiempo(gw1, gw2);
  const nodo   = G.ratioPorTiempoYNodo(gw1, gw2);
  check('el ratio EN BRUTO es 25,1 — y NO es el que vale', cerca(bruto, 25.106, 0.01), bruto && bruto.toFixed(3));
  check('el ratio POR TIEMPO es 8,4, que es el publicado', cerca(tiempo, 8.4357, 0.001), tiempo && tiempo.toFixed(4));
  check('el ratio POR TIEMPO Y NODO es 18,6', cerca(nodo, 18.647, 0.01), nodo && nodo.toFixed(3));
  check('el bruto es el de tiempo MULTIPLICADO por el de uptimes, que es el error exacto',
        cerca(bruto / (gw1.uptime_s / gw2.uptime_s), tiempo, 1e-9),
        (bruto / (gw1.uptime_s / gw2.uptime_s)).toFixed(4));
  check('o sea que no normalizar INFLA el resultado un factor 3',
        cerca(gw1.uptime_s / gw2.uptime_s, 2.976, 0.001), (gw1.uptime_s / gw2.uptime_s).toFixed(4));
  /* Las dos tasas por hora, tal como salen publicadas en el documento. */
  const h1 = G.tasas(gw1).porSegundo * 3600, h2 = G.tasas(gw2).porSegundo * 3600;
  check('GW1 da 129,4 fallos de ACK por hora', cerca(h1, 129.40, 0.01), h1.toFixed(2));
  check('GW2 da 15,3', cerca(h2, 15.34, 0.01), h2.toFixed(2));
  check('y el documento publica esas dos cifras por hora',
        doc.indexOf('129,4') >= 0 && doc.indexOf('15,3') >= 0);
  check('el documento publica el 8,4 y dice que el 25 NO es', doc.indexOf('8,4') >= 0 && /25×|25,1/.test(doc));
  check('y publica también el 18,6 con su supuesto', doc.indexOf('18,6') >= 0);
  check('una tasa sin uptime no se calcula: devuelve null en vez de un número',
        G.tasas({ ack_failures: 10, uptime_s: 0 }) === null &&
        G.tasas({ ack_failures: 10 }) === null);
  check('y un ratio por nodo sin saber los nodos tampoco',
        G.ratioPorTiempoYNodo({ ack_failures: 10, uptime_s: 100 },
                              { ack_failures: 1, uptime_s: 100 }) === null);

  /* ── LO QUE ES IDÉNTICO EN LOS DOS, QUE ES LO QUE DESCARTA CAUSAS ──────── */
  const CONFIG = ['firmware_version', 'hardware_version', 'device_type', 'caps',
                  'max_payload', 'tx_power', 'association', 'net_addr', 'parent_addr'];
  const c = G.careo(gw1, gw2, CONFIG);
  check('TODO lo configurable es idéntico en los dos: ' + c.iguales.length + ' de ' + CONFIG.length,
        c.distintos.length === 0, c.distintos.join(','));
  check('  firmware idéntico, así que no es una versión distinta',
        gw1.firmware_version === gw2.firmware_version, gw1.firmware_version);
  check('  hardware idéntico, así que no es otro modelo',
        gw1.hardware_version === gw2.hardware_version, gw1.hardware_version);
  check('  `tx_power` idéntico, así que el 8 es un valor de serie y no un ajuste de sitio',
        gw1.tx_power === gw2.tx_power && gw1.tx_power === 8);
  const d = G.careo(gw1, gw2, ['canal', 'pan_id', 'ext_pan_id', 'uptime_s', 'ack_failures']);
  check('y lo que difiere es SÓLO canal, PAN, uptime y el contador',
        d.iguales.length === 0, d.iguales.join(','));

  /* ── EL `children` ESTÁ TOPADO, NO MEDIDO ──────────────────────────────── */
  check('los dos dicen `children` = 20', gw1.children === 20 && gw2.children === 20);
  check('pero llevan 38 y 84 TCU, o sea 2,2 veces más uno que otro',
        gw1.nodos === 38 && gw2.nodos === 84);
  check('así que ese 20 NO puede ser un censo: es un tope de tabla',
        gw1.children === gw2.children && gw1.nodos !== gw2.nodos && gw1.children < gw1.nodos);
  check('y el documento lo dice así, en vez de usarlo como prueba de nada',
        /tope|topad/i.test(doc.slice(doc.indexOf('children') - 2000, doc.indexOf('children') + 4000)));

  /* ── EL RSSI, Y POR QUÉ LA CONCLUSIÓN NO DEPENDE DEL CONVENIO ──────────── */
  check('los dos `rssi` difieren en 2 unidades sobre 82', Math.abs(gw1.rssi - gw2.rssi) === 2);
  check('o sea un 2,4 %: el nivel del averiado NO está hundido respecto al sano',
        Math.abs(gw1.rssi - gw2.rssi) / gw1.rssi < 0.03,
        (Math.abs(gw1.rssi - gw2.rssi) / gw1.rssi * 100).toFixed(1) + ' %');
  check('y eso vale con cualquiera de los dos convenios de signo, que es el punto',
        Math.abs(gw1.rssi - gw2.rssi) <= 2);
  check('el documento avisa de que es UNA muestra, la del último paquete',
        /una sola muestra|último paquete|ultimo paquete/i.test(doc));

  /* ── LA ALIMENTACIÓN NO ES ──────────────────────────────────────────────── */
  check('los dos Vcc difieren en 6 mV', Math.abs(gw1.supply_voltage_mv - gw2.supply_voltage_mv) === 6);
  check('o sea el 0,18 %: no es un problema de alimentación',
        Math.abs(gw1.supply_voltage_mv - gw2.supply_voltage_mv) / gw1.supply_voltage_mv < 0.005);

  /* ── LOS DOS PAN, Y UNA CONFIRMACIÓN QUE NO SE BUSCABA ─────────────────── */
  check('son dos PAN distintos: dos redes, no una', gw1.pan_id !== gw2.pan_id);
  check('y el PAN extendido los NUMERA: ...01 para GW1 y ...02 para GW2',
        gw1.ext_pan_id.endsWith('01') && gw2.ext_pan_id.endsWith('02'));
  check('con todo lo anterior IGUAL en los dos, que es lo que lo hace una confirmación',
        gw1.ext_pan_id.slice(0, -2) === gw2.ext_pan_id.slice(0, -2),
        gw1.ext_pan_id.slice(0, -2));

  /* ── NINGUNO DE LOS DOS CONTADORES VIO EL STOW DEL 2026-09-24 ──────────── */
  const DIA_VOLCADO = '2026-10-05', DIA_STOW = '2026-09-24';
  const v1 = G.ventanaDeArranque(gw1.uptime_s, DIA_VOLCADO);
  const v2 = G.ventanaDeArranque(gw2.uptime_s, DIA_VOLCADO);
  check('GW1 arrancó entre el 25 y el 26 de septiembre',
        v1.masTemprano.toISOString().slice(0, 10) === '2026-09-25' &&
        v1.masTarde.toISOString().slice(0, 10) === '2026-09-26',
        v1.masTemprano.toISOString() + ' .. ' + v1.masTarde.toISOString());
  check('GW2 arrancó entre el 1 y el 2 de octubre',
        v2.masTemprano.toISOString().slice(0, 10) === '2026-10-01' &&
        v2.masTarde.toISOString().slice(0, 10) === '2026-10-02',
        v2.masTemprano.toISOString() + ' .. ' + v2.masTarde.toISOString());
  check('así que el contador de GW1 NO abarca el stow del 24-09',
        G.abarcaElSuceso(gw1.uptime_s, DIA_VOLCADO, DIA_STOW) === 'no');
  check('ni el de GW2', G.abarcaElSuceso(gw2.uptime_s, DIA_VOLCADO, DIA_STOW) === 'no');
  check('y la respuesta NO depende de la hora del volcado, que no se sabe',
        v1.masTemprano > Date.parse(DIA_STOW + 'T23:59:59Z') &&
        v2.masTemprano > Date.parse(DIA_STOW + 'T23:59:59Z'));
  check('un suceso que el contador SÍ abarca sale «si», no «no»',
        G.abarcaElSuceso(gw1.uptime_s, DIA_VOLCADO, '2026-10-01') === 'si');
  check('y uno en el propio día del arranque sale «quiza», que no es ni sí ni no',
        G.abarcaElSuceso(gw1.uptime_s, DIA_VOLCADO, '2026-09-25') === 'quiza');
  check('el documento dice que el contador describe el AHORA, no el suceso del 24',
        /no abarca|no vio|describe el ahora|posterior al suceso|después del 24|despues del 24/i.test(doc));

  /* ── EL RELOJ NO EXISTE, Y ESO TIENE CONSECUENCIA ──────────────────────── */
  check('la ficha deja escrito que estos equipos no tienen reloj',
        /1970/.test(crudo) && /uptime/.test(crudo));
  check('y que por eso el uptime es la ÚNICA base de tiempo',
        /UNICA BASE DE TIEMPO|ÚNICA BASE DE TIEMPO/i.test(crudo));

  /* ── EL PISO ───────────────────────────────────────────────────────────── */
  const total = ok + fallos;
  console.log('\nalcance: ' + total + ' comprobaciones (piso ' + PISO + ') · ' +
              Object.keys(MUTACIONES).length + ' mutaciones');
  if (total < PISO) {
    console.error('BAJO EL PISO: ' + total + ' < ' + PISO + '. Alguien ha borrado alcance.');
    process.exit(2);
  }
  if (fallos) { console.error('\nFALLAN ' + fallos + ' de ' + total + ' comprobaciones'); process.exit(1); }
  console.log('\nTODO OK — ' + total + ' comprobaciones');
  process.exit(0);
} catch (e) {
  console.error('SIN ALCANCE: ' + (e && e.stack || e));
  process.exit(2);
}
})();
