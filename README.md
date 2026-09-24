# Demo Siting — Siting de comunicaciones

> Herramienta web de un solo fichero para situar y dimensionar la red de comunicaciones (NCU/GW/HSU/repetidores) de plantas de seguidores Factiun a partir de las coordenadas de los motores.

## Qué es
`index.html` resuelve el **siting de comunicaciones** de una PSFV de seguidores: dado el conjunto de motores (1 motor = 1 TCU = 1 seguidor), calcula **dónde colocar las NCU** (concentradores) para cubrir todas las TCU dentro del radio, sin superar la capacidad de cada NCU/GW y sin mezclar power blocks. Es una **demo/POC autónoma**: un único HTML, sin servidor, sin backend y sin guardado.

Sirve para tres cosas: (1) **siting automático** de un layout nuevo desde CSV/Excel de motores, (2) **consulta de proyectos reales** precargados como presets de solo lectura, y (3) **verificación de cobertura** y exportación de coordenadas UTM para campo.

## Funcionalidades
- Lienzo Canvas 2D con pan/zoom: reparto de NCU coloreado, radios de cobertura, power blocks, rejilla y **mesas a tamaño real**.
- Modelo: NCU ≤ **160 TCU** (2 GW de 80), **radio 250 m** directo NCU↔TCU, HSU en el borde, repetidores y **sin mezclar power blocks**.
- Islas pequeñas: primero **anfitriona reubicada**, luego **repetidor**, y NCU propia como último recurso. Una componente aislada con ≤ N TCU («Isla a repetidor», 12 de fábrica, 0 = nunca): si una NCU vecina con hueco puede **reubicarse** y cubrir directo su grupo entero y la isla (1-centro de la unión dentro del radio con margen), sobra el repetidor — cero equipos extra. Si la unión no cabe, repetidor auto-ubicado que cubre la isla, enlaza con la anfitriona y respeta la guarda. Si la isla es grande, está lejos o no hay hueco, lleva su NCU como siempre.
- Las HSU se eligen **con criterio de implantación**: puntuación por sector — poste compartido (NCU de borde franco con ≥120° de cielo libre a 250 m **y de cerca a 80 m**), exposición lejana y **cercana** (el saliente convexo del contorno gana al rincón cóncavo, y el empuje va hacia la bisectriz del cielo libre — al exterior), **enlace por radio a su NCU** (aviso si no llega), **cota del terreno** si el CSV trae columna `z`/`cota` (el punto alto ve el viento), y centrado del sector. **Separación mínima** entre estaciones (perímetro/2N): dos anemómetros juntos miden el mismo viento. Sectores vacíos o sin sitio a distancia (plantas diagonales o cóncavas) se ensanchan: las N estaciones salen siempre.
- Las NCU y HSU **no se plantan sobre las mesas** y la distancia libre configurada («Libre NCU» / «Libre HSU», 2 m de fábrica) es **dura**: a menos de eso no se coloca nada. El siting prefiere el pasillo ancho o la calle (≥6 m, como en los proyectos reales) — con prórroga del barrido hasta 90 m cuando el campo cercano es un bloque macizo (Páramo: los caminos están a 57–85 m del centro de carga) — y antes de incumplir la guarda sacrifica lo que tiene arreglo: primero el margen del corte GW (el reparto en gateways es lógico y se reclava sin desbordar) y después la cobertura (rojo + repetidor u otra NCU). Solo si nada a alcance da la guarda queda el punto de máxima holgura, **en rojo como incumplimiento**. Vale para el cálculo, el clic manual, el arrastre y el autositing conservador. El panel avisa además si las cotas de mesa de Parámetros no caben en el paso real de la planta (mesas solapadas).
- Presets reales (solo lectura): Ayora 24025, Páramo 25019, San José 24019, El Burgo I 23003. Siting automático: 26127 FUV I / FUV II.
- **Mapa de calor** desde un Tx que se coloca con un clic: «si pongo el concentrador AQUÍ, hasta dónde llego». Dos modos, y son dos preguntas distintas. **Margen** pinta el enlace *directo* Tx↔punto con la física de la capa RF (`rfMargin`): contesta «¿se oirían estos dos?». **Saltos** pinta cuántos saltos de malla hacen falta, con la **misma elipse de alcance E-W/N-S** que reparte las NCUs — o sea **geometría, no física**: «llega en 3 saltos» no dice que el enlace aguante. Hace falta tener los dos: en El Burgo I, con el Tx en la NCU-01 real, el modo Margen deja el 96 % de la planta bajo 0 dB (mediana TCU→NCU 158 m contra alcances de 40/90 m: la red va de vecino en vecino, no en directo). Con la capa puesta los seguidores y los power blocks van en gris, para que el único color del dibujo sea el del mapa.
- Regla de medición, detalle de NCU (árbol de líneas a cada TCU) y panel de avisos (verde / ámbar / rojo).
- Exporta **PNG**, **CSV de asignación** y **CSV de equipos** en coordenadas UTM para replanteo.

## Uso
1. Abre `index.html` (sin servidor) o el despliegue.
2. Elige un proyecto, o carga datos propios (CSV de motores o Excel Factiun).
3. Ajusta parámetros (radio, capacidades NCU/GW, nº de HSU): el reparto se **recalcula al instante** (salvo presets bloqueados).
4. Revisa el panel de avisos y **exporta** PNG/CSV.

CSV de motores: cabecera autodetectada (`Coordenada X/Y`, `x/y`, `este/norte`, `lat/lng`, `power_block`, `id`, `largo/ancho/az`). Coordenadas grandes = **UTM** (se conserva el origen). Límite 6000 puntos.

## Stack
Single-file HTML · Vanilla JS · **Canvas 2D**. Sin framework ni build. **SheetJS** (CDN) solo para leer Excel; el resto funciona offline.

## Despliegue (URL)
GitHub Pages: https://imoriana3.github.io/siting/ · `.nojekyll` incluido. Source: *Deploy from a branch* → `main` / `/ (root)`.

## Notas
- Coordenadas internas relativas + origen UTM (`projOX`/`projOY`) para que los exports salgan en coordenadas absolutas.
- El **chrome** (cabecera, panel, controles) es oscuro Factiun; el **lienzo técnico se mantiene claro a propósito**: las NCU se dibujan en navy con borde blanco, pensadas para fondo claro.
- Limitaciones: sin persistencia; repetidores con radio directo (las cadenas mesh no se modelan — ver San José); cobertura en línea recta. Vía prevista de entrada: DWG → DXF (`ezdxf`).

## ⚠ EL CORTE: 2026-09-24, commit `aef8c53`

**Cualquier captura, informe o decisión tomada sobre el mapa RF con fecha
anterior al 24-09-2026 lleva el MOTOR ANTIGUO.** El corte es exacto: lo cambia
el commit `aef8c53` («Fase 4 · punto 5»), que es el que hace pasar el bucle de
dibujado por `rfMargenDe` en vez de por `rfMargin`.

Hasta ese commit el bucle pintaba los puntos TCU con el modelo **congelado**
(`rfMargin`, con `EL_BURGO_BIAS_DB` = −33,6 dB dentro), saltándose la puerta
única, mientras el panel de perfil usaba el motor nuevo: el color del punto y
el número del panel podían venir de dos motores distintos en el mismo enlace.

Medido sobre 6.035 enlaces de 10 plantas — `node tools/careo_motores_mapa.mjs`:

| | |
|---|---|
| diferencia mediana (viejo − nuevo) | **−20,0 dB** — el mapa era PESIMISTA |
| puntos en otra banda de color | **74 %** (4.440 de 6.035) |
| puntos al otro lado del umbral de 8 dB de la anilla | **39 %** (2.364) |

Para nueve de las diez plantas es un **corrimiento de banda**: el veredicto de
fondo no cambia, sólo el color. Hay una excepción, y no es menor.

### BAGNARELLI ES OTRA COSA: ahí el veredicto se invierte

`node tools/careo_motores_mapa.mjs --planta bagnarelli`

| seguidor | D (m) | VIEJO dB | color viejo | NUEVO dB | color nuevo |
|---|---|---|---|---|---|
| TK005 |  41,0 |    18,3 | verde claro |  51,0 | verde |
| TK008 |  50,0 |    10,2 | ámbar       |  42,7 | verde |
| TK002 |  56,5 | **−132,5** | rojo oscuro |  40,7 | verde |
| TK011 |  60,0 |     1,9 | rojo        |  34,1 | verde |
| TK014 |  70,7 | **−153,1** | rojo oscuro |  22,4 | verde claro |
| TK017 |  81,7 |    −7,0 | rojo oscuro |  17,7 | verde claro |
| TK004 |  96,5 | **−134,1** | rojo oscuro |  32,1 | verde |
| TK007 | 103,3 |     8,0 | rojo        |  30,3 | verde |
| TK010 | 111,0 | **−153,5** | rojo oscuro |  17,4 | verde claro |
| TK001 | 113,2 |    16,9 | verde claro |  34,0 | verde |
| TK013 | 119,4 |    −9,1 | rojo oscuro |  16,5 | verde claro |
| TK016 | 128,4 |   −10,7 | rojo oscuro |   9,6 | ámbar |
| TK003 | 138,5 | **−146,9** | rojo oscuro |  20,5 | verde claro |
| TK006 | 144,8 |     3,9 | rojo        |  24,4 | verde claro |
| TK009 | 151,7 | **−157,5** | rojo oscuro |  13,4 | ámbar |
| TK012 | 173,1 |   −13,4 | rojo oscuro |   3,9 | rojo |
| TK015 | 181,0 | **−160,8** | rojo oscuro |  −2,6 | rojo oscuro |

**10 de los 17 enlaces pasan de margen NEGATIVO a POSITIVO.** 12 entran o salen
de la anilla de «sin enlace» y 16 cambian de color. El mapa viejo enseñaba 12
de 17 en rojo oscuro — una planta prácticamente muerta — donde el motor nuevo
da 9,6 dB o más en 15 de 17. Los siete valores de −132 a −161 dB son
**imposibles**: no son una predicción pesimista, son el modelo congelado
descolgándose en esa geometría.

> **Si alguien decidió algo sobre Bagnarelli mirando ese mapa —dónde va la NCU,
> si hacía falta un repetidor, si la planta necesitaba otra cosa— hay que
> rehacerlo.** No es un ajuste de tono: es que el mapa decía «no llega» donde
> llega con 20 a 50 dB de sobra.

Sólo TK015 sigue sin margen con los dos motores (−160,8 → −2,6), y ahí el
veredicto de «no llega» se sostiene.

### Y desde ese mismo commit, el color ya no es un dB

Los parámetros de radio son heredados del modelo congelado, `sigma_db` está sin
calibrar y el canal es desconocido —hasta 16 dB de recorrido—, así que ese
margen no es una predicción. El color del punto es el **estado** del enlace
(libre / rozando / tapado), que sale de ν y no depende de nada de eso. El dB
vuelve solo en cuanto haya campaña calibrada. La leyenda de la capa lo dice en
pantalla, con su rótulo de procedencia.

*Factiun · proyecto interno.*
