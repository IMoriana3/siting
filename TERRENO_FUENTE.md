# El terreno: de dónde sale, qué cobra, y qué falta

> **Encargo (punto 1, segunda mitad)**: «una sola fuente desde cobertura-zigbee
> (DEM + levantamiento con empalme, validado en Ayora y San José), un fichero de
> terreno por planta consumido por el 3D y el motor; plantas sin terreno
> validado → `relieveDb = null` con motivo».

Cada cifra de aquí sale de correr algo que está en el repo, y se dice de cuál:

| útil | qué mide | necesita el hermano |
|---|---|---|
| `tools/careo_terreno_3d.mjs` | que el motor y el 3D lean el mismo fichero igual | sí (sin él no carea, y lo dice) |
| `tools/relieve_plantas.mjs` | qué cobra el terreno real de Ayora y San José | sí (sin él no mide, y lo dice) |
| `tests/test_terreno_planta.js` | el muestreo y la cadena, con valores a mano | no — corre en CI |

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
nuestro sobre `dicayagua_relieve.json` real:

| | |
|---|---|
| malla | 501 × 189 a 10 m, **59,4 % de nulos** |
| muestras | 200.000, sobre la malla y 200 m alrededor |
| idénticos | **200.000** — de ellas 142.081 por la rama del nulo |
| peor \|Δ\| | **0** — cero exacto, bit a bit, no «bajo tolerancia» |

**Negativo probado**: degradando la bilineal a la esquina de abajo a la
izquierda, 38.010 discrepancias y 14,79 m de peor diferencia. La puerta se ha
visto fallar.

---

## 2. Qué plantas tienen terreno, y qué se hace con las que no

De `cobertura-zigbee/censo_relieve_cartera.csv`, que es un censo medido:

| estado | plantas |
|---|---|
| **EVALUADA con levantamiento** | **ayora** (cobertura 100,0 %), **sanjose** (95,3 %) |
| curvas de nivel propias | dicayagua — pero es una oferta de estructura FIJA, sin TCU ni radio |
| **SIN LEVANTAMIENTO** | bagnarelli, benante, **elburgo**, fayon, panbianco, paramo, polvorin, tunez |

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
| **TCU con cota** | **751 de 751 (100,0 %)** | **2.289 de 2.289 (100,0 %)** |
| desnivel del campo | 90,0 m (708,5 → 798,5) | 89,0 m (1.510,7 → 1.599,7) |

El 100,0 % de Ayora coincide con el que declara el censo por su cuenta.

---

## 4. Qué cobra el terreno, de verdad

**Y esto es lo que más importa de todo el documento: el relieve crece con la
longitud del vano, y mucho.** Con saltos a vecina —12 m— sale 0 en más de la
mitad de los casos, y eso invita a concluir que el terreno no cobra. **Es
falso**: a 12 m dos filas vecinas están sobre un plano y la tierra lisa se lo
come entero, que es justo lo que tiene que hacer. Cualquier cifra agregada
«sobre los enlaces» sin separar por longitud dice lo que uno quiera.

**Ayora** — 90 m de desnivel:

| vano | n | p50 | p95 | máx | a cero | sin perfil |
|---|---:|---:|---:|---:|---:|---:|
| 10–20 m | 37 | **0,000** | 0,000 | 0,000 | 37/37 | 0 |
| 20–50 m | 121 | 0,244 | 1,231 | 1,347 | 29/121 | 0 |
| 50–100 m | 282 | 0,671 | 2,995 | 4,287 | 75/282 | 18 |
| 100–200 m | 198 | 1,440 | 6,028 | 10,084 | 34/198 | 102 |
| 200–400 m | 67 | **3,113** | 6,621 | 10,276 | 2/67 | 233 |

**San José** — 89 m de desnivel:

| vano | n | p50 | p95 | máx | a cero | sin perfil |
|---|---:|---:|---:|---:|---:|---:|
| 10–20 m | 8 | **0,000** | 0,000 | 0,000 | 8/8 | 0 |
| 20–50 m | 69 | 0,045 | 1,587 | 1,587 | 27/69 | 0 |
| 50–100 m | 187 | 1,038 | 7,025 | 13,197 | 44/187 | 4 |
| 100–200 m | 288 | 2,125 | 7,324 | 9,960 | 26/288 | 12 |
| 200–400 m | 246 | 2,907 | 8,705 | 14,582 | 3/246 | 54 |
| 400–800 m | 144 | 3,259 | 8,675 | 12,259 | 0/144 | 156 |
| 800–1600 m | 52 | **4,246** | 9,641 | 10,032 | 0/52 | 248 |

Tres lecturas, y las tres son del dato:

* **A 12 m el relieve es CERO EXACTO, siempre.** No «casi»: cero. Es la prueba
  de que la referencia hace su trabajo — absorbe 90 m de desnivel de campo y no
  cobra nada por una pendiente.
* **A partir de 100 m son varios dB, con cola de 10–15.** Es un término real y
  no se puede seguir tratando como ausente.
* **La columna `sin perfil` crece con el vano**, y es el límite honesto de
  usar sólo el levantamiento: a 200–400 m la mayoría de los vanos cruzan los
  huecos entre bloques —viales, centros de transformación—. **Ahí es donde hace
  falta el DEM del encargo**, y es la parte que no se puede hacer sin red.

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

## 7. Lo que falta, y por qué no está hecho

**Escribir `ayora_relieve.json` y `sanjose_relieve.json`.** Todo lo de arriba se
ha medido construyendo la malla al vuelo; el productor tiene que vivir en
**cobertura-zigbee**, junto al levantamiento y junto al `kml_curvas_a_cotas.mjs`
que ya escribe ese formato. Allí hay una PR abierta que declara **«solo
comentarios»**, y meterle un útil nuevo y dos ficheros de datos la convertiría
en mentira. **Va detrás de que se mergee.**

**El empalme con el DEM.** El encargo dice «DEM + levantamiento con empalme», y
el empalme es lo que llena los huecos entre bloques —la columna `sin perfil` del
§4—. El DEM son teselas Terrarium de S3, una llamada de red: el 3D las pide en
vivo y este repo no puede. Cuando el productor exista, la decisión es si el
fichero se genera con el DEM incrustado (fichero grande, reproducible) o se deja
el hueco a `null` (fichero pequeño, y los vanos largos sin relieve). **Con los
números del §4 delante, la respuesta se puede razonar en vez de adivinar.**
