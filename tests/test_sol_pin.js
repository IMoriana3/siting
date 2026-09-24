// LA COPIA FIJADA DE `sol.js`, CAREADA CONTRA SU CANON.
//
// `lib/sol.js` es de Cobertura-Zigbee y vive allí. Aquí hay una copia porque la
// app es un HTML servido desde Pages y no puede leer un repo hermano en tiempo
// de ejecución — y NO se reescribe aquí porque el modelo de seguimiento está
// contrastado contra pvlib en `backtracking.html`, y una segunda versión de la
// ecuación del tiempo es justo lo que ese módulo se creó para evitar.
//
// Una copia sin quien la caree se queda vieja en silencio. Es literalmente lo
// que le pasó a SolarGPTfull con `zigbee_pv_model.js`: entró dentro de un
// commit sobre otra cosa, se quedó dos meses por detrás del canon, y sus
// parámetros daban 4,8 dB de diferencia sin que nadie lo supiera.
//
//   node tests/test_sol_pin.js
//   MUTA=<clave> node tests/test_sol_pin.js     (TIENE que salir rojo)
//
// rc = 0 careado y coincide · 1 discrepa · 2 NO SE HA PODIDO CAREAR
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};
const cerca = (a, b, t) => Math.abs(a - b) <= (t == null ? 1e-9 : t);

/* ── MUTACIONES ─────────────────────────────────────────────────────────── */
const MUTACIONES = {
  // la copia se desvía del canon por un byte: el caso que este banco existe
  // para cazar, y el que le pasó de verdad a SolarGPTfull
  copiaDesviada: ['lib/sol.js', "S.VERSION = '0.3.0'", "S.VERSION = '0.3.1'"],
  // el sha del lock deja de corresponder con el fichero
  lockRancio: ['lib/sol.lock.json', /"sha256": "[0-9a-f]{8}/, '"sha256": "00000000'],
  // el backtracking deja de corregir: a primera hora el seguidor se queda plano
  // contra el sol y se come la sombra de la fila de al lado
  sinBacktracking: ['lib/sol.js', 'if (temp < 1) th = wid', 'if (false) th = wid'],
  // el tope de ángulo desaparece y el seguidor gira más de lo que puede
  sinTope: ['lib/sol.js', 'return Math.max(-mx, Math.min(mx, th));', 'return th;'],
};
const MUTA = process.env.MUTA;
let DIR = RAIZ;
if (MUTA) {
  const mu = MUTACIONES[MUTA];
  if (!mu) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'solpin-'));
  fs.mkdirSync(path.join(DIR, 'lib'));
  for (const f of ['lib/sol.js', 'lib/sol.lock.json']) fs.copyFileSync(path.join(RAIZ, f), path.join(DIR, f));
  const dest = path.join(DIR, mu[0]), antes = fs.readFileSync(dest, 'utf8');
  const despues = antes.replace(mu[1], mu[2]);
  if (despues === antes) {
    console.error('la mutacion «' + MUTA + '» no casó con ' + mu[0] + '. Eso es NO COMPROBADO, no rojo.');
    process.exit(2);
  }
  fs.writeFileSync(dest, despues);
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}

const fCopia = path.join(DIR, 'lib/sol.js');
const fLock = path.join(DIR, 'lib/sol.lock.json');
check('la copia y su lock están donde se espera', fs.existsSync(fCopia) && fs.existsSync(fLock));
if (!fs.existsSync(fCopia) || !fs.existsSync(fLock)) { console.log('\nFALLAN ' + ko); process.exit(1); }

const lock = JSON.parse(fs.readFileSync(fLock, 'utf8'));
const copia = fs.readFileSync(fCopia);
const sha = crypto.createHash('sha256').update(copia).digest('hex');

check('el lock declara su canon (repo y ruta)',
      lock.canon && lock.canon.repo === 'imoriana3/cobertura-zigbee' && lock.canon.ruta === 'sol.js',
      JSON.stringify(lock.canon));
check('el sha del lock corresponde con la copia', lock.copia.sha256 === sha,
      lock.copia.sha256.slice(0, 12) + ' vs ' + sha.slice(0, 12));
check('el lock declara la versión del canon', /^\d+\.\d+\.\d+$/.test(String(lock.canon.version)));
check('y la copia dice esa misma versión',
      new RegExp("VERSION = '" + String(lock.canon.version).replace(/\./g, '\\.') + "'").test(copia.toString()),
      String(lock.canon.version));

/* ── EL CAREO CONTRA EL CANON, QUE ES LO QUE DA SENTIDO AL RESTO ────────── */
const hermano = ['../Cobertura-Zigbee', '../cobertura-zigbee']
  .map(p => path.join(RAIZ, p, 'sol.js')).find(p => fs.existsSync(p));
if (!hermano) {
  console.log('\nNO SE HA PODIDO CAREAR: no encuentro `sol.js` en el repo hermano.');
  console.log('El lock cuadra consigo mismo, que no dice NADA sobre si la copia está al día.');
  console.log('«No he podido mirar» no es «está bien».');
  process.exit(2);
}
const canon = fs.readFileSync(hermano);
check('la copia es IDÉNTICA al canon, byte a byte', canon.equals(copia),
      'canon ' + crypto.createHash('sha256').update(canon).digest('hex').slice(0, 12) +
      ' · copia ' + sha.slice(0, 12));

/* ── Y QUE EL MÓDULO HAGA LO QUE DICE ───────────────────────────────────── */
const Sol = require(fCopia);
check('el módulo expone la posición del sol y el seguimiento',
      typeof Sol.solarPos === 'function' && typeof Sol.singleaxis === 'function');

/* Valores CLAVADOS, de El Burgo (41,5763 · −0,7981), solsticio de verano.
   No son «lo que salga»: si el modelo cambia, este banco lo dice y hay que ir a
   mirar el careo de ángulo por hora antes de dar nada por bueno. */
const p = Sol.solarPos(Date.UTC(2026, 5, 21, 12, 0), 41.5763, -0.7981);
check('El Burgo, 21-jun 12:00 UTC: elevación 71,83°', cerca(p.elev, 71.83, 0.01), p.elev);
check('y azimut 176,31°', cerca(p.az, 176.31, 0.01), p.az);

const zen = 90 - p.elev;
const sinBt = Sol.singleaxis(zen, p.az, { axisTilt: 0, axisAz: 0, maxAngle: 60 });
const conBt = Sol.singleaxis(zen, p.az, { axisTilt: 0, axisAz: 0, backtrack: true, gcr: 0.2, maxAngle: 60 });
check('a mediodía el seguidor va casi plano: 1,21°', cerca(sinBt, 1.21, 0.01), sinBt);
check('y el backtracking NO corrige a mediodía: no hay sombra que evitar',
      cerca(conBt, sinBt, 1e-12), conBt + ' vs ' + sinBt);

/* A PRIMERA Y ÚLTIMA HORA SÍ CORRIGE, Y SÓLO AHÍ. Medido antes de escribirlo,
   que es lo que hay que hacer: con el GCR real de El Burgo (cuerda 2,38 / paso
   12 = 0,198) la corrección de backtracking es CERO de 6:00 a 18:00 UTC y sólo
   aparece en los bordes del día —el sol tiene que estar muy bajo para que una
   fila le dé sombra a la siguiente con ese paso—:

       5:00   puro 60,00°   backtracking 19,37°   corrección −40,63°
       6:00   puro 60,00°   backtracking 60,00°   corrección   0,00°
      12:00   puro  1,21°   backtracking  1,21°   corrección   0,00°
      19:00   puro −60,00°  backtracking −27,81°  corrección +32,19°

   La primera versión de este banco decía «lo echa MUY atrás (>20°)» a las 5:30
   y salía ROJO: la corrección real ahí es 9,87°. La expectativa estaba
   INVENTADA, no medida, y el banco tenía razón. */
const m = Sol.solarPos(Date.UTC(2026, 5, 21, 5, 0), 41.5763, -0.7981);
const zm = 90 - m.elev;
const mSin = Sol.singleaxis(zm, m.az, { axisTilt: 0, axisAz: 0, maxAngle: 60 });
const mCon = Sol.singleaxis(zm, m.az, { axisTilt: 0, axisAz: 0, backtrack: true, gcr: 0.2, maxAngle: 60 });
check('a las 5:00 UTC el seguimiento puro pide el tope, 60°', cerca(Math.abs(mSin), 60, 0.01), mSin);
check('y el backtracking lo echa a 19,37°: 40,63° de corrección',
      cerca(mCon, 19.37, 0.01), mCon);
const med = Sol.solarPos(Date.UTC(2026, 5, 21, 9, 0), 41.5763, -0.7981);
const zMed = 90 - med.elev;
check('y a las 9:00 la corrección es CERO EXACTO: con paso 12 m no hay sombra que evitar',
      Sol.singleaxis(zMed, med.az, { axisTilt: 0, axisAz: 0, backtrack: true, gcr: 0.2, maxAngle: 60 }) ===
      Sol.singleaxis(zMed, med.az, { axisTilt: 0, axisAz: 0, maxAngle: 60 }));
check('el tope de ±60° se respeta con y sin backtracking',
      Math.abs(mSin) <= 60 + 1e-9 && Math.abs(mCon) <= 60 + 1e-9);
check('de noche no hay ángulo: NaN, no un cero que parezca plano',
      Number.isNaN(Sol.singleaxis(95, 0, { axisTilt: 0, axisAz: 0, maxAngle: 60 })));

/* ── EL ALCANCE ─────────────────────────────────────────────────────────── */
const PISO_MUT = 4;
console.log('\nalcance: 1 copia fijada careada byte a byte contra su canon · ' +
            Object.keys(MUTACIONES).length + ' mutaciones (piso ' + PISO_MUT + ')');
if (Object.keys(MUTACIONES).length < PISO_MUT) {
  console.log('ALCANCE INSUFICIENTE. Esto no ha mirado bastante.');
  process.exit(2);
}

console.log('');
if (ko) { console.log('FALLAN ' + ko + ' de ' + (ok + ko) + ' comprobaciones'); process.exit(1); }
console.log('TODO OK — ' + ok + ' comprobaciones');
