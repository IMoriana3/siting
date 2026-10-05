// LA FILA DE «LEGALIDAD EN ESPAÑA» — y la trampa de la unidad.
//
// Esta fila llevaba desde su nacimiento diciendo «no se puede», y NO por un
// hueco: por dos averías distintas, las dos encontradas el 2026-10-03.
//
//   1. PEDÍA CAMPOS QUE NO EXISTEN. `EXIGE.legalidad` exigía `norma`,
//      `erp_max_dbm` y `ciclo_trabajo`. Ninguno de los tres está en
//      `radio_params.json`, ni ha estado nunca. El régimen regulatorio SÍ
//      está —`regimen_regulatorio_eu` a 2,4 GHz, `ciclo_trabajo_eu` a 868—,
//      así que la fila callaba un dato que tenía delante.
//
//   2. NO SE CALCULABA. El criterio declaraba qué necesitaba y nadie rellenaba
//      nunca la celda, así que aunque los campos hubieran existido, la fila
//      habría salido igual de muda.
//
// Y LA TRAMPA, que es lo que de verdad vigila este banco: LAS DOS NORMAS NO
// DAN LA POTENCIA EN LA MISMA UNIDAD.
//
//     EN 300 328   (2,4 GHz)   20 dBm   e.i.r.p.   referida a la ISOTRÓPICA
//     EN 300 220-2 (868 MHz)   25 mW    e.r.p.     referida al DIPOLO
//
//     e.i.r.p. = e.r.p. + 2,15 dB    (ganancia del dipolo de media onda)
//
// El campo que el criterio exigía se llamaba `erp_max_dbm`. Meter ahí los
// 20 dBm e.i.r.p. de una norma junto a los 14 dBm e.r.p. de la otra habría
// comparado isotrópica contra dipolo: 2,15 dB de error, CALLADO, en la fila que
// dice si algo es legal. Misma clase de avería que el `slice(-n)` de la tabla —
// un número que parece bien y está mal.
//
// Las reglas, cada una con su mutación:
//
//   1. la unidad se convierte      · e.r.p. + 2,15 dB antes de comparar
//   2. el solape, por lo bajo      · P y Q comparten 869,7-870,0 con 5 y 25 mW
//   3. un hueco envuelto es hueco  · `canal.valor` null NO es «canal puesto»
//   4. la celda se calcula         · declarar qué falta no es rellenarla
//   5. la ganancia cuenta          · lo radiado es ptx + gtx, no ptx
//
//   node tests/test_legalidad.js
//   MUTA=<clave> node tests/test_legalidad.js      (TIENE que salir rojo)
//
// rc = 0 mide · 1 rojo · 2 no comprobado
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
let ok = 0, ko = 0;
const check = (n, cond, extra) => {
  if (cond) { ok++; console.log('OK   ' + n); }
  else { ko++; console.log('FAIL ' + n + (extra !== undefined ? ' -> ' + extra : '')); }
};
const cerca = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.01 : tol);

/* ── MUTACIONES ─────────────────────────────────────────────────────────── */
const MUTACIONES = {
  // LA TRAMPA: compara e.r.p. contra e.i.r.p. sin convertir. 2,15 dB de regalo
  // en la fila que dice si algo es legal.
  confundeErpConEirp: ['radio_tecnologias.js',
    'return { dbm: erpDbm + DIPOLO_DBI, unidad_leida: "e.r.p.",',
    'return { dbm: erpDbm, unidad_leida: "e.r.p.",'],
  // en el solape se queda con la sub-banda MÁS GENEROSA: 5 mW pasa a 25 mW,
  // o sea 7 dB de límite que la norma no da ahí
  cogeElSolapeGeneroso: ['radio_tecnologias.js',
    'if (elegida == null || b.erp_max_mw < elegida.erp_max_mw) elegida = b;',
    'if (elegida == null || b.erp_max_mw > elegida.erp_max_mw) elegida = b;'],
  // EL HUECO ENVUELTO. `canal` es un OBJETO cuyo `valor` está a `null`, así que
  // pedir la clave pelada da «está puesto» con el canal sin saber — y el canal
  // decide el límite («Canal 26: máx +3» contra los +19 declarados).
  //
  // OJO, QUE AQUÍ ME EQUIVOQUÉ PRIMERO: mutar `valorDe(variante, rutas[j])` a
  // `variante[rutas[j]]` NO reproduce la avería, porque `variante["canal.valor"]`
  // es `undefined` y el hueco se sigue viendo. La mutación se quedaba VERDE
  // midiendo nada. La avería de verdad es que EXIGE pida `canal` en vez de
  // `canal.valor`, y así es como se reproduce. Medido el 2026-10-03.
  canalEnvueltoCuela: ['radio_tecnologias.js',
    'legalidad:           ["regimen_eu", "ptx_dbm", "gtx_dbi", "canal.valor"]',
    'legalidad:           ["regimen_eu", "ptx_dbm", "gtx_dbi", "canal"]'],
  // y la otra mitad de la misma guarda: que `valorDe` deje de bajar por la ruta
  sinRutaConPuntos: ['radio_tecnologias.js',
    '    var partes = String(ruta).split("."), v = variante;',
    '    var partes = [String(ruta)], v = variante;'],
  // la avería original: el criterio declara qué necesita y la celda no se
  // rellena nunca
  legalidadNoSeCalcula: ['radio_tecnologias.js',
    'if (!out.legalidad) out.legalidad = legalidadDe(variante);',
    'if (false) out.legalidad = legalidadDe(variante);'],
  // lo radiado se toma como la potencia conducida, sin la antena
  sinGananciaEnLaRadiada: ['radio_tecnologias.js',
    'var eirp = variante.ptx_dbm + variante.gtx_dbi;',
    'var eirp = variante.ptx_dbm;'],
};

const MUTA = process.env.MUTA;
let restaurar = null;
if (MUTA) {
  const m = MUTACIONES[MUTA];
  if (!m) { console.error('MUTA desconocida: ' + MUTA + ' (hay: ' + Object.keys(MUTACIONES).join(', ') + ')'); process.exit(2); }
  const f = path.join(RAIZ, m[0]);
  const antes = fs.readFileSync(f, 'utf8');
  if (!antes.includes(m[1])) {
    console.error('la mutación «' + MUTA + '» no encaja en ' + m[0] + ': el texto a sustituir ya no está.');
    console.error('NO se ha medido nada. Arregla la mutación o el banco.');
    process.exit(2);
  }
  fs.writeFileSync(f, antes.replace(m[1], m[2]));
  restaurar = () => fs.writeFileSync(f, antes);
  console.log('── MUTADO: ' + MUTA + ' (' + m[0] + ') — este banco TIENE que salir rojo ──\n');
}
function fin() {
  if (restaurar) restaurar();
  console.log('\n' + ok + ' ok · ' + ko + ' fail');
  if (ko > 0) { console.log('ROJO'); process.exit(1); }
  console.log('MIDE'); process.exit(0);
}

let R, TEC;
try {
  delete require.cache[require.resolve(path.join(RAIZ, 'radio_tecnologias.js'))];
  R = require(path.join(RAIZ, 'radio_tecnologias.js'));
  TEC = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8')).tecnologias;
} catch (e) {
  console.error('no se ha podido cargar el motor o el JSON: ' + e.message);
  if (restaurar) restaurar();
  process.exit(2);
}
const clona = (o) => JSON.parse(JSON.stringify(o));

/* ── 1 · LO QUE EXIGE EL CRITERIO EXISTE EN EL FICHERO ──────────────────── */
// La avería nº 1: pedía tres campos inexistentes. Esto lo impide para siempre.
const EXIGE_LEG = R.EXIGE.legalidad;
check('el criterio declara qué necesita', Array.isArray(EXIGE_LEG) && EXIGE_LEG.length > 0);
const FANTASMAS = ['norma', 'erp_max_dbm', 'ciclo_trabajo'];
check('ya no exige los tres campos fantasma',
      !EXIGE_LEG.some(x => FANTASMAS.indexOf(x) >= 0), JSON.stringify(EXIGE_LEG));
// CADA REQUISITO TIENE QUE SER UNA RUTA QUE EXISTA EN EL ESQUEMA, aunque su
// valor esté pendiente. Eso distingue las dos cosas que la avería original
// confundía:
//
//   · `canal.valor` -> el objeto `canal` ESTÁ en el fichero y su `valor` está a
//     `null` porque nadie ha leído el canal todavía. Requisito legítimo: hay
//     dónde ponerlo, y la fila dice que falta.
//   · `erp_max_dbm` -> no es clave de nada, en ninguna variante. Pedirlo es
//     pedir un sitio que no existe, y la fila nunca podrá encenderse.
//
// Así que lo que se exige aquí es que el CONTENEDOR exista en alguna variante,
// no que el valor esté puesto.
const VARIANTES = ['zigbee_pro_24', 'zigbee_std_24', 'lora_eu868', 'wisun_fan_863'];
const contenedorExiste = (v, ruta) => {
  const partes = String(ruta).split('.');
  let o = TEC[v];
  for (let i = 0; i < partes.length - 1; i++) {
    if (o == null || typeof o !== 'object') return false;
    o = o[partes[i]];
  }
  return o != null && typeof o === 'object' &&
         Object.prototype.hasOwnProperty.call(o, partes[partes.length - 1]);
};
for (const req of EXIGE_LEG) {
  const rutas = R.ALTERNATIVAS[req] || [req];
  const alguna = VARIANTES.some(v => rutas.some(r => contenedorExiste(v, r)));
  check('el requisito «' + req + '» es una ruta que existe en el esquema', alguna);
}
// y el control negativo: los tres fantasmas NO pasan esa prueba. Si pasaran,
// la comprobación de arriba no estaría midiendo nada.
for (const f of FANTASMAS) {
  check('el fantasma «' + f + '» no existe en ninguna variante',
        !VARIANTES.some(v => contenedorExiste(v, f)));
}

/* ── 2 · EL RÉGIMEN SE ENCUENTRA BAJO LOS DOS NOMBRES ───────────────────── */
// 2,4 GHz y 868 MHz guardan el régimen con claves distintas porque son normas
// distintas. El criterio tiene que dar por bueno cualquiera de las dos.
check('a 2,4 GHz se encuentra el régimen',
      R.valorDe(TEC.zigbee_pro_24, 'regimen_regulatorio_eu') != null);
check('a 868 MHz se encuentra el régimen',
      R.valorDe(TEC.lora_eu868, 'ciclo_trabajo_eu') != null);
check('«regimen_eu» NO figura como que falta en Zigbee',
      R.loQueFalta(TEC.zigbee_pro_24, 'legalidad').indexOf('regimen_eu') < 0,
      JSON.stringify(R.loQueFalta(TEC.zigbee_pro_24, 'legalidad')));
check('«regimen_eu» NO figura como que falta en LoRa',
      R.loQueFalta(TEC.lora_eu868, 'legalidad').indexOf('regimen_eu') < 0,
      JSON.stringify(R.loQueFalta(TEC.lora_eu868, 'legalidad')));

/* ── 3 · UN HUECO ENVUELTO EN UN OBJETO SIGUE SIENDO UN HUECO ───────────── */
// `canal` es `{valor: null, procedencia: "pendiente", _ojo: [...]}`. Mirar la
// clave pelada da «está puesto». Y el canal decide el límite: el comentario del
// modelo congelado dice «Canal 26: máx +3» frente a los +19 declarados.
/* EL CANAL YA SE LEYÓ (2026-10-05, del `zigbee_state` de los dos gateways de
   San José NCU 18: 15 y 19). Así que `zigbee_pro_24` ya NO sirve de ejemplo de
   hueco envuelto — y la regla que protegía sigue viva, sólo que ahora se mide
   EN LAS DOS DIRECCIONES, que es más de lo que medía antes:
     · con el canal puesto, el criterio NO lo pide;
     · con el canal a null dentro de un objeto que existe, SÍ lo pide. */
check('el canal de Zigbee PRO ya está leído', R.valorDe(TEC.zigbee_pro_24, 'canal.valor') != null,
      R.valorDe(TEC.zigbee_pro_24, 'canal.valor'));
check('  y es uno de los dos medidos en planta, 15 o 19',
      [15, 19].indexOf(R.valorDe(TEC.zigbee_pro_24, 'canal.valor')) >= 0,
      R.valorDe(TEC.zigbee_pro_24, 'canal.valor'));
check('  y NO es el 26, que era el que costaba 16 dB',
      R.valorDe(TEC.zigbee_pro_24, 'canal.valor') !== 26);
check('con el canal puesto, el criterio ya no lo pide',
      R.loQueFalta(TEC.zigbee_pro_24, 'legalidad').indexOf('canal.valor') < 0,
      JSON.stringify(R.loQueFalta(TEC.zigbee_pro_24, 'legalidad')));

/* LA OTRA DIRECCIÓN, con una variante construida a propósito: un `canal` que
   existe como objeto pero con el `valor` a null. Es el caso que hacía colar el
   hueco antes de que `loQueFalta` bajara por rutas con puntos. */
const sinCanal = clona(TEC.zigbee_pro_24);
sinCanal.canal = { valor: null, procedencia: 'pendiente', _ojo: ['construido por el banco'] };
check('un `canal` cuyo `valor` es null SÍ se pide', 
      R.loQueFalta(sinCanal, 'legalidad').indexOf('canal.valor') >= 0,
      JSON.stringify(R.loQueFalta(sinCanal, 'legalidad')));
check('  aunque el objeto `canal` exista, que es lo que lo hacía colar',
      sinCanal.canal != null);
check('valorDe baja por la ruta con puntos', R.valorDe({ a: { b: 7 } }, 'a.b') === 7);
check('valorDe no se rompe con la rama ausente', R.valorDe({}, 'a.b.c') === null);
check('valorDe trata el 0 como PUESTO (0 dBm es una potencia)',
      R.valorDe({ a: { b: 0 } }, 'a.b') === 0);

/* ── 4 · ZIGBEE: LA NORMA DA e.i.r.p., NO SE CONVIERTE NADA ─────────────── */
const zb = clona(TEC.zigbee_pro_24);
zb.canal = { valor: 15, procedencia: 'SINTÉTICO, sólo para ejercitar la cuenta' };
const Lzb = R.limiteEirp(zb);
check('a 2,4 GHz hay límite', Lzb != null);
check('y la norma ya lo da en e.i.r.p.', Lzb.unidad_leida === 'e.i.r.p.', Lzb.unidad_leida);
check('no se convierte nada', Lzb.convertido === false);
check('el límite son 20 dBm', Lzb.dbm === 20, Lzb.dbm);
check('y trae la cláusula', Lzb.clausula === '4.3.2.2.3', Lzb.clausula);
const Czb = R.legalidadDe(zb);
check('la radiada es ptx + gtx = 19 + 3', Czb.eirp_declarada_dbm === 22, Czb.eirp_declarada_dbm);
check('el margen es -2 dB', cerca(Czb.margen_db, -2), Czb.margen_db);
check('y con ese punto de trabajo el veredicto es NO CUMPLE',
      Czb.valor === 'NO CUMPLE', Czb.valor);
check('la celda dice que la radiada es derivada', /SIN pérdidas/.test(Czb._eirp_es_derivada));

/* ── 5 · 868: LA CONVERSIÓN, QUE ES LA TRAMPA ──────────────────────────── */
const base868 = clona(TEC.lora_eu868);
base868.gtx_dbi = 2; base868.ptx_dbm = 14;
base868.canal = { valor: 1, procedencia: 'SINTÉTICO, sólo para ejercitar la cuenta' };

const L868 = R.limiteEirp(Object.assign(clona(base868), { f_hz: 868.1e6 }));
check('a 868,1 MHz hay límite', L868 != null);
check('y la norma lo da en e.r.p.', L868.unidad_leida === 'e.r.p.', L868.unidad_leida);
check('se declara convertido', L868.convertido === true);
check('la sub-banda es la M', L868.sub_banda === 'M', L868.sub_banda);
check('25 mW e.r.p. son 13,98 dBm', cerca(L868.erp_dbm, 13.98), L868.erp_dbm);
check('y en e.i.r.p. son 16,13 dBm (los 2,15 del dipolo)',
      cerca(L868.dbm, 16.13), L868.dbm);
check('la constante del dipolo son 2,15 dB', R.DIPOLO_DBI === 2.15, R.DIPOLO_DBI);
// LA COMPROBACIÓN QUE MATA LA MUTACIÓN: la diferencia entre las dos unidades
// tiene que ser EXACTAMENTE la ganancia del dipolo, no cero.
check('e.i.r.p. - e.r.p. = 2,15 dB exactos, no 0',
      cerca(L868.dbm - L868.erp_dbm, R.DIPOLO_DBI, 1e-9),
      (L868.dbm - L868.erp_dbm));
check('la celda explica la conversión con su constante',
      /2\.15|2,15/.test(R.legalidadDe(Object.assign(clona(base868), { f_hz: 868.1e6 }))._limite_convertido));

/* ── 6 · EL SOLAPE SE RESUELVE POR LO BAJO ─────────────────────────────── */
// 869,7-870,0 MHz lo comparten la sub-banda P (5 mW) y la Q (25 mW). Quedarse
// con la generosa son 7 dB que la norma no da ahí.
const Lsol = R.limiteEirp(Object.assign(clona(base868), { f_hz: 869.8e6 }));
check('en el solape hay límite', Lsol != null);
check('se coge la MÁS RESTRICTIVA: 5 mW, no 25', Lsol.erp_max_mw === 5, Lsol.erp_max_mw);
check('o sea 9,14 dBm e.i.r.p. y no 16,13', cerca(Lsol.dbm, 9.14), Lsol.dbm);
check('la diferencia entre coger una u otra son ~7 dB (por eso importa)',
      cerca(16.13 - 9.14, 6.99, 0.02));

/* ── 7 · LA SUB-BANDA SE ELIGE POR FRECUENCIA, NUMÉRICAMENTE ────────────── */
check('869,5 MHz cae en la P de 500 mW',
      R.limiteEirp(Object.assign(clona(base868), { f_hz: 869.5e6 })).erp_max_mw === 500);
check('863,5 MHz cae en la K', R.limiteEirp(Object.assign(clona(base868), { f_hz: 863.5e6 })).banda === undefined
      || R.limiteEirp(Object.assign(clona(base868), { f_hz: 863.5e6 })).sub_banda === 'K');
check('fuera de banda NO hay límite inventado',
      R.limiteEirp(Object.assign(clona(base868), { f_hz: 2450e6 })) === null);
// y las 7 sub-bandas tienen que traer el rango en forma numérica
const sb = TEC.lora_eu868.ciclo_trabajo_eu.sub_bandas;
check('las 7 sub-bandas traen rango_hz', sb.length === 7 && sb.every(b => Array.isArray(b.rango_hz)),
      sb.length);
check('y rango_hz va rotulado como derivado del texto citado',
      sb.every(b => typeof b._rango_hz === 'string' && /DERIVADO/.test(b._rango_hz)));
check('cada rango_hz es creciente y cae en 863-870 MHz',
      sb.every(b => b.rango_hz[0] < b.rango_hz[1] && b.rango_hz[0] >= 863e6 && b.rango_hz[1] <= 870e6));

/* ── 8 · LA GANANCIA DE LA ANTENA ENTRA EN LA RADIADA ───────────────────── */
// Sin ella, un equipo con antena de 10 dBi pasaría por legal con la conducida
// al límite. Se mide con una antena grande, que es donde se ve.
const grande = clona(zb); grande.gtx_dbi = 10; grande.ptx_dbm = 8;
const Cg = R.legalidadDe(grande);
check('8 dBm conducidos + 10 dBi = 18 dBm radiados', Cg.eirp_declarada_dbm === 18, Cg.eirp_declarada_dbm);
check('y eso sí cumple los 20', Cg.valor === 'cumple', Cg.valor);
const enorme = clona(zb); enorme.gtx_dbi = 16; enorme.ptx_dbm = 8;
const Ce = R.legalidadDe(enorme);
check('8 dBm + 16 dBi = 24 dBm radiados', Ce.eirp_declarada_dbm === 24, Ce.eirp_declarada_dbm);
check('y eso NO cumple, aunque la conducida sea baja', Ce.valor === 'NO CUMPLE', Ce.valor);

/* ── 9 · EL BORDE: MARGEN CERO CUMPLE ──────────────────────────────────── */
const justo = clona(zb); justo.ptx_dbm = 17; justo.gtx_dbi = 3;
const Cj = R.legalidadDe(justo);
check('20 dBm exactos dan margen 0', Cj.margen_db === 0, Cj.margen_db);
check('y margen 0 CUMPLE (el límite es «hasta», no «por debajo de»)',
      Cj.valor === 'cumple', Cj.valor);

/* ── 10 · LA CELDA SE RELLENA DE VERDAD, EN LA TABLA ───────────────────── */
// La avería nº 2. Que la función esté bien no prueba que `unaTecnologia` la
// llame; eso sólo se ve mirando la celda que sale de la tabla.
const fuente = fs.readFileSync(path.join(RAIZ, 'radio_tecnologias.js'), 'utf8');
check('`unaTecnologia` llama a legalidadDe',
      /if \(!out\.legalidad\) out\.legalidad = legalidadDe\(variante\);/.test(fuente));
// y extremo a extremo: con el canal puesto, la celda trae veredicto; sin él, motivo
const conCanal = R.legalidadDe(zb);
check('con el canal puesto, la celda trae veredicto', conCanal.min != null, conCanal.min);
const faltaSin = R.loQueFalta(sinCanal, 'legalidad');
check('sin el canal, el criterio lo NOMBRA en vez de callarse',
      faltaSin.length === 1 && faltaSin[0] === 'canal.valor', JSON.stringify(faltaSin));
check('y con él puesto, Zigbee PRO ya no tiene nada que pedir para la legalidad',
      R.loQueFalta(TEC.zigbee_pro_24, 'legalidad').length === 0,
      JSON.stringify(R.loQueFalta(TEC.zigbee_pro_24, 'legalidad')));

fin();
