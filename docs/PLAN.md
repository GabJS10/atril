# Atril: lector de PDF minimalista con biblioteca

## Contexto
El usuario lee sus libros en PDF con el visor de Firefox, que no termina de convencerle, y Okular tampoco le gusta. La idea es una app de escritorio propia, **minimalista y ligera**, pensada para leer libros:
- Una **biblioteca** como pantalla de inicio: seguir leyendo, favoritos y colecciones ("Salas").
- **Recordar la posición** exacta de cada libro.
- **Subrayados que se guardan solos** al crearlos.
- Modo noche/sepia, índice y búsqueda, notas exportables, y abrir los PDF desde el sistema.

Estética: "museo de arte de noche", monocroma (ver [`DESIGN-BRIEF.md`](DESIGN-BRIEF.md)). Forma de trabajo: 3 agentes en Herdr (ver [`AGENTS.md`](../AGENTS.md)) y fases en [`ROADMAP.md`](ROADMAP.md).

## Decisiones tomadas
| Tema | Decisión |
|---|---|
| Nombre | **Atril**, con identificador `io.github.gabjs10.atril` |
| Stack | Tauri 2 + React 19 + TS + Vite + Tailwind 4 + TanStack Router/Query + Zustand; Rust con rusqlite |
| Render | **pdf.js 6.x** (el motor de Firefox) con sus componentes de visor; la UI es propia |
| Subrayados | En la SQLite de la app. **El PDF original nunca se modifica** |
| Importar | Carpetas vigiladas + archivos sueltos. Los archivos se quedan donde están y se reconocen por su contenido |
| MVP extra | Modo noche/sepia, índice + búsqueda, notas + exportar a Markdown, abrir los PDF desde el sistema |
| Plataformas | Linux primero (.deb + AppImage; WebKitGTK 2.52). Windows queda en el backlog |
| Idioma de la UI | Español e inglés (`src/i18n/es.ts` y `en.ts`); por defecto sigue al sistema |
| Agentes | `frontend` y `backend` en Haiku 5.5, con el esfuerzo por tarea que asigna `plan` (tope `xhigh`) |
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
- **Acceso a los archivos:** Rust registra el protocolo `atril://` y sirve los libros con soporte de `Range` (206) para que los PDF grandes abran rápido. Solo sirve IDs que estén en la DB. El front recibe URLs listas para usar. **Spike en la fase 1:** comprobar la carga por rangos de pdf.js sobre un esquema propio en WebKitGTK. Plan B: `PDFDataRangeTransport` + un comando `read_book_range` que devuelve binario (`tauri::ipc::Response`).
- **Identidad del libro:** `id = sha256(tamaño + primer MiB + último MiB)` en hex. Mover o renombrar un archivo conserva progreso, subrayados y Salas.
- **Metadatos y portadas:** Rust detecta los archivos y los registra con el título sacado del nombre del archivo (`scan_state = pending`). Un indexador en segundo plano en el front (de uno en uno) abre cada libro pendiente con pdf.js, lee páginas, título y autor, renderiza la página 1 como WebP y llama a `save_book_scan`; Rust guarda la portada en `covers/<id>.webp`. Así no hay que distribuir pdfium ni mupdf (AGPL).
- **Subrayados:** al seleccionar texto aparece una barra flotante con 4 pigmentos; elegir uno llama a `create_highlight` al momento (UI optimista). "Modo subrayador" (tecla H): cualquier selección se subraya directamente. Los rectángulos se guardan en **coordenadas PDF** (independientes del zoom) y se dibujan en una capa propia por página con `viewport.convertToViewportRectangle`. No se usa el editor de anotaciones de pdf.js, porque escribe en el PDF.
- **Posición de lectura:** `{page, offsetInPage 0–1, zoom, scrollMode, viewMode}` se guarda 800 ms después de dejar de moverse y también al cerrar o perder el foco. Se restaura al abrir. El % de progreso aparece en la biblioteca.
- **Noche/sepia:** filtros CSS solo sobre el canvas de las páginas (`invert + hue-rotate` / `sepia`), así funcionan también con PDF escaneados. La capa de subrayados queda fuera del filtro. El tema de la UI (oscuro / cubo blanco) es independiente.
- **Abrir desde el sistema:** `bundle.fileAssociations` (pdf, `application/pdf`) en `tauri.conf.json` + `tauri-plugin-single-instance`: un segundo doble clic manda el archivo a la ventana abierta (evento `app://open-file`). Ajustes tiene un botón "Usar Atril como lector predeterminado" (`xdg-mime default`).

### Modelo de datos (SQLite)
- `books`: id, path, file_size, file_mtime, title, author, page_count, scan_state (`pending|done|failed`), favorite, missing, added_at, last_opened_at
- `reading_state`: book_id, page, offset_in_page, zoom, scroll_mode, view_mode, updated_at
- `highlights`: id (uuid), book_id, page, rects (JSON en coordenadas PDF), text, color, note, created_at, updated_at
- `collections` (id, name, position) + `book_collections` (book_id, collection_id): un libro puede estar en varias Salas
- `library_folders` (id, path), `settings` (key, value JSON)

## Objetivos de ligereza
Paquete de menos de 15 MB, arranque en menos de 1 s con la biblioteca, y solo se renderizan las páginas visibles.

## Backlog
Windows, marcadores, vista a dos páginas, estadísticas de lectura, grabar los subrayados en una copia del PDF, EPUB y sincronización entre equipos.
