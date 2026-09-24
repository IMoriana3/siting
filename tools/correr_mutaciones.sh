#!/usr/bin/env bash
#
# LAS MUTACIONES DE LA CI, AQUÍ, ANTES DE EMPUJAR.
#
# ═══ POR QUÉ EXISTE ═══
#
# `tests/correr.sh` corre los bancos; NO corre las mutaciones. Así que un
# cambio en el motor puede dejar el ANCLA de una mutación apuntando a un
# trozo de código que ya no existe, los veinte bancos seguir en verde aquí, y
# enterarse uno en la CI.
#
# Pasó el 2026-09-24: `relieveDeltaDb` pasó a pedir el detalle de Bullington
# para sacar su ν, y la mutación `terrenoDeygout` —cuya ancla era la línea
# anterior— empezó a salir rc=2. Corrí las mutaciones de los bancos que había
# tocado y no las de los que no. La CI lo cazó, que para eso está, pero el
# viaje sobra.
#
# ═══ NO HAY SEGUNDA LISTA ═══
#
# Esto NO reimplementa el corredor: EXTRAE el paso «y las mutaciones, en rojo»
# de `.github/workflows/tests.yml` y lo ejecuta tal cual. Una segunda lista de
# mutaciones aquí se separaría de la de allí en la primera semana, y entonces
# lo que se corre en local dejaría de ser lo que se corre en la CI sin que
# nada lo dijera — que es el mismo defecto que este repo lleva toda la fase
# quitando.
#
#   bash tools/correr_mutaciones.sh          # todas las que corre la CI
#
# rc = 0 todas rojas · 1 alguna no · 2 no se ha podido mirar (no es un verde)
#
set -o pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 2
WF="$RAIZ/.github/workflows/tests.yml"
[ -f "$WF" ] || { echo "SIN ALCANCE: no encuentro $WF"; exit 2; }

TMP="$(mktemp)"
python3 - "$WF" > "$TMP" <<'PY' || { echo "SIN ALCANCE: no he podido extraer el paso"; exit 2; }
import re, sys
yml = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'- name: y las mutaciones, en rojo\n\s*run: \|\n([\s\S]*?)(?=\n {6}- name:|\n {2}[a-z_]+:|$)', yml)
if not m:
    sys.exit(1)
sys.stdout.write(re.sub(r'^ {10}', '', m.group(1), flags=re.M))
PY
[ -s "$TMP" ] || { echo "SIN ALCANCE: el paso ha salido vacío"; rm -f "$TMP"; exit 2; }

n=$(grep -cE '^\s*rojo ' "$TMP")
echo "· el paso «y las mutaciones, en rojo» de tests.yml, tal cual, con $n corredor(es)"
echo ""
bash -e "$TMP"; rc=$?
rm -f "$TMP"
echo ""
if [ "$rc" = "0" ]; then
  echo "todas las mutaciones salen rc=1. Ninguna ancla se ha quedado atrás."
else
  echo "rc=$rc — una mutación con rc=2 es «ya no casa con el código», NO «cazada»:"
  echo "reapunta su ancla, no la borres."
fi
exit "$rc"
