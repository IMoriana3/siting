# Demo Siting — Comunicaciones de seguidores solares

### Herramienta web de un solo fichero para situar y dimensionar la red de comunicaciones (NCU, HSU y repetidores) de plantas de seguidores solares Factiun a partir de las coordenadas de los motores.

## 1. Objetivo

`demo-siting.html` resuelve el **siting de comunicaciones** de una planta fotovoltaica de seguidores: dado el conjunto de motores (cada motor = una TCU = un seguidor), calcula **dónde colocar las NCU** (concentradores) para cubrir todas las TCU dentro del radio de comunicaciones, sin superar la capacidad de cada NCU/GW y sin mezclar power blocks. Dibuja el reparto en un lienzo con desplazamiento y zoom, valida la cobertura y exporta los resultados (imagen y CSV con coordenadas UTM para replanteo).

Está pensada como **demo/POC autónoma**: un único fichero HTML, sin servidor, sin backend y sin guardado. Sirve para tres cosas:

- **Siting automático** de un layout nuevo cargando un CSV o Excel de motores.
- **Consulta de proyectos reales** ya diseñados, precargados como presets de solo lectura.
- **Verificación de cobertura** y exportación de coordenadas para campo.

## 2. Cómo funciona (arquitectura)

Toda la lógica vive en un único fichero HTML: marcado, estilos y un solo bloque de script interno. La única dependencia externa es **SheetJS**, que se carga desde CDN y solo se usa para leer Excel.

El estado global está en un objeto `S` (motores, NCU, HSU, repetidores, parámetros y flags de vista). El flujo es:

```
 ENTRADA                         NÚCLEO (objeto S)                   SALIDA
 ───────                         ─────────────────                   ──────
 CSV de motores      ─┐                                          ┌─► Lienzo Canvas 2D
 Excel Factiun       ─┼─► parse* ──► S.motors ──► recompute() ───┤   (pan / zoom)
 Presets embebidos   ─┘                              │           ├─► PNG
                                                     │           ├─► CSV asignación (UTM)
                          siteAll()  ── sitúa NCU ───┤           └─► CSV equipos (UTM)
                          placeRSUs() ─ sitúa HSU ───┤
                          convexHull() ─ contorno ───┤
                          applyNumbering() ──────────┘
```

- **`parse*`**: `parseCSV` (CSV de motores) y `parseProjectXLSX` (plantilla Excel) traducen la entrada al modelo interno.
- **`recompute`**: relee parámetros, ejecuta el siting (`siteAll`), coloca HSU (`placeRSUs`), calcula el contorno (`convexHull`), numera y colorea, y redibuja.
- **`recomputeNewData`**: variante para datos nuevos (CSV o escenario) que recalcula desde cero.
- Los **presets reales** se cargan con `loadProject` y quedan **bloqueados** (no se re-sitúan); el **siting automático** sí recalcula las NCU.

### Modelo de comunicaciones

| Elemento | Regla |
|---|---|
| **NCU** (concentrador) | Máx. **160 TCU**, repartidas en **2 gateways (GW) de 80 TCU** cada uno. |
| **Radio de cobertura** | **250 m**, medido **directo** de la NCU a cada TCU (no por saltos). |
| **TCU / motor** | 1 por seguidor. |
| **HSU** | Estación meteorológica; se sitúa en el borde de la planta con cobertura. |
| **Repetidor** | Extiende cobertura a TCU que quedan fuera del radio de su NCU. |
| **Power block (PB / PS)** | Agrupación de cliente; el reparto **nunca mezcla** dos power blocks en una misma NCU. |

## 3. Contenido del paquete

| Archivo | Qué es |
|---|---|
| `demo-siting.html` | La aplicación completa: interfaz, lógica y proyectos embebidos. Es lo único que hay que abrir o desplegar. |

Los proyectos reales y las plantas de ejemplo van **embebidos** dentro del propio fichero (no son archivos aparte). Los CSV/Excel de origen son entrada del usuario.

## 4. Requisitos

- Un navegador moderno (Chrome, Edge, Firefox o Safari) con JavaScript activado.
- **Conexión a internet la primera vez**, solo para cargar SheetJS desde CDN. Sin conexión, todo funciona salvo el **cargador de Excel** (el de CSV y los presets sí).
- No requiere servidor, instalación, cuentas ni credenciales.

## 5. Instalación / configuración

No hay nada que configurar: ni variables, ni puertos, ni credenciales, ni Firebase. Es un fichero autónomo.

- **Local**: abrir `demo-siting.html` con doble clic.
- **Publicado**: subir el fichero a cualquier hosting estático (GitHub Pages, Netlify, un bucket…). No necesita build.

> TODO: definir repositorio y URL de despliegue si la herramienta se va a publicar.

## 6. Puesta en marcha (paso a paso)

1. Abrir `demo-siting.html`.
2. **Elegir un proyecto** con los botones, o **cargar datos propios** (CSV o Excel de motores).
3. Ajustar los **parámetros** del panel izquierdo si hace falta (radio, capacidades, nº de HSU).
4. Revisar el **reparto** en el lienzo y el **panel de avisos**.
5. **Exportar** lo que necesites (imagen PNG, CSV de asignación, CSV de equipos).

## 7. Uso

### Proyectos precargados

- **Presets reales (botones azules, solo lectura)** — llevan las NCU del proyecto real y quedan bloqueados para no alterar el diseño:
  - **Ayora 24025** — 754 TCU · 16 NCU · 10 HSU · 5 repetidores · doble nomenclatura Factiun/GZ.
  - **Páramo 25019** — 396 TCU · 4 NCU (Ethernet) · 3 HSU.
  - **San José 24019** — 2289 TCU · 21 NCU · 8 HSU · 9 repetidores · doble nomenclatura Factiun/Acciona.
  - **El Burgo I 23003** — 215 TCU · 2 NCU · 4 HSU · **mesas a tamaño real** (64,6 m y 32,6 m) calculadas desde los strings del Excel.
- **Siting automático (botones ámbar)** — solo motores, sin NCU; la app las **calcula**:
  - **26127 FUV I** — 656 motores → 10 NCU + 3 HSU.
  - **26127 FUV II** — 662 motores → 11 NCU + 3 HSU.

### Cargar datos propios

- **Cargar CSV**: un fichero de coordenadas de motores (ver formato más abajo).
- **Cargar proyecto (Excel)**: plantilla Factiun con pestañas de TCU/NCU/HSU/STRING.

### Parámetros (panel izquierdo)

| Parámetro | Por defecto | Qué controla |
|---|---|---|
| Radio de cobertura | 250 m | Distancia máxima NCU↔TCU. |
| Máx. TCU/NCU | 160 | Capacidad del concentrador. |
| Máx. TCU/GW | 80 | Capacidad por gateway. |
| Nº de HSU | sugerido | Estaciones meteo a colocar. |
| Alcance malla E-O / N-S | 40 / 90 m | Hueco máximo para considerar la malla conexa. |
| Eje GW | E-O | Eje de partición de los dos gateways. |

Al cambiar un parámetro, el reparto se **recalcula al instante** (salvo en presets bloqueados).

### Visualización (toggles)

Radios de cobertura · color por GW · power blocks · rejilla · **dibujar mesas (tamaño real)**. Con las mesas activas aparecen los campos de **largo/ancho** por defecto del tracker.

### Herramientas

- **Regla de medición**: toca el punto A y el punto B para ver la distancia (m/km).
- **Detalle de NCU**: al seleccionar una NCU, dibuja el árbol de líneas a cada una de sus TCU y marca el **alcance** hasta la más lejana.
- **Desbloquear edición** (solo en presets): permite mover NCU; al editar, reasigna las TCU por cercanía respetando el power block.
- **Exportar imagen** (PNG), **CSV de asignación** y **CSV de equipos**.

## 8. Cómo interpretar los resultados

- **Color de cada motor** = NCU a la que está asignado.
- **Rombo navy** = NCU · **triángulo ámbar** = HSU · **círculo violeta "R"** = repetidor.
- **Anillos alrededor de una TCU**: **violeta** = está fuera del radio de su NCU pero la cubre un repetidor; **rojo** = sin cobertura.
- **Panel de avisos**:
  - **Verde** = reparto válido (malla conexa, cada TCU a ≤ radio, sin pasar capacidades, sin mezclar power blocks).
  - **Ámbar** = válido pero con alguna NCU al límite de capacidad.
  - **Rojo** = problemas (NCU sobre capacidad, TCU sin cobertura, malla rota…), con el detalle.
- **Detalle de NCU**: el alcance indicado es la distancia a la TCU más lejana de esa NCU; si supera el radio, hay que añadir repetidor o reubicar.

## 9. Formato de los datos

### CSV de entrada (motores)

Una fila por motor. La cabecera se autodetecta; se reconocen:

| Concepto | Cabeceras aceptadas |
|---|---|
| Coordenada X / Este | `Coordenada X`, `x`, `este`, `easting` |
| Coordenada Y / Norte | `Coordenada Y`, `y`, `norte`, `northing` |
| Geográficas | `lat`, `lng` |
| Power block | `power_block` |
| Identificador | `id` |
| Tamaño de mesa | `length`/`largo`, `width`/`ancho`, `azimuth`/`az` |

Ejemplo mínimo (solo coordenadas UTM):

```csv
Coordenada X,Coordenada Y
671496.3765,4570133.8115
671509.3765,4570133.8115
```

Las coordenadas grandes se interpretan como **UTM** y se conserva el origen para que los CSV de salida vuelvan a coordenadas absolutas. Límite de **6000 puntos** por carga.

### CSV de salida

- **Asignación**: cada TCU con su NCU, GW y coordenadas (incluye `x_utm`, `y_utm`).
- **Equipos**: NCU, HSU y repetidores con `x_m`, `y_m`, `x_utm`, `y_utm` para replanteo.

### Esquemas de proyecto embebido

Para añadir un proyecto nuevo dentro del fichero:

- **Preset real con NCU dadas** (`loadProject`):
  - `P.tcus = [x, y, ncu, gw, tracker, ps, len, wid, az]` — `len`/`wid`/`az` opcionales (mesa a tamaño real).
  - `P.ncus = [factiun, gz/alt, tipo, x, y, ps]`.
  - flags: `usePS`, `showGZ`, `tables`, `name`, `sc`, `ox`, `oy` (origen UTM).
- **Solo motores para siting automático** (tipo FUV):
  - `{ ox, oy, name, pts: [[x, y], …] }` — coordenadas relativas al origen UTM `(ox, oy)`.

## 10. Solución de problemas

| Síntoma | Causa | Arreglo |
|---|---|---|
| El cargador de Excel no responde | Sin internet: SheetJS (CDN) no cargó | Conectar a la red y recargar la página. |
| El CSV no aparece tras cargarlo | Cabeceras no reconocidas | Usar `Coordenada X`/`Coordenada Y` (o `x`/`y`, `este`/`norte`). |
| Salen muchas NCU | Campo muy extenso frente al radio de 250 m | Es esperable (p. ej. FUV I ocupa ~3 km); ajustar radio o capacidades si procede. |
| TCU con anillo rojo | Fuera del radio y sin repetidor que la cubra | Añadir un repetidor o una NCU, o ampliar el radio. |
| Las mesas no se dibujan | Toggle de mesas desactivado o sin tamaño definido | Activar "Dibujar mesas"; si el proyecto no trae tamaños, se usan los valores por defecto del panel. |
| Un preset no deja mover NCU | Está bloqueado (solo lectura) a propósito | Pulsar "Desbloquear edición". |

## 11. Notas técnicas

- **Single-file**, Vanilla JS, **Canvas 2D**. Sin framework ni build. SheetJS por CDN para Excel.
- El **siting** (`siteAll`) es un agrupamiento geométrico que respeta el radio, la capacidad de NCU/GW, no mezcla power blocks y vigila que la malla quede conexa (sin claros mayores que el alcance E-O/N-S).
- Coordenadas internas **relativas** + **origen UTM** (`projOX`, `projOY`) para que los exports salgan en coordenadas absolutas.
- **Presets reales bloqueados** (`preset`/`fromAyora`): no renumeran ni re-sitúan; el siting automático y los CSV sí recalculan.
- Las **mesas** se dibujan como rectángulos largo×ancho centrados en el motor y girados por azimut; en El Burgo I el tamaño de cada mesa se obtuvo del **bounding box de los strings** del Excel.

## 12. Limitaciones y posibles mejoras

- **Sin persistencia**: no guarda nada (aislada a propósito); cada sesión parte de cero.
- **Modelo de repetidores directo**: se asume un radio único por repetidor. Las **cadenas mesh** de repetidores no se modelan — se detectó en San José, donde 174 TCU aparecen "sin cobertura" con el modelo directo, señal de que el diseño real **encadena** repetidores.
  > TODO: confirmar cómo encadenan los repetidores de Factiun para refinar la verificación de cobertura.
- **Cobertura en línea recta**: no considera orografía ni obstáculos.
- **Sin entrada DWG**: hoy entra CSV y Excel. La vía prevista es **DWG → DXF → `ezdxf`** con un parser ajustado a las capas y bloques del proyecto.
  > TODO: aportar un DXF de muestra para escribir el adaptador.
- **Mejoras pendientes**:
  - Adaptador **`from_excel()`** a un formato canónico común, para reutilizar el render desde el notebook SolarGPT (`render_siting`).
  - **Aligerar** el HTML moviendo los proyectos embebidos a ficheros aparte (el fichero ya pesa ~245 KB).
  - Dibujar el **gap del motor** como hueco real (dos sub-mesas) en vez de un rectángulo continuo.
