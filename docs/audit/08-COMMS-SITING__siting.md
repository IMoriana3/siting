# Auditoría de siting de comunicaciones y motor RF

## 1. TASK IDENTIFICATION

| Campo | Valor |
|---|---|
| `TASK_ID` | `08-COMMS-SITING__siting` |
| `TARGET_CHAT` | `08_COMMS` |
| Repositorio | `siting` |
| Modo | `AUDIT_ONLY_THEN_PERSIST_REPORT` |
| Rama base auditada | `work` |
| Commit base auditado | `d133eed0b4700be08a34c02fafa8cdb7f8c97c3f` |
| Fecha de auditoría | 2026-09-21 |
| Alcance de cambios | Este informe exclusivamente; no se modificaron código, parámetros, tests ni presets. |

**Método.** Se leyó todo el código y los bancos versionados del repositorio, se trazaron las llamadas de la UI y se ejecutó la suite Python/JavaScript. Las referencias a repositorios ajenos en `INVENTARIO_MOTOR_RF.md` se tratan como afirmaciones, no como evidencia: no existen copias de `cobertura-rf-fv`, `Cobertura-Zigbee` ni `SolarGPTfull` en este checkout. Las etiquetas usadas son:

- reglas: `PHYSICAL_CALCULATION`, `DESIGN_RULE`, `PRODUCT_POLICY`, `APPROXIMATION`, `IMPORT_ASSUMPTION`, `MEASURED_FACT`;
- implementaciones: `CANONICAL`, `MIRROR`, `ADAPTER`, `LEGACY`;
- discrepancias: `INTENTIONAL`, `APPROXIMATION`, `LEGACY`, `BUG`, `UNKNOWN`.

## 2. EXECUTIVE FINDINGS

1. **La UI mezcla deliberadamente dos verdades distintas.** El autositing y el mapa de saltos usan una elipse geométrica `40 m E-W / 90 m N-S` y un radio de asignación configurable; el mapa de margen usa balance RF. La conectividad que valida el reparto no demuestra viabilidad física RF. Esto es una discrepancia `INTENTIONAL`, pero el mensaje “reparto válido” puede leerse como veredicto RF y por ello es un riesgo de producto.
2. **La configuración visible no coincide con la documentación de portada.** La UI arranca con radio NCU `300 m`, `Libre NCU=6 m` y `Libre HSU=10 m`; `README.md` declara `250 m` y guardas “2 m de fábrica”. `siteAll` conserva un defecto programático de `250 m`, pero la ruta normal le pasa `300 m`. Discrepancia `BUG` documental/configuracional.
3. **No hay máximo de TCU de planta como regla de producto; hay un tope de importación CSV de 6.000 filas.** La capacidad es 160 TCU/NCU y 80 TCU/GW, con exactamente dos arrays de GW por NCU. La UI permite editar ambos números sin imponer `capNCU <= 2*capGW`; una combinación incoherente puede producir NCU bajo su límite y GW desbordado, aunque el panel lo avisa. Discrepancia `BUG` de validación.
4. **La topología configurada y la inferida sí están separadas en estado, pero no en el esquema exportado.** Los presets conservan NCU/TCU/GW/HSU/repetidores entregados; los escenarios, CSV y plantas auto generan reparto. `Autoubicar` es conservador por defecto y `Recalcular desde cero` lo reemplaza. Los CSV no exportan provenance, `manual/preset/auto`, fuente de coordenada, versión del motor ni parámetros RF.
5. **La identidad no tiene una clave de planta normalizada.** Coexisten `sc`, nombre/proyecto, códigos embebidos en el nombre y alias de deep-link; `25004` identifica Benante y `25004.2` Panbianco, mientras presets/exports no publican un `plant_id` estable. Los IDs generados pueden colisionar semánticamente con IDs importados y los CSV no escapan comas.
6. **En este repo hay dos generaciones ejecutables de física:** `zigbee_pv_model.js` (`LEGACY`) y el motor por bandas (`radio_pv_model.js` + `radio_zigbee.js`, `CANONICAL`). El Python nuevo es `MIRROR` de cálculo, no lo ejecuta la UI. `radio_malla.js` es un `ADAPTER` de topología física, pero la UI actual no lo usa para autositing ni para el heatmap de saltos.
7. **La UI actual ejecuta el motor nuevo por defecto**, con parámetros cargados de `radio_params.json`; conserva una puerta al antiguo en estado/tests, pero no se encontró un control visible que permita al usuario cambiar `S.rf.motor`. El checkbox “Cobertura RF” todavía dice “sesgo −33 dB”, contradiciendo el motor nuevo sin sesgo. Discrepancia `BUG` de rotulado.
8. **La altura RF efectiva actual es 1,5 m en ambos extremos.** No hay alturas distintas por TCU/NCU/HSU ni patrón de antena. El perfil de terreno nunca se entrega desde `rfEnlace`; `relieveDominante` está probado pero es código no integrado. Vegetación, sigma y canal están explícitamente desconocidos; aun así la variante PRO produce un margen como cota superior.
9. **Los hashes locales citados por `INVENTARIO_MOTOR_RF.md` se reproducen exactamente.** No se pueden verificar sus hashes, líneas, planos, datos o afirmaciones sobre repos externos/factiun_core desde este repositorio. La frase del Python local sobre paridad a `0,000000 dB` con `factiun_core.rf` tampoco tiene banco local que importe ese paquete.
10. **La paridad JS/Python del motor nuevo está fuertemente cubierta**, incluida igualdad bit a bit del barrido. No existe gemelo Python local de `radio_zigbee.js`; la paridad auditada es del núcleo físico/geométrico, no del presupuesto Zigbee completo ni de la UI.

## 3. SITING POLICY INVENTORY

| Regla / comportamiento | Implementación observada | Clase | Estado / límite de verdad |
|---|---|---|---|
| Capacidad NCU | Panel `160`; `partitionComponent`, k-centro, fusiones, relajación y reasignación impiden superar `capNCU`; editable desde 1. | `PRODUCT_POLICY` | No hay fuente externa. El panel avisa sobrecapacidad. |
| Capacidad GW | Panel `80`; `splitGW` crea exactamente dos grupos por NCU alrededor de eje E-W/N-S; el corte puede desacoplarse de la posición física mediante `_gwCut`. | `PRODUCT_POLICY` + `DESIGN_RULE` | No representa GW físicos con coordenada/ID propio. Falta validar `capNCU <= 2*capGW`. |
| Nº máximo de TCU | 6.000 filas sólo en CSV; Excel y presets no pasan por ese corte. | `PRODUCT_POLICY` | Es límite de rendimiento/importación, no capacidad de planta. Inconsistencia por canal de entrada (`BUG`). |
| Presupuesto 1 motor = 1 TCU = 1 tracker | Cada fila/punto se convierte en un objeto `motor`; el mismo objeto porta `id`, `tcu`, asignación NCU/GW y geometría de mesa. | `IMPORT_ASSUMPTION` | Central y no validado contra plantas con varios motores/TCU o varias TCU/tracker. |
| Radio directo | Campo UI `300 m`; ruta normal lo pasa a `siteAll`; `siteAll` por defecto es `250 m`. Asignación NCU↔TCU y enlace HSU↔NCU usan círculo euclídeo. | `DESIGN_RULE` / `APPROXIMATION` | No usa margen RF; repetidor basta si cubre el extremo por radio. README dice 250 m. |
| Hop logic de siting | `buildAdjacency`: elipse `(dx/reachX)^2+(dy/reachY)^2<=1`; componentes y conectividad interna. | `APPROXIMATION` | Por defecto 40/90 m. Sin obstáculos, frecuencia, ángulo, relieve o límite máximo de hops. |
| Hop logic RF | `RadioMalla.saltos`: BFS multirraíz sobre enlaces que un callback declara viables; inalcanzable=`null`. | `PHYSICAL_CALCULATION` + `DESIGN_RULE` | Módulo probado pero no conectado al autositing/UI actual. |
| Heatmap de saltos | BFS desde Tx/TCU con `buildAdjacency`, luego propaga mínimos a celdas. Bandas 1, 2–3, 4–6, 7–10, 11+. | `APPROXIMATION` | No aplica límite de hops; “11+” es visual, no máximo. No usa `radio_malla.js`. |
| Power blocks | Se particiona antes del siting y sólo se fusiona/reasigna con igual `pb`; import sin PB cae en grupo único `__all__`. | `PRODUCT_POLICY` | PB de presets puede inferirse desde PS/NCU. `null` mezcla todo deliberadamente. |
| Islas | Componentes con `size <= repMax` se difieren; valor UI 12, 0 desactiva. | `PRODUCT_POLICY` | “Isla” depende de la elipse geométrica, no de RF. |
| Reubicación NCU anfitriona | Busca NCU del mismo PB con capacidad; si un 1-centro aproximado cubre unión al radio con margen, mueve NCU y reejecuta corte/guarda. | `DESIGN_RULE` + `APPROXIMATION` | Heurística, no optimización global ni prueba RF. |
| Repetidores | Si no cabe la unión, busca anfitriona y posición que cubra isla y esté dentro del radio de anfitriona; si falla crea NCU. IDs `REP-01…`. | `PRODUCT_POLICY` + `DESIGN_RULE` | Sólo un repetidor; no cadenas, capacidad, identidad de radio, obstáculos ni RF. La asociación `ncu` queda inicialmente `null`. |
| HSU: cantidad | `round(perímetro/900)`, acotado 1–12; input permite 0–20; presets conservan las entregadas. | `APPROXIMATION` | Comentario lo llama ajuste de plantas reales; los datos fuente externos no están aquí. |
| HSU: selección | Candidatos por sectores/perímetro, cielo lejano 250 m, cielo local 80 m, exposición/viento, esquina convexa, asociación y penalización por radio. Puede integrar HSU en NCU o mover NCU al poste HSU bajo restricciones. | `DESIGN_RULE` + `APPROXIMATION` | Pesos y umbrales son política heurística. Viento viene opcionalmente de ERA5/Open-Meteo. |
| Separación HSU | Aproximadamente perímetro/(2N), más penalización de orientación repetida; el algoritmo amplía sectores/fallbacks. | `DESIGN_RULE` | No es una restricción física RF. |
| Clearances | Entradas iniciales: NCU 6 m, HSU 10 m. `CLEAR_MOD=2`, `CLEAR_OBJ=6`; busca calle, luego guarda dura, después sacrifica corte GW y cobertura, y sólo finalmente deja máximo despeje con error. Presets quedan exentos del error de distancia mínima, no de “encima de mesa”. | `DESIGN_RULE` + `PRODUCT_POLICY` | Geometría de rectángulo de mesa; depende de dimensiones importadas o defaults. |
| Preferencia caminos/pasillos | No se importan viales. Se infieren como puntos con despeje ≥6 m mediante espiral: 30 m fina, 90 m gruesa, hasta 180 m en fallback automático. | `APPROXIMATION` | Un hueco geométrico se usa como proxy de vial; no prueba transitabilidad/propiedad/zanjas. |
| Fallbacks de emplazamiento | Orden: calle dentro de corte → guarda dentro de corte → guarda fuera de corte → guarda rompiendo cobertura → máxima holgura; el panel marca el daño. Manual limita barrido salvo prórroga explícita. | `PRODUCT_POLICY` | Orden explícito y determinista, pero no exporta motivo/provenance. |
| GW splitting | Corte por eje seleccionado y posición NCU o `_gwCut`; GW1 oeste/sur, GW2 este/norte; si `n<=capGW`, sólo GW1. | `DESIGN_RULE` | Lógico, sin coordenadas ni identificadores de inventario reales. |
| Mesh assumptions | Autositing: conectividad elíptica entre TCU y grupo conectado. RF: grafo no dirigido, enlaces simétricos, margen umbral 0 por defecto, poda opcional. | `APPROXIMATION` | No hay routing Zigbee real, límites de profundidad, interferencia, carga, asimetría, retry ni coordinador explícito por GW. |
| Warnings | Hasta tres errores concatenados: mesa/guarda, capacidad, GW, malla, cobertura, huérfanos/vacías; avisos HSU/viento/solape/capacidad. RF devuelve `motivos` estructurados. | `PRODUCT_POLICY` | `errs.slice(0,3)` oculta errores adicionales. Presets exentos de parte de las guardas. |
| Exports | PNG, PDF rasterizado, CSV equipos y CSV asignación. Añade UTM si hay origen. | `PRODUCT_POLICY` | Sin escape CSV, CRS/zona, provenance, parámetros, clasificación configurada/inferida, warnings completos, motor/hash/calibración ni incertidumbre RF. |

### Topología configurada vs. inferida

- **Configurada:** `loadProject` conserva reparto NCU, GW por TCU, HSU y repetidores de un preset/Excel. `S.preset=true`, NCU `manual=true`; los controles no recalculan el reparto de presets en `recompute`.
- **Inferida:** escenarios sintéticos, CSV y presets `auto` llaman a `siteAll`; generan NCU, GW lógico, repetidores y HSU. `Autoubicar` conserva NCU previas y añade cobertura; `Recalcular desde cero` las elimina tras confirmación.
- **Ambigüedad exportada:** ninguno de los exports etiqueta cada entidad o asignación como configurada, importada, conservada, añadida o inferida. Es una discrepancia `BUG` respecto a trazabilidad, aunque la separación existe internamente.

## 4. PLANT / DEVICE ID ASSUMPTIONS

| Identidad | Comportamiento | Clasificación / riesgo |
|---|---|---|
| Plant ID | No existe un campo único. `sc` es slug de UI; `name/projName` es rótulo/nombre de fichero; códigos (`24025`, `25019`, etc.) están embebidos en texto. | `IMPORT_ASSUMPTION`; `BUG` de modelo de dominio. |
| Project code | Presets lo incrustan en `name`; XLSX usa nombre de fichero; CSV genérico queda con escenario/estado previo susceptible de no representar proyecto. | `IMPORT_ASSUMPTION`; provenance insuficiente. |
| Alias de planta | Deep-link sólo normaliza `elburgo`, `el_burgo`, `el-burgo` a `burgo`; no hay registro general de alias. | `PRODUCT_POLICY`; `UNKNOWN` si cubre necesidades maestras. |
| Tracker ID | CSV acepta `id/etiqueta/name/nombre/tracker_id`; si falta genera `M<n>`. Preset usa `t[4]`. XLSX busca `ACCIONA`, luego `CLIENT`, luego `TCU`, y si falta genera `T<ncu>`. | `IMPORT_ASSUMPTION`; campos semánticamente distintos se colapsan. |
| TCU ID | En presets `tcu`, `client` e `id` reciben la misma etiqueta. En auto/CSV no hay TCU de planta hasta que `applyNumbering` genera `NCU-xx·GWg·Tnnn`; export separa `tcu` y `tracker_id`, pero en inferidos `tcu` es generado y `tracker_id` importado/generado. | `PRODUCT_POLICY`; riesgo de confundir etiqueta de tracker, TCU y asignación. |
| NCU ID | Import numérico se normaliza a `NCU-xx`; autositing renumera por orden espacial; adición manual usa primer número libre. Alias cliente queda en `gz`. | `PRODUCT_POLICY`; renumeración no preserva identidad estable al recalcular. |
| GW ID | No es entidad persistente: array `[[],[]]`; export genera `<NCU>·GW1/2` y asignación `GW1/2`. | `PRODUCT_POLICY`; no puede reconciliar GW físico/serial. |
| HSU ID | Configurado: etiqueta importada. Inferido: `HSU-01…`; puede quedar `integrada=true` y asociada a NCU. `rsu` es nombre interno legado. | `LEGACY` nominal + `PRODUCT_POLICY`. |
| Repeater ID | Configurado: etiqueta normalizada parcialmente; inferido `REP-01…`. Sin alias/serial/tipo ni asociación exportada. | `PRODUCT_POLICY`; provenance perdida. |
| Aliases | NCU alternativa `gz` con etiqueta `GZ/ACC/CLI`; se obtiene por moda de filas. `showGZ` puede ocultarla aunque permanezca en datos. | `IMPORT_ASSUMPTION`; una moda puede ocultar discordancias. |
| Power-block ID | CSV lo conserva como texto; presets fabrican `PS <valor>` o lo derivan del prefijo de nomenclatura NCU. | `IMPORT_ASSUMPTION`; topología inferida depende de identidad inferida. |
| IDs generados | `M<n>`, `NCU-xx`, `HSU-xx`, `REP-xx`, TCU compuesta y GW derivado. No hay namespace de planta ni UUID. | `PRODUCT_POLICY`; colisiones entre ejecuciones/proyectos. |
| IDs inferidos | PS desde NCU/nombre; NCU cliente por moda; índice SCADA 1..N por NCU ordenado por GW/`tn`. | `APPROXIMATION`; SCADA advierte que puede cruzar estados. |
| Coordenadas | Presets guardan locales + `ox/oy`; XLSX resta mínimos y redondea 0,1 m; CSV UTM detecta “coordenadas grandes” y resta mínimos; lat/lon se proyecta con aproximación equirectangular local y no fija UTM/CRS. | `IMPORT_ASSUMPTION` + `APPROXIMATION`. |
| Provenance | Comentarios citan DWG/layouts en algunos presets y herramientas generadoras, pero el objeto de runtime/export no conserva fichero, hoja, fila, CRS, timestamp o método por punto. | `BUG` de trazabilidad. |
| Presets | Literales enormes embebidos en `index.html`; algunos contienen cotas/dimensiones y nomenclatura doble, otros defaults. No hay manifest/version/hash por planta. | `LEGACY`/`PRODUCT_POLICY`; difícil distinguir dato publicado de corrección manual. |

**Conclusión de identidad.** El modelo operativo es una fila geométrica por tracker/motor/TCU, enriquecida con etiquetas, no un modelo maestro de dispositivos. No debe usarse como autoridad de inventario sin claves inmutables y relaciones explícitas `plant → tracker → motor → TCU → GW → NCU`, además de HSU/repetidor y alias/provenance.

## 5. RF ENGINE INVENTORY

### Implementaciones locales

| Artefacto | SHA-256 | Rol | Clasificación |
|---|---|---|---|
| `radio_pv_model.js` | `74d2cc32cc8b4e61a7ef8bbf5e2fe5c75193c36f521fae17478c4ea9f1b81ed2` | Geometría de bandas/terreno y física independiente de tecnología: λ, FSPL, Fresnel, reflexión, dos rayos, filo y Deygout. `_version="fase1"`. | `CANONICAL` para UI. |
| `radio_pv_model.py` | `02df72504c7d1880738ee5c78d3c388e2ab22ec6d111fea74091b9be64ccfdab` | Gemelo Python del núcleo JS para calibración/bancos. `_VERSION="fase1"`. | `MIRROR`. |
| `radio_zigbee.js` | `6c620f89f41eb21cf34672b2698c8ac574218e079840b17fbe44fe6f8359b1b4` | Presupuesto Zigbee, variantes, correcciones calibradas opcionales, motivos de desconocimiento, viabilidad. | `ADAPTER` tecnológico. |
| `radio_malla.js` | `f0239288cb9d0796708545eab3044078e0698182efb78546c6dbcf8804933892` | Construcción de grafo por callback RF, BFS, articulaciones, redundancia y comparación con elipse. | `ADAPTER` topológico; no integrado en UI. |
| `radio_params.json` | `5b2ffa59e91a8497929d107b7f10c97bfe638a31bf3e360037c230cbd7ad0711` | Parámetros/provenance, versión `1.0.0`, fecha `2026-09-20`. | Configuración `CANONICAL` declarada para motor nuevo. |
| `zigbee_pv_model.js` | `ac06599f6343a41ac7286cb39d6f392a50a8dd7d1ee3b85a0fc0c5a717ca8d57` | Modelo de muro/puntos Deygout con defaults 2,45 GHz y sesgo El Burgo −33,6 dB. | `LEGACY`, cargado y ejecutable. |
| `index.html` bloque RF | — | Construye segmentos reales, cruces/bandas y perfil; carga parámetros; selecciona motor; renderiza margen/saltos. | `ADAPTER` UI/geometría de planta. |

### Generaciones distintas

**Conteo reproducible dentro de este checkout: dos generaciones de física ejecutables.**

1. **Generación A / congelada (`LEGACY`):** `zigbee_pv_model.js`. Obstáculo como cota superior/punto (equivalente a muro desde suelo en el armado de UI), defaults silenciosos, sensibilidad −103 dBm, sigma 6 y preset El Burgo con sesgo −33,6/sigma 6,8.
2. **Generación B / fase1 (`CANONICAL` + `MIRROR` + `ADAPTER`):** `radio_pv_model.js/.py` + `radio_zigbee.js` + `radio_params.json`. Banda con hueco/tres estados, frecuencia obligatoria, parámetros desconocidos como `null`, sin sesgo global, Deygout detallado, relieve separado y vegetación declarada no implementada.

`radio_malla.js` añade una capa topológica, no una tercera física. El inventario afirma tres generaciones externas adicionales (rf-fv con bandas/patrón, un núcleo `factiun_core.rf` pre-bandas y un espejo SolarGPTfull), pero no son contables/verificables como implementaciones en este checkout.

### Física y calibración efectivamente ejecutadas por la UI

- Carga ambos scripts, pero `S.rf.motor="nuevo"`; `rfMargenDe` enruta a `rfMarginNuevo` salvo que estado externo cambie a `antiguo`.
- El nuevo arma bandas desde intersecciones exactas con segmentos finitos de filas, incluida bífila y azimut; usa la inclinación global del slider para cada seguidor.
- `rfEnlace` usa `zA=zB=ant_h_m=1.5`; por ello no representa alturas NCU/HSU ni terreno absoluto.
- Presupuesto: pérdida de dos rayos + Deygout de bandas + relieve (cero en UI por falta de perfil) + correcciones por mesa (cero sin calibración) + vegetación (no modelada y sumada como cero con motivo). Prx usa Ptx/ganancias; margen sólo si hay sensibilidad.
- Variante inicial PRO: 2,45 GHz, +19 dBm, +3/+3 dBi, −103 dBm; canal desconocido, por lo que el margen se rotula como cota superior; sigma `null`, por lo que no hay probabilidad.
- No hay patrón angular de antena: ganancias escalares. No hay conductor perfecto especial. La geometría bajo placa mide al borde inferior y delega suelo a relieve, pero la UI no provee relieve.

### Heatmaps

- **Margen:** ejecuta la puerta `rfMargenDe`; por defecto generación B. Raster 4–10 m, obstáculos de filas reales. Responde a enlace directo Tx↔celda, no conectividad de malla.
- **Saltos:** usa la elipse de diseño y BFS propio de la UI sobre TCU, no `RadioMalla` ni el balance RF. Responde a propagación geométrica de hops sin máximo.

## 6. VERIFIED CLAIMS FROM `INVENTARIO_MOTOR_RF.md`

`INVENTARIO_MOTOR_RF.md` tiene SHA-256 local `9910aaa3d5004611ac81285c345e9ab76943f1dc6e889febbaf4039810d76d13`. Se verifican contra este checkout, no por autoridad del documento:

1. **Hashes y tamaños locales:** los hashes completos de `zigbee_pv_model.js`, `radio_pv_model.js` y `radio_pv_model.py` empiezan exactamente por `ac06599f6343`, `74d2cc32cc8b` y `02df72504c7d`; sus líneas son 158, 381 y 292.
2. **Dos calibraciones locales:** el legado contiene sesgo −33,6 dB y sigma 6,8 en `defaultParamsElBurgo`; el nuevo no contiene sesgo y `radio_params.json` deja `sigma_db=null`.
3. **Geometría:** el legado recibe obstáculos puntuales/cota superior; el nuevo implementa banda `zBot/zTop`, estados `libre/hueco/tapado`, `bajoSuelo` y Deygout reconstruido desde el borde elegido.
4. **Terreno:** `relieveDominante` existe en JS/Python y `radio_zigbee.js` lo suma separadamente; la UI llama al presupuesto sin `perfil`, por lo que no hay terreno en el resultado actual.
5. **Frecuencia:** el legado tiene 2,45 GHz por defecto; el nuevo lanza si falta `f_hz`.
6. **Dos rayos:** los dos modelos locales comparten la estructura de rayo directo/reflejado y Fresnel; el Python nuevo usa complejos implementados a mano para sostener paridad JS.
7. **Antenas/alturas locales:** el nuevo configura `ant_h_m=1.5` y la UI usa la misma altura a ambos extremos; no hay patrón de dipolo/tabla `ANTENNAS` local.
8. **Sensibilidad/canal:** PRO hereda −103 dBm con advertencia de provenance; estándar deja sensibilidad `null`; canal queda `null` y la salida añade `canal_desconocido_ptx_es_cota_superior`.
9. **Vegetación:** está declarada pero no implementada; sin modelo retorna `null` y el presupuesto añade motivo, aunque numéricamente añade cero.
10. **UI/motor:** el nuevo es el valor por defecto, el antiguo se conserva detrás de una puerta común y tests; panel y heatmap de margen consumen esa misma puerta.
11. **Modelo de saltos:** la elipse se declara distinta de la física y el test prueba esa separación.
12. **Código muerto/integración incompleta:** `relieveDominante` no recibe perfil desde la UI; `radio_malla.js` no está llamado por `index.html` más allá de cargarse como script.

## 7. UNVERIFIED OR CONTRADICTED CLAIMS

### No verificables desde este checkout (`UNKNOWN`)

1. **“Seis ficheros en cinco versiones” y un séptimo `factiun_core/rf/zigbee.py`.** Sólo tres núcleos locales relevantes (JS nuevo, Python espejo, JS legado) y dos generaciones locales pueden inspeccionarse. Los árboles externos no están presentes.
2. **Igualdad byte a byte de `SolarGPTfull/siting/zigbee_pv_model.js` con el legado.** El hash de la copia local se reproduce; la copia externa no.
3. **Hashes/líneas de cobertura-rf-fv y `factiun_core.rf`.** No hay artefactos locales para recalcularlos.
4. **Calibración externa −16,58/10,99, ajuste n=0,38/σ=5,2/R²=0,05, 49 enlaces, correlaciones y muestra censurada.** El careo local tiene fixtures/tests y advertencias, pero no los repos/datasets citados para reproducir esas cifras como campaña.
5. **Planos DR_NCU_v0/FTR.24.00145_5_C, alturas NCU 3,15/HSU 6,50/TCU=tubo−0,725, ficha Jinchang y confirmación de campo.** Nada de ello está versionado aquí salvo su relato en el inventario.
6. **DEM Terrarium, 672 puntos, censo de 11 plantas y validación Ayora/San José.** No están en este checkout.
7. **“Muro dejaba 95 % aislado contra 52 enlaces vivos”.** Los tests locales demuestran diferencias numéricas y el careo advierte limitaciones, no reproducen esa proporción con evidencia primaria.
8. **Cualquier afirmación sobre qué ejecuta SolarGPTfull o paridad con `factiun_core.rf`.** No hay dependencia, submódulo, lock, import o test local contra `factiun_core`.

### Contradichas o matizadas por el código actual

1. **“El mapa de Siting también [usa alturas iguales]”.** Verificado para el motor nuevo; no implica que el efecto del patrón sea siempre cero en cualquier ruta futura. Clasificación: matiz `INTENTIONAL`.
2. **“El mapa/panel tiene un solo cálculo.”** El margen sí comparte `rfMargenDe`, pero `rfEnlace` llama una segunda vez a `difraccionBandasDetalle` para el detalle después de que `presupuesto` haya pedido el total. Es la misma implementación y tests exigen igualdad, pero sí hay dos ejecuciones. Clasificación: `APPROXIMATION` del texto, no divergencia numérica observada.
3. **“radio_params.json es la única fuente.”** Es cierto para parámetros del motor nuevo, pero quedan constantes `RF_PITCH_M`, `RF_CHORD_M`, `RF_ANT_H` como fallback y el legado tiene defaults propios. Clasificación: `LEGACY` intencional, rótulo demasiado absoluto.
4. **“La UI rotula los dos motores.”** El estado y la leyenda pueden rotular el motor activo, pero no hay control visible localizado para seleccionar el legado; el checkbox principal dice siempre “sesgo −33 dB” aunque el estado arranca en nuevo sin sesgo. Clasificación: `BUG` de UI.
5. **Cita `index.html:2357` en parámetros.** En el commit auditado las constantes están en la línea 2365; el inventario ya lo marca como defecto y se confirma. Clasificación: `LEGACY` documental.
6. **README: radio 250 m y libres de fábrica 2 m.** La UI actual arranca 300/6/10. Clasificación: `BUG` de documentación/valores.
7. **“Las cadenas mesh no se modelan.”** La física de malla sí existe en `radio_malla.js`; lo que no está modelado en el autositing/repetidores es la cadena RF real. Clasificación: afirmación de README demasiado amplia (`LEGACY`).

## 8. PYTHON / JAVASCRIPT PARITY

### Cubierto y verificado

- El banco `tests/test_paridad_radio.py` carga ambos núcleos nuevos y barre geometría, regímenes, relieve, frecuencia, Fresnel, dos rayos, filo, Deygout y vegetación.
- Exige igualdad estricta/bit a bit donde corresponde y contiene una guardia que demuestra que usar `cmath` rompe esa condición en un caso sensible.
- `tests/test_radio_geom.js` compara además fórmulas comunes con el legado en casos definidos y demuestra el cambio esperado entre muro y banda.
- `tests/test_rf_panel.js` prueba que panel y heatmap producen el mismo margen bit a bit en 500 enlaces de cuatro plantas y que el detalle suma el total de difracción.

### Fuera de cobertura

- No hay espejo Python de `radio_zigbee.js`: no se prueba paridad de balance, motivos, calibración, `phi`, canal, sensibilidad o probabilidad entre lenguajes.
- No hay Python de `radio_malla.js` ni paridad topológica cross-language.
- No se compara con cobertura-rf-fv, cobertura-zigbee, SolarGPTfull o `factiun_core.rf` en CI local.
- La paridad matemática no valida exactitud física, parámetros, alturas, patrón, DEM ni calibración.
- `_version="fase1"` no identifica commit/hash/configuración; dos archivos con ese rótulo podrían divergir hasta que el test se ejecute.

## 9. DISCREPANCIES

| ID | Discrepancia | Tipo | Impacto |
|---|---|---|---|
| D-01 | Autositing/saltos usan elipse; margen usa RF. | `INTENTIONAL` | Un reparto “conexo” puede ser inviable RF y viceversa. |
| D-02 | UI 300 m vs README/model default 250 m. | `BUG` | Resultado inicial y contrato documentado difieren. |
| D-03 | UI guardas 6/10 m vs README “2 m de fábrica”; constantes 2/6 añaden otra capa. | `BUG` | Reproducibilidad/política ambigua. |
| D-04 | Checkbox RF dice sesgo −33 dB mientras motor nuevo sin sesgo es default. | `BUG` | El usuario atribuye una calibración que no se ejecuta. |
| D-05 | `capNCU` y `capGW` editables sin restricción conjunta. | `BUG` | Parámetros pueden ser matemáticamente incompatibles con dos GW. |
| D-06 | Error panel muestra sólo tres incidencias. | `PRODUCT_POLICY` / `UNKNOWN` | Oculta alcance real del incumplimiento. |
| D-07 | Repetidor geométrico, un solo salto, sin capacidad ni RF. | `APPROXIMATION` | No demuestra una ruta desplegable. |
| D-08 | Motor RF nuevo dispone de relieve pero UI no suministra perfil. | `BUG` de integración | `relieveDb` es siempre cero en UI actual. |
| D-09 | Vegetación desconocida se marca `null` pero se suma numéricamente como cero. | `APPROXIMATION` | El total/margen parece completo aunque incluye motivo de incompletitud. |
| D-10 | Patrón plano y misma altura 1,5 m para todos los extremos. | `APPROXIMATION` | Optimismo/errores según montaje y elevación. |
| D-11 | Topología configurada/inferida no viaja en export. | `BUG` | Imposible auditar origen tras descargar CSV/PDF/PNG. |
| D-12 | IDs de dispositivos colapsan conceptos y se regeneran por posición. | `BUG` de frontera de dominio | Reconciliación inestable con planta/SCADA. |
| D-13 | Tope 6.000 sólo para CSV, no XLSX/presets. | `BUG` | Rendimiento y aceptación dependen del formato. |
| D-14 | Coordenadas lat/lon usan aproximación local; UTM detectado por magnitud; export omite CRS. | `APPROXIMATION` | Coordenadas absolutas no son autocontenidas. |
| D-15 | `radio_malla.js` se carga pero UI usa BFS/elipse propio para saltos. | `LEGACY`/integración pendiente | La capacidad de malla física no llega al producto. |
| D-16 | Cita de línea rota en `radio_params.json`. | `LEGACY` | Provenance no navegable/reproducible por línea. |
| D-17 | El selector antiguo existe en estado/tests, no como control visible. | `UNKNOWN` | Comparación declarada no es accesible al usuario normal. |
| D-18 | Presets quedan exentos de warnings de guarda configurada. | `INTENTIONAL` | Dato “real” no equivale a cumplimiento de política actual. |
| D-19 | Autositing conservador preserva NCU configuradas pero reasigna TCU por cercanía/capacidad. | `INTENTIONAL` | El resultado híbrido ya no es topología configurada pura. |
| D-20 | Exports CSV concatenan valores sin quoting/escaping. | `BUG` | IDs/nombres con coma o salto rompen el intercambio. |

## 10. RF TRUTH VS SITING POLICY BOUNDARY

### RF truth (`PHYSICAL_CALCULATION`)

Debe limitarse a entradas medibles/configuradas y resultados físicos con incertidumbre: frecuencia/λ, dos rayos/reflexión, geometría de banda, Fresnel/filo/Deygout, terreno, vegetación, pérdidas, Prx, margen y probabilidad sólo con sigma. En este repo esa frontera está principalmente en `radio_pv_model.*` y `radio_zigbee.js`.

### Siting policy (`DESIGN_RULE` / `PRODUCT_POLICY`)

Capacidades 160/80, dos GW, radio nominal, no mezclar PB, umbral de isla, estrategia anfitriona→repetidor→NCU, cantidad/posición HSU, guardas, prioridad de vial, orientación del corte, numeración, tolerancia a presets y orden de fallbacks son decisiones de diseño/producto. No deben presentarse como consecuencias de las ecuaciones RF.

### Aproximaciones que deben permanecer explícitas

- elipse 40/90 como proxy mesh;
- radio circular NCU/HSU/repetidor;
- calles inferidas por hueco;
- 1-centro iterativo y búsqueda heurística;
- HSU por perímetro/sectores/cielo;
- altura homogénea, inclinación global y suelo plano;
- margen PRO como cota superior con canal desconocido;
- vegetación cero numérico con motivo “no modelada”.

**Contrato recomendado a 08_COMMS (sin implementar aquí):** ningún veredicto de siting debe llamarse “RF válido” salvo que provenga del grafo de enlaces físicos con versión/hash de motor, parámetros, provenance de geometría y política de umbral. La elipse puede seguir siendo una heurística rápida, pero su salida debe llamarse “conectividad geométrica de diseño”.

## 11. BOUNDARY TO PLANT MODEL

El siting necesita del modelo de planta, no debe inferirlo silenciosamente:

1. `plant_id` y `project_id/project_code` canónicos, con alias versionados.
2. Entidades y relaciones explícitas: tracker, motor, TCU, GW, NCU, HSU y repetidor; cardinalidades no fijadas implícitamente a 1:1.
3. Identificadores inmutables y aliases de cliente/Factiun/SCADA; serial/modelo de radio y canal.
4. Coordenadas con CRS/EPSG, zona, datum, fuente, fichero/hoja/fila, fecha y precisión; coordenada del eje, motor y antena diferenciadas.
5. Geometría de tracker/fila/módulo, azimut, cuerda, bífila, cota del suelo y altura/patrón/orientación de cada antena.
6. Power block como entidad, no texto inferido desde NCU/nombre.
7. Topología **configurada** (as-built/as-designed) separada de propuestas **inferidas**, con lineage de cada cambio y estado híbrido.
8. Viales, exclusiones y zonas implantables explícitas; no deducidas exclusivamente por vacío entre mesas.
9. Presets como snapshots versionados con hashes y fuentes, no sólo literales embebidos.
10. Export autocontenido con IDs, aliases, CRS, versión del motor, parámetros, política, warnings y provenance.

Hasta que esa frontera exista, las coordenadas y dispositivos del repo deben considerarse snapshots de visualización/siting, no master data de planta.

## 12. TEST EVIDENCE

### Ejecución

- Se ejecutaron secuencialmente los 12 bancos JavaScript (`tests/*.js`) y `tests/test_paridad_radio.py`; todos terminaron con código 0.
- Cobertura visible relevante: siting NCU/HSU/guardas/islas/repetidores, importadores, RF geometría, cobertura/índice/panel, heatmaps, malla, SCADA, Catania, estadística y careo El Burgo.
- Los bancos reportan, entre otros: 48 comprobaciones de careo, 60 de heatmap, 35 de estadística, 51 de geometría RF, 59 de malla, 25 de cobertura RF, 16 de índice, 43 de panel, 36 de SCADA y 25 de autositing Catania. El banco grande de siting y el de importadores también pasaron completos.

### Qué prueban

- Invariantes de capacidad/radio/conectividad/guardas y fallbacks sobre fixtures.
- Segmentos finitos/azimut/bífila y equivalencia del índice espacial con fuerza bruta.
- Separación entre heatmap de margen y saltos; cache/signatura/paletas.
- Misma puerta de margen para panel/mapa y desglose consistente.
- Malla: BFS, desconocidos, articulaciones, redundancia y comparación elipse/RF.
- Paridad numérica del núcleo JS/Python y frecuencia obligatoria.
- Importación con exclusiones visibles y round-trip del CSV propio.

### Qué no prueban

- Exactitud contra campaña RF válida, datasheets, planos o DEM.
- Topología real Zigbee/routing/comisionado, canal o seriales.
- Repositorios externos y `factiun_core.rf`.
- Máximo operacional de 6.000 en todos los importadores.
- Integridad CSV con comas/quotes, CRS autocontenido o round-trip de provenance.
- Un navegador real/end-to-end; los tests extraen bloques y usan VM/mocks.

## 13. QUESTIONS TO 08_COMMS / 06_PLANT / 00_MASTER

### Para `08_COMMS`

1. ¿160 TCU/NCU, 80/GW y exactamente dos GW son límites de hardware/protocolo, contractual o sólo política de oferta? Aportar datasheet/especificación y regla por variante.
2. ¿Cuál es el radio de diseño vigente: 250 o 300 m, y aplica a TCU↔NCU, TCU↔TCU, HSU y repetidor por igual?
3. ¿La topología objetivo permite cadenas de repetidores y cuántos hops máximos/ruta redundante exige? ¿Hay límite Zigbee por profundidad/hijos/carga que deba modelarse?
4. ¿Qué margen mínimo y probabilidad/availability se exige? ¿Puede emitirse “válido” con canal, sensibilidad, sigma, vegetación o terreno desconocidos?
5. ¿Qué modelo exacto de XBee/antena se despliega por planta, canal/PAN, potencia regulatoria, altura, orientación y cableado?
6. ¿Debe la malla física de `radio_malla.js` gobernar el siting o sólo auditar la elipse? Definir la precedencia.
7. ¿Repetidor tiene capacidad, fuente de alimentación, guarda, ID/serial y asociación concreta a NCU/GW?
8. ¿Los umbrales/pesos HSU, cantidad por 900 m y 100°/250 m/80 m tienen especificación aprobada o son heurística exploratoria?
9. ¿El motor legado debe seguir accesible? Si sí, ¿dónde está el selector visible y qué etiqueta inequívoca debe llevar?
10. Facilitar repos/commits exactos de cobertura-rf-fv, Cobertura-Zigbee y SolarGPTfull para una auditoría reproducible de generaciones y `factiun_core.rf`.

### Para `06_PLANT`

1. Proveer `plant_id`/`project_id` canónicos y resolver códigos compartidos/derivados (`25004`, `25004.2`) y aliases.
2. Confirmar cardinalidades reales entre tracker, motor y TCU; identificar excepciones a 1=1=1.
3. Definir IDs inmutables y aliases por dispositivo, incluidos NCU/GW/HSU/repetidor, más serial/modelo.
4. Proveer CRS/EPSG/datum/zona, provenance por coordenada, coordenadas de antena y cotas absolutas; distinguir eje/motor/TCU/antena.
5. Proveer geometría de filas/mesas y DEM/levantamiento versionados, con alcance y precisión por planta.
6. Proveer power blocks y viales/zonas de exclusión como entidades/geometrías autorizadas, no deducciones nominales.
7. Confirmar nomenclaturas dobles y reglas de alias; ¿es lícito inferir PS desde prefijo NCU o moda de filas?
8. Definir cuál snapshot es as-designed, as-built o propuesta y cómo versionarlo/exportarlo.

### Para `00_MASTER`

1. Elegir autoridad: ¿qué repositorio/paquete y versión constituyen el motor RF canónico y quién aprueba cambios?
2. Exigir manifest reproducible entre repos (commit, SHA-256, versión de parámetros/calibración, fixtures y prueba cross-repo) antes de afirmar “mirror” o paridad con `factiun_core.rf`.
3. Separar formalmente cuatro contratos: plant master data, RF physics, design rules y product policy; asignar ownership y esquema/versionado.
4. Definir lenguaje de veredictos: `configurado`, `inferido`, `aproximado`, `teórico`, `calibrado`, `medido`, `desconocido` y `cota superior` deben viajar en UI y exports.
5. Decidir si los presets embebidos son datos autorizados; si lo son, migrarlos a snapshots versionados con provenance/hashes.
6. Priorizar resolución de discrepancias D-01 a D-20, en especial rótulo de sesgo, 250/300 m, guardas 2/6/10, validación conjunta de capacidades e integración de relieve/malla física.
7. Determinar criterios de aceptación para retirar `LEGACY` y para cualquier consolidación externa; este informe no adopta las decisiones propuestas por `INVENTARIO_MOTOR_RF.md`.
