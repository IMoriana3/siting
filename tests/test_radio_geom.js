// Geometría del motor nuevo: la BANDA con hueco inferior, el régimen del
// enlace y el relieve. Banco sin navegador.
//
// POR QUÉ. El modelo antiguo trata cada fila como un FILO DE CUCHILLO que sube
// DESDE EL SUELO hasta el borde superior del módulo. Eso cuenta como tapado un
// rayo que pasa POR DEBAJO del seguidor, y por debajo hay hueco. Es lo que
// tumbó el careo contra el 3D y es el cambio de fondo de la fase 1.
//
// LOS NÚMEROS ESPERADOS SE SACAN A MANO, no llamando a la función y mirando qué
// devuelve. Con cuerda 2,38 m y α = 30°, (c/2)·sen 30° = 1,19 · 0,5 = 0,595 m
// exactos, así que la banda de un eje a 2 m va de 1,405 a 2,595. Si el banco
// comparase contra su propia implementación no comprobaría nada.
//
//   node tests/test_radio_geom.js
//   MUTA=<clave> node tests/test_radio_geom.js     (mutación: TIENE que salir rojo)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};
const cerca = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol);

// ── MUTACIONES ───────────────────────────────────────────────────────────────
// Cada una rompe UNA cosa de la geometría. Si el banco sigue verde con una
// puesta, esa comprobación no comprobaba nada.
const MUTACIONES = {
  /* LA TOLERANCIA DEL PERFIL DESAPARECE y vuelve el `< D` a secas. Rechazaba
     568 de 6.036 enlaces REALES de la cartera —el 9,4 %, con 65 de Ayora y 275
     de San Jose— por un deficit de hasta 2,13e-13 m. Se quedaban sin termino de
     relieve con motivo «el perfil no cubre el vano», que es falso. */
  sinTolerancia:  ['radio_pv_model.js', /if \(largo < D && \(D - largo\) > 1e-9 \* D\) return null;/,
                                        'if (largo < D) return null;'],
  /* ...o se afloja hasta ser una puerta de mentira: con 1 % relativo, a un
     perfil de un vano de 447 m le pueden faltar 4,5 METROS y colar. */
  toleranciaFloja:['radio_pv_model.js', /\(D - largo\) > 1e-9 \* D/, '(D - largo) > 1e-2 * D'],
  /* EL PUNTO PEGADO AL EXTREMO SE DUPLICA: `recortaPerfil` mete el interior a
     1e-13 m del extremo Y ADEMAS el extremo, o sea dos cantos pegados, y `nu()`
     dividiendo por esa distancia.
     Esto se mata AQUI y no en el careo js-contra-py: el duplicado solo muerde
     si el suelo del extremo queda por encima del rayo, y el rayo en el extremo
     va a la altura de la antena —o sea, con la antena bajo tierra, que es un
     caso que para antes su propia guarda. Medido: 1,07e-14 dB. Ninguna
     comparacion de salidas puede verlo; la FORMA de lo devuelto, si. */
  puntoDuplicado: ['radio_pv_model.js', /if \(s > 0 && s < D && \(D - s\) > 1e-9 \* D\) out\.push/,
                                        'if (s > 0 && s < D) out.push'],
  /* EL CANTO EQUIVALENTE DEJA DE SER EL CORTE DE LAS DOS RECTAS y pasa a ser
     simplemente el canto MÁS ALTO. Es el error que parece igual y no lo es:
     con dos cerros iguales, Bullington pone el canto ENTRE ellos y más arriba
     que ninguno, porque el rayo tiene que salvar a los dos. */
  cantoAlMasAlto: ['radio_pv_model.js', /sB = \(zB - zA \+ sRim \* D\) \/ den;/,
    'sB = cantos.reduce(function (m, c) { return (c.s > 0 && c.s < D && (m === null || c.z > m.z)) ? c : m; }, null).s;'],
  /* Y EL PUNTO DEJA DE PUBLICARSE. Sin ruido: `db` sigue bien, los bancos del
     relieve siguen verdes, y lo único que se rompe es que
     `a5_repecho_local.mjs` ya no puede saber si un repecho está lejos del
     canto — o sea, su 2,0 % de enlaces afectados pasa a ser inventado. */
  puntoMudo:      ['radio_pv_model.js', /modo: modo, sB: sB, zBull: zBull, v: v \};/,
    'modo: modo, sB: null, zBull: null, v: v };'],
  // el error del modelo antiguo, reintroducido a propósito: filo desde el suelo
  filoDesdeSuelo: ['tests/referencia_banda_vertical.js', /zBot: eje - semi,/, 'zBot: sueloM == null ? 0 : sueloM,'],
  // media cuerda en vez de cuerda entera: la banda sale con la mitad de alto
  semiCuerda:     ['tests/referencia_banda_vertical.js', /var semi = \(cuerdaM \/ 2\)/, 'var semi = (cuerdaM / 4)'],
  // coseno en vez de seno: el seguidor plano taparía lo máximo y el vertical nada
  /* EL ANCLA LLEVA `var semi =` A PROPOSITO. Cuando `banda()` vivia en el
     motor, sin ese contexto casaba con la PRIMERA aparicion de
     `Math.abs(Math.sin(alphaDeg * GRADO))`, y al insertar `bajoTierra()`
     ENCIMA -con una expresion casi identica- la mutacion paso a mutar la
     funcion nueva, que este banco no prueba: se quedo DORMIDA en verde.
     Ahora la banda esta sola en la referencia y el riesgo ya no existe ahi,
     pero el contexto se queda: meter codigo parecido por encima de otro le
     roba sus anclas, y eso no avisa solo. */
  senoPorCoseno:  ['tests/referencia_banda_vertical.js', /var semi = \(cuerdaM \/ 2\) \* Math\.abs\(Math\.sin\(alphaDeg \* GRADO\)\)/,
                   'var semi = (cuerdaM / 2) * Math.abs(Math.cos(alphaDeg * GRADO))'],
  // el hueco deja de existir: cualquier rayo por debajo se da por tapado
  sinHueco:       ['tests/referencia_banda_vertical.js', /if \(zRayo < b\.zBot\) \{/, 'if (false) {'],
  // el régimen siempre dice «cruza»: se pierde el caso del pasillo
  siemprCruza:    ['radio_pv_model.js', /ang <= tol \? "pasillo" : "cruza"/, '"cruza"'],

  // ── LA TIERRA LISA, y las cuatro formas de romperla ──
  // se quita el CENTRADO: el ajuste pierde precision con cotas grandes y el
  // perfil plano a 739,23 m deja de dar cero EXACTO (1,44e-12 dB de residuo)
  sinCentrar:     ['radio_pv_model.js', /var dRef = perfil\[0\]\[0\], hRef = perfil\[0\]\[1\];/,
                                        'var dRef = 0, hRef = 0;'],
  // se cae el recorte de (92): la tierra lisa puede quedar POR ENCIMA del
  // terreno en los extremos y la antena queda enterrada en su referencia
  sinRecorte92:   ['radio_pv_model.js', /return \{ hst: Math\.min\(hst, hIni\) \+ hRef,/,
                                        'return { hst: hst + hRef,'],
  // el terreno vuelve a Deygout: el resultado pasa a depender del muestreo
  terrenoDeygout: ['radio_pv_model.js', /var a = bullingtonDb\(D, zA, zB, real, fHz\);/,
                                        'var a = difraccionCantosDetalle(D, zA, zB, real, fHz).totalDb;'],
  // el perfil deja de recortarse al vano: la recta se ajusta sobre TODO lo que
  // llegue y la altura de antena efectiva sale mal
  sinRecortarVano:['radio_pv_model.js', /var rec = recortaPerfil\(perfil, D\);/,
                                        'var rec = perfil;'],

  // ── y de la parte de TECNOLOGÍA ──
  // la frecuencia recupera un valor por defecto: el fallo que esto viene a
  // impedir es predecir sub-GHz con los números de 2,4 y que nadie se entere
  sinExigeF:      ['radio_pv_model.js', /if \(!\(fHz > 0\)\) throw new Error\([^;]*\);/, 'if (!(fHz > 0)) return 2.45e9;'],
  // el radio de Fresnel deja de depender de λ: la misma geometría despejaría
  // igual en 868 MHz que en 2,45 GHz, que es justo lo que NO se puede trasladar
  fresnelSinLambda: ['radio_pv_model.js', /\(nn \* longitudOnda\(fHz\) \* d1 \* d2\)/, '(nn * d1 * d2)'],
  // se cae el corte de ν = −0,78: la difracción empieza a dar pérdidas
  // NEGATIVAS (ganancia) donde debería dar 0
  filoSinCorte:   ['radio_pv_model.js', /if \(v <= -0\.78\) return 0\.0;/, 'if (false) return 0.0;'],
  // punto de ruptura con 2 en vez de 4
  rupturaMitad:   ['radio_pv_model.js', /return \(4 \* ht \* hr\) \/ longitudOnda\(fHz\);/, 'return (2 * ht * hr) / longitudOnda(fHz);'],
  // Deygout relanzado desde el borde SUPERIOR: el error del modelo antiguo,
  // metido esta vez en la reconstrucción y no en la banda
  // El ancla se movió al partir `difraccionBandasDetalle` en dos líneas (`cDom`
  // se reusa para `estado` y `despeje` en el detalle). La CI lo cazó con rc=2
  // — «no casó con el código»—, que es justo para lo que se exige rc=1 exacto:
  // con «distinto de cero» esta mutación habría contado como cazada sin serlo.
  bordeDeArriba:  ['tests/referencia_banda_vertical.js', /var bordeDom = cDom\.borde;/, 'var bordeDom = cruces[mejor].banda.zTop;'],

  // ── dos rayos ──
  // se cae el rayo reflejado: queda espacio libre y se pierden los lóbulos,
  // que es justo lo que este modelo añade sobre el FSPL
  sinReflejado:   ['radio_pv_model.js', /var campo = cAdd\(cx\(1 \/ dLos, 0\), refl\);/, 'var campo = cx(1 / dLos, 0);'],
  // el suelo pasa a ser un conductor perfecto sin pérdidas: eps deja de tener
  // parte imaginaria y el coeficiente de reflexión se vuelve real
  sueloSinPerdida:['radio_pv_model.js', /var eps = cx\(epsR, -60\.0 \* lam \* sigma\);/, 'var eps = cx(epsR, 0);'],
  // el ángulo de incidencia se mide con la DIFERENCIA de alturas en vez de la
  // suma: deja de ser el rayo reflejado y pasa a ser el directo
  anguloDirecto:  ['radio_pv_model.js', /var theta = Math\.atan2\(ht \+ hr, d\);/, 'var theta = Math.atan2(ht - hr, d);'],
};
/* CADA MUTACION DICE A QUE FICHERO VA. Al mudarse la banda vertical a la
   referencia, cinco mutaciones se quedaron apuntando a un codigo que ya no
   estaba en el motor: salian rc=2 -«no caso»- en vez de rojas, o sea cinco
   guardias apagados. Por eso se exige rc=1 EXACTO en la CI y no «distinto de
   cero»: con eso habrian contado como cazadas sin serlo. */
const MUTA = process.env.MUTA;
let casada = false;
function fuenteDe(rel) {
  let t = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  if (!MUTA) return t;
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  if (m[0] !== rel) return t;
  const antes = t; t = t.replace(m[1], m[2]);
  if (t === antes) { console.error('la mutacion «' + MUTA + '» no casó con ' + rel); process.exit(2); }
  casada = true;
  console.log('### MUTACION «' + MUTA + '» PUESTA en ' + rel + ': este banco TIENE que salir rojo\n');
  return t;
}
const fuente = fuenteDe('radio_pv_model.js');
const ctx = { module: { exports: {} }, globalThis: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fuente, ctx);
const R = ctx.module.exports;
/* LA BANDA VERTICAL YA NO ESTA EN EL MOTOR: vive en la referencia, con otro
   nombre, porque el motor no puede tener dos funciones que den el despeje de
   una fila. Este banco la prueba COMO REFERENCIA -es lo que se carea contra
   `cortaPanel`-, no como camino de calculo.

   SE CARGA DESDE EL FUENTE, no con `require`, por dos razones. Una: `require`
   lee del disco y las mutaciones viven en memoria, asi que las cinco que
   apuntan a la referencia no llegarian nunca y se quedarian dormidas. Y dos:
   el `require` interno de la referencia se sustituye por ESTE motor -el del
   `vm`, mutaciones incluidas-, de modo que banda y plano comparten `nu`,
   `perdidaFiloDb` y `alturaRayo` en vez de careares contra dos copias. */
const ctxRef = { module: { exports: {} }, require: () => R, Math: Math, console: console };
ctxRef.globalThis = ctxRef;
vm.createContext(ctxRef);
vm.runInContext(fuenteDe('tests/referencia_banda_vertical.js'), ctxRef);
const REF = ctxRef.module.exports;
if (MUTA && !casada) {
  console.error('la mutacion «' + MUTA + '» apunta a un fichero que este banco no carga: ' + MUTACIONES[MUTA][0]);
  process.exit(2);
}
R.banda = REF.banda; R.corta = REF.corta;
R.difraccionBandasDb = REF.difraccionBandasRefDb;
R.difraccionBandasDetalle = REF.difraccionBandasRef;
check('el motor se carga y expone la geometría',
      R && typeof R.banda === 'function' && typeof R.corta === 'function');
if (!R || !R.banda) { console.log('\nFALLOS: ' + ko); process.exit(1); }

// ── LA BANDA ─────────────────────────────────────────────────────────────────
// Eje a 2,00 m, cuerda 2,38 m (la de El Burgo), seguidor a 30°, suelo a 0.
// A mano: semi = 1,19 · sen30° = 1,19 · 0,5 = 0,595
console.log('\n· la banda, con números sacados a mano');
const b30 = R.banda(2.0, 2.38, 30, 0);
check('semi = (c/2)·sen α = 0,595 m', cerca(b30.semi, 0.595), b30.semi);
check('el borde de arriba es eje + semi = 2,595', cerca(b30.zTop, 2.595), b30.zTop);
check('el de abajo es eje − semi = 1,405', cerca(b30.zBot, 1.405), b30.zBot);
check('y queda HUECO bajo el panel: 1,405 m hasta el suelo', cerca(b30.hueco, 1.405), b30.hueco);

// el caso que el modelo antiguo no sabe representar
const bPlano = R.banda(2.0, 2.38, 0, 0);
check('un seguidor PLANO degenera en una línea a la altura del eje',
      cerca(bPlano.semi, 0) && cerca(bPlano.zTop, 2.0) && cerca(bPlano.zBot, 2.0),
      [bPlano.zBot, bPlano.zTop]);
const bVert = R.banda(2.0, 2.38, 90, 0);
check('uno a 90° ocupa la cuerda entera: 2,38 m de alto',
      cerca(bVert.zTop - bVert.zBot, 2.38), bVert.zTop - bVert.zBot);
check('y el signo del ángulo da igual: −30° ocupa lo mismo que +30°',
      cerca(R.banda(2.0, 2.38, -30, 0).semi, b30.semi));

// hueco 0 cuando la banda llega al suelo: eje 1,0 con semi 1,19 (α=90) → zBot = −0,19
const bBajo = R.banda(1.0, 2.38, 90, 0);
check('si la banda llegaría bajo tierra, el hueco es 0 y no negativo',
      bBajo.hueco === 0 && bBajo.zBot < 0, [bBajo.hueco, bBajo.zBot]);

// ── CÓMO CORTA AL RAYO ───────────────────────────────────────────────────────
console.log('\n· tapado, hueco o libre — y ésta es la diferencia con el modelo A');
check('un rayo a 3,0 m pasa POR ENCIMA (libre), con 0,405 m de despeje',
      R.corta(b30, 3.0).estado === 'libre' && cerca(R.corta(b30, 3.0).despeje, 0.405),
      JSON.stringify(R.corta(b30, 3.0)));
check('uno a 2,0 m va DENTRO de la banda: tapado',
      R.corta(b30, 2.0).estado === 'tapado', R.corta(b30, 2.0).estado);
check('y uno a 0,8 m pasa POR EL HUECO, que el modelo A daba por tapado',
      R.corta(b30, 0.8).estado === 'hueco' && cerca(R.corta(b30, 0.8).despeje, 0.605),
      JSON.stringify(R.corta(b30, 0.8)));
check('por el hueco, el borde que difracta es el INFERIOR del módulo (1,405), no el suelo',
      cerca(R.corta(b30, 0.8).borde, 1.405), R.corta(b30, 0.8).borde);
check('y se dice si ese rayo ya iba por debajo del suelo (eso lo juzga el relieve)',
      R.corta(b30, -0.5).bajoSuelo === true && R.corta(b30, 0.8).bajoSuelo === false);

// dentro de la banda, el despeje es NEGATIVO y al borde más cercano
const cTapado = R.corta(b30, 2.5);   // más cerca del techo (2,595) que del suelo (1,405)
check('dentro de la banda el despeje es negativo', cTapado.despeje < 0, cTapado.despeje);
check('y se mide al borde MÁS PRÓXIMO: 2,5 está a 0,095 del techo',
      cerca(cTapado.despeje, -0.095) && cerca(cTapado.borde, 2.595),
      JSON.stringify(cTapado));

// ── EL RAYO ──────────────────────────────────────────────────────────────────
console.log('\n· la recta entre antenas');
check('a mitad de camino entre 1,5 y 2,5 el rayo va a 2,0',
      cerca(R.alturaRayo(1.5, 2.5, 100, 50), 2.0), R.alturaRayo(1.5, 2.5, 100, 50));
check('en el origen vale la altura de salida', cerca(R.alturaRayo(1.5, 2.5, 100, 0), 1.5));

// ── RÉGIMEN ──────────────────────────────────────────────────────────────────
console.log('\n· por el pasillo o cruzando filas');
check('un enlace PARALELO a las filas va por pasillo',
      R.regimen(1, 0, 1, 0, 10).tipo === 'pasillo');
check('uno PERPENDICULAR las cruza',
      R.regimen(0, 1, 1, 0, 10).tipo === 'cruza');
check('a 5° de las filas sigue siendo pasillo (tolerancia 10°)',
      R.regimen(Math.cos(5 * R.GRADO), Math.sin(5 * R.GRADO), 1, 0, 10).tipo === 'pasillo');
check('a 15° ya cruza',
      R.regimen(Math.cos(15 * R.GRADO), Math.sin(15 * R.GRADO), 1, 0, 10).tipo === 'cruza');
check('y el sentido da igual: antiparalelo también es pasillo',
      R.regimen(-1, 0, 1, 0, 10).tipo === 'pasillo');

/* ── RELIEVE: LA TIERRA LISA ──────────────────────────────────────────────
   `relieveDominante` ya no existe. Daba el punto que mas invade el rayo y con
   eso se cobraba un filo de cuchillo, lo cual con un perfil de terreno cuenta
   DOS VECES el mismo suelo que `dosRayosDb` ya modela: 21,66 dB medidos sobre
   un perfil PLANO a 100 m. Ahora la referencia es la recta de minimos
   cuadrados -P.1812-6, Anexo 1, Adjunto 1, §5.6.1- y el relieve es lo que el
   terreno cobra POR ENCIMA de ella.

   Los numeros de abajo estan CALCULADOS A MANO, que es lo que la recta permite:
     perfil PLANO a cota c  ->  la recta ES el perfil  ->  hst = hsr = c
     rampa h = a + b·d      ->  la recta ES la rampa   ->  hst = a, hsr = a+b·D
   y en los dos casos real y referencia son la MISMA cuenta, asi que 0 exacto. */
console.log('\n· el terreno entre los nodos: la tierra lisa');
const LL = (h, D, n) => { const p = []; for (let i = 0; i <= (n || 10); i++)
  { const s = D * i / (n || 10); p.push([s, h(s)]); } return p; };
check('perfil PLANO a 0: la recta es el perfil',
      cerca(R.tierraLisa(LL(() => 0, 100)).hst, 0) && cerca(R.tierraLisa(LL(() => 0, 100)).hsr, 0));
check('perfil PLANO a 7,5: idem, hst = hsr = 7,5',
      cerca(R.tierraLisa(LL(() => 7.5, 100)).hst, 7.5) &&
      cerca(R.tierraLisa(LL(() => 7.5, 100)).hsr, 7.5));
check('rampa 2 + 0,05·d sobre 100 m: hst = 2 y hsr = 7 (a mano)',
      cerca(R.tierraLisa([[0, 2], [25, 3.25], [60, 5], [100, 7]]).hst, 2) &&
      cerca(R.tierraLisa([[0, 2], [25, 3.25], [60, 5], [100, 7]]).hsr, 7));
check('un cerro CENTRADO no inclina la recta',
      cerca(R.tierraLisa([[0, 0], [25, 0], [50, 10], [75, 0], [100, 0]]).hst,
            R.tierraLisa([[0, 0], [25, 0], [50, 10], [75, 0], [100, 0]]).hsr));
/* Y EL AJUSTE ES CONTINUO, no por puntos: pesa cada tramo por su longitud, asi
   que un muestreo irregular da la MISMA recta. Es lo que permite mezclar DEM y
   levantamiento sin que el resultado dependa de donde caiga cada muestra. */
check('el muestreo irregular da la misma recta que el fino',
      cerca(R.tierraLisa([[0, 2], [100, 7]]).hst,
            R.tierraLisa([[0, 2], [1, 2.05], [99, 6.95], [100, 7]]).hst) &&
      cerca(R.tierraLisa([[0, 2], [100, 7]]).hsr,
            R.tierraLisa([[0, 2], [1, 2.05], [99, 6.95], [100, 7]]).hsr));

/* EL REQUISITO: perfil plano o en rampa -> relieve 0 EXACTO. No «pequeño»:
   exacto, porque real y referencia son la misma cuenta. */
const FREL = 2.45e9;
for (const [q, p, zA, zB] of [
  ['plano a 0',      LL(() => 0, 100),        0.475,   0.475],
  ['plano a 739,23', LL(() => 739.23, 100),   739.705, 739.705],
  ['plano a -12,75', LL(() => -12.75, 100),  -12.275, -12.275],
  ['rampa +5 %',     LL(s => 0.05 * s, 100),  0.475,   5.475],
  ['rampa -15 %',    LL(s => -0.15 * s, 100), 0.475,  -14.525],
]) {
  check('relieve 0 EXACTO con ' + q, R.relieveDeltaDb(100, zA, zB, p, FREL).db === 0,
        R.relieveDeltaDb(100, zA, zB, p, FREL).db);
}
/* Y UN CERRO SI COBRA, y mas cuanto mas alto. Sin esto el banco pasaria con
   una funcion que devolviera 0 siempre. */
const cerro = H => LL(s => H * Math.exp(-Math.pow((s - 50) / (100 / 6), 2)), 100, 20);
const dbs = [0.1, 0.5, 2, 5, 10].map(H => R.relieveDeltaDb(100, 0.475, 0.475, cerro(H), FREL).db);
check('un cerro cobra, y monotono con su altura',
      dbs[0] > 0 && dbs.every((v, i) => i === 0 || v > dbs[i - 1]), dbs.map(v => v.toFixed(2)).join(' '));

/* BULLINGTON Y NO DEYGOUT PARA EL TERRENO, y esto es lo que lo decide: el
   resultado NO PUEDE depender de lo fino que se muestree el terreno. Con
   Deygout daba 1,10 dB con 2 puntos y 22,74 con 80 -medido-; el mismo terreno
   dando veinte veces mas segun como se mire no es una propiedad del terreno. */
const ond = n => LL(s => 0.10 * Math.sin(Math.PI * s / 24), 24, n);
const muestreos = [2, 4, 10, 20, 40, 80].map(n => R.relieveDeltaDb(24, 0.475, 0.475, ond(n), FREL).db);
check('el relieve NO depende de la densidad de muestreo',
      muestreos.every(v => Math.abs(v - muestreos[0]) < 1e-9),
      muestreos.map(v => v.toFixed(4)).join(' '));

/* EL PERFIL SE RECORTA AL VANO. Un DEM se muestrea con margen, y si la recta
   se ajusta sobre el perfil entero en vez de sobre el tramo del enlace, la
   altura de antena efectiva sale mal: medido, 1,33 m en vez de 0,475. */
check('un perfil MAS LARGO que el vano se recorta y da lo mismo que el justo',
      cerca(R.relieveDeltaDb(100, 3.475, 3.475, [[-10, 3], [200, 3]], FREL).htE, 0.475));
check('y uno MAS CORTO que el vano no se inventa nada: null',
      R.relieveDeltaDb(100, 0.475, 0.475, [[0, 0], [50, 0]], FREL) === null);

// ── EL PERFIL QUE «NO CUBRE EL VANO» POR UN PICOMETRO ────────────────────────
// `recortaPerfil` comparaba `< D` a secas. `perfilEntre` construye el perfil
// sumando `nSeg` pasos de `D/nSeg`, y esa suma no da D exacto: el perfil sale
// corto en el ultimo bit. Resultado, en la cartera de verdad: 568 de 6.036
// enlaces (9,4 %) decian «el perfil no cubre el vano» y se quedaban SIN
// relieve, con el terreno delante. Peor deficit de toda la cartera: 2,13e-13 m.
console.log('\n· el perfil corto por coma flotante, y que la tolerancia no afloja');
{
  check('corto por 1e-13 m: se acepta', R.recortaPerfil([[0, 0], [50, 1], [100 - 1e-13, 2]], 100) !== null);
  check('corto por 1 m: se rechaza', R.recortaPerfil([[0, 0], [50, 1], [99, 2]], 100) === null);
  check('corto por 1 mm: se rechaza', R.recortaPerfil([[0, 0], [50, 1], [99.999, 2]], 100) === null);
  check('corto por 1 um: se rechaza', R.recortaPerfil([[0, 0], [50, 1], [99.999999, 2]], 100) === null);
  check('la tolerancia es RELATIVA: 5e-8 sobre 100 m pasa',
        R.recortaPerfil([[0, 0], [50, 1], [100 - 5e-8, 2]], 100) !== null);
  check('y 2e-7 sobre 100 m ya no', R.recortaPerfil([[0, 0], [50, 1], [100 - 2e-7, 2]], 100) === null);
  // Y el punto final NO se extrapola: `altura()` devuelve la cota del ultimo.
  const r = R.recortaPerfil([[0, 10], [50, 20], [100 - 1e-13, 30]], 100);
  check('el punto final lleva la cota del ultimo punto, sin extrapolar',
        cerca(r[r.length - 1][1], 30, 1e-9), r[r.length - 1]);

  /* Y NO DEVUELVE DOS PUNTOS PEGADOS. Esto se mira sobre la FORMA de lo
     devuelto, no sobre los dB: aceptar el perfil corto obliga a no volver a
     meter ese mismo punto como interior, y si se metiera, `nu()` dividiria por
     1e-13 m. El danyo medido son 1,07e-14 dB —invisible en cualquier careo de
     salidas— asi que el unico sitio donde se puede cazar es aqui. */
  check('no devuelve dos puntos pegados en el extremo',
        r.length >= 2 && (r[r.length - 1][0] - r[r.length - 2][0]) > 1e-7,
        r.map(function (q) { return q[0]; }).join(','));
  const r2 = R.recortaPerfil([[0, 0], [40, 3], [100 - 1e-13, 1]], 100);
  check('tampoco con el ultimo punto mas bajo que el canto', 
        r2 && (r2[r2.length - 1][0] - r2[r2.length - 2][0]) > 1e-7,
        r2 && r2.map(function (q) { return q[0]; }).join(','));
  check('y el interior de verdad SI se conserva', r.length === 3, r.length);
}

// ── EL PUNTO DE BULLINGTON, QUE AHORA SE PUBLICA ─────────────────────────────
// `bullingtonDetalle` existe porque `tools/a5_repecho_local.mjs` necesita SABER
// DÓNDE cayó el canto equivalente: un repecho sólo está «comido» si está lejos
// de él. Si `sB` saliera mal, A5 clasificaría al revés y su número —el 2,0 % de
// enlaces afectados— sería falso sin que nada chillara.
//
// Y `bullingtonDb` pasó a ser una envoltura de esto, así que aquí se comprueba
// además que las dos dan LO MISMO: una segunda implementación es justo lo que
// esta refactorización vino a quitar.
console.log('\n· el punto de Bullington, y que la envoltura no se separa');
{
  const FB = 2.45e9;
  // Un cerro ÚNICO y simétrico a mitad de vano: el canto equivalente tiene que
  // caer en la cima, que es el único sitio donde puede estar.
  const cerro = [];
  for (let s = 10; s < 200; s += 10) cerro.push({ s: s, z: s === 100 ? 12 : 0 });
  const d = R.bullingtonDetalle(200, 1, 1, cerro, FB);
  check('con un cerro único, el canto cae en su cima', cerca(d.sB, 100, 1e-9), d.sB);
  check('y con su cota', cerca(d.zBull, 12, 1e-9), d.zBull);
  check('obstruido, porque el cerro tapa', d.modo === 'obstruido', d.modo);
  check('bullingtonDb devuelve exactamente lo mismo',
        R.bullingtonDb(200, 1, 1, cerro, FB) === d.db);

  // DOS cerros: el canto equivalente NO es ninguno de los dos, es el corte de
  // las dos rectas de máxima pendiente. Este caso es el que distingue a
  // Bullington de «coge el más alto», y es el que se comería una mutación.
  const dos = [{ s: 50, z: 10 }, { s: 150, z: 10 }];
  const d2 = R.bullingtonDetalle(200, 1, 1, dos, FB);
  check('con dos cerros iguales el canto va ENTRE ellos, no en uno',
        d2.sB > 50 + 1e-6 && d2.sB < 150 - 1e-6, d2.sB);
  check('y por encima de los dos', d2.zBull > 10, d2.zBull);

  // Sin nada dentro del vano no se inventa un punto.
  const v = R.bullingtonDetalle(200, 1, 1, [{ s: 0, z: 50 }, { s: 200, z: 50 }], FB);
  check('ningún canto DENTRO del vano: 0 dB y sin punto',
        v.db === 0 && v.sB === null && v.modo === 'ninguno_dentro', v.modo);

  // Visión directa: el rayo pasa por encima de todo, y el canto es el de mayor
  // ν, no el primero que se encuentre.
  const bajo = [{ s: 40, z: -5 }, { s: 100, z: -1 }, { s: 160, z: -5 }];
  const dv = R.bullingtonDetalle(200, 20, 20, bajo, FB);
  check('en visión directa manda el de mayor ν', dv.modo === 'directo' && cerca(dv.sB, 100, 1e-9),
        [dv.modo, dv.sB]);
}

// ── TECNOLOGÍA: paridad con el modelo congelado ──────────────────────────────
// Las fórmulas compartidas NO se escriben de memoria: se citan de
// zigbee_pv_model.js, que está pinchado a 0,000000 dB contra factiun_core.rf.
// Esto comprueba que la transcripción es exacta. Si algún día divergen, el
// banco lo dice aquí y no en una predicción.
console.log('\n· las fórmulas citadas coinciden con el modelo congelado');
const Z = require(path.join(RAIZ, 'zigbee_pv_model.js'));
const F24 = 2.45e9, F868 = 868e6;
check('espacio libre a 100 m', cerca(R.fsplDb(100, F24), Z.fsplDb(100, F24), 1e-12),
      [R.fsplDb(100, F24), Z.fsplDb(100, F24)]);
check('longitud de onda', cerca(R.longitudOnda(F24), Z.wavelength(F24), 1e-15));
check('radio de Fresnel (50, 50)', cerca(R.radioFresnel(50, 50, F24), Z.fresnelRadius(50, 50, F24), 1e-12));
check('distancia de ruptura', cerca(R.distanciaRuptura(1.5, 1.5, F24), Z.breakpointDistance(1.5, 1.5, F24), 1e-9));
let filoIgual = true;
for (const v of [-2, -0.78, -0.5, 0, 0.5, 1, 3, 10]) {
  if (!cerca(R.perdidaFiloDb(v), Z.knifeEdgeLossDb(v), 1e-12)) filoIgual = false;
}
check('pérdida por filo, en ocho valores de ν', filoIgual);

// DOS RAYOS. El modelo congelado lo lleva con fHz, epsR, sigma y pol POR
// DEFECTO; aquí son obligatorios. Se le pasan los mismos y tiene que salir el
// mismo número, lóbulos incluidos — que es donde una aritmética compleja mal
// copiada se delata, porque ahí el campo casi se cancela.
let dosRayosIgual = true, peorDosRayos = 0;
for (const d of [1, 5, 12.5, 30, 47.3, 100, 250, 1000]) {
  for (const [ht, hr] of [[1.5, 1.5], [0.775, 3.15], [3.15, 0.775]]) {
    const a = R.dosRayosDb(d, ht, hr, F24, 15.0, 5e-3, 'v');
    const b = Z.twoRayPlDb(d, ht, hr, F24, 15.0, 5e-3, 'v');
    peorDosRayos = Math.max(peorDosRayos, Math.abs(a - b));
    if (!cerca(a, b, 1e-12)) dosRayosIgual = false;
  }
}
check('dos rayos, en 24 combinaciones de distancia y alturas', dosRayosIgual,
      'peor ' + peorDosRayos.toExponential(3));
check('y en polarización horizontal también',
      cerca(R.dosRayosDb(100, 1.5, 1.5, F24, 15, 5e-3, 'h'),
            Z.twoRayPlDb(100, 1.5, 1.5, F24, 15, 5e-3, 'h'), 1e-12));
// que el coeficiente de reflexión sea COMPLEJO de verdad, no un real disfrazado
const g = R.coefReflexion(Math.atan2(3.0, 100), 15.0, 5e-3, F24, 'v');
check('el coeficiente de reflexión tiene parte imaginaria no nula',
      Math.abs(g.im) > 1e-9, g);
// y que a rasante tienda a −1, que es el caso límite conocido
const gRas = R.coefReflexion(1e-6, 15.0, 5e-3, F24, 'v');
check('a incidencia rasante el coeficiente tiende a −1',
      cerca(gRas.re, -1, 1e-4) && Math.abs(gRas.im) < 1e-3,
      gRas.re.toFixed(6) + ' ' + gRas.im.toFixed(6));
// dos rayos SIN frecuencia también lanza
let revento3 = false;
try { R.dosRayosDb(100, 1.5, 1.5, null, 15, 5e-3, 'v'); } catch (e) { revento3 = /fHz/.test(e.message); }
check('dos rayos sin fHz LANZA (el congelado predice 2,45 GHz en silencio)', revento3);

// ── TECNOLOGÍA: la frecuencia manda, y no tiene valor por defecto ────────────
console.log('\n· la banda cambia los números, y olvidarla revienta');
// λ868/λ2450 = 2450/868 = 2,8226 → el radio de Fresnel va con sqrt: 1,6800
const rel = R.radioFresnel(50, 50, F868) / R.radioFresnel(50, 50, F24);
check('el radio de Fresnel a 868 MHz es sqrt(2450/868) = 1,680 veces el de 2,45 GHz',
      cerca(rel, Math.sqrt(2450 / 868), 1e-6), rel);
check('o sea que la MISMA geometría despeja menos en sub-GHz', rel > 1.6);
let revento = false;
try { R.fsplDb(100); } catch (e) { revento = /fHz/.test(e.message); }
check('olvidar fHz LANZA, en vez de predecir 2,4 GHz en silencio', revento);
let revento2 = false;
try { R.radioFresnel(50, 50); } catch (e) { revento2 = /fHz/.test(e.message); }
check('y lo mismo en el radio de Fresnel', revento2);

// ── DIFRACCIÓN POR BANDA frente al filo desde el suelo ──────────────────────
// Éste es el número que justifica la fase 1. Enlace de 100 m entre antenas a
// 1,5 m, con UNA fila en medio: eje a 2,0 m, cuerda 2,38, seguidor a 30°.
// El rayo va a 1,5 m constante → pasa POR EL HUECO (zBot = 1,405).
console.log('\n· lo que cambia frente al modelo antiguo, en dB');
const D = 100;
const bandaMedio = R.banda(2.0, 2.38, 30, 0);          // zBot 1,405 · zTop 2,595
const antiguoTop = [[50, bandaMedio.zTop]];            // el filo del modelo A, desde el suelo

// (a) ANTENAS A 1,0 m: el rayo pasa POR DEBAJO del panel, por el hueco.
//     Para el modelo A eso es un filo de 2,595 m delante; para éste, aire.
const aNuevo = R.difraccionBandasDb(D, 1.0, 1.0, [{ s: 50, banda: bandaMedio }], F24);
const aAntiguo = Z.diffractionLossDb(D, 1.0, 1.0, antiguoTop, F24);
check('(a) con las antenas a 1,0 m el rayo pasa por el HUECO',
      R.corta(bandaMedio, 1.0).estado === 'hueco', R.corta(bandaMedio, 1.0).estado);
check('(a) el modelo antiguo cobra pérdida ahí, porque su filo sube desde el suelo',
      aAntiguo > 0.5, aAntiguo);
check('(a) el nuevo cobra MENOS', aNuevo < aAntiguo,
      'nuevo=' + aNuevo.toFixed(2) + ' antiguo=' + aAntiguo.toFixed(2));
console.log('     (a) hueco: nuevo ' + aNuevo.toFixed(2) + ' dB · antiguo ' +
            aAntiguo.toFixed(2) + ' dB · diferencia ' + (aAntiguo - aNuevo).toFixed(2) + ' dB');

// (b) ANTENAS A 1,5 m: el rayo va DENTRO de la banda, rozando el borde de abajo
//     (a 0,095 m). El modelo A lo mide contra el borde de ARRIBA, a 1,095 m, y
//     por eso cobra de más: no es que no haya obstáculo, es que mide mal cuál.
const bNuevo = R.difraccionBandasDb(D, 1.5, 1.5, [{ s: 50, banda: bandaMedio }], F24);
const bAntiguo = Z.diffractionLossDb(D, 1.5, 1.5, antiguoTop, F24);
check('(b) a 1,5 m el rayo va DENTRO de la banda, no por el hueco',
      R.corta(bandaMedio, 1.5).estado === 'tapado', R.corta(bandaMedio, 1.5).estado);
check('(b) y el nuevo cobra menos, porque mide al borde MÁS PRÓXIMO (el de abajo)',
      bNuevo < bAntiguo, 'nuevo=' + bNuevo.toFixed(2) + ' antiguo=' + bAntiguo.toFixed(2));
console.log('     (b) dentro: nuevo ' + bNuevo.toFixed(2) + ' dB · antiguo ' +
            bAntiguo.toFixed(2) + ' dB · diferencia ' + (bAntiguo - bNuevo).toFixed(2) + ' dB');

// (c) y cuando el rayo va por el CENTRO del panel, los dos cobran de verdad
const cNuevo = R.difraccionBandasDb(D, 2.0, 2.0, [{ s: 50, banda: bandaMedio }], F24);
check('(c) con el rayo en el centro de la banda, el nuevo sí cobra pérdida', cNuevo > 0, cNuevo);

// ── DEYGOUT CON DOS FILAS: el sub-tramo arranca en el borde QUE TOCA ─────────
// Con una sola fila no hay Deygout que valga: la recursión se llama con la
// lista vacía y devuelve 0, así que la reconstrucción no se comprueba. Con dos
// sí, y ahí es donde importa de qué borde se relanza el rayo.
//
// Enlace de 200 m, antenas a 1,5 m. Fila 1 en s=60 (eje 2,6, α=90° → banda
// 1,410..3,790) y fila 2 en s=140 (eje 2,0, α=30° → banda 1,405..2,595). El
// rayo recto a 1,5 m entra en las dos por abajo, y domina la 2 (ν = 0,059263
// frente a 0,056144), cuyo borde más próximo es el INFERIOR: 1,405.
//
// EL NÚMERO SE HA SACADO APARTE, con las fórmulas tecleadas desde la cita:
//   dominante  ν = 0,059263 → 6,546264278 dB
//   sub-tramo izquierdo, de 1,5 al borde 1,405 → en s=60 el rayo va a 1,459286,
//   la fila 1 lo invade 0,049286 → ν = 0,034029 → 6,327400015 dB
//   total = 12,873664293 dB
// Relanzándolo desde el borde de ARRIBA (2,595), que es el error del modelo
// antiguo, saldrían 15,899069752 dB.
console.log('\n· con dos filas, la reconstrucción de Deygout va al borde que toca');
const dosFilas = R.difraccionBandasDb(200, 1.5, 1.5, [
  { s: 60,  banda: R.banda(2.6, 2.38, 90, 0) },
  { s: 140, banda: R.banda(2.0, 2.38, 30, 0) },
], F24);
check('dos filas dan 12,873664293 dB, calculado a mano',
      cerca(dosFilas, 12.873664293, 1e-8), dosFilas);
check('y NO los 15,899069752 de reconstruir desde el borde superior',
      !cerca(dosFilas, 15.899069752, 1e-6), dosFilas);

// ── VEGETACIÓN: declarada y no implementada ─────────────────────────────────
console.log('\n· la vegetación no se inventa');
check('sin modelo configurado devuelve null, NO 0 dB', R.vegetacionDb(10, F24, null) === null);
let vegRevento = false;
try { R.vegetacionDb(10, F24, 'itu-p833'); } catch (e) { vegRevento = true; }
check('y con un modelo pedido pero sin implementar, lanza', vegRevento);

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
                       : 'TODO OK — ' + ok + ' comprobaciones'));
if (MUTA) {
  console.log(ko ? '### bien: la mutacion «' + MUTA + '» sale roja'
                 : '### MAL: la mutacion «' + MUTA + '» pasa desapercibida');
}
process.exit(ko ? 1 : 0);
