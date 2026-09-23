# El terreno: de dónde sale, qué cobra, y qué falta

> **Encargo (punto 1, segunda mitad)**: «una sola fuente desde cobertura-zigbee
> (DEM + levantamiento con empalme, validado en Ayora y San José), un fichero de
> terreno por planta consumido por el 3D y el motor; plantas sin terreno
> validado → `relieveDb = null` con motivo».

Cada cifra de aquí sale de correr algo que está en el repo, y se dice de cuál:

| útil | qué mide | necesita el hermano |
|---|---|---|
| `cobertura-zigbee/tools/relieve_de_levantamiento.mjs` | **escribe** `<planta>_relieve.json` del levantamiento + DEM | vive allí |
| `tools/careo_terreno_3d.mjs` | que el motor y el 3D lean el mismo fichero igual | sí (sin él no carea, y lo dice) |
| `tools/relieve_plantas.mjs` | qué cobra el terreno real de Ayora y San José | sí (sin él no mide, y lo dice) |
| `tools/antena_hsu.mjs` | lo que mueve la altura de antena de la HSU | sí |
| `tests/test_terreno_planta.js` | el muestreo y la cadena, con valores a mano | no — corre en CI |

**Este repo consume, no produce.** El productor vive en cobertura-zigbee, junto
al levantamiento. Una versión anterior de `relieve_plantas.mjs` construía aquí
su propia malla, y eso era la avería de siempre: dos sitios calculando la misma
magnitud, listos para separarse sin que nadie lo note.

---

## 1. El fichero: no se inventa formato

`<planta>_relieve.json`. **Ya existe**: lo escribe
`cobertura-zigbee/tools/kml_curvas_a_cotas.mjs` y **ya lo consume el 3D**
(`terreno.html`, función `relAt`), hoy con `dicayagua_relieve.json` declarado en
su registro de plantas.

```
{planta, crs, cE, cN, x0, n0, paso, nx, nn, z:[…], fuente, nota}
```

`z` en metros sobre el nivel del mar, indexado `z[j·nx + i]`, en el **mismo
sistema local que el layout** (x este, n norte). `null` = sin dato.

Un fichero por planta, dos consumidores, que es exactamente lo que se pidió.
Inventar aquí un segundo formato sería la misma avería que este repo ya cazó
con las dos funciones de despeje: dos caminos para la misma magnitud que se
separan sin que nadie lo note.

### Y que lo leen igual no se afirma: se carea

`terreno_planta.js` transcribe el muestreo de `relAt`. Una transcripción es una
copia, y una copia se separa. Así que `tools/careo_terreno_3d.mjs` **extrae
`relAt` del propio `terreno.html`** —no lo reimplementa— y lo ejecuta contra el
nuestro sobre los ficheros reales, 200.000 muestras cada uno, sobre la malla y
200 m alrededor:

| fichero | malla | idénticos | peor \|Δ\| |
|---|---|---:|---:|
| `dicayagua_relieve.json` | 501 × 189 a 10 m, 59,4 % de nulos | **200.000** (142.081 por la rama del nulo) | **0** |
| `ayora_relieve.json` | 458 × 518 a 6 m | **200.000** (48.535 por la rama del nulo) | **0** |
| `sanjose_relieve.json` | 548 × 496 a 6 m | **200.000** (46.610 por la rama del nulo) | **0** |

Cero exacto, bit a bit, no «bajo tolerancia».

**Negativo probado**: degradando la bilineal a la esquina de abajo a la
izquierda, 38.010 discrepancias y 14,79 m de peor diferencia. La puerta se ha
visto fallar.

---

## 2. Qué plantas tienen terreno, y qué se hace con las que no

De `cobertura-zigbee/censo_relieve_cartera.csv`, que es un censo medido:

| estado | plantas | ¿tiene `_relieve.json`? |
|---|---|---|
| **EVALUADA con levantamiento** | **ayora** (cobertura 100,0 %), **sanjose** (95,3 %) | **sí, escrito** |
| curvas de nivel propias | dicayagua — pero es una oferta de estructura FIJA, sin TCU ni radio | sí, de antes |
| **SIN LEVANTAMIENTO** | bagnarelli, benante, **elburgo**, fayon, panbianco, paramo, polvorin, tunez | no, y por eso `relieveDb = null` |

O sea que **la planta de la que tenemos 49 medidas de radio reales —El Burgo—
no tiene terreno validado**, y su careo se queda exactamente como está. Eso no
es una pega del diseño: es el estado del dato, y decirlo es el trabajo.

Las que no lo tienen dan `relieveDb = null` **con motivo**, nunca 0. Son cinco
motivos separados, porque cada uno se arregla con una cosa distinta:

| motivo | qué pasó | qué lo arregla |
|---|---|---|
| `relieve_sin_terreno_validado` | la planta no tiene fichero | un levantamiento |
| `relieve_vano_fuera_de_la_malla` | el vano se sale del fichero | un fichero mayor (DEM) |
| `relieve_hueco_en_el_vano` | dentro, pero sin dato ahí | más levantamiento |
| `relieve_vano_de_longitud_cero` | los dos extremos en el mismo sitio | quien llama |
| `relieve_antena_bajo_la_tierra_lisa` | alturas mezcladas — ver §5 | quien llama |

**El nulo no se rellena.** El fichero declara «null = sin dato, usar DEM»; el 3D
tiene DEM por red y este repo no tiene ninguno. Donde el fichero dice «no sé»,
aquí se dice «no sé».

---

## 3. Lo que hay que saber del levantamiento antes de usarlo

`<planta>_cotas.json` mide **dos puntos por fila** —sus dos puntas— y **nada en
medio**: 74,6 m de mediana entre punta y punta, con las filas a 6 m unas de
otras. La nube es densa a lo ancho y vacía a lo largo.

**Medido, no supuesto**: gridando la nube cruda, la malla de Ayora sale al
**7,5 %** de nodos con dato y **695 de las 751 TCU se quedan sin cota**. Con
eso no se puede evaluar ni un enlace.

Así que el suelo bajo una fila se toma **lineal entre sus dos puntas**. Es
exactamente lo que ya supone el 3D (`beam = mc.gnd + (…)·fr`, en `buildCava`) y
lo que justifica la estructura: un tubo rígido sobre hincas, con el suelo a
HEJE por debajo. **Es una suposición declarada, no una medida**, y con ella:

| | Ayora | San José |
|---|---|---|
| seguidores levantados | 751 (0 reconstruidos) | 2.289 (2 reconstruidos, 43 cotas repuestas) |
| puntos de suelo, densificados | 26.318 | 89.586 |
| malla escrita | 458 × 518 a 6 m (1,56 MB) | 548 × 496 a 6 m (2,04 MB) |
| **TCU con cota** | **751 de 751 (100,0 %)** | **2.289 de 2.289 (100,0 %)** |
| desnivel del campo | 90,0 m (710,3 → 800,3) | 89,0 m (1.516,3 → 1.605,3) |
| escalón levantamiento − DEM | −1,78 m | −5,56 m |
| **error contra las cotas medidas** | **p50 0,030 m** · p95 0,114 · máx 0,541 | **p50 0,074 m** · p95 0,227 · máx 1,562 |

El 100,0 % de Ayora coincide con el que declara el censo por su cuenta.

### El residuo va en DOS términos, y se eligió midiendo

Con un solo IDW no caben las dos cosas que hacen falta. Error del fichero
contra las 3.004 cotas medidas de Ayora:

| IDW | \|error\| p50 | |
|---|---:|---|
| radio 120, soft 25 | 0,214 m | el del 3D. Empalma suave, **borra el detalle** |
| radio 40, soft 25 | 0,115 m | |
| radio 12, soft 1 | 0,043 m | fiel, pero **corta el empalme a 12 m** |
| radio 120, soft 1 | 0,146 m | ensanchar con 1/d² tampoco: con 26.318 puntos los lejanos son tantos que en conjunto dominan |
| **ancho 120/25 + fino 12/1** | **0,030 m** | los dos, y sin cantil |

Afinar la malla no compra casi nada y cuesta mucho: a 3 m el error baja a
0,022 m y el fichero pasa de 1,4 a **5,3 MB**.

**Y el máximo no es del método.** Las DOS vigas de un mismo seguidor van a
6,02 m una de otra y difieren en cota hasta **0,511 m** en Ayora (1,910 en San
José). Con paso de malla 6 m caen en celdas contiguas y la bilineal reparte: el
techo del error ES el escalón del propio dato entre filas vecinas.

---

## 4. Qué cobra el terreno, de verdad

> ### ⚠ ESTA TABLA NO SE AGREGA. NUNCA.
>
> **Una cifra de relieve «sobre los enlaces», sin separar por longitud de vano,
> no significa nada.** Las bandas de abajo van de **0,000 dB a 8,438 de
> mediana** y hasta **23,8 de máximo**: promediarlas da el número que uno
> quiera según cuántos vanos cortos haya en la muestra, y la muestra la elige
> la malla, no la física.
>
> **Es exactamente el mismo error que ya mordió en el careo de El Burgo.** Allí
> la media del residuo es **+1,1 dB**, que suena a motor bien centrado, y lo
> que esconde es que el residuo vale **+27,1 dB con 0 filas cruzadas y −28,4 dB
> con 24** (`INVENTARIO_MOTOR_RF.md`). Los dos errores se compensan en la media
> y la media no valida nada. `tools/careo_elburgo.mjs` lo lleva escrito en su
> §6 desde entonces: *«una media no valida nada: +1,1 dB es compatible con
> acertar y con fallar ±25 dB compensándose»*.
>
> Aquí la variable oculta es la **longitud del vano** en vez de las **filas
> cruzadas**, pero la avería es la misma: un agregado sobre una variable con
> estructura fuerte. Si alguien necesita un solo número, que sea **por banda de
> vano y con su n**, nunca uno solo.
>
> ### ⚠ Y NINGÚN ENLACE REAL DE LA CARTERA LLEGA A 800 m
>
> La banda de 800–1.600 m, donde el relieve pega más fuerte, **no existe en la
> instalación**. Medido sobre los presets de las diez plantas
> (`tools/vanos_muestreados_vs_reales.mjs`): el enlace más largo de toda la
> cartera son **447 m** (San José), y sólo **7 de 6.036** pasan de 400 m.
>
> Esta tabla sale de **vanos muestreados** —parejas de TCU al azar— y describe
> el TERRENO: «si hubiera un enlace de 1.200 m aquí, cuánto relieve tendría».
> El antes/después describe la INSTALACIÓN. Los dos números son correctos y hay
> que publicar los dos: dar sólo el primero exagera, y dar sólo el segundo deja
> creer que el terreno no importa — hasta el día que alguien alargue un vano.
>
> *(Y hay un segundo motivo por el que las dos cifras no se carean directamente:
> `relieve_plantas.mjs` pone antena de TCU en los DOS extremos porque es una
> sonda del terreno entre seguidores, mientras el enlace real va contra una NCU
> con la antena a 3,15 m. Medido: 7,847 dB con TCU a los dos lados frente a
> 5,907 con TCU→NCU. La antena de la NCU se come 1,94 dB ella sola.)*

---

## ⚠ Lo que de verdad cazó el defecto del picómetro, y no fue el banco

Merece su sitio aquí, pegado al apartado de arriba, porque es la misma familia
de error: **un número que existe y nadie lee.**

`recortaPerfil` comparaba `largo < D` a secas y rechazaba **568 de 6.036
enlaces reales (9,4 %)** por un déficit de **2,13e-13 m** — dos décimas de
picómetro. Esos enlaces salían con motivo `relieve_perfil_no_cubre_el_vano`, o
sea **sin término de relieve, con el terreno delante**, y llevaban así desde
que el terreno entró en la app.

**Los 17 bancos estaban verdes. Las 43 mutaciones, rojas. La paridad, verde.**
Nada de eso lo vio, y no por estar mal hechos: ningún banco tenía un caso donde
el perfil llegara al vano *salvo por un último bit*, porque a nadie se le
ocurre escribir ese caso a mano.

**Lo que lo cazó fue otra cosa**: poner una puerta nueva —el umbral de vano
corto— y **ver que NO disparaba donde tenía que disparar**. Benante tenía 146
enlaces por debajo de 100 m y la puerta sólo saltaba en 139. Ir a ver por qué
faltaban 7 fue lo que destapó el picómetro.

O sea: **el contraste entre lo que digo que hace el código y lo que hace sobre
datos reales**. No un banco más, sino correr la cosa contra la cartera entera y
mirar si los números cuadran con lo que uno acaba de afirmar.

De ahí salen las dos cosas que este repo se lleva:

1. **El censo de motivos** (`RadioZigbee.censoMotivos`), publicado siempre en
   los informes y en la leyenda de la app, con porcentaje y denominador. Un
   «9,4 % no cubre el vano» al pie del informe de #87 habría saltado a la vista.
   `tests/test_censo_motivos.js` exige que **salga en la salida**, corriendo el
   útil de verdad y leyendo su stdout — un contador correcto que nadie imprime
   no habría cazado nada.
2. **La regla de las comparaciones** (`tools/auditoria_comparaciones.mjs`): una
   comparación de flotantes necesita tolerancia **relativa** cuando decide si un
   dato existe **y** sus dos lados vienen de rutas de cálculo distintas. Si
   vienen del mismo cálculo, el bit coincide y la tolerancia sobra. Y la
   tolerancia se prueba a **1 m, 1 mm y 1 µm**: una que no distinga esas tres
   de 1e-13 no es una tolerancia, es un apagón.

**Y esto es lo que más importa de todo el documento: el relieve crece con la
longitud del vano, y mucho.** Con saltos a vecina —12 m— sale 0 en más de la
mitad de los casos, y eso invita a concluir que el terreno no cobra. **Es
falso**: a 12 m dos filas vecinas están sobre un plano y la tierra lisa se lo
come entero, que es justo lo que tiene que hacer.

Yo mismo casi me lo trago: la primera medida la hice a vecina más próxima y
daba **p50 = 0,000 dB**. Sólo al separar por longitud apareció lo que hay.

**Ayora** — 90 m de desnivel:

| vano | n | p50 | p95 | máx | a cero | sin perfil |
|---|---:|---:|---:|---:|---:|---:|
| 10–20 m | 65 | **0,000** | 0,000 | 0,000 | 65/65 | 0 |
| 20–50 m | 258 | 0,185 | 1,306 | 1,451 | 56/258 | 0 |
| 50–100 m | 300 | 0,700 | 3,355 | 5,535 | 69/300 | 0 |
| 100–200 m | 300 | 1,485 | 7,227 | 10,811 | 41/300 | 0 |
| 200–400 m | 300 | 2,775 | 8,744 | 13,813 | 12/300 | 0 |
| 400–800 m | 300 | 3,112 | 8,346 | 12,974 | 7/300 | 0 |
| 800–1600 m | 300 | **7,798** | 14,731 | 20,051 | 3/300 | 0 |

**San José** — 89 m de desnivel:

| vano | n | p50 | p95 | máx | a cero | sin perfil |
|---|---:|---:|---:|---:|---:|---:|
| 10–20 m | 14 | **0,000** | 0,000 | 0,000 | 14/14 | 0 |
| 20–50 m | 138 | 0,124 | 2,784 | 2,784 | 62/138 | 0 |
| 50–100 m | 300 | 1,040 | 8,915 | 13,531 | 56/300 | 0 |
| 100–200 m | 300 | 2,237 | 8,938 | 15,670 | 18/300 | 0 |
| 200–400 m | 300 | 3,499 | 11,555 | 22,824 | 1/300 | 0 |
| 400–800 m | 300 | 5,748 | 17,808 | 23,780 | 0/300 | 0 |
| 800–1600 m | 300 | **8,438** | 16,329 | 22,221 | 0/300 | 0 |

Tres lecturas, y las tres son del dato:

* **A 12 m el relieve es CERO EXACTO, siempre.** No «casi»: cero. Es la prueba
  de que la referencia hace su trabajo — absorbe 90 m de desnivel de campo y no
  cobra nada por una pendiente.
* **A partir de 100 m son varios dB, y a 800–1600 m la mediana pasa de 7,8 dB
  con cola de 20–24.** Es un término real y no se puede seguir tratando como
  ausente.
* **La columna `sin perfil` está a CERO en todas las bandas**, y eso es lo que
  aportó empalmar con el DEM. Con el levantamiento solo, a 200–400 m se perdían
  **233 de 300** vanos porque cruzaban los huecos entre bloques —viales,
  centros de transformación—; a 800–1600 m se perdían 248 de 300. El DEM los
  llena, y por eso las dos últimas bandas existen aquí y antes no.

> **Y estos números tienen un límite declarado, medido en A5.** El relieve usa
> un canto equivalente ÚNICO (Bullington), así que un repecho local cerca del
> punto donde el rayo pasa bajo un panel **se promedia en vez de resolverse**.
> Pasa en el **2,0 %** de los enlaces (62 de 3.040), y ahí el relieve puede
> quedarse **corto en el orden de 5 dB, p95 16**.
>
> No se corrige, y no por pereza: sobre el MISMO terreno, sólo cambiando el
> paso de muestreo y sin decimar, cualquier método que enumere máximos locales
> se mueve **hasta 21 dB** — más que el efecto que pretende corregir. Deygout
> se descartó por recursionar; Epstein–Peterson **no recursiona y falla igual**,
> así que la familia entera está cerrada. Detalle y cifras en
> `INVENTARIO_MOTOR_RF.md` §«A5, el repecho local» y en
> `tools/a5_repecho_local.mjs`, que corre en CI.

---

## 5. La avería que se disfraza del caso bueno

Pasarle al motor el perfil en cota **absoluta** con la antena en **relativa** no
revienta, no sale negativo y no sale enorme:

| | relieve | htE |
|---|---:|---:|
| dato correcto (`zA = suelo + 0,475`) | **13,3297 dB** | +0,4750 |
| dato mezclado (`zA = 0,475` a secas) | 0,0029 dB | **−739,161** |

**Sale casi cero**, indistinguible de «terreno llano», con la antena 739 m bajo
tierra: las dos Bullington salen gigantes y casi iguales y la resta se las come.
Un fallo que se disfraza del caso bueno tiene que avisar él, porque nadie lo va
a ver.

Con el recorte de la ec. (92) puesto, `hst ≤ h[0]`, así que `htE ≥ altura de
antena > 0` **siempre** que el dato venga bien. Luego `htE ≤ 0` no es terreno
raro: es dato mezclado. `relieveDeltaDb` devuelve `db: null` con motivo y
`presupuesto` **para sin margen** —no lo anota y sigue— porque el dato malo no
se queda en su término: `dosRayosDb` recibiría 739 m como altura sobre el suelo.

---

## 6. La altura de poste declarada NO contamina esto

El eje va a **1,20 m, estándar Factiun DECLARADO**, y el de verdad sale de un
plano que todavía no está. Para el 3D eso importa: mueve el terreno
reconstruido metro por metro. Para el relieve de radio **no**, y el argumento
tiene dos mitades que conviene separar porque sólo una estaba en duda:

**(a) El eje entra como un desplazamiento UNIFORME del suelo.** Esto podría ser
falso —bastaría que el densificado o el IDW dependieran del eje de otra forma—,
así que se mide comparando la malla a 0,70 m contra la de 2,00 m:

| planta | nodos | peor desvío respecto a 1,30 m exactos | huecos |
|---|---:|---:|---|
| ayora | 2.655 | **6,140e-13 m** | los mismos en las dos |
| sanjose | 7.560 | **1,773e-12 m** | los mismos en las dos |

**(b) El relieve es invariante a un desplazamiento uniforme.** Esto es
estructural: perfil y antenas se mueven juntos, y tanto la recta de mínimos
cuadrados como `htE = zA − hst` son invariantes a una traslación. Medido sobre
800 vanos reales:

| planta | vanos | peor variación del relieve, eje de 0,70 a 2,00 m |
|---|---:|---:|
| ayora | 400 | **5,133e-12 dB** |
| sanjose | 400 | **9,132e-12 dB** |

**Y con honestidad sobre lo que vale cada mitad**: (b) no lo tumba una mutación
—probado con `sinCentrar` puesta, el número no se movió: 4,9e-12 en vez de
5,1e-12—, porque el centrado protege la precisión del caso llano a cota alta,
no esta invariancia. O sea que la que aporta información es (a).

**Conclusión, que desbloquea trabajo**: 1,30 m de incertidumbre en la altura de
poste mueven el relieve en la coma flotante. **El plano hace falta para el 3D;
para esto no.** El fichero de terreno de Ayora y San José se puede producir ya,
con el 1,20 rotulado, sin esperar al plano.

---

## 7. El productor, y la decisión que hubo que tomar

**`cobertura-zigbee/tools/relieve_de_levantamiento.mjs`**, que es donde vive el
levantamiento y donde ya está `kml_curvas_a_cotas.mjs`, que escribe este mismo
formato. Sin `--write` no toca disco: mide, valida y lo cuenta.

### El DEM se incrusta, y no era obvio

El encargo dice «DEM + levantamiento con empalme». El DEM son teselas Terrarium
de S3, una llamada de red: el 3D las pide en vivo y el motor de Siting no puede.
Había dos salidas, y la decisión la dieron los números:

| | fichero | qué pasa con los vanos largos |
|---|---|---|
| huecos a `null` | ~0,4 MB | **se pierden**: a 200–400 m, 233 de 300 sin perfil; a 800–1600 m, 248 de 300 |
| **DEM incrustado** | **1,56 / 2,04 MB** | **0 sin perfil en todas las bandas** |

Se incrusta. Cuesta 1,6 MB por planta y a cambio las dos bandas largas del §4
existen —y son las que más cobran, p50 7,8 y 8,4 dB—. Además el fichero queda
**reproducible**: con el DEM dentro, el resultado no depende de que las teselas
de S3 sigan siendo las mismas el día que alguien lo vuelva a mirar.

Hacen falta 4 teselas z14 para Ayora y 9 para San José.

### Lo que sigue sin estar

* **La altura de poste de un plano.** El fichero lleva el estándar Factiun
  **1,20 m DECLARADO** rotulado en su `nota`. Mueve el terreno metro por metro,
  así que el 3D lo nota; el relieve de radio **no** (§6). Cuando llegue el
  plano, se regenera y el 3D mejora; el relieve no se mueve.
* **Las ocho plantas sin levantamiento**, El Burgo entre ellas. No es un
  problema de código: no hay dato. Dan `relieveDb = null` con motivo.
* **El careo del motor contra medidas reales CON terreno.** Las 49 medidas que
  hay son de El Burgo, que no tiene levantamiento. Hasta que haya medidas en
  Ayora o San José, el relieve del §4 es lo que el modelo dice que cobra el
  terreno, no lo que se ha visto cobrar.
