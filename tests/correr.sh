#!/usr/bin/env bash
#
# EL CORREDOR DE LOS BANCOS — y el sitio donde «verde» deja de ser el código de
# salida y pasa a ser un RECUENTO LEÍDO.
#
# ═══ POR QUÉ EXISTE ═══
#
# La CI de este repo corría `for f in tests/test_*.js; do node "$f" || rc=1;
# done`. Eso comprueba el código de salida y NADA MÁS, y el código de salida es
# justo lo que ya nos ha mentido dos veces en un día:
#
#   · cuatro pasos de esta misma CI imprimían «No se ha medido nada. Esto no es
#     un verde» y salían con 0 —entre ellos el careo del terreno contra el 3D,
#     200.000 muestras bit a bit, que NUNCA había corrido aquí—;
#   · y en cobertura-zigbee, `test_relieve_plantas.mjs` entraba sin argumentos,
#     su bucle recorría `argv.slice(2)` y daba cero vueltas: un tick verde en
#     cada PR por no haber hecho nada, desde el 9 de septiembre (#741).
#
# La regla que lo cierra no es nuestra: está en `factiun-cartera/tests/correr.sh`
# desde antes, y es más fuerte que nada de lo que teníamos aquí.
#
# ═══ LA REGLA ═══
#
# Un banco está verde si SALE con 0, **y** no imprime ninguna línea de fallo,
# **y** publica al menos `PISO` comprobaciones. El vacío es ERROR, no PASS: un
# banco que revienta antes de comprobar nada, o que cambia su formato de
# salida, se pone ROJO en vez de colarse como verde silencioso.
#
# EL PISO no es decoración. Sin él, un `return` temprano que se coma la mitad
# de las comprobaciones deja el banco en verde con doce checks en vez de
# ciento cincuenta. Los números están MEDIDOS (corrida del 2026-09-23) y son
# EXACTOS, no redondeados a la baja: crecer no rompe nada —el piso es un
# mínimo— y así el día que un banco pierda una comprobación se entera alguien.
# Sólo se BAJAN a propósito, con el motivo escrito, y el cambio se ve en el
# diff.
#
#   bash tests/correr.sh                 # todos
#   bash tests/correr.sh radio           # los que casen con el patrón
#
set -o pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 1
LOGS="${LOGS_DIR:-$RAIZ/.bancos}"
PATRON="${1:-}"

# ── EL PISO DE CADA BANCO ────────────────────────────────────────────────
declare -A PISO=(
  [test_antena_tcu.js]=119
  [test_careo_elburgo.js]=49
  [test_censo_motivos.js]=19
  [test_cov_heatmap.js]=60
  [test_estadistica.js]=35
  [test_radio_geom.js]=79
  [test_radio_malla.js]=82
  [test_rf_cobertura.js]=28
  [test_rf_indice.js]=16
  [test_rf_panel.js]=47
  [test_scada_vivo.js]=36
  [test_siting_auto.js]=25
  [test_siting_ncu.js]=153
  [test_terreno_planta.js]=62
  [test_terreno_proyecto.js]=45
  [test_una_holgura.js]=14
  [test_utiles_rf.js]=23
  [test_vis_importadores.js]=42
  # el careo de los dos motores, que es Python
  [test_paridad_radio.py]=26
)

# ── LO QUE NO CORRE AQUÍ, CON DUEÑO Y MOTIVO ─────────────────────────────
# Una exención escrita es lo contrario de un banco borrado: se ve en el diff,
# tiene motivo, y el guardia de abajo exige que el fichero SIGA EXISTIENDO.
declare -A FUERA=()

# ── el guardia de la tabla: añadir un banco obliga a medir el suyo ───────
# Sin esto, un banco nuevo entra en el repo y no lo vigila nadie — que es
# exactamente cómo `test_relieve_plantas.mjs` pasó cuatro meses en verde sin
# mirar una sola planta.
for _t in tests/test_*.js tests/test_*.py; do
  [ -e "$_t" ] || continue
  _n="$(basename "$_t")"
  if [ -z "${PISO[$_n]+x}" ] && [ -z "${FUERA[$_n]+x}" ]; then
    echo "ROJO · $_n no tiene piso en tests/correr.sh ni está declarado fuera"
    echo "       córrelo, apunta cuántas comprobaciones publica, y añádelo"
    exit 1
  fi
done
# ── y el de los zombis: una exención sobre un fichero que ya no está ─────
for _n in "${!FUERA[@]}"; do
  if [ ! -f "tests/$_n" ]; then
    echo "ROJO · tests/$_n está declarado fuera en correr.sh y el fichero NO existe"
    echo "       si se borró a propósito, quita también su línea de FUERA"
    exit 1
  fi
done

mkdir -p "$LOGS"; rm -f "$LOGS"/*.log 2>/dev/null

# ── el lector del recuento ───────────────────────────────────────────────
# Se busca en las ÚLTIMAS líneas para no confundir el resumen con un número
# suelto del cuerpo. Si aparece un formato nuevo el recuento sale 0 y el banco
# se pone rojo por el piso: se entera alguien, que es justo lo que se quiere.
leeCuenta(){
  local log="$1" n=""
  n=$(grep -oE 'TODO OK — [0-9]+ comprobaciones' "$log" | tail -1 | grep -oE '[0-9]+')
  [ -z "$n" ] && n=$(grep -oE '\(([0-9]+) comprobaciones\)' "$log" | tail -1 | grep -oE '[0-9]+')
  [ -z "$n" ] && n=$(grep -oE '[0-9]+ comprobaciones' "$log" | tail -1 | grep -oE '[0-9]+')
  [ -z "$n" ] && n=$(grep -cE '^ *(OK|ok) ' "$log")
  echo "${n:-0}"
}
leeFallos(){
  local log="$1" n=0 m=""
  n=$(grep -cE '^ *(MAL|FAIL|FALLA)' "$log" || true)
  m=$(grep -oE 'FALLAN +[0-9]+' "$log" | tail -1 | grep -oE '[0-9]+'); [ -n "$m" ] && n=$((n+m))
  echo "$n"
}

# ── EL ALCANCE, PUBLICADO ────────────────────────────────────────────────
# Este corredor barre `tests/`. Un banco en `tools/` no lo ve, y hoy no hay
# ninguno —19 en tests/, 0 en tools/— pero eso hay que DECIRLO, no suponerlo:
# «he mirado» y «está bien» son dos afirmaciones y hasta hoy sólo se publicaba
# la segunda. Si aparece un `tools/test_*`, esto lo dice en vez de ignorarlo.
hay_tests=$(ls tests/test_*.js tests/test_*.py 2>/dev/null | wc -l)
hay_tools=$(ls tools/test_*.js tools/test_*.py tools/test_*.mjs 2>/dev/null | wc -l)
con_piso=${#PISO[@]}
echo "alcance: $hay_tests bancos en tests/ · $con_piso con piso en la tabla · $hay_tools en tools/ (fuera del barrido)"
if [ "$hay_tools" != "0" ]; then
  echo "ROJO · hay $hay_tools banco(s) en tools/ y este corredor sólo barre tests/"
  echo "       muévelos, o amplía el barrido y mide sus pisos"
  exit 1
fi
echo ""

rojo=0; verde=0
printf '%-30s %8s %8s %s\n' banco cuenta piso estado
for _t in tests/test_*.js tests/test_*.py; do
  [ -e "$_t" ] || continue
  _n="$(basename "$_t")"
  [ -n "${FUERA[$_n]+x}" ] && continue
  [ -n "$PATRON" ] && [[ "$_n" != *"$PATRON"* ]] && continue
  log="$LOGS/$_n.log"
  case "$_t" in *.py) "${PYTHON:-python3}" "$_t" >"$log" 2>&1 ;; *) node "$_t" >"$log" 2>&1 ;; esac
  rc=$?
  cuenta=$(leeCuenta "$log"); fallos=$(leeFallos "$log"); piso="${PISO[$_n]}"
  est=""
  [ "$rc" != "0" ]            && est="$est rc=$rc"
  [ "$fallos" != "0" ]        && est="$est ${fallos}·fallo"
  [ "$cuenta" -lt "$piso" ]   && est="$est BAJO·PISO"
  if [ -n "$est" ]; then rojo=$((rojo+1)); printf '%-30s %8s %8s ROJO%s\n' "$_n" "$cuenta" "$piso" "$est"
  else verde=$((verde+1)); printf '%-30s %8s %8s ok\n' "$_n" "$cuenta" "$piso"; fi
done

echo ""
echo "$verde en verde · $rojo en rojo   (los logs, en $LOGS)"
if [ "$rojo" != "0" ]; then
  echo "un banco que publica menos comprobaciones que su piso NO es un verde,"
  echo "aunque salga con 0: mira su log antes de bajar el piso."
  exit 1
fi
