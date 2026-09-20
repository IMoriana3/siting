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
  // el error del modelo antiguo, reintroducido a propósito: filo desde el suelo
  filoDesdeSuelo: [/zBot: eje - semi,/, 'zBot: sueloM == null ? 0 : sueloM,'],
  // media cuerda en vez de cuerda entera: la banda sale con la mitad de alto
  semiCuerda:     [/var semi = \(cuerdaM \/ 2\)/, 'var semi = (cuerdaM / 4)'],
  // coseno en vez de seno: el seguidor plano taparía lo máximo y el vertical nada
  senoPorCoseno:  [/Math\.abs\(Math\.sin\(alphaDeg \* GRADO\)\)/, 'Math.abs(Math.cos(alphaDeg * GRADO))'],
  // el hueco deja de existir: cualquier rayo por debajo se da por tapado
  sinHueco:       [/if \(zRayo < b\.zBot\) \{/, 'if (false) {'],
  // el régimen siempre dice «cruza»: se pierde el caso del pasillo
  siemprCruza:    [/ang <= tol \? "pasillo" : "cruza"/, '"cruza"'],

  // ── y de la parte de TECNOLOGÍA ──
  // la frecuencia recupera un valor por defecto: el fallo que esto viene a
  // impedir es predecir sub-GHz con los números de 2,4 y que nadie se entere
  sinExigeF:      [/if \(!\(fHz > 0\)\) throw new Error\([^;]*\);/, 'if (!(fHz > 0)) return 2.45e9;'],
  // el radio de Fresnel deja de depender de λ: la misma geometría despejaría
  // igual en 868 MHz que en 2,45 GHz, que es justo lo que NO se puede trasladar
  fresnelSinLambda: [/\(nn \* longitudOnda\(fHz\) \* d1 \* d2\)/, '(nn * d1 * d2)'],
  // se cae el corte de ν = −0,78: la difracción empieza a dar pérdidas
  // NEGATIVAS (ganancia) donde debería dar 0
  filoSinCorte:   [/if \(v <= -0\.78\) return 0\.0;/, 'if (false) return 0.0;'],
  // punto de ruptura con 2 en vez de 4
  rupturaMitad:   [/return \(4 \* ht \* hr\) \/ longitudOnda\(fHz\);/, 'return (2 * ht * hr) / longitudOnda(fHz);'],
  // Deygout relanzado desde el borde SUPERIOR: el error del modelo antiguo,
  // metido esta vez en la reconstrucción y no en la banda
  bordeDeArriba:  [/var bordeDom = corta\(cruces\[mejor\]\.banda, zDom\)\.borde;/, 'var bordeDom = cruces[mejor].banda.zTop;'],
};
const MUTA = process.env.MUTA;
let fuente = fs.readFileSync(path.join(RAIZ, 'radio_pv_model.js'), 'utf8');
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  const antes = fuente;
  fuente = fuente.replace(m[0], m[1]);
  if (fuente === antes) { console.error('la mutacion «' + MUTA + '» no casó con el código'); process.exit(2); }
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}
const ctx = { module: { exports: {} }, globalThis: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fuente, ctx);
const R = ctx.module.exports;
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

// ── RELIEVE ──────────────────────────────────────────────────────────────────
console.log('\n· el terreno entre los nodos');
// rayo de 2 a 2 sobre 100 m: horizontal a 2 m. Un cerro de 3 m en s=50 invade 1 m.
const perfil = [[20, 0.5], [50, 3.0], [80, 1.0]];
const dom = R.relieveDominante(2, 2, 100, perfil);
check('el punto dominante es el que más invade el rayo', dom && dom.s === 50, dom && dom.s);
check('y dice cuánto invade: 1,0 m', dom && cerca(dom.invade, 1.0), dom && dom.invade);
check('sin perfil, no hay relieve que valga (null, no 0)',
      R.relieveDominante(2, 2, 100, null) === null);
check('un terreno que no llega al rayo da invasión negativa, no se descarta',
      R.relieveDominante(2, 2, 100, [[50, 1.0]]).invade < 0);

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
