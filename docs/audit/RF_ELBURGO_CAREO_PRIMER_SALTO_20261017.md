# El Burgo I · Careo RF de rutas y primeros saltos

**Fecha de la revisión:** 17 de octubre de 2026  
**Planta:** El Burgo I, código 23003  
**Estado:** análisis reproducible de rutas + primer contraste con el motor de Siting. **No es una calibración en dB ni una validación de precisión RF.**

## 1 · Qué hemos contrastado

El ZIP de campaña reúne logs Zigbee, rutas, inventario, ángulos y posiciones de las **dos NCU y cuatro gateways**. Esta revisión utiliza los días completos **10, 11 y 12 de octubre de 2026 (UTC)**. Las cifras son consultas del recolector, **no transmisiones radio contadas ni paquetes entregados**.

| Red | Consultas que devolvieron ruta válida | Mediana de saltos, conjunto 10–12 | Primer salto principal |
|---|---:|---:|---|
| NCU01-GW1 | 149.277 | 4 | TCU 41 · 29,88 % |
| NCU01-GW2 | 150.865 | 3 | TCU 62 · 39,52 % |
| NCU02-GW1 | 114.770 | 5 | TCU 45 · 59,67 % |
| NCU02-GW2 | 180.835 | 3 | TCU 55 · 28,36 % |
| **Total** | **595.747** | — | — |

La ausencia de rutas *completas* de un salto **no implica** que no haya enlaces directos a un coordinador: toda ruta multisalato empieza por un primer salto `COORD→equipo`.

## 2 · Dos hallazgos de topología

- **HSU utilizadas como primer salto:** NCU02-GW1 contiene 11.051 consultas con `HSU_V020_230` como primer salto; NCU02-GW2 contiene 38.066 con HSU como primer salto, principalmente `HSU_V022_210` (38.057). Son cantidades de consultas, no paquetes ni enlaces independientemente medidos.
- **Posición de la HSU 210:** el ZIP de coordenadas no aporta una vinculación explícita y verificable entre el identificador de ruta `HSU_V022_210` y una posición del plano. **No se ha colocado sobre una HSU arbitraria.** También hay alias de HSU y TCU que necesitan conciliación.

Una diferencia material de inventario: el manifiesto del ZIP cuenta **215 TCU y 4 HSU** (219 nodos), mientras que la versión del manifiesto de cobertura disponible en GitHub describe una HSU adicional (irradiancia, esclavo 210, asociada a NCU02-GW2). Esta diferencia se debe conciliar por identidad real y versión de fuente, no por recuentos.

## 3 · Inclinación y saltos, comparación de tres jornadas

Cada celda expresa **mediana de saltos el 10 / 11 / 12 de octubre**, calculada con las rutas consultadas durante esa hora, sin equiparar esas consultas a paquetes.

| Gateway | 14:00 UTC (mesas inclinadas) | 18:00 UTC (≈ posición nocturna) |
|---|---|---|
| NCU01-GW1 | 6 / 6 / 6 | 3 / 3 / 3 |
| NCU01-GW2 | 6 / 6 / 6 | 3 / 3 / 3 |
| NCU02-GW1 | 5 / 4 / 5 | 5 / 5 / 5 |
| NCU02-GW2 | 6 / 6 / 7 | 2 / 3 / 3 |

Los ángulos **efectivamente medidos** y atribuibles a esclavos asignados muestran aproximadamente **52–54° a las 14:00**, frente a **5° en valor absoluto a las 18:00**. Es una asociación repetida; no es por sí sola prueba causal.

**Problema de recolección:** en los días 10–12 el CSV de ángulos realizó 287.672 consultas (71.918 por gateway); **143.836** se dirigieron a esclavos fuera del ámbito de ese gateway conforme al fichero de coordenadas. Se descartaron de la correlación, al igual que respuestas Modbus erróneas o sin ángulo válido. El código nuevo de recolección en GitHub ya contempla listas separadas; el ZIP contiene una variante antigua.

## 4 · Geometría: extremo de antena en bifila

Las coordenadas suministradas se refieren a la **viga de motor de la fila oeste**, no al centro de las dos filas de una bifila. En el preset de Siting, con ancho **8,4 m** y cuerda **2,382 m**, el corrimiento es:

`(8,4 − 2,382)/2 = 3,009 m hacia el oeste`.

Se comprobó de forma independiente en cuatro posiciones, una por gateway, transformando las coordenadas del ZIP a **EPSG:25830**: tras aplicar ese corrimiento al centro del preset, la diferencia fue de unos centímetros en X y hasta ~10 cm en Y. El cálculo de primer salto usa ese extremo real; **no modifica la geometría central del seguidor en otras funciones**.

## 5 · Primer careo con la física canónica de Siting

Se ejecutaron **`radio_pv_model.js` y `radio_zigbee.js`**, usando **`rfRows` / `rfObstacles` / `rfCruces`** extraídos del `index.html` del repositorio, sobre la implantación real de El Burgo. No es una reimplementación de las ecuaciones de pérdida. Las antenas TCU se sitúan en el eje oeste verificado y su altura se calcula con `alturaAntenaTCU` del canon.

**Escenario explícitamente hipotético:** XBee-PRO heredado **+19 dBm**, ganancias **3 dBi + 3 dBi**, sensibilidad **−103 dBm**; la ganancia direccional, pérdidas del PE2088, LMR195 y conectores **no están aplicadas**; terreno sin perfil; vegetación no modelada; ángulo único por gateway/hora tomado de la mediana de medidas válidas. **No atribuir estos parámetros a los cuatro Digi físicos de El Burgo.**

### 12 de octubre: TCU cuyo enlace directo NCU→TCU obtiene margen ≥ 0 dB

| Gateway | A las 14:00 | A las 18:00 | Saltos observados a las 14:00 → 18:00 |
|---|---:|---:|---:|
| NCU01-GW1 | 13/56 | 46/56 | 6 → 3 |
| NCU01-GW2 | 12/52 | 52/52 | 6 → 3 |
| NCU02-GW1 | 13/45 | 44/45 | 5 → 5 |
| NCU02-GW2 | 16/62 | 62/62 | 7 → 3 |

**Resultado:** el modelo teórico sí presenta una degradación importante del número de enlaces directos posibles al inclinar las mesas, que es compatible en dirección con los cambios de rutas de tres gateways. **No reproduce la persistencia de cinco saltos en NCU02-GW1 a las 18:00**, aunque predice 44 de 45 posibles enlaces directos con margen positivo. Que exista un enlace físicamente posible **no obliga** a Zigbee a elegirlo en su ruta: hace falta distinguir radio y política/estado de la malla.

### Discrepancias de NCU02-GW1 a las 14:00

En la misma hora del 12 de octubre, entre las consultas cuyo primer salto corresponde a una TCU identificada en el plano, **707 de 1.101** seleccionaron una TCU a la que este escenario asigna margen ≥ 0 dB; **394 de 1.101** tuvieron un primer salto TCU con margen calculado negativo. Por ejemplo, TCU 23 y TCU 31 figuran en esas rutas y el modelo da aproximadamente **−8,9 y −7,4 dB** respectivamente. Otras **257 consultas** de esa hora arrancan por una HSU sin posición verificada en este inventario y se excluyen de la comparación RF.

Esta es una **discrepancia entre topología anunciada por Digi y un escenario físico condicionado**, no una demostración de paquetes correctamente entregados por un enlace de RSSI imposible. Deben revisarse tiempos, observabilidad del primer salto y modelo de obstáculos antes de recalibrar.

## 6 · Lo que estos datos NO permiten afirmar

1. El RSSI del `zigbee_log.csv` es una observación del módulo, **no un RSSI etiquetado con el vecino del primer salto en ese instante**. La mediana de un nodo atribuida a su padre dominante no es una medida de enlace.
2. La potencia transmisora real de los cuatro Digi, su variante de hardware y sensibilidad **no aparecen caracterizadas por gateway**. PP=8 dBm observado anteriormente pertenecía a **otra NCU**.
3. Las pérdidas del PE2088 y del LMR195 son parámetros de catálogo/cálculo, no una medición de inserción de los armarios de El Burgo. Los latiguillos y conectores internos siguen sin caracterizar.
4. Los nodos que Zigbee **no eligió** como primer salto no constituyen ejemplos negativos de enlace RF. No podemos calcular una precisión de clasificación real con solo rutas utilizadas.
5. Los días 10–11 sirven para preparar decisiones y el 12 puede reservarse para una verificación temporal **cuando exista un modelo ajustado**. La mera continuidad de IDs entre días no valida potencia, sensibilidad ni difusión.
6. Las consultas que devuelven `sin_ruta`, `telnet_caido` o errores de Modbus no son tasas de pérdida de paquetes Zigbee. Los ACK acumulados requieren diferencias por nodo dentro de intervalos válidos, nunca suma de contadores.

## 7 · Código, reproducción y estado

En la rama `feat/rf-montaje-ncu-pe2088-20261016` de `IMoriana3/siting`:

```bash
python3 tools/careo_elburgo_datos.py --zip elburgo.zip \
  --desde 2026-10-10 --hasta 2026-10-12 --holdout 2026-10-12 \
  --json elburgo_observado.json
node tools/careo_elburgo_modelo.mjs \
  --observado elburgo_observado.json --salida elburgo_modelo.json
```

El primer comando se probó con el ZIP real y **19/19 controles sintéticos**. El segundo se ha contrastado mediante la física del repositorio en un evaluador JavaScript y dispone de **16/16 pruebas sintéticas ejecutadas en GitHub Actions**. La PR previa mantiene **29/29 pruebas** del montaje del combinador. No se ha subido el ZIP original, ni IPs, ni MACs, ni contraseñas al repositorio.

**CI de la rama:** 32 bancos correctos y 2 rojos: `test_render_tabla.js` (31/35, rc=2) y `test_sol_pin.js` (5/16, rc=2). Ambos presentaban ese resultado en `main` antes de esta PR. Por tanto, **la suite global NO está verde**. No hay merge ni despliegue ni mejora visible de interfaz.

## 8 · Próximo hito de ingeniería

- Conciliar `HSU_V022_210` / `HSU_V020_230` y el inventario de las cuatro redes, verificando la ubicación y el rol RF antes de atribuir geometría.
- Completar ficha física por gateway (`PP`, `PL`, `PM`, `HV`, `VR`, `CH`; sin datos identificativos sensibles), tipo de TCU y cadena real de antena, si la instrumentación histórica o la documentación permiten hacerlo.
- Contrastar por separado **viabilidad del salto radio** y **elección de rutas de Zigbee**. Buscar medidas de vecino sincronizadas; no convertir las lecturas de nodo en medidas ficticias por enlace.
- Sólo entonces comparar escenarios con/sin pérdidas PE2088/LMR195 y ensayar una validación temporal independiente. La PR #122 seguirá en borrador hasta que su alcance tenga evidencia suficiente.

**Veredicto hoy:** **avance comprobado en ingesta, geometría y comparación de conectividad; precisión RF real todavía NO VALIDADA**.