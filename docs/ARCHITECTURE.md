# Arquitectura de Atril

**Dueño:** `plan`. Se actualiza cuando cambia la estructura: módulos nuevos, hilos, flujos de datos o decisiones de fondo. El contrato exacto de comandos, eventos y URLs está en [`IPC.md`](IPC.md); las decisiones y su porqué, en [`PLAN.md`](PLAN.md).

**Estado:** fase R cerrada (tag `fase-R`).
- R1 (motor nativo en Rust) y R2 (visor nativo, con texto, subrayados, búsqueda, índice y enlaces) están hechos.
- R2.3 quitó pdf.js del frontend: el visor nativo es el único.
- R3 quitó el puente JPX (`jpx.rs`, `POST /jpx`, `jpxBridge.js`, `pdfjs-dist`), los comandos del indexador viejo y corrigió los títulos con nombre de archivo. La licencia es AGPL-3.0.

## Vista general
```
┌──────────────────────── WebView (WebKitGTK) ───────────────────────┐
│ React 19 + TanStack Router/Query + Zustand                          │
│                                                                     │
│  _shell (barra lateral): Inicio, libros, Salas, Ajustes             │
│  Lector (routes/read.$bookId → reader/ReaderScreen)                 │
│    └ NativeViewer (reader/native): <img> por página, texto,         │
│      subrayados, búsqueda, índice y enlaces                         │
│                                                                     │
│  api/tauri.ts — único punto de contacto con Rust                    │
└──────────┬───────────────────────────────┬─────────────────────────┘
           │ invoke() / eventos            │ GET atril://localhost/…
┌──────────▼───────────────────────────────▼─────────────────────────┐
│ Rust (Tauri 2)                                                      │
│  commands.rs ── library · collections · highlights · settings       │
│  protocol.rs ── /book/<id> (Range) · /cover/<id> · /page/<id>/<n>   │
│                 · POST /jpx (legado)                                │
│  engine/ ────── MuPDF: pool de render, hilo de lectura, cachés      │
│  indexer.rs ─── metadatos y portadas en segundo plano               │
│  watch.rs ───── escaneo y vigilancia de carpetas                    │
│  db.rs ──────── SQLite (~/.local/share/atril/atril.db)              │
└─────────────────────────────────────────────────────────────────────┘
```

**Principios** (ver `AGENTS.md`):
- Toda la E/S de disco va en Rust.
- El front nunca construye URLs ni maneja rutas de archivos.
- El PDF nunca se modifica.
- Un libro se identifica por la huella de su contenido.

## Backend (`src-tauri/src/`)
| Módulo | Qué hace |
|---|---|
| `lib.rs` | Arranque: DB, `AppState` (DB, motor, indexador, canal del vigilante), registro de comandos y del protocolo `atril://` |
| `commands.rs` | Los `#[tauri::command]`. Los lentos (`open_document`, texto, búsqueda…) usan `spawn_blocking` |
| `error.rs` | `AppError { code, message }`, la forma de todos los errores hacia el front |
| `db.rs` + `migrations/` | SQLite con migraciones. Tablas: `books`, `reading_state`, `highlights`, `collections`, `book_collections`, `library_folders`, `settings` |
| `library.rs`, `scan.rs`, `folders.rs`, `query.rs` | Biblioteca: alta por huella, importación, carpetas, consultas de la pantalla de inicio |
| `watch.rs` | Hilo `library-watch`: escaneos y vigilancia (`notify`). Emite `library://changed` y `library://scan` y despierta al indexador |
| `indexer.rs` | Hilo `atril-indexer` (nice 19): por cada libro `pending` saca páginas, título y autor y genera una portada JPEG de 400 px. Espera mientras el visor tiene renders en cola |
| `protocol.rs` | `atril://`: libros con `Range` (206), portadas, páginas JPEG del motor (respuesta asíncrona) y `POST /jpx` (legado) |
| `highlights.rs`, `collections.rs`, `settings.rs` | Subrayados (con exportación a Markdown), Salas y ajustes |
| `system.rs` | Integración con el sistema: abrir desde argumentos, instancia única, lector predeterminado |
| `jpx.rs` | Decodificación JPEG 2000 para pdf.js (`hayro-jpeg2000`). **Legado: sale en R3** |

### Motor de PDF (`engine/`)
MuPDF (crate `mupdf` 0.8, enlazado estático, `base14-fonts`, sin `system-fonts`). Por eso la licencia es AGPL.

| Pieza | Qué hace |
|---|---|
| `geometry.rs` | Tamaño de cada página y matriz PDF→visor a escala 1, con el mismo algoritmo que pdf.js (CropBox ∩ MediaBox, /Rotate, /UserUnit) |
| `document.rs` | Un PDF abierto: geometría de todas las páginas y render a JPEG |
| `scheduler.rs` | Cola pura, sin hilos. Prioridad visor > precarga. Precarga de ±2 páginas en la dirección de avance. Descarta lo que ya no sirve: a más de 12 páginas o con otra escala → `410` |
| `cache.rs` | LRU de JPEG por bytes (256 MB), clave (libro, página, escala en centésimas) |
| `encode.rs` | JPEG q85 4:2:0 con `jpeg-encoder` (SIMD): ~22 ms a 1240 px |
| `pool.rs` | `Engine`: 2 hilos `atril-render-N` y 1 hilo `atril-read`. Cada uno abre su propia copia de cada documento (MuPDF liga el documento al contexto del hilo) |
| `text.rs`, `search.rs`, `outline.rs`, `links.rs` | Texto con cajas, búsqueda por eventos (`search://progress` y `search://done`, cancelable, sin distinguir mayúsculas ni acentos), índice (iterativo, límites de 32 niveles y 20 000 entradas) y enlaces |
| `raw.rs` | Único módulo con `unsafe`. Limita el *store* compartido de MuPDF a 64 MB (`fz_shrink_store`) y libera el heap con `malloc_trim` tras cada trabajo |
| `api.rs` | Comandos del motor y resolución de libro → ruta (desde la DB) |

**Hilos en ejecución:**
- el hilo principal de Tauri;
- `library-watch`;
- `atril-indexer`;
- `atril-render-0` y `atril-render-1`;
- `atril-read`;
- los hilos de bloqueo de Tokio (comandos y protocolo).

**Memoria:** MuPDF tiene un único *store* compartido de 64 MB y la caché de JPEG ocupa hasta 256 MB. Medido: ~230 MB de RSS tras 48 páginas escaneadas.

## Frontend (`src/`)
| Carpeta | Qué hay |
|---|---|
| `api/` | `tauri.ts` (wrappers tipados de `invoke`), `types.ts` (tipos de `IPC.md`) y `queries.ts` (TanStack Query) |
| `routes/` | Rutas por archivos. `_shell` es el layout con la barra lateral (navegación, contadores, Salas) y envuelve `index` (Inicio), `books.$scope` (`all`, `favorites`, `reading`), `collection.$collectionId` y `settings`. `read.$bookId` va fuera del layout y admite `?panel=highlights\|outline` |
| `library/` | Pantalla de biblioteca, Salas, ajustes, eventos de biblioteca y soltar archivos. El indexador de pdf.js (`indexer.ts`) salió en R2.3; el de Rust es `indexer.rs` |
| `reader/` | Pantalla de lectura, barra, atajos, posición, subrayados, índice y búsqueda. Detalle abajo |
| `i18n/` | Textos en `es.ts` y `en.ts` |
| `ui/`, `theme.ts` | Componentes comunes y tema (tokens del diseño "museo de noche") |

### Lector
- **`ReaderScreen.tsx`** habla con el visor por una interfaz común (`viewerTypes.ts`). Así el resto de la pantalla no depende del visor: barra, paneles, atajos, posición y subrayados. El visor nativo es el único desde R2.3.
- **Visor nativo (`reader/native/`, R2.1–R2.2):** `NativeViewer.tsx`, con `PageSlot` y `PageImage` por página y lógica pura y testeada en `layout.ts` (offsets y búsqueda binaria), `mapping.ts` (`PageMapping` desde `transform`), `scale.ts`, `anchor.ts` (punto fijo del zoom), `imageReducer.ts` (doble búfer) y `pageFetch.ts` (reintentos ante `410`). Tiene capa de texto para seleccionar y copiar (`textLayer.ts`, `TextLayer.tsx`), subrayados, búsqueda con resaltado (`searchController.ts`), índice y enlaces (`links.ts`, `LinkLayer.tsx`).
  - **Lista virtualizada.** La altura total sale de `open_document` desde el primer instante. Solo están en el DOM las páginas visibles ±1. La página visible se busca por búsqueda binaria sobre los offsets acumulados, así que nada crece con el número de páginas.
  - **Imágenes.** Cada página es un `<img>` a escala zoom × `devicePixelRatio`. Ante un `410` se reintenta si la página sigue visible.
  - **Zoom en dos pasos.** Primero escala CSS inmediata; tras ~150 ms quieto, se pide la imagen nítida y se cambia cuando ha cargado (doble búfer), conservando el punto de anclaje.
- **Geometría** (`geometry.ts`): los subrayados se guardan en **espacio de usuario PDF**. El visor construye el `PageMapping` con `transform` × zoom. Por eso los subrayados hechos con pdf.js siguen en su sitio.
- **Posición:** `useReadingPosition`, `position.ts` y `positionSaver.ts` guardan la página y `offsetInPage` en `reading_state`. El libro y su posición se leen con `useOpenedBook` (`gcTime: 0`). La consulta no sobrevive al cierre del lector, porque una copia en caché reabría el libro en la posición vieja.

## Flujos principales
1. **Abrir un libro:**
   1. `open_book` devuelve el libro y su `reading_state`.
   2. `open_document` devuelve la geometría y `pageBaseUrl`, y precalienta el documento en los hilos.
   3. El visor coloca la posición guardada y pide `GET …/page/<id>/<n>?scale=`.
   4. El pool renderiza, la página pasa por la caché y se responde con JPEG; se precargan las vecinas.
2. **Leer:** cada página que entra en vista se pide a la escala actual. Las páginas que el usuario deja atrás se descartan con `410` y la precarga se replanifica.
3. **Buscar:**
   1. `search_document` devuelve un `searchId`.
   2. El hilo `atril-read` recorre las páginas y emite `search://progress` en cada una y `search://done` al final.
   3. Una búsqueda nueva cancela la anterior.
4. **Indexar la biblioteca:** el vigilante o una importación dan de alta libros `pending`. El indexador los procesa de uno en uno y emite `library://changed` (`reason: "index"`), y el front refresca las portadas.
5. **Subrayar:** de la selección del DOM salen rectángulos de viewport, que el `PageMapping` pasa a rectángulos PDF; se llama a `create_highlight` y se guardan en SQLite.

## Datos en disco
`~/.local/share/atril/` (respeta `XDG_DATA_HOME`):
- `atril.db`;
- `covers/<id>.jpg`.

Los libros se quedan donde están; la DB guarda su ruta y su huella.

## Construcción y CI
- **Rust:**
  - `mupdf-sys` compila MuPDF desde fuente y necesita libclang. En la CI se instala `libclang-dev`; en local, sin sudo, `src-tauri/scripts/libclang-env.sh`.
  - Los worktrees comparten `CARGO_TARGET_DIR=.claude/worktrees/.target`.
- **CI** (GitHub Actions, ubuntu-24.04): front (lint, typecheck, test) y backend (fmt, clippy `-D warnings`, test).
- **Bancos de pruebas** (sin libros en el repo):
  - `cargo run --release --example engine_bench -- <pdf>` (render y memoria);
  - `--example text_bench -- <pdf> [consulta]` (texto, búsqueda, índice e impacto en el render).

## Siguiente
- **Fase 5:** sistema y release para Linux (ver `ROADMAP.md`).
