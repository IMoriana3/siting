/* relieve_plantas.mjs — qué cobra el terreno REAL de las plantas levantadas.
 *
 * ═══ QUÉ CONTESTA ═══
 *
 * A3 dejó el motor midiendo el relieve contra la tierra lisa de P.1812, y los
 * bancos prueban que con terreno llano da 0 exacto. Lo que los bancos NO
 * pueden decir es CUÁNTO cobra un terreno de verdad, porque este repo no tiene
 * ninguno. Esto lo mide, sobre las dos únicas plantas de la cartera con
 * levantamiento validado.
 *
 *   node tools/relieve_plantas.mjs [--hermano ../Cobertura-Zigbee]
 *                                  [--eje 1.20] [--paso 6] [--radio 15]
 *
 * ═══ DE DÓNDE SALE EL TERRENO, Y QUÉ PARTE ES SUPOSICIÓN ═══
 *
 * De `<planta>_cotas.json`, el levantamiento. Cada fila trae sus DOS puntas
 * medidas —`n[0]`/`n[1]` con sus `y[0]`/`y[1]`— y nada en medio: son 74,6 m de
 * mediana entre punta y punta. Con la nube CRUDA la malla sale al 7,5 % y 695
 * de las 751 TCU de Ayora se quedan sin cota; medido, no supuesto.
 *
 * Así que el suelo bajo una fila se toma LINEAL entre sus dos puntas. Eso es
 * EXACTAMENTE lo que ya supone el 3D —`beam = mc.gnd + (…)·fr` en `buildCava`—
 * y lo que justifica la estructura: un tubo rígido sobre hincas, con el suelo a
 * HEJE por debajo. **Es una suposición declarada, no una medida**, y con ella
 * la cobertura pasa al 100,0 % de las TCU en las dos plantas.
 *
 * La cota de suelo es `base + y − (eje + off)`, con `off = 0,14` (cara del
 * módulo sobre el eje, `seguidor.js`) y el eje a **1,20 m, estándar Factiun
 * DECLARADO, no medido**. Lo que sigue dice por qué eso no contamina el
 * resultado.
 *
 * ═══ Y LO QUE MÁS IMPORTA DE TODO ESTO ═══
 *
 * **El relieve crece con la longitud del vano, y mucho.** Con saltos a vecina
 * —12 m— sale 0 en más de la mitad de los casos, y eso invita a concluir que
 * el terreno no cobra. Es falso: es que a 12 m dos filas vecinas están sobre un
 * plano, y la tierra lisa se lo come entero, que es justo lo que tiene que
 * hacer. A partir de 100 m ya son varios dB. Cualquier cifra agregada sobre
 * «los enlaces» sin separar por longitud dice lo que uno quiera.
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
const EJE = parseFloat(arg('eje', '1.20'));
const PASO = parseFloat(arg('paso', '6'));
const RADIO = parseFloat(arg('radio', '15'));
const OFF = 0.14, DENS = 4, F = 2.45e9, ANT = 0.475;
const PLANTAS = ['ayora', 'sanjose'];      // las únicas EVALUADAS del censo

const faltan = PLANTAS.filter(p => !fs.existsSync(path.join(HERMANO, p + '_cotas.json')));
if (faltan.length) {
  console.log('SIN MEDIDA: falta el levantamiento de ' + faltan.join(', ') + ' en ' + HERMANO);
  console.log('No se ha medido nada. Esto no es un verde.');
  process.exit(0);
}

/* Nube de puntos de suelo, densificada a lo largo de cada viga. */
function puntos(C, eje) {
  const H = eje + OFF, P = [];
  for (const t of C.t) { if (!t) continue;
    for (const f of t.f) {
      const L = Math.abs(f.n[1] - f.n[0]), k = Math.max(1, Math.round(L / DENS));
      for (let i = 0; i <= k; i++) { const u = i / k;
        P.push([f.x, f.n[0] + (f.n[1] - f.n[0]) * u,
                C.base + (f.y[0] + (f.y[1] - f.y[0]) * u) - H]); }
    } }
  return P;
}

/* Malla IDW p=2 con radio, igual que `kml_curvas_a_cotas.mjs`: exacta sobre el
   punto, sin inventar máximos entre puntos, y `null` donde no hay ninguno a
   tiro. Ese null es el que el 3D rellena con el DEM y el motor declara. */
function malla(P, paso, radio) {
  const xs = P.map(p => p[0]), ns = P.map(p => p[1]);
  const x0 = Math.floor((Math.min(...xs) - radio) / paso) * paso;
  const x1 = Math.ceil((Math.max(...xs) + radio) / paso) * paso;
  const n0 = Math.floor((Math.min(...ns) - radio) / paso) * paso;
  const n1 = Math.ceil((Math.max(...ns) + radio) / paso) * paso;
  const nx = Math.round((x1 - x0) / paso) + 1, nn = Math.round((n1 - n0) / paso) + 1;
  const B = new Map();
  P.forEach((p, i) => { const k = Math.floor(p[0] / radio) + '|' + Math.floor(p[1] / radio);
    if (!B.has(k)) B.set(k, []); B.get(k).push(i); });
  const z = new Array(nx * nn).fill(null);
  let con = 0;
  for (let j = 0; j < nn; j++) { const yy = n0 + j * paso;
    for (let i = 0; i < nx; i++) { const xx = x0 + i * paso;
      let num = 0, den = 0, mejor = Infinity, mz = 0;
      const bx = Math.floor(xx / radio), bn = Math.floor(yy / radio);
      for (let dx = -1; dx <= 1; dx++) for (let dn = -1; dn <= 1; dn++) {
        const l = B.get((bx + dx) + '|' + (bn + dn)); if (!l) continue;
        for (const ix of l) { const p = P[ix];
          const d2 = (p[0] - xx) ** 2 + (p[1] - yy) ** 2;
          if (d2 < mejor) { mejor = d2; mz = p[2]; }
          if (d2 > radio * radio) continue;
          const w = 1 / (d2 || 1e-9); num += w * p[2]; den += w; } }
      if (den > 0) { z[j * nx + i] = mejor < 1e-12 ? mz : num / den; con++; } } }
  return { planta: null, x0, n0, paso, nx, nn, z, _con: con, _tot: nx * nn };
}

const pct = (a, p) => { if (!a.length) return null;
  const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f3 = v => (v == null ? '   -  ' : v.toFixed(3));

console.log('eje ' + EJE.toFixed(2) + ' m (DECLARADO) · off ' + OFF + ' · malla a ' + PASO
          + ' m, radio IDW ' + RADIO + ' m · densificado cada ' + DENS + ' m sobre la viga\n');

for (const nom of PLANTAS) {
  const C = JSON.parse(fs.readFileSync(path.join(HERMANO, nom + '_cotas.json'), 'utf8'));
  const g = malla(puntos(C, EJE), PASO, RADIO);
  const t = T.cargaRelieve(g);
  if (!t) { console.error(nom + ': la malla construida no pasa cargaRelieve'); process.exit(1); }
  const tcu = C.t.filter(Boolean).map(x => ({ x: (x.f[0].x + x.f[1].x) / 2,
                                              n: (x.f[0].n[0] + x.f[0].n[1]) / 2 }));
  const cob = T.cobertura(t, tcu);
  const cotas = tcu.map(p => T.cotaEn(t, p.x, p.n)).filter(v => v !== null);

  console.log('═══ ' + nom.toUpperCase() + ' ═══');
  console.log('  levantados        ' + C.n_trk + ' seguidores  (reconstruidos ' + C.n_est
            + ', cotas repuestas ' + C.n_ye + ')');
  console.log('  malla             ' + g.nx + ' x ' + g.nn + '  ·  nodos con dato '
            + (100 * g._con / g._tot).toFixed(1) + ' %');
  console.log('  TCU con cota      ' + cob.con + ' de ' + cob.n + '  (' + (100 * cob.frac).toFixed(1) + ' %)');
  console.log('  desnivel          ' + (Math.max(...cotas) - Math.min(...cotas)).toFixed(1) + ' m   ('
            + Math.min(...cotas).toFixed(1) + ' a ' + Math.max(...cotas).toFixed(1) + ' m)');

  /* EL RELIEVE POR LONGITUD DE VANO. Pares al azar con semilla fija, para que
     dos ejecuciones den lo mismo y se pueda comparar entre versiones. */
  console.log('\n  vano          n    p50      p95      máx    a cero   sin perfil');
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (const [lo, hi] of [[10, 20], [20, 50], [50, 100], [100, 200], [200, 400], [400, 800], [800, 1600]]) {
    const rel = []; let sin = 0;
    for (let k = 0; k < 20000 && rel.length + sin < 300; k++) {
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

/* ═══ Y LA COMPROBACIÓN QUE DESBLOQUEA EL PUNTO 2 ═══
 *
 * La altura de eje es DECLARADA (1,20 m estándar Factiun) y la de verdad sale
 * de un plano que todavía no está. Para el 3D eso importa: mueve el terreno
 * reconstruido metro por metro. Para el RELIEVE DE RADIO no puede importar, y
 * el argumento tiene DOS mitades que hay que separar porque sólo una es
 * discutible:
 *
 *   (a) el eje entra como un desplazamiento UNIFORME del suelo. Esto SÍ es
 *       comprobable y podría ser falso —bastaría que el densificado o el IDW
 *       dependieran del eje de otra forma—, así que se mide abajo.
 *   (b) el relieve es invariante a un desplazamiento uniforme. Esto es
 *       ESTRUCTURAL: perfil y antenas se mueven juntos, y tanto la recta de
 *       mínimos cuadrados como `htE = zA − hst` son invariantes a una
 *       traslación. Se mide también, pero conviene decir que una mutación no
 *       lo tumba: probado con `sinCentrar` puesta, el número no se movió
 *       (4,9e-12 en vez de 5,1e-12), porque el centrado protege la PRECISIÓN
 *       del caso llano a cota alta, no esta invariancia.
 *
 * O sea que el que aporta información es (a). (b) se mide para que el
 * resultado sea de punta a punta, no porque estuviera en duda. */
console.log('═══ ¿el eje entra como un desplazamiento UNIFORME del suelo? ═══');
for (const nom of PLANTAS) {
  const C = JSON.parse(fs.readFileSync(path.join(HERMANO, nom + '_cotas.json'), 'utf8'));
  const gA = T.cargaRelieve(malla(puntos(C, 0.70), PASO, RADIO));
  const gB = T.cargaRelieve(malla(puntos(C, 2.00), PASO, RADIO));
  let peor = 0, n = 0, distinta = 0;
  for (let j = 0; j < gA.nn; j += 3) for (let i = 0; i < gA.nx; i += 3) {
    const a = gA.z[j * gA.nx + i], b = gB.z[j * gB.nx + i];
    if (a == null || b == null) { if ((a == null) !== (b == null)) distinta++; continue; }
    n++;
    const d = Math.abs((a - b) - 1.30);      // 2,00 − 0,70
    if (d > peor) peor = d;
  }
  console.log('  ' + nom.padEnd(9) + n + ' nodos · peor desvío respecto a 1,30 m exactos: '
            + peor.toExponential(3) + ' m'
            + (distinta ? '  ·  ' + distinta + ' nodos con hueco en sólo una de las dos' : '  ·  mismos huecos en las dos'));
}

console.log('\n═══ y entonces, ¿contamina el relieve? ═══');
for (const nom of PLANTAS) {
  const C = JSON.parse(fs.readFileSync(path.join(HERMANO, nom + '_cotas.json'), 'utf8'));
  const ejes = [0.70, 1.20, 1.70, 2.00];
  const ts = ejes.map(e => T.cargaRelieve(malla(puntos(C, e), PASO, RADIO)));
  const tcu = C.t.filter(Boolean).map(x => ({ x: (x.f[0].x + x.f[1].x) / 2,
                                              n: (x.f[0].n[0] + x.f[0].n[1]) / 2 }));
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
  console.log('  ' + nom.padEnd(9) + ev + ' vanos · peor variación moviendo el eje de 0,70 a 2,00 m: '
            + peor.toExponential(3) + ' dB');
}
console.log('\n  O sea: 1,30 m de incertidumbre en la altura de poste mueven el relieve');
console.log('  en la coma flotante. El plano hace falta para el 3D, NO para esto.');
