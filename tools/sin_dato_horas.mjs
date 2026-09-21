/* ¿CUANTAS TCU QUEDAN SIN PODER DECIDIRSE, Y A QUE HORA?
 *
 * Donde el obstaculo cae a menos de un par de longitudes de onda de la antena,
 * el filo de cuchillo de P.526 no aplica: ahi no hay «filo», hay una antena
 * metida debajo de una placa. El motor tiene que decirlo con un motivo, no
 * inventarse un dB. Este programa cuenta cuantas TCU caen en ese caso.
 *
 * Y compara TRES estados, porque con dos no se entiende:
 *
 *   HOY            la fila propia se descarta por `t > 0,001` en `rfObstacles`,
 *                  o sea por el 0,1 % del enlace. Ni se evalua, y no deja
 *                  motivo. Como el corte es proporcional a D, la MISMA
 *                  geometria entra o sale segun lo largo que sea el salto.
 *   BANDA + lambda el canto difractante en el EJE de la fila, que es donde lo
 *                  pone `banda()`, con el corte de campo cercano en lambdas.
 *   PLANO EXACTO   el canto donde esta de verdad, en la huella del panel:
 *                  a +-(c/2)·cos alfa del eje.
 *
 * El enlace de cada TCU es hacia SU NCU, que es lo que dibuja el mapa.
 *
 * USO (las consignas salen del modelo de backtracking de verdad, no de aqui):
 *   node ../Cobertura-Zigbee/tools/export_consignas.mjs --planta ayora \
 *        --fecha 2026-06-21 --pol pairwise --paso 60 --salida /tmp/c.csv
 *   node tools/sin_dato_horas.mjs ../Cobertura-Zigbee/ayora_layout.json /tmp/c.csv
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
/* LA RUTA DEL MOTOR ERA ABSOLUTA —`/home/user/Siting/radio_pv_model.js`— y con
   eso este util NO ARRANCABA EN NINGUNA OTRA MAQUINA, ni en la CI. Es el mismo
   defecto que el binario de Chromium clavado en Cobertura-Zigbee. Va relativa
   al propio fichero, que es lo unico que se sabe cierto desde aqui. */
const path = require('path');
const RAIZ = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const RM = require(path.join(RAIZ, 'radio_pv_model.js'));
const fs = require('fs');

/* Y DECIR QUE FALTA, en vez de reventar con una traza de `node:fs`. Sin esto,
   correrlo sin argumentos daba `getValidatedPath` y a ver quien deduce de ahi
   que lo que falta es el CSV de consignas. */
const LAYOUT = process.argv[2], CONSIGNAS = process.argv[3];
for (const [q, v] of [['layout de la planta', LAYOUT], ['CSV de consignas', CONSIGNAS]]) {
  if (!v || !fs.existsSync(v)) {
    console.error('falta el ' + q + (v ? ': no existe ' + v : '') + '\n' +
      'USO: node tools/sin_dato_horas.mjs <planta_layout.json> <consignas.csv>\n' +
      'El layout vive en el repo cobertura-zigbee; el CSV lo saca su\n' +
      '`tools/export_consignas.mjs` (ver la cabecera de este fichero).');
    process.exit(2);
  }
}
const LAY = JSON.parse(fs.readFileSync(LAYOUT, 'utf8'));
const CSV = fs.readFileSync(CONSIGNAS, 'utf8').trim().split('\n');
const cab = CSV[0].split(','), iH = cab.indexOf('hora_local'), iT = cab.indexOf('tracker'), iA = cab.indexOf('theta_tcu_deg');

const F = 2.45e9, LAM = RM.longitudOnda(F), RAD = 0.225, UMBRAL = 2;
const CU = 2.384;                                   // cuerda de Ayora (su `mesa.modH`)
const porId = new Map(LAY.trackers.map(t => [t.id, t]));
const ncu = new Map(LAY.ncus.map((n, i) => [i + 1, n]));

const ang = new Map();                               // hora -> id -> theta
for (let i = 1; i < CSV.length; i++) {
  const c = CSV[i].split(',');
  if (!ang.has(c[iH])) ang.set(c[iH], new Map());
  ang.get(c[iH]).set(c[iT], parseFloat(c[iA]));
}
/* EL ROTULO SALE DEL LAYOUT, no de una cadena. Ponia «Ayora · 2026-06-21 · 751
   seguidores» fijo, o sea que corrido sobre otra planta —o sobre seis
   seguidores de banco— seguia diciendo Ayora y 751. Un rotulo que no depende
   del dato no es un rotulo, es decoracion. */
console.log((LAY.planta || path.basename(LAYOUT).replace(/_layout\.json$/, '')) +
  ' · ' + LAY.trackers.length + ' seguidores · ' + (CSV.length - 1) + ' consignas' +
  ' · lambda = ' + LAM.toFixed(4) + ' m · umbral ' + UMBRAL + ' lambdas\n');
console.log('  hora   |alfa| p50   HOY: la fila propia     BANDA + corte en lambda   PLANO EXACTO');
console.log('                       ni se evalua (t>0,001)     «sin dato»              «sin dato»');
for (const h of ['09:00', '14:00', '18:00']) {
  const A = ang.get(h);
  if (!A) { console.log('  ' + h + '  (no esta en el CSV)'); continue; }
  let n = 0, antes = 0, despues = 0, hoyFuera = 0; const als = [];
  for (const [id, a] of A) {
    const t = porId.get(id); if (!t) continue;
    const g = ncu.get(t.ncu); if (!g) continue;
    const dx = g.x - t.x, dy = g.n - t.n, D = Math.hypot(dx, dy);
    if (D < 1) continue;
    /* direccion de la fila: `rot` es el rumbo del eje en grados al este del norte */
    const r = (t.rot || 0) * Math.PI / 180, fx = Math.sin(r), fy = Math.cos(r);
    const senPhi = Math.abs((dx / D) * fy - (dy / D) * fx);
    if (senPhi < 1e-6) continue;                     // paralelo: no cruza su fila
    const lat = Math.abs(RM.anclaAntena(RAD, a).lateral);
    const d1a = lat / senPhi;                        // canto en el eje
    const d1d = (lat + (CU / 2) * Math.cos(Math.abs(a) * RM.GRADO)) / senPhi;   // canto en la huella
    n++; als.push(Math.abs(a));
    if (d1a / D <= 0.001) hoyFuera++;               // el corte por `t` de HOY la tira
    if (RM.campoCercano(d1a, D - d1a, F, UMBRAL).cerca) antes++;
    if (RM.campoCercano(d1d, D - d1d, F, UMBRAL).cerca) despues++;
  }
  als.sort((p, q) => p - q);
  const f = v => (v + ' de ' + n + ' (' + (100 * v / n).toFixed(1) + '%)').padStart(23);
  console.log('  ' + h + '  ' + als[als.length >> 1].toFixed(1).padStart(8) + '°' +
    f(hoyFuera) + f(antes) + f(despues));
}
