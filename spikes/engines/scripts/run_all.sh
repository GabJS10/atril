#!/usr/bin/env bash
# Ejecuta un motor sobre todos los PDF de ~/datos/libros (se leen desde su ruta; nunca se copian).
# Cada libro se mide en procesos separados (repeticiones) bajo /usr/bin/time -v, así el primer
# render es «en frío» y el pico de memoria sale por ejecución.
#
# Uso: scripts/run_all.sh mupdf|pdfium [repeticiones=3]
#   ONLY_IDS="b01 b07"  limita los libros (para pruebas).
#   PAR_IDS="b01 b05"   libros con prueba en paralelo (4 hilos), con 3 repeticiones.
#   SAMPLE_IDS="b02 b07" libros cuyas muestras PNG se exportan (en la primera repetición).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"
# shellcheck disable=SC1091
. "$ROOT/scripts/env.sh"
ENGINE="${1:?uso: run_all.sh mupdf|pdfium [repeticiones]}"
REPS="${2:-3}"
LIBS="$HOME/datos/libros"
PDFIUM_LIB="$ROOT/vendor/pdfium/lib/libpdfium.so"
MANIFEST="$OUT/books.tsv"
mkdir -p "$OUT/results" "$OUT/time" "$OUT/logs" "$OUT/samples"

# Manifiesto de libros (id, bytes, ruta relativa). Se genera una vez para todos los motores.
if [ ! -s "$MANIFEST" ]; then
  i=0
  while IFS= read -r -d '' f; do
    i=$((i + 1))
    printf 'b%02d\t%s\t%s\n' "$i" "$(stat -c %s "$f")" "${f#"$LIBS"/}"
  done < <(find "$LIBS" -type f -iname '*.pdf' -print0 | sort -z) >"$MANIFEST"
fi

case "$ENGINE" in
  mupdf) BIN="$OUT/bin/mupdf-default.raw" ;;
  pdfium) BIN="$OUT/bin/pdfium.raw" ;;
  *) echo "motor desconocido: $ENGINE" >&2; exit 2 ;;
esac

selected() { [ -z "${ONLY_IDS:-}" ] || [[ " $ONLY_IDS " == *" $1 "* ]]; }
in_par() { [[ " ${PAR_IDS:-} " == *" $1 "* ]]; }
in_samples() { [[ " ${SAMPLE_IDS:-} " == *" $1 "* ]]; }

# Ejecuta un proceso del bench y guarda JSONL, tiempo y registro de carga.
run_one() {
  local id="$1" rel="$2" tag="$3"; shift 3
  local file="$LIBS/$rel" base="$OUT/results/$ENGINE-$id-$tag"
  local -a cmd
  if [ "$ENGINE" = mupdf ]; then
    cmd=("$BIN" --file "$file" --book "$id" --run "${RUN:-1}")
  else
    cmd=("$BIN" --lib "$PDFIUM_LIB" --file "$file" --book "$id" --run "${RUN:-1}")
  fi
  cmd+=("$@")
  printf '%s | %s | %s\n' "$(date +%T)" "$(uptime | sed 's/.*load average: //')" \
    "$(free -m | awk '/Mem:/{print "disp_mb=" $7}')" >>"$OUT/load.log"
  local rc=0
  set +e
  /usr/bin/time -v -o "$OUT/time/$ENGINE-$id-$tag.time" timeout 1500 "${cmd[@]}" >"$base.jsonl" 2>"$base.err"
  rc=$?
  set -e
  printf '%s %s %s rc=%s\n' "$ENGINE" "$id" "$tag" "$rc" >>"$OUT/logs/status.log"
}

while IFS=$'\t' read -r id bytes rel; do
  selected "$id" || continue
  for RUN in $(seq 1 "$REPS"); do
    extra=()
    # Barrido de páginas y muestras PNG solo en la primera repetición.
    if [ "$RUN" -eq 1 ]; then extra+=(--sweep); fi
    if [ "$RUN" -eq 1 ] && in_samples "$id"; then extra+=(--samples "$OUT/samples"); fi
    # Búsqueda de «dios» en «La fe explicada» (pdf.js daba 2093).
    if [[ "$rel" == "estudio-de-fe/La fe explicada.pdf" ]]; then extra+=(--search dios); fi
    run_one "$id" "$rel" "r$RUN" "${extra[@]}"
  done
  if in_par "$id"; then
    for RUN in $(seq 1 "$REPS"); do
      run_one "$id" "$rel" "par-r$RUN" --only-parallel --parallel 32
    done
  fi
done <"$MANIFEST"
echo "fin $ENGINE" >>"$OUT/logs/status.log"
