# Demo Siting — Siting de comunicaciones

> Herramienta web de un solo fichero para situar y dimensionar la red de comunicaciones (NCU/GW/HSU/repetidores) de plantas de seguidores Factiun a partir de las coordenadas de los motores.

## Qué es
`index.html` resuelve el **siting de comunicaciones** de una PSFV de seguidores: dado el conjunto de motores (1 motor = 1 TCU = 1 seguidor), calcula **dónde colocar las NCU** (concentradores) para cubrir todas las TCU dentro del radio, sin superar la capacidad de cada NCU/GW y sin mezclar power blocks. Es una **demo/POC autónoma**: un único HTML, sin servidor, sin backend y sin guardado.

Sirve para tres cosas: (1) **siting automático** de un layout nuevo desde CSV/Excel de motores, (2) **consulta de proyectos reales** precargados como presets de solo lectura, y (3) **verificación de cobertura** y exportación de coordenadas UTM para campo.

## Funcionalidades
- Lienzo Canvas 2D con pan/zoom: reparto de NCU coloreado, radios de cobertura, power blocks, rejilla y **mesas a tamaño real**.
- Modelo: NCU ≤ **160 TCU** (2 GW de 80), **radio 250 m** directo NCU↔TCU, HSU en el borde, repetidores y **sin mezclar power blocks**.
- Presets reales (solo lectura): Ayora 24025, Páramo 25019, San José 24019, El Burgo I 23003. Siting automático: 26127 FUV I / FUV II.
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

*Factiun · proyecto interno.*
