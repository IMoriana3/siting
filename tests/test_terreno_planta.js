/* EL TERRENO DE UNA PLANTA, Y LA CADENA ENTERA HASTA EL RELIEVE.
 *
 * `terreno_planta.js` lee `<planta>_relieve.json` —el fichero que ya escribe
 * `cobertura-zigbee/tools/kml_curvas_a_cotas.mjs` y que ya consume el 3D— y
 * saca el perfil de un vano. Este banco comprueba las dos mitades:
 *
 *   1. EL MUESTREO, con los valores calculados A MANO abajo. No pidiendoselos a
 *      la propia funcion, que seria carearla consigo misma.
 *   2. LA CADENA, fichero -> perfil -> `relieveDeltaDb`. Que es donde estan los
 *      dos casos que el encargo pide que salgan bien.
 *
 * ═══ POR QUE NO SE CAREA AQUI CONTRA EL 3D ═══
 *
 * Porque `relAt` vive en `cobertura-zigbee/terreno.html` y un banco que
 * dependa del repo hermano sale VERDE en la maquina de quien lo escribio y
 * ROJO en la CI. Ya paso una vez en este repo. Ese careo es
 * `tools/careo_terreno_3d.mjs`, que si lo hace —extrayendo `relAt` del HTML,
 * no reimplementandolo— y que sobre `dicayagua_relieve.json` real dio 200.000
 * muestras y 0 discrepancias, cero exacto bit a bit. Aqui van los valores a
 * mano, que es lo que prueba que la transcripcion es correcta POR SI SOLA.
 *
 * ═══ LOS DOS CASOS DEL ENCARGO ═══
 *
 *   «con perfil plano `relieveDb` = 0 exacto, y tu tabla de 1,6-4,4 dB de mas
 *    pasa a banco como caso que tiene que dar 0»
 *
 * Aqui esta, y desde el FICHERO, no desde un perfil escrito a mano: malla llana
 * a 739,23 m —que es cota de planta de verdad, y es donde la version sin
 * centrar dejaba 1,44e-12— y el relieve tiene que salir CERO EXACTO. Con dos
 * pasos de muestreo distintos, porque si solo saliera a uno seria casualidad.
 *
 *   «dos rayos con alturas de antena medidas sobre esa recta»
 *
 * De ahi sale la comprobacion mas util de todo este fichero: que pasarle al
 * motor un perfil ABSOLUTO con alturas RELATIVAS ya no cuela. Ver `DATO
 * MEZCLADO` abajo.
 *
 * USO:  node tests/test_terreno_planta.js
 *       MUTA=<clave> node tests/test_terreno_planta.js      (TIENE que salir rojo)
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');

/* ── MUTACIONES ─────────────────────────────────────────────────────────── */
const MUTACIONES = {
  // el recorte de la malla se afloja: fuera de rango deja de dar null
  sinBordeMalla:  ['terreno_planta.js', /if \(i0 < 0 \|\| j0 < 0 \|\| i0 \+ 1 >= T\.nx \|\| j0 \+ 1 >= T\.nn\) return null;/,
                                        'if (i0 < 0 || j0 < 0 || i0 >= T.nx || j0 >= T.nn) return null;'],
  // el hueco deja de ser hueco: se rellena con lo que haya
  huecoRelleno:   ['terreno_planta.js', /if \(a == null \|\| b == null \|\| c == null \|\| d == null\) return null;/,
                                        'a = a || 0; b = b || 0; c = c || 0; d = d || 0;'],
  // la bilineal degenera a la esquina de abajo a la izquierda
  bilinealPlana:  ['terreno_planta.js', /return \(a \* \(1 - tx\) \+ b \* tx\) \* \(1 - tn\) \+ \(c \* \(1 - tx\) \+ d \* tx\) \* tn;/,
                                        'return a;'],
  // el perfil pierde el punto final: `recortaPerfil` ya no llega al vano
  sinExtremo:     ['terreno_planta.js', /for \(k = 0; k <= nSeg; k\+\+\) \{/, 'for (k = 0; k < nSeg; k++) {'],
  // el paso deja de salir del fichero y se fija: la resolucion declarada miente
  pasoFijo:       ['terreno_planta.js', /var nSeg = Math\.max\(1, Math\.ceil\(D \/ paso\)\);/,
                                        'var nSeg = Math.max(1, Math.ceil(D / 25));'],
  // se pierde la precedencia fuera > hueco: el motivo pasa a depender de la direccion
  motivoAlReves:  ['terreno_planta.js', /return \{ perfil: null, motivo: huecoFuera \? MOTIVOS\.FUERA : MOTIVOS\.HUECO \};/,
                                        'return { perfil: null, motivo: hueco ? MOTIVOS.HUECO : MOTIVOS.FUERA };'],
  // `zSuelo` deja de ser el suelo: quien llame pondra la antena en el dato equivocado
  sueloCero:      ['terreno_planta.js', /zSuelo: \[perfil\[0\]\[1\], perfil\[perfil\.length - 1\]\[1\]\],/, 'zSuelo: [0, 0],'],
  // la validacion se afloja: una malla con z de otro tamanyo se acepta
  validaFloja:    ['terreno_planta.js', /if \(!Array\.isArray\(obj\.z\) \|\| obj\.z\.length !== obj\.nx \* obj\.nn\) return null;/,
                                        'if (!Array.isArray(obj.z)) return null;'],
  // la cobertura cuenta los huecos como cubiertos
  coberturaCiega: ['terreno_planta.js', /if \(z !== null\) con\+\+;/, 'con++; if (z !== null) {}'],
  // LA GUARDA DEL MOTOR: la antena bajo su tierra lisa vuelve a pasar callando
  antenaEnterrada:['radio_pv_model.js', /if \(!\(htE > 0\) \|\| !\(hrE > 0\)\) \{/, 'if (false) {'],
};
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

/* Los dos ficheros van por `vm` y NO por `require`, para que la mutacion entre.
   Con `require` se leeria el fichero del disco sin tocar. */
const ctx = { module: { exports: {} }, console: console };
ctx.window = undefined; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fuenteDe('terreno_planta.js'), ctx);
const T = ctx.module.exports;
const ctxM = { module: { exports: {} }, console: console };
ctxM.globalThis = ctxM;
vm.createContext(ctxM);
vm.runInContext(fuenteDe('radio_pv_model.js'), ctxM);
const R = ctxM.module.exports;
if (MUTA && !casada) { console.error('la mutacion «' + MUTA + '» no llegó a ponerse'); process.exit(2); }

let ok = 0, ko = 0;
function check(q, cond, detalle) {
  if (cond) { ok++; console.log('OK   ' + q); }
  else { ko++; console.log('FAIL ' + q + (detalle != null ? ' -> ' + detalle : '')); }
}
const F = 2.45e9, ANT = 0.475;           // antena de la TCU con el eje a 1,20 m
function malla(nx, nn, paso, f) {
  const z = [];
  for (let j = 0; j < nn; j++) for (let i = 0; i < nx; i++) z.push(f(i * paso, j * paso));
  return T.cargaRelieve({ planta: 'banco', x0: 0, n0: 0, paso: paso, nx: nx, nn: nn, z: z });
}

/* ══ 1 · LA FORMA DEL FICHERO, Y QUE SE RECHACE LA QUE NO LO ES ═══════════
   Estricto a proposito: una malla con `z.length` distinto de `nx*nn` se
   muestrea sin quejarse y devuelve cotas de OTRA FILA. Es el fallo silencioso
   mas caro que hay aqui, porque el mapa sale entero y equivocado. */
console.log('\n── 1 · validación del fichero ──');
const base9 = new Array(9).fill(0);
check('una malla bien formada se acepta',
      T.cargaRelieve({ x0: 0, n0: 0, paso: 10, nx: 3, nn: 3, z: base9 }) !== null);
check('z de tamaño distinto de nx*nn se RECHAZA',
      T.cargaRelieve({ x0: 0, n0: 0, paso: 10, nx: 3, nn: 3, z: [0, 0, 0] }) === null);
check('paso 0 se RECHAZA',
      T.cargaRelieve({ x0: 0, n0: 0, paso: 0, nx: 3, nn: 3, z: base9 }) === null);
check('nx = 1 se RECHAZA (no hay con qué interpolar)',
      T.cargaRelieve({ x0: 0, n0: 0, paso: 10, nx: 1, nn: 9, z: base9 }) === null);
check('x0 no numérico se RECHAZA',
      T.cargaRelieve({ x0: 'a', n0: 0, paso: 10, nx: 3, nn: 3, z: base9 }) === null);
check('sin objeto se RECHAZA', T.cargaRelieve(null) === null);

/* ══ 2 · EL MUESTREO, A MANO ══════════════════════════════════════════════
   Malla 3x3 a 10 m, z indexado [j*nx + i], con i sobre x y j sobre n:

       n=20 |   0    10    20
       n=10 |   0     5    10
       n=0  |   0     0     0
            +------------------
                x=0   10    20

   cotaEn(5,5):   i0=0 j0=0 tx=0,5 tn=0,5 · esquinas a=0 b=0 c=0 d=5
                  (0·0,5 + 0·0,5)·0,5 + (0·0,5 + 5·0,5)·0,5 = 0 + 1,25 = 1,25
   cotaEn(15,15): i0=1 j0=1 tx=0,5 tn=0,5 · esquinas a=5 b=10 c=10 d=20
                  (5·0,5 + 10·0,5)·0,5 + (10·0,5 + 20·0,5)·0,5 = 3,75 + 7,5 = 11,25
   cotaEn(19.999,19.999): tx=tn=0,9999 · 9,9995·0,0001 + 19,999·0,9999 = 19,99800005 */
console.log('\n── 2 · muestreo bilineal, valores a mano ──');
const g = T.cargaRelieve({ x0: 0, n0: 0, paso: 10, nx: 3, nn: 3, z: [0, 0, 0, 0, 5, 10, 0, 10, 20] });
check('cotaEn(0,0) = 0 (nodo)', T.cotaEn(g, 0, 0) === 0, T.cotaEn(g, 0, 0));
check('cotaEn(10,10) = 5 (nodo, sin interpolar)', T.cotaEn(g, 10, 10) === 5, T.cotaEn(g, 10, 10));
check('cotaEn(5,0) = 0 (borde bajo, llano)', T.cotaEn(g, 5, 0) === 0, T.cotaEn(g, 5, 0));
check('cotaEn(5,5) = 1,25', T.cotaEn(g, 5, 5) === 1.25, T.cotaEn(g, 5, 5));
check('cotaEn(15,15) = 11,25', T.cotaEn(g, 15, 15) === 11.25, T.cotaEn(g, 15, 15));
check('cotaEn(19.999,19.999) ≈ 19,998000', Math.abs(T.cotaEn(g, 19.999, 19.999) - 19.99800005) < 1e-8,
      T.cotaEn(g, 19.999, 19.999));

/* La ULTIMA fila y la ULTIMA columna no se muestrean: no tienen vecino con el
   que interpolar. Es la frontera del 3D, literal.
   ───────────────────────────────────────────────────────────────────────────
   Y EL BORDE DERECHO NO ES REDUNDANTE CON EL CONTROL DE NULOS, aunque lo
   parezca. Se descubrio porque la mutacion `sinBordeMalla` salia DORMIDA con
   los dos primeros casos de abajo: al pasarse por arriba, `z[...]` sale
   `undefined`, y en JS `undefined == null` es cierto, asi que el control de
   esquinas la tapaba y la puerta se creia buena.

   Pero en la ULTIMA COLUMNA el indice no se sale del array: `j0*nx + (nx-1) +
   1` es `(j0+1)*nx`, o sea LA PRIMERA COLUMNA DE LA FILA SIGUIENTE. In rango y
   equivocado. Medido con esta misma malla: sin el borde, `cotaEn(25,5)`
   devuelve **2,5 m** —sacado del otro extremo de la planta— en vez de null.
   Un numero con pinta de cota es mucho peor que un `undefined`, y es el caso
   que hay que probar. */
check('x en el último nodo (20) -> null', T.cotaEn(g, 20, 10) === null, T.cotaEn(g, 20, 10));
check('n en el último nodo (20) -> null', T.cotaEn(g, 10, 20) === null, T.cotaEn(g, 10, 20));
check('borde derecho, celda que SÍ existiría al dar la vuelta -> null',
      T.cotaEn(g, 20, 0) === null, T.cotaEn(g, 20, 0));
check('pasado el borde derecho, con las cuatro esquinas en rango -> null',
      T.cotaEn(g, 25, 5) === null, T.cotaEn(g, 25, 5));
check('x negativa -> null', T.cotaEn(g, -0.001, 5) === null);
check('muy fuera -> null', T.cotaEn(g, 900, 900) === null);
check('dentroDeLaMalla concuerda con cotaEn en el borde',
      T.dentroDeLaMalla(g, 19.999, 19.999) === true && T.dentroDeLaMalla(g, 20, 10) === false);

/* El hueco. El fichero declara «null = sin dato, usar DEM», y este repo no
   tiene DEM: donde el fichero dice «no sé», aquí se dice «no sé». */
console.log('\n── 3 · el hueco no se rellena ──');
const h = T.cargaRelieve({ x0: 0, n0: 0, paso: 10, nx: 4, nn: 4,
  z: [0, 0, 0, 0, 0, null, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
check('una esquina a null -> la celda entera es null', T.cotaEn(h, 15, 15) === null, T.cotaEn(h, 15, 15));
check('la celda de al lado sí da número', T.cotaEn(h, 25, 25) === 0, T.cotaEn(h, 25, 25));
check('el hueco cae DENTRO de la malla (no es «fuera»)', T.dentroDeLaMalla(h, 15, 15) === true);

/* ══ 4 · LOS MOTIVOS, UNO POR CAUSA ══════════════════════════════════════
   Cada uno se arregla con una cosa distinta, asi que juntarlos en «no se pudo»
   es perder la unica informacion util que hay aqui. */
console.log('\n── 4 · un motivo por causa ──');
const lim = T.cargaRelieve({ x0: 0, n0: 0, paso: 10, nx: 4, nn: 4, z: new Array(16).fill(0) });
check('sin fichero -> relieve_sin_terreno_validado',
      T.perfilEntre(null, 5, 5, 25, 25, {}).motivo === T.MOTIVOS.SIN_FICHERO);
check('vano de longitud cero -> su propio motivo',
      T.perfilEntre(lim, 5, 5, 5, 5, {}).motivo === T.MOTIVOS.VANO_NULO);
check('se sale de la malla -> relieve_vano_fuera_de_la_malla',
      T.perfilEntre(lim, 5, 5, 95, 95, {}).motivo === T.MOTIVOS.FUERA,
      T.perfilEntre(lim, 5, 5, 95, 95, {}).motivo);
check('pisa un hueco dentro -> relieve_hueco_en_el_vano',
      T.perfilEntre(h, 5, 5, 25, 25, {}).motivo === T.MOTIVOS.HUECO,
      T.perfilEntre(h, 5, 5, 25, 25, {}).motivo);
/* PRECEDENCIA. Si se sale Y ademas pisa un hueco, los dos son ciertos. Manda
   «fuera», y esto lo fija por escrito: sin fijarlo, el motivo cambiaria segun
   la direccion del enlace, que es el tipo de cosa que enloquece a quien
   diagnostica. */
check('se sale Y pisa hueco -> manda «fuera»',
      T.perfilEntre(h, 5, 5, 95, 95, {}).motivo === T.MOTIVOS.FUERA,
      T.perfilEntre(h, 5, 5, 95, 95, {}).motivo);
check('el vano bueno no trae motivo', T.perfilEntre(lim, 5, 5, 25, 25, {}).motivo === null);

/* ══ 5 · LA FORMA DEL PERFIL ═════════════════════════════════════════════ */
console.log('\n── 5 · forma del perfil ──');
const M0 = malla(9, 9, 10, () => 100);
const p0 = T.perfilEntre(M0, 5, 5, 25, 25, {});
const D0 = Math.hypot(20, 20);
check('empieza en s = 0', p0.perfil[0][0] === 0, p0.perfil[0][0]);
check('acaba EXACTAMENTE en s = D', Math.abs(p0.perfil[p0.perfil.length - 1][0] - D0) < 1e-12,
      p0.perfil[p0.perfil.length - 1][0] + ' vs ' + D0);
check('D coincide con la distancia euclídea', Math.abs(p0.D - D0) < 1e-12);
check('s es monótona creciente', p0.perfil.every((q, i) => i === 0 || q[0] > p0.perfil[i - 1][0]));
check('el paso declarado es ≤ el del fichero', p0.paso <= M0.paso + 1e-12, p0.paso);
check('zSuelo son las cotas de los DOS extremos',
      p0.zSuelo[0] === p0.perfil[0][1] && p0.zSuelo[1] === p0.perfil[p0.perfil.length - 1][1]);
/* Y que el perfil SIRVA: `recortaPerfil` del motor tiene que aceptarlo. Sin el
   punto final se queda corto y el relieve entero se pierde en silencio. */
check('el motor acepta el perfil (recortaPerfil no devuelve null)',
      R.recortaPerfil(p0.perfil, p0.D) !== null);

/* ══ 6 · EL CASO DEL ENCARGO: LLANO -> CERO EXACTO ═══════════════════════
   A 739,23 m, que es cota de planta de verdad y es justo donde la version que
   ajustaba sin centrar dejaba 1,44e-12 dB. «Exacto» aqui quiere decir === 0,
   no «pequenyo». */
console.log('\n── 6 · terreno llano -> relieve 0 EXACTO ──');
const BASE = 739.23;
const LL = malla(9, 9, 10, () => BASE);
for (const paso of [10, 5, 1]) {
  const p = T.perfilEntre(LL, 5, 5, 25, 25, { paso: paso });
  const r = R.relieveDeltaDb(p.D, p.zSuelo[0] + ANT, p.zSuelo[1] + ANT, p.perfil, F);
  check('llano a 739,23 m con paso ' + paso + ' m (n=' + p.n + ') -> relieve === 0',
        r.db === 0 && r.bruto === 0, 'db=' + r.db + ' bruto=' + r.bruto);
  check('llano a 739,23 m con paso ' + paso + ' m -> htE = altura de antena exacta',
        Math.abs(r.htE - ANT) < 1e-10 && Math.abs(r.hrE - ANT) < 1e-10,
        'htE=' + r.htE + ' hrE=' + r.hrE);
}

/* ══ 7 · EL PLANO INCLINADO TAMBIEN ES TIERRA LISA ═══════════════════════
   Una rampa uniforme ES su propia recta de minimos cuadrados, en cualquier
   direccion. No sale 0 EXACTO como el llano —el ajuste ya no es trivial— pero
   tiene que quedarse en el ruido de la coma flotante. MEDIDO: el peor de las
   nueve combinaciones da 1,3e-12 dB, asi que 1e-9 es tres ordenes de holgura y
   sigue siendo mil veces menor que cualquier dB que importe. */
console.log('\n── 7 · plano inclinado -> relieve ≈ 0 en cualquier dirección ──');
let peorPlano = 0;
for (const [bx, bn] of [[0.1, 0], [0, 0.1], [0.07, 0.07]]) {
  const M = malla(9, 9, 10, (x, n) => BASE + bx * x + bn * n);
  for (const [xa, na, xb, nb] of [[5, 5, 25, 25], [5, 25, 45, 5], [10, 10, 10, 60]]) {
    const p = T.perfilEntre(M, xa, na, xb, nb, {});
    const r = R.relieveDeltaDb(p.D, p.zSuelo[0] + ANT, p.zSuelo[1] + ANT, p.perfil, F);
    if (Math.abs(r.bruto) > peorPlano) peorPlano = Math.abs(r.bruto);
    check('pendiente (' + bx + ',' + bn + ') vano ' + xa + ',' + na + '→' + xb + ',' + nb + ' -> |relieve| < 1e-9',
          Math.abs(r.bruto) < 1e-9, r.bruto);
  }
}
console.log('     (peor de los nueve: ' + peorPlano.toExponential(3) + ' dB)');

/* ══ 8 · UN CERRO SI COBRA, Y CRECE CON EL ═══════════════════════════════ */
console.log('\n── 8 · un cerro sí cobra ──');
let ant = -1, monotona = true;
const alturas = [0, 1, 2, 3, 5];
const cobrado = [];
for (const alt of alturas) {
  const M = malla(21, 21, 10, (x, n) => BASE + alt * Math.exp(-(((x - 100) ** 2 + (n - 100) ** 2) / (2 * 40 * 40))));
  const p = T.perfilEntre(M, 20, 100, 180, 100, {});
  const r = R.relieveDeltaDb(p.D, p.zSuelo[0] + ANT, p.zSuelo[1] + ANT, p.perfil, F);
  cobrado.push(r.db);
  if (!(r.db > ant)) monotona = (alt === 0);
  ant = r.db;
}
check('sin cerro (altura 0) el relieve es 0 exacto', cobrado[0] === 0, cobrado[0]);
check('el relieve crece con la altura del cerro', monotona, cobrado.map(v => v.toFixed(4)).join(' < '));
check('un cerro de 3 m a media distancia cobra 13,33 dB',
      Math.abs(cobrado[3] - 13.3297) < 0.001, cobrado[3]);

/* ══ 9 · DATO MEZCLADO: LA AVERIA QUE SE DISFRAZA DEL CASO BUENO ═════════
   Pasarle al motor el perfil ABSOLUTO con la antena RELATIVA (0,475 a secas, no
   suelo + 0,475) no revienta, no sale negativo y no sale enorme: sale CASI
   CERO, indistinguible de «llano», con la antena 739 m bajo tierra. Las dos
   Bullington salen gigantes y casi iguales y la resta se las come.

   MEDIDO, mismo cerro de 3 m de arriba:
       dato correcto   13,3297 dB   htE = +0,4750
       dato mezclado    0,0029 dB   htE = -739,161

   Por eso la guarda esta DENTRO del motor y no en un comentario. */
console.log('\n── 9 · dato mezclado: la guarda del motor ──');
const MC = malla(21, 21, 10, (x, n) => BASE + 3 * Math.exp(-(((x - 100) ** 2 + (n - 100) ** 2) / (2 * 40 * 40))));
const pc = T.perfilEntre(MC, 20, 100, 180, 100, {});
const mal = R.relieveDeltaDb(pc.D, ANT, ANT, pc.perfil, F);
check('con la antena bajo la tierra lisa, db es null (no un número)',
      mal !== null && mal.db === null, mal && mal.db);
check('y trae el motivo que lo explica',
      mal && mal.motivo === 'antena_bajo_la_tierra_lisa', mal && mal.motivo);
check('y htE sale muy negativo, que es la prueba de la mezcla',
      mal && mal.htE < -700, mal && mal.htE);
/* Y el caso bueno NO se toca: la guarda no puede cobrarse enlaces sanos. */
const bien = R.relieveDeltaDb(pc.D, pc.zSuelo[0] + ANT, pc.zSuelo[1] + ANT, pc.perfil, F);
check('el mismo vano con el dato bueno sí da número', bien.db !== null && bien.db > 13);
check('y su motivo es null', bien.motivo === null);
/* Un enlace a ras de suelo (antena 1 mm) sigue pasando: la guarda mira el
   SIGNO, no un umbral inventado. */
const rasante = R.relieveDeltaDb(pc.D, pc.zSuelo[0] + 0.001, pc.zSuelo[1] + 0.001, pc.perfil, F);
check('una antena a 1 mm del suelo sigue siendo válida (la guarda mira el signo)',
      rasante.db !== null, rasante.db);

/* ══ 10 · COBERTURA ═════════════════════════════════════════════════════ */
console.log('\n── 10 · cobertura de un fichero sobre unos puntos ──');
const cob = T.cobertura(h, [{ x: 5, n: 5 }, { x: 15, n: 15 }, { x: 25, n: 25 }, { x: 95, n: 95 }]);
check('cuenta 1 con dato, 2 en hueco y 1 fuera',
      cob.con === 1 && cob.huecos === 2 && cob.fuera === 1, JSON.stringify(cob));
check('la fracción es la de los que tienen dato', cob.frac === 0.25, cob.frac);
check('sin puntos, frac es null (no 0 ni 1)', T.cobertura(h, []).frac === null);

console.log('');
if (MUTA) console.log(ko ? '### bien: la mutacion «' + MUTA + '» sale roja'
                         : '### MAL: la mutacion «' + MUTA + '» pasa desapercibida');
console.log(ko ? 'FALLAN ' + ko + ' de ' + (ok + ko) : 'TODO OK — ' + ok + ' comprobaciones');
process.exit(ko ? 1 : 0);
