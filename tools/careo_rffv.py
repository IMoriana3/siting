#!/usr/bin/env python3
"""CAREO DEL MOTOR DE `cobertura-rf-fv` CONTRA EL CANON — paso 3 del inventario.

═══ POR QUÉ ESTO VA PRIMERO ═══

El paso 3 del `INVENTARIO_MOTOR_RF.md` es «que los consumidores usen el motor».
La forma natural de empezar es migrar; la forma correcta es MEDIR CUÁNTO SE
SEPARAN, porque eso dice si la migración es mecánica o si hay física que
reconciliar — y porque el paso 4 pide exactamente ese careo con 0 diferencias.

`cobertura-rf-fv/python/zigbee_pv_model.py` (481 líneas) es una física
independiente: no importa nada de este repo.

═══ QUÉ CAREA, Y QUÉ NO ═══

CAREA las primitivas, que son las que tienen equivalente 1:1:

    longitud de onda · espacio libre · filo de cuchillo · radio de Fresnel
    distancia de ruptura · patrón de dipolo · nu · dos rayos

NO CAREA la geometría del obstáculo, y no por pereza: son ideas DISTINTAS a
propósito. rf-fv modela la mesa con `TableBand`/`band_clearance`; el canon corta
contra el plano inclinado (`corta_panel`). La del canon es la que se midió
—RF-01: las filas como rectas verticales infinitas se equivocaban en 27 dB— y la
de rf-fv es la idea detrás de A4, que el inventario CERRÓ como «no se
implementa, sería doble conteo». Carearlas daría una diferencia que no es un
defecto de ninguno de los dos.

NO CAREA el balance completo porque el canon no tiene gemelo Python de
`radio_zigbee.js`. Lo que sí se puede leer, y está abajo, es QUÉ AFIRMA cada uno.

    python3 tools/careo_rffv.py

rc = 0 careado · 1 discrepan las primitivas · 2 no se ha podido carear
"""
import sys, os, math

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RFFV = os.path.join(RAIZ, '..', 'cobertura-rf-fv', 'python')
sys.path.insert(0, RAIZ)
import radio_pv_model as C

if not os.path.isdir(RFFV):
    print('NO SE HA PODIDO CAREAR: no encuentro `cobertura-rf-fv/python` al lado.')
    print('«No he podido mirar» no es «está bien».')
    sys.exit(2)
sys.path.insert(0, RFFV)
import zigbee_pv_model as R

TOL = 1e-9          # por debajo de esto es ruido de coma flotante, no divergencia
PISO_CASOS = 2000   # MEDIDO el 2026-09-24: el barrido da 2.408

FS = [2.45e9, 868e6, 915e6, 2.4e9, 2.48e9]
DS = [0.5, 1, 3, 12, 24, 50, 100, 158, 338, 500, 1000]
HS = [0.3, 0.475, 0.505, 0.805, 1.2, 3.15, 6.5]

filas, total, malas = [], 0, []


def careo(nom, fc, fr, casos):
    global total
    peor, ej, n = 0.0, None, 0
    for c in casos:
        try:
            a, b = fc(*c), fr(*c)
        except Exception as e:
            filas.append((nom, 0, None, 'ERROR: ' + str(e)[:50]))
            malas.append(nom)
            return
        n += 1
        d = abs(a - b)
        if d > peor:
            peor, ej = d, (c, a, b)
    total += n
    filas.append((nom, n, peor, '' if peor <= TOL else
                  'caso %s → canon %.6f · rf-fv %.6f' % (ej[0], ej[1], ej[2])))
    if peor > TOL:
        malas.append(nom)


careo('longitud de onda', C.longitud_onda, R.wavelength, [(f,) for f in FS])
careo('espacio libre', C.fspl_db, R.fspl_db, [(d, f) for d in DS for f in FS])
careo('filo de cuchillo', C.perdida_filo_db, R.knife_edge_loss_db,
      [(v / 20,) for v in range(-100, 201)])
careo('radio de Fresnel', C.radio_fresnel, R.fresnel_radius,
      [(a, b, f) for a in DS for b in DS for f in FS])
careo('distancia de ruptura', C.distancia_ruptura, R.breakpoint_distance,
      [(a, b, f) for a in HS for b in HS for f in FS])
careo('patrón de dipolo', lambda e: C.ganancia_patron_db(e, 'dipolo'), R.dipole_gain_db,
      [(e / 50,) for e in range(-78, 79)])
careo('nu', C.nu, lambda h, d1, d2, f: R._v_param(h, d1, d2, f),
      [(h, d1, d2, f) for h in [-2, -0.5, 0, 0.5, 2]
       for d1 in DS[:7] for d2 in DS[:7] for f in FS[:2]])
careo('dos rayos', lambda d, ht, hr, f, e, s: C.dos_rayos_db(d, ht, hr, f, e, s, 'v'),
      lambda d, ht, hr, f, e, s: R.two_ray_pl_db(d, ht, hr, f, e, s),
      [(d, ht, hr, f, 15.0, 0.005) for d in DS for ht in HS[:5]
       for hr in HS[:5] for f in FS[:2]])

print('CAREO DE LAS PRIMITIVAS: `cobertura-rf-fv` contra el canon de Siting\n')
print('%-22s %8s %14s   %s' % ('función', 'casos', 'máx |Δ|', 'donde'))
for nom, n, peor, nota in filas:
    print('%-22s %8d %14s   %s' % (nom, n, ('%.3e' % peor) if peor is not None else '—', nota))
print('\nalcance: %d casos (piso %d) · tolerancia %.0e' % (total, PISO_CASOS, TOL))

if total < PISO_CASOS:
    print('\nALCANCE INSUFICIENTE: %d casos y el piso son %d. Esto no ha mirado bastante.'
          % (total, PISO_CASOS))
    sys.exit(2)

# ── LO QUE NO ES FÍSICA, SINO DISCIPLINA ──────────────────────────────────
p = R.LinkParams()
print('\n── Y LO QUE SÍ SE SEPARA: QUÉ SE ATREVE A AFIRMAR CADA UNO ──\n')
print('Los defectos de `LinkParams` de rf-fv, contra lo que el canon declara:\n')
print('  %-16s rf-fv %-12s canon' % ('', ''))
print('  %-16s %-18s %s' % ('sigma_db', p.sigma_db, 'null — «NO se hereda el sigma del modelo'))
print('  %-16s %-18s %s' % ('', '', 'antiguo: el 6,0 es un valor de partida, no'))
print('  %-16s %-18s %s' % ('', '', 'una medida» (radio_params.json)'))
print('  %-16s %-18s %s' % ('rx_sens_dbm', p.rx_sens_dbm, 'igual, pero rotulado `heredado`'))
print('  %-16s %-18s %s' % ('ptx_dbm', p.ptx_dbm, 'igual, y con el canal a null: cota superior'))

tx = {"x": 0, "y": 0, "ground": 0, "h": 0.805}
rx = {"x": 24, "y": 0, "ground": 0, "h": 0.805}
o = R.predict_link(tx, rx, R.params_elburgo(), [])
print('\nY un enlace de 24 m de El Burgo, por rf-fv:')
for k in ('distance_m', 'prx_dbm', 'margin_db'):
    if k in o:
        print('  %-14s %.4f' % (k, o[k]))
print('  %-14s %s' % ('p_link', o.get('p_link')))
print('  %-14s %s' % ('  motivo', o.get('p_link_motivo')))
print('  %-14s %s  ← el que la escalaba' % ('  sigma', o.get('p_link_sigma_usado')))
print("""
  ANTES `p_link` era UNA PROBABILIDAD salida de ese sigma. DESDE EL 2026-09-24
  sale `None` con su motivo, y la interfaz dice qué desapareció y por qué en vez
  de dejar un hueco. El canon hacía lo mismo desde la fase 5, con el motivo
  `sin_sigma_no_hay_probabilidad`: ahora los dos coinciden también en esto.

  O sea que la diferencia entre los dos motores NO ESTÁ EN LA FÍSICA —%d casos
  a %.0e— sino en QUÉ SE ATREVEN A AFIRMAR con los mismos números. Migrar rf-fv
  al canon no es reconciliar ecuaciones: es que deje de publicar una
  probabilidad que no tiene con qué calcular.""" % (total, TOL))

# ── EL ANTES: QUÉ ENSEÑA HOY rf-fv, Y CUÁNTO VALE ────────────────────────
print('\n── EL ANTES: la probabilidad que rf-fv publica hoy ──\n')

def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

print('Dónde discrimina esa probabilidad, y dónde no:\n')
print('  %8s %11s %12s' % ('margen', 'p(σ=6,0)', 'p(σ=10,99)'))
for mg in (-10, -5, 0, 5, 10, 15, 20, 30, 47, 64):
    print('  %6d dB %10.1f %% %11.1f %%' % (mg, 100 * phi(mg / 6.0), 100 * phi(mg / 10.99)))

print("""
  Los 52 enlaces medidos de El Burgo tienen margen p50 de 47,4 dB (preset
  calibrado) a 64,0 (por defecto). AHÍ LA PROBABILIDAD VALE 100 % SIEMPRE:
  52 de 52 con el sigma por defecto, 39 de 52 con el del preset, mínimo 96,2 %.
  No distingue NADA.

  Donde sí distinguiría es entre −10 y +20 dB — que es justo donde NO hay
  medidas, porque los 52 son el ÁRBOL DE ENCAMINAMIENTO: los enlaces que la
  malla eligió por funcionar. Sesgo de supervivencia.

  Y el sigma que la escala lo desautoriza su propio autor, por escrito, en el
  fichero: «el ajuste real da −16,58 con sigma 10,99… y ni ese es una
  calibración de propagación: sobre 49 enlaces el RSSI correlaciona r = +0,16
  con log(distancia), o sea que NO depende de la distancia».

  O sea que el número es INÚTIL donde hay datos y NO VALIDADO donde serviría.
  Quitarlo no pierde información: pierde una cifra que parecía tenerla.""")

if malas:
    print('\nDISCREPAN: ' + ', '.join(malas))
    sys.exit(1)
print('\nlas %d comparaciones caen por debajo de %.0e: las primitivas son la misma física.' % (total, TOL))
