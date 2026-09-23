/* careo_equipos.mjs — que las cotas de equipo que este repo copia sigan siendo
 * las del repo que las declara.
 *
 * ═══ POR QUÉ, Y CÓMO SE DESCUBRIÓ ═══
 *
 * `radio_params.json` no inventa las cotas de antena: las copia de
 * `cobertura-zigbee`, que es donde están los planos. Cada una viene con su
 * `_fuente`, y las cuatro citaban **un número de línea**:
 *
 *     antena_ncu_m    «equipos.js:44  ncuAntY: 3.15»
 *     antena_hsu_m    «equipos.js:59  hsuAntY: 6.50»
 *     coax_caida_m    «seguidor.js:35  antHang: 0.50»
 *     radio_ancla_m   «seguidor.js:340  mT(…, D.tcuX-0.16, -0.225, 0)»
 *
 * **Las CUATRO estaban caducadas**, medido: `ncuAntY` vive en la 61, `hsuAntY`
 * en la 76, `antHang` en la 45 y el anclaje en la 350. Nadie las movió a mano:
 * se movieron solas cuando el PR #714 añadió comentarios a esos ficheros. Una
 * cita por número de línea se pudre por construcción, y una cita podrida es
 * peor que ninguna, porque parece que alguien lo comprobó.
 *
 * Así que las citas pasan a ser por **SÍMBOLO**, y este útil comprueba que el
 * símbolo existe allí y que vale lo mismo que aquí.
 *
 * ═══ LO QUE ESTO NO PUEDE HACER, Y HAY QUE DECIRLO ═══
 *
 * «Una sola constante» en sentido estricto sería que este repo no tuviera
 * copia. No se puede: son dos repositorios y `radio_params.json` se lee sin red
 * ni hermano. Lo que sí se puede es que haya **una sola declaración con
 * autoridad** —`equipos.js`, citada del plano— y que la copia esté **vigilada**.
 * Es el mismo patrón que SolarGPTfull usa con el sha256 de
 * `zigbee_pv_model.lock.json`.
 *
 *   node tools/careo_equipos.mjs [--hermano ../Cobertura-Zigbee]
 *
 * Sin el hermano no carea y lo dice; lo que SÍ comprueba siempre —y por eso
 * corre en CI— es que ninguna `_fuente` haya vuelto a citar un número de línea.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const HERMANO = arg('hermano', path.join(RAIZ, '..', 'Cobertura-Zigbee'));

let ok = 0, ko = 0;
const check = (n, cond, extra) => { if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); } };

const P = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
/* Se recorre el árbol entero en vez de ir a rutas fijas: si mañana alguien
   mueve un parámetro de sección, esto lo sigue encontrando. */
function hojas(o, ruta, out) {
  if (!o || typeof o !== 'object') return out;
  if ('valor' in o && '_fuente' in o) out.push({ nombre: ruta[ruta.length - 1], ruta: ruta.join('.'), nodo: o });
  for (const k of Object.keys(o)) if (k[0] !== '_') hojas(o[k], ruta.concat(k), out);
  return out;
}
const TODAS = hojas(P, [], []);

/* ── 1 · NINGUNA `_fuente` CITA UN NÚMERO DE LÍNEA ────────────────────────
   Esto corre SIEMPRE, con hermano o sin él, y es la mitad que de verdad
   impide que el problema vuelva: aunque hoy los valores coincidan, una cita
   por línea volverá a caducar en el siguiente PR que toque esos ficheros. */
const CITA_LINEA = /\b(equipos\.js|seguidor\.js|terreno\.html|index\.html|overcast\.html)\s*:\s*\d+/;
const conLinea = TODAS.filter(h => CITA_LINEA.test(String(h.nodo._fuente)));
check('ninguna `_fuente` cita un número de línea de otro fichero',
      conLinea.length === 0,
      conLinea.map(h => h.nombre + ' → ' + (String(h.nodo._fuente).match(CITA_LINEA) || [''])[0]).join(', '));

/* ── 2 · EL CAREO, si hay hermano ─────────────────────────────────────────
   Cada entrada dice de qué fichero y de qué SÍMBOLO sale. El valor se saca
   leyendo el fuente del hermano, no re-tecleándolo aquí. */
const ESPERADO = [
  { param: 'antena_ncu_m',  fich: 'equipos.js',  simbolo: 'ncuAntY',   que: 'centro del látigo, en la cabeza del poste' },
  { param: 'antena_hsu_m',  fich: 'equipos.js',  simbolo: 'hsuAntY',   que: 'centro de los látigos, en su brazo a media torre' },
  { param: 'coax_caida_m',  fich: 'seguidor.js', simbolo: 'antHang',   que: 'lo que cuelga el coax desde el conector' },
];
/* El anclaje no es `nombre: valor`, es una posición dentro de una llamada, así
   que se saca con su propio patrón y se dice por qué va aparte. */
const ANCLA = { param: 'radio_ancla_m', fich: 'seguidor.js',
                patron: /mT\(\s*THREE\s*,\s*D\.tcuX\s*-\s*0\.16\s*,\s*-([\d.]+)\s*,\s*0\s*\)/,
                que: 'radio del anclaje: la Y local del conector respecto al eje del tubo' };

function valorDe(src, simbolo) {
  const m = new RegExp('\\b' + simbolo + '\\s*:\\s*(-?[\\d.]+)').exec(src);
  return m ? parseFloat(m[1]) : null;
}

const faltan = ['equipos.js', 'seguidor.js'].filter(f => !fs.existsSync(path.join(HERMANO, f)));
if (faltan.length) {
  console.log('\nSIN CAREO: falta ' + faltan.join(', ') + ' en ' + HERMANO);
  console.log('La comprobación de citas SÍ se ha hecho; el careo de valores NO.');
  console.log(ko ? '\nFALLAN ' + ko : '\nlo comprobable sin hermano, OK');
  console.log('No se ha comprobado nada. Esto no es un verde.');
  /* rc = 2, NO 0: «no comprobado» tiene que salir DISTINTO de «comprobado y
     pasa». Con rc = 0 este util salia sin decir nada y la CI lo
     pintaba verde igual — el agregador lee el codigo de salida, no el texto.
     Es el mismo defecto que #738 arreglo en el banco de configuracion. */
  process.exit(ko ? 1 : 2);
}

const fuentes = {};
for (const f of ['equipos.js', 'seguidor.js']) fuentes[f] = fs.readFileSync(path.join(HERMANO, f), 'utf8');

console.log('');
for (const e of ESPERADO) {
  const h = TODAS.find(x => x.nombre === e.param);
  check('`' + e.param + '` existe en radio_params.json', !!h);
  if (!h) continue;
  const alla = valorDe(fuentes[e.fich], e.simbolo);
  check('`' + e.simbolo + '` sigue existiendo en ' + e.fich, alla !== null);
  if (alla === null) continue;
  check(e.param + ' = ' + h.nodo.valor + ' concuerda con ' + e.fich + ' `' + e.simbolo + '` = ' + alla,
        Math.abs(h.nodo.valor - alla) < 1e-12, h.nodo.valor + ' vs ' + alla);
  /* Y QUE LA CITA NOMBRE EL SÍMBOLO. Sin esto, una `_fuente` podría quedarse
     apuntando a otro sitio mientras el valor casa por casualidad. */
  check('y su `_fuente` nombra el símbolo `' + e.simbolo + '`',
        String(h.nodo._fuente).includes(e.simbolo),
        String(h.nodo._fuente).slice(0, 100));
}

const ha = TODAS.find(x => x.nombre === ANCLA.param);
const ma = ANCLA.patron.exec(fuentes[ANCLA.fich]);
check('el anclaje sigue estando en ' + ANCLA.fich + ' con su forma conocida', !!ma,
      ma ? null : 'no casa ' + ANCLA.patron);
if (ha && ma) {
  check(ANCLA.param + ' = ' + ha.nodo.valor + ' concuerda con el anclaje del 3D = ' + ma[1],
        Math.abs(ha.nodo.valor - parseFloat(ma[1])) < 1e-12, ha.nodo.valor + ' vs ' + ma[1]);
}

/* ── 3 · LA TORRE NO ES LA ANTENA, y este repo NO debe tener la torre ─────
   El `8` que se coló en la capa de enlaces de `terreno.html` era `hsuTowerH`
   usado como `hsuAntY`. Aquí se comprueba que las dos siguen siendo distintas
   ALLÍ, y que AQUÍ no hay ninguna copia de la torre: este repo no dibuja
   nada, así que una cota de torre en sus parámetros sólo podría servir para
   volver a confundirlas. */
const torre = valorDe(fuentes['equipos.js'], 'hsuTowerH');
const antena = valorDe(fuentes['equipos.js'], 'hsuAntY');
check('en equipos.js la torre (' + torre + ') y la antena (' + antena + ') siguen siendo DISTINTAS',
      torre !== null && antena !== null && Math.abs(torre - antena) > 1e-9, torre + ' / ' + antena);
const copiaTorre = TODAS.filter(h => Math.abs(h.nodo.valor - (torre ?? -1)) < 1e-12 &&
                                     /hsu|meteo|torre/i.test(h.ruta + ' ' + String(h.nodo._fuente)));
check('y este repo NO guarda ninguna copia de la altura de TORRE',
      copiaTorre.length === 0, copiaTorre.map(h => h.ruta).join(', '));

console.log('');
if (ko) { console.log('FALLAN ' + ko + ' de ' + (ok + ko)); process.exit(1); }
console.log('TODO OK — ' + ok + ' comprobaciones');
