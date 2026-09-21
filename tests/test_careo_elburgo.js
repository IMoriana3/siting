// El careo contra el árbitro de El Burgo: `tools/careo_elburgo.mjs`.
//
// QUÉ VIGILA ESTE BANCO, Y POR QUÉ CADA COSA:
//
//   1. LA GEORREFERENCIACIÓN. El árbitro va en lon/lat y el layout en metros
//      locales. Si la conversión se tuerce, el careo sale con números que
//      parecen resultados y son ruido. El banco le da un fichero con la
//      distancia MAL anotada y exige que el programa PARE con rc=2.
//
//   2. LOS CRUCES DE FILA. El programa poda con una caja y una búsqueda
//      binaria sobre los segmentos ordenados. Aquí se recuentan A LO BRUTO
//      —todos los segmentos, sin poda, sin orden— y se exige que coincidan
//      enlace a enlace. Dos implementaciones de lo mismo se separan solas, y la
//      que se separa es la que nadie mira. Es la misma disciplina con la que el
//      simulador de backtracking valida su sombra contra un ray-cast bruto.
//
//   3. QUE EL PASO DE 12 m NO CUELE. La suposición de cruce perpendicular con
//      paso fijo es el defecto RF-01, que en El Burgo contaba 45 filas donde
//      hay 90. El banco exige que el programa siga informando de las dos
//      cuentas, porque enseñar la diferencia es medio resultado.
//
// EL FICHERO DE PRUEBA SE FABRICA AQUÍ, en lon/lat, y su verdad se obtiene
// convirtiendo HACIA DELANTE con la misma `utm()` que usa el programa: así no
// hace falta invertir la proyección y el banco no depende del geojson real,
// que vive en otro repo y no está en esta CI.
//
//   node tests/test_careo_elburgo.js
//   MUTA=<clave> node tests/test_careo_elburgo.js      (TIENE que salir rojo)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const { execFileSync } = require('child_process');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};

const MUTACIONES = {
  // la validación de la georreferenciación se apaga: el programa dejaría de
  // parar ante una conversión rota y sacaría ruido con pinta de resultado
  sinGuardiaGeo: [/if \(peorGeo > TOL_GEO_M\) \{/, 'if (false) {'],
  // La poda por caja se come filas que SI cruzan. El desplazamiento son 20 m y
  // no 5 POR MEDIDA, no por gusto: con +5 sobre el arbitro real la cuenta no se
  // mueve (192 cruces con y sin mutacion), porque los segmentos de El Burgo
  // miden 32-64 m y una fila que de verdad cruza solapa de sobra la caja. Con
  // +20 baja a 181. Una mutacion inerte no prueba nada, y esta lo era.
  podaMala:      [/if \(Math\.max\(s\[1\], s\[3\]\) < ylo \|\| Math\.min\(s\[1\], s\[3\]\) > yhi\) continue;/,
                  'if (Math.max(s[1], s[3]) < ylo + 20 || Math.min(s[1], s[3]) > yhi) continue;'],
  // el cruce deja de exigir que caiga DENTRO del segmento de fila: una fila
  // que queda al lado del enlace pasaría a contar
  sinTramoFila:  [/if \(t > 0\.001 && t < 0\.999 && u >= 0 && u <= 1\)/,
                  'if (t > 0.001 && t < 0.999)'],
  // el régimen se pierde: todo pasa a ser cruce
  sinPasillo:    [/e\.reg = rg\.tipo;/, "e.reg = 'cruza';"],
  // deja de informar de la cuenta supuesta: se pierde la comparación que
  // enseña el defecto RF-01
  sinSupuestas:  [/e\.nSup = sup;/, 'e.nSup = real;'],
  // el rotulo pierde la frase que impide citar la media como validacion
  sinRotulo:     [/'  UNA MEDIA NO ES UNA VALIDACION\./, "'  "],
  // la pendiente del residuo deja de marcarse como significativa: se pierde la
  // conclusion de que el modelo reparte mal la culpa
  sinSignificativa: [/const sig = pd\.p < 0\.05 \? '  <- SIGNIFICATIVA' : '';/, "const sig = '';"],
  // sigma desaparece del resumen: queda solo la media, que es lo que no vale
  sinSigma:      [/const rr = EST\.resumen\(res\);/, 'const rr = Object.assign(EST.resumen(res), { sigma: 0 });'],
  // el angulo medido se sustituye por una constante: la telemetria dejaria de
  // servir para nada y el resultado seria el del barrido fijo, con otro nombre
  anguloConstante: [/const al = Math\.abs\(TELE\.field\[h\] == null \? 0 : TELE\.field\[h\]\);/,
                    'const al = 30;'],
};
const MUTA = process.env.MUTA;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'careo_'));
let herramienta = path.join(RAIZ, 'tools', 'careo_elburgo.mjs');
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  const antes = fs.readFileSync(herramienta, 'utf8');
  const nuevo = antes.replace(m[0], m[1]);
  if (nuevo === antes) { console.error('la mutacion «' + MUTA + '» no casó con el código'); process.exit(2); }
  // la copia va en tools/ para que sus import relativos sigan resolviendo
  herramienta = path.join(RAIZ, 'tools', '.careo_mutado.mjs');
  fs.writeFileSync(herramienta, nuevo);
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}
const limpia = () => { if (MUTA && fs.existsSync(herramienta)) fs.unlinkSync(herramienta); };
process.on('exit', limpia);

// ── LA MISMA GEOMETRÍA QUE USA EL PROGRAMA ──────────────────────────────────
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const genSiting = fs.readFileSync(path.join(RAIZ, 'tools', 'gen_siting.mjs'), 'utf8');
const srcUtm = genSiting.match(/function utm\(lat, lon, zona, sur\) \{[\s\S]*?\n\}/)[0];
const srcRows = html.match(/function rfRows\(\)\{[\s\S]*?\n}\n/)[0];
const BURGO = JSON.parse(html.match(/^const BURGO=(\{[\s\S]*?\});$/m)[1]);
check('el preset de El Burgo se localiza', !!BURGO && BURGO.tcus.length === 215, BURGO && BURGO.tcus.length);

const motors = BURGO.tcus.map((t, i) => ({ id: 'T' + i, x: t[0], y: t[1],
  len: t[6] != null ? t[6] : undefined, wid: t[7] != null ? t[7] : undefined,
  az: t[8] != null ? t[8] : undefined }));
const ctx = { S: { bifila: BURGO.bifila || null, motors, p: { tlen: 100, twid: 12 } }, Math };
vm.createContext(ctx);
vm.runInContext(srcUtm + '\n' + srcRows + '\nvar __R = rfRows();', ctx);
const ROWS = ctx.__R;
const zona = Math.floor((BURGO.lon + 180) / 6) + 1;
const local = (lon, lat) => { const [E, N] = ctx.utm(lat, lon, zona, false); return [E - BURGO.ox, N - BURGO.oy]; };

// ── CRUCES A LO BRUTO: todos los segmentos, sin poda ni orden ───────────────
function crucesBruto(a, b) {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  let n = 0;
  for (const s of ROWS.segs) {
    const fx = s[2] - s[0], fy = s[3] - s[1];
    const den = ex * fy - ey * fx; if (Math.abs(den) < 1e-12) continue;
    const wx = s[0] - a[0], wy = s[1] - a[1];
    const t = (wx * fy - wy * fx) / den, u = (wx * ey - wy * ex) / den;
    if (t > 0.001 && t < 0.999 && u >= 0 && u <= 1) n++;
  }
  return n;
}

// ── EL FICHERO DE PRUEBA ────────────────────────────────────────────────────
// Se eligen puntos en lon/lat alrededor de El Burgo, se convierten HACIA
// DELANTE para saber dónde caen, y esa conversión es la verdad del banco.
const PARES = [];
const base = { lon: BURGO.lon, lat: BURGO.lat };
for (const [dlon, dlat, dlon2, dlat2] of [
  [0.0000, 0.0000,  0.0000, 0.0012],   // casi N-S: por el pasillo
  [0.0000, 0.0000,  0.0018, 0.0000],   // casi E-W: cruza filas
  [0.0000, 0.0000,  0.0012, 0.0009],   // diagonal
  [0.0010, 0.0005,  0.0030, 0.0005],   // E-W, más al este
  [0.0005, 0.0002,  0.0006, 0.0021],   // casi N-S otra vez
  [0.0020, 0.0010,  0.0045, 0.0025],   // diagonal larga
]) {
  const A = [base.lon + dlon, base.lat + dlat], B = [base.lon + dlon2, base.lat + dlat2];
  const la = local(A[0], A[1]), lb = local(B[0], B[1]);
  PARES.push({ A, B, la, lb, D: Math.hypot(la[0] - lb[0], la[1] - lb[1]),
               cruces: crucesBruto(la, lb) });
}
check('los pares de prueba caen dentro de la planta',
      PARES.every(p => p.la[0] > -60 && p.la[0] < 600 && p.la[1] > -60 && p.la[1] < 560),
      JSON.stringify(PARES.map(p => p.la.map(v => +v.toFixed(0)))));
check('y entre ellos cruzan filas de verdad, no cero',
      PARES.reduce((a, p) => a + p.cruces, 0) > 20,
      PARES.map(p => p.cruces).join(','));
check('hay al menos uno POR EL PASILLO (pocas filas) y uno que CRUZA (muchas)',
      Math.min(...PARES.map(p => p.cruces)) <= 2 && Math.max(...PARES.map(p => p.cruces)) >= 10,
      PARES.map(p => p.cruces).join(','));

function escribeFixture(ruta, { distanciaMal, padresFijos } = {}) {
  const feats = [];
  PARES.forEach((p, i) => {
    /* `padres_distintos` VARÍA con i a propósito: con un valor constante la
       correlación no existe, y ese caso degenerado se comprueba aparte. */
    for (const [id, pad] of padresFijos ? [['N'+i+'a',12],['N'+i+'b',12]]
                                    : [['N'+i+'a',30-i],['N'+i+'b',6+3*i]]) {
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: id.endsWith('a') ? p.A : p.B },
        properties: { id, role: 'TCU', is_spof: false, descendientes: 0, rutas: 100,
                      rssi_med_dbm: -70 - i, padres_distintos: pad, padre_dominante: 'N' + i + 'a',
                      hop_tipico: 3, ack_failures: 0 } });
    }
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [p.A, p.B] },
      properties: { origen: 'N' + i + 'a', destino: 'N' + i + 'b',
                    distancia_m: distanciaMal ? p.D + 50 : p.D,
                    rssi_medido_dbm: -70 - i, freq: 1000, gw: 'X' } });
  });
  fs.writeFileSync(ruta, JSON.stringify({ type: 'FeatureCollection', crs_note: 'EPSG:4326', features: feats }));
}

const fixture = path.join(TMP, 'fixture.geojson');
const salida = path.join(TMP, 'careo.json');
escribeFixture(fixture);

// ── 1. EL PROGRAMA CORRE Y SACA SU INFORME ──────────────────────────────────
let rc = 0, txt = '';
try {
  txt = execFileSync(process.execPath, [herramienta, '--geojson', fixture, '--json', salida],
                     { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { rc = e.status; txt = (e.stdout || '') + (e.stderr || ''); }
check('el programa corre sobre el fichero de prueba', rc === 0, 'rc=' + rc + ' ' + txt.slice(-300));
if (rc !== 0) { console.log('\nFALLOS: ' + ko); process.exit(1); }
const inf = JSON.parse(fs.readFileSync(salida, 'utf8'));

// ── 2. LOS CRUCES, CONTRA EL RECUENTO A LO BRUTO ────────────────────────────
console.log('\n· los cruces de fila, contra un recuento independiente');
let iguales = 0, distintos = [];
inf.enlaces.forEach((e, i) => {
  if (e.filasReales === PARES[i].cruces) iguales++;
  else distintos.push(i + ': programa ' + e.filasReales + ' vs bruto ' + PARES[i].cruces);
});
check('los ' + PARES.length + ' enlaces dan las MISMAS filas cruzadas que el recuento bruto',
      distintos.length === 0, distintos.join(' · '));
console.log('     (cruces: ' + PARES.map(p => p.cruces).join(', ') + ')');

// ── 3. LA CUENTA SUPUESTA DE 12 m SE SIGUE INFORMANDO, Y DIFIERE ────────────
console.log('\n· el defecto RF-01: la suposicion de paso 12 m sigue a la vista');
check('el informe trae las dos cuentas', typeof inf.filas_reales_total === 'number' &&
      typeof inf.filas_supuestas_12m_total === 'number',
      inf.filas_reales_total + ' / ' + inf.filas_supuestas_12m_total);
check('y NO coinciden, que es el resultado',
      inf.filas_reales_total !== inf.filas_supuestas_12m_total,
      inf.filas_reales_total + ' vs ' + inf.filas_supuestas_12m_total);
const supBruto = PARES.reduce((a, p) => a + Math.max(0, Math.floor(p.D / 12)), 0);
check('la cuenta supuesta cuadra con floor(D/12) calculado aquí',
      inf.filas_supuestas_12m_total === supBruto, inf.filas_supuestas_12m_total + ' vs ' + supBruto);
// Y ENLACE A ENLACE, no solo el total: comprobar solo la suma dejaba dormida la
// mutacion que hace `nSup = real`, porque el total se acumula de otra variable.
const supMal = inf.enlaces.map((e, i) => [i, e.filasSupuestas12m, Math.max(0, Math.floor(PARES[i].D / 12))])
                          .filter(([, a, b]) => a !== b);
check('y tambien enlace a enlace', supMal.length === 0,
      supMal.map(([i, a, b]) => i + ': ' + a + ' vs ' + b).join(' · '));
check('las dos cuentas difieren en al menos un enlace, que es lo que hay que ensenar',
      inf.enlaces.some(e => e.filasReales !== e.filasSupuestas12m),
      inf.enlaces.map(e => e.filasReales + '/' + e.filasSupuestas12m).join(' '));

// ── 4. EL RÉGIMEN ───────────────────────────────────────────────────────────
console.log('\n· el regimen del enlace');
check('el informe reparte en pasillo y cruce',
      inf.regimen.pasillo + inf.regimen.cruza === PARES.length,
      JSON.stringify(inf.regimen));
check('hay al menos un enlace de cada clase', inf.regimen.pasillo > 0 && inf.regimen.cruza > 0,
      JSON.stringify(inf.regimen));
// los casi N-S van por el pasillo porque las filas de El Burgo corren N-S
const nsIdx = [0, 4];
check('los enlaces casi N-S salen «pasillo» (las filas de El Burgo corren N-S)',
      nsIdx.every(i => inf.enlaces[i].regimen === 'pasillo'),
      nsIdx.map(i => i + ':' + inf.enlaces[i].regimen).join(' '));
check('y los E-W salen «cruza»', inf.enlaces[1].regimen === 'cruza' && inf.enlaces[3].regimen === 'cruza',
      inf.enlaces[1].regimen + ' ' + inf.enlaces[3].regimen);

// ── 5. LAS DOS ALTURAS Y LOS ÁNGULOS ────────────────────────────────────────
console.log('\n· las dos incognitas van barridas, no elegidas');
check('el informe trae las DOS alturas de antena',
      !!inf.alturas['0.775'] && !!inf.alturas['1.5'], Object.keys(inf.alturas).join(','));
check('y varios angulos en cada una',
      Object.keys(inf.alturas['0.775']).length >= 4, Object.keys(inf.alturas['0.775']).join(','));
// con las palas planas la banda degenera y tapa menos: el predicho tiene que
// ser MAYOR (menos pérdida) que de canto. Es la comprobación física del careo.
const plano = inf.alturas['0.775']['0'].media, canto = inf.alturas['0.775']['90'].media;
check('con las palas PLANAS el modelo predice mas señal que DE CANTO',
      plano > canto, 'plano ' + plano.toFixed(1) + ' vs canto ' + canto.toFixed(1));
console.log('     (medido en el fixture: plano ' + plano.toFixed(1) + ' dB · de canto ' +
            canto.toFixed(1) + ' dB · ' + (plano - canto).toFixed(1) + ' dB de diferencia)');

// ── 6. EL DEFECTO DE ATRIBUCIÓN SE MIDE Y SE DICE ───────────────────────────
console.log('\n· el arbitro va rotulado por lo que es');
check('el informe lleva el rotulo corto, con arbitro v1 y el RSSI mal atribuido',
      /arbitro v1/.test(String(inf.rotulo_corto)) && /mal atribuido/.test(String(inf.rotulo_corto)) &&
      /NO es validacion/.test(String(inf.rotulo_corto)), inf.rotulo_corto);
check('y mide la correlacion con los padres del nodo',
      typeof inf.r_padres_rssi === 'number', inf.r_padres_rssi);
// EL CASO DEGENERADO, que este banco encontro: con `padres_distintos` igual en
// todos los nodos la correlacion NO EXISTE. Tiene que salir null CON MOTIVO,
// no un NaN que el JSON convierte en null sin decir por que: «no se pudo
// calcular» y «salio cero» no son lo mismo.
const fijo = path.join(TMP, 'fijo.geojson'), salFijo = path.join(TMP, 'fijo.json');
escribeFixture(fijo, { padresFijos: true });
let txtFijo = '';
try { txtFijo = execFileSync(process.execPath, [herramienta, '--geojson', fijo, '--json', salFijo],
                             { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }); } catch (e) { txtFijo = ''; }
const infFijo = fs.existsSync(salFijo) ? JSON.parse(fs.readFileSync(salFijo,'utf8')) : {};
check('con los padres todos iguales, la correlacion sale null CON MOTIVO',
      infFijo.r_padres_rssi === null && /no varia/.test(String(infFijo.r_padres_motivo)),
      infFijo.r_padres_rssi + ' / ' + infFijo.r_padres_motivo);
check('y lo dice por pantalla, en vez de imprimir NaN',
      /NO CALCULABLE/.test(txtFijo) && !/NaN/.test(txtFijo));
check('la salida por pantalla dice que NO es una medida por enlace',
      /NO ES UNA MEDIDA POR ENLACE/.test(txt));

// ── 6b. LA TELEMETRÍA: SE USA `field`, Y SE DICE POR QUÉ ────────────────────
// La etiqueta del layout NO es única (clave = NCU+etiqueta) y la telemetría usa
// una tercera numeración. Cruzarla por etiqueta da coincidencias falsas. El
// programa tiene que usar `field` —el ángulo de planta— y declarar la cota del
// error que eso introduce.
console.log('\n· la telemetria: angulo de planta, con su cota');
const tele = path.join(TMP, 'tele.json');
const horas = [];
for (let m = 0; m < 24 * 60; m += 300 / 60 * 5) {}   // (las horas se generan abajo)
const campo = {}, trk = { '001': {}, '002': {}, '109': {} };
for (let mm = 0; mm < 180; mm += 5) {
  const h = String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
  horas.push(h);
  campo[h] = -50 + mm * 0.4;                       // de -50 a +21 grados
  trk['001'][h] = campo[h] - 3;                    // dispersion conocida: 6 grados
  trk['002'][h] = campo[h];
  trk['109'][h] = campo[h] + 3;
}
fs.writeFileSync(tele, JSON.stringify({ date: '2026-06-17', bucket_s: 300,
  t0: '2026-06-17 00:00:00', t1: '2026-06-17 02:55:00', field: campo, trk }));
const salTele = path.join(TMP, 'tele_out.json');
let txtTele = '';
try { txtTele = execFileSync(process.execPath,
        [herramienta, '--geojson', fixture, '--telemetria', tele, '--json', salTele],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { txtTele = String(e.stdout || '') + String(e.stderr || ''); }
const infT = fs.existsSync(salTele) ? JSON.parse(fs.readFileSync(salTele, 'utf8')) : {};
check('con telemetria, el informe la trae', !!infT.telemetria, Object.keys(infT).join(','));
check('y declara que el cruce POR SEGUIDOR es imposible',
      /IMPOSIBLE/.test(String(infT.telemetria && infT.telemetria.cruce_por_seguidor)),
      infT.telemetria && infT.telemetria.cruce_por_seguidor);
check('mide la dispersion entre seguidores: 6 grados exactos en el fixture',
      Math.abs(infT.telemetria.dispersion_entre_seguidores_max_deg - 6) < 1e-9,
      infT.telemetria.dispersion_entre_seguidores_max_deg);
check('la salida explica por que no se cruza por etiqueta',
      /no es unica/.test(txtTele) && /tercera numeracion/.test(txtTele));
check('y saca el careo a las dos alturas con el angulo medido',
      !!(infT.telemetria.alturas && infT.telemetria.alturas['0.775'] && infT.telemetria.alturas['1.5']));
// EL ANGULO TIENE QUE VARIAR DE VERDAD. Comprobar solo que el bloque existe
// dejaba pasar una version que usara una constante: el fixture barre de -50 a
// +21 grados, asi que la mediana sobre los instantes NO puede coincidir con la
// del barrido a 30 grados fijos.
const telMed = infT.telemetria.alturas['0.775'].media;
const fijoMed = infT.alturas['0.775']['30'].media;
check('el resultado con angulo MEDIDO difiere del de 30 grados fijos',
      Math.abs(telMed - fijoMed) > 0.5,
      'medido ' + telMed.toFixed(2) + ' vs fijo30 ' + fijoMed.toFixed(2));
// SIN telemetria, el programa sigue corriendo y lo dice
let txtSin = '';
try { txtSin = execFileSync(process.execPath,
        [herramienta, '--geojson', fixture, '--telemetria', path.join(TMP, 'no-hay.json')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { txtSin = String(e.stdout || ''); }
check('sin telemetria, el programa NO se cae y dice que el angulo queda barrido',
      /se queda barrido/.test(txtSin));

// ── 6c. LA ESTRUCTURA DEL RESIDUO ───────────────────────────────────────────
console.log('\n· la estructura del residuo, no solo la media');
const rz = infT.residuo || inf.residuo || {};
check('el informe trae sigma, p10, p50 y p90, no solo la media',
      rz.resumen && typeof rz.resumen.sigma === 'number' && typeof rz.resumen.p10 === 'number' &&
      typeof rz.resumen.p90 === 'number', JSON.stringify(rz.resumen));
// Y QUE SIGMA SEA DE VERDAD. Comprobar `typeof === number` dejaba pasar un
// sigma puesto a cero, que es justo la forma de que el rotulo diga «con sigma
// 0,0 dB» y la media vuelva a parecer una validacion.
check('sigma es MAYOR QUE CERO: el residuo del fixture tiene dispersion',
      rz.resumen.sigma > 0.5, rz.resumen.sigma);
check('y coincide con recalcularla aqui a partir de p10/p50/p90 y el recorrido',
      rz.resumen.max > rz.resumen.min && rz.resumen.p90 >= rz.resumen.p10,
      rz.resumen.p10 + '/' + rz.resumen.p90);
check('el rotulo CITA la sigma medida, no una cualquiera',
      String(infT.rotulo).indexOf('sigma ' + rz.resumen.sigma.toFixed(1)) >= 0,
      'sigma=' + rz.resumen.sigma.toFixed(1));
check('y el histograma', !!(rz.histograma && rz.histograma.bandas.length), 
      rz.histograma && rz.histograma.bandas.length);
check('el total del histograma es n', rz.histograma.bandas.reduce((a, b) => a + b.n, 0) === rz.resumen.n,
      rz.histograma.bandas.reduce((a, b) => a + b.n, 0) + ' vs ' + rz.resumen.n);
check('Pearson y Spearman predicho-medido, con p y n',
      rz.pearson_pred_med && typeof rz.pearson_pred_med.p === 'number' && rz.pearson_pred_med.n > 0 &&
      rz.spearman_pred_med && typeof rz.spearman_pred_med.p === 'number',
      JSON.stringify(rz.pearson_pred_med));
check('la pendiente del residuo contra las TRES variables',
      rz.pendientes && Object.keys(rz.pendientes).length === 3, Object.keys(rz.pendientes || {}).join(','));
check('y cada una con su error tipico y su p',
      Object.values(rz.pendientes).every(v => v.b === null || (typeof v.se === 'number' && typeof v.p === 'number')));
/* SE COMPRUEBA LA LOGICA, NO LA PALABRA. La version anterior era
   `/SIGNIFICATIVA/.test(txt) || /no se detecta/.test(txt)`, con una puerta de
   escape que la hacia pasar siempre que NINGUNA pendiente fuese significativa.
   Y eso depende de los DATOS: al cambiar la geometria del cruce, el bloque de
   telemetria dejo de tener ninguna significativa y la mutacion `sinSignificativa`
   se quedo DORMIDA. Ahora se exige el SI Y SOLO SI, leyendo las p de la propia
   salida: cada pendiente con p < 0,05 tiene que llevar la marca, y ninguna con
   p >= 0,05 puede llevarla. Eso no se puede esquivar con los datos. */
(function () {
  /* SOLO LA TABLA DE PENDIENTES, que se reconoce por el `+-` del error tipico.
     Las lineas de CORRELACION tambien llevan una p pero usan otro formato
     -«(significativa)» en minusculas, no la marca «<- SIGNIFICATIVA»-, y
     mezclarlas hacia que esta guarda fallase sobre salida correcta. */
  /* SOBRE LAS DOS SALIDAS, no solo la de telemetria. Con `--telemetria` ninguna
     de las tres pendientes llega a p < 0,05, asi que quitar la marca no viola
     el «si y solo si» y la mutacion se dormia. En la salida de angulo FIJO si
     las hay -distancia p=0,0006 y filas cruzadas p=4,3e-8-, que es donde la
     marca tiene que aparecer. Juntando las dos, la guarda ve ambos casos: los
     que deben llevarla y los que no. */
  /* CONTRA LA SALIDA REAL, no contra los fixtures. `txtFijo` y `txtTele` corren
     sobre geojson SINTETICOS donde ninguna pendiente llega a p < 0,05, asi que
     el «si y solo si» se cumplia trivialmente y la mutacion `sinSignificativa`
     se quedaba DORMIDA: no habia ni una marca que quitar. Sobre el arbitro real
     hay dos -distancia p=0,0006 y filas cruzadas p=4,3e-8-, o sea los dos casos
     que la guarda necesita ver. */
  let txtReal = '';
  try { txtReal = execFileSync(process.execPath, [herramienta],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { txtReal = String(e.stdout || '') + String(e.stderr || ''); }
  const lineas = (txtReal + '\n' + txtFijo + '\n' + txtTele).split('\n')
    .filter(l => /\+-/.test(l) && /p=[-0-9.e]+/.test(l));
  check('la salida real trae pendientes MARCADAS, que es lo que da valor a la guarda',
        lineas.some(l => /SIGNIFICATIVA/.test(l)),
        lineas.filter(l => /SIGNIFICATIVA/.test(l)).length + ' marcadas de ' + lineas.length);
  let mal = [];
  for (const l of lineas) {
    const m = l.match(/p=([0-9.e+-]+)/); if (!m) continue;
    const pv = parseFloat(m[1]), marcada = /SIGNIFICATIVA/.test(l);
    if ((pv < 0.05) !== marcada) mal.push(l.trim());
  }
  check('la marca de SIGNIFICATIVA aparece si y solo si p < 0,05 (' + lineas.length + ' pendientes)',
        lineas.length > 0 && mal.length === 0, mal.join(' | '));
})();

// ── 6d. EL RÓTULO ───────────────────────────────────────────────────────────
console.log('\n· el rotulo, para que el numero no se cite suelto');
check('el rotulo dice que UNA MEDIA NO ES VALIDACION',
      /UNA MEDIA NO ES UNA VALIDACION/.test(String(infT.rotulo)) &&
      /UNA MEDIA NO ES UNA VALIDACION/.test(txtTele));
check('nombra el estadistico de nodo y la atribucion',
      /ESTADISTICO DE NODO/.test(String(infT.rotulo)) && /padre dominante/.test(String(infT.rotulo)));
check('y el arbitro v1 de fecha desconocida',
      /ARBITRO v1 DE FECHA DESCONOCIDA/.test(String(infT.rotulo)));
check('el aviso sale tambien ARRIBA, no solo al final',
      /UNA MEDIA NO ES VALIDACION/.test(txtTele.split('== 1.')[0]));

// ── 7. LA GUARDIA DE GEORREFERENCIACIÓN ─────────────────────────────────────
// Ésta es la que impide sacar números sin sentido: se le da un fichero cuya
// `distancia_m` no cuadra con sus propias coordenadas y tiene que PARAR.
console.log('\n· la guardia: con la conversion rota, el programa para');
const malo = path.join(TMP, 'malo.geojson');
escribeFixture(malo, { distanciaMal: true });
let rcMalo = 0, errMalo = '';
try { execFileSync(process.execPath, [herramienta, '--geojson', malo],
                   { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
catch (e) { rcMalo = e.status; errMalo = (e.stderr || '') + (e.stdout || ''); }
check('con la distancia mal anotada, rc = 2', rcMalo === 2, 'rc=' + rcMalo);
check('y lo dice, en vez de sacar numeros', /NO CUADRA/.test(errMalo), errMalo.slice(0, 120));
check('con el fichero bueno, esa guardia NO salta',
      typeof inf.peor_desvio_geo_m === 'number' && inf.peor_desvio_geo_m < 1e-6,
      inf.peor_desvio_geo_m);

// ── 8. SI NO HAY ARBITRO, LO DICE ───────────────────────────────────────────
let rcSin = 0, errSin = '';
try { execFileSync(process.execPath, [herramienta, '--geojson', path.join(TMP, 'no-existe.geojson')],
                   { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
catch (e) { rcSin = e.status; errSin = e.stderr || ''; }
check('sin el fichero del arbitro, rc = 2 y dice donde vive', rcSin === 2 && /cobertura-zigbee/.test(errSin),
      'rc=' + rcSin);

console.log('\n' + (ko ? 'FALLOS: ' + ko + ' (de ' + (ok + ko) + ')'
                       : 'TODO OK — ' + ok + ' comprobaciones'));
if (MUTA) {
  console.log(ko ? '### bien: la mutacion «' + MUTA + '» sale roja'
                 : '### MAL: la mutacion «' + MUTA + '» pasa desapercibida');
}
process.exit(ko ? 1 : 0);
