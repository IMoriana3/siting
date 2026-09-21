# Fase 3 — latencia hasta bandera: la cadena, medida

> **Encargo**: el tiempo hasta bandera tiene que ser el mínimo posible. Métrica =
> desde que la NCU emite la orden hasta que la **última** TCU la recibe (p100).
> Veredicto = ranking por latencia, con la ganancia de cada palanca. Sin
> «viable / no viable».
>
> **Estado de este documento**: la cadena está levantada y medida donde hay con
> qué. **El ranking todavía no se puede hacer**, y la razón está en el §6: el
> número que lo decide —el tiempo por salto— no lo mide nada en ningún
> repositorio. Esto es lo que hay antes de inventarlo.
>
> **Lo más accionable no está en el ranking, está en el §4.1**: el stow autónomo
> de la TCU por pérdida de comunicación existe y viene configurado en **10
> minutos**. Eso son 600 s dominando una cadena cuyo siguiente término mayor son
> 825 s de giro. Es el único punto donde un cambio de configuración —sin
> tecnología nueva— mueve la aguja en centenares de segundos.
>
> **Y la pregunta del giro tiene respuesta barata**: el registro `30010` de la
> TCU da la velocidad de giro en grados/segundo, en vivo. El factor 2,6 entre
> spec y campo se resuelve leyéndolo, sin cronómetro y sin tocar ningún script.
> Ver §2.4.

Cada cifra lleva su estado, y no se mezclan:

| | significado |
|---|---|
| **MEDIDO** | sale de datos de campo de esta cartera, con su fichero citado |
| **DECLARADO** | sale de un plano, una spec o el mapa de registros del fabricante |
| **NO MEDIDO** | no existe el dato. Se dice, no se rellena |

---

## 1. La métrica, y lo que deja fuera

Orden → recepción en la última TCU, **p100**. El p99 no vale: con 109 TCU por
NCU (San José) el 1 % son **una TCU**, y una TCU que no se entera es una mesa
al viento.

La métrica **no incluye el giro**, a propósito: el giro no depende de la radio
y meterlo dentro escondería lo que se quiere comparar. Pero sí entra en la
cadena del §2, porque sin él nadie sabe qué peso tiene lo que se está
ranqueando.

---

## 2. La cadena completa

### 2.1 Detección — **DECLARADO**, del mapa de registros del fabricante

`Cobertura-Zigbee/tools/modbus_src/ncu_r7_hsu_r23.json`. **No es un número: son
tres caminos** y cada uno tarda lo suyo.

| camino | registros | defecto de fábrica | tiempo hasta la orden |
|---|---|---|---|
| **alarma de viento** | `WindSpeedAVGperiod_s` (41071) + `WindMidTime_s` (41018) | 0 s + 1 s | **1 s**, o **5 s** con el promediado que el fabricante recomienda para el ultrasónico (4 s) |
| **nivel de viento** | `WindLevel{N}OnTime_s` (41090–41096) | 10 s (nivel 1) … 5 s (nivel 7) | **5–10 s** |
| **racha** | `GustyWindowTime_s` 60 s + `GustyWindNumber` 3 + `GustMinimumDuration_s` 1 s | | **hasta 60 s** |

Umbral de alarma `WindSpeedMid_mps` = **16,67 m/s** (60 km/h) por defecto;
niveles a partir de `WindLevel1Thr_mps` = **27,78 m/s** (100 km/h).

Dos cosas que salen de aquí y son de diseño, no de radio:

* **La HSU lleva anemómetro ULTRASÓNICO** (`equipos.js`), y para él la propia
  nota del registro recomienda 4 s de promediado, no los 0 s de defecto. O sea
  que el camino rápido son 5 s, no 1.
* **El camino de racha puede costar 60 s él solo**, más que cualquier cosa que
  haga la radio. Si el disparo llega por ahí, optimizar la radio no mueve la
  aguja.

**NO MEDIDO: los valores CONFIGURADOS en planta.** En los repos sólo están los
defectos del fabricante. Los `config_tcu_*.json` son de identidad y pendientes,
no del anemómetro. Hay que leerlos de la NCU por Modbus.

### 2.2 Decisión de la NCU — **NO MEDIDO**

La orden existe y está identificada: `force_sp_1` (40001), «Force Safe Position
1 Request (Wind)», **con bit por grupo y diez grupos**
(`force_sp_1_group_1..10`). Lo que no hay es el ciclo interno de la NCU entre
que la alarma se levanta y el bit se escribe.

### 2.3 Radio hasta la última TCU — **lo que se rankea**

**MEDIDO — la profundidad de la malla.** `Cobertura-Zigbee/elburgo_real.geojson`,
52 nodos de la NCU 1 de El Burgo I:

```
  saltos   n    acumulado
    2      7     13,5 %
    3      8     28,8 %
    4     11     50,0 %
    5     24     96,2 %
    6      2    100,0 %       <-- p100
```

p50 = 4 saltos, p95 = 5, **p100 = 6**.

**Y el caveat que hay que decir con la misma voz:** esos 52 nodos son **la
mitad de una NCU llena**. El Burgo tiene 215 TCU en 2 NCU (108 por NCU), y el
punto de diseño de la cartera es peor:

| planta | TCU | NCU | TCU por NCU |
|---|---:|---:|---:|
| Panbianco | 1.476 | 12 | **123** |
| Benante | 730 | 6 | 122 |
| San José | 2.289 | 21 | 109 |
| El Burgo | 215 | 2 | 108 |
| Páramo | 396 | 4 | 99 |
| Ayora | 751 | 16 | 47 |

Con el doble de nodos la malla no se queda en 6 saltos. **Cuánto más profunda
es, NO MEDIDO.**

**MEDIDO — los reintentos, con su límite.** `ack_failures` por nodo: mediana
**53.394**, máximo **4.575.918**, un factor **86** entre el nodo mediano y el
peor. Un nodo de 53 es SPOF.

**Pero de ahí NO sale una tasa**, y conviene decirlo antes de que alguien la
calcule: el propio generador declara que `ack_failures` son «fallos de ACK
**acumulados**» (`tools/malla_medida.py:21`), o sea un contador con cero
desconocido. Y la ventana tampoco cuadra: el geojson declara 8.053 snapshots y
el fichero horario dice «7 días a ~3 min», que serían 3.360. Son exportaciones
distintas. Dividir una por otra daría un número con pinta de medido que no lo
es.

**NO MEDIDO — el tiempo por salto.** Y es el que decide el ranking entero. Se
ha buscado: ningún `.ps1` de campo, ningún útil y ningún banco de esta cartera
instrumenta un round-trip. `zigbee_logger.ps1` registra RSSI y rutas, no
tiempos.

### 2.4 Giro — **DECLARADO y MEDIDO, y no coinciden**

El 323 s del encargo sale de `TRACKER_SLEW = 0.17` °/s, rotulado en
`Cobertura-Zigbee/overcast.html:577` como **«spec del actuador»** (catálogo
Sunner): 55° / 0,17 = **323,5 s** — el encargo lo cita como 323, que es el
mismo número truncado.

Pero `SolarGPTfull/docs/validacion-campo-actuator.md` midió El Burgo I, 106
TCU, un día — y **dos lecturas independientes del mismo día no coinciden**:

| origen | °/s | 55° de recorrido |
|---|---:|---:|
| spec Sunner | 0,17 | **324 s** |
| medido, lectura del auditor | 0,1538 | **358 s** |
| p05 de esa misma lectura | 0,100 | **550 s** |
| medido, segunda lectura | 0,0667 | **825 s** |

Factor **2,6** en el término dominante. El propio documento lo dice: «la
validación no es reproducible sin escribir cómo se define la medida».

**Y LA PROPIA TCU DECLARA UN CUARTO VALOR, que ordena los otros tres.**
`tools/modbus_src/tcu_v6.json`, registro **`41067` «Motor speed at no load» =
200 mdeg/sec**, o sea **0,200 °/s** → 55° en **275 s**.

«At no load» es el calificador que lo explica todo: es el techo físico, sin
panel, sin viento y sin rozamiento. Que las medidas de campo (0,1538, 0,100)
queden POR DEBAJO de él es lo que la física pide. Los cuatro números dejan de
contradecirse y pasan a ser una escala:

```
  0,200 °/s   275 s   techo declarado por la TCU, SIN CARGA
  0,17  °/s   324 s   catalogo Sunner, el que usa el codigo
  0,1538°/s   358 s   mediana medida en campo
  0,100 °/s   550 s   p05 de esa misma medida
  0,0667°/s   825 s   segunda lectura del mismo dia  <-- este sigue sin encajar
```

Los cuatro primeros forman una secuencia coherente. **El quinto no**: 0,0667
está a un tercio del techo sin carga, y eso ya no lo explica la carga. O es
otra definición de la medida, o es un hallazgo.

**Y ESTO SE PUEDE ZANJAR SIN INSTRUMENTAR NADA.** El registro **`30010`
«Tracker's rotation velocity»** está en **grados/segundo** y es de **lectura
viva, por TCU**. No hace falta cronómetro ni tocar ningún script de campo para
resolver el factor 2,6: basta leer 30010 durante un giro real. Es la respuesta
más barata que hay en toda esta fase.

Relacionados, para cuando se lea: `41039` «Motor velocity evaluation time» =
5.000 ms, `41066` «Low speed motor fault detection time» = 15 s, y `30003` bit
«Set if the motor moves at a speed lower than expected» — o sea que la TCU ya
vigila su propia velocidad y sabe decir cuándo va lenta.

**UNA COSA MÁS, QUE NO ES DE LATENCIA PERO SALE DE AQUÍ.** La banda muerta.
`41061` «Deadband when backtracking is active and no low capacity alarm active»
= **45 pulsos**. Para pasarlo a grados hace falta la conversión, y la única que
hay es una INFERENCIA, no una cita: `41037` «Maximum west tilt angle» = 1.910
pulsos, y la casa declara el ángulo máximo en **55°** para todas las plantas
(`montaje_edm.mjs`, «declarado por la casa... coincide con la plantilla TCU de
El Burgo, west_sw_limit 55»). Si eso es así:

```
  1.910 pulsos / 55°  =  34,73 pulsos/grado  =  0,0288° por pulso
  41061  45 pulsos  =  1,296°     banda muerta en backtracking
  41063  90 pulsos  =  2,592°     idem con baja capacidad de bateria
  41080   4 pulsos  =  0,115°     resolucion de pulso
```

Y ahí hay un **cuarto valor** para la banda muerta, igual que con la velocidad:

| origen | ° |
|---|---:|
| `CANONICAL_DEADBAND_DEG` del core | 1,00 |
| medido, lectura del auditor | 0,50 |
| medido, segunda lectura | 0,90 |
| **registro 41061 de la propia TCU** | **1,30** |

Ninguna de las dos medidas de campo llega al valor del registro, lo cual es
raro: una banda muerta APARENTE debería salir mayor o igual que la
configurada, no menor. **La inferencia de la conversión es lo primero que hay
que comprobar** —leer 41037 y el recorrido real de la misma TCU—, y sólo
después mirar si hay hallazgo. Se anota aquí y no se toca el core.

### 2.5 La cadena, junta

```
  detección     1 – 60 s     DECLARADO (defectos de fábrica)
  decisión NCU     ?         NO MEDIDO
  radio            ?         NO MEDIDO  <-- lo que se quiere rankear
  giro         324 – 825 s   DECLARADO vs MEDIDO, factor 2,6
```

**Ésta es la conclusión que el §6 necesita**: la radio se va a mover en
segundos dentro de una cadena cuyos otros tramos valen decenas y centenares.
Un ranking sin esta tabla delante se lee como si decidiera algo.

---

## 3. Estrategias de envío, por tecnología

Lo que sigue es **DECLARADO del estándar**, no medido, y con una marca más
fuerte todavía: **no está citado de ningún documento de esta cartera**. Son
valores de norma que hay que confirmar contra la hoja del XBee antes de
usarlos para nada que se firme.

### Zigbee 2,4 GHz (lo que hay puesto)

* **Unicast con enrutado**: el paquete recorre los saltos uno a uno, con ACK y
  reintentos por salto. El tiempo a la última TCU escala con la profundidad
  (**6 saltos medidos, más en una NCU llena**) y con el número de destinos,
  porque la NCU tiene que emitir **una orden por TCU**: con 123 TCU por NCU eso
  son 123 transacciones encoladas en el mismo canal.
* **Broadcast / flooding**: una sola emisión que se reenvía. Quita el escalado
  con el número de nodos, que es la ganancia grande. A cambio, el estándar le
  pone un tiempo de entrega de red —`nwkNetworkBroadcastDeliveryTime`— con
  valor por defecto de **9 s**, y cada nodo lo reenvía con jitter. Ese 9 s es
  el que hay que confirmar en la hoja del XBee: si es real, un broadcast
  Zigbee **no puede bajar de ~9 s** por diseño.

**La comparación unicast ↔ broadcast es la palanca de radio más grande que
hay, y se puede medir en planta sin cambiar nada del sistema.** Ver §5.

### LoRa EU868

* Clase C multicast: el nodo escucha siempre, así que la orden llega en una
  emisión sin esperar ventana.
* **El duty cycle del 1 % en EU868 limita al emisor, no al receptor.** Para una
  orden de stow —rara, corta y unidireccional— eso no muerde; para los
  reintentos sí.
* Sin enrutado multisalto: cobertura directa NCU→TCU o nada, lo cual traslada
  el problema al presupuesto de enlace, que es justo lo que el motor de
  `radio_pv_model.js` ya sabe calcular.

### Wi-SUN FAN

* Multicast por MPL, pensado justo para esto.
* Malla multisalto como Zigbee, con la misma dependencia de la profundidad.

**Nada de esto entra todavía en `radio_params.json`**, que hoy sólo declara
`zigbee_pro_24` y `zigbee_std_24`. Añadir LoRa y Wi-SUN es trabajo de esta
fase, y con la misma regla que las dos que hay: **sin sensibilidad leída no hay
margen**, y lo que no se sabe apaga lo que depende en vez de rellenarse.

---

## 4. Palancas de diseño

Ordenadas por lo que se puede decir de ellas hoy.

1. **Stow autónomo en la TCU por pérdida de latido — EXISTE, Y ESTÁ EN 10
   MINUTOS.**

   > **CORRECCIÓN.** La primera versión de este documento decía «NO MEDIDO si
   > las TCU de esta cartera lo tienen». Lo tienen. Estaba en
   > `Cobertura-Zigbee/tools/modbus_src/tcu_v6.json`, el mapa de la propia TCU,
   > que yo no había mirado — sólo el de la NCU. El mecanismo entero:

   | registro | qué es | defecto |
   |---|---|---|
   | `40022` | **NCU communication lost timeout** | **10 minutos** (rango 0..1092) |
   | `30003` bit | «Set if the communication with the NCU is lost» | — |
   | `30114` | «Source of internal safe position» | — |
   | `30001` U3 | «Active safe position (1 to 7)» | — |
   | `41044`..`41056` | ángulos de las 7 posiciones seguras | 25°, 10°, 20°, 30°, 40°, —, 60° |

   Es la única palanca que **quita la radio del camino crítico** en vez de
   acelerarla, y la única que cubre el fallo que ninguna optimización de radio
   cubre: que la NCU esté caída.

   **Y su defecto la deja inútil como stow rápido.** 10 minutos son **600 s**,
   contra un giro de 324–825 s y una radio de segundos: si el camino autónomo
   es el que actúa, domina la cadena entera él solo. Bajarlo es **puro cambio
   de configuración**, sin tecnología nueva ni obra: de 10 min a 1 min quita
   **540 s** del peor caso cuando la radio falla.

   Lo que decide cuánto bajarlo **no es de radio**: es el compromiso entre
   bandera falsa por un corte transitorio —producción perdida— y bandera tarde
   —riesgo mecánico—. Con `ack_failures` como los medidos, los cortes
   transitorios no son raros. **Ese compromiso es de Iñaki, no mío.**

   **Y hay una asimetría que conviene mirar de paso**: el watchdog de red Zigbee
   vale **2 minutos en la NCU** (`NetworkWatchdog`, 41215, «ATNW... in this
   product, default value is 2») y **10 minutos en la TCU** (40029). Son el
   mismo mecanismo con dos valores. **NO MEDIDO si es deliberado.**
2. **Broadcast en vez de unicast.** Quita el escalado con 123 destinos. Coste:
   el tiempo de entrega de red del estándar. Medible en planta, §5.
3. **Los diez grupos de `force_sp_1`.** Ya existen en el mapa de registros. Si
   la orden se puede emitir a los diez grupos a la vez en vez de secuencialmente,
   es una palanca gratis; si se emite en serie, es un multiplicador escondido.
   **NO MEDIDO cuál de las dos hace la NCU.**
4. **Colocación de NCU y alturas de antena.** Reducen la profundidad de la
   malla, que es el factor del tramo de radio. Esto sí lo sabe calcular el
   motor ya, y es donde el trabajo del paso 2 —antena girada, plano inclinado,
   eje por planta— entra de verdad en la fase 3.

---

## 5. Anclaje a campo: el cronómetro D.2

**Es el árbitro, y hoy no existe.** Sin él, el §6 sería un ranking de valores
de catálogo.

Lo que hace falta medir es **una sola cosa**: el tiempo entre que la NCU emite
`force_sp_1` y que cada TCU lo acusa. Con eso salen a la vez el p100, la forma
de la cola y la diferencia unicast ↔ broadcast.

Y se puede hacer **dentro de las restricciones de campo que ya están fijadas**
—Windows PowerShell 5.1, sin instalar nada y sin admin—, porque
`zigbee_logger.ps1` ya habla con el gateway y ya escribe CSV. Lo que le falta
es una marca de tiempo por transacción.

**Dos preguntas abiertas para Iñaki**, y la primera es la que desbloquea:

1. ¿Existe un CSV de cronómetro D.2 de algún SAT real? Si existe, esto se
   carea contra él en vez de instrumentar nada.
2. El canal Zigbee del bloque 8a. Sigue en `null` en `radio_params.json`, con
   su aviso: a canal 26 la potencia máxima cae a +3 dBm en las dos variantes,
   y eso cambia el alcance y por tanto la profundidad de la malla.

---

## 6. Veredicto

**No lo hay todavía, y decir uno sería inventarlo.**

El ranking pedido es por latencia a la última TCU. Esa latencia la decide el
tiempo por salto y el número de transacciones, y **ninguna de las dos cosas
está medida en ningún repositorio de esta cartera**. Lo que sí se puede firmar
hoy, y es lo que este documento aporta:

* La malla real de El Burgo tiene **6 saltos de profundidad p100** sobre **52
  nodos**, que son la mitad de una NCU llena; el punto de diseño son **123 TCU
  por NCU**.
* La detección puede costar **1 s o 60 s** según el camino que dispare, y eso
  es configuración, no radio.
* El giro vale entre **275 y 825 s** según a quién se le pregunte. La propia
  TCU declara el techo —**0,200 °/s sin carga**, `41067`— y eso ordena los
  demás valores en una escala coherente, salvo la segunda lectura de campo
  (0,0667 °/s), que se queda a un tercio del techo y no lo explica la carga.
  **Y se puede zanjar leyendo el registro `30010`**, que da la velocidad de
  giro en grados/segundo por TCU: no hace falta cronómetro ni tocar nada.
* **La palanca que más quita del camino crítico no es de radio, ya existe, y
  está configurada en 10 minutos**: el stow autónomo de la TCU por pérdida de
  comunicación con la NCU (`40022`). 600 s dominan la cadena entera. Bajarlo es
  configuración, no tecnología — pero cuánto bajarlo es un compromiso entre
  bandera falsa y bandera tarde, y ése no es mío.

El siguiente paso que produce el ranking, y no otro, es el §5.
