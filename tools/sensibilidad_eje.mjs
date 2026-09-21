/* SENSIBILIDAD A LA ALTURA DEL EJE — las 49 medidas de El Burgo.
   Hay TRES valores en circulacion y ninguno esta medido:
     2,00  terreno.html/seguidor.js `postH`   (eje)
     1,50  cobertura-rf-fv `HTUBE`            (eje, etiquetado «catalogo» sin cita)
     1,50  Siting `RF_ANT_H`                  (ANTENA, heredada)
   Con la antena DERIVADA del eje (eje - 0,225·cos a - 0,50), no fijada. */
import fs from 'fs'; import path from 'path'; import vm from 'vm';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const RAIZ = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const R = require(path.join(RAIZ, 'radio_pv_model.js'));
const ZB = require(path.join(RAIZ, 'radio_zigbee.js'));
const GEOJSON = path.join(RAIZ, '..', 'Cobertura-Zigbee', 'elburgo_real.geojson');
const CUERDA = 2.382, RA = 0.225, CA = 0.50;

const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const gen = fs.readFileSync(path.join(RAIZ, 'tools', 'gen_siting.mjs'), 'utf8');
const srcUtm = gen.match(/function utm\(lat, lon, zona, sur\) \{[\s\S]*?\n\}/)[0];
const srcRows = html.match(/function rfRows\(\)\{[\s\S]*?\n}\n/)[0];
const BURGO = JSON.parse(html.match(/^const BURGO=(\{[\s\S]*?\});$/m)[1]);
const motors = BURGO.tcus.map((t, i) => ({ id: 'T' + i, x: t[0], y: t[1], len: t[6], wid: t[7], az: t[8] }));
const ctx = { S: { bifila: BURGO.bifila || null, motors, p: { tlen: 100, twid: 12 } }, Math };
vm.createContext(ctx);
vm.runInContext(srcUtm + '\n' + srcRows + '\nvar __R = rfRows();', ctx);
const ROWS = ctx.__R;

const G = JSON.parse(fs.readFileSync(GEOJSON, 'utf8'));
const zona = Math.floor((BURGO.lon + 180) / 6) + 1;
const local = c => { const [E, N] = ctx.utm(c[1], c[0], zona, false); return [E - BURGO.ox, N - BURGO.oy]; };
const enlaces = [];
for (const f of G.features) {
  if (f.geometry.type !== 'LineString' || f.properties.rssi_medido_dbm == null) continue;
  const a = local(f.geometry.coordinates[0]), b = local(f.geometry.coordinates[1]);
  enlaces.push({ a, b, D: Math.hypot(a[0] - b[0], a[1] - b[1]), med: f.properties.rssi_medido_dbm });
}

function cruces(a, b, D, tilt, eje) {
  const ex = b[0] - a[0], ey = b[1] - a[1], segs = ROWS.segs, out = [];
  for (const s of segs) {
    const fx = s[2] - s[0], fy = s[3] - s[1];
    const den = ex * fy - ey * fx; if (Math.abs(den) < 1e-12) continue;
    const wx = s[0] - a[0], wy = s[1] - a[1];
    const t = (wx * fy - wy * fx) / den, u = (wx * ey - wy * ex) / den;
    /* CONTRATO NUEVO: geometria de la fila. El eje ya iba bien aqui. Y el `if`
       lleva LLAVES: sin ellas, meter una segunda sentencia deja la declaracion
       fuera del condicional y el modulo ni compila. */
    if (t > 0 && t < 1 && u >= 0 && u <= 1) {
      const senPhi = Math.abs(den) / (D * Math.hypot(fx, fy));
      out.push({ s: t * D, zEje: eje, cuerda: CUERDA, alpha: tilt, senPhi: senPhi });
    }
  }
  out.sort((p, q) => p.s - q.s);
  return out;
}
const PRO = JSON.parse(fs.readFileSync(path.join(RAIZ, 'radio_params.json'), 'utf8'));
const V = PRO.tecnologias.zigbee_pro_24;
const PROP = {
  eps_r_suelo: PRO.propagacion.eps_r_suelo.valor,
  sigma_suelo_s_m: PRO.propagacion.sigma_suelo_s_m.valor,
  polarizacion: PRO.propagacion.polarizacion.valor,
  sigma_db: PRO.propagacion.sigma_db.valor,
  vegetacion: { modelo: PRO.vegetacion.modelo.valor },
};
const est = v => { const s = [...v].sort((p, q) => p - q), n = s.length;
  return { n, media: v.reduce((x, y) => x + y, 0) / n, med: s[n >> 1], min: s[0], max: s[n - 1] }; };

console.log('El Burgo · 49 medidas · antena DERIVADA del eje (eje − 0,225·cos α − 0,50)\n');
console.log('   eje    alfa   antena    n    media   mediana     min      max');
const res = {};
for (const eje of [1.20, 1.50, 2.00]) {
  for (const tilt of [0, 30, 55]) {
    const ant = R.alturaAntenaTCU(eje, RA, CA, tilt);
    const dif = enlaces.map(e => ZB.presupuesto(
      { D: e.D, zA: ant, zB: ant, cruces: cruces(e.a, e.b, e.D, tilt, eje) }, V, PROP, null).prxDbm - e.med);
    const s = est(dif); res[eje + '_' + tilt] = s;
    console.log('  ' + eje.toFixed(2) + String(tilt).padStart(7) + '°' + ant.toFixed(3).padStart(9) +
      String(s.n).padStart(5) + s.media.toFixed(1).padStart(9) + s.med.toFixed(1).padStart(10) +
      s.min.toFixed(1).padStart(9) + s.max.toFixed(1).padStart(9));
  }
  console.log('');
}
console.log('ANTES Y DESPUES, en la media del careo:');
console.log('   alfa    eje 2,00   eje 1,50   eje 1,20   1,20 vs 2,00   1,20 vs 1,50');
for (const tilt of [0, 30, 55]) {
  const a = res['2_' + tilt].media, b = res['1.5_' + tilt].media, c = res['1.2_' + tilt].media;
  console.log('   ' + String(tilt).padStart(4) + '°' + a.toFixed(2).padStart(11) +
    b.toFixed(2).padStart(11) + c.toFixed(2).padStart(11) +
    (c - a).toFixed(2).padStart(15) + (c - b).toFixed(2).padStart(15) + '  dB');
}
/* VEGETACION. A 0,475 m del suelo deja de ser un detalle: la hierba y el
   matorral de pasillo entran en la primera zona de Fresnel. El motor NO la
   modela -`vegetacionDb` devuelve null sin modelo, a proposito- asi que lo que
   se barre aqui es LA SENSIBILIDAD, no una prediccion: cuanta perdida extra
   haria falta para mover el careo, por espesor atravesado. */
console.log('\nBARRIDO DE VEGETACION, sobre el eje 1,20 y alfa 30.');
console.log('Ojo: el motor NO modela vegetacion (vegetacionDb -> null sin modelo).');
console.log('Esto es cuanto moveria el careo una perdida por metro de follaje.\n');
console.log('   v (m)   0,5 dB/m   1,0 dB/m   2,0 dB/m   <- coeficientes de tanteo');
const base = res['1.2_30'].media;
for (const v of [0, 0.3, 0.6, 1.0]) {
  const f = k => (base - v * k).toFixed(2).padStart(11);
  console.log('   ' + v.toFixed(1).padStart(5) + f(0.5) + f(1.0) + f(2.0));
}
console.log('\n   El coeficiente NO esta medido ni citado: ITU-R P.833 es el candidato y');
console.log('   `radio_params.json` lo deja en null a proposito. Estos tres son TANTEO.');
