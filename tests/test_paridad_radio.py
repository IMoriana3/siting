#!/usr/bin/env python3
"""
test_paridad_radio.py — que `radio_pv_model.js` y `radio_pv_model.py` den el
MISMO número, caso a caso.

POR QUÉ. El visor predice en JS y la calibración ajusta en Python. Si los dos
no resuelven la misma geometría con las mismas ecuaciones, el ajuste calibra un
modelo que nadie usa y el mapa pinta un modelo que nadie ha ajustado. Este repo
ya se comió esa factura: dos cifras de sesgo conviviendo —−33,6 en el canon de
Siting y −16,58 en cobertura-rf-fv— sin que ninguna reprodujera a la otra.

CÓMO. Los casos los genera ESTE fichero y se le pasan a los dos motores como
DATOS. No hay generador aleatorio replicado en los dos lados: un banco que
tuviera que mantener en paridad hasta el RNG estaría comprobando el RNG.

El JS se ejecuta DE VERDAD, con node, sobre el fichero del repo. No se
reimplementa aquí «lo que hace el JS»: eso no sería paridad, sería mi opinión
sobre el JS. Es el mismo mecanismo con el que SolarGPTfull tiene pinchado el
modelo antiguo contra factiun_core.rf.

    python3 tests/test_paridad_radio.py
    MUTA=<clave> python3 tests/test_paridad_radio.py   (TIENE que salir rojo)
"""
from __future__ import annotations
import json, math, os, re, subprocess, sys, tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)

# ── MUTACIONES ─────────────────────────────────────────────────────────────
# Rompen la paridad por UN lado. Si el banco sigue verde con una puesta, es que
# no estaba comparando ese trozo. Se aplican sobre una COPIA: los ficheros del
# repo no se tocan.
MUTACIONES = {
    # la constante de espacio libre se desvía 0,01 dB en Python: el banco tiene
    # que cazar incluso una diferencia que a ojo no se ve
    "py_fspl_001":    ("py", r'- 147\.55$', '- 147.56'),
    # ── LA ANTENA DE LA TCU, por los dos lados ──────────────────────────────
    # el anclaje deja de girar SOLO en Python: vuelve la cota fija
    "py_ancla_fija":  ("py", r'return \{"dz": -radio_m \* math\.cos\(a\), "lateral": radio_m \* math\.sin\(a\)\}',
                              'return {"dz": -radio_m, "lateral": 0.0}'),
    # el lateral se pierde SOLO en JS: es el que decide por que lado sale el rayo
    "js_sin_lateral": ("js", r'lateral: r \* Math\.sin\(a\)', 'lateral: 0'),
    # el patron se aplana SOLO en Python
    "py_patron_iso":  ("py", r'f = math\.cos\(\(math\.pi / 2\) \* math\.sin\(elev_rad\)\) / c',
                              'f = 1.0'),
    # el campo cercano deja de depender de lambda SOLO en JS: a 868 MHz la misma
    # geometria esta MAS cerca en longitudes de onda, y eso es justo lo que no
    # se puede perder al bajar de banda
    "js_cerca_fija":  ("js", r'return \{ cerca: d < u \* lam,', 'return { cerca: d < u * 0.1224,'),
    # el corte con el panel colapsa a la banda SOLO en JS: el borde vuelve al eje
    "js_panel_eje":   ("js", r'borde: zEje \+ wB2 \* Math\.tan\(a\),', 'borde: zEje,'),
    # la huella del panel se ignora SOLO en Python: cualquier cruce vale
    "py_panel_huella":("py", r'lo, hi = max\(w0, -semi_w\), min\(w1, semi_w\)', 'lo, hi = w0, w1'),
    # la altura del eje deja de decir que NO esta medida, SOLO en Python: una
    # cota declarada que se presenta como medida es el falso verde de siempre
    "py_eje_medida":  ("py", r'return \{"valor": defecto_m, "medida": False,', 'return {"valor": defecto_m, "medida": True,'),
    # y SOLO en JS, un eje_m a cero cuela como medida
    "js_eje_cero":    ("js", r'if \(typeof v === "number" && isFinite\(v\) && v > 0\)', 'if (typeof v === "number")'),
    # al tapar se pierde la profundidad, SOLO en Python
    "py_tapa_cero":   ("py", r'"despeje": -min\(abs\(h_lo\), abs\(h_hi\)\) if cruza else abs\(h\),',
                              '"despeje": 0 if cruza else abs(h),'),
    # el Deygout de paneles vuelve a partir en el EJE, SOLO en JS
    "js_parte_eje":   ("js", r'var sB = cr\.s \+ c\.wBorde / sp;', 'var sB = cr.s;'),
    # el seno del angulo de cruce se pierde al volver del canto, SOLO en Python
    "py_sin_senphi":  ("py", r's_b = cr\["s"\] \+ c\["wBorde"\] / sp', 's_b = cr["s"] + c["wBorde"]'),
    # la geometria bajo tierra se calla, SOLO en Python
    "py_tierra_muda": ("py", r'"bajoTierra": z_bot < suelo,', '"bajoTierra": False,'),
    # el conductor perfecto vuelve a dar NaN SOLO en Python
    "py_conductor":   ("py", r'if eps_r == math\.inf:\n        return _cx\(1\.0, 0\.0\)', 'if False:\n        pass'),
    # la tolerancia del régimen cambia SOLO en JS
    "js_tol_regimen": ("js", r'var tol = tolGrados == null \? 10 : tolGrados;',
                              'var tol = tolGrados == null ? 20 : tolGrados;'),

    # ── y de los DOS RAYOS, que es donde la aritmética compleja se la juega ──
    # Python coge siempre la rama vertical: los casos con pol="h" se separan
    "py_refl_pol":    ("py", r'if str\("v" if pol is None else pol\)\.lower\(\)\.find\("v"\) == 0:',
                              'if True:'),
    # el signo de la fase del reflejado, SOLO en JS
    "js_fase_signo":  ("js", r'cExp\(cx\(0, -dphi\)\)', 'cExp(cx(0, dphi))'),
    # la rama de la raíz compleja pierde el signo, SOLO en Python. `eps` tiene
    # parte imaginaria negativa siempre (−60·λ·σ), así que esto actúa seguro
    "py_csqrt_rama":  ("py", r'if z\[1\] < 0:\n        im = -im', 'if False:\n        im = -im'),
}
MUTA = os.environ.get("MUTA")

ok = ko = 0
peor = {}                     # peor diferencia POR BLOQUE: mezclar dB con grados
                              # y con metros en un solo número esconde el que importa


def check(nombre, cond, extra=None):
    global ok, ko
    if cond:
        ok += 1
        print("OK   " + nombre)
    else:
        ko += 1
        print("FAIL " + nombre + ("" if extra is None else " -> " + str(extra)))


# ── LOS CASOS ──────────────────────────────────────────────────────────────
# Deterministas y escritos aquí. Cubren las tres respuestas de `corta`, los dos
# regímenes, las cuatro frecuencias que van a hacer falta (2,45 GHz Zigbee,
# 868 EU, 915 US, 2,4) y enlaces de una, dos y tres filas, que es donde Deygout
# recursiona de verdad.
F = [2.45e9, 868e6, 915e6, 2.4e9]






def casos_regimen():
    out = []
    for enl in ([100, 0], [0, 100], [100, 100], [100, 9], [100, 27], [-100, 0],
                [70.7, -70.7], [1e-12, 0], [0, 0]):
        for fila in ([0, 1], [1, 0], [1, 1]):
            for tol in (None, 5, 10, 30):
                out.append([enl, fila, tol])
    return out


def casos_relieve():
    """El relieve contra la TIERRA LISA. Los perfiles cubren los casos que el
    motor tiene que distinguir: plano a varias cotas -donde el resultado es 0
    EXACTO-, rampas, cerros, vaguadas, muestreo irregular, y perfiles que NO
    cubren el vano (que dan None, no 0)."""
    def rej(h, D, n=12):
        return [[D * i / n, h(D * i / n)] for i in range(n + 1)]
    perfiles = [
        [],                                            # vacio
        [[0, 0.0], [50, 0.0]],                         # NO cubre un vano de 100
        rej(lambda s: 0.0, 200),                       # plano a 0
        rej(lambda s: 739.23, 200),                    # plano a cota de Ayora
        rej(lambda s: -12.75, 200),                    # plano bajo el cero
        rej(lambda s: 0.05 * s, 200),                  # rampa
        rej(lambda s: -0.15 * s, 200),                 # rampa al reves
        rej(lambda s: 2.0 * math.exp(-((s - 100) / 30.0) ** 2), 200),    # cerro
        rej(lambda s: -2.0 * math.exp(-((s - 100) / 30.0) ** 2), 200),   # vaguada
        [[0, 0.0], [1, 0.05], [3, 0.4], [97, 1.1], [150, 0.2], [200, 0.0]],  # irregular
        [[0, 5.0], [200, 5.0]],                        # solo dos puntos
    ]
    out = []
    for p in perfiles:
        for zA, zB, D in ((1.5, 1.5, 100), (0.775, 3.15, 180), (3.15, 0.775, 120)):
            out.append([zA, zB, D, p])
    return out


def casos_escalares():
    out = []
    for f in F:
        for d in (0.0005, 1, 12, 47.3, 100, 250, 1000, 4321.7):
            out.append(["fspl", d, f])
        for d1, d2 in ((50, 50), (10, 190), (1, 1), (33.3, 66.7)):
            for n in (None, 1, 2, 3):
                out.append(["fresnel", d1, d2, f, n])
        for ht, hr in ((1.5, 1.5), (0.775, 3.15), (3.15, 3.15)):
            out.append(["ruptura", ht, hr, f])
        # DOS RAYOS. Es el bloque donde la aritmética compleja se juega la
        # paridad: cerca de los lóbulos el campo casi se cancela, así que una
        # diferencia de un bit en `cSqrt` sale amplificada en el log.
        #
        # EL BARRIDO LLEGA A 400 m Y NO MÁS, y no es para esquivar un caso
        # incómodo: es que más allá no hay problema que resolver. El enlace más
        # largo medido en El Burgo son 157,7 m y un salto TCU-TCU son decenas de
        # metros. A 4.321,7 m con las antenas a 0,775 m los dos motores se
        # separan 2,8e-08 dB, y eso está medido y comprobado abajo, en «el suelo
        # de la plataforma», con su causa. No se tapa: se acota y se explica.
        for d in (0.5, 1, 5, 12.5, 30, 47.3, 100, 250, 400):
            for ht, hr in ((1.5, 1.5), (0.775, 3.15), (3.15, 0.775), (0.775, 0.775)):
                for pol in ("v", "h"):
                    out.append(["dosrayos", d, ht, hr, f, 15.0, 5e-3, pol])
        for th in (1e-6, 0.001, 0.03, 0.3, 1.0, 1.5707):
            for pol in ("v", "h"):
                out.append(["reflexion", th, 15.0, 5e-3, f, pol])
        for h in (-2.0, -0.5, -0.095, 0.0, 0.049, 0.595, 1.0, 3.7):
            for d1, d2 in ((60, 140), (50, 50), (5, 195)):
                out.append(["nu", h, d1, d2, f])
    for v in (-5, -2, -0.79, -0.78, -0.7, -0.1, 0, 0.034029, 0.059263,
              0.5, 1, 2.4, 10, 100):
        out.append(["filo", v])
    out.append(["lambda", 2.45e9])
    for f in F:
        out.append(["lambda", f])
    return out




def casos_antena():
    """LA ANTENA DE LA TCU Y EL PATRÓN, que son geometría nueva y tienen que
    dar el mismo número en los dos motores como todo lo demás.

    El patrón se barre hasta el NULO del eje: ahí la función es vertical y es
    donde la paridad se rompería si una de las dos ramas se escribiera distinta.
    Y el conductor perfecto entra porque es un CORTOCIRCUITO, no una fórmula:
    una rama que solo exista en un lado es exactamente lo que esto vigila."""
    out = []
    for al in [0, 5, 15, 30, 35.09, 45, 55, 60, 75, 90, -30, -55, 120, 180]:
        out.append(["ancla", 0.225, al])
        out.append(["altura", 1.5, 0.225, 0.50, al])
        for c in [2.380, 2.411]:
            out.append(["holgura", 0.225, 0.50, c, al])
    for e in [0.0, 1e-9, 0.01, 0.1, 0.25, 0.5, 1.0, 1.4, 1.5707963267948966,
              1.5707963267948966 - 1e-9, -0.25, -1.0, -1.4, 3.0]:
        out.append(["patron", e, "dipolo"])
        out.append(["patron", e, "iso"])
    for d1 in [0.0, 0.05, 0.1125, 0.25, 3.0, 100.0]:
        for f in [2.45e9, 868e6, 2.4e9]:
            for u in [2, 5, 0.5]:
                out.append(["cerca", d1, 100.0, f, u])
    # conductor perfecto: la rama de cortocircuito, por los dos lados
    for th in [0.01, 0.25, 1.0]:
        out.append(["reflinf", th, 5e-3, 2.45e9, "v"])
        out.append(["reflinf", th, 5e-3, 868e6, "h"])
    # LA ALTURA DEL EJE: declarada, medida, sin montaje, y el cero que NO cuela
    # EL NOMBRE ES `eje_m` Y SOLO ESE. Los casos con `module_height` PUESTO ya
    # no van aqui: los dos motores LANZAN, y eso se carea abajo con su propio
    # bloque. Un `module_height: null` si entra, porque es lo que el generador
    # emite hoy en las diez plantas y tiene que seguir siendo inocuo.
    for m in [{"eje_m": None}, {"eje_m": 2.0}, {"eje_m": 1.87},
              {"eje_m": 0}, {"eje_m": -1}, {}, None,
              {"module_height": None}, {"module_height": None, "eje_m": 1.35}]:
        out.append(["eje", m, 1.20])
    for cu in [2.380, 2.382, 2.384, 2.411]:
        for al in [0, 30, 55, 84.5248, 90]:
            for su in [0.0, 0.40, -0.3]:
                out.append(["tierra", 1.20, cu, al, su])
    # CORTE EXACTO CON EL PANEL INCLINADO. Se barren las CINCO ramas, porque una
    # que solo exista en un lado es justo lo que esto vigila: paralelo, fuera de
    # la huella, atraviesa, roza por debajo y roza por encima.
    for al in [0, 10, 30, 35.091, 45, 55, -30]:
        for wA, wB in [(0.1125, -10.0), (-10.0, 0.1125), (0.0, 0.0),   # cruza, al reves, paralelo
                       (5.0, 9.0), (-9.0, -5.0),                        # fuera de la huella
                       (-2.0, 2.0), (-0.5, 0.5)]:                       # cruza entero / tramo corto
            for zA, zB in [(-0.6949, -0.6949), (-0.6949, 0.40), (2.0, 2.0), (-3.0, -3.0)]:
                out.append(["panel", 0.0, 2.38, al, wA, wB, zA, zB])
    return out


def casos_paneles():
    """DEYGOUT SOBRE PANELES. Se barre el angulo de cruce -de perpendicular a
    casi paralelo- porque `senPhi` entra en el `w` de los dos extremos Y en la
    vuelta del canto a distancia recorrida: si un motor lo aplicara solo en un
    sitio, la diferencia saldria aqui y no en `corta_panel`."""
    out = []
    for D, zA, zB in [(60, 0.805, 0.805), (120, 0.805, 3.15), (24, 0.775, 0.775),
                      (338, 0.871, 0.871)]:
        for al in [0, 10, 30, 45, 55]:
            for sp in [1.0, 0.866, 0.5, 0.1736, 0.05]:
                for ss in [[0.2], [0.2, 0.5, 0.8], [0.1, 0.3, 0.5, 0.7, 0.9]]:
                    cr = [{"s": f * D, "zEje": 1.5, "cuerda": 2.382,
                           "alpha": al, "senPhi": sp} for f in ss]
                    out.append([D, zA, zB, cr, 2.45e9])
    return out


# LAS FAMILIAS «banda», «corta» y «difraccion» YA NO ESTAN, y no es una perdida
# de cobertura: esas funciones ya no existen en NINGUNO de los dos motores. La
# banda vertical se saco a `tests/referencia_banda_vertical.js` porque el motor
# no puede tener dos funciones que den el despeje de una fila, y lo que el motor
# calcula ahora -el corte con el plano inclinado y su Deygout- esta cubierto por
# «paneles» y por la parte de panel de «antena».
CASOS = {
    "paneles": casos_paneles(), "regimen": casos_regimen(),
    "relieve": casos_relieve(), "escalares": casos_escalares(),
    "antena": casos_antena(),
}

# ── LOS DOS MOTORES ────────────────────────────────────────────────────────
DRIVER_JS = r"""
'use strict';
const fs = require('fs'), vm = require('vm');
const ctx = { module: { exports: {} }, globalThis: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx);
const R = ctx.module.exports;
const casos = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const out = {};
out.regimen = casos.regimen.map(([e, f, tol]) => {
  const r = R.regimen(e[0], e[1], f[0], f[1], tol); return [r.tipo, r.anguloDeg]; });
out.relieve = casos.relieve.map(([zA, zB, D, p]) => { const r = R.relieveDeltaDb(D, zA, zB, p, 2.45e9);
  return r === null ? null : [r.db, r.bruto, r.hst, r.hsr, r.hstd, r.hsrd, r.htE, r.hrE]; });
out.escalares = casos.escalares.map(c => {
  switch (c[0]) {
    case 'fspl':    return R.fsplDb(c[1], c[2]);
    case 'fresnel': return R.radioFresnel(c[1], c[2], c[3], c[4]);
    case 'ruptura': return R.distanciaRuptura(c[1], c[2], c[3]);
    case 'nu':      return R.nu(c[1], c[2], c[3], c[4]);
    case 'filo':    return R.perdidaFiloDb(c[1]);
    case 'lambda':  return R.longitudOnda(c[1]);
    case 'dosrayos':  return R.dosRayosDb(c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
    case 'reflexion': { const g = R.coefReflexion(c[1], c[2], c[3], c[4], c[5]);
                        return [g.re, g.im]; }
  }
  throw new Error('caso escalar desconocido: ' + c[0]);
});
out.paneles = casos.paneles.map(([D, zA, zB, cr, f]) => {
  const r = R.difraccionPanelesDetalle(D, zA, zB, cr, f);
  const d = r.dominante;
  return [r.totalDb, r.motivo, d === null ? null : [d.s, d.sEje, d.nu, d.perdidaDb, d.estado, d.despeje, d.borde, d.wBorde]];
});
out.antena = casos.antena.map(c => {
  switch (c[0]) {
    case 'ancla':   { const a = R.anclaAntena(c[1], c[2]); return [a.dz, a.lateral]; }
    case 'altura':  return R.alturaAntenaTCU(c[1], c[2], c[3], c[4]);
    case 'holgura': return R.holguraBajoModulo(c[1], c[2], c[3], c[4]);
    case 'patron':  return R.gananciaPatronDb(c[1], c[2]);
    case 'cerca':   { const k = R.campoCercano(c[1], c[2], c[3], c[4]);
                      return [k.cerca, k.distanciaM, k.lambdas, k.umbralLambdas]; }
    case 'reflinf': { const g = R.coefReflexion(c[1], Infinity, c[2], c[3], c[4]);
                      return [g.re, g.im]; }
    case 'panel':   { const p = R.cortaPanel(c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
                      return [p.estado, p.despeje, p.borde, p.wBorde, p.motivo]; }
    case 'eje':     { const e = R.alturaEje(c[1], c[2]);
                      return [e.valor, e.medida, e.motivo]; }
    case 'tierra':  { const g = R.bajoTierra(c[1], c[2], c[3], c[4]);
                      return [g.zBot, g.bajoTierra, g.hundimientoM, g.alphaCorteDeg, g.motivo]; }
  }
  throw new Error('caso de antena desconocido: ' + c[0]);
});
// 17 dígitos: el redondeo del JSON no puede ser quien decida si hay paridad
process.stdout.write(JSON.stringify(out, (k, v) =>
  typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(17)) : v));
"""


def corre_python(mod, casos):
    out = {}
    out["regimen"] = []
    for e, f, tol in casos["regimen"]:
        r = mod.regimen(e[0], e[1], f[0], f[1], tol)
        out["regimen"].append([r["tipo"], r["anguloDeg"]])
    out["relieve"] = []
    for zA, zB, D, p in casos["relieve"]:
        r = mod.relieve_delta_db(D, zA, zB, p, 2.45e9)
        out["relieve"].append(None if r is None else
                              [r["db"], r["bruto"], r["hst"], r["hsr"],
                               r["hstd"], r["hsrd"], r["htE"], r["hrE"]])
    out["escalares"] = []
    for c in casos["escalares"]:
        k = c[0]
        if k == "fspl":      out["escalares"].append(mod.fspl_db(c[1], c[2]))
        elif k == "fresnel": out["escalares"].append(mod.radio_fresnel(c[1], c[2], c[3], c[4]))
        elif k == "ruptura": out["escalares"].append(mod.distancia_ruptura(c[1], c[2], c[3]))
        elif k == "nu":      out["escalares"].append(mod.nu(c[1], c[2], c[3], c[4]))
        elif k == "filo":    out["escalares"].append(mod.perdida_filo_db(c[1]))
        elif k == "lambda":  out["escalares"].append(mod.longitud_onda(c[1]))
        elif k == "dosrayos":
            out["escalares"].append(mod.dos_rayos_db(c[1], c[2], c[3], c[4], c[5], c[6], c[7]))
        elif k == "reflexion":
            g = mod.coef_reflexion(c[1], c[2], c[3], c[4], c[5])
            out["escalares"].append([g[0], g[1]])
        else: raise SystemExit("caso escalar desconocido: %s" % k)
    out["paneles"] = []
    for D, zA, zB, cr, f in casos["paneles"]:
        r = mod.difraccion_paneles_detalle(D, zA, zB, cr, f)
        d = r["dominante"]
        out["paneles"].append([r["totalDb"], r["motivo"], None if d is None else
            [d["s"], d["sEje"], d["nu"], d["perdidaDb"], d["estado"], d["despeje"], d["borde"], d["wBorde"]]])
    out["antena"] = []
    for c in casos["antena"]:
        if c[0] == "ancla":
            a = mod.ancla_antena(c[1], c[2]); out["antena"].append([a["dz"], a["lateral"]])
        elif c[0] == "altura":
            out["antena"].append(mod.altura_antena_tcu(c[1], c[2], c[3], c[4]))
        elif c[0] == "holgura":
            out["antena"].append(mod.holgura_bajo_modulo(c[1], c[2], c[3], c[4]))
        elif c[0] == "patron":
            out["antena"].append(mod.ganancia_patron_db(c[1], c[2]))
        elif c[0] == "cerca":
            k = mod.campo_cercano(c[1], c[2], c[3], c[4])
            out["antena"].append([k["cerca"], k["distanciaM"], k["lambdas"], k["umbralLambdas"]])
        elif c[0] == "reflinf":
            g = mod.coef_reflexion(c[1], math.inf, c[2], c[3], c[4])
            out["antena"].append([g[0], g[1]])
        elif c[0] == "panel":
            q = mod.corta_panel(c[1], c[2], c[3], c[4], c[5], c[6], c[7])
            out["antena"].append([q["estado"], q["despeje"], q["borde"], q["wBorde"], q["motivo"]])
        elif c[0] == "eje":
            e = mod.altura_eje(c[1], c[2])
            out["antena"].append([e["valor"], e["medida"], e["motivo"]])
        elif c[0] == "tierra":
            g = mod.bajo_tierra(c[1], c[2], c[3], c[4])
            out["antena"].append([g["zBot"], g["bajoTierra"], g["hundimientoM"],
                                  g["alphaCorteDeg"], g["motivo"]])
        else:
            raise ValueError("caso de antena desconocido: %s" % c[0])
    return out


# ── MUTAR SOBRE COPIA ──────────────────────────────────────────────────────
tmp = tempfile.mkdtemp(prefix="paridad_radio_")
ruta_js = os.path.join(RAIZ, "radio_pv_model.js")
ruta_py = os.path.join(RAIZ, "radio_pv_model.py")
if MUTA:
    m = MUTACIONES.get(MUTA)
    if not m:
        sys.stderr.write("mutacion desconocida. Hay: %s\n" % ", ".join(MUTACIONES))
        sys.exit(2)
    lado, patron, cambio = m
    orig = ruta_js if lado == "js" else ruta_py
    src = open(orig, encoding="utf-8").read()
    nuevo, n = re.subn(patron, cambio, src, count=1, flags=re.M)
    if n != 1:
        sys.stderr.write("la mutacion «%s» no caso con el codigo\n" % MUTA)
        sys.exit(2)
    destino = os.path.join(tmp, os.path.basename(orig))
    open(destino, "w", encoding="utf-8").write(nuevo)
    if lado == "js":
        ruta_js = destino
    else:
        ruta_py = destino
    print("### MUTACION «%s» PUESTA en el lado %s: este banco TIENE que salir rojo\n"
          % (MUTA, lado.upper()))

import importlib.util                                                  # noqa: E402
spec = importlib.util.spec_from_file_location("radio_pv_model_bajo_prueba", ruta_py)
PY = importlib.util.module_from_spec(spec)
spec.loader.exec_module(PY)

f_casos = os.path.join(tmp, "casos.json")
with open(f_casos, "w", encoding="utf-8") as fh:
    json.dump(CASOS, fh)
f_driver = os.path.join(tmp, "driver.js")
open(f_driver, "w", encoding="utf-8").write(DRIVER_JS)

try:
    salida = subprocess.run([os.environ.get("NODE", "node"), f_driver, ruta_js, f_casos],
                            capture_output=True, text=True, timeout=180)
except FileNotFoundError:
    sys.stderr.write("no hay node en el PATH: sin el JS DE VERDAD esto no es paridad\n")
    sys.exit(2)
if salida.returncode != 0:
    sys.stderr.write("el motor JS no corrio:\n%s\n" % salida.stderr[-3000:])
    sys.exit(2)
JS = json.loads(salida.stdout)
PYR = corre_python(PY, CASOS)

# ── LA COMPARACIÓN ─────────────────────────────────────────────────────────
# TOLERANCIA. 1e-9 en las magnitudes en dB y en metros. No es «casi igual»:
# es el suelo de la aritmética, porque log10/sqrt/acos de V8 y de libm pueden
# discrepar en el último bit y eso no es una diferencia de modelo. Lo que el
# banco sí exige es que la peor diferencia se IMPRIMA, para que nadie tenga que
# fiarse de que la tolerancia sigue siendo honesta.
TOL = 1e-9


def igual(a, b, ruta):
    global peor
    if isinstance(a, str) or isinstance(b, str) or a is None or b is None \
            or isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(igual(x, y, ruta) for x, y in zip(a, b))
    d = abs(float(a) - float(b))
    if d > peor.get(ruta, 0.0):
        peor[ruta] = d
    return d <= TOL or (math.isnan(a) and math.isnan(b))


print("· los dos motores, caso a caso")
total = 0
# LOS BLOQUES SALEN DE `CASOS`, NO DE UNA LISTA A MANO. Estaba escrita dos
# veces, y al añadir la familia «antena» los dos bucles siguieron recorriendo
# las seis de antes: los casos nuevos se generaban, los dos motores los
# calculaban, y NADIE LOS COMPARABA. El banco decia «1492 casos» y seguia en
# verde. Una familia nueva entra sola ahora, y el guardian de abajo lo exige.
BLOQUES = tuple(CASOS)
for bloque in BLOQUES:
    a, b = JS.get(bloque), PYR.get(bloque)
    if a is None or b is None or len(a) != len(b):
        check("%s: mismo numero de casos" % bloque, False, "js=%s py=%s"
              % (None if a is None else len(a), None if b is None else len(b)))
        continue
    malos = [i for i in range(len(a)) if not igual(a[i], b[i], bloque)]
    total += len(a)
    check("%-11s %4d casos" % (bloque, len(a)), not malos,
          None if not malos else "%d discrepan; el primero (#%d): js=%r py=%r"
          % (len(malos), malos[0], a[malos[0]], b[malos[0]]))

check("el barrido no esta vacio", total > 500, total)
# GUARDIAN CONTRA LA DERIVA QUE ESTO ACABA DE TENER: toda familia declarada en
# CASOS tiene que haber llegado a los DOS motores. Si un driver se queda sin su
# rama, el bloque no aparece en la salida y esto lo dice, en vez de comparar
# cinco familias de seis y llamarlo paridad.
faltan = [b for b in BLOQUES if b not in JS or b not in PYR]
check("las %d familias de CASOS llegan a los dos motores" % len(BLOQUES),
      not faltan, "sin comparar: " + ", ".join(faltan) if faltan else None)
print("     %d casos comparados. Peor diferencia por bloque:" % total)
for bloque in BLOQUES:
    unidad = {"regimen": "grados", "paneles": "dB", "escalares": "dB/m (mezcla)",
              "antena": "dB/m (mezcla)"}
    print("       %-11s %.3e %s" % (bloque, peor.get(bloque, 0.0),
                                    unidad.get(bloque, "m")))

# Y que el barrido toque de verdad los estados de `cortaPanel` y los dos
# regimenes: un barrido que solo pasara por un camino compararia poco.
# Los casos de panel viven DENTRO de la familia «antena», mezclados con los
# demas, asi que hay que ir a buscarlos por su indice en CASOS.
iPanel = [i for i, c in enumerate(CASOS["antena"]) if c[0] == "panel"]
estados = {JS["antena"][i][0] for i in iPanel}
tipos = {r[0] for r in JS["regimen"]}
check("el barrido pasa por los cinco estados del panel inclinado",
      estados == {"libre", "hueco", "tapado", "fuera", "paralelo"}, sorted(estados))
check("y por los dos regimenes, mas el degenerado",
      tipos == {"pasillo", "cruza", "degenerado"}, sorted(tipos))
noCero = [x[0] for x in JS["paneles"] if x[0] > 0]
check("y hay difraccion de panel que cobra de verdad, no todo ceros",
      len(noCero) > 100, "%d de %d" % (len(noCero), len(JS["paneles"])))

# ── EL SUELO DE LA PLATAFORMA ──────────────────────────────────────────────
# Por qué la tolerancia no es cero, dicho con números y no de palabra.
#
# V8 y CPython NO calculan igual `hypot` ni `atan2`: difieren en el último bit,
# ~1,4e-16 relativo. `exp`, `cos`, `sin`, `log10` y `sqrt` sí son idénticos. Y
# dos rayos amplifica justo esos dos, porque la fase sale de `dRef − dLos`, una
# resta de números casi iguales: a 4.321,7 m esa resta vale décimas frente a
# magnitudes de miles, y el error relativo se multiplica por ~10.000.
#
# ESTO SE COMPRUEBA AQUÍ, EN CI, y no se deja escrito en un comentario: si
# mañana `log10` empezara a separarse, sería otra cosa y este banco lo diría.
print("\n· el suelo de la plataforma: por que la tolerancia no es cero")
_pruebaJs = r"""
const c = [[100,0.725],[0.5,3.925],[1000,6.3],[250,3.0],[12.5,3.925],[4321.7,1.55]];
process.stdout.write(JSON.stringify({
  hypot: c.map(([a,b]) => Math.hypot(a,b)),
  atan2: c.map(([a,b]) => Math.atan2(b,a)),
  exp:   [0.5,1,-1,0].map(Math.exp),
  cos:   [0.5,1.2,3.0,-2.2].map(Math.cos),
  sin:   [0.5,1.2,3.0,-2.2].map(Math.sin),
  log10: [1.5,2.0,138.36,1e-3].map(Math.log10),
  sqrt:  [2,3,15.0001,0.5].map(Math.sqrt),
}, (k,v) => typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(17)) : v));
"""
_f = os.path.join(tmp, "plataforma.js"); open(_f, "w").write(_pruebaJs)
_r = subprocess.run([os.environ.get("NODE", "node"), _f], capture_output=True, text=True)
if _r.returncode != 0:
    check("la sonda de plataforma corre", False, _r.stderr[-300:])
else:
    _j = json.loads(_r.stdout)
    _c = [[100,0.725],[0.5,3.925],[1000,6.3],[250,3.0],[12.5,3.925],[4321.7,1.55]]
    _py = {"hypot": [math.hypot(a,b) for a,b in _c],
           "atan2": [math.atan2(b,a) for a,b in _c],
           "exp":   [math.exp(x) for x in (0.5,1,-1,0)],
           "cos":   [math.cos(x) for x in (0.5,1.2,3.0,-2.2)],
           "sin":   [math.sin(x) for x in (0.5,1.2,3.0,-2.2)],
           "log10": [math.log10(x) for x in (1.5,2.0,138.36,1e-3)],
           "sqrt":  [math.sqrt(x) for x in (2,3,15.0001,0.5)]}
    _identicas = {k: all(a == b for a, b in zip(_j[k], _py[k])) for k in _py}
    for k in ("exp", "cos", "sin", "log10", "sqrt"):
        check("%-5s es identica bit a bit en los dos" % k, _identicas[k])
    check("hypot NO lo es, y de ahi sale el suelo", not _identicas["hypot"])
    check("atan2 tampoco", not _identicas["atan2"])

# Y el caso feo, con su cota medida. 4.321,7 m con las antenas a 0,775 m no es
# un enlace de una fotovoltaica: es el peor condicionado que encontre barriendo,
# y esta aqui para que la cota no sea una creencia.
_feo_py = PY.dos_rayos_db(4321.7, 0.775, 0.775, 2.45e9, 15.0, 5e-3, "h")
_fJs = os.path.join(tmp, "feo.js")
open(_fJs, "w").write(
    "const fs=require('fs'),vm=require('vm');const c={module:{exports:{}},globalThis:{}};"
    "c.globalThis=c;vm.createContext(c);vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),c);"
    "process.stdout.write(String(c.module.exports.dosRayosDb(4321.7,0.775,0.775,2.45e9,15.0,5e-3,'h')));")
_rf = subprocess.run([os.environ.get("NODE", "node"), _fJs, ruta_js],
                     capture_output=True, text=True)
if _rf.returncode != 0 or not _rf.stdout.strip():
    check("el peor caso conocido se evalua en los dos motores", False,
          (_rf.stderr or "salida vacia")[-300:])
    sys.exit(1)
_feo_js = float(_rf.stdout)
_dFeo = abs(_feo_js - _feo_py)
check("el peor caso conocido (4.321,7 m, antenas a 0,775 m) se separa MENOS de 1e-7 dB",
      _dFeo < 1e-7, "%.4e" % _dFeo)
check("...y MAS de 1e-9, o sea que el caso sigue siendo el feo de verdad",
      _dFeo > 1e-9, "%.4e" % _dFeo)
print("     (medido: %.4e dB sobre una perdida de %.1f dB)" % (_dFeo, _feo_js))

# La frecuencia tampoco tiene defecto en Python.
revento = False
try:
    PY.fspl_db(100, None)
except Exception as e:
    revento = "f_hz" in str(e)
check("en Python tambien LANZA si falta la frecuencia", revento)

# EL NOMBRE VIEJO DE LA ALTURA DEL EJE: los DOS motores tienen que lanzar.
# Si uno lo ignorase y el otro no, una planta con el campo viejo puesto daria
# mapas distintos en el visor y en la calibracion, que es la averia que esta
# paridad existe para impedir.
def _lanza_py():
    try:
        PY.altura_eje({"module_height": 1.87}, 1.20); return False
    except Exception as e:
        return "module_height" in str(e) and "eje_m" in str(e)

_fEje = os.path.join(tmp, "eje_viejo.js")
open(_fEje, "w").write(
    "const fs=require('fs'),vm=require('vm');const c={module:{exports:{}},globalThis:{}};"
    "c.globalThis=c;vm.createContext(c);vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),c);"
    "try{c.module.exports.alturaEje({module_height:1.87},1.20);process.stdout.write('NO_LANZO');}"
    "catch(e){process.stdout.write(/module_height/.test(e.message)&&/eje_m/.test(e.message)"
    "?'LANZA_BIEN':'LANZA_MAL:'+e.message);}")
_rEje = subprocess.run([os.environ.get("NODE", "node"), _fEje, ruta_js],
                       capture_output=True, text=True)
check("los dos motores LANZAN con el nombre viejo PUESTO, no lo ignoran",
      _lanza_py() and _rEje.stdout.strip() == "LANZA_BIEN",
      "py=%s js=%s" % (_lanza_py(), (_rEje.stdout or _rEje.stderr)[:80]))

print()
print("FALLOS: %d (de %d)" % (ko, ok + ko) if ko else "TODO OK — %d comprobaciones" % ok)
if MUTA:
    print("### bien: la mutacion «%s» sale roja" % MUTA if ko
          else "### MAL: la mutacion «%s» pasa desapercibida" % MUTA)
sys.exit(1 if ko else 0)
