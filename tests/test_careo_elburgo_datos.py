#!/usr/bin/env python3
"""Casos sintéticos para careo_elburgo_datos.py; no requiere datos de planta."""
import csv
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import zipfile

SOURCE=Path(__file__).resolve().parent.parent / 'tools' / 'careo_elburgo_datos.py'
if not SOURCE.exists():
    SOURCE=Path(__file__).with_name('careo_elburgo_datos.py')
spec=importlib.util.spec_from_file_location('burgo_careo',SOURCE)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
count=0
bad=0
def check(label,test):
    global count,bad
    count+=1
    print(('OK   ' if test else 'FAIL ')+label)
    bad+=not bool(test)

def makecsv(headers, records):
    f=io.StringIO(newline='');w=csv.DictWriter(f,fieldnames=headers);w.writeheader();w.writerows(records)
    return f.getvalue()

with tempfile.TemporaryDirectory() as td:
    zpath=Path(td)/'falso.zip'
    with zipfile.ZipFile(zpath,'w') as z:
        z.writestr('elburgo/ncus_elburgo.csv',makecsv(['nombre','lat','lon'],[{'nombre':'NCU 1','lat':40,'lon':-1},{'nombre':'NCU 2','lat':41,'lon':-1}]))
        for gw in m.GWS:
            nc,coord=gw.split('-')
            z.writestr('elburgo/coords_elburgo_%s_%s.csv'%(nc,coord),makecsv(['node_id','rol','lat','lon','esclavo'],[
                {'node_id':'TCU_A','rol':'TCU','lat':40 if nc=='NCU01' else 41,'lon':-0.999,'esclavo':'3'}]))
        z.writestr('elburgo/censo_campania.csv',makecsv(['gateway','ext_addr','node_id'],[
            {'gateway':'NCU01-GW1','ext_addr':'X-1','node_id':'TCU_A'},
            {'gateway':'NCU02-GW1','ext_addr':'X-2','node_id':'TCU_A'}]))
        h=['timestamp','gateway','ok','motivo','hop_count','path_ids','path_ext','target_ext']
        def r(day,gw,ok,hop,ids,exts,t='X-1',mot='ok'):
            return dict(timestamp=day+'T14:00:00Z',gateway=gw,ok=str(ok),motivo=mot,
                        hop_count=str(hop),path_ids=ids,path_ext=exts,target_ext=t)
        z.writestr('elburgo/zigbee_routes.20261009.csv',makecsv(h,[
            r('2026-10-10','NCU01-GW1',1,2,'COORD>TCU_A>TCU_B','COORD>X-1>X-1'),
            r('2026-10-10','NCU02-GW1',1,2,'COORD>TCU_A>TCU_B','COORD>X-2>X-2','X-2'),
            r('2026-10-10','NCU01-GW1',1,3,'COORD>TCU_A>TCU_B','COORD>X-1>X-1'),
            r('2026-10-10','NCU01-GW1',0,0,'','','X-1','telnet_caido'),
            r('2026-10-10','NCU01-GW1',1,2,'COORD>COORD>TCU_B','COORD>COORD>X-1'),
            r('2026-10-10','NCU02-GW2',1,2,'COORD>HSU_X>TCU_B','COORD>Y-2>Y-3','Y-3'),
            r('2026-10-09','NCU01-GW1',1,2,'COORD>TCU_A>TCU_B','COORD>X-1>X-1')]))
        z.writestr('elburgo/zigbee_routes.20261012.csv',makecsv(h,[
            r('2026-10-12','NCU01-GW1',1,2,'COORD>TCU_A>TCU_B','COORD>X-1>X-1'),
            r('2026-10-12','NCU01-GW1',1,2,'COORD>TCU_C>TCU_B','','X-1')]))
        z.writestr('elburgo/angulos.csv',makecsv(['hora_utc','ncu','esclavo','tilt_deg','error'],[
            {'hora_utc':'2026-10-10 14:00:00','ncu':'NCU01-GW1','esclavo':'3','tilt_deg':'-53,5','error':''},
            {'hora_utc':'2026-10-10 14:00:00','ncu':'NCU01-GW1','esclavo':'90','tilt_deg':'60,0','error':''},
            {'hora_utc':'2026-10-10 14:00:00','ncu':'NCU02-GW1','esclavo':'3','tilt_deg':'1,0','error':'modbus_error'}]))
    data=m.analizar(str(zpath),'2026-10-10','2026-10-12','2026-10-12')
    a,b,c,d=[data['redes'][g] for g in m.GWS]
    check('las ventanas se filtran por timestamp no por nombre del ZIP',a['recuentos']['consultas']==6)
    check('se separan NCU/GW con igual etiqueta de nodo', a['recuentos']['rutas_validas']==4 and c['recuentos']['rutas_validas']==1)
    check('una ruta de 2 saltos tiene primer salto pese a no ser directa al destino',a['recuentos']['primer_salto_total']==3)
    check('rutas con hop_count incoherente se excluyen',a['recuentos']['ruta_estructura_invalida']==1)
    check('un fallo telnet no se cuenta como fallo de RF',a['recuentos']['error_telnet_caido']==1)
    check('no se usa COORD como su propia antena/salto',a['recuentos']['primer_salto_coordinator_duplicado']==1)
    check('se registra identidad verificable por ext de gateway',a['recuentos']['primer_salto_ext_en_censo']==2)
    check('se registra el path_ext que falta',a['recuentos']['primer_salto_sin_ext']==1)
    check('HSU participa como primer salto sin inventar coordenadas',d['recuentos']['primer_salto_HSU']==1 and d['top_primeros_saltos'][0]['distancia_ncu_m'] is None)
    check('conversión explícita de decimal español para ángulos',a['series_horarias'][0]['mediana_abs_tilt_de_las_tcu_medidas']==53.5)
    check('solo acepta esclavos asignados al gateway',a['recuentos']['angulos_esclavo_fuera_de_ambito']==1)
    check('no convierte error Modbus en inclinación plana',c['recuentos']['angulos_error_de_lectura']==1)
    check('fecha holdout no entra en descubrimiento previo',a['holdout']['pct_continuidad_identidad_de_primer_salto']==50)
    check('mediana de histograma impar exacta',m.mediana_hist({2:2,3:1})==2)
    check('mediana de histograma par exacta',m.mediana_hist({2:1,3:1})==2.5)
    serial=json.dumps(data)
    check('salida no filtra direcciones MAC ni IP', 'X-1' not in serial and '-0.999' not in serial and '00:13:' not in serial)
    check('sin CSV de RSSI no inventa potencia medida por enlace', 'rssi_medido_dbm' not in serial)
    check('un primer salto previo basta para continuidad, no para validar RF', 'NO valida el motor RF' in serial)
print('%d comprobaciones, %d fallos'%(count,bad))
raise SystemExit(1 if bad else 0)