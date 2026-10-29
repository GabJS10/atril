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
| `db.rs` + `migrations/` | SQLite con migraciones. Tablas: `books`, `reading_state`, `highlights`, `highlight_groups`, `collections`, `book_collections`, `library_folders`, `settings` |
| `library.rs`, `scan.rs`, `folders.rs`, `query.rs` | Biblioteca: alta por huella, importación, carpetas, consultas de la pantalla de inicio |
| `watch.rs` | Hilo `library-watch`: escaneos y vigilancia (`notify`). Emite `library://changed` y `library://scan` y despierta al indexador |
| `indexer.rs` | Hilo `atril-indexer` (prioridad baja: nice 19 en Linux, `THREAD_PRIORITY_LOWEST` en Windows): por cada libro `pending` saca páginas, título y autor y genera una portada JPEG de 400 px. Espera mientras el visor tiene renders en cola |
| `protocol.rs` | `atril://`: libros con `Range` (206), portadas, páginas JPEG del motor (respuesta asíncrona) y `POST /jpx` (legado) |
| `highlights.rs`, `highlight_groups.rs`, `collections.rs`, `settings.rs` | Subrayados (con exportación a Markdown), sus grupos por libro, Salas y ajustes |
| `path_rules.rs` | Normalización y clave de comparación de rutas, con las reglas de cada plataforma (en Windows no distinguen mayúsculas ni `/` de `\`). Función pura, probada para las dos desde cualquiera. La usan `folders.rs`, `scan.rs` y `library.rs` |
| `logging.rs` | Registro (`tracing`) en `<data_dir>/atril.log`; ver «Registro» más abajo |
| `platform.rs` | Ajustes de la ventana que dependen de la plataforma. En Windows, desactiva los aceleradores del navegador de WebView2 en las compilaciones de release |
| `system.rs` | Integración con el sistema: abrir desde argumentos, instancia única, lector predeterminado |
| `jpx.rs` | Decodificación JPEG 2000 para pdf.js (`hayro-jpeg2000`). **Legado: sale en R3** |

### Motor de PDF (`engine/`)
MuPDF (crate `mupdf` 0.8, enlazado estático, `base14-fonts`, sin `system-fonts`). Por eso la licencia es AGPL.

| Pieza | Qué hace |
|---|---|
| `geometry.rs` | Tamaño de cada página y matriz PDF→visor a escala 1, con el mismo algoritmo que pdf.js (CropBox ∩ MediaBox, /Rotate, /UserUnit) |
| `document.rs` | Un PDF abierto: geometría de todas las páginas y render a JPEG |
| `open.rs` | Cómo se abre el archivo en MuPDF: por ruta o, en Windows, los PDF pequeños (hasta 16 MiB) leídos a memoria para no dejar el archivo bloqueado (ver «Windows») |
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
- **Visor nativo (`reader/native/`, R2.1–R2.2):** `NativeViewer.tsx`, con `PageSlot` y `PageImage` por página y lógica pura y testeada en `layout.ts` (offsets y búsqueda binaria), `mapping.ts` (`PageMapping` desde `transform`), `scale.ts`, `anchor.ts` (punto fijo del zoom), `imageReducer.ts` (doble búfer) y `pageFetch.ts` (reintentos ante `410`). Tiene capa de texto para seleccionar y copiar (`textLayerModel.ts`, `TextLayer.tsx`), subrayados, búsqueda con resaltado (`searchController.ts`), índice y enlaces (`links.ts`, `LinkLayer.tsx`).
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
- `covers/<id>.jpg`;
- `atril.log` y `atril.old.log` (registro de la ejecución actual y de la anterior).

Los libros se quedan donde están; la DB guarda su ruta y su huella.

## Construcción y CI
- **Rust:**
  - `mupdf-sys` compila MuPDF desde fuente y necesita libclang. En la CI se instala `libclang-dev`; en local, sin sudo, `src-tauri/scripts/libclang-env.sh`.
  - Los worktrees comparten `CARGO_TARGET_DIR=.claude/worktrees/.target`.
- **CI** (GitHub Actions): front (lint, typecheck, test) y backend (fmt, clippy `-D warnings`, test) en ubuntu-24.04, y `backend-windows` (clippy y test en windows-2022; `LIBCLANG_PATH` apunta al LLVM del runner). El primer build de MuPDF en Windows tarda ~3 min con msbuild.
- **Bancos de pruebas** (sin libros en el repo):
  - `cargo run --release --example engine_bench -- <pdf>` (render y memoria);
  - `--example text_bench -- <pdf> [consulta]` (texto, búsqueda, índice e impacto en el render).

## Registro
`logging::init` (la primera línea de `setup`, tras el plugin de instancia única, para que un segundo lanzamiento no rote el registro del primero) escribe en `<data_dir>/atril.log` (en Windows, `%LOCALAPPDATA%\atril\atril.log`). Al arrancar, el anterior pasa a `atril.old.log` (solo se guarda uno). En desarrollo (`debug_assertions`) también va a stderr. Se necesita porque la release de Windows (`windows_subsystem = "windows"`) no tiene consola y antes todo se perdía.
- Nivel `info` por defecto, o el de `RUST_LOG`. Primera línea: versión, SO, arquitectura y `data_dir`. Si el archivo no se puede abrir, la app sigue sin él (aviso a stderr/nada).
- Un hook de pánico (encadenado al anterior) escribe el mensaje, el hilo y la ubicación.
- **Escaneo:** cada carpeta deja «walking folder» (con `is_dir`) y «folder walked» (entradas y PDF candidatos); cada escaneo termina con «scan finished» (carpetas, entradas, candidatos, registrados, ya conocidos, rechazados, errores de recorrido, entradas `.pdf` que no son archivos). Cada error de `walkdir` y cada archivo rechazado es un `warn` (los 20 primeros por escaneo; el resto solo cuenta en el resumen). Las primeras 5 entradas de cada carpeta se describen (`scan: entry`, con tipo y, en Windows, atributos en hexadecimal: `0x400` punto de reanálisis, `0x400000` marcador de la nube) y las entradas `.pdf` que no son archivos llevan lo mismo. `add_library_folder` registra la ruta recibida y la guardada.
- Si un usuario dice que «no aparecen libros», pedir `atril.log`: `scan finished` con `pdf_candidates=0` y `entries` bajo apunta al recorrido (permisos, carpeta equivocada, enlaces); candidatos altos y `rejected` alto, a los `scan: file rejected` de encima; `registered=0 known=N`, a libros ya conocidos; `skipped_removed` alto, a libros quitados de la biblioteca (un escaneo normal no los devuelve; sí volver a añadir la carpeta: `restored_by_hash` cuenta los que volvieron, y cada uno deja `scan: removed book restored by fingerprint`); `skipped_duplicate`, a copias de un libro conocido cuyo archivo original sigue existiendo.

### Restaurar libros quitados al añadir su carpeta
«Quitar de la biblioteca» solo marca `removed_at`; la fila (huella, progreso, subrayados, Salas) se conserva, y puede sobrevivir a una reinstalación. Un escaneo normal no la toca (`Origin::Scan`). `add_library_folder` envía `Msg::ScanAdded(carpeta)` al hilo `library-watch`, que la anota en `restore_in` y la consume el siguiente escaneo: los PDF dentro de esa carpeta se registran con `Origin::Restore`, que devuelve el libro quitado con esa **huella** y pone su ruta nueva (los libros quitados pueden estar en cualquier otra ruta). Al vaciar la cola tras un evento de `notify` no se pierden los `ScanAdded` (`drain_keeping_added`). No se restaura por ruta: un libro quitado sin archivo no tiene nada que devolver.

## Windows (fase W)
Atril nació para Linux; el backend ya compila y pasa sus pruebas en Windows 10/11 (job `backend-windows` de la CI). No hay un equipo Windows en el desarrollo: lo que la CI no cubre está en «Pendiente de QA en Windows», al final.

### Archivos abiertos y bloqueo
En Windows, un archivo abierto sin `FILE_SHARE_DELETE` no se puede renombrar, mover ni borrar desde el Explorador. Atril promete lo contrario (mover o renombrar un libro conserva su progreso), así que se revisó quién mantiene el PDF abierto:
- **No bloquean:** la huella y la comprobación de cabecera (`library::fingerprint`), el protocolo `atril://book/<id>` y las portadas usan `std::fs`, que en Windows comparte `FILE_SHARE_DELETE`, y cierran al terminar. El indexador abre el documento solo durante `read_scan`. El vigilante (`notify`) abre las carpetas con `FILE_SHARE_DELETE`.
- **Bloquean:** los hilos del motor (2 de render y 1 de lectura) conservan abiertos hasta 3 documentos cada uno (`OPEN_DOCUMENTS_PER_WORKER`). MuPDF abre con `fopen`, que en Windows no comparte `FILE_SHARE_DELETE`.

**Decisión (`engine/open.rs`).** En Windows los PDF de hasta **16 MiB** (`IN_MEMORY_MAX_BYTES`) se leen enteros a memoria con `std::fs` y MuPDF trabaja sobre la copia: el archivo se cierra al instante y nunca se bloquea. Los mayores se abren por ruta y quedan bloqueados mientras algún hilo los tenga abiertos.
- **Por qué hay un límite:** cada hilo de MuPDF abre su propia copia del documento (3 hilos), y el crate `mupdf` 0.8 copia los bytes en cada apertura (`Document::from_bytes`). Un libro de 16 MiB ocupa hasta 48 MiB; un escaneo de 350 MB serían ~1 GB. La mayoría de los libros de texto caben; los escaneos grandes, no.
- **Por qué no un `fz_stream` propio con `FILE_SHARE_DELETE`:** `mupdf` solo abre por ruta o desde `&[u8]`, y su `Document` no se puede construir desde un stream propio sin tocar campos privados. `mupdf-sys` tampoco trae un envoltorio con `fz_try` para `fz_open_document_with_stream`, y llamarlo directo abortaría el proceso ante un PDF roto. Pasarle un `FILE*` abierto desde Rust tampoco: en los builds de depuración MuPDF usa otra CRT y los `FILE*` no cruzan CRTs.
- **Límite conocido:** un libro de más de 16 MiB no se puede mover ni borrar mientras Atril lo tiene en el LRU de algún hilo (o hasta cerrar la app). Mejora posible, que necesita al front: un comando `close_document` que el lector llame al salir, o soltar los documentos inactivos pasado un rato.
- Lo cubre `a_small_book_open_in_the_engine_can_be_renamed_and_deleted` (`engine/open.rs`), que corre en todas las plataformas y en Windows falla si MuPDF volviera a retener el archivo.

### Rutas
- Datos de usuario en `%LOCALAPPDATA%\atril\` (`dirs::data_local_dir()`). La base guarda las rutas como texto Unicode, así que el motor las pasa a MuPDF en UTF-8 (que las convierte a UTF-16). Una ruta absoluta de 248 caracteres o más va con el prefijo `\\?\` (`open::windows_path`), porque `_wfopen` no admite más de 259 sin él.
- **Comparación (`path_rules.rs`).** En Windows las rutas no distinguen mayúsculas, `/` vale como `\`, `C:\Libros` y `c:\libros\` son la misma carpeta y a veces llegan con el prefijo `\\?\`. La normalización y la clave de comparación son funciones puras de una `Style` (`Posix` o `Windows`), así que las reglas de Windows se prueban desde Linux. Se usan en:
  - `folders::add`: la misma carpeta escrita distinto no se añade dos veces; se guarda sin barra final ni separadores repetidos, conservando las mayúsculas del usuario;
  - `scan::collect_pdfs`: carpetas repetidas o anidadas encuentran un PDF una sola vez;
  - `library::commit_file`: detecta un archivo reemplazado en su ruta (la búsqueda exacta usa el índice de `books.path`; en Windows, un libro nuevo también se compara sin distinguir mayúsculas ASCII).
- No se usa `canonicalize`: resolvería junctions y unidades mapeadas (cambiaría lo que ve el usuario) y puede bloquearse en un recurso de red caído. El prefijo `\\?\` se quita de forma léxica. La huella por contenido no cambia, y es la identidad del libro: las rutas solo sirven para abrirlo y detectar movimientos.

### Vigilancia
`notify` usa `ReadDirectoryChangesW` (búfer de 16 KB por carpeta). El hilo `library-watch` solo necesita que llegue *algún* evento: espera 500 ms, vacía la cola y reescanea, sin mirar el tipo. Un renombrado llega como `Modify(Name(From))` y `Modify(Name(To))` (en Linux, a veces como `Name(Both)`).
- Las pruebas (`watch::watcher_tests`) no esperan un evento concreto ni un orden: esperan hasta 30 s uno que **mencione** la ruta cambiada y comprueban el efecto con un escaneo.
- **Límites conocidos:** `notify` 8.2 no avisa si el búfer de `ReadDirectoryChangesW` se desborda (cientos de cambios en menos de 100 ms, p. ej. pegar una carpeta entera): el siguiente cambio o «Reescanear» lo recupera. Las carpetas de red pueden no notificar. En OneDrive con *Files On-Demand*, calcular la huella (lee 2 MiB) descarga el archivo.

### Prioridad y memoria
- El hilo del indexador baja su prioridad con `SetThreadPriority(THREAD_PRIORITY_LOWEST)`, el equivalente por hilo del `nice` 19 de Linux (`indexer::lower_priority`, con prueba en las dos plataformas).
- `raw::release_heap` (`malloc_trim`) es solo de glibc: en Windows no hace nada. No se midió el RSS del motor en Windows.

### WebView2
- Tauri 2.12 no expone `AreBrowserAcceleratorKeysEnabled` (ni en `WebviewWindowBuilder` ni en `tauri.conf.json`), aunque `wry` sí lo tiene al crear el webview. `platform::tune_main_window` lo desactiva tras crear la ventana, con `with_webview` y `webview2-com` (mismas versiones que Tauri), **solo en compilaciones de release** (en `tauri dev` se dejan F5, Ctrl+R y F12).
- Así Ctrl+F, Ctrl+P, F5, Ctrl+R, Alt+Izquierda… llegan a la página como teclas normales en vez de que WebView2 las atienda antes. No afecta a copiar, pegar ni a las teclas de movimiento. El zoom del navegador (Ctrl +/−, Ctrl+rueda, pellizco) y las herramientas de desarrollo en release ya los desactivan Tauri y `wry` por defecto.

### Empaquetado
`src-tauri/tauri.windows.conf.json` (Tauri lo une con `tauri.conf.json` al compilar para Windows; no cambia nada en Linux):
- `productName` y `mainBinaryName` = «Atril» (instalador `Atril_<versión>_x64-setup.exe`, acceso directo del menú Inicio y `Atril.exe`). En Linux siguen siendo `atril-libros`.
- Solo NSIS (`targets: ["nsis"]`), `installMode: currentUser` (sin permisos de administrador), instalador en inglés y español según el idioma del sistema y sin selector.
- WebView2: `downloadBootstrapper` (necesita red al instalar si el equipo no lo tiene; Windows 11 y los Windows 10 al día ya lo traen).
- `packaging_tests.rs` lee las dos configuraciones con los tipos de Tauri (rechazan campos desconocidos), de modo que un error se ve en la CI de Linux.

### Compilación
- `tauri-build` enlaza el runtime de VC++ de forma estática (`build > windows > staticVCRuntime`, por defecto) también en debug. Con `opt-level` 0, `mupdf-sys` compilaba MuPDF con la CRT de depuración (`/MDd`, `ucrtd`, `vcruntimed`), y el enlace de `cargo test` y de la `cdylib` fallaba (LNK2005 de `__CxxFrameHandler3`). Por eso `Cargo.toml` fija `[profile.dev.package.mupdf-sys] opt-level = 3`: MuPDF va siempre en su variante *release* (en Linux, además, las pruebas de render son más rápidas). `cargo clippy` no enlaza, así que no lo veía.
- `libc` es dependencia solo de Unix y `windows-sys` (feature `Win32_System_Threading`), `webview2-com` y `windows-core` solo de Windows.

### Pendiente de QA en Windows
Lo que la CI no puede comprobar y hay que ver a mano con un instalador real:
- renombrar, mover y borrar en el Explorador un libro de menos de 16 MiB mientras está abierto en el lector (debe dejar), y uno de más (no deja: ver arriba);
- carpetas con espacios, tildes, emoji, rutas largas (> 260), unidades de red y OneDrive;
- que los atajos Ctrl+F, Ctrl+P, F5, Ctrl+R y Alt+Izquierda no hagan nada del navegador en la app instalada;
- instalador: nombre «Atril», acceso del menú Inicio, idioma según el sistema, instalación sin administrador y desinstalación;
- consumo de memoria del motor (la copia en memoria de los libros pequeños y la ausencia de `malloc_trim`) y rendimiento de render comparado con Linux.

## Releases
- **v1.0.0** (2026-10-13): Linux, `.deb` y AppImage (paquete y binario `atril-libros`). Se construyen con `.github/workflows/release.yml` al empujar un tag `v*` sobre `main`, que deja un borrador de release en GitHub.
- **v1.0.1** (2026-10-14): parche de empaquetado; el `.deb` ya lleva descripción, homepage y maintainer.
- **v1.1.0** (2026-10-16): Windows 10/11 (fase W). `release.yml` añade el job `windows` (windows-2022, `--bundles nsis`), que adjunta `Atril_<versión>_x64-setup.exe` al mismo borrador. `tauri.windows.conf.json` cambia solo en Windows el nombre a «Atril».
- **v1.2.0** (2026-10-29): notas recientes primero y grupos de subrayados por libro (N1; migración 0007, módulo `highlight_groups.rs`).
- **Backlog:**
  - `open_document` debería devolver `invalid_pdf` para un PDF sin páginas (hoy lo detecta el front).
  - El papel noche sobre escaneos amarillentos queda verdoso u oliva.
  - Firma de código del instalador de Windows.
  - Windows: soltar los documentos inactivos del motor (o un `close_document`) para que los libros de más de 16 MiB no queden bloqueados en el Explorador.
