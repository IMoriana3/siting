/* ¿CORRE LA CI TODAS LAS MUTACIONES QUE HAY, O SOLO LAS QUE ALGUIEN APUNTÓ?
 *
 * ═══ POR QUÉ ═══
 *
 * El corredor de mutaciones de `tests.yml` lleva las claves ESCRITAS A MANO,
 * banco por banco. Funciona —exige `rc = 1` exacto y eso ya ha cazado anclas
 * caducadas— pero tiene el defecto de hoy: afirma «las mutaciones, en rojo» y
 * sólo corre las que alguien se acordó de apuntar.
 *
 * Encontrado midiéndolo: `puntoDuplicado`, añadida a `test_radio_geom.js` el
 * 2026-09-23 para vigilar el punto pegado al extremo del perfil, NO estaba en
 * la lista. O sea que la mutación existía, el banco la sabía poner, y la CI no
 * la corría nunca. Verde, y sin vigilar.
 *
 * Es el mismo patrón que el resto de lo de hoy: una puerta verde afirma dos
 * cosas, «he mirado» y «está bien», y ésta sólo comprobaba la segunda. Romper
 * una mutación de la lista la ponía roja, como debe; lo que no decía es
 * CUÁNTAS de las que hay estaba corriendo.
 *
 * ═══ QUÉ HACE ═══
 *
 * Lee las claves de `const MUTACIONES = {...}` de cada banco, lee las que
 * `tests.yml` nombra, y las carea. Cualquiera definida y no corrida es ROJO.
 *
 *     node tools/alcance_mutaciones.mjs
 *
 * Códigos: 0 todas corren · 1 alguna definida no corre · 2 no se ha podido mirar
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WF = path.join(RAIZ, '.github/workflows/tests.yml');

if (!fs.existsSync(WF)) {
  console.log('SIN ALCANCE: no encuentro .github/workflows/tests.yml.');
  console.log('No se ha mirado nada. Esto no es un verde.');
  process.exit(2);
}
const yml = fs.readFileSync(WF, 'utf8');

/* Los bancos con tabla de mutaciones, descubiertos y no listados a mano: una
   lista a mano aquí tendría el mismo defecto que vengo a cazar. */
const dirTests = path.join(RAIZ, 'tests');
const bancos = fs.existsSync(dirTests)
  ? fs.readdirSync(dirTests).filter(f => /^test_.*\.(js|py)$/.test(f)).sort() : [];

/* ── EL DENOMINADOR, que es lo que le faltaba a este útil ─────────────────
   Publicaba «140 de 140 mutaciones, en 13 bancos con tabla» y ese 100 % es
   sobre los bancos QUE TIENEN TABLA. Si alguien borra un bloque MUTACIONES
   entero, esto pasa a decir «100 %, en 12 bancos» y se queda verde: la tabla
   desaparecida no la echa de menos nadie.
   Es el mismo defecto que este fichero vino a cazar, en sí mismo — la novena
   vez en el día que una comprobación mira un conjunto más pequeño del que
   debe. Ahora lleva el denominador y un PISO de bancos con tabla.
   El piso se MIDE y sólo se BAJA a propósito: hoy 13 de 19 bancos tienen
   tabla, y los 6 sin ella no son un defecto —no todo banco necesita
   mutaciones—, pero perder una SÍ lo es. */
const PISO_BANCOS = 13;   // MEDIDO el 2026-09-23

/* Y los de `tools/`, que este útil no barre. Hoy no hay ninguno con tabla;
   si aparece, se dice en vez de ignorarlo. */
const dirTools = path.join(RAIZ, 'tools');
const conTablaFuera = (fs.existsSync(dirTools) ? fs.readdirSync(dirTools) : [])
  .filter(f => /^test_.*\.(mjs|js|py)$/.test(f))
  .filter(f => /(?:const )?MUTACIONES\s*[=:]\s*\{/.test(fs.readFileSync(path.join(dirTools, f), 'utf8')));
if (!bancos.length) {
  console.log('SIN ALCANCE: no hay bancos en tests/.');
  console.log('No se ha mirado nada. Esto no es un verde.');
  process.exit(2);
}

function clavesDe(src) {
  const m = src.match(/(?:const )?MUTACIONES\s*[=:]\s*\{([\s\S]*?)\n\}/);
  if (!m) return null;
  const js = [...m[1].matchAll(/^\s{2,4}([A-Za-z0-9_]+)\s*:/gm)].map(x => x[1]);
  const py = [...m[1].matchAll(/^\s{2,4}"([a-z0-9_]+)"\s*:/gm)].map(x => x[1]);
  return [...new Set([...js, ...py])];
}

console.log('¿CORRE LA CI TODAS LAS MUTACIONES QUE HAY?\n');
console.log('  banco                         definidas  en CI   alcance');
let faltan = [], nBancos = 0, nMut = 0, nCI = 0;
for (const b of bancos) {
  const src = fs.readFileSync(path.join(dirTests, b), 'utf8');
  const claves = clavesDe(src);
  if (!claves || !claves.length) continue;
  nBancos++;
  /* LAS INVOCACIONES DE VERDAD, TODAS. La primera versión de esto tomaba
     `yml.indexOf(b)` y 1.200 caracteres — y el nombre del banco aparece antes
     en un COMENTARIO, 170 líneas por encima de donde se le pasan las claves.
     Resultado: `test_paridad_radio.py` salía con 0 de 24 mutaciones corridas,
     un falso hallazgo, en el útil escrito precisamente para cazar alcances
     parciales. Sexta vez hoy que una comprobación mira donde no debe.
     Ahora se recogen TODAS las apariciones y se une lo que sigue a cada una,
     con las continuaciones de línea `\` desdobladas. */
  const trozo = [...yml.matchAll(new RegExp(b.replace(/[.]/g, '\\.'), 'g'))]
    .map(mm => yml.slice(mm.index, mm.index + 1500)).join('\n');
  const sin = claves.filter(k => !new RegExp('\\b' + k + '\\b').test(trozo));
  nMut += claves.length; nCI += claves.length - sin.length;
  console.log('  %s %s %s   %s%s', b.padEnd(28), String(claves.length).padStart(9),
    String(claves.length - sin.length).padStart(6),
    ((100 * (claves.length - sin.length) / claves.length).toFixed(0) + ' %').padStart(6),
    sin.length ? '  ⚠ ' + sin.join(', ') : '');
  for (const k of sin) faltan.push(b + ' · ' + k);
}
console.log('');
console.log('  ALCANCE: %d de %d mutaciones · %d de %d bancos tienen tabla (piso %d)',
  nCI, nMut, nBancos, bancos.length, PISO_BANCOS);
if (conTablaFuera.length)
  console.log('  ⚠ y %d banco(s) con tabla en tools/, que este útil NO barre: %s',
    conTablaFuera.length, conTablaFuera.join(', '));
console.log('');
console.log('  Una puerta verde afirma dos cosas: «he mirado» y «está bien».');
console.log('  El corredor de mutaciones comprobaba la segunda —exige rc = 1 exacto—');
console.log('  y no la primera: corría las que alguien apuntó, no las que hay.');

if (nBancos < PISO_BANCOS) {
  console.log('\n  ⚠ BANCOS CON TABLA: %d, y el piso son %d.', nBancos, PISO_BANCOS);
  console.log('  Un bloque MUTACIONES borrado no lo echa de menos nadie: el porcentaje');
  console.log('  sigue saliendo 100 %, sobre un conjunto más pequeño. Si el recorte es a');
  console.log('  propósito, baja el piso aquí y escribe por qué.');
  process.exit(1);
}
if (conTablaFuera.length) {
  console.log('\n  ⚠ hay tablas de mutaciones en tools/ y este útil sólo barre tests/.');
  console.log('  Muévelas, o amplía el barrido. Mientras, NO están vigiladas.');
  process.exit(1);
}
if (faltan.length) {
  console.log('\n  ⚠ DEFINIDAS Y NO CORRIDAS EN CI:');
  for (const f of faltan) console.log('      ' + f);
  console.log('\n  Una mutación que existe y no corre no vigila nada. Añádela al paso');
  console.log('  «y las mutaciones, en rojo» de tests.yml, o bórrala del banco.');
  process.exit(1);
}
console.log('\n  todas las mutaciones definidas se corren en CI');
