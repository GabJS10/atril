#!/usr/bin/env bash
# Entorno para compilar `mupdf-sys` sin libclang instalado en el sistema (sin sudo).
# Uso:  . src-tauri/scripts/libclang-env.sh      (descarga el wheel de libclang la primera vez)
# En un equipo con `libclang-dev` (la CI de Ubuntu) no hace falta: cargo lo encuentra solo.
#
# Descarga el wheel `libclang` 18.1.1 de PyPI, verifica su sha256 y lo extrae en `$ATRIL_VENDOR`
# (por defecto `.claude/worktrees/.vendor`, fuera de git). Exporta LIBCLANG_PATH y las cabeceras de GCC
# que bindgen necesita (`stddef.h`).
ATRIL_VENDOR="${ATRIL_VENDOR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && git rev-parse --show-toplevel)/../.vendor}"
ATRIL_VENDOR="$(realpath -m "$ATRIL_VENDOR")"
LIBCLANG_SHA256="c533091d8a3bbf7460a00cb6c1a71da93bffe148f172c7d03b1c31fbf8aa2a0b"
LIBCLANG_URL="https://files.pythonhosted.org/packages/1d/fc/716c1e62e512ef1c160e7984a73a5fc7df45166f2ff3f254e71c58076f7c/libclang-18.1.1-py2.py3-none-manylinux2010_x86_64.whl"
LIBCLANG_DIR="$ATRIL_VENDOR/libclang/libclang-18.1.1.data/platlib/clang/native"

if [ ! -f "$LIBCLANG_DIR/libclang.so" ]; then
  tmp="$(mktemp -d)"
  mkdir -p "$ATRIL_VENDOR/libclang"
  curl -fsSL -o "$tmp/libclang.whl" "$LIBCLANG_URL" \
    && echo "$LIBCLANG_SHA256  $tmp/libclang.whl" | sha256sum -c - \
    && unzip -q -o "$tmp/libclang.whl" -d "$ATRIL_VENDOR/libclang"
  rm -rf "$tmp"
fi

export LIBCLANG_PATH="$LIBCLANG_DIR"
gcc_include="$(ls -d /usr/lib/gcc/x86_64-linux-gnu/*/include 2>/dev/null | sort -V | tail -n 1)"
export BINDGEN_EXTRA_CLANG_ARGS="${BINDGEN_EXTRA_CLANG_ARGS:--I$gcc_include}"
