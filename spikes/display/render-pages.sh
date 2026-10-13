#!/usr/bin/env bash
# Renderiza las páginas de prueba del spike R0.2 con pdftoppm a 1240 y 2480 px de ancho.
# Uso: render-pages.sh <carpeta-salida> <libro-texto.pdf> <primera-pagina> <libro-escaneo.pdf> <primera-pagina>
# Las salidas van FUERA del repo (no se commitean). Los PDF se leen desde su ruta, nunca se copian.
# Es reanudable: las páginas que ya existen con contenido se saltan.
set -euo pipefail
out=$1
text_pdf=$2
text_first=$3
scan_pdf=$4
scan_first=$5
mkdir -p "$out"

render() { # <pdf> <primera-pagina> <prefijo>
  local pdf=$1 first=$2 prefix=$3 i page w name
  for ((i = 0; i < 30; i++)); do
    page=$((first + i))
    for w in 1240 2480; do
      name=$(printf '%s-%02d-%s' "$prefix" $((i + 1)) "$w")
      [[ -s "$out/$name.png" ]] && continue
      pdftoppm -png -singlefile -scale-to-x "$w" -scale-to-y -1 -f "$page" -l "$page" "$pdf" "$out/$name"
    done
  done
  echo "listo: $prefix"
}

render "$text_pdf" "$text_first" text &
render "$scan_pdf" "$scan_first" scan &
wait
