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
    # el hueco bajo el panel desaparece SOLO en Python
    "py_sin_hueco":   ("py", r'if z_rayo < b\["zBot"\]:', 'if False:'),
    # el borde más próximo se sustituye por el de arriba, SOLO en Python
    "py_borde_top":   ("py", r'borde = b\["zTop"\] if d_top <= d_bot else b\["zBot"\]',
                              'borde = b["zTop"]'),
    # media cuerda SOLO en JS
    "js_semi_cuerda": ("js", r'var semi = \(cuerdaM / 2\)', 'var semi = (cuerdaM / 4)'),
    # el Deygout del JS deja de relanzar desde el borde que toca
    "js_borde_top":   ("js", r'var bordeDom = corta\(cruces\[mejor\]\.banda, zDom\)\.borde;',
                              'var bordeDom = cruces[mejor].banda.zTop;'),
    # la constante de espacio libre se desvía 0,01 dB en Python: el banco tiene
    # que cazar incluso una diferencia que a ojo no se ve
    "py_fspl_001":    ("py", r'- 147\.55$', '- 147.56'),
    # la tolerancia del régimen cambia SOLO en JS
    "js_tol_regimen": ("js", r'var tol = tolGrados == null \? 10 : tolGrados;',
                              'var tol = tolGrados == null ? 20 : tolGrados;'),
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


def casos_banda():
    out = []
    for eje in (1.4, 2.0, 2.6, 3.15):
        for cuerda in (2.38, 2.384, 4.0):
            for alpha in (0, 5, 17.5, 30, 45, 55, 60, 90, -30, -55):
                for suelo in (0.0, 0.4, 1.9):
                    out.append([eje, cuerda, alpha, suelo])
    return out


def casos_corta():
    out = []
    for b in ([2.0, 2.38, 30, 0.0], [2.6, 2.38, 90, 0.0], [1.4, 2.38, 0, 0.0],
              [3.15, 4.0, 55, 1.9], [2.0, 2.38, 5, 0.4]):
        for z in (-0.5, 0.0, 0.775, 1.0, 1.405, 1.5, 2.0, 2.595, 3.0, 5.2, 9.9):
            out.append([b, z])
    return out


def casos_regimen():
    out = []
    for enl in ([100, 0], [0, 100], [100, 100], [100, 9], [100, 27], [-100, 0],
                [70.7, -70.7], [1e-12, 0], [0, 0]):
        for fila in ([0, 1], [1, 0], [1, 1]):
            for tol in (None, 5, 10, 30):
                out.append([enl, fila, tol])
    return out


def casos_relieve():
    perfiles = [
        [], [[50, 1.0]], [[30, 0.5], [50, 2.2], [70, 1.1]],
        [[10, -0.3], [90, -0.9]], [[0, 5.0], [200, 5.0]],
        [[25, 1.9], [50, 1.9], [75, 1.9]],
    ]
    out = []
    for p in perfiles:
        for zA, zB, D in ((1.5, 1.5, 100), (0.775, 3.15, 200), (3.15, 0.775, 120)):
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


def casos_difraccion():
    """Enlaces completos. Éste es el que de verdad cierra la fase: mete la
    geometría de banda dentro de la recursión de Deygout, que es donde una
    diferencia de un borde se convierte en dB."""
    out = []
    filas = {
        "plana":   [2.0, 2.38, 0, 0.0],
        "poco":    [2.0, 2.38, 17.5, 0.0],
        "media":   [2.0, 2.38, 30, 0.0],
        "canto":   [2.6, 2.38, 90, 0.0],
        "alta":    [3.15, 4.0, 55, 1.9],
    }
    esquemas = [
        [("media", 50)],
        [("canto", 60), ("media", 140)],
        [("media", 60), ("canto", 140)],
        [("plana", 40), ("poco", 80), ("media", 120), ("canto", 160)],
        [("alta", 30), ("alta", 90), ("alta", 150)],
        [("media", 0), ("media", 200)],          # en los extremos: se descartan
        [("canto", 12), ("canto", 24), ("canto", 36), ("canto", 48), ("canto", 60)],
    ]
    for esq in esquemas:
        for zA, zB in ((1.5, 1.5), (0.775, 0.775), (0.775, 3.15), (3.15, 0.775),
                       (2.0, 2.0), (4.5, 4.5), (1.0, 1.0)):
            for f in F:
                for D in (200, 120.5):
                    out.append([D, zA, zB, [[filas[n], s] for n, s in esq], f])
    return out


CASOS = {
    "banda": casos_banda(), "corta": casos_corta(), "regimen": casos_regimen(),
    "relieve": casos_relieve(), "escalares": casos_escalares(),
    "difraccion": casos_difraccion(),
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
const bandaDe = a => R.banda(a[0], a[1], a[2], a[3]);
const out = {};
out.banda = casos.banda.map(a => { const b = bandaDe(a);
  return [b.eje, b.semi, b.zBot, b.zTop, b.suelo, b.hueco]; });
out.corta = casos.corta.map(([a, z]) => { const c = R.corta(bandaDe(a), z);
  return [c.estado, c.despeje, c.borde, c.bajoSuelo === undefined ? null : c.bajoSuelo]; });
out.regimen = casos.regimen.map(([e, f, tol]) => {
  const r = R.regimen(e[0], e[1], f[0], f[1], tol); return [r.tipo, r.anguloDeg]; });
out.relieve = casos.relieve.map(([zA, zB, D, p]) => { const r = R.relieveDominante(zA, zB, D, p);
  return r === null ? null : [r.s, r.zSuelo, r.invade]; });
out.escalares = casos.escalares.map(c => {
  switch (c[0]) {
    case 'fspl':    return R.fsplDb(c[1], c[2]);
    case 'fresnel': return R.radioFresnel(c[1], c[2], c[3], c[4]);
    case 'ruptura': return R.distanciaRuptura(c[1], c[2], c[3]);
    case 'nu':      return R.nu(c[1], c[2], c[3], c[4]);
    case 'filo':    return R.perdidaFiloDb(c[1]);
    case 'lambda':  return R.longitudOnda(c[1]);
  }
  throw new Error('caso escalar desconocido: ' + c[0]);
});
out.difraccion = casos.difraccion.map(([D, zA, zB, cr, f]) =>
  R.difraccionBandasDb(D, zA, zB, cr.map(([a, s]) => ({ s: s, banda: bandaDe(a) })), f));
// 17 dígitos: el redondeo del JSON no puede ser quien decida si hay paridad
process.stdout.write(JSON.stringify(out, (k, v) =>
  typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(17)) : v));
"""


def corre_python(mod, casos):
    b = lambda a: mod.banda(a[0], a[1], a[2], a[3])
    out = {}
    out["banda"] = [[x["eje"], x["semi"], x["zBot"], x["zTop"], x["suelo"], x["hueco"]]
                    for x in (b(a) for a in casos["banda"])]
    out["corta"] = []
    for a, z in casos["corta"]:
        c = mod.corta(b(a), z)
        out["corta"].append([c["estado"], c["despeje"], c["borde"], c.get("bajoSuelo")])
    out["regimen"] = []
    for e, f, tol in casos["regimen"]:
        r = mod.regimen(e[0], e[1], f[0], f[1], tol)
        out["regimen"].append([r["tipo"], r["anguloDeg"]])
    out["relieve"] = []
    for zA, zB, D, p in casos["relieve"]:
        r = mod.relieve_dominante(zA, zB, D, p)
        out["relieve"].append(None if r is None else [r["s"], r["zSuelo"], r["invade"]])
    out["escalares"] = []
    for c in casos["escalares"]:
        k = c[0]
        if k == "fspl":      out["escalares"].append(mod.fspl_db(c[1], c[2]))
        elif k == "fresnel": out["escalares"].append(mod.radio_fresnel(c[1], c[2], c[3], c[4]))
        elif k == "ruptura": out["escalares"].append(mod.distancia_ruptura(c[1], c[2], c[3]))
        elif k == "nu":      out["escalares"].append(mod.nu(c[1], c[2], c[3], c[4]))
        elif k == "filo":    out["escalares"].append(mod.perdida_filo_db(c[1]))
        elif k == "lambda":  out["escalares"].append(mod.longitud_onda(c[1]))
        else: raise SystemExit("caso escalar desconocido: %s" % k)
    out["difraccion"] = [
        mod.difraccion_bandas_db(D, zA, zB, [{"s": s, "banda": b(a)} for a, s in cr], f)
        for D, zA, zB, cr, f in casos["difraccion"]]
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
for bloque in ("banda", "corta", "regimen", "relieve", "escalares", "difraccion"):
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
print("     %d casos comparados. Peor diferencia por bloque:" % total)
for bloque in ("banda", "corta", "regimen", "relieve", "escalares", "difraccion"):
    unidad = {"regimen": "grados", "difraccion": "dB", "escalares": "dB/m (mezcla)"}
    print("       %-11s %.3e %s" % (bloque, peor.get(bloque, 0.0),
                                    unidad.get(bloque, "m")))

# Y que el barrido toque de verdad los tres estados de `corta` y los dos
# regimenes: un barrido que solo pasara por un camino compararia poco.
estados = {c[0] for c in JS["corta"]}
tipos = {r[0] for r in JS["regimen"]}
check("el barrido pasa por los tres estados de la banda",
      estados == {"libre", "hueco", "tapado"}, sorted(estados))
check("y por los dos regimenes, mas el degenerado",
      tipos == {"pasillo", "cruza", "degenerado"}, sorted(tipos))
noCero = [x for x in JS["difraccion"] if x > 0]
check("y hay difraccion que cobra de verdad, no todo ceros",
      len(noCero) > 100, "%d de %d" % (len(noCero), len(JS["difraccion"])))

# La frecuencia tampoco tiene defecto en Python.
revento = False
try:
    PY.fspl_db(100, None)
except Exception as e:
    revento = "f_hz" in str(e)
check("en Python tambien LANZA si falta la frecuencia", revento)

print()
print("FALLOS: %d (de %d)" % (ko, ok + ko) if ko else "TODO OK — %d comprobaciones" % ok)
if MUTA:
    print("### bien: la mutacion «%s» sale roja" % MUTA if ko
          else "### MAL: la mutacion «%s» pasa desapercibida" % MUTA)
sys.exit(1 if ko else 0)
