// UN SOLO CAMINO DE CÁLCULO: el panel de perfil y el mapa de calor.
//
// ═══ EL BANCO OBLIGATORIO DE LA FASE 4 ═══
//
// El mapa pinta un margen por celda. El panel de perfil enseña el desglose de
// UN enlace. Si esos dos números salen de caminos distintos, un día se separan
// —y nadie lo ve, porque un mapa de calor no tiene un valor «correcto» que
// mirar a ojo—. Aquí se exige que sean EL MISMO NÚMERO, bit a bit, en las
// cuatro plantas.
//
// Este repo ya se ha comido esa avería dos veces: la copia vieja del mapa de
// calor traía su propia `covObstacles` con las filas como rectas infinitas
// (RF-01, 27 dB de error), y mi primer careo de El Burgo suponía las filas con
// paso de 12 m en vez de sacarlas del layout. En los dos casos el defecto era
// el mismo: un segundo camino para algo que ya estaba calculado.
//
// LO QUE SE COMPRUEBA, ADEMÁS DE LA IGUALDAD:
//   · que el panel NO tiene física propia: el desglose sale de los módulos;
//   · que el detalle de Deygout es la MISMA llamada que el total, no otra;
//   · que sin parámetros cargados NO se inventa un número: devuelve `null` con
//     su motivo;
//   · que el selector de motor conserva el antiguo (A) y que la firma del
//     raster lo incluye, o cambiar de motor dejaría el mapa anterior en
//     pantalla.
//
//   node tests/test_rf_panel.js
//   MUTA=<clave> node tests/test_rf_panel.js        (TIENE que salir rojo)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};

const MUTACIONES = {
  // el mapa se calcula por su cuenta: el fallo que este banco existe para
  // impedir. Basta con que uno de los dos aplique el offset y el otro no.
  mapaAparte:    ['html', /function rfMarginNuevo\(n,m,rows\)\{ return rfEnlace\(n,m,rows\)\.margenDb; \}/,
                  'function rfMarginNuevo(n,m,rows){ return rfEnlace(n,m,rows).margenDb+0.5; }'],
  // El panel pide el detalle con OTRA altura de antena: el desglose deja de
  // corresponder al margen que se ensena al lado. (Aqui puse primero 1.5 y la
  // mutacion salia INERTE, porque `ant_h_m` del JSON vale justo 1,5: escribia
  // el mismo numero. Se usa 0,775 —la altura del ajuste de El Burgo— que si es
  // distinta. Una mutacion que coincide con el valor real no prueba nada.)
  // (ancla movida al cablear el plano inclinado: las cotas de los dos extremos
  //  ya no son la misma `hA` fija, son zA y zB, cada una del alfa de SU seguidor)
  detalleOtraH:  ['html', /pr\.detalle=RadioPV\.difraccionPanelesDetalle\(D,zA,zB,cruces,V\.f_hz\);/,
                  'pr.detalle=RadioPV.difraccionPanelesDetalle(D,0.775,0.775,cruces,V.f_hz);'],
  // el motor sale de la firma del raster: cambiar de motor dejaria el mapa
  // anterior en pantalla sin repintar
  firmaSinMotor: ['html', /\+"\|"\+rfMotor\(\)\+"\|"\+\(S\.rf&&S\.rf\.variante\|\|""\)\+"\|"\+\(S\._radioParams\?"p":"-"\);/,
                  ';'],
  // sin parametros cargados, se inventa un margen en vez de decir que faltan
  sinParamsMiente:['html', /if\(!P\|\|!V\) return \{margenDb:null, motivos:\["parametros_no_cargados"\], cruces:\[\], D:0\};/,
                  'if(!P||!V) return {margenDb:0, motivos:[], cruces:[], D:0};'],
  // el detalle de Deygout se calcula con OTRO tope de recursion: deja de ser
  // la misma llamada que el total
  detalleOtroTope:['html', /pr\.detalle=RadioPV\.difraccionPanelesDetalle\(D,zA,zB,cruces,V\.f_hz\);/,
                  'pr.detalle=RadioPV.difraccionPanelesDetalle(D,zA,zB,cruces,V.f_hz,0,1);'],
  // El orden por t se pierde en el camino del panel. MEDIDO: el NUMERO de
  // Deygout no depende del orden -0 diferencias en 3.000 enlaces comparando la
  // lista ordenada contra invertida y barajada, porque el algoritmo elige el
  // maximo de nu POR VALOR y parte por `s < mejorS` POR VALOR-. De quien
  // depende es del PANEL, que dibuja los cruces de izquierda a derecha, y del
  // contrato de `rfObstacles`, que promete orden por posicion.
  sinOrdenT:     ['html', /obs\.sort\(conDuenyo\?\(\(p,q\)=>p\.s-q\.s\):\(\(p,q\)=>p\[0\]-q\[0\]\)\);/,
                  'if(!conDuenyo)obs.sort((p,q)=>p[0]-q[0]);'],
};
const MUTA = process.env.MUTA;
let html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  const antes = html;
  html = html.replace(m[1], m[2]);
  if (html === antes) { console.error('la mutacion «' + MUTA + '» no casó con el código'); process.exit(2); }
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}

// ── GUARDIAS DE ORIGEN, EN EL TEXTO ─────────────────────────────────────────
// Antes de ejecutar nada: que no haya aparecido una segunda física.
console.log('· nada de calculo propio en la pagina');
const bloque = html.match(/const RF_PITCH_M[\s\S]*?\n}\n(?=\/\* PUNTO DE LA TCU)/);
check('el bloque RF se localiza', !!bloque);
if (!bloque) { console.log('\nFALLOS: ' + ko); process.exit(1); }
check('la pagina carga los tres modulos del motor nuevo',
      /<script src="radio_pv_model\.js">/.test(html) && /<script src="radio_zigbee\.js">/.test(html) &&
      /<script src="radio_malla\.js">/.test(html));
check('el modelo ANTIGUO (A) sigue cargado, para poder comparar',
      /<script src="zigbee_pv_model\.js">/.test(html));
check('el bloque RF no define su propia difraccion ni su propio dos rayos',
      !/function\s+(rfDifrac|rfDosRayos|rfFresnel|rfKnife)/.test(bloque[0]));
check('el presupuesto sale de RadioZigbee, no de una copia local',
      /RadioZigbee\.presupuesto\(/.test(bloque[0]) && !/function\s+rfPresupuesto/.test(bloque[0]));
/* MISMA INTENCION, CONTRATO NUEVO: el detalle sale del motor y no de un segundo
   recorrido de la pagina. Lo que cambia es CUAL, porque el Deygout de bandas
   -que partia en el eje- ya no esta en el camino de calculo: parte en el CANTO. */
check('el detalle de Deygout sale del motor, no de un segundo recorrido',
      /RadioPV\.difraccionPanelesDetalle\(/.test(bloque[0]) &&
      !/function\s+rfDeygout/.test(bloque[0]));
check('y NO queda rastro del Deygout de bandas en la pagina',
      !/difraccionBandas/.test(bloque[0]));
check('los parametros se CARGAN del JSON, no van incrustados en la pagina',
      /fetch\("radio_params\.json"/.test(html) && !/rx_sens_dbm\s*:/.test(bloque[0]));

// ── MONTAJE ─────────────────────────────────────────────────────────────────
const PARAMS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
function planta(nombre, motor) {
  const m = html.match(new RegExp('^const ' + nombre + '=(\\{[\\s\\S]*?\\});$', 'm'));
  if (!m) return null;
  const P = JSON.parse(m[1]);
  if (!P.tcus || !P.tcus.length) return null;
  const motors = P.tcus.map((t, i) => ({ id: 'T' + i, x: t[0], y: t[1],
    len: t[6], wid: t[7], az: t[8] }));
  const ctx = { Math, console, module: { exports: {} }, JSON };
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['zigbee_pv_model.js', 'radio_pv_model.js', 'radio_zigbee.js', 'radio_malla.js']) {
    ctx.module = { exports: {} };
    vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx);
  }
  ctx.S = { bifila: P.bifila || null, motors, p: { tlen: 100, twid: 12 },
            rf: { motor: motor || 'nuevo', variante: 'zigbee_pro_24' },
            _radioParams: PARAMS, cov: {} };
  /* el mando del ángulo no existe fuera del navegador: se fija aquí, que es lo
     que hará el punto 2 con la hora */
  vm.runInContext('function rfTilt(){return 30;}\nvar document={getElementById:function(){return null;}};\n' +
                  'function draw(){}\nfunction renderLegend(){}\n' + bloque[0] + '\nvar R=rfRows();', ctx);
  return { ctx, P, motors, R: ctx.R };
}

const SJ = planta('SANJOSE');
check('el bloque RF arranca con los modulos y los parametros', !!(SJ && SJ.R && SJ.R.segs.length),
      SJ && SJ.R && SJ.R.segs.length);
if (!SJ) { console.log('\nFALLOS: ' + ko); process.exit(1); }
check('cada segmento sabe de que seguidor es', SJ.R.segs.every(s => Number.isInteger(s[4])),
      JSON.stringify(SJ.R.segs[0]));
check('y el indice del dueno cae dentro del layout',
      SJ.R.segs.every(s => s[4] >= 0 && s[4] < SJ.motors.length));

// ── LA IGUALDAD, QUE ES EL PUNTO ────────────────────────────────────────────
console.log('\n· el panel y el mapa, el MISMO numero');
const N = 500;
for (const nom of ['SANJOSE', 'AYORA', 'BURGO', 'PARAMO']) {
  const P = planta(nom);
  if (!P) { check(nom + ' se monta', false); continue; }
  const xs = P.motors.map(m => m.x), ys = P.motors.map(m => m.y);
  const a = { x: Math.min(...xs), y: Math.min(...ys) }, b = { x: Math.max(...xs), y: Math.max(...ys) };
  const tx = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let sem = 20260921;
  const rnd = () => { sem = (sem * 1103515245 + 12345) & 0x7fffffff; return sem / 0x7fffffff; };
  P.ctx.__tx = tx;
  let dif = 0, conMargen = 0, nulos = 0, sumDetalle = 0, desordenados = 0;
  for (let i = 0; i < N; i++) {
    P.ctx.__m = { x: a.x - 40 + rnd() * ((b.x - a.x) + 80), y: a.y - 40 + rnd() * ((b.y - a.y) + 80) };
    /* EL DEL MAPA: la misma puerta que llama `covRaster` */
    const delMapa = vm.runInContext('rfMargenDe(__tx,__m,R)', P.ctx);
    /* EL DEL PANEL: el desglose completo */
    const delPanel = vm.runInContext('rfEnlace(__tx,__m,R)', P.ctx);
    if (delMapa === null || delPanel.margenDb === null) { nulos++; if (delMapa !== delPanel.margenDb) dif++; continue; }
    conMargen++;
    if (delMapa !== delPanel.margenDb) dif++;
    /* y el DETALLE tiene que sumar exactamente la difraccion del presupuesto */
    if (delPanel.detalle && Math.abs(delPanel.detalle.totalDb - delPanel.difraccionDb) > 0) sumDetalle++;
    /* el ORDEN, en todos: el recorrido del indice va por celdas, no por t, asi
       que en cuanto el enlace no es horizontal deja de coincidir solo */
    const cr = delPanel.cruces;
    if (cr.some((c, j) => j > 0 && c.s < cr[j - 1].s)) desordenados++;
  }
  check(nom.padEnd(8) + ' ' + N + ' enlaces: panel y mapa, identicos BIT A BIT', dif === 0,
        dif + ' difieren · ' + conMargen + ' con margen, ' + nulos + ' nulos');
  check(nom.padEnd(8) + ' el detalle de Deygout suma EXACTAMENTE la difraccion del presupuesto',
        sumDetalle === 0, sumDetalle + ' no cuadran');
  check(nom.padEnd(8) + ' y hay enlaces con margen de verdad, no todo nulo', conMargen > N * 0.5,
        conMargen + ' de ' + N);
  check(nom.padEnd(8) + ' los cruces de los ' + N + ' enlaces llegan ORDENADOS por posicion',
        desordenados === 0, desordenados + ' desordenados');
}

// ── EL DESGLOSE ES EL QUE EL PANEL NECESITA ─────────────────────────────────
console.log('\n· lo que el panel puede ensenar');
{
  const P = planta('BURGO');
  const xs = P.motors.map(m => m.x), ys = P.motors.map(m => m.y);
  const a = { x: Math.min(...xs), y: Math.min(...ys) }, b = { x: Math.max(...xs), y: Math.max(...ys) };
  P.ctx.__tx = { x: a.x + 5, y: (a.y + b.y) / 2 };
  P.ctx.__m = { x: b.x - 5, y: (a.y + b.y) / 2 };
  const e = vm.runInContext('rfEnlace(__tx,__m,R)', P.ctx);
  check('el enlace de prueba cruza filas', e.cruces.length > 3, e.cruces.length);
  check('trae la distancia, las alturas y la variante',
        typeof e.D === 'number' && typeof e.zA === 'number' && !!e.variante, e.variante);
  /* EL RELIEVE VA COMO LA VEGETACION, y antes no. Este check exigia
     `typeof relieveDb === 'number'` mientras a la vegetacion solo le pedia
     estar presente, y esa asimetria ERA el defecto: el relieve siempre traia
     un numero porque sin perfil devolvia un 0 callado. Ahora los dos pueden
     ser `null` -no evaluado- y los dos tienen que DECIRLO con un motivo.
     Se aprieta, no se afloja: antes no se comprobaba ningun motivo. */
  check('trae el desglose: dos rayos, difraccion, relieve y vegetacion por separado',
        typeof e.dosRayosDb === 'number' && typeof e.difraccionDb === 'number' &&
        'relieveDb' in e && 'vegetacionDb' in e);
  check('y lo que NO se ha evaluado va a null CON su motivo, nunca a cero callado',
        (e.relieveDb !== null || e.motivos.indexOf('relieve_no_evaluado_sin_perfil') >= 0) &&
        (e.vegetacionDb !== null || e.motivos.indexOf('vegetacion_no_modelada') >= 0),
        'relieve=' + e.relieveDb + ' veg=' + e.vegetacionDb + ' motivos=' + e.motivos.join(','));
  /* Y que el panel de HOY cae en ese caso: `rfEnlace` no pasa perfil ninguno,
     asi que el relieve de todo el mapa esta sin evaluar. Si algun dia se
     conecta el DEM esto se pondra rojo, y entonces habra que venir a mirarlo
     -que es justo lo que se quiere: que el cambio no pase desapercibido-. */
  check('y HOY el relieve del mapa esta sin evaluar, porque nadie pasa perfil',
        e.relieveDb === null && e.motivos.indexOf('relieve_no_evaluado_sin_perfil') >= 0,
        e.relieveDb + ' / ' + e.motivos.join(','));
  /* MISMA INTENCION: el cruce tiene que traer lo bastante para que el panel
     dibuje SU geometria sin recalcular nada. Lo que cambia es QUE: ya no una
     banda vertical ya resuelta, sino la geometria cruda de la fila -eje, cuerda,
     su angulo y el seno del angulo de cruce-, de la que sale el plano inclinado
     y el canto donde esta de verdad. */
  check('cada cruce trae SU geometria: eje, cuerda, su alfa y el seno del cruce',
        e.cruces.every(c => typeof c.zEje === 'number' && typeof c.cuerda === 'number' &&
                            typeof c.alpha === 'number' && typeof c.senPhi === 'number'));
  check('y NINGUN cruce trae ya una banda vertical resuelta',
        e.cruces.every(c => c.banda === undefined));
  check('y de que seguidor es, para poder darle SU angulo',
        e.cruces.every(c => Number.isInteger(c.duenyo)));
  /* EN ORDEN POR POSICION. El panel los dibuja de izquierda a derecha, asi que
     sin esto el corte vertical sale con las filas desordenadas. El NUMERO de
     Deygout no depende del orden -medido: 0 diferencias en 3.000 enlaces con
     la lista invertida y barajada-, pero el dibujo si.
     SE COMPRUEBA SOBRE MUCHOS ENLACES Y EN LAS CUATRO PLANTAS: con uno solo, y
     encima horizontal, el recorrido del indice ya sale ordenado por casualidad
     y la comprobacion no comprobaba nada. Lo caze con su mutacion. */
  check('los cruces llegan ORDENADOS por posicion, que es como los dibuja el panel',
        e.cruces.every((c, i) => i === 0 || c.s >= e.cruces[i - 1].s),
        e.cruces.slice(0, 6).map(c => c.s.toFixed(1)).join(' '));
  check('el detalle senala el obstaculo DOMINANTE de Deygout',
        !!(e.detalle && e.detalle.dominante && Number.isInteger(e.detalle.dominante.indice)),
        e.detalle && e.detalle.motivo);
  check('con su nu, su perdida y el borde por el que difracta',
        typeof e.detalle.dominante.nu === 'number' && typeof e.detalle.dominante.perdidaDb === 'number' &&
        typeof e.detalle.dominante.borde === 'number');
  check('y los dos subtramos, que es lo que hace entendible el reparto',
        !!e.detalle.izquierda && !!e.detalle.derecha);
  check('la vegetacion sale NO MODELADA, no como 0 dB',
        e.vegetacionDb === null && e.motivos.indexOf('vegetacion_no_modelada') >= 0, e.motivos.join(','));
  check('y el canal sin leer se declara cota superior',
        e.motivos.indexOf('canal_desconocido_ptx_es_cota_superior') >= 0, e.motivos.join(','));
  console.log('     (medido: ' + e.cruces.length + ' cruces · dominante en s=' +
              e.detalle.dominante.s.toFixed(1) + ' m con nu=' + e.detalle.dominante.nu.toFixed(3) +
              ' · difraccion ' + e.difraccionDb.toFixed(2) + ' dB · margen ' +
              (e.margenDb === null ? 'null' : e.margenDb.toFixed(2) + ' dB') + ')');
}

// ── SIN PARÁMETROS NO SE INVENTA NADA ───────────────────────────────────────
console.log('\n· sin parametros cargados, ni un numero');
{
  const P = planta('BURGO');
  P.ctx.S._radioParams = null;
  P.ctx.__tx = { x: 0, y: 100 }; P.ctx.__m = { x: 300, y: 100 };
  const e = vm.runInContext('rfEnlace(__tx,__m,R)', P.ctx);
  check('el margen es null, no 0', e.margenDb === null, e.margenDb);
  check('y dice por que', e.motivos.indexOf('parametros_no_cargados') >= 0, e.motivos.join(','));
  const mapa = vm.runInContext('rfMargenDe(__tx,__m,R)', P.ctx);
  check('y el mapa da lo mismo: null', mapa === null, mapa);
}

// ── EL SELECTOR DE MOTOR ────────────────────────────────────────────────────
console.log('\n· el selector conserva el modelo antiguo (A)');
{
  const P = planta('BURGO');
  const xs = P.motors.map(m => m.x), ys = P.motors.map(m => m.y);
  const a = { x: Math.min(...xs), y: Math.min(...ys) }, b = { x: Math.max(...xs), y: Math.max(...ys) };
  P.ctx.__tx = { x: a.x + 5, y: (a.y + b.y) / 2 };
  P.ctx.__m = { x: b.x - 5, y: (a.y + b.y) / 2 };
  const nuevo = vm.runInContext('rfMargenDe(__tx,__m,R)', P.ctx);
  P.ctx.S.rf.motor = 'antiguo';
  const antiguo = vm.runInContext('rfMargenDe(__tx,__m,R)', P.ctx);
  check('con el motor ANTIGUO se obtiene otro numero, y sale del modelo congelado',
        typeof antiguo === 'number' && antiguo !== nuevo,
        'nuevo ' + nuevo + ' · antiguo ' + antiguo);
  console.log('     (medido en ese enlace: nuevo ' + (nuevo === null ? 'null' : nuevo.toFixed(2)) +
              ' dB · antiguo ' + antiguo.toFixed(2) + ' dB · ' +
              (nuevo === null ? '—' : (nuevo - antiguo).toFixed(2) + ' dB de diferencia') + ')');
  /* Se mira LA SENTENCIA de la firma, no el bloque entero: `rfMotor()` aparece
     tambien en `rfMargenDe`, asi que un `[\s\S]*?` sobre todo el bloque daba
     por buena una firma que ya no lo llevaba. Lo caze con su mutacion. */
  const sentSig = bloque[0].match(/const sig=[\s\S]*?;\n/);
  check('la firma del raster se localiza', !!sentSig);
  check('y el MOTOR entra en ella, o cambiar de motor dejaria el mapa anterior en pantalla',
        !!sentSig && /rfMotor\(\)/.test(sentSig[0]),
        sentSig && sentSig[0].slice(-90).replace(/\n/g, ' '));
}

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
                       : 'TODO OK — ' + ok + ' comprobaciones'));
if (MUTA) {
  console.log(ko ? '### bien: la mutacion «' + MUTA + '» sale roja'
                 : '### MAL: la mutacion «' + MUTA + '» pasa desapercibida');
}
process.exit(ko ? 1 : 0);
