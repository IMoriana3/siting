/* relieve_plantas.mjs — qué cobra el terreno REAL de las plantas levantadas.
 *
 * ═══ QUÉ CONTESTA ═══
 *
 * A3 dejó el motor midiendo el relieve contra la tierra lisa de P.1812, y los
 * bancos prueban que con terreno llano da 0 exacto. Lo que los bancos NO pueden
 * decir es CUÁNTO cobra un terreno de verdad, porque este repo no tiene
 * ninguno. Esto lo mide, sobre las dos plantas de la cartera con levantamiento
 * validado (`censo_relieve_cartera.csv`: ayora 100,0 % y sanjose 95,3 %).
 *
 *   node tools/relieve_plantas.mjs [--hermano ../Cobertura-Zigbee]
 *
 * ═══ ESTE ÚTIL CONSUME, NO PRODUCE, Y ESO ES EL PUNTO ═══
 *
 * Lee `<planta>_relieve.json` del repo hermano — el mismo fichero que consume
 * el 3D— a través de `terreno_planta.js`. **Una versión anterior construía aquí
 * su propia malla desde el levantamiento**, y eso era exactamente la avería que
 * este repo persigue: dos sitios calculando la misma magnitud, listos para
 * separarse sin que nadie lo note. El fichero lo escribe
 * `cobertura-zigbee/tools/relieve_de_levantamiento.mjs`, que es donde vive el
 * levantamiento, y ahí está documentado cómo se empalma con el DEM.
 *
 * ═══ Y LO QUE MÁS IMPORTA DE LO QUE MIDE ═══
 *
 * **El relieve crece con la longitud del vano, y mucho.** Con saltos a vecina
 * —12 m— sale 0 en la mayoría de los casos, y eso invita a concluir que el
 * terreno no cobra. Es falso: a 12 m dos filas vecinas están sobre un plano y
 * la tierra lisa se lo come entero, que es justo lo que tiene que hacer. A
 * partir de 100 m ya son varios dB.
 *
 * Cualquier cifra agregada «sobre los enlaces» sin separar por longitud dice lo
 * que uno quiera. Es el mismo error que ya mordió en el careo de El Burgo,
 * donde la media de +1,1 dB esconde +27,1 dB con 0 filas cruzadas y −28,4 con
 * 24 (`INVENTARIO_MOTOR_RF.md`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const T = require(path.join(RAIZ, 'terreno_planta.js'));
const R = require(path.join(RAIZ, 'radio_pv_model.js'));
for (const fn of ['cargaRelieve', 'cotaEn', 'perfilEntre', 'cobertura']) {
  if (typeof T[fn] !== 'function') { console.error('terreno_planta.js ya no exporta ' + fn + '()'); process.exit(2); }
}

const HERMANO = arg('hermano', path.join(RAIZ, '..', 'Cobertura-Zigbee'));
const F = 2.45e9, ANT = 0.475;
const PLANTAS = ['ayora', 'sanjose'];

const faltan = PLANTAS.filter(p => !fs.existsSync(path.join(HERMANO, p + '_relieve.json')));
if (faltan.length) {
  console.log('SIN MEDIDA: falta ' + faltan.map(p => p + '_relieve.json').join(', ') + ' en ' + HERMANO);
  console.log('Los escribe cobertura-zigbee/tools/relieve_de_levantamiento.mjs');
  console.log('No se ha medido nada. Esto no es un verde.');
  process.exit(0);
}

const pct = (a, p) => { if (!a.length) return null;
  const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f3 = v => (v == null ? '   -  ' : v.toFixed(3));

for (const nom of PLANTAS) {
  const obj = JSON.parse(fs.readFileSync(path.join(HERMANO, nom + '_relieve.json'), 'utf8'));
  const t = T.cargaRelieve(obj);
  if (!t) { console.error(nom + '_relieve.json no pasa cargaRelieve: el fichero no tiene la forma esperada'); process.exit(1); }
  /* Las TCU salen del levantamiento, que es quien sabe dónde está cada una; el
     terreno sale del fichero. Cada cosa de su fuente. */
  const C = JSON.parse(fs.readFileSync(path.join(HERMANO, nom + '_cotas.json'), 'utf8'));
  const tcu = C.t.filter(Boolean).map(x => ({ x: (x.f[0].x + x.f[1].x) / 2,
                                              n: (x.f[0].n[0] + x.f[0].n[1]) / 2 }));
  const cob = T.cobertura(t, tcu);
  const cotas = tcu.map(p => T.cotaEn(t, p.x, p.n)).filter(v => v !== null);

  console.log('═══ ' + nom.toUpperCase() + ' ═══');
  console.log('  fichero           ' + nom + '_relieve.json · malla ' + t.nx + ' x ' + t.nn + ' a ' + t.paso + ' m');
  console.log('  TCU con cota      ' + cob.con + ' de ' + cob.n + '  (' + (100 * cob.frac).toFixed(1) + ' %)');
  console.log('  desnivel          ' + (Math.max(...cotas) - Math.min(...cotas)).toFixed(1) + ' m   ('
            + Math.min(...cotas).toFixed(1) + ' a ' + Math.max(...cotas).toFixed(1) + ' m)');

  console.log('\n  ── NO SE AGREGA: promediar estas bandas da el numero que uno quiera ──');
  console.log('\n  vano          n    p50      p95      máx    a cero   sin perfil');
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (const [lo, hi] of [[10, 20], [20, 50], [50, 100], [100, 200], [200, 400], [400, 800], [800, 1600]]) {
    const rel = []; let sin = 0;
    for (let k = 0; k < 40000 && rel.length + sin < 300; k++) {
      const a = tcu[Math.floor(rnd() * tcu.length)], b = tcu[Math.floor(rnd() * tcu.length)];
      const D = Math.hypot(b.x - a.x, b.n - a.n);
      if (D < lo || D >= hi) continue;
      const p = T.perfilEntre(t, a.x, a.n, b.x, b.n, {});
      if (!p.perfil) { sin++; continue; }
      const r = R.relieveDeltaDb(p.D, p.zSuelo[0] + ANT, p.zSuelo[1] + ANT, p.perfil, F);
      if (r.db === null) { sin++; continue; }
      rel.push(r.db);
    }
    console.log('  ' + (lo + '-' + hi + ' m').padEnd(12) + String(rel.length).padStart(4)
      + f3(pct(rel, 0.5)).padStart(9) + f3(pct(rel, 0.95)).padStart(9)
      + (rel.length ? Math.max(...rel).toFixed(3) : '  -  ').padStart(9)
      + (rel.length ? (rel.filter(v => v === 0).length + '/' + rel.length) : '  -  ').padStart(11)
      + String(sin).padStart(12));
  }
  console.log('');
}

/* ═══ LA ALTURA DE POSTE DECLARADA NO CONTAMINA ESTO ═══
 *
 * El eje del tubo va a 1,20 m, estándar Factiun DECLARADO; el de verdad sale de
 * un plano que todavía no está. El fichero de terreno lo lleva restado
 * (`suelo = base + y − (eje + off)`), así que un eje equivocado en δ desplaza el
 * suelo entero δ. Que ese desplazamiento es UNIFORME está medido en el
 * productor: comparando la malla a 0,70 m con la de 2,00 m, el peor desvío
 * respecto a 1,30 m exactos es 6,1e-13 m en Ayora.
 *
 * Lo que se mide AQUÍ es la otra mitad: que el relieve no se entere de un
 * desplazamiento uniforme. Y se mide sobre el fichero de verdad, desplazándolo
 * a mano —que es justo lo que hace un eje equivocado—, sin tener que
 * reconstruir nada.
 */
console.log('═══ ¿se entera el relieve de un desplazamiento uniforme del suelo? ═══');
console.log('  (es lo que hace equivocarse en la altura de poste: ±0,80 m aquí)');
for (const nom of PLANTAS) {
  const obj = JSON.parse(fs.readFileSync(path.join(HERMANO, nom + '_relieve.json'), 'utf8'));
  const C = JSON.parse(fs.readFileSync(path.join(HERMANO, nom + '_cotas.json'), 'utf8'));
  const tcu = C.t.filter(Boolean).map(x => ({ x: (x.f[0].x + x.f[1].x) / 2,
                                              n: (x.f[0].n[0] + x.f[0].n[1]) / 2 }));
  const ts = [-0.80, 0, +0.80].map(d => T.cargaRelieve(
    Object.assign({}, obj, { z: obj.z.map(v => (v == null ? null : v + d)) })));
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let peor = 0, ev = 0;
  for (let k = 0; k < 40000 && ev < 400; k++) {
    const a = tcu[Math.floor(rnd() * tcu.length)], b = tcu[Math.floor(rnd() * tcu.length)];
    const D = Math.hypot(b.x - a.x, b.n - a.n);
    if (D < 20 || D > 300) continue;
    const v = [];
    for (const tt of ts) {
      const p = T.perfilEntre(tt, a.x, a.n, b.x, b.n, {});
      if (!p.perfil) break;
      const r = R.relieveDeltaDb(p.D, p.zSuelo[0] + ANT, p.zSuelo[1] + ANT, p.perfil, F);
      if (r.db === null) break;
      v.push(r.db);
    }
    if (v.length !== ts.length) continue;
    ev++;
    const d = Math.max(...v) - Math.min(...v);
    if (d > peor) peor = d;
  }
  if (!ev) { console.log('  ' + nom + ': 0 vanos evaluados — NO HAY MEDIDA, no un cero'); continue; }
  console.log('  ' + nom.padEnd(9) + ev + ' vanos · peor variación con ±0,80 m de desplazamiento: '
            + peor.toExponential(3) + ' dB');
}
console.log('\n  O sea: 1,60 m de incertidumbre en la altura de poste mueven el relieve');
console.log('  en la coma flotante. El plano hace falta para el 3D, NO para esto.');
