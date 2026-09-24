# Inventario de divergencias del motor RF

**Paso 1 de la consolidación. Documento, no código: aquí no se toca una línea de
motor.** Lo que sale de aquí es la lista de qué absorber y qué descartar, y esa
lista se revisa antes del paso 2.

La regla de decisión es la del encargo, y conviene dejarla escrita porque es la
que hace este documento distinto de una tabla de diferencias: **se elige por
fundamento, no por canon.** Que una función viva en `radio_pv_model.js` no la
hace buena. Hay al menos tres sitios en los que la copia de `cobertura-rf-fv`
está mejor que el canon, y están marcados.

---

## 0. Primero: no son cuatro copias. Son seis ficheros en cinco versiones

El encargo habla de cuatro copias. Contadas una a una salen seis ficheros, y la
sexta es la que más incomoda porque es con la que **calcula** SolarGPTfull.

| # | Fichero | Líneas | sha256 (12) | Qué es |
|---|---|---|---|---|
| 1 | `Siting/zigbee_pv_model.js` | 158 | `ac06599f6343` | **Modelo CONGELADO.** El más antiguo. Sin bandas, sin patrón, sesgo −33,6 |
| 2 | `SolarGPTfull/siting/zigbee_pv_model.js` | 158 | `ac06599f6343` | **Byte a byte igual al #1.** El lock dice la verdad |
| 3 | `Siting/radio_pv_model.js` | 381 | `74d2cc32cc8b` | **Canon JS.** Bandas de 3 estados, `exigeF`, sin sesgo |
| 4 | `Siting/radio_pv_model.py` | 292 | `02df72504c7d` | **Canon Python.** Gemelo del #3, pinchado por paridad |
| 5 | `cobertura-rf-fv/python/zigbee_pv_model.py` | 481 | `565381df3ef9` | Bandas, dipolo, ANTENNAS, sesgo −16,58 |
| 6 | `cobertura-rf-fv/web/zigbee_pv_model.js` | 285 | `1cfa3484ab00` | Port JS del #5 |
| **7** | **`SolarGPTfull/factiun_core/rf/zigbee.py`** | **335** | `d37fba5b034a` | **rf-fv de ANTES de las bandas.** Ver abajo |

El #2 es espejo exacto del #1, así que son **cinco versiones distintas**, no
cuatro.

### La que faltaba en la cuenta

`factiun_core/rf/zigbee.py` se declara *«Portado de
cobertura-rf-fv/python/zigbee_pv_model.py»* (`factiun_core/rf/__init__.py:3`) y
es el núcleo con el que SolarGPTfull hace física. El diff contra el #5 dice qué
se quedó por el camino:

- **No tiene el modelo de banda.** Ni `TableBand`, ni `table_band`, ni
  `band_clearance`, ni `diffraction_loss_tables_db`. Solo `row_top_elev`
  (`factiun_core/rf/zigbee.py:146`), o sea **la mesa como muro desde el suelo**
  — justo el modelo que el propio comentario de rf-fv describe como el que
  «dejaba el 95 % de la planta aislada, contra los 52 enlaces vivos que hay».
- **No tiene el patrón de antena.** Ni `dipole_gain_db` ni `ant_patron`.
- **No tiene `ANTENNAS`**, así que ninguna cota de plano.
- **No tiene el corto de conductor perfecto** (`eps_r = inf → Γ = +1`).

Y el sesgo no está en él: vive aparte, en `factiun_core/rf/calibration.py:15`.

### Paso 3, primera medida (2026-09-24): las primitivas YA son la misma física

Antes de migrar nada, `tools/careo_rffv.py` carea las primitivas de
`cobertura-rf-fv/python/zigbee_pv_model.py` contra este canon. **2.408 casos:**

| función | casos | máx \|Δ\| |
|---|---|---|
| longitud de onda · espacio libre · filo de cuchillo | 361 | **0,000e+00** |
| radio de Fresnel · distancia de ruptura | 850 | **0,000e+00** |
| patrón de dipolo · nu | 647 | **0,000e+00** |
| dos rayos | 550 | 1,990e-13 |

Lo que **no** se carea, y no por pereza: la geometría del obstáculo son ideas
distintas A PROPÓSITO —rf-fv usa `TableBand`/`band_clearance`, el canon corta
contra el plano inclinado—, y la del canon es la que se midió (RF-01, 27 dB).
La de rf-fv es la idea detrás de A4, cerrado como «no se implementa».

**Y lo que sí se separa no es física, es disciplina.** Los defectos de
`LinkParams` de rf-fv traen `sigma_db = 6,0`, que es justo el valor que este
repo se niega a heredar, y con él `predict_link` publica un `p_link`. El canon,
ante lo mismo, devuelve `pEnlace: null` con `sin_sigma_no_hay_probabilidad`.

Así que **migrar rf-fv al canon no es reconciliar ecuaciones: es que deje de
publicar una probabilidad que no tiene con qué calcular.** Eso cambia el tamaño
del paso 3 y también su naturaleza — y conviene saberlo antes de empezarlo.

**Consecuencia para el paso 3:** SolarGPTfull no es «un repo que consume el
canon». Es un repo con **dos modelos suyos y distintos** — un núcleo Python
viejo de rf-fv y un espejo JS del congelado de Siting — y un banco que los
carea. Migrarlo no es cambiar un sha: es sustituir su núcleo. Eso hay que
decírselo antes, no después.

### Paso 3 HECHO en `cobertura-rf-fv` (2026-09-24)

Los dos puertos de rf-fv —`web/zigbee_pv_model.js` y `python/zigbee_pv_model.py`—
**ya no escriben las primitivas**: las toman de una copia fijada del canon
(`lib/radio_pv_model.js` y `python/radio_pv_model.py`, candado `lib/canon.lock.json`).
Conservan lo suyo: la geometría de la mesa (`TableBand`/`band_clearance`), el
Deygout sobre ella, el balance y la malla.

**Copia fijada y no import** porque el visor de rf-fv es un HTML servido desde
Pages: no puede leer un repo hermano en tiempo de ejecución. Lo que convierte la
copia en algo verificable es el careo: `tests/test_canon_pin.py` la compara BYTE
A BYTE contra el original —clon al lado, o `--depth 1` que `siting` es público—
y **sin original sale con rc = 2, no con verde**.

**El antes/después, medido antes de subirlo** (2.882 casos de primitiva + 28
enlaces de El Burgo, careando el módulo de git contra el de ahora):

| función | casos | máx \|Δ\| |
|---|---|---|
| longitud de onda · espacio libre · filo de cuchillo | 361 | **0,000e+00** |
| radio de Fresnel · distancia de ruptura | 850 | **0,000e+00** |
| patrón de dipolo · nu | 647 | **0,000e+00** |
| coeficiente de reflexión \|Γ\| | 474 | 1,525e-15 |
| dos rayos | 550 | 1,990e-13 dB |
| **el balance entero (prx, margen, pérdida)** | **28 enlaces** | **0,000e+00 dB** |

Las dos que se mueven lo hacen por el ORDEN DE REDONDEO, no por la física: el
canon lleva su propia aritmética compleja en tuplas `(re, im)` para ser bit a bit
igual que el JS, y rf-fv usaba `cmath`. De los 550 casos de dos rayos, **233
(42,4 %) son idénticos bit a bit**; de los que se mueven, la mediana es 1,42e-14
dB. Un RSSI medido tiene resolución de 1 dB: esto es 2e-13 veces menor. Y lo que
ve la página —el balance— no se mueve ni un bit.

Las 9 vistas de referencia del banco de imagen salen a **0,00 % de bloques y
0,00 % de píxeles**.

**Lo que cambia de comportamiento, y es a mejor.** El canon exige la frecuencia y
lanza con un `eps_r` que no sea positivo o `inf`; rf-fv devolvía conductor
perfecto para cualquier `eps_r` no finito, **NaN incluido**, y se lo tragaba. Los
valores por defecto de rf-fv (2,45 GHz, eps_r 15, `inf` para suelo perfecto)
siguen en sus envolturas, así que ninguna llamada de fuera cambia.

**Lo que queda del paso 3:** SolarGPTfull, que es el caso difícil descrito
arriba, y `Cobertura-Zigbee`.

---

## 1. Sesgo

No hay dos sesgos globales. **Hay tres calibraciones distintas de los MISMOS 49
enlaces de El Burgo I**, y se contradicen entre sí.

| Valor | Dónde | Cita |
|---|---|---|
| **−33,6 dB, σ 6,8** | Congelado #1/#2 y `calibration.py` | `zigbee_pv_model.js:115`; `factiun_core/rf/calibration.py:15-21`, con `"fuente": "El Burgo I NCU1 2026-06-16..18"`, `n_enlaces: 49`, `n_eff: 0.38` |
| **−16,58 dB, σ 10,99** | rf-fv #5/#6 | `python/zigbee_pv_model.py:300`; `web/zigbee_pv_model.js:228` |
| **n = 0,38, σ 5,2, R² = 0,05** | `terreno.html` (comentario) | `Cobertura-Zigbee/terreno.html:4613` |
| **ninguno; σ = `null`** | **Canon #3/#4** | `radio_params.json` → `sigma_db.valor: null` |

Las dos primeras no discrepan por matiz: **rf-fv declara por escrito que la
primera no se reproduce.** Literal, en `python/zigbee_pv_model.py:283`:

> *«El número que había aquí, -33,6 dB con sigma 6,8, NO SE REPRODUCE con los
> datos del repo: no sale de ninguna configuración razonable.»*

Y a continuación se desautoriza a sí misma:

> *«Y AUN ASÍ NO ES UNA CALIBRACIÓN DE PROPAGACIÓN. […] el RSSI medido
> correlaciona r = +0,16 con log(distancia): el nivel medido NO DEPENDE DE LA
> DISTANCIA.»*

### Fundamento

Un sesgo global solo tiene sentido si el modelo acierta la FORMA y falla el
NIVEL. Los datos dicen que no acierta la forma:

- `r(RSSI, log d) = +0,16` sobre 49 enlaces de 24 a 338 m (rango ×14, donde el
  espacio libre solo ya predice 23 dB de caída).
- El careo actual del canon da **Pearson −0,009 (p = 0,95)** y **Spearman
  −0,014** predicho contra medido (`tools/careo_elburgo.mjs`). El modelo no
  ordena los enlaces como los ordena el árbitro.
- El residuo tiene estructura fuerte contra filas cruzadas reales: **+27,1 dB de
  media con 0 filas y −28,4 dB con 24**. Un escalar no arregla eso; lo esconde.

Además la muestra está **censurada**: son los enlaces que la malla eligió porque
funcionaban. Recentrar sobre ellos es recentrar sobre los supervivientes.

### Veredicto

**Mejor fundado: el canon.** No por ser canon, sino porque es el único que no
afirma un número que los propios datos contradicen, y porque lo rotula en vez de
callarlo (`radio_params.json`: *«Sin campaña calibrada, el motor va en modo
TEÓRICO y lo rotula»*).

**DESCARTAR los tres sesgos.** Y con ellos las tres sigmas: 6,8 · 10,99 · 5,2
son tres ajustes de la misma campaña. Ninguna es la sigma de propagación.

> **Lo que sí hay que absorber es el aviso.** rf-fv escribió 18 líneas
> explicando por qué su propio número no sirve. Ese texto vale más que el
> número y hoy solo existe allí.

---

## 2. Ganancia y patrón de antena

| Copia | Qué hace |
|---|---|
| Congelado #1/#2, canon #3/#4, núcleo #7 | Ganancia **plana**: `gtx + grx` escalares |
| rf-fv #5/#6 | `dipole_gain_db(elev)` = `cos((π/2)·sin e)/cos e`, normalizado a F(0)=1, con nulo acotado a −60 dB |

La antena es una **Jinchang JCW435700RA, 3 dBi, dipolo ~λ/2** (ficha citada en
`python/zigbee_pv_model.py:270`). Un dipolo no radia igual en todas las
direcciones. Tratar sus 3 dBi como escalar es **optimista en todo salto con
elevación**, y eso es exactamente lo que hace el canon hoy.

### Cuánto vale, medido

F es par en elevación, así que la corrección entra dos veces con el mismo valor.
Sobre geometrías reales:

| Salto | 12 m | 24 m | 50 m | 100 m | 338 m |
|---|---|---|---|---|---|
| TCU↔TCU (el careo: **misma altura**) | **0,000** | 0,000 | 0,000 | 0,000 | 0,000 |
| TCU→NCU (1,5 → 3,15 m) | −0,238 | −0,060 | −0,014 | −0,003 | −0,000 |
| TCU→HSU (1,5 → 6,50 m) | **−1,994** | −0,538 | −0,127 | −0,032 | −0,003 |

**Hay que decirlo sin adornos: absorber el dipolo no mueve nada de lo que hoy se
mira.** El careo de El Burgo pone las dos antenas a la misma altura
(`tools/careo_elburgo.mjs:267`, `zA: ant, zB: ant`), y el mapa de Siting también
(`rfEnlace`, `zA = zB = hA`). Elevación 0 → corrección 0,000 dB exactos. Solo
empieza a morder cuando se absorban las cotas reales (§3), y aun entonces son
2 dB en el peor salto contra la HSU a 12 m.

### Un defecto de rf-fv que NO hay que copiar

`predict_link` aplica `g_el` una sola vez, con la elevación del rayo DIRECTO
(`python/zigbee_pv_model.py:362`), y luego suma un modelo de dos rayos donde el
rayo reflejado sale con un ángulo distinto — `θ = atan2(h_t + h_r, d)`, que a
12 m con antenas a 1,5 m son 14°, no 0°. **El patrón se aplica al enlace, no a
cada rayo.** Es inconsistente con el propio modelo de dos rayos al que se suma.

### Veredicto

**ABSORBER el patrón, pero por el motivo correcto y corrigiendo el defecto.**

El motivo no es el dB: es que **`gtx_dbi` como escalar es un parámetro que no se
puede llevar a sub-GHz**. Para LoRa/Wi-SUN la antena es otra, con otro patrón y
otra ganancia, y hoy no hay dónde declararlo. El dipolo de rf-fv es el primer
patrón parametrizable, y esa es la razón por la que entra ahora.

Al absorberlo: **aplicar el patrón a cada rayo** (directo con su elevación,
reflejado con la suya) en lugar de una vez al enlace. Y conservar la nota de
rf-fv sobre lo que NO modela — *«el látigo cuelga de la viga y bascula con la
mesa, así que su eje no es exactamente la vertical. Se toma vertical»* — que es
un supuesto declarado, no una omisión.

### Estado el 2026-09-24: HECHO A MEDIAS, y aquí está qué mitad

**Hecho: el RAYO DIRECTO.** `gananciaPatronEnlace(D, zA, zB, patrón)` saca la
elevación del enlace y cobra el patrón por los DOS extremos —es par en la
elevación, así que el extremo alto y el bajo ven el mismo factor—, y
`presupuesto` lo suma a `gtx + grx`. Existe en los dos motores y la paridad lo
carea (familia `patron_enlace`). Sin patrón declarado no se pone 0 en silencio:
sale `patron_de_antena_no_declarado`.

Hasta hoy `gananciaPatronDb` estaba **definida, exportada y careada desde la
fase 2, y el balance no la llamaba**: sumaba ganancias planas. Una absorción
escrita, probada, y sin efecto en ningún número.

Cuánto mueve, medido sobre los 52 enlaces REALES de El Burgo:

| tipo | enlaces | elevación p50 | patrón p50 | patrón máx |
|---|---|---|---|---|
| TCU–TCU | 49 | 0,00° | **0,0000 dB** | 0,0000 |
| TCU–NCU | 3 | 4,09° | −0,0649 dB | **−0,1170** |

O sea: cero exacto en 49 de 52 —alturas iguales, broadside— y de −0,04 a −0,12
dB en los tres TCU→NCU. Contra márgenes de 44,8 a 58,0 dB no cambia ningún
veredicto. **Su valor no es el dB de hoy: es que sin esto no hay forma de
llevar el balance a sub-GHz**, que es lo que este veredicto decía desde el
principio.

**NO hecho: el patrón POR RAYO.** El reflejado sale con otra elevación —baja al
suelo y vuelve a subir— y hoy entra en `dosRayosDb` sin pesar. Medido lo que
queda fuera:

| caso | D | elev. directo | elev. reflejado | patrón dir. | patrón refl. | se aparta |
|---|---|---|---|---|---|---|
| TCU–TCU | 12 m | 0,00° | −7,64° | 0,0000 | −0,2268 | **−0,2268** |
| TCU–TCU | 24 m | 0,00° | −3,84° | 0,0000 | −0,0572 | −0,0572 |
| TCU–TCU | 158 m | 0,00° | −0,58° | 0,0000 | −0,0013 | −0,0013 |
| TCU–NCU | 27,5 m | 5,49° | −7,57° | −0,1172 | −0,2226 | −0,1054 |
| TCU–HSU | 30 m | 11,30° | −13,14° | −0,4962 | −0,6714 | −0,1752 |

No es un desplazamiento común a los dos rayos: es un peso RELATIVO entre ellos,
así que mueve dónde caen los nulos de la interferencia y no sólo el nivel. Es
pequeño —como mucho 0,23 dB de diferencia— pero exige entrar en `dosRayosDb`,
cambia todos los números del término de dos rayos y necesita su propia medida y
su propio banco. Queda declarado, no olvidado.

---

## 3. Altura de antena

Esta es la divergencia con más consecuencia y la más fácil de cerrar.

| Copia | Altura de antena |
|---|---|
| Canon #3/#4 | **`ant_h_m = 1.5`**, y su propio `_fuente` dice: *«NO medida en campo; heredada del modelo antiguo y pendiente de confirmar contra el montaje real de la TCU»* |
| rf-fv #5/#6 | `ANTENNAS`: TCU caída 0,725 bajo el tubo · NCU **3,15 m** · HSU **6,50 m** |
| Congelado #1/#2, núcleo #7 | Nada. La altura la pone quien llame |

### La fuente real está en Cobertura-Zigbee, con plano

`equipos.js` no las inventa; las saca de los planos y lo dice
(`equipos.js:19-24`, «PROCEDENCIA»):

- **NCU** — `ncuMastH: 2.95` (poste C 100×60 hincado), `ncuAntY: 3.15` («CENTRO
  del látigo, en la cabeza del poste»). Plano **DR_NCU_v0 / «Montaje NCU»**.
  `equipos.js:36,44`.
- **HSU** — `hsuTowerH: 8.00`, `hsuAntY: 6.50` («CENTRO de los látigos, en su
  brazo»). Plano **FTR.24.00145_5_C / «Montaje HSU»**. `equipos.js:59`, con el
  comentario que explica que antes se dibujaban arriba y que **la cota entra en
  la física, no solo en el dibujo**.
- **TCU** — no está en `equipos.js` a propósito, porque **depende de la altura
  del tubo**: cuelga 0,225 m del eje al conector más `antHang: 0.50` de coax
  (`seguidor.js:35`). De ahí salen los 0,725 de rf-fv.

Las tres coinciden con `ANTENNAS` de rf-fv. **Las dos fuentes independientes
dicen lo mismo**, lo cual es la mejor señal que hay aquí.

### Dos defectos encontrados al verificarlo

1. **Comentario obsoleto en la propia fuente.** La cabecera de `equipos.js:15`
   sigue diciendo *«dos látigos de antena a ~8,3 m»* mientras el código dice
   `hsuAntY: 6.50`. El código es el corregido (ago-2026, confirmado por
   Ignacio); el comentario se quedó. **Hay que arreglarlo**, porque es la línea
   que alguien leerá para citar la cota.
2. **Cita desplazada en `radio_params.json`.** Dice
   `Siting/index.html:2357 RF_ANT_H=1.5`; hoy está en la **2365**. Un `_fuente`
   que apunta a otra línea es un `_fuente` roto. Se corrige en el paso 2.

### Veredicto

**ABSORBER las tres cotas, con su plano citado.** Es la absorción de mayor
efecto y la de fundamento más sólido: hay plano, hay dos módulos independientes
que coinciden y hay confirmación de campo.

Y con esto **se cierra la incógnita de la altura sin esperar a campo**: el
`_ojo` de `ant_h_m` («pendiente de confirmar») deja de aplicar a la NCU y a la
HSU. Para la TCU sigue abierto, pero ya no como número sino como **fórmula**:
`ant_h = altura_tubo − 0,725`, que es lo correcto porque el tubo cambia de
planta a planta.

> **Ojo al efecto de cascada:** hoy el careo usa 0,775 y 1,5 m en los dos
> extremos. Con las cotas reales, los saltos TCU→NCU y TCU→HSU pasan a ser
> asimétricos. Eso mueve el dos rayos (§6), habilita el patrón (§2) y cambia
> qué filas cruza el rayo (§5). **Es la absorción que más números mueve**, y hay
> que publicar el antes/después planta por planta.

---

## 4. Terreno

| Copia | Terreno |
|---|---|
| Congelado #1/#2, núcleo #7 | `diffraction_loss_db` acepta puntos `(x, cota)`. Sin fuente de datos |
| rf-fv #5/#6 | Igual, más `TableBand.ground` por mesa |
| Canon #3/#4 | **`relieveDominante(zA, zB, D, perfil)`** — el terreno como obstáculo CONTINUO, separado de las bandas (`radio_pv_model.js:141`) |
| `terreno.html` | **DEM real + levantamiento**, con empalme por desfase constante |

### Dónde está el relieve de verdad

En `Cobertura-Zigbee/terreno.html`, y está bien hecho:

- **DEM global**: teselas Terrarium a ~30 m de paso (`terreno.html:301`), que
  «sirve para ver el valle, no para leer una fila».
- **Levantamiento del cliente**: hasta 672 puntos de cota en
  `<planta>_relieve.json`, y **manda dentro de su extensión**; el DEM se queda
  para el entorno (`terreno.html:889-898`).
- **Empalme declarado**: los dos vienen en metros sobre el nivel del mar pero no
  en el mismo dato, así que se calcula el desfase mediano (levantamiento − DEM)
  sobre los nodos con dato y se le suma al DEM. Interpolación bilineal; los
  nodos sin curva a tiro caen al DEM.

### El careo de seis plantas: hay que rebajar la expectativa

El encargo habla de «relieve DEM validado en seis plantas más su careo». Lo que
hay es `censo_relieve_cartera.csv`, **11 plantas**, y su columna `estado` dice:

| estado | plantas |
|---|---|
| **EVALUADA / APTA** | **2** — ayora, sanjose |
| SIN LEVANTAMIENTO | 8 — bagnarelli, benante, elburgo, fayon, panbianco, paramo, polvorin, tunez |
| NO APLICA | 1 — dicayagua (oferta sin DWG) |

**El Burgo, que es la planta del careo, está SIN LEVANTAMIENTO.** Solo dos
plantas tienen relieve validado contra medida. Ese es el alcance real y con ese
hay que trabajar.

### El defecto que comparten canon y rf-fv

**Ninguno de los dos alimenta el relieve.** `relieveDominante` existe en el canon
y **nadie lo llama**: en `Siting/index.html` no hay una sola llamada, y
`rfCruces` construye bandas sin perfil de terreno. El mapa de Siting supone
suelo llano. En rf-fv, `TableBand.ground` se pasa pero no hay quien lea un DEM.

Es simétrico y conviene decirlo así: **el canon tiene la estructura correcta y
código muerto; rf-fv tiene el dato por mesa y tampoco lo llena.**

### Veredicto

**ABSORBER el DEM de `terreno.html`** (teselas + levantamiento + empalme por
desfase mediano), conectándolo a `relieveDominante`, que ya está escrito.

**Mejor fundada la estructura del canon**: el relieve como obstáculo continuo y
propio, separado de las bandas. El motivo se ve en §5.

**Y rotular el alcance:** con relieve validado solo en Ayora y San José, el
mapa de las otras nueve sale con DEM global de 30 m y eso tiene que salir
escrito en la leyenda, no en un `_ojo` de un JSON.

---

## 5. Geometría del obstáculo

Aquí hay tres modelos, no dos.

| Copia | Modelo de la mesa |
|---|---|
| Congelado #1/#2, núcleo #7 | **`row_top_elev`**: un punto a la cota de la cresta. La mesa es un MURO desde el suelo. Dos estados |
| rf-fv #5/#6 | **`table_band`**: banda `[bot, top]`, huella `±hw`. Tres estados vía `band_clearance` |
| Canon #3/#4 | **`banda` + `corta`**: banda `[zBot, zTop]`, hueco explícito, tres estados con nombre (`tapado` / `hueco` / `libre`) y bandera `bajoSuelo` |

El muro está descartado por medida, y la medida está escrita en los dos sitios:
tratar el campo como muro omnidireccional **dejaba el 95 % de El Burgo aislado,
contra los 52 enlaces vivos que hay** (`terreno.html:4554`,
`python/zigbee_pv_model.py:175`). No se discute.

### Dónde rf-fv está mejor: el suelo bajo la placa

```python
# python/zigbee_pv_model.py:196
def band_clearance(los, b):
    if los >= b.top: return los - b.top
    if los <= b.bot: return min(los - b.ground, b.bot - los)   # ← el suelo
    return -min(los - b.bot, b.top - los)
```

```js
// radio_pv_model.js:101  — el canon
if (zRayo < b.zBot) {
  return { estado: "hueco", despeje: b.zBot - zRayo, borde: b.zBot,
           bajoSuelo: zRayo < b.suelo };
}
```

rf-fv **se da cuenta de que bajo la placa hay dos obstáculos**, la placa encima
y el suelo debajo, y el que manda es el más cercano. El canon mide siempre a
`zBot` e ignora el suelo. Medido, con eje 1,5 m y cuerda 2,38 m:

| α | zBot | z rayo | canon | rf-fv | ¿manda el suelo? |
|---|---|---|---|---|---|
| 0° | 1,500 | 0,200 | 1,300 | **0,200** | sí |
| 0° | 1,500 | 0,775 | 0,725 | 0,725 | no |
| 30° | 0,905 | 0,200 | 0,705 | **0,200** | sí |
| 30° | 0,905 | 0,500 | 0,405 | 0,405 | no |
| 60° | 0,469 | 0,200 | 0,269 | **0,200** | sí |

El suelo manda cuando el rayo va por debajo de la mitad del hueco. Con las
antenas actuales (0,775 y 1,5 m) **no pasa nunca sobre suelo llano** — otra
absorción de efecto cero hoy y de efecto real en cuanto entre el DEM, porque
entonces la cota del rayo sobre el suelo local sí baja.

### Pero la solución de rf-fv está mal implementada

`diffraction_loss_tables_db` toma **ν del despeje** (que puede venir limitado por
el suelo) y **el pivote de la recursión de `band_edge`**, que devuelve `b.bot`
—el borde de la placa— sin mirar quién limitó
(`python/zigbee_pv_model.py:205,233`). En la rama en que manda el suelo, el
despeje sale de un obstáculo y el borde difractante de otro. Es incoherente.

Físicamente tampoco es un filo: por debajo de la placa el rayo pasa por una
**ranura** entre dos bordes opuestos, y meter `−min(...)` en una fórmula de filo
único no es el modelo de una ranura.

**Mejor fundada la estructura del canon**, que trata el suelo como obstáculo
propio y continuo en vez de colarlo dentro de la banda. Lo que hay que absorber
de rf-fv **no es el `min`: es haberse dado cuenta**.

### A4, cerrado — y no como este documento preveía

Este §5 decía «implementado vía `relieveDominante`». **Esa función ya no
existe**: A3 la sustituyó por la tierra lisa de P.1812, y eso cambió la
arquitectura por debajo del plan. Así que A4 se volvió a medir con el terreno
real que ya hay — `tools/a4_suelo_bajo_placa.mjs`, re-ejecutable.

**La observación de rf-fv era correcta, y ahora sí se puede demostrar.** Con
suelo llano este documento midió «no pasa nunca», y anotó que cambiaría «en
cuanto entre el DEM». Entró, y pasa:

| planta | cruces de fila | el suelo manda |
|---|---:|---:|
| Ayora | 7.056 | **98 (1,39 %)** |
| San José | 21.265 | **554 (2,61 %)** |
| **total** | **28.321** | **652 (2,30 %)** |

**Pero A4 NO se implementa**, y el motivo es la misma prueba que decidió A3:

* el suelo **ya es** un obstáculo propio y continuo —el perfil del terreno,
  medido contra la tierra lisa— y se cobra en su propio término;
* sobre terreno **llano** ese término da **0 EXACTO**, que es lo correcto: el
  suelo plano lo modelan los dos rayos;
* y donde el terreno **sube** —que son justo esos 652 cruces— el relieve ya lo
  cobra.

Meterlo **además** como filo bajo la placa cobraría **hasta 1,88 dB a 400 m**
sobre terreno llano que nadie descuenta de los dos rayos. Es el doble conteo
que A3 vino a quitar —21,66 dB medidos entonces— en pequeño.

Hay dos obstáculos, sí. **Y cada uno está ya en su término.**

**Lo que quedaba abierto** era el repecho local: el relieve usa Bullington, un
canto equivalente ÚNICO para todo el vano, así que un repecho justo donde el
rayo pasa bajo un panel se promedia en ese canto en vez de resolverse.
**Medido y cerrado en A5** — ver abajo.

### A5, el repecho local: medido, y cerrado como límite declarado

`tools/a5_repecho_local.mjs`, sobre los 3.040 enlaces de Ayora y San José, con
el terreno real. Un repecho «cuenta» si cae dentro del radio de la primera zona
de Fresnel de un cruce de fila por debajo del cual pasa el rayo, y a más de ese
radio del canto de Bullington — o sea, uno que el canto único **se comió**.

**1 · El efecto existe y no es despreciable.** 69 repechos en 62 de 3.040
enlaces (**2,0 %**). Ahí, resolverlos aparte con Epstein–Peterson cambia el
relieve **+5,0 dB de mediana, +16,4 en el p95**. No se cierra por pequeño.

**2 · Pero no hay forma estable de cobrarlo.** Sobre el MISMO terreno,
cambiando sólo el paso de muestreo y **sin decimar** (0,5× y 1× el paso del
fichero):

| | p95 | máx |
|---|---:|---:|
| canto único (Bullington) | 0,089 dB | 1,259 dB |
| resuelto aparte (E–P) | **5,212 dB** | **21,367 dB** |

E–P se mueve **más que el propio efecto que pretende corregir**, y por un
factor 58 en p95.

**3 · Y la causa no era la recursión.** Deygout se descartó por recursionar
(1,10 dB con 2 puntos, 22,74 con 80). **Epstein–Peterson no recursiona y falla
igual.** Luego el problema no es el esquema: es **enumerar máximos locales**. El
número de máximos de una superficie continua muestreada crece con la densidad,
así que cualquier método que los cuente hereda la dependencia. **La familia
entera está cerrada, no sólo Deygout.**

**4 · Delta-Bullington tampoco, y no por inestable.** P.1812 ec. (39) es
`Ld50 = Lbulla + max(Ldsph − Lbulls, 0)`; la parte `Lbulla − Lbulls` (ec. 21) es
justo lo que este motor ya hace, y lo único que añade —`Ldsph`, ec. (27)— **no
recibe el perfil**: sólo distancia, frecuencia, radio terrestre efectivo,
alturas de antena efectivas, fracción de mar y polarización. Es un suelo de
trayecto, igual para todos los enlaces con la misma (D, f, htE, hrE). No sabe
dónde está el repecho, luego no puede resolverlo. *(Verificado contra el código
del SG3 de la UIT y contra pycraf: `itu.int` está bloqueado desde el contenedor,
así que la cita es de implementaciones de la Recomendación y no del PDF.)*

**Límite declarado del modelo**, escrito también en `radio_pv_model.js` junto al
término:

> Un repecho local cerca del punto donde el rayo pasa bajo un panel se promedia
> en el canto equivalente. Afecta al **2,0 %** de los enlaces; ahí el relieve
> puede quedarse **corto en el orden de 5 dB (p95 16)**. No se corrige porque
> ningún método conocido da esa corrección de forma estable: sobre el mismo
> terreno se mueve hasta **21 dB** sólo con cambiar el muestreo.

**Y una corrección a lo que este repo afirmaba**: `radio_pv_model.js` decía que
Bullington es «invariante al muestreo». **No lo es del todo** — se mueve hasta
1,259 dB sin decimar y 4,169 decimando a 4×. Es invariante en *construcción* (no
recursiona), pero sus dos rectas de máxima pendiente se leen sobre muestras, y
una muestra puede no caer en la cima. Lo que decide sigue siendo la comparación
con E–P, no el valor absoluto; pero «invariante» era demasiado.

### La huella: `hw` es código muerto en rf-fv

`table_band` calcula `hw = (chord/2)·cos α` y **nadie la usa**: `grep hw` en los
dos ficheros de rf-fv da solo la definición y los comentarios. La comprobación
de huella existe únicamente en `terreno.html:4561`
(`nearRowD(projX(lon)) <= bd.hw`).

El canon no la necesita: `rfCruces` (`Siting/index.html`) obtiene los cruces por
**intersección real de segmentos** contra las filas, indexada. Eso es
estrictamente mejor que comparar contra una media anchura, porque respeta la
geometría real de la fila y su orientación.

**Mejor fundado: el canon.** Nada que absorber.

### Veredicto de §5

- ~~**ABSORBER**: la conciencia del suelo bajo la placa — implementada como
  obstáculo propio vía `relieveDominante`, no como el `min` de rf-fv.~~
  **CERRADO, Y NO COMO SE PREVEÍA. Ver «A4, cerrado» abajo.**
- **DESCARTAR**: `row_top_elev` y el modelo de muro (#1, #2, #7).
- **DESCARTAR**: `hw` y `band_clearance` tal cual están.
- **CONSERVAR**: `banda`/`corta` con sus tres estados nombrados y `bajoSuelo`,
  y `rfCruces` por intersección real.

---

## 6. Dos rayos

Ecuación idéntica en las cinco versiones. Comparadas línea a línea:

```
d_los = hypot(d, h_t − h_r)          d_ref = hypot(d, h_t + h_r)
θ     = atan2(h_t + h_r, d)          Γ     = Fresnel(θ, eps, σ, f, pol)
dφ    = 2π (d_ref − d_los) / λ
campo = 1/d_los + Γ·exp(−j·dφ)/d_ref
PL    = −20 log10( (λ/4π) · |campo| )
```

Las diferencias son de **implementación**, y una importa:

| Aspecto | rf-fv #5 | Canon #4 |
|---|---|---|
| Complejos | `cmath` de la librería | **Complejos a mano** (`_cx/_cadd/_cmul/_csqrt/_cexp`) |
| Motivo | — | `cmath.sqrt` **no hace las mismas operaciones** que `cSqrt` de JS |

El canon los escribe a mano a propósito: es lo que sostiene la paridad
bit a bit con JS que exige `tests/test_paridad_radio.py`. Con `cmath` la paridad
se pierde y el banco pasa a medir ruido de librería.

**Mejor fundado: el canon.** Y el suelo sobre el que descansa está medido: V8 y
CPython difieren en el último bit en `hypot` y `atan2` (1,4e-16 relativo) y el
dos rayos lo amplifica porque la fase sale de `d_ref − d_los`, que es una resta
catastrófica. Esa cota está en el banco con su caso feo.

### Lo que rf-fv tiene y el canon no

```python
if math.isinf(eps_r):
    return complex(1.0, 0.0)     # conductor perfecto: Γ = +1
```

El canon no lo contempla, y no falla: **miente en silencio.** Ejecutado contra
el fichero del repo:

```
canon  coefReflexion(theta=0.25, epsR=Infinity, ...) = { re: NaN, im: 0 }
canon  dosRayosDb(100, 1.5, 1.5, 2.45e9, Infinity, ...) = NaN
rf-fv  reflectionCoefficient(0.25, Infinity, ...)      = { re: 1, im: 0 }
```

`cSub(eps, cx(cos2,0))` da `Infinity`, `cSqrt` lo propaga, y en `cDiv` sale
`Infinity − Infinity = NaN`. Ese NaN viaja hasta el margen sin que nada lo diga
— justo la clase de callada que el resto del canon evita con sus `null` y sus
motivos.

El caso sirve: es la **cota superior del rebote**, el caso de referencia que el
visor ofrece junto a la tierra real. Y el argumento de rf-fv para tenerlo en el
núcleo es bueno — *«evita que cada página se escriba su propio "dos rayos con
suelo perfecto"»*, que es literalmente el problema que este documento existe
para cerrar.

**ABSORBER el conductor perfecto.** Y, ya que se toca: **hacer que `epsR` no
válido lance** en vez de devolver NaN, como hace `exigeF`.

---

## 7. Difracción

Deygout, ITU-R P.526, `max_depth = 3` en las cinco. Filo idéntico:

```
L(ν) = 0                               si ν ≤ −0,78
L(ν) = 6,9 + 20 log10( sqrt((ν−0,1)² + 1) + ν − 0,1 )
ν    = h · sqrt( 2(d1 + d2) / (λ d1 d2) )
```

Diferencias:

| Aspecto | Congelado / núcleo #7 | rf-fv | Canon |
|---|---|---|---|
| Qué difracta | punto `(x, cota)` | banda, borde de `band_edge` | banda, borde de `corta` |
| Listas de obstáculos | una | **dos, y las SUMA** | una |
| Salida | `float` | `float` | **`difraccionBandasDetalle`**: dominante, izquierda, derecha, ν, estado, borde, motivo |

### El doble conteo de rf-fv

```python
# python/zigbee_pv_model.py:355-358
if pts:    pl_diff  = diffraction_loss_db(d, tx_elev, rx_elev, pts, p.f_hz)
if tables: pl_diff += diffraction_loss_tables_db(d, tx_elev, rx_elev, tables, p.f_hz)
```

Dos Deygout independientes **sumados**. Si el mismo obstáculo físico aparece en
las dos listas —una fila descrita como punto y como banda, o un cerro que ya
entra en `TableBand.ground`— se cuenta dos veces. Peor: Deygout no es aditivo,
elige un dominante y recursa; **dos recursiones separadas no son una recursión
sobre la unión.** Un enlace que cruza terreno y filas da un número que no es el
de ninguno de los dos modelos.

**Mejor fundado: el canon**, con una lista única. Es la razón estructural por la
que el relieve tiene que entrar en la MISMA lista de cruces (§4), no como una
segunda suma.

### Lo que el canon tiene y nadie más

`difraccionBandasDetalle` devuelve el árbol entero: dominante con su índice, su
ν, su estado, su borde y su banda, más las ramas izquierda y derecha y un
`motivo` cuando no hay pérdida. Los demás devuelven un `float`.

Eso no es cosmética: es lo que permite que **el panel de perfil y el mapa
enseñen el mismo número sin recalcularlo** (fase 4, punto 1), que es la avería
que este documento entero viene a evitar. Un `float` obliga a quien pinte a
recalcular, y ahí es donde nace la siguiente copia.

**CONSERVAR. Es el mecanismo antifragmentación del canon.**

---

## 8. Sensibilidad

| Copia | Sin `rx_sens_dbm` |
|---|---|
| Congelado, rf-fv, núcleo #7 | **Por defecto −103,0 dBm** (`LinkParams.rx_sens_dbm`) |
| Canon | **`margenDb: null`** + motivo `sin_sensibilidad_no_hay_margen` |

Los −103 no son una lectura de datasheet: `radio_params.json` lo dice de sí
mismo — *«Esto de aquí es el valor que ya usaba el repo, no una lectura de
datasheet»*. Y para el XBee **estándar** (no PRO) la sensibilidad no aparece en
ningún sitio del código, así que el canon la deja en `null` y esa variante
**no emite margen**.

Un valor por defecto aquí es peor que un fallo: produce un margen en dB
plausible para una radio que nadie ha comprobado que sea esa.

**Mejor fundado: el canon. DESCARTAR el defecto de −103.**

---

## 9. Ptx

Todas coinciden en el número: **+19,0 dBm**, XBee-PRO RR, con la nota «Estándar
= +8 dBm. Canal 26: máx +3 dBm». Lo que cambia es qué se hace con esa nota.

| Copia | Canal |
|---|---|
| Congelado, rf-fv, núcleo #7 | Un comentario junto al `19.0` |
| Canon | **`canal: { valor: null }`** con 13 líneas de `_ojo` y **motivo en la salida**: `canal_desconocido_ptx_es_cota_superior` |

El canal 26 cae en el borde superior de la banda, donde la máscara de emisión
obliga a bajar potencia: el PRO declarado a +19 quedaría en +3. **Dieciséis dB
menos en toda la planta** — más que cualquier otra cosa que discuta este
documento, incluido el sesgo de −16,58.

En qué canal trabajan las plantas **no está en ninguno de estos repos**. Sale de
`CH` e `ID` en la respuesta a `query_setting`, que recoge
`Cobertura-Zigbee/zigbee_inventario.ps1`. Bloque 8a, pendiente de que alguien en
planta corra un paquete nuevo.

**Mejor fundado: el canon**, porque convierte una nota en comentario en un
**motivo que viaja con el resultado**. Un comentario no llega al usuario; un
motivo sí. **DESCARTAR el comentario suelto como único aviso.**

---

## 10. Qué absorber y qué descartar

### ABSORBER en el canon (JS y Python a la vez, paridad exacta)

| # | Qué | De dónde | Fundamento | ¿Mueve números? |
|---|---|---|---|---|
| A1 | **Cotas de antena reales**: NCU 3,15 · HSU 6,50 · TCU = tubo − 0,725 | `equipos.js:36,44,59`; `seguidor.js:35`; rf-fv `ANTENNAS` | Planos DR_NCU_v0 y FTR.24.00145_5_C; dos módulos independientes coinciden; confirmación de campo ago-2026 | **Sí, mucho.** Es la que más mueve |
| A2 | **Patrón de antena parametrizable**, empezando por el dipolo λ/2 | rf-fv `dipole_gain_db` | Ficha de la Jinchang JCW435700RA; ganancia plana es optimista y **no es trasladable a sub-GHz** | Poco a 2,4 GHz (≤ 2 dB, y 0,000 con alturas iguales). **Es prerequisito de LoRa/Wi-SUN** |
| A3 | **Relieve DEM** conectado a `relieveDominante`, en la lista ÚNICA de cruces | `terreno.html:301,889-898` | Teselas Terrarium + levantamiento del cliente con empalme por desfase mediano; validado en Ayora y San José | Sí, en plantas con desnivel |
| A4 | ~~**Conciencia del suelo bajo la placa**~~ **CERRADO: A3 lo hizo innecesario, e implementarlo ahora sería doble conteo.** Medido en `tools/a4_suelo_bajo_placa.mjs` | rf-fv `band_clearance` (la idea) | Bajo la placa hay dos obstáculos y manda el cercano — y ahora cada uno está en su término | No se implementa |
| A5 | **Conductor perfecto** `eps_r = inf → Γ = +1`, y `epsR` inválido que LANCE | rf-fv `reflection_coefficient` | Cota superior del rebote; hoy el canon da NaN silencioso | No (caso nuevo) |
| A6 | **El texto que desautoriza los sesgos** | rf-fv `python/zigbee_pv_model.py:281-299` | Vale más que el número y solo existe allí | No |

### DESCARTAR

| # | Qué | Por qué |
|---|---|---|
| D1 | **Sesgo −33,6 / σ 6,8** | rf-fv declara por escrito que no se reproduce. Y es global sobre muestra censurada |
| D2 | **Sesgo −16,58 / σ 10,99** | Su propio autor lo desautoriza: `r(RSSI, log d) = +0,16` |
| D3 | **σ 5,2 / n 0,38** de `terreno.html` | Tercer ajuste de la misma campaña, R² = 0,05 |
| D4 | **`row_top_elev`** y el modelo de muro | Medido: dejaba el 95 % de El Burgo aislado contra 52 enlaces vivos |
| D5 | **`rx_sens_dbm = −103` por defecto** | No es lectura de datasheet; un defecto produce dB plausibles de una radio no comprobada |
| D6 | **`sigma_db = 6.0` por defecto** | Valor de partida, no medida. Sin él, `pEnlace: null` y rotulado TEÓRICO |
| D7 | **`f_hz = 2.45e9` por defecto** (y `lam = 0.125` de `terreno.html:4559`) | Así se cuela una banda sin que nadie la elija. `exigeF` existe para esto. El 0,125 además no es λ: son 0,12236 |
| D8 | **`band_clearance` + `band_edge` tal cual** | Despeje de un obstáculo y borde difractante de otro |
| D9 | **`hw`** | Código muerto en rf-fv; el canon resuelve la huella por intersección real |
| D10 | **Las dos listas de obstáculos sumadas** | Doble conteo, y dos Deygout no son un Deygout sobre la unión |
| D11 | **`cmath`** en Python | Rompe la paridad bit a bit con JS |
| D12 | **El canal como comentario suelto** | Un comentario no llega al usuario; un motivo sí |

### CONSERVAR del canon (y por qué, que no es «porque sí»)

- **`exigeF`** — sin defecto de frecuencia, olvidarla es un `NaN` ruidoso en vez
  de una predicción de 2,4 GHz disfrazada de LoRa.
- **Tres estados nombrados** (`tapado`/`hueco`/`libre`) + `bajoSuelo`.
- **`difraccionBandasDetalle`** — el árbol entero. Es lo que permite un solo
  camino de cálculo entre panel y mapa, o sea el mecanismo que evita la copia
  siguiente.
- **Complejos a mano** — sostienen la paridad JS/Python.
- **`null` + motivo** en vez de valor por defecto, en sensibilidad, sigma,
  vegetación y canal.
- **`rfCruces` por intersección real e indexada.**

---

## 11. Defectos encontrados de paso (no son del motor, pero hay que arreglarlos)

1. **`equipos.js:15`** dice «látigos de antena a ~8,3 m»; el código dice 6,50.
   El comentario se quedó sin corregir cuando se corrigió la cota.
2. **`radio_params.json`** cita `index.html:2357` para `RF_ANT_H`; hoy está en
   la **2365**.
3. **`relieveDominante` es código muerto** en el canon: escrito, con banco, y
   sin una sola llamada desde `index.html`.
4. **`hw` es código muerto** en las dos copias de rf-fv.
5. **`factiun_core/rf/zigbee.py` no aparecía en ningún inventario.** Es el
   núcleo con el que SolarGPTfull calcula y va dos generaciones por detrás.

---

## 12. Lo que este documento NO ha comprobado

- **No se ha ejecutado rf-fv contra el canon enlace a enlace.** La comparación
  es de código y de casos puntuales medidos, no un careo masivo. El careo
  cruzado con 0 diferencias es el paso 4, y necesita que los dos hablen el mismo
  idioma de entrada, que es lo que hace el paso 2.
- **No se ha verificado el plano DR_NCU_v0 ni el FTR.24.00145_5_C.** Se citan
  porque los cita `equipos.js`, cuya cabecera declara su procedencia. No tengo
  los DWG delante.
- **La cota de la TCU sigue sin medir en campo.** Lo que se cierra es la
  fórmula (tubo − 0,725), no el número, porque el tubo cambia de planta a
  planta.
- **El canal sigue siendo `null`.** Sin el bloque 8a, todo margen de la variante
  PRO es cota superior, no predicción. Ninguna absorción de este documento
  cambia eso, y son 16 dB.
