#!/usr/bin/env bash
# Registra un build cronometrado: tiempo de compilación (desde la primera línea «Compiling»
# hasta «Finished», sin contar la espera del lock del directorio compartido) y tamaño stripped.
# Uso: scripts/record_build.sh <variante> <log con marcas de tiempo> <binario sin strip>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"
name="$1"; log="$2"; bin="$3"
mkdir -p "$OUT/bin"
rc=$(sed -n 's/^.*exit=\([0-9]*\).*$/\1/p' "$log" | tail -1)
t0=$(grep -m1 ' Compiling ' "$log" | awk '{print $1}' || true)
t1=$(grep -m1 ' Finished ' "$log" | awk '{print $1}' || true)
if [ -n "$t0" ] && [ -n "$t1" ]; then secs=$(echo "$t1 - $t0" | bc); else secs="0 (ya compilado)"; fi
TIMES="$OUT/build-times.tsv"
printf '%s\trc=%s\tsecs=%s\n' "$name" "${rc:-?}" "$secs" >>"$TIMES"
if [ "${rc:-1}" = "0" ] && [ -f "$bin" ]; then
  cp "$bin" "$OUT/bin/$name.raw"
  strip -o "$OUT/bin/$name.stripped" "$OUT/bin/$name.raw"
  printf '%s\tstripped_bytes=%s\n' "$name" "$(stat -c %s "$OUT/bin/$name.stripped")" >>"$TIMES"
fi
