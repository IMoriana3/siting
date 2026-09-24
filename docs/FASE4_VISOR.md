# Fase 4 del visor — los ocho puntos

**Por qué existe este fichero.** Los puntos 6, 7 y 8 de esta fase vivían sólo
en una conversación. Un plan que no está en el repo se pierde en el primer
corte de contexto, y es el mismo defecto que las diecisiete mutaciones que
dejaron de correrse sin que nada avisara: lo que nadie puede mirar, nadie lo
mira. Aquí está el plan entero, con lo hecho, lo que quedó fuera de cada punto
hecho, y lo que aún **no está definido** — dicho como tal, no rellenado.

Fecha de esta versión: **2026-09-24**.

| | punto | estado |
|---|---|---|
| 1 | Motor único, parámetros con procedencia | hecho, con reservas |
| 2 | Ángulo por seguidor y por hora | hecho en el motor; falta el control en pantalla |
| 3 | Medido frente a predicho | hecho, sobre 52 de ~736 pares |
| 4 | Robustez | hecho |
| 5 | Estados e incertidumbre | hecho, sin probabilidad |
| 6 | Comparador de tecnologías | **no empezado · sin definir del todo** |
| 7 | Escenario guardable | **no empezado · sin definir del todo** |
| 8 | Informe | **no empezado · sin definir del todo** |

---

## 1 · Motor único, parámetros con procedencia

**Hecho.** Hay UNA función que decide qué le pasa a un enlace (`rfEnlace`) y
UNA puerta por la que se pide un margen (`rfMargenDe`). Los parámetros salen de
`radio_params.json`, donde cada valor lleva su `_fuente` y su `procedencia` de
vocabulario cerrado, y lo que no se sabe va a `null` con motivo.

**Lo que quedó fuera, y sigue fuera:**

- **El canal es desconocido** (`tecnologias.*.canal.valor = null`). El
  comentario del modelo congelado dice «Canal 26: máx +3» y la variante declara
  +19 dBm: son **16 dB** de recorrido, más que cualquier otro parámetro del
  fichero. Sale del `CH` del volcado de inventario (`zigbee_inventario.ps1`), y
  mientras no esté, la potencia es una **cota superior**, no una predicción.
- **Los parámetros de radio son `heredado`**: salen de `defaultParams()` del
  modelo congelado, no de una lectura de datasheet. El propio JSON lo dice en
  `_pendiente_fase_2`. El rótulo de la capa RF sale **SIN VERIFICAR** por eso.
- **`sigma_db` está a `null`** — ver el punto 5.
- **El mapa pintaba con el motor ANTIGUO hasta el 2026-09-24** (`aef8c53`): el
  bucle de dibujado llamaba a `rfMargin` saltándose la puerta única. Medido y
  publicado en el README; Bagnarelli hay que rehacerla.

## 2 · Ángulo por seguidor y por hora

**Hecho en el motor** (2026-09-24). `rfAngulo(i)` ya no devuelve el deslizador:
con `S.rf.sol.on` saca el ángulo de `lib/sol.js` —posición NOAA del sol y el
`singleaxis` de pvlib con backtracking por GCR— para la hora pedida y con el
eje de CADA seguidor.

El modelo **no se reescribe aquí**: es copia fijada del de Cobertura-Zigbee,
contrastado contra pvlib en `backtracking.html`, con su lock y un banco que la
carea byte a byte contra el canon (`tests/test_sol_pin.js`; sin hermano, rc=2).

**Cuánto mueve, medido sobre 6.036 enlaces de 10 plantas** —
`tools/careo_angulo_hora.mjs`, solsticio de verano:

| planta | enlaces | p50 \|Δ\| | p95 \|Δ\| | máx \|Δ\| |
|---|---|---|---|---|
| ayora | 751 | 1,93 | 6,50 | **17,06** |
| benante | 730 | 2,40 | 6,38 | **27,31** |
| elburgo | 215 | 5,70 | 9,60 | 16,54 |
| panbianco | 1476 | 2,27 | 6,09 | **27,82** |
| sanjose | 2289 | 1,77 | 5,89 | 16,46 |

Δ = margen con el ángulo del sol − margen con el tilt fijo de 30°.

**El contraste que el punto 6 necesita** — mediodía SOLAR de cada planta contra
la hora en que el backtracking corrige de verdad:

| planta | mediodía | p50 Δ | backtracking | p50 Δ | razón |
|---|---|---|---|---|---|
| elburgo | 12:00 (1°) | 6,67 | 5:00 (20°, corr −40°) | 2,26 | ×3,0 |
| fayon | 12:00 (0°) | 10,04 | 5:00 (22°, corr −38°) | 2,10 | ×4,8 |
| sanjose | 17:00 (−3°) | 5,89 | 12:00 (51°, corr −9°) | 1,52 | ×3,9 |
| tunez | 11:00 (5°) | 8,98 | 18:00 (−26°, corr 34°) | 1,08 | ×8,3 |

**Y una validación interna:** en El Burgo, a las 10:00 el seguidor va a 29,2° —
casi el 30° fijo— y la diferencia cae a **0,16 dB**. El método coincide consigo
mismo exactamente donde los ángulos coinciden.

### Lo que «por seguidor» vale hoy, y está medido

En las **doce** plantas del repo hermano, todos los seguidores tienen la
**misma rotación de eje**. Como `singleaxis` depende del azimut del eje y de la
posición del sol —que sobre 500 m no cambia—, hoy el ángulo sale idéntico para
todos: **el efecto entero está en la mitad «por hora»**. El índice se pasa de
verdad igualmente, para el día que llegue una planta con bloques girados
distinto o seguimiento adaptado a pendiente.

### Lo que queda fuera

- **El control en pantalla.** Hoy `S.rf.sol` lo enciende el útil de careo; la
  app sigue con el deslizador. Falta decidir cómo se elige la hora y si el
  deslizador se queda como anulación manual.
- **El raster de cobertura** pasa `{x, y}` pelados a propósito —son receptores
  hipotéticos, no equipos—, así que ahí no hay índice de seguidor. Con el alfa
  global daba igual; con el alfa por seguidor hay que decidir qué ángulo usa.
- **Un solo día.** El careo barre el solsticio de verano, que es el de mayor
  recorrido. El invierno mueve otra cosa y no está medido.
- Sin datos no se inventa un ángulo: si falta la posición de la planta o la
  hora, se cae al deslizador **con motivo** (`angulo_*`), que viaja a la salida.

## 3 · Medido frente a predicho

**Hecho** — `tools/medido_vs_predicho.mjs`. Resultado con el COORD incluido:

```
ACIERTO      50   98,0 %  [89,7–99,7 %]
LO MATA       0    0,0 %  [ 0,0– 7,0 %]
INCOMPLETO    1    2,0 %  [ 0,3–10,3 %]   62 → 97, 158 m, −0,32 dB
NO EVALUADO   0
TCU→NCU aparte: NCU→68 47 m 44,84 · NCU→62 28 m 53,77 · NCU→59 37 m 58,01
```

**Lo que quedó fuera:**

- **La población.** Los 52 enlaces son el **árbol de encaminamiento**: de cada
  vecindario, el que la malla eligió POR SER EL MEJOR. Que el modelo acierte
  ahí es lo esperable aunque fuera flojo. El sesgo de supervivencia sigue vivo.
- **Los ~736 pares observados** del `zigbee_routes.csv` de El Burgo (1.302.763
  filas, 25.766 instantáneas). El útil que los extrae está escrito y probado
  (`Cobertura-Zigbee/tools/pares_observados.mjs`, con su banco de 28
  comprobaciones y 7 mutaciones); falta el CSV, que **no va al repo** (248 MB) y
  del que se guarda el sha256 y la tabla de exportaciones conocidas.
- **`TCU_SUNNER_ID_108`** está en distinto sitio en el layout que en el censo
  medido: residuo 18,30 m contra 0,16 m del resto. Declarado en `FUERA_POS`,
  excluido del veredicto y contado aparte. Pendiente de replanteo.
- **Las dos NCU** difieren entre layout y censo 0,78 m (NCU 1) y 5,0 m (NCU 2),
  y **ninguno de los dos ficheros declara su origen**. Pendiente de replanteo.

## 4 · Robustez

**Hecho** — `tools/robustez_medida.mjs`.

```
puntos de corte del ÁRBOL de encaminamiento   31   TRIVIAL (todo nodo interno lo es)
puntos de corte del GRAFO de enlaces viables   0
pares que la malla USÓ y el modelo no da viables: 1 de 49 · 2,0 % [0,4–10,7 %]
```

**Lo que quedó fuera:** la **razón de grado** modelo/malla no se publica contra
un árbol. La primera corrida daba «p50 ×25,5, máx ×51», y eso no medía lo
optimista que es el modelo: medía que el fichero dibuja un árbol, donde casi
todo nodo tiene grado 1. Con la bandera `ARBOL` puesta, no se publica. Se
podrá calcular cuando lleguen los 736 pares.

## 5 · Estados e incertidumbre

**Hecho** — el color del punto es el **estado** del enlace y no un dB.

- `libre` (ν ≤ −0,78, J(ν) = 0 en ITU-R P.526) · `rozando` (hasta 0) ·
  `tapado` (por encima). Mismos umbrales que ya usa Deygout: no hay un segundo
  criterio de despeje en el programa.
- El estado se sostiene sin calibrar porque sale de ν, que es **geometría y
  longitud de onda**, y no depende de la potencia, la sensibilidad, sigma ni
  las correcciones de campaña.
- El **relieve** se clasifica por su dB y NO por su ν: el ν del perfil real
  lleva dentro el suelo plano que `dosRayosDb` ya cobra, y clasificar por ahí
  pinta «rozando» toda planta llana (medido: perfil plano, relieve 0,0000 dB y
  ν = −0,384).
- **Tapado no es «sin enlace»**: en El Burgo, 190 de 215 tapados y 77 de ésos
  con 8 dB o más. La paleta es ocre, no roja, y la leyenda lo dice.
- **Procedencia rotulada siempre**, del dato y no de una opinión; manda el más
  débil.

**Lo que quedó fuera:**

- **La probabilidad no se publica**, y no se publicará hasta que haya campaña:
  `sigma_db` es `null` y un margen dice dónde está la media, no cuánto se
  mueve. Sale con motivo `sin_sigma_no_hay_probabilidad`.
- **La anilla de «sin enlace» está fuera** mientras no haya calibración: es una
  afirmación en dB. Vuelve sola con la campaña.
- **El patrón por rayo** (A2 del inventario) está a medias: hecho el rayo
  directo, pendiente el reflejado. Ver `INVENTARIO_MOTOR_RF.md`.

---

# Los tres que faltan

> **AVISO SOBRE ESTA PARTE.** De los puntos 6, 7 y 8 sólo existe el enunciado
> corto que se dijo en su día — *«comparador de tecnologías, escenario
> guardable, informe»*— y lo que se ha ido acordando de pasada. Lo que sigue
> separa **lo acordado** de **lo que hay que decidir**, y no rellena el segundo
> grupo: inventarse un alcance y luego construirlo es peor que no tener plan.

## 6 · Comparador de tecnologías

**Acordado:**

- compara **Zigbee 2,4 GHz contra LoRa EU868 y Wi-SUN FAN** sobre la misma
  planta y la misma geometría;
- **`A2` es prerequisito** y ya está hecho para el rayo directo: sin patrón
  parametrizable, `gtx_dbi` como escalar no se puede llevar a sub-GHz, porque
  allí la antena es otra con otro patrón;
- **el punto 2 lo condiciona**: con un tilt fijo la comparación mide menos de
  lo que dice;
- la fase 3 (`FASE3_LATENCIA_STOW.md`) ya dice que **no hay veredicto de
  latencia** y por qué: ni el tiempo por salto ni el número de transacciones
  están medidos en ningún repo. Un ranking sin eso delante se lee como si lo
  estuviera.

**Por decidir, y no me lo invento:**

- **qué se compara**: ¿alcance por salto, número de NCU necesarias, latencia a
  la última TCU, coste, las cuatro?
- **qué se declara y qué se calibra** para LoRa y Wi-SUN: hoy no hay datasheet
  citado de ninguna de las dos, y el criterio del repo es que un número sin
  procedencia no entra;
- **cómo se presenta** un resultado en el que una tecnología gana en una cosa
  y pierde en otra;
- **si el comparador vive en el visor o es un útil de línea de órdenes** que
  publica una tabla.

## 7 · Escenario guardable

**Acordado:**

- que se pueda **guardar y recuperar** un estado del visor para volver a él o
  pasárselo a otro, en vez de reconstruirlo a mano;
- por la regla del repo, un escenario guardado tiene que llevar **con qué
  parámetros se generó** — si no, se convierte en una captura más que se lee
  igual de bien que una de hoy y dice otra cosa, que es justo lo que ha pasado
  con el motor antiguo.

**Por decidir:**

- **qué entra** en un escenario: ¿planta, NCU colocadas, tilt, variante,
  terreno, capa activa, parámetros?
- **dónde se guarda**: ¿fichero descargable, `localStorage`, repo?
- **qué pasa al abrir un escenario viejo** cuyos parámetros ya no son los de
  hoy: ¿se recalcula, se avisa, se niega?
- **versionado**: un escenario sin versión de `radio_params.json` no es
  reproducible.

## 8 · Informe

**Acordado:**

- sacar del visor un documento con el resultado de una planta, para llevárselo
  a una reunión o a un cliente;
- tiene que llevar **la procedencia y el alcance** encima: con qué motor, con
  qué parámetros, cuántos enlaces mirados de cuántos, y qué mecanismos no se
  han podido evaluar. Un informe que no lo diga hereda todos los problemas que
  esta fase lleva cerrando.

**Por decidir:**

- **formato**: ¿PDF como el que ya emite el visor, Markdown, HTML?
- **qué secciones**, y cuáles son obligatorias;
- **qué se hace cuando faltan datos** (sin terreno, sin campaña, sin canal):
  ¿se emite con los huecos rotulados, o no se emite?
- **si el informe es reproducible**: mismo escenario → mismo informe, que
  enlaza con el punto 7.

---

## Lo que bloquea, en una lista

Nada de esto lo puede desbloquear el código:

| qué falta | bloquea |
|---|---|
| el **canal** del volcado de inventario | la potencia deja de ser cota superior; el punto 6 |
| la **campaña de calibración** (`sigma_db`) | la probabilidad del punto 5; el dB en el mapa; la anilla |
| el **`zigbee_routes.csv`** de El Burgo | los 736 pares del punto 3 y el grado del punto 4 |
| los **CSV de 30 s del SCADA** (`30506`) | el giro real de la fase 3 |
| el **replanteo** de las dos NCU y del seguidor 108 | el residuo de 18,30 m y los 5,0 m de la NCU 2 |
| el **levantamiento de Fayón** | esa planta, antes que ninguna otra |
