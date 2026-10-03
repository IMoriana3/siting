/* CÓMO SE ESCRIBE UN NÚMERO EN UNA COLUMNA ESTRECHA, SIN MENTIR.
 *
 * Esto existe por una avería MEDIDA el 2026-10-03 en
 * `tools/comparador_tecnologias.mjs`. La fila «capacidad de telemetría usada»
 * publicaba:
 *
 *     capacidad de telemetría usada            111111111111111
 *
 * El valor real es 0,0611 % del puerto serie. Lo que pasaba:
 *
 *     const pd = (s, n) => String(s).padStart(n).slice(-n);
 *
 *     String(0.06111111111111111) -> "0.06111111111111111"   (19 caracteres)
 *     .padStart(15)               -> no hace nada, ya es más larga
 *     .slice(-15)                 -> se queda la COLA: "111111111111111"
 *
 * O sea que `slice(-n)`, puesto ahí para alinear a la derecha, DECAPITABA el
 * número: se comía el "0.06" y dejaba los decimales sueltos. No es el valor
 * redondeado, ni truncado, ni un error de formato visible: es un número
 * distinto.
 *
 * Y EL CASO QUE DE VERDAD ASUSTA NO ES ÉSE. "111111111111111" salta a la vista.
 * El que no salta es
 *
 *     12,345678901234567  ->  "345678901234567"
 *
 * que se lee como una cifra perfectamente válida y no lo es. Un número que
 * parece bien y está mal es peor que un hueco, que es la regla de toda esta
 * cartera: el vacío es ERROR, no PASS — pero un vacío DISFRAZADO de dato es
 * peor que el vacío.
 *
 * Las dos reglas que salen de ahí:
 *
 *   1. Si no cabe, se conserva la CABEZA, que es donde vive la magnitud, y se
 *      marca con «…». Una celda cortada tiene que PARECER cortada.
 *   2. Un número se redondea ANTES de medir si cabe, y el redondeo es una
 *      decisión de PRESENTACIÓN: el valor íntegro sigue en la celda (`min`,
 *      `max`) y en el JSON. Lo que se recorta es la vista, no el dato.
 */
(function (raiz) {
  'use strict';

  /* Alinea a la derecha en `n` columnas. Si no cabe, corta por la DERECHA y lo
     marca. Nunca `slice(-n)`: eso se queda la cola y decapita el número. */
  function pd(s, n) {
    s = String(s);
    if (s.length <= n) return s.padStart(n);
    return (s.slice(0, n - 1) + '…').padStart(n);
  }

  /* Alinea a la izquierda en `n` columnas. Aquí `slice(0, n)` SÍ es correcto:
     corta por el final, que es por donde se pierde lo menos importante de un
     rótulo. Se marca igual, para que el recorte se vea. */
  function pi(s, n) {
    s = String(s);
    if (s.length <= n) return s.padEnd(n);
    return s.slice(0, n - 1) + '…';
  }

  /* Un número para LEER, no para calcular. Los enteros salen enteros —215 TCU
     son 215, no 215,00—; los demás con tantos decimales como haga falta para
     que la cifra signifique algo a su escala, y sin ceros de relleno. */
  function paraLaVista(x) {
    if (typeof x !== 'number' || !isFinite(x)) return String(x);
    if (Number.isInteger(x)) return String(x);
    var abs = Math.abs(x);
    var dec = abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
    return x.toFixed(dec).replace(/\.?0+$/, '');
  }

  var Render = { pd: pd, pi: pi, paraLaVista: paraLaVista };
  raiz.Render = Render;
  if (typeof module !== 'undefined' && module.exports) module.exports = Render;
})(typeof window !== 'undefined' ? window : globalThis);
