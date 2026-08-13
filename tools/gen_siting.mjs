/* Genera el conjunto de datos de una planta para el siting, a partir de su layout del DWG.
 *
 * Los layouts viven en cobertura-zigbee (<planta>_layout.json) y son los que ya alimentan el 3D y
 * el Layout 2D. El siting los tenía escritos a mano, así que Bagnarelli y Túnez se quedaron fuera.
 *
 * CONVENIO DE COORDENADAS, deducido reproduciendo Páramo (que está en los dos sitios):
 *   x_siting = t.x − min(x)      y_siting = t.n − min(n)      → la esquina del campo en (0,0)
 *   ox = cE + min(x)             oy = cN + min(n)             → UTM de esa esquina
 * El layout no siempre trae cE/cN, pero sí clat/clon y su CRS, así que el origen UTM se calcula.
 * La conversión está validada contra las TRES plantas cuyo layout sí trae cE/cN —El Burgo, Ayora y
 * San José, en tres zonas distintas— con 3 mm de error en el peor caso, y coincide además con el
 * origen que la ficha del 3D tiene anotado para Fayón (E 275719,936 N 4567402,475).
 *
 *   node tools/gen_siting.mjs <planta>                          informe, no escribe
 *   node tools/gen_siting.mjs <planta> --write                  inyecta el literal en el siting
 *   node tools/gen_siting.mjs <planta> --write --destino=ambos  ...y en el SCADA de operación
 *   node tools/gen_siting.mjs paramo --verifica                 lo compara con el que ya hay (prueba del convenio)
 *
 * Plantas: ayora · sanjose · elburgo · paramo · fayon · bagnarelli · tunez  (= los layouts que hay).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const RAIZ = new URL('..', import.meta.url).pathname;
const LAYOUTS = '/home/user/Cobertura-Zigbee/';
const [planta, ...rest] = process.argv.slice(2);
const WRITE = rest.includes('--write'), VERIFICA = rest.includes('--verifica');
if (!planta) { console.error('uso: node tools/gen_siting.mjs <planta> [--write|--verifica] [--destino=siting|scada|ambos]'); process.exit(2); }

/* DESTINOS. El SCADA de operación dibuja la planta con el MISMO motor que el siting —lo dice su
   propio README: «sobre el mismo plano que usa la herramienta de siting»— y tenía los datos
   escritos a mano por separado. Se habían separado: en el SCADA los seguidores de Ayora y San José
   no traían cotas de mesa, Páramo y El Burgo salían sin zonas de color, y no existían Fayón,
   Bagnarelli ni Túnez. Un solo generador, un solo origen (el DWG), dos consumidores. */
const DESTINOS = {
  siting: RAIZ + 'index.html',
  scada: '/home/user/SCADA/index.html',
};
const dArg = (rest.find(a => a.startsWith('--destino=')) || '--destino=siting').slice(10);
const destinos = (dArg === 'ambos' ? ['siting', 'scada'] : dArg.split(','))
  .map(d => { if (!DESTINOS[d]) { console.error('destino desconocido: ' + d + ' (siting|scada|ambos)'); process.exit(2); } return d; });

/* El nombre del layout y el de la variable en la app no siempre coinciden: el layout se llama
   `elburgo_layout.json` y en las dos apps la constante es BURGO y el escenario "burgo". Sin este
   mapa, `--write` metía un `const ELBURGO=` nuevo al lado del BURGO de siempre y la planta quedaba
   declarada dos veces, con el botón apuntando a la vieja. */
const VAR = { elburgo: 'BURGO' };
const SC = { elburgo: 'burgo' };
const nomVar = VAR[planta] || planta.toUpperCase();

/* ---------- WGS84/ETRS89 -> UTM (serie de Krüger) ---------- */
function utm(lat, lon, zona, sur) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, n = f / (2 - f);
  const A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
  const al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240];
  const lam0 = ((zona - 1) * 6 - 180 + 3) * Math.PI / 180, phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - 2 * Math.sqrt(n) / (1 + n) * Math.atanh(2 * Math.sqrt(n) / (1 + n) * Math.sin(phi)));
  const xi = Math.atan(t / Math.cos(lam - lam0)), eta = Math.atanh(Math.sin(lam - lam0) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  for (let j = 1; j <= 3; j++) { E += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); N += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); }
  return [500000 + k0 * A * E, (sur ? 10000000 : 0) + k0 * A * N];
}
const zonaDe = crs => { const m = String(crs).match(/(\d{5})$/); if (!m) return null; const c = +m[1];
  if (c >= 25828 && c <= 25838) return { z: c - 25800, s: false };   // ETRS89 / UTM norte
  if (c >= 32601 && c <= 32660) return { z: c - 32600, s: false };   // WGS84 norte
  if (c >= 32701 && c <= 32760) return { z: c - 32700, s: true };    // WGS84 sur
  return null; };

/* ---------- construcción ---------- */
const L = JSON.parse(readFileSync(LAYOUTS + planta + '_layout.json', 'utf8'));
const trk = L.trackers || [];
if (!trk.length) { console.error('el layout no trae seguidores'); process.exit(1); }
/* El desplazamiento se toma sobre TODOS los elementos, no solo los seguidores: la NCU de
   Bagnarelli está al suroeste del campo y con el mínimo de los seguidores salía en negativo.
   En Páramo no cambia nada (allí todo cae dentro del rectángulo de seguidores), y por eso la
   verificación contra el que ya estaba sigue valiendo. */
const todos = [].concat(trk, L.ncus || [], L.meteo || [], L.reps || []);
const minx = Math.min(...todos.map(t => t.x)), minn = Math.min(...todos.map(t => t.n));
const r2 = v => +v.toFixed(1);

let cE = L.cE, cN = L.cN, origen = 'del propio layout';
if (!isFinite(cE) || !isFinite(cN)) {
  const z = zonaDe(L.crs);
  if (!z) { console.error('no reconozco el CRS ' + L.crs + ': no se puede dar el origen UTM'); process.exit(1); }
  [cE, cN] = utm(L.clat, L.clon, z.z, z.s);
  origen = `calculado de clat/clon en ${L.crs} (zona ${z.z}${z.s ? 'S' : 'N'})`;
}

/* COTAS DE LA MESA, con el mismo modelo que el Layout 2D y el 3D:
     span = 2 · mód_por_ala · (modW + 0,012) + 0,55   ·   ancho = 2·filaZ + cuerda
   El largo de CADA seguidor sale de t.mr, la razón real del DWG (no de t.mods, que en unas plantas
   es por ala y en otras por fila; por eso Fayón llegó a salir al doble). La cuerda es la canónica
   de 2,382 salvo que el layout diga otra: ninguno de estos dos la trae, así que es DERIVADA. */
/* GUARDA. Si el layout no trae sus cotas, NO se inventan: con el `|| 1.134` y el `|| 28` de antes,
   Fayón salía con la mesa de El Burgo —64,73 m en vez de los 55,16 medidos en su plano P06—, que
   es exactamente la trampa que TRASPASO.md lleva avisando desde que cayó tres veces. Sin cotas se
   emiten las posiciones y punto, y el siting usa las suyas. */
const tieneCotas = (L.modW != null && L.mods != null && L.filaZ != null);
const modW = L.modW || 1.134, modsAla = L.mods || 28, filaZ = (L.filaZ != null) ? +L.filaZ : 3.0;
const cuerda = L.modH || 2.382;
const spanFull = 2 * modsAla * (modW + 0.012) + 0.55;
const ancho = +(2 * filaZ + cuerda).toFixed(3);
const largoDe = t => {
  const mr = (typeof t.mr === 'number' && t.mr > 0 && t.mr < 1) ? t.mr
           : (/^medio/i.test(t.t || '') ? 0.504 : 1);
  return +(spanFull * mr).toFixed(2);
};
/* Cada TCU va donde está su MOTOR, que es el punto que usa el siting para medir. En el layout la
   posición del seguidor ES la del motor (así se generó del DWG), por eso se traslada y ya.
   Formato de la fila: [x, y, ncu, gw, id, pb, len, wid, az] — el siting ya sabe leer largo, ancho
   y AZIMUT por seguidor, que es lo que hace falta para Bagnarelli, girada en el DWG. */
const tcus = trk.map((t, i) => {
  const fila = [r2(t.x - minx), r2(t.n - minn), t.ncu || 1, t.gw || t.ncu || 1,
                t.id || ('T' + String(i + 1).padStart(3, '0'))];
  const az = +t.rot || 0;
  if (tieneCotas) { fila.push(null, largoDe(t), ancho); if (az) fila.push(+az.toFixed(2)); }
  else if (az) fila.push(null, null, null, +az.toFixed(2));
  return fila;
});
const ncus = (L.ncus || []).map((n, i) => [i + 1, String(i + 1), 'ETH', r2(n.x - minx), r2(n.n - minn)]);
const hsus = (L.meteo || []).map((m, i) => [m.name || ('HSU ' + (i + 1)), String(i + 1),
                                            r2(m.x - minx), r2(m.n - minn), 1]);
const reps = (L.reps || []).map((p, i) => [i + 1, String(i + 1), r2(p.x - minx), r2(p.n - minn)]);

const TIT = { bagnarelli: 'Bagnarelli 24030', tunez: 'Túnez 24021', paramo: 'Páramo 25019',
              fayon: 'Fayón 24007', ayora: 'Ayora 24025', sanjose: 'San José 24019', elburgo: 'El Burgo I 23003' };
const P = { ox: +cE.toFixed(1) + minx, oy: +cN.toFixed(1) + minn, sc: SC[planta] || planta,
            name: L.title || TIT[planta] || planta,
            usePS: true, showGZ: false, ncus, tcus, hsus, reps };
if (!tieneCotas) { /* sin cotas en el layout no se declara nada de la mesa */ }
else if (filaZ > 0.05) P.bifilo = { cuerda: cuerda };       // dos filas: el siting deduce el pasillo = ancho − cuerda
else P.monofila = true;                                     // filaZ 0: una sola banda
P.ox = +P.ox.toFixed(1); P.oy = +P.oy.toFixed(1);

const nRot = trk.filter(t => (+t.rot || 0) !== 0).length;

console.log(`planta ${planta} · ${L.crs} · origen UTM ${origen}`);
console.log(`  ${tcus.length} TCU · ${ncus.length} NCU · ${hsus.length} HSU · ${reps.length} repetidores`);
console.log(`  esquina (0,0) en UTM ${P.ox} ${P.oy}  ·  campo ${(Math.max(...trk.map(t => t.x)) - minx).toFixed(1)} × ${(Math.max(...trk.map(t => t.n)) - minn).toFixed(1)} m`);
if (!tieneCotas) console.log('  ⚠ el layout NO trae modW/mods/filaZ: se emiten solo las posiciones, sin cotas de mesa (inventarlas daría la mesa de El Burgo)');
else console.log(`  mesa: ${spanFull.toFixed(2)} m de largo (${modsAla} mod/ala x ${modW} m) x ${ancho} m de ancho ${filaZ > 0.05 ? `(bifila, filas a +-${filaZ} m, cuerda ${cuerda})` : '(monofila)'}`);
if (tieneCotas) { const largos = [...new Set(tcus.map(t => t[6]))].sort((a, b) => b - a);
  console.log(`  longitudes distintas: ${largos.join(' · ')} m`); }
if (nRot) console.log(`  ${nRot} seguidores girados (rot != 0) -> se pasa como azimut por seguidor, que el siting si dibuja`);

if (VERIFICA) {
  /* Prueba del convenio: se regenera una planta que YA está en el siting y se compara punto a
     punto por vecino más próximo (los identificadores no coinciden entre las dos fuentes). */
  const h = readFileSync(DESTINOS[destinos[0]], 'utf8');
  const nom = nomVar;
  const ini = h.indexOf('const ' + nom + '='); if (ini < 0) { console.error('esa planta no está en ' + destinos[0]); process.exit(1); }
  const fin = h.indexOf('\nconst ', ini + 5);
  const VIEJO = (new Function(h.slice(ini, fin > 0 ? fin : undefined) + '; return ' + nom + ';'))();
  /* SE COMPARA EN UTM ABSOLUTO, no en el sistema local de cada dataset.
     La esquina (0,0) de un dataset es un convenio interno: si dos versiones la ponen en un sitio
     distinto, TODOS los puntos salen desplazados en local aunque estén en el mismo sitio del mundo,
     porque el ox/oy compensa exactamente ese desplazamiento. El Burgo daba así 11,00 m de error
     —y son 0,00 m reales, con el origen 11 m más al norte y las Y 11 m más bajas—. Esta trampa ya
     me la comí una vez midiendo en local; medir en absoluto es lo único que dice la verdad. */
  const georref = (VIEJO.ox || 0) !== 0 || (VIEJO.oy || 0) !== 0;
  const AX = georref ? P.ox : 0, AY = georref ? P.oy : 0;
  const BX = georref ? VIEJO.ox : 0, BY = georref ? VIEJO.oy : 0;
  let peor = 0, sum = 0;
  for (const t of tcus) {
    let d = Infinity;
    for (const v of VIEJO.tcus) { const q = Math.hypot((BX + v[0]) - (AX + t[0]), (BY + v[1]) - (AY + t[1])); if (q < d) d = q; }
    sum += d; if (d > peor) peor = d;
  }
  console.log(`\nVERIFICACIÓN contra el ${nom} que ya está en ${destinos[0]}${georref ? ' (en UTM absoluto)' : ' (EN LOCAL: el que hay no tiene georreferencia)'}:`);
  console.log(`  ${tcus.length} vs ${VIEJO.tcus.length} TCU · distancia media ${(sum / tcus.length).toFixed(3)} m · peor ${peor.toFixed(3)} m`);
  console.log(`  ox ${P.ox} vs ${VIEJO.ox} (${(P.ox - VIEJO.ox).toFixed(2)} m) · oy ${P.oy} vs ${VIEJO.oy} (${(P.oy - VIEJO.oy).toFixed(2)} m)` +
              (georref ? '' : '   ← sin georreferencia no hay nada que comparar en absoluto'));
  /* Tolerancia 0,30 m y no 0,15: en absoluto ya no se cancela el redondeo. El origen va a 0,1 m y
     cada coordenada también, en las dos versiones, así que el peor caso legítimo es 0,1+0,1 por eje.
     Páramo se queda en 0,200 justo por eso; por encima de 0,30 ya no es redondeo, es geometría. */
  const bien = peor < 0.30 && georref;
  console.log(bien ? '  ✓ mismo sitio del mundo: el convenio es el mismo' : '  ✗ NO coincide: no generes nada hasta entenderlo');
  process.exit(bien ? 0 : 1);
}

const js = o => JSON.stringify(o);
const literal = `const ${nomVar}=${js(P)};`;
if (!WRITE) { console.log(`\n(dry-run: pasa --write para inyectarlo en ${destinos.join(' y ')})`); console.log(literal.slice(0, 300) + '…'); process.exit(0); }

for (const d of destinos) {
  const ruta = DESTINOS[d];
  let h = readFileSync(ruta, 'utf8');
  const marca = 'const ' + nomVar + '=';
  if (h.includes(marca)) {
    const i = h.indexOf(marca), j = h.indexOf('\nconst ', i + 5);
    h = h.slice(0, i) + literal + h.slice(j > 0 ? j : i + marca.length);
  } else {
    const anc = 'const BURGO=';                            // se inserta junto a los demás
    if (!h.includes(anc)) { console.error(`  ✗ ${d}: no encuentro dónde insertarlo (falta ${anc})`); process.exit(1); }
    h = h.replace(anc, literal + '\n' + anc);
  }
  writeFileSync(ruta, h);
  console.log(`  inyectado en ${d} (${ruta})`);
}
