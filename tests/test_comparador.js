// EL COMPARADOR DE TECNOLOGÍAS — punto 6 de la fase 4.
//
// Lo que este banco vigila NO es aritmética: es DISCIPLINA. Las tres reglas del
// encargo, cada una con su comprobación y su mutación:
//
//   1. un hueco no se rellena     · una tecnología sin sensibilidad NO da número
//   2. no hay índice único        · la salida no puede traer un total
//   3. a varias horas, no a una   · con una sola hora, se para
//
// Y la cuarta, que salió midiendo: «sin camino alternativo» es una UNIÓN, no una
// suma. Un mismo nodo puede colgar de dos articulaciones y sumar las cuentas lo
// dobla — daría más TCU frágiles que TCU hay.
//
//   node tests/test_comparador.js
//   MUTA=<clave> node tests/test_comparador.js      (TIENE que salir rojo)
//
// rc = 0 mide · 1 rojo · 2 no comprobado
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};

/* ── MUTACIONES ─────────────────────────────────────────────────────────── */
const MUTACIONES = {
  // un hueco se rellena con un valor por defecto: la avería que convierte
  // «no lo sé» en «lo he calculado»
  rellenaHueco: ['radio_tecnologias.js', 'if (v == null) f.push(exige[i]);', 'if (false) f.push(exige[i]);'],
  // vuelve el índice único
  indiceUnico: ['radio_tecnologias.js', '_sin_indice_unico: "no hay',
                'puntuacion: 7.4, _sin_indice_unico: "no hay'],
  // se admite comparar a una sola hora
  unaHora: ['radio_tecnologias.js', 'if (!horas || horas.length < 2) {', 'if (false) {'],
  // el veredicto canta ganador aunque los recorridos se solapen
  solapaGana: ['radio_tecnologias.js', 'var domina = mas ? (A.min > B.max) : (A.max < B.min);',
               'var domina = mas ? (A.max > B.max) : (A.min < B.min);'],
  // «sin camino alternativo» se cuenta sumando en vez de uniendo
  sumaEnVezDeUnion: ['radio_malla.js', 'perdidos++; sinAlt.add(vivos[i]);',
                     'perdidos++; sinAlt.add(vivos[i] + "@" + caido);'],
  // «ningún criterio varía» se publica como «la hora da igual»
  horaDaIgual: ['radio_tecnologias.js', 'saturada: !!satur,', 'saturada: false,'],
  // con un solo candidato se declara que el veredicto no depende del módulo:
  // convertir «no lo he podido mirar» en «lo he mirado y no cambia»
  unCandidatoBasta: ['radio_tecnologias.js', 'if (!e || e.n < 2) { sinExtremos.push(tecs[i]); }',
                     'if (!e) { sinExtremos.push(tecs[i]); }'],
};
const MUTA = process.env.MUTA;
let DIR = RAIZ;
if (MUTA) {
  const mu = MUTACIONES[MUTA];
  if (!mu) { console.error('mutacion desconocida. Hay: ' + Object.keys(MUTACIONES).join(', ')); process.exit(2); }
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'comparador-'));
  for (const f of ['radio_tecnologias.js', 'radio_malla.js']) fs.copyFileSync(path.join(RAIZ, f), path.join(DIR, f));
  const dest = path.join(DIR, mu[0]), antes = fs.readFileSync(dest, 'utf8');
  const despues = antes.replace(mu[1], mu[2]);
  if (despues === antes) {
    console.error('la mutacion «' + MUTA + '» no casó con ' + mu[0] + '. Eso es NO COMPROBADO, no rojo.');
    process.exit(2);
  }
  fs.writeFileSync(dest, despues);
  console.log('### MUTACION «' + MUTA + '» PUESTA: este banco TIENE que salir rojo\n');
}

const RT = require(path.join(DIR, 'radio_tecnologias.js'));
const RM = require(path.join(DIR, 'radio_malla.js'));

/* ── LAS VARIANTES, LEÍDAS DEL FICHERO DE VERDAD ────────────────────────────
   No se escriben aquí: si el banco llevara su propia copia de los parámetros,
   comprobaría su copia y no el repo. Es el mismo motivo por el que los útiles
   extraen el bloque RF del `index.html` real. */
const PARAMS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const TEC = PARAMS.tecnologias;
check('el fichero de parámetros declara las cuatro tecnologías',
      ['zigbee_pro_24', 'zigbee_std_24', 'lora_eu868', 'wisun_fan_863']
        .every(k => TEC[k]), Object.keys(TEC).filter(k => k[0] !== '_').join(', '));

/* ── UNA PLANTA DE JUGUETE, CON GEOMETRÍA CONOCIDA ──────────────────────────
   NCU — a — b, y de `b` cuelgan `c` y `d`. Articulaciones: `a` y `b`.
       si cae `a`  -> se quedan sin ruta b, c, d   (3)
       si cae `b`  -> se quedan sin ruta c, d      (2)
   SUMA 5, UNIÓN 3 {b, c, d}. Ese es exactamente el caso que separa una cosa de
   la otra, y por eso la planta de juguete está dibujada así.

   Y una nota que me toca escribir: la primera versión de este banco esperaba
   {a, c, d}. Estaba MAL —`a` no se queda sin ruta, cuelga de la NCU— y el banco
   lo dijo al primer intento. La expectativa estaba razonada de cabeza, no
   medida, que es el mismo error que el «>20°» del backtracking. */
const NODOS = [{ id: 'N' }, { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const CADENA = { 'N': ['a'], 'a': ['N', 'b'], 'b': ['a', 'c', 'd'], 'c': ['b'], 'd': ['b'] };
const enlazaCadena = (p, q) => ({ viable: (CADENA[p.id] || []).indexOf(q.id) >= 0, margenDb: 10 });

const r = RM.analiza(NODOS, enlazaCadena, ['N'], null);
check('la malla de juguete sale ÁRBOL, como se ha dibujado', r.esArbol, r.aristas + ' aristas');
check('las articulaciones son `a` y `b`', [...r.articulaciones].sort().join(',') === 'a,b',
      [...r.articulaciones].join(','));
check('sin camino alternativo son TRES nodos (b, c, d), por UNIÓN y no por suma',
      (r.sinAlternativa || []).slice().sort().join(',') === 'b,c,d',
      (r.sinAlternativa || []).join(','));
let suma = 0; r.aislaA.forEach(v => { suma += v; });
check('y la SUMA de `aislaA` da 5: por eso no vale sumar, doblaría a `c` y a `d`',
      suma === 5 && suma > (r.sinAlternativa || []).length,
      'suma=' + suma + ' union=' + (r.sinAlternativa || []).length);

/* ── EL COMPARADOR, CON LAS CUATRO TECNOLOGÍAS DE VERDAD ────────────────── */
const HORAS = [8, 12, 16];
// `enlazaDe` no mira la hora en este banco a propósito: aquí se comprueba la
// DISCIPLINA del comparador, no la física. La física tiene sus propios bancos.
const enlazaDe = () => enlazaCadena;
const tabla = RT.compara('juguete', NODOS, ['N'], TEC2(), HORAS, enlazaDe, null);

function TEC2() {
  const v = {};
  for (const k of ['zigbee_pro_24', 'zigbee_std_24', 'lora_eu868', 'wisun_fan_863']) v[k] = TEC[k];
  return v;
}
const fila = (k) => tabla.filas.find(f => f.criterio === k);

/* REGLA 1 · un hueco no se rellena */
for (const t of ['lora_eu868', 'wisun_fan_863', 'zigbee_std_24']) {
  const c = fila('tcu_cubiertas').celdas[t];
  check(t + ': sin sensibilidad NO sale número', c.valor === null && c.min === null, JSON.stringify(c.valor));
  check('  y dice qué le falta', /falta .*rx_sens_dbm/.test(c.motivo || ''), c.motivo);
}
check('zigbee_pro_24 SÍ sale, que es el que tiene los parámetros',
      fila('tcu_cubiertas').celdas.zigbee_pro_24.min === 4,
      JSON.stringify(fila('tcu_cubiertas').celdas.zigbee_pro_24));
check('y `0` cuenta como valor, no como hueco: no se mira la veracidad sino `== null`',
      RT.loQueFalta({ f_hz: 0, ptx_dbm: 0, gtx_dbi: 0, grx_dbi: 0, rx_sens_dbm: 0 },
                    'tcu_cubiertas').length === 0);

/* EL CRITERIO QUE DECIDIRÍA EL RANKING, Y QUE NO TIENE NADIE */
const lat = fila('latencia_stow');
check('la latencia de stow NO sale para NINGUNA tecnología',
      Object.keys(lat.celdas).every(t => lat.celdas[t].valor === null));
check('  y el motivo nombra el tiempo por salto',
      /t_salto_s/.test(lat.celdas.zigbee_pro_24.motivo || ''), lat.celdas.zigbee_pro_24.motivo);
check('  y su veredicto es «no comparable», no un empate', lat.veredicto.estado === 'no_comparable',
      lat.veredicto.texto);

/* REGLA 2 · no hay índice único */
const plano = JSON.stringify(tabla);
check('la salida NO trae ninguna puntuación agregada',
      !/"(puntuacion|score|ranking|indice|total|nota)"\s*:/i.test(plano),
      (plano.match(/"(puntuacion|score|ranking|indice|total|nota)"\s*:/i) || [])[0]);
check('ninguna fila se llama «resumen» ni «global»',
      tabla.filas.every(f => !/resumen|global|conjunto/i.test(f.criterio)));

/* REGLA 3 · a varias horas, no a una */
let paro = false, msg = '';
try { RT.compara('x', NODOS, ['N'], TEC2(), [12], enlazaDe, null); }
catch (e) { paro = true; msg = String(e.message); }
check('con UNA sola hora, el comparador se para', paro, 'no se paró');
check('  y el mensaje dice por qué (los 27,8 dB de la hora)', /27,8 dB|hora/.test(msg), msg);
check('la tabla publica a qué horas se ha evaluado', tabla.horas.length === 3);

/* EL VEREDICTO: solape contra dominio, sin desempates */
const A = { min: 10, max: 20 }, B = { min: 15, max: 30 }, C = { min: 40, max: 50 };
check('recorridos que se solapan -> «no distinguible con lo medido»',
      RT.veredicto('tcu_cubiertas', { a: A, b: B }).estado === 'no_distinguible',
      RT.veredicto('tcu_cubiertas', { a: A, b: B }).texto);
check('  y el texto lo dice con esas palabras',
      /no distinguible con lo medido/.test(RT.veredicto('tcu_cubiertas', { a: A, b: B }).texto));
check('un recorrido entero por encima -> gana, y se nombra',
      RT.veredicto('tcu_cubiertas', { a: A, c: C }).gana === 'c',
      RT.veredicto('tcu_cubiertas', { a: A, c: C }).texto);
check('donde menos es mejor, gana el de abajo',
      RT.veredicto('saltos_max', { a: A, c: C }).gana === 'a',
      RT.veredicto('saltos_max', { a: A, c: C }).texto);
check('si a una le falta el dato, NO se compara a las otras dos por su cuenta',
      RT.veredicto('tcu_cubiertas', { a: A, c: C, z: { min: null, max: null } }).estado === 'no_comparable');
check('la legalidad no se ordena en un número, y se dice',
      RT.veredicto('legalidad', { a: A, c: C }).estado === 'no_comparable',
      RT.veredicto('legalidad', { a: A, c: C }).texto);

/* Y EL ÁRBOL, que es el aviso de `analiza()` llevado a la tabla */
check('en una malla ÁRBOL, «sin camino alternativo» avisa de que no distingue',
      /ÁRBOL/.test(fila('tcu_sin_alternativa').celdas.zigbee_pro_24.motivo || ''),
      fila('tcu_sin_alternativa').celdas.zigbee_pro_24.motivo);

/* CADA CRITERIO DECLARA LO SUYO */
check('los ocho criterios declaran qué parámetros necesitan',
      Object.keys(RT.EXIGE).every(k => Array.isArray(RT.EXIGE[k]) && RT.EXIGE[k].length),
      Object.keys(RT.EXIGE).length + ' criterios');
check('y todos tienen rótulo y sentido de «mejor»',
      Object.keys(RT.EXIGE).every(k => RT.ROTULO[k] && (k in RT.MEJOR_ES_MAS)));
check('un criterio que no declare nada no puede salir callando',
      RT.loQueFalta({}, 'inventado').length === 1);


/* LA HORA: CUANDO LA TABLA NO SE ENTERA, HAY QUE DECIR POR QUÉ ─────────────
   «Ningún criterio varía» se lee como «la hora da igual», y es falso: en El
   Burgo entran y salen 1.086 pares (8,1 %) entre la mejor y la peor hora. Lo que
   pasa es que estos criterios están SATURADOS con Zigbee. La tabla lo lleva
   encima, no en una nota al pie, porque en cuanto entren LoRa y Wi-SUN dejarán
   de estarlo. */
check('la tabla dice si la hora la mueve o no', !!tabla.saturacion);
check('  y con esta malla de juguete sale SATURADA', tabla.saturacion.saturada === true,
      JSON.stringify(tabla.saturacion.conDato));
check('  y el texto aclara que NO es que la hora dé igual',
      /NO significa que la hora dé igual/.test(tabla.saturacion.texto));
check('  con la medida al lado, no como opinión',
      /1\.086 pares/.test(tabla.saturacion.texto) && /8,1 %/.test(tabla.saturacion.texto));
check('  y dice que con LoRa y Wi-SUN dejará de estar saturada',
      /LoRa y Wi-SUN/.test(tabla.saturacion.texto) && /Fresnel/.test(tabla.saturacion.texto));
check('si algún criterio SÍ varía, no se declara saturada',
      RT.compara('x', NODOS, ['N'], TEC2(), HORAS, (v, h) => (p, q) =>
        ({ viable: (CADENA[p.id] || []).indexOf(q.id) >= 0 && !(h === 12 && q.id === 'd'), margenDb: 10 }),
        null).saturacion.saturada === false);

/* ── LA SENSIBILIDAD DEL VEREDICTO AL MÓDULO ────────────────────────────────
   La elección del módulo cambia el veredicto, así que la comparación se corre
   con el mejor candidato de cada tecnología y con el peor. Lo que este banco
   vigila es que con MENOS DE DOS candidatos NO se diga «no depende del módulo»:
   eso sería convertir «no lo he podido mirar» en «lo he mirado y no cambia»,
   que es el error simétrico de todo este repo. */
const SIN = RT.sensibilidadAlModulo('juguete', NODOS, ['N'],
  { a: [TEC.zigbee_pro_24], b: [TEC.lora_eu868] }, HORAS, enlazaDe, null);
check('con UN solo candidato por tecnología, la sensibilidad NO se declara medida',
      SIN.medible === false, JSON.stringify(SIN.medible));
check('  y el motivo dice que no es lo mismo que no depender del módulo',
      /no es lo mismo/.test(SIN.motivo || ''), SIN.motivo);

/* Dos módulos de mentira, con presupuestos distintos a propósito: uno con 8 dB
   más que el otro, que es justo la diferencia que el encargo pone de ejemplo
   entre un SX1262 a 22 dBm y un módulo a 14. */
const mod = (ptx, sens) => ({ f_hz: 2.45e9, ptx_dbm: ptx, gtx_dbi: 3, grx_dbi: 3, rx_sens_dbm: sens });
check('el presupuesto de enlace sale de ptx + ganancias − sensibilidad',
      RT.presupuesto(mod(22, -103)) === 22 + 3 + 3 + 103, RT.presupuesto(mod(22, -103)));
check('un parámetro que falta deja el presupuesto en null, no en un número',
      RT.presupuesto({ ptx_dbm: 22, gtx_dbi: 3, grx_dbi: 3, rx_sens_dbm: null }) === null);
const ex = RT.extremos([mod(14, -103), mod(22, -103), mod(20, -100)]);
check('y el mejor y el peor candidato salen de ese orden, con sus dB',
      ex.mejorDb - ex.peorDb === 8, ex.peorDb + ' a ' + ex.mejorDb);
const CON = RT.sensibilidadAlModulo('juguete', NODOS, ['N'],
  { a: [mod(14, -103), mod(22, -103)], b: [mod(10, -95), mod(12, -95)] },
  HORAS, enlazaDe, null);
check('con dos candidatos por tecnología, la sensibilidad SÍ se mide',
      CON.medible === true);
check('  y publica el veredicto con el mejor y con el peor, criterio a criterio',
      CON.filas.length === tabla.filas.length &&
      CON.filas.every(f => f.conElMejor && f.conElPeor));
check('  y dice si alguno CAMBIA, que es lo que se quería saber',
      typeof CON.cambiaAlguno === 'boolean');
check('  y dice por qué eje ordena, y cuál NO entra (consumo, certificación)',
      /consumo/.test(CON._orden) && /certificaci/.test(CON._orden), CON._orden);

/* Y que el fichero de parámetros traiga el hueco de los candidatos, vacío y
   dicho: un hueco declarado se rellena; uno que no existe, no. */
for (const t of ['lora_eu868', 'wisun_fan_863']) {
  const c = TEC[t].candidatos;
  check(t + ' declara su lista de candidatos y su estado',
        c && Array.isArray(c.lista) && typeof c._estado === 'string', JSON.stringify(!!c));
}
const lcalc = TEC.lora_eu868.candidatos.variantes_calculables || [];
const wcalc = TEC.wisun_fan_863.candidatos.variantes_calculables || [];
check('LoRa ya tiene al menos 3 módulos de datasheet', TEC.lora_eu868.candidatos.lista.length >= 3,
      TEC.lora_eu868.candidatos.lista.length);
check('LoRa expande al menos 4 variantes de balance calculables', lcalc.length >= 4, lcalc.length);
check('Wi-SUN expande al menos 10 variantes FSK calculables', wcalc.length >= 10, wcalc.length);
check('todas las variantes calculables tienen presupuesto de enlace completo',
      lcalc.concat(wcalc).every(v => RT.presupuesto(v) != null));
check('sub-GHz usa una antena propia, no hereda los 3 dBi de Zigbee',
      lcalc.concat(wcalc).every(v => v.gtx_dbi === 2 && v.grx_dbi === 2));
check('los TI no se renombran Wi-SUN si su hoja no lo declara',
      wcalc.every(v => v.fabricante === 'Silicon Labs'),
      [...new Set(wcalc.map(v => v.fabricante))].join(','));
check('LoRa SF12 y SF7 llevan las tasas vigentes del RP002-1.0.5',
      lcalc.filter(v => v.sf === 12).every(v => v.tasa_bps === 250) &&
      lcalc.filter(v => v.sf === 7).every(v => v.tasa_bps === 5470));
check('el perfil LoRa de referencia usa 868,3 MHz y 16 dBm EIRP por defecto',
      TEC.lora_eu868.perfil_referencia.lorawan.canales_por_defecto_mhz.includes(868.3) &&
      TEC.lora_eu868.perfil_referencia.lorawan.max_eirp_default_dbm === 16);
check('Wi-SUN EU1 asigna plan 32 a #1a y 33 a #2a/#3',
      wcalc.every(v => (String(v.modo).includes('#1a') && v.channel_plan_id === 32) ||
                       ((String(v.modo).includes('#2a') || String(v.modo).includes('#3')) &&
                        v.channel_plan_id === 33)));

/* ── LAS DOS TASAS, Y QUIÉN MANDA ────────────────────────────────────────
   `tasa_bps` es la capacidad de la RADIO —lo único comparable entre
   tecnologías— y `tasa_serie_bps` el puerto Modbus de la TCU, un límite del
   sistema. Lo que este criterio tiene que aportar no es el porcentaje: es
   DECIR CUÁL MANDA, porque si manda el serie, comparar radios aquí no decide
   nada. Se prueba el veredicto contra casos hechos a mano para poder verlo en
   los dos sentidos hoy, sin depender de qué traiga el fichero. */
{
  const cel = (p, manda, ef) => ({ valor: p, min: p, max: p, manda, tasa_efectiva_bps: ef });
  console.log('\nlas dos tasas, y quién manda');

  check('el criterio EXIGE las dos tasas, no sólo la de la radio',
        RT.EXIGE.telemetria.includes('tasa_bps') && RT.EXIGE.telemetria.includes('tasa_serie_bps'),
        RT.EXIGE.telemetria);

  const todasSerie = RT.veredicto('telemetria',
    { a: cel(0.0611, 'serie', 19200), b: cel(0.0611, 'serie', 19200) });
  check('si manda el serie en TODAS, no dice «empate» a secas: dice por qué',
        todasSerie.mandaElSerie === true && /PUERTO SERIE/.test(todasSerie.texto), todasSerie.texto);
  check('y nombra la tasa que manda, para que se pueda comprobar',
        /19200/.test(todasSerie.texto), todasSerie.texto);

  // el control que impide que lo de arriba sea un «siempre dice lo mismo»
  const mixto = RT.veredicto('telemetria', { a: cel(0.05, 'radio', 9600), b: cel(0.0611, 'serie', 19200) });
  check('si NO manda el serie en todas, vuelve a comparar de verdad',
        mixto.estado === 'gana' && !mixto.mandaElSerie, mixto.estado);

  // y que no se aplique a un criterio que no es éste
  const otro = RT.veredicto('saltos_max', { a: cel(3, 'serie', 19200), b: cel(3, 'serie', 19200) });
  check('el atajo del serie NO se cuela en otros criterios',
        !otro.mandaElSerie && otro.estado === 'no_distinguible', otro.estado);

  // el fichero: las cuatro variantes traen el protocolo de la TCU, que no
  // cambia con la radio
  for (const t of ['zigbee_pro_24', 'zigbee_std_24', 'lora_eu868', 'wisun_fan_863']) {
    check(t + ' trae el puerto serie de la TCU, que no depende de la radio',
          TEC[t].tasa_serie_bps === 19200, TEC[t].tasa_serie_bps);
  }
  check('las dos de Zigbee traen la capacidad RF y es la misma',
        TEC.zigbee_pro_24.tasa_bps === 250000 && TEC.zigbee_std_24.tasa_bps === 250000);
  check('las dos de sub-giga NO se la inventan: va por SF y por modo PHY',
        TEC.lora_eu868.tasa_bps === null && TEC.wisun_fan_863.tasa_bps === null);
  check('y el 250 kbps va como `declarado`, NO como `norma`: nadie ha citado el IEEE',
        TEC.zigbee_pro_24._citas.tasa_bps.clase === 'declarado',
        TEC.zigbee_pro_24._citas.tasa_bps.clase);
}

/* ── EL ALCANCE ─────────────────────────────────────────────────────────── */
const PISO = 60, PISO_MUT = 7;
console.log('\nalcance: ' + tabla.filas.length + ' criterios · ' + tabla.tecnologias.length +
            ' tecnologías · ' + HORAS.length + ' horas · ' +
            Object.keys(MUTACIONES).length + ' mutaciones (piso ' + PISO_MUT + ')');
console.log('');
if (ko) { console.log('FALLAN ' + ko + ' de ' + (ok + ko) + ' comprobaciones'); process.exit(1); }
if (ok < PISO || Object.keys(MUTACIONES).length < PISO_MUT) {
  console.log('ALCANCE INSUFICIENTE: nada ha fallado, pero esto no ha mirado bastante (' +
              ok + ' de ' + PISO + ').');
  process.exit(2);
}
console.log('TODO OK — ' + ok + ' comprobaciones');
