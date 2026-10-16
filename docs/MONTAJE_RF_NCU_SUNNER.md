# RF de NCU Sunner/P4Q con dos Digi: una antena común

**Estado: primera implementación de contrato y balance opcionales.**
No es un as-built de El Burgo, ni una calibración certificada de El Burgo, ni un
cambio automático de los presets de plantas. No se han cargado a GitHub los
CSV de campo ni los volcados RCI.

## Topología declarada por el propietario, fotografía y piezas

- GW1 y GW2 son **dos coordinadores Zigbee independientes**, cada uno con su
  PAN/canal y sus propias TCU.
- Cada gateway entra en un puerto diferente de un **Pasternack PE2088** de
  dos vías, usado en modo combinador reversible.
- El puerto común va a **una sola antena exterior** ANT-2.4-CW-HW a través de
  la extensión **ZCBEXTANT03** con coaxial **LMR195, 4 m nominales**.
- Antena corta TCU: Amphenol **AW5405-11-001-C**. Su cadena coaxial interna
  no queda cuantificada por el informe de antena.

La topología se conoce; **no** se ha verificado con fotografías el inventario
as-built completo de las NCU1 y NCU2 de El Burgo. Nunca asignar perfiles
a una NCU por parecerse al armario mostrado.

## Parámetros documentados, sin mezclar catálogo, cálculo y medida

| Magnitud | Valor | Naturaleza/fuente |
|---|---:|---|
| PE2088, reparto ideal por puerto | 3,01 dB | derivación 10·log10(2) |
| PE2088, pérdida adicional | 0–0,50 dB | intervalo de catálogo Pasternack PE2088 |
| ZCBEXTANT03, longitud coaxial | 4,00 m | plano del cable P4Q aportado |
| Coaxial del conjunto | LMR195, 50 Ω | lista de materiales del plano P4Q |
| LMR195, pérdida de 4 m a ~2,45 GHz | ≈ 2,47 dB | calculado con ficha Times Microwave, **no medido** |
| ANT-2.4-CW-HW, ganancia **pico** | 3,2 dBi | catálogo TE Connectivity |
| AW5405-11-001-C, ganancia **pico** | 1,83 dB a 2450 MHz | ensayo Amphenol 2014-06-16, página 15/17 |
| Potencia TX de **El Burgo** por GW | **null** | no deriva del RSSI ni de la ficha de otro GW |
| Sensibilidad de cada variante instalada | **null** hasta identificarla | no asignar −103 heredados a todo XBee |
| Latiguillos/adaptadores/conectores internos | **null** | sin pérdida documentada |
| Patrón/polarización en dirección de cada salto | **null** | ganancia pico ≠ direccional |

Fuentes externas:
- https://www.pasternack.com/images/ProductPDF/PE2088.pdf
- https://timesmicrowave.com/wp-content/uploads/2022/06/lmr-195-datasheet.pdf
- https://www.te.com/es/product-L9000018-01.html

El Digi mostrado en una **NCU distinta** declaraba PL4 y PP=8 dBm;
eso NO prueba potencia de los cuatro gateways de El Burgo. Tampoco es
una medición de potencia conducida instrumental.

## Cómo usar el contrato (opt-in)

El módulo radio_instalacion.js contiene:
- extremoGateway(ncu, gatewayId): selecciona una de las dos radios pero
  conserva el identificador de la única antena compartida y el cable único.
- extremoTcu(tcu): extremo TCU independiente de su configuración de campo.
- balance(tx, rx, perdidaPropagacionDb): utiliza una **pérdida de propagación
  entregada por el motor canónico**, no una fórmula paralela.

RadioZigbee.presupuesto() acepta optativamente
enlace.montajeRf = {tx: extremoGateway(...), rx: extremoTcu(...)}
o viceversa. Sin montaje, el modelo antiguo permanece sin cambios.

El uso es direccional: GW→TCU depende de la potencia y cadena de GW como
transmisor, y TCU→GW de la TCU transmisora. El PE2088 se atraviesa una sola
vez en cada dirección. No crea enlaces entre redes Zigbee distintas.

Si queda alguna incógnita, la salida incluye:
- rssiDbm = null y margenDb = null;
- rssiCondicionalDbm = [mínimo, máximo] **sólo bajo el supuesto explícito**
  de pérdidas desconocidas cero y, sin patrón, ganancias de pico;
- rssiCotaSuperiorDbm, límite superior en el modelo dado, ya que las
  pérdidas físicas adicionales no aportan ganancia;
- faltan[] con las variables ausentes.

No se usa el intervalo condicional para pintar la malla como si fuera medido
o un margen completo. No se escoge el punto medio de 3,01–3,51 dB.

## Datos de El Burgo: puerta previa al ajuste

Los CSV históricos y recientes de las dos NCU tienen un problema distinto del
montaje: las medianas RSSI por nodo y los cambios de padre no equivalen a una
medida por enlace fijo. Los contadores ACK son acumulados: sólo valen sus
incrementos dentro de ventanas con base de tiempo y detección de reinicios.
Los fallos de acceso Telnet/HTTP se excluyen de tasas de entrega RF.

Antes de calibrar:
1. Separar las cuatro redes por (NCU,GW) y nodo estable.
2. Reconstruir por tiempo las rutas y la asociación padre/hijo si hay soporte.
3. Calcular ACK como diferencias por nodo en ventanas válidas.
4. Contrastar saltos, variación horaria e inclinación sobre la misma población.
5. Confirmar qué componentes y potencias TX/RX se instalaron en cada NCU.
6. Reservar una ventana no utilizada para el ajuste.

**Este PR no afirma haber recalibrado El Burgo ni validar el nuevo balance
con las series de octubre.** Esa etapa queda tras la conciliación.

## Banco

node tests/test_instalacion_rf.js
bash tests/correr.sh instalacion

Casos sintéticos independientes de los CSV reales: PE2088 por rama una vez,
ambos sentidos, PAN separados, diferencia de potencias, faltantes, rangos,
sensibilidad y preservación del modelo legacy.

No modificar radio_params.json para imponer este montaje a todas las plantas,
ni las copias fijadas de cobertura-rf-fv / SolarGPTfull hasta que esté
validada la identidad y la configuración de los extremos.
