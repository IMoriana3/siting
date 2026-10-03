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
> los **303 s** de giro. Es el único punto donde un cambio de configuración —sin
> tecnología nueva— mueve la aguja en centenares de segundos.
>
> **LA PREGUNTA DEL GIRO YA ESTÁ CONTESTADA** (2026-09-24, §2.4), y la cifra
> **queda corregida el 2026-10-03**. 75 stows ajustados uno a uno sobre un evento
> real: **0,1816 °/s de mediana**, R² mediano **0,9984** (mínimo 0,9958), o sea
> **303 s para 55°**.
>
> **LO QUE DECÍA ANTES ERA 0,1774 °/s Y 310 s, Y NO REPRODUCE.** Corrido el útil
> que este documento cita —y también la versión exacta de #101, por si había
> cambiado— sobre los mismos ficheros, la mediana sale 0,1816. El 0,1774 **no es
> la mediana de este conjunto bajo ninguna lectura**: cae en el **percentil 21**
> (16 de los 75 valores están por debajo). Lo que sí coincide casi exactamente es
> la **MEDIA de los 76 ajustes incluyendo uno con velocidad NEGATIVA** —0,1772—,
> así que el número publicado parece venir de promediar en vez de ordenar, y de
> contar como stow un ajuste que describe movimiento en sentido contrario. El R²
> publicado tampoco reproduce: 0,9987 / 0,9898 contra 0,9984 / 0,9958 medidos.
> La conclusión de fondo no cambia —el giro son ~5 minutos y los 600 s del stow
> autónomo siguen dominando—, pero la cifra sí.
>
> **Y LO QUE DEJA MAL PARADO A ESTE DOCUMENTO, no a quien le dio el dato.** El
> 2026-09-24 Iñaki cerró la velocidad así: **«0,181 °/s de mediana, R² 0,9984,
> sobre 47 stows»**. Medido hoy: **0,1816 °/s y R² 0,9984 sobre 75 stows**. O sea
> que **su velocidad acertaba y su R² acertaba EXACTO**; lo único equivocado era
> el recuento, y el 47 salía de un filtro de amplitud implícito
> (`grados_movimiento = 60`), que es lo que se diagnosticó bien.
>
> Lo que pasó es que al corregir el recuento se «corrigió» de paso la velocidad a
> 0,1774 y el R² a 0,9987, que no venían de ninguna medida. **Se tocó un número
> bueno al arreglar uno malo que venía al lado**, y el número bueno se rompió y
> se propagó a seis sitios del documento. La lección, para el documento de
> puertas: cuando un dato llega con dos cifras y una está mal, hay que volver a
> MEDIR las dos, no arrastrar la que parecía acompañar al error. El rango 275–825 s que daba la
> versión anterior de este documento **queda retirado**, y la lectura de 0,0667
> °/s queda descartada como velocidad de giro en stow.
>
> **Y UN AVISO SOBRE LA LATENCIA, QUE ES LO QUE ESTE DOCUMENTO VENÍA A MEDIR.**
> Los ficheros de ese stow llegaron **sin contexto del estado de la
> instalación**, y esa NCU tiene **incidencias declaradas por el propietario**:
> su primer gateway funciona mal. Una versión anterior de este documento publicó
> el reparto de tiempos, el p100 y la tasa de fallo como si fueran el
> comportamiento normal. **No lo son, y están retirados**: lo que queda de ellos
> vive en el §2.4 ter, acotado y sin salir de ahí.
>
> **Un CSV no dice si el equipo del que sale estaba averiado. Hay que
> preguntarlo antes de publicar el número.**
>
> Lo que **sí** sobrevive, porque no depende del estado de la NCU: la velocidad
> de giro (§2.4), la **cota** de la radio sobre el bloque sano (§2.3) y el
> **mecanismo** —una TCU en MANUAL no gira aunque acuse `sec = 5`— del §2.4 bis.

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
| **alarma de viento** | `WindSpeedAVGperiod_s` (41071, **bits 15..8**) + `WindMidTime_s` (41018) | 0 s + 1 s | **1 s**, o **5 s** con el promediado que el fabricante recomienda para el ultrasónico (4 s) |
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

> **OJO CON `41071` Y `41057`: SON REGISTROS EMPAQUETADOS**, y esto se
> descubrió al escribir el volcador, no leyendo el mapa. `41071` lleva DOS
> campos —velocidad en los bits 15..8 y dirección en los 7..0— y `41057` lleva
> TRES —ventana de racha en 7..0, número de rachas en 11..8, duración mínima en
> 15..12—. Leerlos enteros da **1044** y **9020**, que tienen pinta de segundos
> y no lo son. Quien los lea tiene que despiezarlos.

**NO MEDIDO: los valores CONFIGURADOS en planta.** En los repos sólo están los
defectos del fabricante. Los `config_tcu_*.json` son de identidad y pendientes,
no del anemómetro. Hay que leerlos de la NCU por Modbus.

**Y YA HAY CON QUÉ**: `cobertura-zigbee/zigbee_config.ps1` los lee —40 registros
de viento más el `40022` y el `40029` de cada TCU— y los pone al lado de su
defecto de fábrica, marcando los que no coinciden. Va en el paquete de «Medir en
planta». **No escribe nada**: no tiene función de escritura, y
`tools/test_config_planta.py` lo comprueba sobre el fuente **y** contra una NCU
de mentira que responde con excepción a cualquier código de función que no sea
FC03.

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

**COTA SUPERIOR del camino entero — medida, pero SÓLO sobre el bloque sano y
SIN publicar como cifra de la planta.**

> **Alcance, y va delante.** Lo que sigue se mide sobre las **75 TCU del bloque
> A** del stow del 2026-09-24 (§2.4 ter): el bloque con sondeo normal y **cero
> órdenes fallidas**. El fichero trae un segundo bloque, las TCU 1–38, que se
> lleva **los 13 fallos** y no aporta ninguna medida; y esa NCU tiene
> **incidencias declaradas por el propietario**. Mientras no exista el reparto
> TCU → gateway (§2.4 ter), **esto no es la latencia de la planta**: es la cota
> sobre el bloque que funcionaba.
>
> Lo que sí sostiene, y por eso está aquí: **una instalación con problemas no
> adelanta las órdenes**. La cota es conservadora por el lado que importa.

El log de la NCU escribe, **por TCU y con segundo exacto**, cuándo emitió la
orden:

```
2026-09-24 14:44:38;Requesting safe position 5, wind_from_east: 0, for TCU 39. Reason: Request from group
```

y el CSV de esa TCU dice cuándo el SCADA la vio ya en `active_security_position
= 5`. Para las 75 TCU con stow medido:

| | s |
|---|---:|
| petición → primer sondeo con `sec = 5`, mínimo | 34 |
| petición → primer sondeo con `sec = 5`, mediana | 39 |
| petición → primer sondeo con `sec = 5`, **máximo (p100)** | **45** |

**Y ESOS 39 s SON SONDEO, NO TRANSPORTE. Todos.** La comprobación que lo
decide: para cada TCU se mira **el hueco entre el sondeo anterior y el que ya
trae el 5**, y se resta.

```
hueco previo al primer sec=5      mediana 39 s   (periodo nominal 30 s)
(petición → sec=5) − hueco        mediana  0 s · máximo 1 s      <--
```

O sea: **el sondeo inmediatamente posterior a la orden ya la trae**, en 75 de
75. El número 39 es el tiempo hasta el siguiente sondeo, y nada más. Lo que se
puede afirmar es la cota: **la orden llegó a esas 75 TCU en menos de un periodo
de sondeo**, y por debajo de eso **estos datos no resuelven**. Para partirlo en
saltos sigue haciendo falta el cronómetro del §5.

Dicho de otra forma, y es la lectura que se sostiene: **las 75 acusaron la orden
dentro de una ventana de 41 segundos** (14:45:01 → 14:45:42), habiendo salido
las órdenes a lo largo de 46 s. La radio no alarga ese reparto de forma
perceptible con esta resolución.

**Los dos lados que no se pueden callar:**

1. **Esas son las 75 del bloque A.** El bloque B (TCU 1–38) alcanzó `sec = 5`
   entre las 14:42:54 y las **16:30:39**, con 13 órdenes fallidas por medio.
   **El p100 de la planta entera no son 45 s**, y tampoco es el de ese bloque:
   es una avería sin diagnosticar (§2.4 ter).
2. **Es un evento, una planta, una NCU con incidencia declarada.** Para
   sostener «la radio no está en el camino crítico» como conclusión de la fase
   hace falta **otro stow de una instalación sana**. El útil ya existe
   (`tools/stow_desde_scada.mjs`); falta el fichero.

### 2.4 Giro — **MEDIDO**, 75 stows de un stow real

> **Actualizado el 2026-09-24 con datos de campo.** Este apartado daba un rango
> de **275–825 s** y decía que spec y campo «no coinciden». Ese rango queda
> **RETIRADO**: no era una horquilla física, era la distancia entre lecturas que
> no declaraban cómo estaban definidas. Ahora hay 75 giros ajustados uno a uno
> sobre el mismo evento, con su R² publicado.
>
> **Y POR QUÉ ESTA CIFRA SÍ SOBREVIVE A LA INCIDENCIA DE LA NCU** (§2.4 ter).
> La velocidad de giro **no se mide contra el reloj de la NCU ni contra el
> instante de la orden**: se mide **dentro de cada TCU**, como la pendiente de
> su propio ángulo contra su propio sondeo. Una NCU con problemas hace que la
> orden llegue tarde o no llegue; **no hace que el motor gire más despacio**, y
> si lo hiciera saldría en el R² como una rampa rota, no como una pendiente
> limpia. Las 75 dan R² ≥ 0,99.
>
> Las 75 salen además, todas, del **bloque A** (§2.4 ter): las TCU con sondeo
> normal y sin ninguna orden fallida.

**La medida.** Exportación del SCADA del **2026-09-24**: 122 ficheros
`TCU_<nnn>_2026-09-24.csv`, uno por TCU, más `NCU_2026-09-24.csv` y
`NCU_EVENT_LOG_2026-09-24.csv`. Sondeo de **30 s** por TCU en la ventana del
stow. El ángulo viene en **grados con dos decimales** (`angle`, `target_angle`),
no en radianes. **La planta no está declarada en los ficheros y aquí no se
nombra.**

```
tools/stow_desde_scada.mjs   el útil, con su banco: tests/test_stow_desde_scada.js
sha256 del manifiesto de las 124 entradas:
  5f3b4bcfc09a62fd143f4559e5899acc52546838dfef22ffcdc3fecbe8b70bc5
Los CSV NO están en el repositorio (36 MB de dato de planta).
```

**El método** es el del §2.4 anterior y el de `tools/arranques_stow.mjs`: no se
toma «el primer sondeo en que el ángulo cambió», sino el **cruce de la recta de
seguimiento con la de giro**, ajustadas por mínimos cuadrados. La velocidad es
la pendiente de la segunda.

| | °/s | 55° de recorrido |
|---|---:|---:|
| medido, mínimo de 75 | 0,1718 | 320 s |
| medido, p05 | 0,1746 | 315 s |
| **medido, MEDIANA de 75** | **0,1816** | **303 s** |
| medido, p95 | 0,1896 | 290 s |
| medido, máximo | 0,2221 | 248 s |

> **TODA ESTA COLUMNA QUEDA CORREGIDA EL 2026-10-03.** La versión anterior daba
> mínimo 0,1627 (338 s), p05 0,1667 (330 s), mediana 0,1774 (310 s) y p95 0,1893
> (291 s). Ninguno de esos cuatro reproduce. Se corrió el útil que este documento
> cita, y además **la versión exacta de #101** por si había cambiado —no cambió
> ni una línea de lógica—, y se barrieron **144 combinaciones** de los tres
> parámetros (`min_muestras_racha`, `grados_movimiento`, `r2_min`): **ninguna**
> da 0,1774 de mediana ni 0,1627 de mínimo. El **máximo sí coincide exacto**
> (0,2221), así que los ficheros son los mismos y el desacuerdo no es de datos.
>
> El origen más probable está medido: el 0,1774 cae en el **percentil 21** del
> conjunto, y coincide casi exactamente con la **media de los 76 ajustes
> incluyendo uno de velocidad NEGATIVA** (0,1772). O sea promediar en vez de
> ordenar, y contar como stow un ajuste que describe movimiento en sentido
> contrario. Reproducible: `node tools/stow_desde_scada.mjs <carpeta>`.

```
R² del ajuste        mediana 0,9984 · mínimo 0,9958   (75 de 75 por encima de 0,98)
sigma del arranque   mediana 2,66 s · p95 4,24 s · máximo 13,93 s
muestras por ajuste  mediana 14 · mínimo 5
recorrido del giro   40,3° a 86,4°, mediana 84,5°  (los objetivos de stow vistos
                     son +10° y +30°, y el ángulo de partida varía, así que la
                     amplitud varía con ellos y la VELOCIDAD no)
```

**Y ahora los cuatro valores viejos se ordenan contra 75 medidas, no contra
dos:**

```
  0,200 °/s   275 s   techo declarado por la TCU SIN CARGA (`41067`)
                      -> queda JUSTO POR ENCIMA del maximo medido (0,2221 lo
                         roza por arriba; ver el reparo de abajo)
  0,1896°/s   290 s   p95 medido
  0,1816°/s   303 s   MEDIANA MEDIDA, 75 stows          <-- el numero
  0,17  °/s   324 s   catalogo Sunner, el que usa el codigo
                      -> esta por DEBAJO del minimo de las 75 (0,1718)
  0,1538°/s   358 s   mediana de la validacion de campo anterior
                      -> por DEBAJO del minimo de las 75 (0,1718)
  0,0667°/s   825 s   segunda lectura de aquel dia      <-- NO ES ESTA MAGNITUD
```

**El 0,0667 queda descartado como velocidad de giro en stow.** No es que «no
encaje»: está a **2,7 veces** por debajo del mínimo de 75 medidas independientes
del mismo movimiento, con R² ≥ 0,99 cada una. Lo que fuera —otra definición de
la diferencia, un tramo con parada dentro, una ventana que incluía el
seguimiento— no se puede reconstruir desde aquí, y por eso se retira en vez de
explicarse.

> **UN REPARO SOBRE EL MÁXIMO.** El máximo medido, 0,2221 °/s, **supera** el
> techo sin carga que declara la TCU (0,200 °/s, `41067`). Un solo ajuste por
> encima del techo declarado es, o bien un giro con menos carga de la que el
> fabricante supone, o bien un ajuste sobre pocas muestras. No se resuelve con
> estos datos y **no se usa para nada**: el número que se publica es la mediana.
> Queda anotado porque tapar el dato incómodo es cómo se fabrica una escala que
> parece coherente.

**Lo que NO cambia:** el 55° sigue siendo `west_sw_limit`, un límite de
software, y el recorrido real de cada TCU depende de dónde estuviera siguiendo
al sol. Los 303 s son «55° a la velocidad mediana medida», no «lo que tardó una
TCU concreta».

**Y ESTO SE PUEDE ZANJAR SIN INSTRUMENTAR NADA — pero no por donde yo dije.**

> **CORRECCIÓN, a lo que decía la versión anterior de este párrafo.** Escribí
> «basta leer `30010` durante un giro real». **La NCU NO expone `30010`.**
> Comprobado: ni «rotation velocity» ni «operating channel» aparecen en el mapa
> de la NCU. El bloque `TCU Data` (30500–34899) da **22 registros por TCU** y no
> incluye ninguno de los dos. Para leer `30010` hay que estar en el bus de la
> propia TCU —Toolbox, BLE, en planta y TCU a TCU—, que no es «sin tocar nada».

Lo que **sí** está expuesto por la NCU, por TCU y ya recogido, es mejor para
esto:

| registro | qué es | dónde |
|---|---|---|
| `30506` | **Current angle in radians** | bloque `TCU Data`, por TCU |
| `30510` | **Target angle in radians** | ídem |
| `29500` | **«Unix Epoch timestamp of the last successful read of this TCU»** | bloque `TCUs Last Comunication`, 200 unidades |

Y el SCADA ya los sondea: `SCADA/config/plants.yml` declara `interval_s: 30`
para el ciclo completo por NCU (10 s para la meteo).

**La velocidad de giro sale de diferenciar `30506` entre sondeos.** Es,
presumiblemente, lo que hizo la validación de campo — y explica por qué las dos
lecturas del mismo día no coinciden: diferenciar un ángulo sobre una rejilla
gruesa depende mucho de cómo se defina la diferencia, que es literalmente lo
que aquel documento concluyó.

**Y la resolución es de 30 s, lo cual decide qué se puede y qué no:**

* **SÍ** se puede reconstruir el giro y el reparto grueso de un stow real ya
  registrado, sin instrumentar nada nuevo.
* **NO** se puede resolver el tramo de radio, que se mueve en segundos. Para el
  ranking del §6 hacen falta **10 s o menos** de resolución, y 30 s no los da.

O sea: los datos que el SCADA ya guarda resuelven el §2.4 entero y **no**
resuelven el §2.3. El cronómetro del §5 sigue haciendo falta, y sólo para la
radio.

Relacionados, para cuando se lea: `41039` «Motor velocity evaluation time» =
5.000 ms, `41066` «Low speed motor fault detection time» = 15 s, y `30003` bit
«Set if the motor moves at a speed lower than expected» — o sea que la TCU ya
vigila su propia velocidad y sabe decir cuándo va lenta.

**UNA COSA MÁS, QUE NO ES DE LATENCIA PERO SALE DE AQUÍ: LA BANDA MUERTA, Y
EL NÚMERO SE RETIRA.**

`41061` «Deadband when backtracking is active and no low capacity alarm active»
= **45 pulsos**. Eso es lo único verificado. Para pasarlo a grados hace falta la
escala pulsos/grado, y **no está en estos repositorios**.

> **RETRACTACIÓN.** Una versión anterior de este documento daba **1,296°**,
> inferidos de `41037` «Maximum west tilt angle» = 1.910 pulsos suponiendo que
> fueran los 55° que la casa declara. **Se buscó una segunda fuente y no la
> hay**: el mapa de la TCU trae ángulos en radianes (`41111`…`41123`, los
> rangos de inclinación, que salen 35/30/25/20/15/10/5° redondos) y ángulos en
> pulsos (`41037`, `41061`, `41063`, `41080`), pero **ningún par de la misma
> magnitud en las dos unidades**.
>
> Y hay un motivo concreto para desconfiar de la suposición: los 55° de la casa
> son un límite de SOFTWARE —la plantilla de la TCU de El Burgo lo dice así,
> «west_sw_limit 55»— mientras que `41037` se describe como «Maximum west tilt
> angle» a secas, que en un mapa de registros suele ser el límite de HARDWARE, y
> ése normalmente es mayor. Si lo fuera, la escala es menor y el número sube:
>
> | si 1.910 pulsos son… | 45 pulsos = |
> |---|---:|
> | 55° | 1,296° |
> | 60° | 1,414° |
> | 65° | 1,531° |
> | 70° | 1,649° |
>
> Además 1.910 = 2 × 5 × 191, con 191 primo, así que 1910/55 = 34,7273
> pulsos/grado: un número poco propio de un encoder.

Lo que **sí** se puede decir: el registro existe, vale 45 pulsos, el de baja
capacidad vale 90, y la resolución de pulso (`41080`) es 4. Comparar eso con el
`CANONICAL_DEADBAND_DEG` = 1,00 del core o con los 0,50 / 0,90 medidos en campo
**exige la escala**, y hasta tenerla no hay comparación que hacer. La escala
sale del Toolbox o de un registro que este mapa no trae. **No se toca el core.**

### 2.4 bis · El MECANISMO del stow — **MEDIDO y vigente**

> **PROCEDENCIA, y va antes que los números.** Estos CSV llegaron **sin
> contexto del estado de la instalación**. Un fichero exportado no dice si el
> equipo del que sale estaba averiado, y la primera versión de este apartado
> publicó el reparto de tiempos como si fuera el comportamiento normal de un
> stow. El propietario avisó después de que **esa NCU tiene incidencias
> conocidas y su primer gateway funciona mal**.
>
> **La lección, escrita para la próxima vez: el estado del equipo se pregunta
> ANTES de publicar el número, no después.** Un CSV no trae esa columna.
>
> Lo que sigue está separado en tres, por lo que cada cosa depende:
>
> | apartado | qué contiene | depende del estado de la instalación |
> |---|---|---|
> | **§2.4** | velocidad de giro | **no** — es mecánica de cada TCU |
> | **§2.4 bis** (aquí) | cómo funciona la secuencia | **no** — es orden, no duración |
> | **§2.4 ter** | latencia, dispersión, fallos | **sí** — y por eso no se publica |

**Los tres anclajes, y no son intercambiables.** Esto es estructura, no
duración: quién emite qué y en qué orden.

```
1. el OPERADOR habilita la posicion 5 por GRUPO, desde la interfaz web
     «Position 5 enabled for group N»
2. la NCU emite la orden TCU a TCU
     «Requesting safe position 5, ... for TCU N. Reason: Request from group»
3. el OPERADOR manda los grupos a AUTO
     «Group N sent to AUTO», y en el CSV de cada TCU, `main_state`
```

El 2 es el único que está escrito **por TCU**; los otros dos son por grupo, y
**el log no contiene la pertenencia a grupo de ninguna TCU**, así que emparejar
una TCU con «su» clic exigiría inventarla. Por eso el anclaje por TCU es el 2.

#### **UNA TCU CON `sec = 5` Y EN MANUAL NO GIRA**

Es el hallazgo de mecanismo, y **es independiente del estado de la NCU**: la
TCU acepta la posición de seguridad, la publica en `active_security_position`,
y se queda en el ángulo de seguimiento con `motor_state = OFF`.

```
TCU 39, 2026-09-24
  14:45:23  sec=5  ang=-53.50  obj=10.00  MANUAL  mot=OFF
  14:48:53  sec=5  ang=-53.50  obj=10.00  MANUAL  mot=OFF   ← seis minutos
  14:51:23  sec=5  ang=-53.50  obj=10.00  MANUAL  mot=OFF
```

**Lo que la mueve es el paso a AUTO.** Y el arranque del giro **coincide con
ese paso**: sobre los 75 stows medidos, el tiempo entre la primera muestra en
AUTO y el arranque reconstruido por el cruce de rectas tiene **mediana −2,7 s**
(p05 −16,1 · p95 +13,0), o sea que cae dentro del hueco de sondeo de 30 s que
precede a esa muestra. El signo negativo es lo esperable: el cruce cae **antes**
del primer sondeo que ve el giro.

**Ese −2,7 s se publica** aunque el resto del reparto no, y el motivo es que
mide una **coincidencia**, no una duración: dice que entre «pasa a AUTO» y
«empieza a girar» no hay nada, y eso no cambia porque la instalación vaya lenta.
Es la diferencia entre *cómo* funciona y *cuánto tardó ese día*.

**Consecuencia de diseño, y ésta sí es general:** poner a `sec = 5` una flota
que está en MANUAL **no la lleva a bandera**. La orden se acusa, el registro lo
confirma, y ningún panel se mueve. Cualquier medida de «tiempo hasta bandera»
que se apoye en `active_security_position` sin mirar `main_state` está midiendo
el acuse, no el stow.

### 2.4 ter · Las dos poblaciones del fichero, y lo que NO se puede publicar

**La exportación no es homogénea. Se parte en dos bloques disjuntos, y el corte
es exacto:**

| | TCU | filas/día (mín–mediana–máx) | stows medibles | fallos de orden |
|---|---|---|---|---|
| **bloque A** | **39 – 122** (84) | 1.049 – **3.381** – 3.384 | **75 de 84** | **0** |
| **bloque B** | **1 – 38** (38) | 21 – **64** – 175 | **0 de 38** | **13 de 13** |

> ## LOS DOS BLOQUES SON LOS DOS GATEWAYS. Resuelto el 2026-10-03.
>
> Este corte se encontró MIDIENDO, sin saber qué lo causaba. Iñaki dijo el
> 2026-10-03 que **el reparto TCU → GW → NCU ya está en los repos**, y está:
>
> ```
> SCADA/tools/tcu-toolbox/plantas/24019-san-jose.json
>
> {"nombre": "San Jose NCU18 GW1", "puerto": 503, "tcu_ini":  1, "tcu_fin":  38}
> {"nombre": "San Jose NCU18 GW2", "puerto": 504, "tcu_ini": 39, "tcu_fin": 122}
> ```
>
> **El corte del bloque A/B es exactamente el borde entre los dos gateways.** Y
> con él, el reparto que se pidió el 2026-10-01 ya se puede hacer:
>
> ```
> node tools/stow_desde_scada.mjs <carpeta> \
>      --mapa SCADA/tools/tcu-toolbox/plantas/24019-san-jose.json --ncu 18
>
>   gateway  TCU  stows  vel med °/s  55°(s)   B· pet→sec5   C· AUTO→arranque   fallos
>   GW1       38      0           —       —   —             —                  13 sobre 11 TCU
>   GW2       84     75      0,1816     303   39,0 (34–45)  0,5 (−17,2–51,6)    0 sobre 0 TCU
> ```
>
> **LOS 13 FALLOS ESTÁN TODOS EN GW1. LOS 75 STOWS VÁLIDOS, TODOS EN GW2.** Ni una
> excepción en ninguno de los dos sentidos. Eso contesta el punto 2 del encargo
> del 01-10 —«comprueba si los fallos caen en el gateway 1»— y habilita el 3: **el
> número publicable es el del gateway sano.**
>
> **TRES COSAS QUE EL FICHERO DE REPARTO ENSEÑA**, y que no estaban escritas:
>
> * son **TRES niveles**, TCU → GW → NCU. Una NCU tiene VARIOS gateways, así que
>   «gateway» y «NCU» **no son sinónimos**: en San José hay 21 NCU y 34 parejas
>   NCU+GW nombradas. Donde este documento usaba los dos términos como uno,
>   estaba mal;
> * el gateway se distingue por el **PUERTO MODBUS** sobre la misma IP: 503 es
>   GW1 y 504 GW2. La IP identifica la NCU, el puerto el gateway;
> * el reparto es por **rango contiguo** de número de TCU, no por una lista.
>
> **DE QUÉ NCU SALE EL FICHERO, dicho con su condicional.** El volcado trae TCU 1
> a 122 sin huecos. Dos NCU de San José tienen GW1 = 1–38: la **11** y la **18**.
> Sólo la 18 tiene GW2 llegando a **122** (la 11 acaba en 118), así que el único
> candidato compatible con los tres números —122 en total, corte en 38, bloque
> sano de 84— es **San José NCU 18**. Es una **identificación por coincidencia
> numérica, no un dato recibido**, y por eso va dicha así y hay que confirmarla.
> **Lo que NO depende de confirmarla**: las dos candidatas coinciden en que
> **TCU 1–38 es el primer gateway**, así que la atribución «bloque B = GW1» vale
> igual cuál de las dos sea.
>
> **UN AJUSTE DESCARTADO POR SENTIDO.** De los 76 ajustes que pasan las guardas,
> uno tiene velocidad **negativa**: la **TCU 16** (GW1), −0,1932 °/s con R²
> 0,9992. Un ajuste excelente a un movimiento **en el sentido contrario al stow**.
> Las guardas de racha miran AMPLITUD y AJUSTE, que son magnitudes sin signo, así
> que un tramo que se mueve al revés las pasa. Ahora se filtra y **se publica el
> descarte** en vez de tirarlo callando. Que el único ajuste no físico esté en el
> gateway averiado no es casualidad que este documento vaya a explicar.
>
> **Y LO QUE ESTO SIGUE SIN DECIDIR, que es el punto 4 del encargo:** POR QUÉ
> falla GW1. La exportación de TCU **no trae ni una magnitud de radio**, así que
> cruzar el retardo de cada TCU con su RSSI y sus saltos **sigue siendo
> imposible** y radio-contra-equipo sigue abierto. Para eso hace falta el volcado
> del inventario (`zigbee_inventario.ps1`, bloque 8a), que trae RSSI y LQI por
> nodo — y que, comprobado el 2026-10-03, **nadie ha ejecutado todavía**.

Ni una sola excepción en ninguna de las cuatro columnas: **cero TCU del bloque A
por debajo de 1.000 filas, cero del B por encima**, las 75 medidas en A y los 13
fallos en B. Y el bloque B **no existe en el fichero antes de las 13:47:44**:
sus primeras filas aparecen 23 a las 13 h, 13 a las 14 h y 2 a las 15 h.

#### Lo que sí se confirma, y lo que NO

**SE CONFIRMA que hay una parte mala y otra sana**, y que la mala se lleva
**todos** los fallos: 13 eventos `Failed to set the security position` sobre 11
TCU, las 11 en el bloque B, ninguna en A.

**SE CONFIRMA que el gateway 1 está averiado**, y con medida directa, no por
indicio — `NCU_2026-09-24.csv`, 71.625 filas:

```
  gw1_online false   6.202 de 71.625  =  8,66 %
  gw2_online false      20 de 71.625  =  0,03 %      ← factor 310
  «Restarting gateway thread for gateway 1»   228 veces
  «... para el gateway 2»                       0 veces
```

**PERO NO SE CONFIRMA QUE ESO EXPLIQUE EL STOW, y hay dos hechos en contra:**

1. **La avería del gateway 1 termina cinco horas antes.** Está confinada a
   00 h – 09 h; el último reinicio de hilo es a las **09:48:58**, y de las 10 h
   en adelante `gw1_online` está **al 100 %**.
2. **Durante todo el stow los dos gateways estaban arriba.** En la ventana
   14:40–15:20, de 2.401 filas de la NCU, `gw1_online` sale `false` **cero
   veces**, y `gw2_online` también cero. Y en cada uno de los 13 fallos —de
   14:42:54 a 16:13:25— el gateway 1 figura **en línea**.

Así que el bloque B tiene un problema real, pero **no es la caída del gateway 1
tal como la registra la NCU**. Puede ser radio del gateway 1 sin que el enlace
con la NCU se caiga —`gw1_online` mide que el gateway responde, no que alcance
a sus nodos—, y eso es compatible con todo lo anterior; pero **de este fichero
no sale**.

#### Y el reparto por gateway NO SE PUEDE HACER: falta el mapa

**No hay ningún fichero en esta cartera que diga qué TCU cuelga de qué
gateway.** Se ha buscado:

* el **log de eventos** nombra gateways (`gateway 1`, IP `10.21.236.87` y
  `.88`) pero **nunca liga una TCU a uno**;
* el **`NCU_*.csv`** da `gw1_online` / `gw2_online`, que es estado del gateway,
  no reparto de nodos;
* el **único inventario con campo `gw`**, `Cobertura-Zigbee/elburgo_real.geojson`,
  dice **`NCU1-GW2` en sus 52 nodos TCU, sin excepción**, con etiquetas **57 a
  108**: cubre parte del bloque A y **cero del bloque B**.

Identificar el bloque B con el gateway 1 **por ser los índices bajos** sería
adivinarlo por el número, que es exactamente lo que este documento no hace.
**Queda pendiente y se pide: el reparto TCU → gateway de esa NCU.** Con él, el
§2.4 ter se recalcula en una tarde.

#### LA EXPORTACIÓN DE TCU NO CONTIENE NINGÚN OBSERVABLE DE RADIO

**Y esto no es una impresión: es el inventario de las 27 columnas.**

```
 1 datetime                      15 motor_current
 2 main_state                    16 motor_current_peak
 3 backtracking                  17 motor_state
 4 wind_from_east                18 motor_pwm
 5 active_security_position      19 daily_motor_power_consumption
 6 angle                         20 pcb_temp
 7 target_angle                  21 battery_temp
 8 soc                           22 alarms_1
 9 remaining_capacity            23 alarms_2
10 ps_voltage                    24 hw_alarms
11 ps_current                    25 system_monitor_status
12 voltage                       26 system_monitor_flags
13 current                       27 power_section_alarms
14 motor_voltage
```

Y el `NCU_*.csv`, ocho: `datetime`, `mqtt_online`, `gw1_online`, `gw2_online`,
`ups_power_ok`, `ups_battery_low`, `stop_button`, `bluetooth_enabled`.

**Ni RSSI, ni LQI, ni SNR, ni número de saltos, ni contador de reintentos o de
ACK fallidos, ni canal, ni PAN.** Nada de radio, en ninguno de los dos ficheros.

**La consecuencia, y es la que decide cómo se lee todo el apartado:** la única
magnitud con la que se podría razonar sobre radio es **«¿llegó el sondeo?»**, y
eso **mezcla** propagación con firmware del gateway, con el enlace NCU↔gateway,
con la configuración de sondeo y con el estado de alta de cada TCU. Así que
**este fichero no puede decidir si el gateway 1 va mal por RADIO o por EQUIPO**,
se mire como se mire — y por tanto **no puede valer como medida de cobertura
degradada**, que sería su uso más valioso si la causa fuera radio.

**Las huellas que sí hay apuntan a los dos lados, y se dejan escritas sin
concluir:**

| hacia RADIO | hacia EQUIPO o CONFIGURACIÓN |
|---|---|
| dentro del bloque B la degradación es **graduada**: 21, 24, 25 … 117, 175 filas/día, factor **8,3** repartido suave. Una avería de equipo suele ser un interruptor; un presupuesto de enlace da un continuo | la separación **entre** bloques es bimodal **sin solape**: la mediana del A es **19,3×** el máximo del B. La propagación da un continuo, no un corte limpio entre la TCU 38 y la 39 |
| y el gradiente **no sigue el número de TCU**: correlación índice ↔ filas/día en el bloque B, **r = 0,29** | `gw1_online` y los 228 reinicios de hilo miden el enlace **NCU↔gateway**, que no es propagación a las TCU |
| las 38 son **intermitentes** tras aparecer: mediana de **9 huecos de más de 10 min** por TCU | la avería es un **escalón**: se acaba a las 09:48:58, con un único pico aislado de 17 s a las 11:40:38–11:40:54, y nada más. La propagación no se cura a una hora y se queda curada |
| **ninguna alarma distingue** al bloque B: las que reportan publican la misma combinación que el A. Su problema es que las alcancen, no su propia salud | **cuatro horas sin explicación**: de 09:48 a 13:47 el enlace del gateway 1 estuvo al 100 % y el bloque B produjo **cero filas** |

Y el contraste más limpio del fichero, que vale para las dos columnas: en las 9
horas en que el enlace del gateway 1 se caía el 15–23 % del tiempo, el **bloque
A promedió 1.783 filas por TCU** —el **165 %** de lo que daría una rejilla de
30 s— y el **bloque B produjo 0, las 38**.

**Lectura, dicha como lectura:** son probablemente **dos capas y dos causas** —
un fallo de equipo o de enlace en el gateway, que es lo que `gw1_online` mide y
es un escalón que se cura; y un gradiente por TCU dentro del bloque B que
parece calidad de enlace. No se pueden separar con esto, y las cuatro horas de
enlace sano con bloque B mudo dicen que hay **al menos un tercer factor**.

#### LO QUE ZANJARÍA LA PREGUNTA, y es barato — **PEDIDO AL PROPIETARIO**

Pedido explícitamente por Iñaki el 2026-10-01. Los útiles ya existen en la
cartera; lo que falta es el volcado.

| qué | de dónde | para qué |
|---|---|---|
| **volcado del inventario Zigbee** | `Cobertura-Zigbee/zigbee_inventario.ps1` (bloque 8a) | trae **RSSI y LQI por nodo**, que es exactamente el observable que falta arriba |
| **o el registro de rutas** | `Cobertura-Zigbee/zigbee_routes_logger.ps1` | trae **rutas y saltos**, el otro observable |
| **el mapa TCU → gateway** | de esa NCU, declarado | sin él no se puede separar lo que falla de lo que no |

Los dos `.ps1` corren en el PC de planta con **Windows PowerShell 5.1, sin
instalar nada y sin admin**, que es la restricción de campo ya fijada.

**Y qué cambia si llegan.** Con el mapa, el §2.4 ter se recalcula separado por
gateway en una tarde. Con RSSI o saltos, la pregunta «radio o equipo» se
contesta; y **si sale radio, este fichero deja de ser inservible y pasa a ser
una medida de cobertura degradada con 38 nodos**, que es un dato que la cartera
no tiene por ningún otro sitio. Sin ellos, la pregunta no es contestable y la
latencia no vuelve.

#### El cruce con RSSI y saltos del inventario que SÍ existe, tampoco sirve

`Cobertura-Zigbee/elburgo_real.geojson` **sí** trae `rssi_med_dbm`,
`hop_tipico` y `ack_failures` por nodo. No se cruza, por dos motivos, y los dos
son de identidad del dato:

1. **Cubre etiquetas 57–108**, o sea **ninguna del bloque B** — justo el bloque
   cuyo retraso habría que explicar.
2. **La exportación del stow no declara su planta**, y la NCU de la que sale
   tiene **122 TCU**, mientras este documento registra las NCU de El Burgo a
   ~108. Cruzarlos por número de TCU sería unir dos conjuntos por una identidad
   **no verificada**, y el resultado tendría pinta de medido sin serlo.

#### Qué queda, entonces, sin publicar

**La latencia de reparto, la dispersión entre TCU y la tasa de fallo NO se
publican** hasta tener el mapa de gateways. Lo que se midió, para que no haya
que volver a derivarlo, con la advertencia puesta:

| tramo | n | mediana | p05 | p95 |
|---|---:|---:|---:|---:|
| **A**· petición → arranque del giro | 75 | 1.231 s | 108 s | 1.816 s |
| **B**· petición → `sec = 5` visto | 75 | 39 s | 35 s | 44 s |
| **C**· primera muestra en AUTO → arranque | 75 | −2,7 s | −16,1 s | +13,0 s |

```
spans del evento, TODOS del bloque A
  ordenes de la NCU, TCU a TCU        46 s   (14:44:22 → 14:45:08)
  ACUSE sec=5 de las 75               41 s   (14:45:01 → 14:45:42)
  paso a AUTO de esas mismas 75    1.790 s   (14:45:54 → 15:15:44)
  primer arranque - ultimo         1.802,6 s (14:45:46 → 15:15:48)
```

**Un dato de esa tabla merece leerse aunque el resto espere**, porque va en
contra de lo que la primera versión de este documento concluyó: **los 30
minutos de dispersión no están en el reparto de la orden, están en el paso a
AUTO**. La orden se acusó en las 75 TCU en **41 segundos**; el paso a AUTO de
esas mismas 75 se estiró **1.790 s**. Los dos números salen del **mismo bloque
A**, el que no tiene ni un fallo, así que la diferencia entre 41 s y 1.790 s no
la explica ningún gateway: la explica que el paso a AUTO lo hace **una persona,
grupo por grupo**.

Eso **no** se publica todavía como «el reparto típico» —es un evento, una
planta, una NCU con incidencia declarada—, pero sí marca dónde habrá que mirar
cuando llegue un fichero de una instalación sana.
#### Las órdenes que fracasaron — **TODAS del bloque B, NO es una tasa de fallo**

> Lo que sigue **no se puede leer como «13 de 122 fallaron»**, y ése fue el
> error de la primera versión. Los 13 eventos caen **sin excepción en el bloque
> B**, que es también el que no aporta ni una sola medida. Sobre el bloque A —
> las 84 TCU con sondeo normal y las 75 medidas— los fallos son **cero**.
>
> Un denominador de 122 mezcla dos poblaciones que el propio fichero separa. La
> tabla queda como **descripción del bloque B**, no como tasa del producto.

`Failed to set the security position for TCU N`: **13 en el día, sobre 11 TCU
distintas** (la 13 y la 10 fallan dos veces). De ellas:

* **2 no son del stow**: TCU 22 (14:42:54) y TCU 24 (14:43:11) fallan sobre una
  petición de **posición 0**, del ciclo anterior.
* **11 son del stow**, sobre **9 TCU**: 9, 10, 11, 13, 21, 23, 25, 36, 38.

| TCU | falló | reintento en el log | primer `sec = 5` después | ¿giró? |
|---:|---|---|---|---|
| 13 | 14:44:55 | sí, +3.210 s | 15:39:11 (+3.256 s) | sí, 109° |
| 21 | 14:48:15 | no | 14:49:11 (+56 s) | sí, 87° |
| 9 | 14:50:26 | no | 14:55:38 (+312 s) | **no** |
| 23 | 14:54:41 | no | 14:54:54 (+13 s) | sí, 86° |
| 25 | 14:55:57 | no | 14:56:12 (+15 s) | sí, 102° |
| 11 | 15:01:00 | no | 15:39:55 (+2.335 s) | sí, 110° |
| 36 | 15:02:11 | no | 15:02:42 (+31 s) | sí, 110° |
| 38 | 15:12:18 | no | 15:12:44 (+26 s) | **no** |
| 10 | 15:17:56 | sí, +3.328 s | 16:28:28 (+4.232 s) | sí, 110° |
| 13 | 15:38:26 | no | 15:39:11 (+45 s) | sí, 110° |
| 10 | 16:13:25 | no | 16:28:28 (+903 s) | sí, 110° |

**Las once acabaron en `sec = 5`.** Ninguna se quedó sin recibir la orden. Pero
la última lo hizo **70 minutos** después de su primer fallo, y **sólo dos de las
once tienen un reintento escrito en el log**: las demás llegaron sin que nada
registre por qué.

**Y las 38 del bloque B acabaron todas en `sec = 5`**, repartidas entre las
14:42:54 y las 16:30:39. Contra eso, las 75 del bloque A acusaron la orden en
una ventana de **41 segundos**. Son dos poblaciones, no una cola.

> **Lo que ESTO NO ES: el p100 del encargo.** La primera versión de este
> apartado decía que «el p100 de verdad» eran los 70 minutos de la TCU 10. Es
> falso como característica del sistema: es el p100 **de un bloque cuya avería
> no está diagnosticada**, medido el día en que ese bloque apareció en el
> fichero a las 13:47. El p100 de una instalación sana **no está medido**, y
> este documento no lo da.

#### El denominador, al lado del número y no en una nota

```
122   ficheros TCU en la exportacion
 -38  BLOQUE B entero (TCU 1-38): 21 a 175 filas en TODO el dia, y ninguna
      antes de las 13:47. Sin muestras no hay giro que ajustar.
 ---
  84  bloque A
  -1  con giro ajustable que NO es un stow (TCU 84, ver abajo)
  -8  con filas pero sin giro ajustable, o R^2 < 0,98
 ---
  75  STOWS MEDIDOS,  75 de 84 del bloque A  =  89 %
```

**El denominador honesto es 84, no 122**, y decirlo así importa: sobre las TCU
que el SCADA sondea de verdad, el método mide el **89 %**. El bloque B no se
«perdió» por el método — no hay nada que medir en 64 filas al día.

**Y sigue siendo un solo evento, de una sola planta, en una NCU con incidencia
declarada.** El 89 % es el rendimiento del método sobre este fichero, no una
cobertura esperable en general.

**TCU 84, nombrada.** Es el único caso del día entero que **nunca alcanza
`active_security_position = 5`**, y no aparece **ni una sola vez** en el log de
eventos de la NCU: ni petición, ni fallo, ni nada. No es una TCU sorda —tiene
**3.380 filas**, cadencia normal—. A las 15:15:03 pasa a AUTO y gira 46,3° a
0,1630 °/s con R² = 0,9989 hacia `target_angle = +55`, que es **la vuelta al
seguimiento, no el stow**. Un ajuste impecable sobre el giro equivocado: por eso
el útil ata el ajuste a la racha de `sec = 5` y por eso ésta es la única que la
atadura expulsa.

**TCU 17**, de paso: tampoco aparece en el log, tiene 21 filas en todo el día, y
alcanza `sec = 5` a las 15:26:10 sin que ninguna petición lo explique. Se queda
en MANUAL y no gira.

#### La trampa que se comió la primera lectura de estos datos

`active_security_position` muestra **5 durante un único sondeo** en momentos en
que no hay stow ninguno. En este fichero pasa **84 veces**, y **82 de esas 84
caen en el mismo segundo (±1 s) que una `Requesting safe position 0`** del log
— la orden **contraria**.

**No se afirma por qué.** La correspondencia está medida; el mecanismo que la
produce no se deduce de estos ficheros y aquí no se nombra. Para descartarlas
basta el hecho de que duran **un** sondeo.

Leer «la primera vez que aparece un 5» como el arranque adelanta el reloj **dos
minutos** y sitúa el arranque **antes de que el operador pulsara nada**. Es la
séptima lección con otro traje: un valor presente se lee como el valor que se
buscaba.

---

### 2.5 La cadena, junta

```
  deteccion      1 - 60 s     DECLARADO (defectos de fabrica)
  decision NCU      ?         NO MEDIDO
  radio          < 30 s       COTA, y solo sobre el BLOQUE SANO de un unico
                              evento: las 75 TCU acusaron la orden antes del
                              sondeo siguiente, en una ventana de 41 s. Por
                              debajo de un periodo de sondeo no se resuelve.
                              NO es la latencia de la planta: ver el §2.4 ter.
  giro             303 s      MEDIDO, mediana de 75 stows (55 grados a
                              0,1816 deg/s). Rango p05-p95: 290-315 s.
                              Es el unico termino que no depende del estado
                              de la instalacion.
  ---- LO QUE SIGUE SIN MEDIR, y no por falta de fichero ----
  latencia de reparto real     pendiente del mapa TCU -> gateway (§2.4 ter)
  p100 hasta la ultima TCU     idem
  tasa de fallo de orden       idem
```

**El rango 275–825 s del giro queda RETIRADO** (§2.4). No era una horquilla
física: era la distancia entre dos lecturas que no declaraban su definición.
Con 75 ajustes sobre el mismo evento, el término vale 303 s y su dispersión
real es de ±6 %.

**Y lo que este apartado NO puede decir todavía.** Una versión anterior
concluía aquí que «la radio no explicó ni uno de los 30 minutos» del reparto.
Eso se apoyaba en un evento de una NCU con **incidencias declaradas**, y con
las dos poblaciones del fichero mezcladas. Separadas (§2.4 ter), lo que queda
es un indicio fuerte —en el bloque sano, 41 s de acuse contra 1.790 s de paso a
AUTO— y **no una conclusión de fase**. Para eso hace falta **otro stow, de una
instalación sin incidencia**, y el útil para medirlo ya está escrito.

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

#### 3.0 bis Lo que la norma le permite al Zigbee — **leída** (2026-10-03)

**Fuente:** `ETSI EN 300 328 V2.2.2 (2019-07)`, bajada de etsi.org. Zigbee es
**no-FHSS** (DSSS), así que le aplica la **cláusula 4.3.2**, no la 4.3.1 de
salto de frecuencia. El PDF **no va al repositorio**; va su sha256 en
`radio_params.json`.

| | límite | cláusula |
|---|---|---|
| banda | 2 400 – 2 483,5 MHz | — |
| potencia RF | **≤ 20 dBm e.i.r.p.** | 4.3.2.2.3 |
| densidad espectral | **≤ 10 dBm/MHz** | 4.3.2.3.3 |
| ciclo de trabajo | **sólo si NO es adaptativo** · `Tobs` = **1 s** · Tx-sequence ≤ 10 ms · Tx-gap ≥ la secuencia previa, mínimo 3,5 ms | 4.3.2.4 |
| *Medium Utilization* | `MU = (Pout/100 mW) × DC` **≤ 10 %** · no aplica a adaptativo ni por debajo de 10 dBm | 4.3.2.5 |
| adaptividad (LBT) | CCA ≥ **18 µs** · ocupación de canal **1–10 ms** + reposo ≥ 5 % · umbral **−70 dBm/MHz** a 20 dBm | 4.3.2.6.3 |
| **señalización de control corta** | **≤ 10 % en cualquier ventana de 50 ms, SIN escuchar el canal** | 4.3.2.6.4.2 |

**Tres cosas que esto cambia:**

**1 · La ventana de observación es de UN SEGUNDO, no de una hora.** En 868 el
ciclo se mide sobre `Tobs = 1 h` (EN 300 220-1 §5.4.1); aquí sobre **1 s**. Son
restricciones de naturaleza distinta: allá un presupuesto a largo plazo, aquí
una ocupación instantánea. **Comparar «1 %» de una banda con «10 %» de la otra
sin decir sobre qué ventana es mezclar dos magnitudes que sólo comparten el
símbolo de porcentaje.**

**2 · Al Zigbee no le aplica el ciclo de trabajo.** La cláusula 4.3.2.4.1 lo
limita a equipo **no adaptativo**, y Zigbee hace **CSMA/CA, que es LBT**. Es el
mismo patrón que el acceso educado de 868 — pero aquí lo adaptativo es la norma,
no la excepción, así que **no hay presupuesto acumulado que limite el ritmo**.

**3 · Y el *Medium Utilization* compra tiempo con potencia.** `MU = (Pout/100 mW)
× DC ≤ 10 %` significa que a **20 dBm** el ciclo queda acotado al 10 %, a
**10 dBm** la fórmula da `DC ≤ 100 %` —sin restricción práctica— y **por debajo
de 10 dBm el requisito no aplica**. Bajar potencia compra ritmo, explícitamente.

> **Y LA PIEZA QUE IMPORTA PARA EL STOW.** La cláusula 4.3.2.6.4 define
> *«Short Control Signalling Transmissions»*: control y gestión **sin escuchar
> el canal**, hasta un **10 % en cualquier ventana de 50 ms**. **Una orden de
> stow es exactamente eso** — control, corta, rara. A 2,4 GHz tiene **vía
> regulatoria propia**, que es la contrapartida de lo que en 868 se resuelve con
> clase C multicast.

#### 3.3 Los tres regímenes, juntos — y lo que sólo se ve al cruzarlos

| | **2,4 GHz** · Zigbee | **868 MHz** · LoRa y Wi-SUN |
|---|---|---|
| norma | EN 300 328 V2.2.2 | EN 300 220-1/-2 |
| potencia máx | **100 mW** (20 dBm) | 25 mW · **500 mW** sólo en 869,400–869,650 |
| **ventana de observación** | **1 segundo** | **1 hora** |
| ciclo de trabajo | sólo si **no** adaptativo | 0,1 / 1 / 10 % **según sub-banda** |
| la alternativa | adaptividad (LBT/DAA): **sin presupuesto acumulado** | acceso educado: **100 s/h por 200 kHz** |
| máximo por transmisión | ocupación de canal **1–10 ms** | **1 s** (4 s en diálogo) |
| vía para una orden de control | **señalización corta, sin CCA** | clase C multicast (LoRa) · MPL (Wi-SUN) |

**EL RESULTADO, que no está en ninguna de las dos normas por separado:**

El Zigbee de hoy sondea cada TCU **cada 18 s** —medido el 2026-09-24, 80 de 84
TCU en ese valor exacto—. A 2,4 GHz **nada en la norma le pone techo a ese
ritmo**: lo que lo limita es la ocupación instantánea y la contienda del medio,
que son problemas de diseño de red, no de regulación.

En 868, **los mismos 18 s obligan a SF ≤ 8** con ciclo del 1 %, o **SF ≤ 10**
con acceso educado (§3.2). Y ahí **LoRa ya no tiene los 16 dB** de ventaja en
sensibilidad, que vivían en SF12 (§3.1).

> **Así que el salto a sub-giga no es sólo un cambio de alcance: es un cambio de
> régimen regulatorio que acota el ritmo.** Esa es la frase que el §6 necesita, y
> no sale de comparar sensibilidades: sale de comparar las dos normas.

**Lo que esto NO dice**, y conviene fijarlo: ninguna de las dos normas dice cada
cuánto puede hablar *la flota*. Acotan potencia y ocupación por equipo. El ritmo
agregado lo decide el diseño de la red —unicast contra broadcast, profundidad de
malla, contienda—, y eso sigue siendo lo del §2.3 y el cronómetro del §5.

### LoRa EU868

* Clase C multicast: el nodo escucha siempre, así que la orden llega en una
  emisión sin esperar ventana.
* **El duty cycle del 1 % en EU868 limita al emisor, no al receptor.** Para una
  orden de stow —rara, corta y unidireccional— eso no muerde; para los
  reintentos sí.
* Sin enrutado multisalto: cobertura directa NCU→TCU o nada, lo cual traslada
  el problema al presupuesto de enlace, que es justo lo que el motor de
  `radio_pv_model.js` ya sabe calcular.

#### 3.1 LoRa contra Wi-SUN, con los dos extremos — **y el orden se da la vuelta**

**La pregunta que esto contesta:** la sensibilidad del módulo que se montaría no
está publicada. Lo que sí hay son dos extremos — el **chip** como cota superior
y el **módulo real por debajo, en una cantidad que nadie cuantifica**. Si el
orden frente a Wi-SUN cambia entre uno y otro, eso es el resultado. **Cambia.**

**Procedencia, y es distinta de la del resto del documento.** Las 25 filas de
Wi-SUN las leyó esta sesión de las hojas de Silicon Labs y TI. Las 9 de LoRa
**las leyó el propietario** del `SX1272/73 Rev. 3.1 (marzo 2017)`, porque el
proxy deniega `semtech.my.salesforce.com`. Va escrito en cada `_cita` con el
campo `leido_por`.

**Careo a tasas comparables.** LoRa compra sensibilidad con tasa, así que
compararlos a secas no dice nada: cada fila va con la suya.

| LoRa SX1272 (cota) | Wi-SUN, lo mejor a tasa parecida | margen a favor de LoRa |
|---|---|---:|
| SF6 / BW 500 · **37.500 bps** · −116 | FG25 #1a 50.000 bps con FEC · −114,1 | **+1,9 dB** |
| SF6 / BW 250 · 18.750 bps · −119 | FG25 #1a 50.000 bps con FEC · −114,1 | +4,9 dB |
| SF6 / BW 125 · 9.380 bps · −122 | CC1312R7 2-GFSK 5.000 bps · −119 | +3,0 dB |
| SF12 / BW 500 · 1.172 bps · −131 | CC1312R7 2-GFSK 2.500 bps · −121 | +10,0 dB |
| SF12 / BW 250 · 586 bps · −134 | CC1312R7 2-GFSK 2.500 bps · −121 | +13,0 dB |
| SF12 / BW 125 · **293 bps** · −137 | CC1312R7 2-GFSK 2.500 bps · −121 | **+16,0 dB** |

Son **las seis filas sin FEC que la hoja publica**, no una selección. Las otras
tres del extracto son las de `CR 4/5` (−136 / −133 / −130), que mueven cada
margen 1 dB a la baja y no cambian ninguna de las dos conclusiones.

**EL RESULTADO, y es doble:**

1. **Donde LoRa va lento, el orden aguanta.** A 293 bps le sobran **16 dB**.
   Ninguna degradación de módulo plausible se come eso, así que ahí LoRa gana
   diga lo que diga la hoja del módulo.
2. **Donde LoRa va rápido, el orden NO está determinado.** A 37.500 bps el
   margen es **1,9 dB**. Un módulo que pierda dos decibelios respecto a su
   integrado —que es exactamente lo que RF Solutions avisa en la p. 4 de su
   propia hoja, «in practice the Module RF performance is considerably lower»—
   **invierte el orden**. Y nadie ha cuantificado esa pérdida.

#### El criterio de la tabla LoRa NO LO PUBLICA LA HOJA — y eso es un hallazgo

**No es una omisión nuestra ni algo que quede por preguntar.** Buscado sobre el
documento: **la tabla de sensibilidad LoRa del `SX1272/73 Rev. 3.1` no declara
criterio de medida junto a la tabla**. El criterio que la hoja sí declara es el
del modo **FSK**, que es otra magnitud y no sirve para estas filas.

Las 25 filas de Wi-SUN de este repositorio sí lo llevan —`BER = 1e-2`,
`10 % PER`, `1 % PER con 127 octetos`—, porque sus hojas lo publican. Las 9 de
LoRa quedan con `criterio: null` **porque el fabricante no lo da**, y eso es
distinto de un dato pendiente.

**LA CONSECUENCIA, Y ES LA QUE DECIDE: el margen de 1,9 dB NO decide.** Se
publican **las dos lecturas, sin elegir**, porque elegir una sería inventar el
campo que falta:

| a 37.500 bps, si el criterio de LoRa fuese… | LoRa normalizado | Wi-SUN FG25 #1a con FEC, `10 % PER` | quién gana |
|---|---:|---:|---|
| **`10 % PER`** (el mismo que Silabs) | −116,0 | −114,1 | **LoRa, por 1,9 dB** |
| **un `BER` comparable al de TI** | −113 a −114 | −114,1 | **Wi-SUN, por 0,1 a 1,1 dB** |

La corrección va en ese sentido y no en el contrario: `10 % PER con 127 octetos`
es **2-3 dB más exigente** que `BER = 1e-2`, así que una cifra dada a BER es
**optimista** cuando se la compara con una dada a PER, y hay que penalizarla
para ponerlas en el mismo plano.

**Así que en el extremo rápido el orden lo decide un campo ausente, no la
radio.** Publicarlo como «LoRa gana» sería exactamente el sesgo invisible contra
el que se creó el campo `criterio`.

#### El de 16 dB sí se sostiene, y en los dos escenarios

A **293 bps** el margen aguanta la ambigüedad entera, así que esto sí se puede
afirmar:

| a 293 bps, si el criterio de LoRa fuese… | margen sobre Wi-SUN |
|---|---:|
| `BER`, el mismo que declara TI en esa fila | **+16,0 dB** |
| `10 % PER`, más exigente que el de TI | **+18 a +19 dB** |

En el peor de los dos casos le sobran **dieciséis decibelios**. Ninguna
degradación de módulo plausible —ni la corrección de criterio, ni las dos
juntas— se come eso. **Donde LoRa va lento, gana, y no depende del dato que
falta.**

Lo que sí sigue colgando de ese margen es el precio: 293 bps son **1/8,5** de la
tasa de la fila de Wi-SUN con la que se compara. LoRa compra sensibilidad con
tiempo en el aire, y eso se paga en el ciclo de trabajo del 1 %.

#### Se buscó en otros documentos de Semtech, y tampoco

Antes de darlo por cerrado se intentaron los otros documentos que la propia hoja
del módulo enlaza, por si el criterio estuviera en una nota de aplicación:

```
semtech.com/apps/filedown/down.php?file=LoraDesignGuide_STD.pdf
semtech.com/images/datasheet/etsi-compliance-sx1272-LoRa-modem.pdf
semtech.com/uploads/documents/LoraDesignGuide_STD.pdf
```

Los tres acaban en `info.semtech.com/find-documentation`, **el mismo formulario
y los mismos 21.149 bytes**, y los ficheros viven detrás de
`semtech.my.salesforce.com`, que el proxy deniega con 403 en el CONNECT. **Queda
como vía abierta para quien sí alcance ese host**, y si el criterio aparece ahí
va citado como procedente de **ese** documento y no de la hoja.

**Lo que haría falta para cerrar el extremo rápido**, y ya no es «una línea de la
hoja» porque la hoja no la trae:

1. **El criterio de medida, de otra fuente de Semtech** — nota de aplicación,
   guía del modem LoRa o la respuesta de su soporte. Citado como procedente de
   **ese** documento, nunca de la Rev. 3.1.
2. **O medir** una de las dos tecnologías contra la otra con **un criterio
   propio y declarado**, que es lo que de verdad zanja una comparación entre
   fabricantes.

Y aparte, para el candidato real: la **sensibilidad del módulo por SF**, que RF
Solutions no publica y habría que pedirle o medir.

**Mientras tanto, lo que se puede afirmar sin ninguna de esas tres cosas:** que
a tasa baja LoRa gana con dieciséis decibelios de holgura, y que a tasa alta
**el orden no está determinado**. Las dos frases son publicables hoy; «LoRa es
mejor» a secas, no.

**Lo único medido del módulo**, y no es sensibilidad: su propio ensayo de
alcance, **12,05 km con línea de vista**, con antena de hilo sin plano de masa y
placa rudimentaria, y con el límite dicho por ellos —se quedaron sin terreno, no
sin alcance—. Sirve de orden de magnitud y de contraste, no de parámetro.

#### 3.2 Cada cuánto puede hablar — **la norma, leída** (2026-10-03)

**Fuentes, y esta vez sí se han podido bajar:** `ETSI EN 300 220-2 V3.2.1
(2018-06)` y `EN 300 220-1 V3.1.1 (2017-02)`. La parte 2 cita **esa misma
versión** de la parte 1 como referencia normativa, así que el par es
consistente. Los PDF **no van al repositorio** (ETSI prohíbe la reproducción);
va su sha256 en `radio_params.json`.

**RETRACTACIÓN DE UN SUPUESTO PROPIO.** Un cálculo anterior de esta fase daba
«periodo mínimo al 1 %» como si el 1 % fuera la regla. **No lo es, de dos
maneras.**

**Primera: no hay un solo valor.** Tabla B.1, **normativa**, de la Decisión
2017/1483/UE:

| banda | rango | e.r.p. máx | acceso al canal |
|---|---|---:|---|
| K | 863–865 MHz | 25 mW | **≤ 0,1 %** o acceso educado |
| L | 865–868 MHz | 25 mW | **≤ 1 %** o acceso educado |
| M | 868,000–868,600 | 25 mW | **≤ 1 %** o acceso educado |
| N | 868,700–869,200 | 25 mW | **≤ 0,1 %** o acceso educado |
| **P** | **869,400–869,650** | **500 mW** | **≤ 10 %** o acceso educado |
| P | 869,700–870,000 | 5 mW | **sin requisito** |
| Q | 869,700–870,000 | 25 mW | **≤ 1 %** o acceso educado |

Esto **vale igual para Wi-SUN FAN**: es la misma banda, la misma tabla.

**Segunda: el ciclo puede no aplicar.** §4.3.3.0, literal:

> *«Duty cycle applies to all transmitters **except EUT with polite spectrum
> access** (described in clause 4.5) **where permitted** in annex B, table B.1»*

Y §4.5.2.0: *«…**instead of** duty cycle where permitted by table B.1»*. El
acceso educado (LBT + AFA) **sustituye** al ciclo, no se suma.

**El presupuesto de cada régimen**, con `Tobs = 1 hora` (EN 300 220-1, §5.4.1):

```
ciclo  0,1 %      3,6 s de aire por hora
ciclo  1 %         36 s/h
ciclo 10 %        360 s/h      y en esa sub-banda, ademas, 500 mW
educado           100 s/h POR CADA 200 kHz   (EN 300 220-1, Tabla 48)
                  y su nota 3: «Longer accumulated transmission time is
                  possible by implementing more AFA channels»
```

**EL ACCESO EDUCADO DA CASI EL TRIPLE DE AIRE QUE EL 1 % — PERO PROHÍBE LOS
MODOS LARGOS.** Tabla 48 fija **`Ton Max` = 1 s** para una transmisión única (4 s
para un diálogo o secuencia de sondeo). Con los 44 octetos de carga útil que
declara `radio_params.json` y CR 4/5:

| modo | tiempo en el aire | con ciclo del 1 % | con acceso educado |
|---|---:|---|---|
| **SF12 / 125** | **2.138 ms** | 16,8 msg/h → uno cada **214 s** | **ILEGAL**, excede `Ton Max` |
| SF12 / 250 | 1.069 ms | 33,7 msg/h | **ILEGAL** |
| SF11 / 125 | 1.151 ms | 31,3 msg/h | **ILEGAL** |
| SF12 / 500 | 494 ms | 72,9 msg/h | 202 msg/h → uno cada **17,8 s** |
| SF10 / 125 | 534 ms | 67,3 msg/h | 187 msg/h |
| SF8 / 125 | 164 ms | 219 msg/h | 608 msg/h → uno cada **5,9 s** |
| SF6 / 125 | 51 ms | 701 msg/h | 1.948 msg/h |

**Los dos regímenes excluyen cosas distintas, y ése es el resultado:** con ciclo
de trabajo SF12/BW125 es legal pero deja la flota en **17 mensajes por hora**;
con acceso educado **no es legal en absoluto**, porque una sola transmisión de
2,1 s supera el máximo de 1 s.

> **Y CHOCA DE FRENTE CON EL §3.1.** Los **16 dB** de ventaja sobre Wi-SUN
> estaban justo en **SF12/BW125**, el único punto donde el orden se sostenía sin
> discusión. Ese punto **no es legal bajo acceso educado y es casi inusable bajo
> ciclo de trabajo.** Donde LoRa gana por sensibilidad, la norma no le deja
> hablar; donde la norma le deja hablar al ritmo de hoy, el orden frente a
> Wi-SUN **no está determinado** (§3.1).
>
> Dicho en una frase: **la ventaja de LoRa y su régimen legal viven en extremos
> opuestos de la misma tabla.**

**Contraste con lo que hay puesto.** El Zigbee actual sondea cada TCU **cada
18 s** —medido el 2026-09-24, 80 de 84 TCU en ese valor exacto— y a 2,4 GHz no
le aplica este régimen. Para igualar esos 18 s, LoRa necesita quedarse en SF ≤ 8
con ciclo del 1 %, o SF ≤ 10 con acceso educado. **Y ahí ya no tiene los 16 dB.**

**Y UNA COINCIDENCIA ENTRE DOCUMENTOS INDEPENDIENTES.** La sub-banda **P,
869,400–869,650 MHz**, es la que la norma premia: **500 mW e.r.p. y 10 % de
ciclo**. Es **exactamente** la sub-banda estrecha en la que el **EFR32FG28**
declara sus **+20 dBm** (Tabla 4.17, p. 48 de su hoja), ya anotada en su ficha
con el reparo de no aplicarlos a la banda general. Dos documentos que no se
citan entre sí, la misma sub-banda: ahora se entiende **por qué** el fabricante
la separa.

**Dos límites que NO se resuelven aquí:**

1. El presupuesto educado es **«por cada 200 kHz»**, y una señal LoRa de 250 o
   500 kHz ocupa **más de una** de esas porciones. La norma no dice cómo se
   reparte, y aquí no se interpreta.
2. **CEPT/ERC 70-03 sigue sin leerse** —`ecodocdb.dk` devuelve 403 en el CONNECT
   del proxy—. Es referencia **informativa** del Anexo C y da el estado de
   implementación por país; lo normativo de arriba no depende de él.

**Lo que sigue a `null` a propósito:** `plan_de_canal` y `canal`. La Tabla B.1
da **sub-bandas, potencia y ancho ocupado máximo**, que no es un plan de canal:
faltan la rejilla y las frecuencias centrales. Llenar uno con la otra sería
justo el tipo de salto que este documento no da.

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
   contra un giro **medido de 303 s** (§2.4) y una radio de segundos: si el
   camino autónomo
   es el que actúa, domina la cadena entera él solo. Bajarlo es **puro cambio
   de configuración**, sin tecnología nueva ni obra: de 10 min a 1 min quita
   **540 s** del peor caso cuando la radio falla.

   Lo que decide cuánto bajarlo **no es de radio**: es el compromiso entre
   bandera falsa por un corte transitorio —producción perdida— y bandera tarde
   —riesgo mecánico—. **Ese compromiso es de Iñaki, no mío.**

   **Y EL DATO QUE LO CONVERTIRÍA EN MEDIDA EXISTE, PERO NO ESTÁ AQUÍ.** Para
   decidirlo con números hace falta una sola cosa: **la distribución de la
   duración de los cortes**. Si los cortes transitorios duran segundos, bajar a
   1 minuto es gratis; si duran minutos, no lo es.

   Esa distribución sale del registro **`29500`** —«Unix Epoch timestamp of the
   last successful read of this TCU», 200 unidades, bloque `TCUs Last
   Comunication`—, que **el SCADA ya sondea cada 30 s**. Su histórico en
   InfluxDB *es* la medida. Nadie lo ha exportado a estos repos, así que aquí no
   se puede calcular; pero no hace falta instrumentar nada, sólo consultarlo.

   Lo que sí se ha podido medir aquí, y no basta: los cortes **no son raros y se
   concentran en pocos nodos**. `ack_failures` da un factor 86 entre el nodo
   mediano y el peor. Y hay una segunda fuente que lo corrobora — el campo `off`
   de `elburgo_zigbee_horario.json`, 24 valores por nodo —: su suma por nodo
   correlaciona con `ack_failures` a **r = +0,71** (n = 52, p ≈ 2e-12), y son
   ficheros distintos.

   **Pero de `off` no se puede sacar una duración, porque no se sabe qué mide.**
   Su generador no está en estos repos, nada lo consume y no está documentado.
   Se probó la lectura evidente —«fracción de la hora caído»— y **es falsa**:
   llega a 29,7, fuera de [0,1]. La lectura siguiente —porcentaje— encaja con el
   rango y con la correlación, pero encajar no es estar establecido. Queda como
   lo que es: un indicador ordinal de problemas de conexión por nodo, sin
   unidad.

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

> **Al día 2026-09-24.** La exportación del SCADA del §2.4 contestó **la mitad**
> de lo que este cronómetro venía a contestar: el giro ya está medido (303 s,
> 75 stows) y la radio tiene **cota** (menos de un periodo de sondeo). Lo que
> sigue sin resolverse es el **reparto por saltos** dentro de esa cota, que es
> lo único para lo que el D.2 sigue haciendo falta.
>
> **Y lo que de verdad falta no es un cronómetro: es un fichero limpio.** El
> stow del 2026-09-24 sale de una NCU con incidencias declaradas y con dos
> poblaciones de TCU dentro (§2.4 ter). **Un segundo stow, de una instalación
> sana, vale hoy más que el D.2**: el útil que lo analiza ya está escrito y
> probado (`tools/stow_desde_scada.mjs`), y con él se cierran de golpe el
> reparto, el p100 y la tasa de fallo. El D.2 sigue haciendo falta sólo para
> partir la cota de radio en saltos.
>
> **Y tres cosas que se piden con él**, pedidas por Iñaki el 2026-10-01 y
> detalladas en el §2.4 ter:
>
> 1. el **reparto TCU → gateway** de la NCU de la que salga, porque sin él no se
>    puede separar lo que falla de lo que no.
>
>    **CORRECCIÓN DEL 2026-10-03, y la hago porque este documento y yo dijimos
>    que ese reparto «no existe en ningún repo»:** el reparto **TCU → NCU** SÍ
>    existe, completo, en `Cobertura-Zigbee/config_tcu_sanjose.csv` (2.184 TCU
>    repartidas en 21 NCU, las 2.184 con NCU asignada) y en
>    `config_tcu_ayora.csv` (751 en 16). Lo que sigue sin existir es otra cosa, y
>    hay que decir cuál:
>
>    · **ese reparto no cubre la planta del stow**, porque este documento NUNCA
>      NOMBRA de qué planta salió el evento del 24-09 — dice «una planta, una NCU
>      con incidencia declarada» y nada más. Si fuera San José o Ayora, el mapa
>      ya está aquí;
>    · y **NCU no es necesariamente lo mismo que gateway**. El encargo habla de
>      «en esa NCU el primer gateway funciona mal», o sea de varios gateways
>      DENTRO de una NCU; si es así, `config_tcu_*.csv` da una granularidad más
>      gruesa que la que hace falta y no sirve para separar el gateway 1.
>
>    Las dos preguntas van al §5. Hasta contestarlas, lo honesto no es «no
>    existe» ni «ya está»: es que **existe un mapa, de dos plantas, a un nivel
>    que puede no ser el que se pide**;
> 2. un volcado de **`zigbee_inventario.ps1`** (bloque 8a) de esa NCU — trae
>    **RSSI y LQI por nodo**;
> 3. o de **`zigbee_routes_logger.ps1`** — trae **rutas y saltos**.
>
> Los dos últimos son el observable que **la exportación de TCU no tiene**: sus
> 27 columnas no incluyen ni una magnitud de radio (§2.4 ter), así que hoy no se
> puede decidir si el gateway 1 va mal por **radio** o por **equipo**. Y eso
> decide cuánto vale el fichero: si es radio, pasa a ser una medida de cobertura
> degradada con 38 nodos que esta cartera no tiene por otro lado.

**Es el árbitro para el tramo de radio, y hoy no existe.** Sin él, el §6 sería
un ranking de valores de catálogo.

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

   **Y con una resolución concreta que pedirle**: 10 s o menos. El SCADA ya
   sondea a 30 s y eso resuelve el giro pero no la radio, así que un cronómetro
   a 30 s no aportaría nada que no haya ya.
2. El canal Zigbee del bloque 8a. Sigue en `null` en `radio_params.json`, con
   su aviso: a canal 26 la potencia máxima cae a +3 dBm en las dos variantes,
   y eso cambia el alcance y por tanto la profundidad de la malla.

   **Se ha buscado un atajo y NO lo hay.** La TCU tiene el canal en vivo en su
   registro `30031` («Zigbee operating channel», bits 7:0), pero **la NCU no lo
   expone**: sus 22 registros por TCU son estado, ángulos, alarmas y batería.
   `radio_params.json` tenía razón — el canal sale del volcado del inventario
   (`zigbee_inventario.ps1`, bloque 8a) y de ningún otro sitio.

   **EL CANAL LO MARCA EL GATEWAY ZIGBEE** — dicho por Iñaki el 2026-10-03, y
   encaja con lo de arriba: si el coordinador forma la red y fija el canal, es
   coherente que la TCU lo tenga en vivo y la NCU no lo publique. Tres cosas que
   cambia, y la tercera es la que importa:

   · **para leerlo basta preguntar al coordinador**, no hay que recorrer la
     flota. Eso acota el bloque 8a a una consulta por gateway;
   · **el script ya lo captura.** Comprobado línea a línea el 2026-10-03:
     `zigbee_inventario.ps1` manda `query_setting` al gateway y vuelca la
     respuesta EN CRUDO (líneas 108-113), con `CH` e `ID` dentro; y de cada nodo
     aplana el XML a columnas con un recorrido genérico (`Aplana`, línea 82), así
     que `ajuste_ch` saldría sin nombrarlo. **Lo que falta no es código: es una
     ejecución** — en el repo hermano no hay ningún volcado de inventario;
   · **hay un canal POR GATEWAY, no uno por planta.** Medido en los layouts el
     2026-10-03: San José declara **21** NCU, Ayora 16, Panbianco 12, Benante 6,
     Páramo 4, El Burgo 2, Polvorín 2, y Bagnarelli, Fayón y Túnez 1. Así que el
     golpe de 16 dB del canal 26 caería sobre la **subred de ese gateway**, no
     sobre la planta entera, y **el veredicto de legalidad es por gateway**: en
     una planta de 21 coordinadores puede haber gateways que cumplen y gateways
     que no, a la vez. Donde este documento y `radio_params.json` decían «en toda
     la planta», estaba mal planteado.

   Y de ahí, **lo que sigue sin saberse y hay que preguntar**: si los gateways de
   una planta están fijados a un canal COMÚN o cada coordinador elige el suyo. En
   Zigbee puede ser lo segundo, y eso decide si el canal es un campo o son
   veintiuno. Las NCU de los layouts traen `x`, `n` y `name` y nada más: hoy no
   hay dónde guardar un canal por gateway.

---

## 6. Veredicto

### La cadena completa va PRIMERO, y no es decoración

Cualquier ranking de radio se lee mal sin esta tabla delante, porque la radio se
mueve en **segundos** dentro de una cadena cuyos otros tramos valen decenas y
centenares:

| tramo | cuánto | estado |
|---|---|---|
| **detección** | **1 – 60 s** según cuál de los tres caminos dispare | DECLARADO (defectos de fábrica) |
| **decisión de la NCU** | ? | NO MEDIDO |
| **radio hasta la última TCU** | **< 30 s**, y sólo sobre el bloque sano de **un** evento | COTA, §2.3 — **no es la cifra de la planta** |
| **giro** | **303 s** (p05–p95: 290–315) | **MEDIDO**, 75 stows, §2.4 — no depende del estado de la instalación |
| **latencia de reparto real** | ? | **NO MEDIDO** — falta el mapa TCU → gateway, §2.4 ter |
| **p100 hasta la última TCU** | ? | **NO MEDIDO** — ídem |
| **tasa de fallo de orden** | ? | **NO MEDIDO** — ídem |
| *(stow autónomo, si actúa)* | **600 s** por defecto (`40022`) | DECLARADO |

Un ranking que diga «LoRa sale 3 s peor» sin esto delante se lee como si
decidiera algo. Y las tres filas «NO MEDIDO» de en medio **estuvieron
rellenadas durante unas horas**, con números sacados de un stow de una NCU con
incidencias declaradas. Se retiraron en cuanto se supo. La detección, mientras
tanto, puede costar 60 s ella sola.

### Y el veredicto

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
* **El giro está MEDIDO y vale 303 s** para 55°: 75 stows de un evento real,
  mediana **0,1816 °/s**, p05–p95 0,1746–0,1896, R² mediano 0,9984 (§2.4). Se
  zanjó con lo que el SCADA ya guardaba —`30506` por TCU sobre su ciclo de
  30 s—, sin cronómetro y sin instrumentar nada. El rango **275–825 s queda
  retirado** y la lectura de **0,0667 °/s queda descartada**: está 2,7 veces por
  debajo del mínimo de las 75. El catálogo Sunner (0,17) resulta estar
  prácticamente en el suelo de lo medido, y el techo sin carga de la TCU (0,200,
  `41067`) justo por encima del máximo —con el reparo del §2.4 sobre ese máximo.
* **El MECANISMO del stow, que no depende del estado de la instalación**
  (§2.4 bis): una TCU con `sec = 5` y en **MANUAL no gira** —acusa la orden, el
  registro lo confirma, y el motor sigue a OFF—, y el arranque del giro
  **coincide** con el paso a AUTO (mediana −2,7 s sobre las 75). Consecuencia
  directa: cualquier «tiempo hasta bandera» que se apoye en
  `active_security_position` **sin mirar `main_state`** mide el acuse, no el
  stow.
* **Lo que NO se puede firmar, y estuvo firmado unas horas** (§2.4 ter): la
  latencia de reparto, el p100 y la tasa de fallo. El fichero tiene **dos
  poblaciones** —TCU 39–122 con sondeo normal y cero fallos; TCU 1–38 con 21 a
  175 filas al día y **los 13 fallos, todos**— y la NCU tiene incidencias
  declaradas. **El mapa TCU → gateway no existe en ningún repositorio**, así que
  no se puede separar por gateway sin adivinarlo por el número de TCU. Hasta que
  exista, esos tres números no se publican.
* **Un indicio que queda apuntado, no concluido**: dentro del bloque sano, las
  75 acusaron la orden en **41 s** y su paso a AUTO se estiró **1.790 s**. Si
  eso se repite en una instalación sin incidencia, el camino crítico del stow
  **no es la radio, es la secuencia manual**. Un evento no lo sostiene.
* **La palanca que más quita del camino crítico no es de radio, ya existe, y
  está configurada en 10 minutos**: el stow autónomo de la TCU por pérdida de
  comunicación con la NCU (`40022`). 600 s dominan la cadena entera. Bajarlo es
  configuración, no tecnología — pero cuánto bajarlo es un compromiso entre
  bandera falsa y bandera tarde, y ése no es mío.

El siguiente paso que produce el ranking, y no otro, es el §5.
