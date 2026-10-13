#!/usr/bin/env bash
# Mide las páginas del spike R0.2 en Xvfb (DISPLAY propio, sin GPU): coste de codificar cada formato en Rust
# (ATRIL_SPIKE_BENCH=1) y, por variante, la suite de scroll y zoom con muestreo de RSS de la app y de WebKit.
# Uso: bench.sh <binario> <carpeta-paginas> <carpeta-resultados> [variantes...]   (por defecto: a b c d)
# No abre nada en el DISPLAY del usuario. Al salir para Xvfb y los procesos de la app que queden.
set -euo pipefail

BIN=$1
PAGES=$2
OUT=$3
shift 3
VARIANTS=("$@")
if [[ ${#VARIANTS[@]} -eq 0 ]]; then
  VARIANTS=(a b c d)
fi
DISPLAY_NUM=${SPIKE_DISPLAY_NUM:-99}
export DISPLAY=":$DISPLAY_NUM"
TMP=$(mktemp -d "${SPIKE_TMP:-${TMPDIR:-/tmp}}/atril-spike.XXXX")
mkdir -p "$OUT"
XVFB_PID=""
APP_PID=""

cleanup() {
  if [[ -n "$APP_PID" ]]; then kill "$APP_PID" 2>/dev/null || true; fi
  stop_leftovers "$TMP"
  if [[ -n "$XVFB_PID" ]]; then kill "$XVFB_PID" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

rss_kb() { # <pid> -> VmRSS en kB (0 si ya no existe)
  local value
  value=$(awk '/^VmRSS:/{print $2}' "/proc/$1/status" 2>/dev/null || true)
  echo "${value:-0}"
}

peak_kb() { # <pid> -> VmHWM en kB (pico de RSS)
  local value
  value=$(awk '/^VmHWM:/{print $2}' "/proc/$1/status" 2>/dev/null || true)
  echo "${value:-0}"
}

# Linux trunca `comm` a 15 caracteres: WebKitWebProcess se ve como "WebKitWebProces". Se clasifica por prefijo.
kind_of() { # <comm> -> web | net | gpu | other
  case "$1" in
    WebKitWebProc*) echo web ;;
    WebKitNetwork*) echo net ;;
    WebKitGPU*) echo gpu ;;
    *) echo other ;;
  esac
}

descendants() { # <pid> -> todos los procesos hijos, recursivamente
  local child
  for child in $(pgrep -P "$1" 2>/dev/null || true); do
    echo "$child"
    descendants "$child"
  done
}

# Procesos que llevan el XDG de esta ejecución en el entorno (la app y sus WebKit): se paran al final.
stop_leftovers() {
  local dir=$1 proc
  for proc in /proc/[0-9]*; do
    if grep -qs "$dir" "$proc/environ" 2>/dev/null; then
      kill "$(basename "$proc")" 2>/dev/null || true
    fi
  done
  sleep 1
}

sample() { # <pid de la app> <csv>: una línea por segundo con RSS de la app y de sus hijos WebKit
  local app=$1 csv=$2 start web net gpu other child kind kb used swap now
  echo "t_s,app_kb,webkit_web_kb,webkit_net_kb,webkit_gpu_kb,other_child_kb,system_used_mb,swap_used_mb" >"$csv"
  start=$(date +%s.%N)
  while kill -0 "$app" 2>/dev/null; do
    web=0
    net=0
    gpu=0
    other=0
    for child in $(descendants "$app"); do
      kind=$(kind_of "$(cat "/proc/$child/comm" 2>/dev/null || true)")
      kb=$(rss_kb "$child")
      case "$kind" in
        web) web=$((web + kb)) ;;
        net) net=$((net + kb)) ;;
        gpu) gpu=$((gpu + kb)) ;;
        *) other=$((other + kb)) ;;
      esac
    done
    used=$(free -m | awk '/^Mem:/{print $3}')
    swap=$(free -m | awk '/^(Inter|Swap):/{print $3}')
    now=$(date +%s.%N)
    # LC_ALL=C: con la configuración regional en español awk escribe la coma decimal y rompe las columnas.
    printf '%s,%s,%s,%s,%s,%s,%s,%s\n' "$(LC_ALL=C awk -v a="$start" -v b="$now" 'BEGIN{printf "%.1f", b-a}')" \
      "$(rss_kb "$app")" "$web" "$net" "$gpu" "$other" "$used" "$swap" >>"$csv"
    sleep 1
  done
}

format_of() {
  case $1 in
    a) echo bmp ;;
    b) echo rgba ;;
    c) echo jpg ;;
    d) echo png ;;
    *) echo "variante desconocida: $1" >&2; return 1 ;;
  esac
}

run_bench() {
  rm -f "$OUT/bench-encode.json"
  ATRIL_SPIKE_BENCH=1 ATRIL_SPIKE_PAGES="$PAGES" ATRIL_SPIKE_OUT="$OUT" \
    XDG_DATA_HOME="$TMP/data-bench" XDG_CACHE_HOME="$TMP/cache-bench" XDG_CONFIG_HOME="$TMP/config-bench" \
    GDK_BACKEND=x11 timeout 900 "$BIN" >"$OUT/app-bench.log" 2>&1 || true
  if [[ ! -s "$OUT/bench-encode.json" ]]; then
    echo "el banco de codificación no terminó: revisa $OUT/app-bench.log" >&2
    return 1
  fi
}

run_variant() {
  local id=$1 fmt waited=0 peaks child kind kb
  fmt=$(format_of "$id")
  rm -f "$OUT/$id.json"
  ATRIL_SPIKE_PAGES="$PAGES" ATRIL_SPIKE_OUT="$OUT" ATRIL_SPIKE_AUTO="$id" ATRIL_SPIKE_FORMATS="$fmt" \
    ATRIL_SPIKE_LIMIT=30 XDG_DATA_HOME="$TMP/data-$id" XDG_CACHE_HOME="$TMP/cache-$id" \
    XDG_CONFIG_HOME="$TMP/config-$id" GDK_BACKEND=x11 "$BIN" >"$OUT/app-$id.log" 2>&1 &
  APP_PID=$!
  sample "$APP_PID" "$OUT/rss-$id.csv" &
  local sampler=$!
  until node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$OUT/$id.json" 2>/dev/null; do
    sleep 2
    waited=$((waited + 2))
    if ((waited > 420)) || ! kill -0 "$APP_PID" 2>/dev/null; then
      echo "la variante $id no terminó (ver $OUT/app-$id.log)" >&2
      break
    fi
  done
  sleep 4
  peaks="$OUT/peaks-$id.txt"
  {
    echo "app_hwm_kb $(peak_kb "$APP_PID")"
    for child in $(descendants "$APP_PID"); do
      kind=$(kind_of "$(cat "/proc/$child/comm" 2>/dev/null || true)")
      kb=$(peak_kb "$child")
      echo "webkit_${kind}_hwm_kb $kb"
    done
  } >"$peaks"
  kill "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  APP_PID=""
  wait "$sampler" 2>/dev/null || true
  stop_leftovers "$TMP/data-$id"
}

mkdir -p "$TMP/data-bench" "$TMP/cache-bench" "$TMP/config-bench"
Xvfb "$DISPLAY" -screen 0 1600x1000x24 -nolisten tcp >"$OUT/xvfb.log" 2>&1 &
XVFB_PID=$!
timeout 30 bash -c "until [[ -S /tmp/.X11-unix/X$DISPLAY_NUM ]]; do sleep 0.2; done"
echo "Xvfb en $DISPLAY (sin GPU). Resultados en $OUT"

run_bench
for id in "${VARIANTS[@]}"; do
  run_variant "$id"
  sleep 5
done
echo "listo"
