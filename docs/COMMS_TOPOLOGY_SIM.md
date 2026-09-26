# Simulación de topologías COMMS

## Semántica

La simulación separa propagación RF de topología permitida.

- Zigbee: mesh. Una TCU puede actuar como salto para otra.
- Wi-SUN FAN: mesh. Se usa el grafo de enlaces físicamente viables y el camino de menor número de saltos como cota inferior de RPL. En este primer careo todas las TCU se consideran router-capable.
- LoRa P2P: directa. Sólo existen enlaces TCU-gateway. Que dos TCU se escuchen no crea una ruta.
- LoRaWAN: físicamente usa la misma capa directa; la diferencia es star-of-stars: un uplink puede ser recibido por uno o varios gateways y reenviado al Network Server. No se modela como mesh.

LoRaWAN especifica una topología star-of-stars y comunicación radio de un solo salto entre end-device y gateway. Wi-SUN FAN usa IPv6/RPL y red multisalto.

## Dos umbrales

- 0 dB: frontera física según sensibilidad.
- 8 dB: reserva de diseño de esta simulación.

No se llama sin cobertura a un enlace simplemente por estar por debajo de 8 dB; son dos preguntas distintas.

## Tráfico

Además del alcance se publica una cota inferior de ocupación con la carga actual de referencia, 44 bytes por TCU cada 30 s:

load_min = 44 * 8 * N_TCU * hops / (30 * bitrate)

No incluye cabeceras, ACK, contención, reintentos ni duty-cycle. Sólo sirve para falsar: si ya supera 100 %, esa variante es inviable para esa carga; si queda por debajo, todavía no demuestra que quepa.

## Uso

node tools/simula_topologias.mjs --planta elburgo --horas 8,12,16
node tools/simula_topologias.mjs --planta elburgo --json resultado.json

Los gateways se colocan inicialmente en las posiciones de las NCU reales del layout para que las tecnologías se comparen sobre la misma implantación.
