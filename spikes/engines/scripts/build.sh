#!/usr/bin/env bash
# Compila variantes del spike en release (una compilación en frío de MuPDF por variante),
# con marcas de tiempo en el log y registro vía record_build.sh.
# Uso: scripts/build.sh <variante> [...]
#   variantes: baseline pdfium mupdf-default mupdf-min mupdf-base14 mupdf-base14-sysfonts mupdf-sysfonts mupdf-bundled
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"
# shellcheck disable=SC1091
. "$ROOT/scripts/env.sh"
cd "$ROOT"
mkdir -p "$OUT/logs"

build() {  # build <variante> <bin> <args de cargo...>
  local name="$1" bin="$2"; shift 2
  local log="$OUT/logs/build-$name.log"
  set +e
  cargo build --release "$@" 2>&1 | while IFS= read -r l; do printf '%s %s\n' "$(date +%s.%N)" "$l"; done >"$log"
  local rc=${PIPESTATUS[0]}
  set -e
  echo "exit=$rc" >>"$log"
  "$ROOT/scripts/record_build.sh" "$name" "$log" "$CARGO_TARGET_DIR/release/$bin"
}

for v in "$@"; do
  case "$v" in
    baseline) build baseline bench-baseline --bin bench-baseline ;;
    pdfium) build pdfium bench-pdfium --features pdfium --bin bench-pdfium ;;
    mupdf-min) build mupdf-min bench-mupdf --features mupdf --bin bench-mupdf ;;
    mupdf-base14) build mupdf-base14 bench-mupdf --features mupdf-base14 --bin bench-mupdf ;;
    mupdf-base14-sysfonts) build mupdf-base14-sysfonts bench-mupdf --features mupdf-base14-sysfonts --bin bench-mupdf ;;
    mupdf-sysfonts) build mupdf-sysfonts bench-mupdf --features mupdf-sysfonts --bin bench-mupdf ;;
    mupdf-bundled) build mupdf-bundled bench-mupdf --features mupdf-bundled-fonts --bin bench-mupdf ;;
    mupdf-default) build mupdf-default bench-mupdf --features mupdf-default --bin bench-mupdf ;;
    *) echo "variante desconocida: $v" >&2; exit 2 ;;
  esac
done
