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


def altura_eje(montaje, defecto_m):
    """Espejo de `alturaEje()`. LA ALTURA DEL EJE ES POR PLANTA, nunca una
    constante global escondida: si la planta no la declara se cae al defecto
    CON MOTIVO, para poder rotular la salida como «declarada».

    El hueco por planta ya existe y esta vacio: `montaje.module_height` en
    plantas_indice.json vale null en las once, y su generador lo dice.

    Y lo que decide esta cota, medido: NO donde cae el canto respecto a la
    antena -subir el eje sube la banda y la antena a la vez, difraccion
    invariante, 0,00e+0 dB- sino el REBOTE EN EL SUELO, 4,8-5,8 dB por enlace."""
    v = (montaje or {}).get("module_height")
    if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0:
        return {"valor": float(v), "medida": True, "motivo": None}
    if not (defecto_m and defecto_m > 0):
        raise ValueError("radio_pv_model: falta la altura del eje y no hay defecto declarado")
    return {"valor": defecto_m, "medida": False,
            "motivo": "altura_de_eje_declarada_no_medida_en_esta_planta"}


def corta_panel(z_eje, cuerda_m, alpha_deg, wA, wB, zA, zB):
    """Espejo de `cortaPanel()`. EL PANEL DE VERDAD ES UN PLANO INCLINADO.

    `banda()` proyecta el panel como segmento VERTICAL sobre el eje. Para una
    fila lejana da igual; para la fila PROPIA es falso: la antena está a
    0,113 m del eje y el panel llega a ±1,19·cos alfa, diez veces más lejos.

    Con w = distancia perpendicular con signo al eje (positiva hacia el borde
    ALTO), el panel es z(w) = z_eje + w·tan alfa para |w| <= (c/2)·cos alfa, y
    el rayo es otra recta en (w, z). El ángulo de cruce entra solo: quien llama
    pasa wA/wB medidos con la perpendicular a ESA fila.

    El VEREDICTO coincide con el de la banda —comprobado—; lo que NO coincide
    es `wBorde`, la posición del borde difractante: la banda lo pone en w = 0 y
    el panel en w = ±(c/2)·cos alfa."""
    a = alpha_deg * GRADO
    semi_w = (cuerda_m / 2.0) * math.cos(a)
    dw = wB - wA
    if abs(dw) < 1e-12:
        return {"estado": "paralelo", "despeje": None, "borde": None,
                "wBorde": None, "motivo": "enlace_paralelo_a_la_fila"}
    w0, w1 = min(wA, wB), max(wA, wB)
    lo, hi = max(w0, -semi_w), min(w1, semi_w)
    if lo > hi:
        return {"estado": "fuera", "despeje": None, "borde": None,
                "wBorde": None, "motivo": "el_enlace_no_pisa_la_huella"}

    def hueco(w):
        zr = zA + (zB - zA) * ((w - wA) / dw)
        return zr - (z_eje + w * math.tan(a))

    h_lo, h_hi = hueco(lo), hueco(hi)
    # El canto por el que difracta es el que deja MENOS hueco, y el despeje va
    # CON SIGNO respecto a el: mismo convenio que `corta()`. Atravesar se
    # detecta por el CAMBIO DE SIGNO, no por el despeje.
    # FALLO CORREGIDO: la primera version devolvia despeje 0 al tapar, o sea
    # nu = 0 y 6,03 dB fijos tapara lo que tapara.
    cruza = (h_lo > 0) != (h_hi > 0)
    if abs(h_lo) <= abs(h_hi):
        w_b, h = lo, h_lo
    else:
        w_b, h = hi, h_hi
    return {"estado": "tapado" if cruza else ("libre" if h > 0 else "hueco"),
            # MISMO SIGNO QUE `corta()`: positivo = el rayo pasa por FUERA.
            "despeje": -min(abs(h_lo), abs(h_hi)) if cruza else abs(h),
            "borde": z_eje + w_b * math.tan(a), "wBorde": w_b, "motivo": None}


def ancla_antena(radio_m, alpha_deg):
    """Espejo de `anclaAntena()`. El conector de la TCU GIRA CON EL TUBO: no es
    una cota fija. Rotación de (0, −r, 0) alrededor del eje del tubo por −α, o
    sea y' = −r·cos α y z' = +r·sen α.

    Procedencia: anclaje en (tcuX−0,16, −0,225, 0) —Cobertura-Zigbee
    seguidor.js:340, con la X local siendo EL EJE DEL TUBO—, giro
    `makeRotationX(−α)` —terreno.html:1907— y el 3D ya lo dibuja así en `aTip`
    —terreno.html:1925—."""
    a = alpha_deg * GRADO
    return {"dz": -radio_m * math.cos(a), "lateral": radio_m * math.sin(a)}


def altura_antena_tcu(eje_m, radio_m, caida_m, alpha_deg):
    """Espejo de `alturaAntenaTCU()`: anclaje girado, más la caída del coax."""
    return eje_m + ancla_antena(radio_m, alpha_deg)["dz"] - caida_m


def holgura_bajo_modulo(radio_m, caida_m, cuerda_m, alpha_deg):
    """Espejo de `holguraBajoModulo()`. Positivo = la antena cuelga en el hueco;
    negativo = el látigo está DENTRO de la banda que barre su propio panel.

    Cambia de signo en α ≈ 35,1° con cuerda 2,380 m, y los seguidores trabajan
    hasta 55–60°."""
    a = alpha_deg * GRADO
    z_ant = ancla_antena(radio_m, alpha_deg)["dz"] - caida_m
    z_bot = -(cuerda_m / 2.0) * abs(math.sin(a))
    return z_bot - z_ant


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


# ── DOS RAYOS ──────────────────────────────────────────────────────────────
# Directo más reflejado en el suelo, que es lo que domina un enlace casi
# horizontal a metro y medio del suelo.
#
# LA ARITMÉTICA COMPLEJA VA A MANO, no con el tipo `complex` de Python ni con
# `cmath`. No es purismo: `cmath.sqrt` no hace las mismas operaciones que el
# `cSqrt` del JS, y la paridad se mide en dB. Con el tipo nativo el número
# saldría «parecido», que es justo lo que este fichero existe para no aceptar.

def _cx(re, im=0.0):     return (re, im)
def _cadd(a, b):         return (a[0] + b[0], a[1] + b[1])
def _csub(a, b):         return (a[0] - b[0], a[1] - b[1])
def _cmul(a, b):         return (a[0]*b[0] - a[1]*b[1], a[0]*b[1] + a[1]*b[0])
def _cscale(a, s):       return (a[0] * s, a[1] * s)
def _cabs(a):            return math.hypot(a[0], a[1])


def _cdiv(a, b):
    d = b[0]*b[0] + b[1]*b[1]
    return ((a[0]*b[0] + a[1]*b[1]) / d, (a[1]*b[0] - a[0]*b[1]) / d)


def _csqrt(z):
    r = math.hypot(z[0], z[1])
    re = math.sqrt((r + z[0]) / 2)
    im = math.sqrt((r - z[0]) / 2)
    if z[1] < 0:
        im = -im
    return (re, im)


def _cexp(z):
    e = math.exp(z[0])
    return (e * math.cos(z[1]), e * math.sin(z[1]))


def coef_reflexion(theta, eps_r, sigma, f_hz, pol=None):
    """Coeficiente de reflexión de Fresnel en el suelo. Espejo de `coefReflexion()`.

    eps_r = inf -> CONDUCTOR PERFECTO, Gamma = +1, sin dependencia del ángulo:
    la cota superior del rebote. Sin esto el canon no fallaba, MENTÍA: daba NaN
    y ese NaN viajaba hasta el margen sin que nada lo dijera."""
    if eps_r == math.inf:
        return _cx(1.0, 0.0)
    if not (eps_r > 0):
        raise ValueError("radio_pv_model: epsR inválido (%r). "
                         "Use math.inf para conductor perfecto." % (eps_r,))
    lam = longitud_onda(f_hz)
    eps = _cx(eps_r, -60.0 * lam * sigma)
    s = math.sin(theta)
    cos2 = math.pow(math.cos(theta), 2)
    root = _csqrt(_csub(eps, _cx(cos2, 0)))
    if str("v" if pol is None else pol).lower().find("v") == 0:
        es = _cscale(eps, s)
        return _cdiv(_csub(es, root), _cadd(es, root))
    return _cdiv(_csub(_cx(s, 0), root), _cadd(_cx(s, 0), root))


def dos_rayos_db(d_m, ht, hr, f_hz, eps_r, sigma, pol=None):
    """Espejo de `dosRayosDb()`."""
    exige_f(f_hz)
    d = max(d_m, 1e-3)
    lam = longitud_onda(f_hz)
    d_los = math.hypot(d, ht - hr)
    d_ref = math.hypot(d, ht + hr)
    theta = math.atan2(ht + hr, d)
    gamma = coef_reflexion(theta, eps_r, sigma, f_hz, pol)
    dphi = (2 * math.pi * (d_ref - d_los)) / lam
    refl = _cscale(_cmul(gamma, _cexp(_cx(0, -dphi))), 1 / d_ref)
    campo = _cadd(_cx(1 / d_los, 0), refl)
    return -20 * math.log10((lam / (4 * math.pi)) * _cabs(campo))


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


def difraccion_paneles_detalle(D, zA, zB, cruces, f_hz, prof=0, max_prof=None):
    """Deygout sobre PANELES, que parte en el CANTO y no en el eje. Espejo de
    `difraccionPanelesDetalle()`.

    El cruce lleva su propia geometria -{s, zEje, cuerda, alpha, senPhi}- en vez
    de una banda ya resuelta: `s` es la distancia hasta el EJE de esa fila y
    `senPhi` el seno del angulo enlace-fila. El `w` de cada extremo sale de ahi
    y el canto vuelve a distancia recorrida como s + wBorde/senPhi.

    SE REPARTE POR EL EJE, no por el canto: el canto de cada cruce depende de
    las cotas del tramo, que cambian al recursionar, asi que repartir por el
    daria un reparto distinto en cada nivel. Lo que si va al canto es el punto
    de corte del tramo y la cota desde la que se reconstruye el rayo."""
    p = prof or 0
    tope = 3 if max_prof is None else max_prof
    vacio = {"totalDb": 0.0, "dominante": None, "izquierda": None,
             "derecha": None, "profundidad": p, "motivo": None}
    if not cruces:
        vacio["motivo"] = "sin cruces"; return vacio
    if p >= tope:
        vacio["motivo"] = "tope de recursion (%d)" % tope; return vacio
    if D <= 0:
        vacio["motivo"] = "tramo de longitud nula"; return vacio
    mejor_v, mejor, mejor_s, mejor_c = -1e9, -1, 0.0, None
    for i, cr in enumerate(cruces):
        sp = cr["senPhi"]
        if not (sp > 0):
            continue
        c = corta_panel(cr["zEje"], cr["cuerda"], cr["alpha"],
                        -cr["s"] * sp, (D - cr["s"]) * sp, zA, zB)
        if c["wBorde"] is None:
            continue
        s_b = cr["s"] + c["wBorde"] / sp
        if s_b <= 0 or s_b >= D:
            continue
        v = nu(-c["despeje"], s_b, D - s_b, f_hz)
        if v > mejor_v:
            mejor_v, mejor, mejor_s, mejor_c = v, i, s_b, c
    if mejor < 0:
        vacio["motivo"] = "ningun canto cae dentro del tramo"; return vacio
    if mejor_v <= -0.78:
        vacio["motivo"] = "el dominante despeja (nu = %.3f <= -0,78)" % mejor_v
        return vacio
    borde_dom = mejor_c["borde"]
    perdida_dom = perdida_filo_db(mejor_v)
    izq, der = [], []
    for k, cr in enumerate(cruces):
        if k == mejor:
            continue
        if cr["s"] < cruces[mejor]["s"]:
            izq.append(cr)
        else:
            der.append({"s": cr["s"] - mejor_s, "zEje": cr["zEje"],
                        "cuerda": cr["cuerda"], "alpha": cr["alpha"],
                        "senPhi": cr["senPhi"]})
    d_izq = difraccion_paneles_detalle(mejor_s, zA, borde_dom, izq, f_hz, p + 1, tope)
    d_der = difraccion_paneles_detalle(D - mejor_s, borde_dom, zB, der, f_hz, p + 1, tope)
    return {
        "totalDb": perdida_dom + d_izq["totalDb"] + d_der["totalDb"],
        "dominante": {"indice": mejor, "s": mejor_s, "sEje": cruces[mejor]["s"],
                      "nu": mejor_v, "perdidaDb": perdida_dom,
                      "estado": mejor_c["estado"], "despeje": mejor_c["despeje"],
                      "borde": borde_dom, "wBorde": mejor_c["wBorde"]},
        "izquierda": d_izq, "derecha": d_der, "profundidad": p, "motivo": None,
    }


def difraccion_paneles_db(D, zA, zB, cruces, f_hz, prof=0, max_prof=None):
    return difraccion_paneles_detalle(D, zA, zB, cruces, f_hz, prof, max_prof)["totalDb"]


def difraccion_bandas_detalle(D, zA, zB, cruces, f_hz, prof=0, max_prof=None):
    """Deygout sobre BANDAS, con el DETALLE. Espejo de `difraccionBandasDetalle()`.

    HAY UNA SOLA IMPLEMENTACIÓN y `difraccion_bandas_db` es una envoltura que se
    queda con el total: el panel de perfil del visor necesita saber cuál fue el
    obstáculo dominante y cómo se partió el enlace, y calcularlo por un segundo
    camino sería tener dos Deygout que se separan solos."""
    p = prof or 0
    tope = 3 if max_prof is None else max_prof
    vacio = {"totalDb": 0.0, "dominante": None, "izquierda": None,
             "derecha": None, "profundidad": p, "motivo": None}
    if not cruces:
        vacio["motivo"] = "sin cruces"; return vacio
    if p >= tope:
        vacio["motivo"] = "tope de recursion (%d)" % tope; return vacio
    if D <= 0:
        vacio["motivo"] = "tramo de longitud nula"; return vacio
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
    if mejor < 0:
        vacio["motivo"] = "ningun cruce cae dentro del tramo"; return vacio
    if mejor_v <= -0.78:
        vacio["motivo"] = "el dominante despeja (nu = %.3f <= -0,78)" % mejor_v
        return vacio
    z_dom = altura_rayo(zA, zB, D, mejor_s)
    c_dom = corta(cruces[mejor]["banda"], z_dom)
    borde_dom = c_dom["borde"]
    perdida_dom = perdida_filo_db(mejor_v)
    izq, der = [], []
    for k, cr in enumerate(cruces):
        if k == mejor:
            continue
        if cr["s"] < mejor_s:
            izq.append(cr)
        else:
            der.append({"s": cr["s"] - mejor_s, "banda": cr["banda"]})
    d_izq = difraccion_bandas_detalle(mejor_s, zA, borde_dom, izq, f_hz, p + 1, tope)
    d_der = difraccion_bandas_detalle(D - mejor_s, borde_dom, zB, der, f_hz, p + 1, tope)
    return {
        "totalDb": perdida_dom + d_izq["totalDb"] + d_der["totalDb"],
        "dominante": {"indice": mejor, "s": mejor_s, "zRayo": z_dom, "nu": mejor_v,
                      "perdidaDb": perdida_dom, "estado": c_dom["estado"],
                      "despeje": c_dom["despeje"], "borde": borde_dom,
                      "banda": cruces[mejor]["banda"]},
        "izquierda": d_izq, "derecha": d_der, "profundidad": p, "motivo": None,
    }


def difraccion_bandas_db(D, zA, zB, cruces, f_hz, prof=0, max_prof=None):
    """Espejo de `difraccionBandasDb()`: el total del detalle."""
    return difraccion_bandas_detalle(D, zA, zB, cruces, f_hz, prof, max_prof)["totalDb"]


def ganancia_patron_db(elev_rad, patron=None):
    """Espejo de `gananciaPatronDb()`. Diagrama del dipolo de media onda, en dB
    RELATIVOS a su máximo:

        F(e) = cos((pi/2)·sen e) / cos e

    Normalizado a F(0) = 1, así que SOLO RESTA. A 2,45 GHz apenas mueve nada
    —cero exacto en todo el careo, donde las dos antenas van a la misma
    altura—; entra porque una ganancia escalar no se puede llevar a sub-GHz.

    Se aplica POR RAYO, no por enlace: cobertura-rf-fv lo aplica una vez con la
    elevación del rayo directo y luego suma un dos rayos cuyo reflejado sale
    con otro ángulo, lo cual es incoherente con su propio modelo."""
    p = "iso" if patron is None else str(patron)
    if p == "iso":
        return 0.0
    if p != "dipolo":
        raise ValueError("radio_pv_model: patrón de antena «%s» no implementado" % p)
    c = math.cos(elev_rad)
    if abs(c) < 1e-9:
        return -60.0
    f = math.cos((math.pi / 2) * math.sin(elev_rad)) / c
    return 20.0 * math.log10(max(abs(f), 1e-3))


def campo_cercano(d1, d2, f_hz, umbral_lambdas=None):
    """Espejo de `campoCercano()`. P.526 supone el obstáculo lejos de los dos
    extremos en longitudes de onda; cerca no hay «filo», hay una antena metida
    debajo de una placa. El corte va en lambdas, NO en `t`: el `t > 0,001` de
    antes es el 0,1 % del enlace, o sea 1,2 cm a 12 m y 33,8 cm a 338."""
    lam = longitud_onda(f_hz)
    u = 2.0 if umbral_lambdas is None else umbral_lambdas
    d = min(d1, d2)
    return {"cerca": d < u * lam, "distanciaM": d, "lambdas": d / lam,
            "umbralLambdas": u}


def vegetacion_db(espesor_m, f_hz, modelo=None):
    """DECLARADA Y NO IMPLEMENTADA, igual que en JS. Devuelve None —no 0 dB—
    sin modelo configurado, para que quien la consuma tenga que decir «no
    modelada» en vez de dar por despejado lo que no se ha mirado."""
    if not modelo:
        return None
    raise ValueError("radio_pv_model: modelo de vegetación «%s» "
                     "no implementado todavía" % modelo)


_VERSION = "fase1"
