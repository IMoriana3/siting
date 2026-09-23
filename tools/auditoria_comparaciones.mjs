/* auditoria_comparaciones.mjs — las comparaciones que deciden si un dato EXISTE.
 *
 * ═══ POR QUÉ ESTE ÚTIL EXISTE ═══
 *
 * `recortaPerfil` comparaba `largo < D` a secas, y eso dejaba sin término de
 * relieve a 568 de 6.036 enlaces reales (9,4 %) por un déficit de 2,13e-13 m.
 * No era un error de fórmula: era una comparación de coma flotante decidiendo
 * si un dato EXISTE, con los dos lados venidos de rutas de cálculo distintas.
 *
 * Esto barre las demás. La pregunta no es «¿hay comparaciones de flotantes?»
 * —las hay a cientos y casi todas dan igual— sino:
 *
 *   ¿decide esta comparación si un dato EXISTE o en qué ESTADO está?
 *   ¿y vienen sus dos lados de rutas de cálculo INDEPENDIENTES?
 *
 * Sólo cuando las dos respuestas son que sí, un último bit cambia el
 * resultado. Cada caso se CLASIFICA y, si es de riesgo, se MIDE igual que se
 * midió aquél: se perturba a 1 m, 1 mm, 1 µm y 1e-13, y se mira si la decisión
 * se vuelca y cuánto se mueve la salida.
 *
 *   node tools/auditoria_comparaciones.mjs
 *
 * ═══ LOS SITIOS SE CITAN POR SÍMBOLO, NO POR LÍNEA ═══
 *
 * Este repo ya se comió siete citas `_fuente` por número de línea, seis de
 * ellas caducadas sin que nadie las moviera: se movieron solas cuando otro PR
 * añadió comentarios. Aquí se cita la función, y el barrido comprueba que
 * sigue existiendo: si alguien la renombra, esto se para.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const R = require(path.join(RAIZ, 'radio_pv_model.js'));
const TP = require(path.join(RAIZ, 'terreno_planta.js'));
const F = 2.45e9;

/* ── EL CATÁLOGO ──────────────────────────────────────────────────────────
   `simbolo` tiene que aparecer en `fichero`, o el barrido se para: una cita
   que ya no existe es peor que ninguna. */
const CASOS = [
  { id: 'recortaPerfil · el perfil cubre el vano',
    fichero: 'radio_pv_model.js', simbolo: 'function recortaPerfil',
    clase: 'INDEPENDIENTE', estado: 'ARREGLADO HOY',
    que: '`largo` acumula nSeg sumas de D/nSeg; `D` viene de Math.hypot. Rutas distintas.' },
  { id: 'recortaPerfil · el punto interior pegado al extremo',
    fichero: 'radio_pv_model.js', simbolo: 'function recortaPerfil',
    clase: 'INDEPENDIENTE', estado: 'ARREGLADO HOY',
    que: 'con la tolerancia puesta, el último punto entraba como interior Y como extremo.' },
  { id: 'tierraLisa · hobs > 0 elige la rama de la ec. (90)',
    fichero: 'radio_pv_model.js', simbolo: 'function tierraLisa',
    clase: 'ACUMULADO', estado: 'medido abajo',
    que: '`hobs` es un máximo de diferencias; con perfil plano debería ser 0 exacto.' },
  { id: 'bullingtonDetalle · el canto cae dentro del vano (0 < s < D)',
    fichero: 'radio_pv_model.js', simbolo: 'function bullingtonDetalle',
    clase: 'MISMA RUTA', estado: 'sin riesgo',
    que: '`s` y `D` salen del MISMO perfil recortado, cuyo último punto ES D. No son rutas distintas.' },
  { id: 'regimen · n1 < 1e-9 declara el vano degenerado',
    fichero: 'radio_pv_model.js', simbolo: 'function regimen',
    clase: 'UMBRAL ABSOLUTO', estado: 'medido abajo',
    que: 'umbral fijo en metros. Un vano de 1e-9 m no existe, pero el umbral NO es relativo.' },
  { id: 'perdidaFiloDb · el corte en ν = −0,78',
    fichero: 'radio_pv_model.js', simbolo: 'function perdidaFiloDb',
    clase: 'CONSTANTE FÍSICA', estado: 'sin riesgo',
    que: 'es de P.526, no de acumulación: marca dónde la difracción deja de cobrar.' },
  { id: 'campoCercano · d < umbral·λ',
    fichero: 'radio_pv_model.js', simbolo: 'function campoCercano',
    clase: 'CONSTANTE FÍSICA', estado: 'sin riesgo',
    que: 'umbral en longitudes de onda, elegido y declarado. No decide existencia de un dato.' },
  { id: 'cotaEn · el punto cae dentro de la malla',
    fichero: 'terreno_planta.js', simbolo: 'function cotaEn',
    clase: 'ÍNDICE ENTERO', estado: 'vigilado por `sinBordeMalla`',
    que: 'el riesgo no es el bit: es que undefined == null tapaba la lectura fuera de rango.' },
  { id: 'el corte t ∈ (0,001 ; 0,999) de los cruces de fila',
    fichero: 'tools/malla_plantas.mjs', simbolo: 't > 0.001',
    clase: 'RELATIVO Y DELIBERADO', estado: 'medido abajo',
    que: 'corte relativo al vano (0,1 %), no coma flotante. Pero SÍ decide si un cruce existe.' }
];

let paradas = 0;
console.log('LAS COMPARACIONES QUE DECIDEN SI UN DATO EXISTE\n');
console.log('  clase                 qué significa');
console.log('  INDEPENDIENTE         los dos lados vienen de rutas de cálculo distintas → RIESGO');
console.log('  ACUMULADO             un lado acumula y se compara contra un literal → medir');
console.log('  MISMA RUTA            los dos lados salen del mismo cálculo → el bit coincide');
console.log('  UMBRAL ABSOLUTO       constante con unidades; no falla por bits, sí por escala');
console.log('  CONSTANTE FÍSICA      viene de una Recomendación o de una elección declarada\n');

console.log('  ' + 'sitio'.padEnd(52) + 'clase'.padEnd(22) + 'estado');
for (const c of CASOS) {
  const f = path.join(RAIZ, c.fichero);
  if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8').indexOf(c.simbolo) < 0) {
    console.log('  ⚠ ' + c.id.padEnd(50) + 'LA CITA YA NO EXISTE: «' + c.simbolo + '» no está en ' + c.fichero);
    paradas++;
    continue;
  }
  console.log('  ' + c.id.padEnd(52) + c.clase.padEnd(22) + c.estado);
}
console.log('');
for (const c of CASOS) console.log('  · ' + c.id + '\n      ' + c.que);

/* ══ LAS MEDIDAS ═══════════════════════════════════════════════════════════
   Mismo patrón que cazó el defecto: perturbar a cuatro escalas y mirar si la
   DECISIÓN se vuelca. Una tolerancia buena distingue 1e-13 de 1 µm. */
const ESCALAS = [['1 m', 1], ['1 mm', 1e-3], ['1 µm', 1e-6], ['1e-13 m', 1e-13]];

console.log('\n═══ 1 · recortaPerfil, las dos, probadas a cuatro escalas ═══\n');
console.log('  déficit del perfil     ¿se acepta?   ¿es lo correcto?');
for (const [etq, d] of ESCALAS) {
  const p = [[0, 0], [50, 1], [100 - d, 2]];
  const ok = R.recortaPerfil(p, 100) !== null;
  const debe = d <= 1e-7;           // 1e-9 relativo sobre 100 m
  console.log('  ' + etq.padEnd(22) + (ok ? 'sí' : 'NO').padEnd(14)
            + (ok === debe ? 'sí' : '⚠ NO'));
  if (ok !== debe) paradas++;
}
{
  /* Y el duplicado: el recorte no puede devolver dos puntos pegados. */
  const p = [[0, 0], [40, 3], [100 - 1e-13, 1]];
  const out = R.recortaPerfil(p, 100);
  const sep = out[out.length - 1][0] - out[out.length - 2][0];
  const bien = sep > 1e-7;
  console.log('\n  separación de los dos últimos puntos del recorte: ' + sep.toExponential(2) + ' m  '
            + (bien ? '(no hay duplicado)' : '⚠ HAY DUPLICADO'));
  if (!bien) paradas++;
}

console.log('\n═══ 2 · tierraLisa: ¿el perfil plano da hobs = 0 EXACTO? ═══\n');
console.log('  Si `hobs` saliera 1e-16 en vez de 0, la ec. (90) tomaría la rama de');
console.log('  obstáculo en vez de la lisa. Se prueba con perfiles planos a cotas grandes,');
console.log('  que es donde la cancelación es más difícil.\n');
console.log('  cota del perfil       hobs        rama       relieve (debe ser 0)');
for (const cota of [0, 100, 739.23, 1605.3]) {
  const p = []; for (let i = 0; i <= 20; i++) p.push([200 * i / 20, cota]);
  const L = R.tierraLisa(p);
  const rel = R.relieveDeltaDb(200, cota + 0.505, cota + 3.15, p, F);
  const rama = (L.hobs > 0) ? 'obstáculo' : 'lisa';
  const bien = !(L.hobs > 0) && rel && rel.db === 0;
  console.log('  ' + String(cota).padEnd(22) + (L.hobs == null ? 'null' : L.hobs.toExponential(2)).padEnd(12)
            + rama.padEnd(11) + (rel && rel.db != null ? rel.db.toExponential(2) : 'null')
            + (bien ? '' : '   ⚠'));
  if (!bien) paradas++;
}

console.log('\n═══ 3 · regimen: el umbral de 1e-9 es ABSOLUTO ═══\n');
for (const [etq, n] of [['1 m', 1], ['1 mm', 1e-3], ['1 µm', 1e-6], ['1 nm', 1e-9], ['0,1 nm', 1e-10]]) {
  const r = R.regimen(n, 0, 0, 1, 10);
  console.log('  vano de ' + etq.padEnd(10) + '→ ' + r.tipo);
}
console.log('');
console.log('  NO es un defecto: un vano de un nanómetro no existe en una planta solar.');
console.log('  Pero el umbral tiene UNIDADES y el código no las declara: si alguien');
console.log('  pasara coordenadas en kilómetros, 1e-9 km son 1 µm y el corte se movería');
console.log('  seis órdenes de magnitud. Queda DICHO, no arreglado: cambiarlo a relativo');
console.log('  exigiría una escala de referencia que aquí no hay.');

console.log('\n═══ 4 · el corte t ∈ (0,001 ; 0,999) de los cruces de fila ═══\n');
console.log('  Es RELATIVO al vano y DELIBERADO —ignora cruces pegados a los extremos,');
console.log('  donde la geometría del propio seguidor ya manda— pero decide si un cruce');
console.log('  EXISTE, así que entra en esta lista. Sobre un vano de 120 m tira todo lo');
console.log('  que caiga en los primeros y últimos 12 cm.');
console.log('');
console.log('  `tools/sin_dato_horas.mjs` ya mide su efecto sobre datos reales, y ahí es');
console.log('  donde tiene que mirarse: aquí sólo se deja anotado que existe y que no es');
console.log('  el mismo problema que el picómetro —no es un bit, es una decisión física');
console.log('  con su número—.');

console.log('\n═══ VEREDICTO ═══\n');
if (paradas) {
  console.log('  ⚠ ' + paradas + ' comprobación(es) en rojo. Algo de arriba no se cumple.');
  process.exit(1);
}
console.log('  Las dos de clase INDEPENDIENTE están arregladas y probadas a cuatro escalas.');
console.log('  La de clase ACUMULADO (hobs) da cero exacto hasta 1.605 m de cota.');
console.log('  Las de MISMA RUTA, CONSTANTE FÍSICA e ÍNDICE no necesitan tolerancia, y se');
console.log('  dice por qué en vez de dejarlas sin mirar.');
console.log('');
console.log('  LA REGLA QUE SALE DE AQUÍ, para la próxima:');
console.log('    una comparación de flotantes necesita tolerancia RELATIVA cuando decide');
console.log('    si un dato existe Y sus dos lados vienen de rutas de cálculo distintas.');
console.log('    Si vienen del mismo cálculo, el bit coincide y la tolerancia sobra.');
console.log('    Y la tolerancia se prueba a 1 m, 1 mm y 1 µm: una que no distinga esas');
console.log('    tres de 1e-13 no es una tolerancia, es un apagón.');
