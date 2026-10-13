#!/usr/bin/env bash
# Descarga las dependencias binarias del spike en vendor/ (ignorado por git) y verifica su sha256.
#  - libpdfium 157.0.8100 (chromium/8100) de bblanchon/pdfium-binaries, linux-x64.
#  - libclang 18.1.1 extraído del wheel de PyPI (bindgen de mupdf-sys lo necesita; sin sudo).
# Uso: scripts/fetch_deps.sh   (VENDOR_DIR=<ruta> para cambiar el destino)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="${VENDOR_DIR:-$ROOT/vendor}"
mkdir -p "$VENDOR_DIR"
tmp="$(mktemp -d "$VENDOR_DIR/dl.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

PDFIUM_URL="https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8100/pdfium-linux-x64.tgz"
PDFIUM_SHA256="1c1894a12d4d96ee01400c3874444126254180c5c7d2ab628576b67f8120320a"
mkdir -p "$tmp/pdfium"
curl -fsSL -o "$tmp/pdfium/pdfium.tgz" "$PDFIUM_URL"
echo "$PDFIUM_SHA256  $tmp/pdfium/pdfium.tgz" | sha256sum -c -
mkdir -p "$VENDOR_DIR/pdfium"
tar -xzf "$tmp/pdfium/pdfium.tgz" -C "$VENDOR_DIR/pdfium"

read -r LIBCLANG_URL LIBCLANG_SHA256 < <(curl -fsSL https://pypi.org/pypi/libclang/18.1.1/json | python3 -c 'import sys,json; d=json.load(sys.stdin); u=[u for u in d["urls"] if u["filename"].startswith("libclang-18.1.1-py2.py3-none-manylinux2010_x86_64")][0]; print(u["url"], u["digests"]["sha256"])')
mkdir -p "$tmp/libclang"
curl -fsSL -o "$tmp/libclang/libclang.whl" "$LIBCLANG_URL"
echo "$LIBCLANG_SHA256  $tmp/libclang/libclang.whl" | sha256sum -c -
mkdir -p "$VENDOR_DIR/libclang"
unzip -q -o "$tmp/libclang/libclang.whl" -d "$VENDOR_DIR/libclang"
ln -sfn "libclang/libclang-18.1.1.data/platlib/clang/native" "$VENDOR_DIR/libclang-lib"
echo "listo: $VENDOR_DIR/pdfium/lib/libpdfium.so y $VENDOR_DIR/libclang-lib/libclang.so"
