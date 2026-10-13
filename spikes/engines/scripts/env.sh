# Entorno del spike R0.1 (se carga con `. scripts/env.sh`).
SPIKE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Directorio de compilación compartido por todos los worktrees (ver AGENTS.md).
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$(realpath -m "$SPIKE_ROOT/../../../.target")}"
export CARGO_BUILD_JOBS=4
export CARGO_TERM_COLOR=never
export NO_COLOR=1
# bindgen (mupdf-sys) necesita libclang: el de vendor/ si se ha descargado con fetch_deps.sh.
export LIBCLANG_PATH="${LIBCLANG_PATH:-$SPIKE_ROOT/vendor/libclang-lib}"
export BINDGEN_EXTRA_CLANG_ARGS="${BINDGEN_EXTRA_CLANG_ARGS:--I/usr/lib/gcc/x86_64-linux-gnu/13/include}"
