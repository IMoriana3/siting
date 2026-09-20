#!/usr/bin/env python3
"""
radio_pv_model.py — el MISMO motor que `radio_pv_model.js`, en Python.

POR QUÉ EXISTE ESTE FICHERO
El visor predice en JS y la calibración ajusta en Python. Si los dos no
resuelven la misma geometría con las mismas ecuaciones, el ajuste calibra un
modelo que nadie usa y el mapa pinta un modelo que nadie ha ajustado: los
parámetros salen «buenos» en la hoja y no cuadran en pantalla, y no hay forma
de saber cuál de los dos miente. Ya pasó una vez en este repo —dos cifras de
sesgo conviviendo, −33,6 y −16,58, sin que ninguna reprodujera a la otra— y el
banco `tests/test_paridad_radio.py` está para que no vuelva a pasar.

CÓMO SE MANTIENE LA PARIDAD. No a ojo: `tests/test_paridad_radio.py` corre los
dos motores sobre el mismo barrido de casos y exige que coincidan. Si alguien
toca una fórmula aquí y no allí —o al revés—, el banco lo dice. Es el mismo
mecanismo con el que SolarGPTfull tiene pinchado el modelo antiguo contra
`factiun_core.rf` a 0,000000 dB.

QUÉ NO HAY AQUÍ. Ningún sesgo global, ningún número de potencia, sensibilidad
ni regulación: eso vive en `radio_params.json`, con su procedencia. Esto son
solo geometría y ecuaciones de pérdida.

ORDEN DE LAS OPERACIONES. Está calcado del JS a propósito, incluso donde
reordenar sería más legible. En coma flotante `(a*b)*c` y `a*(b*c)` no son el
mismo número, y la paridad se mide en dB, no en «parecido».
"""
from __future__ import annotations
import math

# ═══ GEOMETRÍA ═════════════════════════════════════════════════════════════
# Nada de aquí abajo sabe en qué frecuencia se emite.

GRADO = math.pi / 180


def banda(eje, cuerda_m, alpha_deg, suelo_m=None):
    """Banda vertical que ocupa un seguidor inclinado `alpha_deg`.

        zTop = eje + (c/2)·|sen α|
        zBot = eje − (c/2)·|sen α|

    y por debajo de zBot hay HUECO hasta el suelo. Ése es el cambio de fondo
    frente al modelo antiguo, que subía un filo de cuchillo desde el suelo
    hasta el borde superior y por tanto daba por tapado lo que pasa por debajo
    del panel. Espejo de `banda()` en radio_pv_model.js."""
    semi = (cuerda_m / 2) * abs(math.sin(alpha_deg * GRADO))
    suelo = 0.0 if suelo_m is None else suelo_m
    return {
        "eje": eje,
        "semi": semi,
        "zBot": eje - semi,
        "zTop": eje + semi,
        "suelo": suelo,
        "hueco": max(0.0, eje - semi - suelo),
    }


def altura_rayo(zA, zB, D, s):
    """Espejo de `alturaRayo()`."""
    if D <= 0:
        return zA
    return zA + (zB - zA) * (s / D)


def corta(b, z_rayo):
    """Espejo de `corta()`: "tapado" / "hueco" / "libre", con el despeje CON
    SIGNO respecto al borde MÁS PRÓXIMO.

    En "hueco" el borde que cuenta es zBot, no el suelo: un rayo que pasa
    rozando por debajo del panel difracta en el CANTO INFERIOR del módulo."""
    if z_rayo > b["zTop"]:
        return {"estado": "libre", "despeje": z_rayo - b["zTop"], "borde": b["zTop"]}
    if z_rayo < b["zBot"]:
        return {"estado": "hueco", "despeje": b["zBot"] - z_rayo, "borde": b["zBot"],
                "bajoSuelo": z_rayo < b["suelo"]}
    d_top = b["zTop"] - z_rayo
    d_bot = z_rayo - b["zBot"]
    borde = b["zTop"] if d_top <= d_bot else b["zBot"]
    return {"estado": "tapado", "despeje": -min(d_top, d_bot), "borde": borde}


def regimen(dx_enlace, dy_enlace, dx_fila, dy_fila, tol_grados=None):
    """Espejo de `regimen()`: pasillo (no cruza filas) o cruza."""
    n1 = math.hypot(dx_enlace, dy_enlace)
    n2 = math.hypot(dx_fila, dy_fila)
    if n1 < 1e-9 or n2 < 1e-9:
        return {"tipo": "degenerado", "anguloDeg": None}
    cos = abs((dx_enlace * dx_fila + dy_enlace * dy_fila) / (n1 * n2))
    ang = math.acos(min(1.0, max(-1.0, cos))) / GRADO
    tol = 10.0 if tol_grados is None else tol_grados
    return {"tipo": "pasillo" if ang <= tol else "cruza", "anguloDeg": ang}


def relieve_dominante(zA, zB, D, perfil):
    """Espejo de `relieveDominante()`: el punto de terreno que más invade."""
    if not perfil:
        return None
    peor = None
    for s, z_suelo in perfil:
        if s <= 0 or s >= D:
            continue
        invade = z_suelo - altura_rayo(zA, zB, D, s)
        if peor is None or invade > peor["invade"]:
            peor = {"s": s, "zSuelo": z_suelo, "invade": invade}
    return peor


# ═══ TECNOLOGÍA ════════════════════════════════════════════════════════════
# Aquí SÍ manda la frecuencia, y por eso `f_hz` es OBLIGATORIO.

C_LUZ = 299792458.0


def exige_f(f_hz):
    """Espejo de `exigeF()`. SIN VALOR POR DEFECTO, a propósito: predecir
    sub-GHz con los números de 2,4 GHz en silencio es el fallo que el encargo
    prohíbe, y un defecto es la forma de cometerlo sin enterarse."""
    if not (f_hz is not None and f_hz > 0):
        raise ValueError("radio_pv_model: falta f_hz. "
                         "La frecuencia no tiene valor por defecto a propósito.")
    return f_hz


def longitud_onda(f_hz):
    return C_LUZ / exige_f(f_hz)


def fspl_db(d_m, f_hz):
    return 20 * math.log10(max(d_m, 1e-3)) + 20 * math.log10(exige_f(f_hz)) - 147.55


def radio_fresnel(d1, d2, f_hz, n=None):
    nn = 1 if n is None else n
    return math.sqrt((nn * longitud_onda(f_hz) * d1 * d2) / (d1 + d2))


def distancia_ruptura(ht, hr, f_hz):
    return (4 * ht * hr) / longitud_onda(f_hz)


def perdida_filo_db(v):
    """Filo de cuchillo, aproximación de ITU-R P.526. Mismo corte en ν = −0,78
    que el modelo congelado."""
    if v <= -0.78:
        return 0.0
    return 6.9 + 20 * math.log10(math.sqrt(math.pow(v - 0.1, 2) + 1) + v - 0.1)


def nu(h_tapa, d1, d2, f_hz):
    """`h_tapa` es cuánto INVADE el obstáculo el rayo: positivo si tapa."""
    if d1 <= 0 or d2 <= 0:
        return -1e9
    return h_tapa * math.sqrt((2 * (d1 + d2)) / (longitud_onda(f_hz) * d1 * d2))


def difraccion_bandas_db(D, zA, zB, cruces, f_hz, prof=0, max_prof=None):
    """Deygout sobre BANDAS. Espejo de `difraccionBandasDb()`.

    `cruces` es una lista de dicts {"s": distancia desde A, "banda": banda()}.
    El sub-tramo se relanza desde el BORDE del dominante que toca, que puede
    ser el inferior: ahí está la diferencia con el modelo antiguo."""
    p = prof or 0
    tope = 3 if max_prof is None else max_prof
    if not cruces or p >= tope or D <= 0:
        return 0.0
    mejor_v, mejor, mejor_s = -1e9, -1, 0.0
    for i, cr in enumerate(cruces):
        s = cr["s"]
        if s <= 0 or s >= D:
            continue
        z = altura_rayo(zA, zB, D, s)
        c = corta(cr["banda"], z)
        v = nu(-c["despeje"], s, D - s, f_hz)
        if v > mejor_v:
            mejor_v, mejor, mejor_s = v, i, s
    if mejor < 0 or mejor_v <= -0.78:
        return 0.0
    z_dom = altura_rayo(zA, zB, D, mejor_s)
    borde_dom = corta(cruces[mejor]["banda"], z_dom)["borde"]
    perdida = perdida_filo_db(mejor_v)
    izq, der = [], []
    for k, cr in enumerate(cruces):
        if k == mejor:
            continue
        if cr["s"] < mejor_s:
            izq.append(cr)
        else:
            der.append({"s": cr["s"] - mejor_s, "banda": cr["banda"]})
    perdida += difraccion_bandas_db(mejor_s, zA, borde_dom, izq, f_hz, p + 1, tope)
    perdida += difraccion_bandas_db(D - mejor_s, borde_dom, zB, der, f_hz, p + 1, tope)
    return perdida


def vegetacion_db(espesor_m, f_hz, modelo=None):
    """DECLARADA Y NO IMPLEMENTADA, igual que en JS. Devuelve None —no 0 dB—
    sin modelo configurado, para que quien la consuma tenga que decir «no
    modelada» en vez de dar por despejado lo que no se ha mirado."""
    if not modelo:
        return None
    raise ValueError("radio_pv_model: modelo de vegetación «%s» "
                     "no implementado todavía" % modelo)


_VERSION = "fase1"
