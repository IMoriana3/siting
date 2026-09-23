/* careo_terreno_3d.mjs — que el motor y el 3D lean el MISMO fichero IGUAL.
 *
 * ═══ POR QUÉ ESTO EXISTE ═══
 *
 * `terreno_planta.js` dice que su muestreo es «el mismo que `relAt` del 3D,
 * transcrito». Una transcripción es una copia, y una copia se separa del
 * original sin que nadie lo note — que es exactamente la avería que este repo
 * ya cazó con las dos funciones de despeje. Así que no se afirma: se carea.
 *
 * Y NO CONTRA UNA REIMPLEMENTACIÓN. El `relAt` con el que se carea se EXTRAE
 * del propio `terreno.html` de cobertura-zigbee y se ejecuta. Si allí cambia la
 * cuenta, aquí sale rojo.
 *
 * ═══ POR QUÉ NO ESTÁ EN LA CI ═══
 *
 * Necesita el repo hermano, y un banco que dependa de otro repositorio sale
 * VERDE en la máquina de quien lo escribió y ROJO en la CI. Ya pasó una vez en
 * este repo. Así que va de útil: se corre a mano —o en una máquina que tenga
 * los dos— y si no encuentra el hermano lo dice y sale con 0, sin fingir que
 * ha comprobado algo.
 *
 * Lo que SÍ está en la CI es `tests/test_terreno_planta.js`, con los valores
 * calculados a mano, que es lo que prueba que la transcripción de aquí es
 * correcta por sí misma.
 *
 * ═══ MEDIDO EL 2026-09-23 ═══
 *
 *   fichero   dicayagua_relieve.json  (malla 501 x 189 a 10 m, 59,4 % de nulos)
 *   muestras  200.000 al azar con semilla fija, sobre la malla Y 200 m alrededor
 *   iguales   200.000   (142.081 de ellas «los dos dicen null»)
 *   peor |Δ|  0   — cero exacto, bit a bit, no «por debajo de la tolerancia»
 *
 *   node tools/careo_terreno_3d.mjs [--hermano ../Cobertura-Zigbee]
 *                                   [--relieve dicayagua_relieve.json] [--n 200000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const HERMANO = arg('hermano', path.join(RAIZ, '..', 'Cobertura-Zigbee'));
const RELIEVE = arg('relieve', 'dicayagua_relieve.json');
const N = parseInt(arg('n', '200000'), 10);

/* EL MODULO SE CARGA ANTES DE MIRAR SI HAY HERMANO, y es a proposito. Sin
   hermano este util no carea nada y sale con 0, asi que en la CI no comprobaria
   NADA — que es justo como se pudrieron los dos utiles que nadie corria, uno de
   ellos con un `require('/home/user/Siting/...')` absoluto dentro. Cargando
   aqui, el paso de CI al menos prueba que el util arranca, que resuelve la ruta
   del motor y que la API que usa sigue existiendo. */
const T = require(path.join(RAIZ, 'terreno_planta.js'));
for (const fn of ['cargaRelieve', 'cotaEn', 'perfilEntre', 'dentroDeLaMalla', 'cobertura']) {
  if (typeof T[fn] !== 'function') {
    console.error('terreno_planta.js ya no exporta ' + fn + '(): este útil se ha quedado viejo');
    process.exit(2);
  }
}

const html = path.join(HERMANO, 'terreno.html');
const fich = path.join(HERMANO, RELIEVE);
if (!fs.existsSync(html) || !fs.existsSync(fich)) {
  console.log('SIN CAREO: falta el repo hermano en ' + HERMANO);
  console.log('  ' + html + (fs.existsSync(html) ? ' ✓' : ' ✗'));
  console.log('  ' + fich + (fs.existsSync(fich) ? ' ✓' : ' ✗'));
  console.log('No se ha comprobado nada. Esto no es un verde.');
  /* rc = 2, NO 0: «no comprobado» tiene que salir DISTINTO de «comprobado y
     pasa». Con rc = 0 este util imprimia «Esto no es un verde» y la CI lo
     pintaba verde igual — el agregador lee el codigo de salida, no el texto.
     Es el mismo defecto que #738 arreglo en el banco de configuracion. */
  process.exit(2);
}

/* EXTRACCIÓN DE `relAt`, acotada por los dos extremos exactos. Si el corte
   fallara se llevaría por delante el bloque siguiente —que llama a `demAt` y no
   existe aquí—, así que el fallo es ruidoso y no silencioso. */
const src = fs.readFileSync(html, 'utf8');
const i0 = src.indexOf('  function relAt(x,n)');
const i1 = src.indexOf('\n  if(REL){var _dl=[];', i0);
if (i0 < 0 || i1 < 0) {
  console.error('no se pudo acotar relAt en terreno.html: ¿se ha renombrado o movido?');
  process.exit(2);
}
const cuerpo = src.slice(i0, i1);

const REL = JSON.parse(fs.readFileSync(fich, 'utf8'));
const relAt = new Function('REL', cuerpo + '\nreturn relAt;')(REL);

const t = T.cargaRelieve(REL);
if (!t) { console.error('cargaRelieve RECHAZÓ ' + RELIEVE + ': el fichero no tiene la forma esperada'); process.exit(1); }

console.log('careo ' + RELIEVE + ' — malla ' + t.nx + ' x ' + t.nn + ' a ' + t.paso + ' m');
console.log('relAt extraído de terreno.html, ' + (cuerpo.split('\n').length) + ' líneas\n');

/* El muestreo se sale 200 m POR FUERA de la malla a propósito: la rama del
   nulo —fuera de rango y esquina sin dato— es la mitad del contrato, y un
   careo que sólo pise la zona con dato deja sin mirar justo lo que decide si el
   enlace se queda sin relieve. */
const pad = 200;
const X0 = t.x0 - pad, X1 = t.x0 + t.nx * t.paso + pad;
const N0 = t.n0 - pad, N1 = t.n0 + t.nn * t.paso + pad;
let s = 12345;
const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

let iguales = 0, ambosNull = 0, discrepa = 0, peor = 0, ejemplo = null;
for (let k = 0; k < N; k++) {
  const x = X0 + (X1 - X0) * rnd(), n = N0 + (N1 - N0) * rnd();
  const a = T.cotaEn(t, x, n), b = relAt(x, n);
  if (a === null && b === null) { ambosNull++; iguales++; continue; }
  if (a === null || b === null) { discrepa++; if (!ejemplo) ejemplo = { x, n, motor: a, tresD: b }; continue; }
  const d = Math.abs(a - b);
  if (d > peor) peor = d;
  if (d === 0) iguales++;
  else { discrepa++; if (!ejemplo) ejemplo = { x, n, motor: a, tresD: b, d }; }
}

console.log('muestras      ' + N.toLocaleString('es'));
console.log('idénticos     ' + iguales.toLocaleString('es') + '  (' + ambosNull.toLocaleString('es') + ' por la rama del nulo)');
console.log('discrepan     ' + discrepa.toLocaleString('es'));
console.log('peor |Δ|      ' + peor);
if (ejemplo) console.log('primer desacuerdo: ' + JSON.stringify(ejemplo));

/* CERO EXACTO, no una tolerancia. Las dos hacen la misma cuenta en el mismo
   orden sobre los mismos dobles: si difieren en el último bit es que ya NO son
   la misma cuenta, y eso es justo lo que este útil viene a detectar. */
if (discrepa === 0 && peor === 0) { console.log('\nTODO OK — el motor y el 3D leen el mismo fichero igual, bit a bit'); process.exit(0); }
console.log('\nMAL — el muestreo del motor se ha separado del 3D');
process.exit(1);
