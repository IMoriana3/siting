#!/usr/bin/env python3
"""Auditoría SIN conexión del ZIP Zigbee de El Burgo.

Sólo lee CSV; no extrae el ZIP, no contacta equipos ni servidores y nunca exporta
IP, MAC, clave, PAN o credencial. Las rutas son observaciones del recolector,
no prueba de entrega RF ni mediciones del RSSI de cada salto.

python tools/careo_elburgo_datos.py --zip elburgo.zip --desde 2026-10-10 \
  --hasta 2026-10-12 --holdout 2026-10-12 --json /tmp/careo.json
"""
from __future__ import annotations
import argparse
import collections
import csv
import io
import json
import math
import pathlib
import re
import statistics
import sys
import zipfile

GWS = ("NCU01-GW1", "NCU01-GW2", "NCU02-GW1", "NCU02-GW2")
RUTA = re.compile(r"(^|/)zigbee_routes(?:\.\d{8})?\.csv$")
PATRON_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def leer_csv(z, archivo):
    with z.open(archivo) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))


def hallar(z, final):
    candidatos = [n for n in z.namelist() if n.endswith("/" + final) or n == final]
    if len(candidatos) != 1:
        raise ValueError("Se esperaba un unico " + final + ", hay " + str(len(candidatos)))
    return candidatos[0]


def kilometros(a, b):
    p1, l1 = map(math.radians, a)
    p2, l2 = map(math.radians, b)
    h = math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin((l2-l1)/2)**2
    return 6371000 * 2 * math.asin(min(1., math.sqrt(h))) / 1000


def mediana_hist(hist):
    num = sum(hist.values())
    if not num:
        return None
    def pos(k):
        n = 0
        for val in sorted(hist):
            n += hist[val]
            if n > k:
                return val
        raise AssertionError("histograma inconsistente")
    return (pos((num-1)//2)+pos(num//2))/2


def tipo(n):
    return "HSU" if n.startswith("HSU_") else "TCU" if n.startswith("TCU_") else "OTRO"


def analizar(zip_path, desde, hasta, holdout=None):
    if not PATRON_FECHA.fullmatch(desde) or not PATRON_FECHA.fullmatch(hasta) or desde>hasta:
        raise ValueError("Intervalo de fechas invalido")
    if holdout and (not PATRON_FECHA.fullmatch(holdout) or holdout<desde or holdout>hasta):
        raise ValueError("El dia de validacion debe quedar dentro del intervalo")
    conteos = {g: collections.Counter() for g in GWS}
    primero = {g: collections.Counter() for g in GWS}
    diarios = {g: collections.defaultdict(collections.Counter) for g in GWS}
    primeros_horas_clave = {g: collections.defaultdict(collections.Counter) for g in GWS}
    hist_hops = {g: collections.Counter() for g in GWS}
    horas = {g: collections.defaultdict(collections.Counter) for g in GWS}
    destinos = {g: set() for g in GWS}
    coords = {}
    ncus = {}
    inv = {g: {} for g in GWS}
    slaves = {g: set() for g in GWS}
    angulos = {g: collections.defaultdict(list) for g in GWS}

    with zipfile.ZipFile(zip_path) as z:
        for r in leer_csv(z, hallar(z, "ncus_elburgo.csv")):
            try:
                n = "NCU%02d" % int(r["nombre"].split()[-1])
                ncus[n] = (float(r["lat"]), float(r["lon"]))
            except (KeyError, ValueError):
                continue
        for g in GWS:
            n, gw = g.split("-")
            for r in leer_csv(z, hallar(z, "coords_elburgo_%s_%s.csv" % (n, gw))):
                if not r.get("node_id"):
                    continue
                try:
                    co = (float(r["lat"]), float(r["lon"]))
                except (KeyError, ValueError):
                    continue
                coords[g, r["node_id"]] = {"posicion": co, "rol": r.get("rol"),
                                           "esclavo": r.get("esclavo")}
                if r.get("rol") == "TCU" and r.get("esclavo"):
                    slaves[g].add(r["esclavo"])
        for fn in z.namelist():
            if re.search(r"(^|/)censo_campania(?:\.\d{8})?\.csv$", fn):
                for r in leer_csv(z, fn):
                    g = r.get("gateway", "")
                    if g in GWS and r.get("ext_addr"):
                        inv[g][r["ext_addr"]] = r.get("node_id", "")
        rf = sorted(x for x in z.namelist() if RUTA.search(x))
        if not rf:
            raise ValueError("Sin ficheros zigbee_routes*.csv")
        for fn in rf:
            for r in leer_csv(z, fn):
                d = r.get("timestamp", "")[:10]
                g = r.get("gateway", "")
                if d < desde or d > hasta or g not in GWS:
                    continue
                ct = conteos[g]
                ct["consultas"] += 1
                if r.get("ok") != "1":
                    ct["no_ok"] += 1
                    # Motivo con vocabulario cerrado para que nunca salgan datos crudos.
                    mot = r.get("motivo", "")
                    ct["error_" + (mot if mot in {"telnet_caido","sin_ruta","auth","timeout_nodo","http_error"} else "otro")] += 1
                    continue
                ids = r.get("path_ids", "").split(">")
                exts = r.get("path_ext", "").split(">")
                try:
                    nh = int(r.get("hop_count", ""))
                except ValueError:
                    ct["ruta_hop_count_invalido"] += 1
                    continue
                if not ids or ids[0] != "COORD" or len(ids)-1 != nh or nh < 1:
                    ct["ruta_estructura_invalida"] += 1
                    continue
                ct["rutas_validas"] += 1
                destino = ids[-1]
                destinos[g].add(destino)
                hist_hops[g][nh] += 1
                horas[g][d + "T" + r["timestamp"][11:13]][nh] += 1
                if tipo(destino) in {"TCU","HSU"}:
                    ct["destino_" + tipo(destino)] += 1
                else:
                    ct["destino_otro"] += 1
                first = ids[1]
                if first == "COORD":
                    ct["primer_salto_coordinator_duplicado"] += 1
                    continue
                if len(exts) != len(ids) or exts[0] != "COORD" or not exts[1] or exts[1] == "COORD":
                    ct["primer_salto_sin_ext"] += 1
                elif exts[1] in inv[g]:
                    ct["primer_salto_ext_en_censo"] += 1
                    if r.get("target_ext") and exts[-1] != r["target_ext"]:
                        ct["destino_ext_inconsistente"] += 1
                else:
                    ct["primer_salto_ext_fuera_de_censo"] += 1
                ct["primer_salto_total"] += 1
                ct["primer_salto_" + tipo(first)] += 1
                primero[g][first] += 1
                diarios[g][d][first] += 1
                if r["timestamp"][11:13] in {"14", "18"}:
                    primeros_horas_clave[g][d + "T" + r["timestamp"][11:13]][first] += 1
                if (g, first) not in coords:
                    ct["primer_salto_sin_posicion"] += 1
        try:
            fn_angs = hallar(z, "angulos.csv")
        except ValueError:
            fn_angs = None
        if fn_angs:
            for r in leer_csv(z, fn_angs):
                d = r.get("hora_utc", "")[:10]
                g = r.get("ncu", "")
                if g not in GWS or d < desde or d > hasta:
                    continue
                ct = conteos[g]
                ct["angulos_consultados"] += 1
                slave = r.get("esclavo", "")
                if slave not in slaves[g]:
                    ct["angulos_esclavo_fuera_de_ambito"] += 1
                    continue
                if r.get("error"):
                    ct["angulos_error_de_lectura"] += 1
                    continue
                try:
                    angulo = float(r["tilt_deg"].replace(",", "."))
                except (KeyError, ValueError):
                    ct["angulos_valor_invalido"] += 1
                    continue
                if not math.isfinite(angulo) or not -100 <= angulo <= 100:
                    ct["angulos_valor_invalido"] += 1
                    continue
                angulos[g][d + "T" + r["hora_utc"][11:13]].append(angulo)
                ct["angulos_utilizables"] += 1

    salida = {"formato": "careo-rutas-observadas-v1", "desde": desde, "hasta": hasta,
              "holdout": holdout, "origen": "CSV locales dentro del ZIP (NO publicados)",
              "advertencias": [
                "Las rutas describen lo que devuelve el recolector; no son paquetes entregados ni una medicion RSSI por salto.",
                "Ninguna TCU no elegida como primer salto se clasifica como enlace imposible.",
                "Los recuentos de rutas no son muestras independientes: varios destinos comparten ciclo y tramo.",
                "Sin identificacion de posicion de HSU, no se inventa coordenada; sin TX/sensibilidad/ganancias direccionales, no se calibra en dB.",
                "La continuidad de identidad entre entrenamiento y holdout NO valida el motor RF; no se ha ajustado ni evaluado un modelo predictivo."
              ], "redes": {}}
    for g in GWS:
        ct = conteos[g]
        cands = [(v["posicion"], n) for (gw,n), v in coords.items() if gw==g and v["rol"]=="TCU"]
        ncu = ncus.get(g.split('-')[0])
        cercano = []
        if ncu:
            cercano = sorted(((round(kilometros(ncu, pos)*1000,1), name) for pos,name in cands))[:5]
        top = []
        total = sum(primero[g].values())
        for name, n in primero[g].most_common(15):
            co = coords.get((g,name))
            top.append({"nodo": name, "tipo": tipo(name), "consultas": n,
                        "peso_pct": round(100*n/total,2) if total else None,
                        "distancia_ncu_m": round(kilometros(ncu,co["posicion"])*1000,1) if (ncu and co) else None,
                        "posicion_verificada_en_csv": co is not None})
        hrs = []
        for dhr, hist in sorted(horas[g].items()):
            ae = angulos[g].get(dhr)
            hrs.append({"hora_utc": dhr,"rutas":sum(hist.values()),
                        "mediana_saltos":mediana_hist(hist),
                        "mediana_abs_tilt_de_las_tcu_medidas":round(statistics.median(map(abs,ae)),2) if ae else None,
                        "n_angulos_validos":len(ae or [])})
        test = None
        if holdout:
            prev = set().union(*(set(c) for d,c in diarios[g].items() if d<holdout))
            post = diarios[g].get(holdout, {})
            den = sum(post.values())
            test = {"dia":holdout,"primeros_saltos_observados":len(post),
                    "nodos_ya_vistos_previamente":len(set(post)&prev),
                    "consultas_con_primero_visto_previamente":sum(v for k,v in post.items() if k in prev),
                    "consultas_validas_de_holdout":den,
                    "pct_continuidad_identidad_de_primer_salto":round(100*sum(v for k,v in post.items() if k in prev)/den,2) if den else None}
        salida["redes"][g] = {"recuentos": dict(ct),
            "rutas_por_saltos":dict(sorted(hist_hops[g].items())),
            "mediana_saltos":mediana_hist(hist_hops[g]),
            "destinos_distintos":len(destinos[g]),
            "primeros_saltos_distintos":len(primero[g]),
            "top_primeros_saltos":top,
            "primeros_saltos_por_dia":{day:dict(c.most_common()) for day,c in sorted(diarios[g].items())},
            "primeros_saltos_14_18_utc":{dhr:dict(c.most_common()) for dhr,c in sorted(primeros_horas_clave[g].items())},
            "tcus_mas_cercanas_en_plano":[{"nodo":name,"distancia_m":d} for d,name in cercano],
            "series_horarias":hrs,
            "holdout":test}
    return salida


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip",required=True,help="ZIP LOCAL, sin extraccion de crudos")
    parser.add_argument("--desde",default="2026-10-10")
    parser.add_argument("--hasta",default="2026-10-12")
    parser.add_argument("--holdout",default="2026-10-12")
    parser.add_argument("--json",help="JSON agregado de salida; no incluye MAC, IP ni datos crudos")
    args=parser.parse_args(argv)
    r=analizar(args.zip,args.desde,args.hasta,args.holdout)
    print("El Burgo — rutas del recolector (NO paquetes RF medidos) | %s..%s"%(r["desde"],r["hasta"]))
    for g,v in r["redes"].items():
        c=v["recuentos"]
        top=v["top_primeros_saltos"]
        t=top[0] if top else None
        print("%s: rutas=%d; mediana saltos=%s; nodos primer salto=%d; HSU primer salto=%d; nodo principal=%s (%s %%) ; sin posición=%d; continuidad_nodos=%s %%"%(
            g,c.get("rutas_validas",0),v["mediana_saltos"],v["primeros_saltos_distintos"],
            c.get("primer_salto_HSU",0),t["nodo"] if t else "—",t["peso_pct"] if t else "—",
            c.get("primer_salto_sin_posicion",0),v["holdout"]["pct_continuidad_identidad_de_primer_salto"] if v["holdout"] else "—"))
    if args.json:
        dest=pathlib.Path(args.json)
        dest.write_text(json.dumps(r,ensure_ascii=False,indent=2,sort_keys=True)+"\n",encoding="utf-8")
        print("Resumen agregado guardado en " + str(dest))
    return 0

if __name__=="__main__":
    raise SystemExit(main())