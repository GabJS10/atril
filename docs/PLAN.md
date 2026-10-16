# Atril: lector de PDF minimalista con biblioteca

## Contexto
El usuario lee sus libros en PDF con el visor de Firefox, que no termina de convencerle, y Okular tampoco le gusta. La idea es una app de escritorio propia, **minimalista y ligera**, pensada para leer libros:
- Una **biblioteca** como pantalla de inicio: seguir leyendo, favoritos y colecciones ("Salas").
- **Recordar la posición** exacta de cada libro.
- **Subrayados que se guardan solos** al crearlos.
- Modo noche/sepia, índice y búsqueda y notas exportables.

Estética: "museo de arte de noche", monocroma (ver [`DESIGN-BRIEF.md`](DESIGN-BRIEF.md)). Forma de trabajo: subagentes con worktrees y PRs (ver [`AGENTS.md`](../AGENTS.md)) y fases en [`ROADMAP.md`](ROADMAP.md).

## Decisiones tomadas
| Tema | Decisión |
|---|---|
| Nombre | **Atril**, con identificador `io.github.gabjs10.atril`. El paquete y el binario se llaman **`atril-libros`** (2026-10-13) porque Ubuntu/Mint ya tienen el paquete `atril` (lector de MATE): con el mismo nombre, apt lo ofrecería como actualización. El nombre visible sigue siendo «Atril» y los datos siguen en `~/.local/share/atril/` |
| Stack | Tauri 2 + React 19 + TS + Vite + Tailwind 4 + TanStack Router/Query + Zustand; Rust con rusqlite |
| Render | **pdf.js 6.x** (el motor de Firefox) con sus componentes de visor; la UI es propia. **Se sustituye en la fase R** (ver la fila siguiente) |
| Motor (fase R) | **MuPDF** (crate `mupdf`, features `base14` sin `system-fonts`) en Rust, con un pool de 2 hilos. Las páginas llegan al visor como **JPEG q85** por `atril://page/…`. Licencia de Atril: **AGPL-3.0**. Decidido el 2026-10-12 tras los spikes R0 (MuPDF frente a PDFium en los 23 libros: 0 errores en ambos; MuPDF gana en escaneos repetidos, texto, búsqueda, hilos y libros enormes) |
| Subrayados | En la SQLite de la app. **El PDF original nunca se modifica** |
| Importar | Carpetas vigiladas + archivos sueltos. Los archivos se quedan donde están y se reconocen por su contenido |
| MVP extra | Modo noche/sepia, índice + búsqueda, notas + exportar a Markdown |
| Integración con el sistema | **Ninguna como lector de PDF** (2026-10-13): Atril es un lector de libros, no un visor genérico. Ver "Sin integración como lector del sistema" |
| Plataformas | Linux (.deb + AppImage; WebKitGTK 2.52) y, desde v1.1.0 (fase W, 2026-10-16), Windows 10/11: instalador NSIS por usuario (sin admin, English/Spanish, descarga WebView2), **sin firma de código** (aviso de SmartScreen documentado). Detalles de plataforma en `ARCHITECTURE.md`, «Windows (fase W)» |
| Idioma de la UI | Español e inglés (`src/i18n/es.ts` y `en.ts`); por defecto sigue al sistema |
| Agentes | Subagentes `frontend` y `backend` (`.claude/agents/`), uno por tarea, cada uno en su worktree de git y con entrega por PR. `plan` elige el modelo (Haiku 5.5 por defecto, Sonnet 5.5 para lo difícil) y el esfuerzo |
| Commits | Sin `Co-Authored-By: Claude …`. Mensajes en inglés, `feat(frontend): …` |

## Arquitectura
```
React UI (WebView)                      Rust core (Tauri)
  Biblioteca, Salas, ajustes        ◄─invoke/events─►  commands.rs
  Lector: pdf.js PDFViewer                             ├─ library.rs    escaneo (walkdir), vigilancia (notify), huella
    + capa de subrayados propia                        ├─ protocol.rs   atril://book/<id> (con Range) y atril://cover/<id>
    + indexador (metadatos y portadas)                 ├─ highlights.rs CRUD + exportar a Markdown
  <── pdf.js lee atril://localhost/book/<id> ───────── ├─ db.rs         SQLite + migraciones (~/.local/share/atril/)
                                                       └─ settings.rs
```

### Decisiones técnicas clave
- **Visor:** los componentes de `pdfjs-dist/web/pdf_viewer.mjs` (`PDFViewer`, `EventBus`, `PDFLinkService`, `PDFFindController`) envueltos en React. Dan la misma calidad que Firefox, renderizan solo las páginas visibles, traen capa de texto para seleccionar y búsqueda de serie. No se escribe un visor desde cero.
- **Recursos de pdf.js obligatorios:** `getDocument` debe recibir `wasmUrl`, `cMapUrl` (+ `cMapPacked`), `standardFontDataUrl` e `iccUrl`, servidos por la app bajo `/pdfjs/…` (copiados de `pdfjs-dist` en el build). Sin `wasmUrl`, pdf.js 5+ no decodifica imágenes JPX (JPEG 2000) ni JBIG2 y los escaneos (p. ej. los de Internet Archive) salen con las páginas en blanco: fue el primer bug de la pausa de pruebas (6 de los 23 PDF del usuario). **JPEG 2000:** desde la 5.7, el `openjpeg.wasm` de pdf.js usa SIMD relajado, que WebKitGTK 2.52 no compila. Su respaldo en JS tardaba 17–25 s por página. Solución: no servimos ese wasm, y en lugar de su respaldo servimos un puente propio (`jpxBridge.js`) que pide la decodificación a Rust (`POST atril://localhost/jpx`, `hayro-jpeg2000`, Rust puro). Tarda ~0,3 s por imagen en release, con píxeles iguales a los de pdf.js salvo ±1. Si el backend responde 422, se usa el respaldo JS original. Se descartó encender la opción `JSC_useWasmRelaxedSIMD` (hubo un cierre forzoso del motor web) y fijar pdf.js 5.6.205.
- **Acceso a los archivos:** Rust registra el protocolo `atril://` y sirve los libros con soporte de `Range` (206). Solo sirve IDs que estén en la DB. El front recibe URLs listas para usar. **Resultado del spike (fase 1, WebKitGTK 2.52, PDF de 400 páginas / 24 MB):** pdf.js solo manda `Range` cuando la URL es http/https, así que con la URL `atril://` descargaba el archivo entero (200, 23 MiB, 827 ms para abrir). La solución adoptada es que el front alimente pdf.js con un `PDFDataRangeTransport` que hace `fetch(atril://…, Range)`: 5 peticiones 206, 0,37 MiB transferidos y 423 ms para abrir. El backend no cambia y no hace falta `read_book_range`.
- **Identidad del libro:** `id = sha256(tamaño + primer MiB + último MiB)` en hex. Mover o renombrar un archivo conserva progreso, subrayados y Salas.
- **Metadatos y portadas:** Rust detecta los archivos y los registra con el título sacado del nombre del archivo (`scan_state = pending`). Un indexador en segundo plano en el front (de uno en uno) abre cada libro pendiente con pdf.js, lee páginas, título y autor, renderiza la página 1 como **JPEG** (WebKitGTK no codifica WebP en el canvas) y llama a `save_book_scan`; Rust guarda la portada tal cual en `covers/<id>.jpg`. Así no hay que distribuir pdfium ni mupdf (AGPL).
- **Subrayados:** al seleccionar texto aparece una barra flotante con 4 pigmentos; elegir uno llama a `create_highlight` al momento (UI optimista). "Modo subrayador" (tecla H): cualquier selección se subraya directamente. Los rectángulos se guardan en **coordenadas PDF** (independientes del zoom) y se dibujan en una capa propia por página con `viewport.convertToViewportRectangle`. No se usa el editor de anotaciones de pdf.js, porque escribe en el PDF.
- **Posición de lectura:** `{page, offsetInPage 0–1, zoom, scrollMode, viewMode}` se guarda 800 ms después de dejar de moverse y también al cerrar o perder el foco. Se restaura al abrir. El % de progreso aparece en la biblioteca.
- **Noche/sepia:** filtros CSS solo sobre el canvas de las páginas (`invert + hue-rotate` / `sepia`), así funcionan también con PDF escaneados. La capa de subrayados queda fuera del filtro. El tema de la UI (oscuro / cubo blanco) es independiente.
- **Sin integración como lector del sistema** (decidido por el usuario el 2026-10-13; sustituye a "Abrir desde el sistema" de 5.B1): Atril es un lector de libros, no un visor de PDF genérico. No se registra como manejador de PDF: sin `bundle.fileAssociations`, sin "lector predeterminado" (`xdg-mime`) y sin abrir archivos pasados por argumentos ni el evento `app://open-file`. Los libros entran desde la app: carpetas de la biblioteca, "Abrir un PDF…" o soltando el archivo en la ventana. Se mantiene `tauri-plugin-single-instance`: lanzar la app otra vez enfoca la ventana abierta.

### Modelo de datos (SQLite)
- `books`: id, path, file_size, file_mtime, title, author, page_count, scan_state (`pending|done|failed`), favorite, missing, added_at, last_opened_at
- `reading_state`: book_id, page, offset_in_page, zoom, scroll_mode, view_mode, updated_at
- `highlights`: id (uuid), book_id, page, rects (JSON en coordenadas PDF), text, color, note, created_at, updated_at
- `collections` (id, name, position) + `book_collections` (book_id, collection_id): un libro puede estar en varias Salas
- `library_folders` (id, path), `settings` (key, value JSON)

## Objetivos de ligereza
Paquete de menos de 15 MB, arranque en menos de 1 s con la biblioteca, y solo se renderizan las páginas visibles.

## Backlog
Firma de código del instalador de Windows, marcadores, vista a dos páginas, estadísticas de lectura, grabar los subrayados en una copia del PDF, EPUB y sincronización entre equipos.
