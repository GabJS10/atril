#!/usr/bin/env bash
# Prueba a mano el spike R0.2 en TU escritorio: abre Atril con la pantalla de prueba (botones a, b, c, d).
# Uso: spikes/display/run-manual.sh [binario]
#   binario por defecto: .spike-display/bin/atril-spike (fuera del repo; ver spikes/display/REPORT.md).
# Usa datos temporales (se borran al cerrar). Limita a 10 páginas por tipo para no gastar mucha RAM.
set -euo pipefail
BIN=${1:-/home/gabriel/datos/projects/atril-wt/.spike-display/bin/atril-spike}
PAGES=${ATRIL_SPIKE_PAGES:-/home/gabriel/datos/projects/atril-wt/.spike-display/pages}
TMP=$(mktemp -d "${TMPDIR:-/tmp}/atril-spike-manual.XXXX")
echo "Datos temporales en $TMP (se borran al cerrar). Resultados de 'Suite completa' en $PAGES/results."
ATRIL_SPIKE_PAGES="$PAGES" ATRIL_SPIKE_LIMIT="${ATRIL_SPIKE_LIMIT:-10}" \
  XDG_DATA_HOME="$TMP/data" XDG_CACHE_HOME="$TMP/cache" XDG_CONFIG_HOME="$TMP/config" "$BIN" || true
rm -rf "$TMP"
