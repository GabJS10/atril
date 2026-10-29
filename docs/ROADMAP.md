# Roadmap

Fases del MVP, qué hace cada agente (con el **esfuerzo** que le asigna `plan`), y cómo se cierra cada fase. El plan completo está en [`PLAN.md`](PLAN.md).

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Andamiaje + propuestas de diseño | terminada (tag `fase-0`) |
| 1 | Lector | terminada (tag `fase-1`) |
| 2 | Biblioteca | terminada (tag `fase-2`) |
| 3 | Subrayados y notas | terminada (tag `fase-3`) |
| 4 | Lectura cómoda | terminada (tag `fase-4`) |
| 5 | Sistema y release para Linux (v1.0.0) | pendiente |

Modelo y esfuerzo: **desde el 2026-10-12 `plan` los elige por tarea** al lanzar cada subagente (ver `AGENTS.md`, «Modelo y esfuerzo»). Los niveles anotados abajo en tareas pasadas quedan como histórico.

## Fase 0. Andamiaje
**plan**
- [x] Esqueleto con create-tauri-app (react-ts), `AGENTS.md`, `CLAUDE.md`, `docs/` y CI.
- [x] Agentes en marcha en Herdr (paneles en la tab `plan`).

**frontend**
- [x] **0.F1 Propuestas de diseño, ronda 1** (`high`): leer [`DESIGN-BRIEF.md`](DESIGN-BRIEF.md) y crear en Claude Design el lienzo "Atril: propuestas" con 2–3 direcciones. Pasar el enlace a `plan`. **No** construir pantallas todavía.
- [x] **0.F2 Tooling** (`medium`): Tailwind 4 (`@tailwindcss/vite`), TanStack Router (basado en archivos, `src/routes/`) y Query, Zustand, ESLint + Prettier, Vitest + Testing Library + jsdom. Scripts `lint`, `typecheck`, `test`, `format` en `package.json` (como en YTS). Quitar la demo de la plantilla.
- [x] **0.F3 Carcasa** (`medium`): i18n es/en (`useT()`, `getT()`, idioma del sistema por defecto), rutas `/` (biblioteca, vacía) y `/read/$bookId` (lector, vacío), `src/api/tauri.ts` con `get_settings`/`update_settings` según `IPC.md`, y un test con `mockIPC`. Estilos neutros provisionales (fondo negro, texto blanco hueso) hasta que haya `DESIGN.md`.
- [x] **0.F4 Sistema de diseño** (`high`, cuando el usuario elija): ronda 2 de Claude Design, `DESIGN.md` + `PRODUCT.md`, tokens en el tema de Tailwind y fuentes empaquetadas (OFL).

**backend**
- [x] **0.B1 Base** (`medium`): dependencias (`rusqlite` con `bundled`, `thiserror`, `tracing` + `tracing-subscriber`, `dirs`, `serde`), `error.rs` (`AppError { code, message }` según `IPC.md`), rutas de datos (`~/.local/share/atril/`), `db.rs` con migraciones versionadas (todas las tablas de `PLAN.md`), `settings.rs` + comandos `get_settings`/`update_settings`. Quitar el comando `greet` de la plantilla. Ventana: título "Atril", 1280×800, mínimo 900×600, `productName` "Atril".
- [x] **0.B2 Tests base** (`medium`): migraciones sobre una DB temporal (`tempfile`), serialización de `AppError` y de `Settings` (camelCase), `cargo fmt`/`clippy -D warnings` limpios.

**Cierre:** `npm run tauri dev` arranca la carcasa, todos los checks pasan y el usuario aprobó una dirección de diseño.

## Fase 1. Lector
**backend**
- [x] **1.B1 Protocolo `atril://`** (`xhigh`): `atril://localhost/book/<id>` con `Range` (206, `Accept-Ranges`, `Content-Range`, `Content-Length`), 404 si el ID no existe o falta el archivo; `atril://localhost/cover/<id>`. Tests de Range.
- [x] **1.B2 Libros y posición** (`medium`): huella, `open_path`, `open_book`, `get_book`, `save_reading_state` (según `IPC.md`).

**frontend**
- [x] **1.F1 Spike de carga** (`high`): pdf.js abriendo `atril://…` con rangos en WebKitGTK (con el backend real). Si falla, aplicar el plan B de `PLAN.md` y avisar.
- [x] **1.F2 PdfViewer** (`xhigh`): `PDFViewer` + `EventBus` + `PDFLinkService` en React, worker de pdf.js con Vite, scroll continuo, zoom (ancho / página / %), navegación y atajos (←/→, j/k, espacio, +/−, Inicio/Fin).
- [x] **1.F3 Posición** (`xhigh`): restaurar página + desplazamiento + zoom al abrir; guardar con debounce de 800 ms y al cerrar o perder el foco.
- [x] **1.F4 Abrir archivo** (`low`): diálogo para abrir un PDF (provisional hasta la biblioteca; `tauri-plugin-dialog`).

**Cierre:** abrir un PDF de más de 300 páginas, ir a la p. 150, cerrar la app y reabrir → misma posición.

## Fase 2. Biblioteca
**backend**
- [x] **2.B1 Carpetas, escaneo y vigilancia** (`high`): `walkdir` + `notify`, archivos movidos (misma huella) o desaparecidos (`missing`), `import_files`, evento `library://changed`.
- [x] **2.B2 Consultas y Salas** (`medium`): `get_home`, `list_books`, favoritos, CRUD de Salas, `save_book_scan` + portadas en disco, `list_pending_scans`.

**frontend**
- [x] **2.F1 Indexador** (`high`): metadatos y portadas con pdf.js en segundo plano, de uno en uno.
- [x] **2.F2 Biblioteca** (`high`): muro de galería según `DESIGN.md` (Seguir leyendo, Favoritos, Salas, Todos), búsqueda y orden.
- [x] **2.F3 Salas y archivos** (`medium`): crear/renombrar/borrar Salas, añadir por menú contextual y arrastrando, soltar PDFs en la ventana, Ajustes › Carpetas.

**Cierre:** añadir una carpeta real, ver las portadas, crear una Sala y mover un archivo sin perder el progreso.

## Fase 3. Subrayados y notas
- [x] **3.B1** (`medium`): CRUD de subrayados y `export_highlights` a Markdown.
- [x] **3.F1 Geometría** (`xhigh`): selección → rectángulos en coordenadas PDF y vuelta (`geometry.ts`, con tests en varios zooms y rotaciones).
- [x] **3.F2 Subrayar** (`high`): barra de selección (4 pigmentos + nota + copiar), modo subrayador (H), capa de subrayados, editar color/nota y borrar.
- [x] **3.F3 Panel** (`medium`): panel de subrayados (clic → salta a la página) y exportar.

**Cierre:** subrayar con 3 zooms distintos y que encajen; cerrar sin "guardar" sin perder nada.

## Fase 4. Lectura cómoda
- [x] **4.F1** (`medium`): índice (outline) en panel lateral.
- [x] **4.F2** (`high`): búsqueda con Ctrl+F (`PDFFindController`).
- [x] **4.F3** (`medium`): modo noche/sepia, tema cubo blanco, pantalla completa / modo foco.
- [x] **4.B1** (`low`): campos de ajustes de lectura por defecto (`defaultZoom` y `defaultViewMode`, ya en la fase 0).

## Fase R. Motor de PDF nativo (replanteamiento, 2026-10-12)
Comparado con Okular, el lector con pdf.js en WebKitGTK no es fluido: scroll, zoom, abrir libros y, sobre todo, escaneos. El usuario decidió sustituir pdf.js por un **motor nativo en Rust** y mantener la interfaz (biblioteca, diseño, Salas, subrayados, notas, ajustes). Licencia: la que permita el motor más rápido.
- [x] **R0 · Medir (spikes sin PR):**
  - `backend`: MuPDF frente a PDFium con los libros del usuario. Apertura, render de texto y de escaneos, texto con cajas, búsqueda, memoria, render en paralelo y tamaño.
  - `frontend`: cómo mostrar las páginas en WebKitGTK (BMP en `<img>`, RGBA en canvas o JPEG): tirones de scroll, latencia y memoria.
  - `plan`: compara con Okular y **lo decide el usuario** (motor y licencia).
  - Resultado: los informes de R0.1 y R0.2 quedan en los tags `spike-r0-engines` y `spike-r0-display` (las ramas se borraron).
- [x] **R1 · Motor en Rust (`backend`):** `src-tauri/src/engine/` (documentos abiertos, pool de render con cancelación, caché LRU por bytes, precarga), comandos `open_document`, `get_page_text`, `search_document`, `get_outline` y `get_page_links`, protocolo `atril://page/<id>/<n>?scale=`, y metadatos y portadas en Rust. `IPC.md` pasa a v1.0.
- [x] **R2 · Visor nuevo (`frontend`):** visor propio virtualizado con imagen, capa de texto, subrayados y enlaces por página, y zoom en dos pasos (CSS al instante y render nítido después). Los subrayados guardados siguen valiendo (`PageMapping` desde la matriz de Rust). Búsqueda, índice y posición pasan a los comandos nuevos. Sale `pdfjs-dist`.
- [x] **R3 · Limpieza:** quitar `jpx.rs`, `POST /jpx`, `hayro-jpeg2000`, `jpxBridge.js` y el indexador del front. Actualizar los docs.
- **Objetivos (release, equipo del usuario):** primera página en menos de 300 ms; página de texto en menos de 100 ms y escaneo en menos de 400 ms; scroll sin páginas en blanco ni tirones de más de 50 ms; zoom nítido en menos de 300 ms; memoria comparable a la de Okular.
- **Cierre:** QA comparada con Okular, visto bueno del usuario y tag `fase-R`.

## Fase 5. Sistema y release para Linux
> **Pausa antes de empezar:** al cerrar la fase 4, el usuario prueba la app a fondo. No se reparte ninguna tarea de la fase 5 (salvo 5.B1, ya hecha) hasta que el usuario dé el visto bueno o pase sus observaciones.

- [x] **5.B1** (`high`): `fileAssociations`, `tauri-plugin-single-instance`, `app://open-file`, `set_default_pdf_reader` (`xdg-mime`), iconos. **Revertido en parte** (2026-10-13): el usuario decidió que Atril no sea lector de PDF del sistema (ver `PLAN.md`, "Sin integración como lector del sistema").
- [x] **5.B2** (`backend`): quitar `fileAssociations`, `set_default_pdf_reader`, `is_default_pdf_reader`, `take_pending_open_file`, la apertura por argumentos y `app://open-file`. La instancia única se queda (enfoca la ventana). `IPC.md` al día.
- [x] **5.F1** (`frontend`): quitar la tarjeta de lector predeterminado de Ajustes y pulir los estados vacíos y de error con el diseño nuevo.
- [x] **5.P1** (plan): workflow de release (.deb + AppImage), `QA.md` completo, README y CHANGELOG, **v1.0.0**.

**Cierre:** el .deb y el AppImage se instalan y arrancan limpios; Atril no aparece como lector de PDF en el sistema; QA de `QA.md` pasada y visto bueno del usuario.

## Fase W. Windows 10/11 (2026-10-15 → 2026-10-16)
- [x] **W0** (plan): job `backend-windows` en la CI.
- [x] **W1** (`backend`, Sonnet 5.5 `max`): motor y rutas en Windows, prioridad del indexador, archivos sin bloquear (≤ 16 MiB), aceleradores de WebView2, instalador NSIS (`tauri.windows.conf.json`).
- [x] **W2** (`frontend`, Haiku 5.5 `high`): atajos y menú del navegador, barras de scroll, rutas con `\`, arrastre a Salas por punteros, nombres de archivo que solo difieren en mayúsculas.
- [x] **W3** (plan): instalador de Windows en `release.yml`, control de mayúsculas en la CI, docs.
- [x] **W4** (QA del usuario): arreglos de subrayados (palabras completas, guiones de línea, cerrar la nota), aviso al fallar una carpeta, `atril.log` y diagnóstico del escaneo, y devolver los libros quitados al volver a añadir su carpeta (por huella). **v1.1.0**.

**Cierre:** el instalador se instala sin admin y arranca; QA de `QA.md` («Fase W») pasada en Windows y visto bueno del usuario.

## Backlog posterior a v1.1
- [x] **N1 · Notas: recientes primero y grupos** (2026-10-29, PR #34 y #35; falta la QA del usuario). Contrato en `IPC.md` («Grupos de subrayados»).
  - **N1.B** (`backend`, Haiku 5.5 `high`): migración 0007, CRUD de grupos, `groupId` en subrayados y export por grupos.
  - **N1.F** (`frontend`, Haiku 5.5 `high`): panel con orden «Recientes · Por página» (recientes por defecto), grupos como secciones plegables con «Sin grupo» al final, crear/renombrar/borrar grupos y selector de grupo en el editor del subrayado.

## Flujo de cada fase
1. `plan` fija el IPC de la fase en `IPC.md` (o lo encarga en la primera tarea del backend).
2. Cada tarea se hace en un worktree propio con un subagente (ver `AGENTS.md`, «Ciclo de una tarea»). Como mucho 2 a la vez; el front usa `mockIPC` hasta que el backend esté listo.
3. Cada tarea termina en un PR a `dev`. `plan` lo revisa, espera a la CI y lo fusiona en `dev` con squash.
4. `plan` pasa todos los checks en `dev` y verifica en la app real.
5. El usuario da el visto bueno → PR de `dev` a `main` (merge commit), tag `fase-N` en `main` y push.

## Definición de terminado
- `npm run lint`, `npm run typecheck` y `npm test` pasan.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` y `cargo test` pasan.
- La funcionalidad está verificada **en la app real**, no solo con mocks.
- `IPC.md` coincide con el código y la documentación tocada está al día.
