# Roadmap

Fases del MVP, qué hace cada agente (con el **esfuerzo** que le asigna `plan`), y cómo se cierra cada fase. El plan completo está en [`PLAN.md`](PLAN.md).

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Andamiaje + propuestas de diseño | en curso |
| 1 | Lector | pendiente |
| 2 | Biblioteca | pendiente |
| 3 | Subrayados y notas | pendiente |
| 4 | Lectura cómoda | pendiente |
| 5 | Sistema y release para Linux (v1.0.0) | pendiente |

Esfuerzos: `low` (renombres, textos, configs), `medium` (componente o comando con especificación clara), `high` (funciones que cruzan módulos, propuestas de diseño), `xhigh` (lo difícil) y `max` **solo para lo imprescindible** (bugs muy difíciles o tareas en las que `xhigh` ya se quedó corto).

## Fase 0. Andamiaje
**plan**
- [x] Esqueleto con create-tauri-app (react-ts), `AGENTS.md`, `CLAUDE.md`, `docs/` y CI.
- [x] Agentes en marcha en Herdr (paneles en la tab `plan`).

**frontend**
- [x] **0.F1 Propuestas de diseño, ronda 1** (`high`): leer [`DESIGN-BRIEF.md`](DESIGN-BRIEF.md) y crear en Claude Design el lienzo "Atril: propuestas" con 2–3 direcciones. Pasar el enlace a `plan`. **No** construir pantallas todavía.
- [x] **0.F2 Tooling** (`medium`): Tailwind 4 (`@tailwindcss/vite`), TanStack Router (basado en archivos, `src/routes/`) y Query, Zustand, ESLint + Prettier, Vitest + Testing Library + jsdom. Scripts `lint`, `typecheck`, `test`, `format` en `package.json` (como en YTS). Quitar la demo de la plantilla.
- [x] **0.F3 Carcasa** (`medium`): i18n es/en (`useT()`, `getT()`, idioma del sistema por defecto), rutas `/` (biblioteca, vacía) y `/read/$bookId` (lector, vacío), `src/api/tauri.ts` con `get_settings`/`update_settings` según `IPC.md`, y un test con `mockIPC`. Estilos neutros provisionales (fondo negro, texto blanco hueso) hasta que haya `DESIGN.md`.
- [ ] **0.F4 Sistema de diseño** (`high`, cuando el usuario elija): ronda 2 de Claude Design, `DESIGN.md` + `PRODUCT.md`, tokens en el tema de Tailwind y fuentes empaquetadas (OFL).

**backend**
- [x] **0.B1 Base** (`medium`): dependencias (`rusqlite` con `bundled`, `thiserror`, `tracing` + `tracing-subscriber`, `dirs`, `serde`), `error.rs` (`AppError { code, message }` según `IPC.md`), rutas de datos (`~/.local/share/atril/`), `db.rs` con migraciones versionadas (todas las tablas de `PLAN.md`), `settings.rs` + comandos `get_settings`/`update_settings`. Quitar el comando `greet` de la plantilla. Ventana: título "Atril", 1280×800, mínimo 900×600, `productName` "Atril".
- [x] **0.B2 Tests base** (`medium`): migraciones sobre una DB temporal (`tempfile`), serialización de `AppError` y de `Settings` (camelCase), `cargo fmt`/`clippy -D warnings` limpios.

**Cierre:** `npm run tauri dev` arranca la carcasa, todos los checks pasan y el usuario aprobó una dirección de diseño.

## Fase 1. Lector
**backend**
- [ ] **1.B1 Protocolo `atril://`** (`xhigh`): `atril://localhost/book/<id>` con `Range` (206, `Accept-Ranges`, `Content-Range`, `Content-Length`), 404 si el ID no existe o falta el archivo; `atril://localhost/cover/<id>`. Tests de Range.
- [ ] **1.B2 Libros y posición** (`medium`): huella, `open_path`, `open_book`, `get_book`, `save_reading_state` (según `IPC.md`).

**frontend**
- [ ] **1.F1 Spike de carga** (`high`): pdf.js abriendo `atril://…` con rangos en WebKitGTK (con el backend real). Si falla, aplicar el plan B de `PLAN.md` y avisar.
- [ ] **1.F2 PdfViewer** (`xhigh`): `PDFViewer` + `EventBus` + `PDFLinkService` en React, worker de pdf.js con Vite, scroll continuo, zoom (ancho / página / %), navegación y atajos (←/→, j/k, espacio, +/−, Inicio/Fin).
- [ ] **1.F3 Posición** (`xhigh`): restaurar página + desplazamiento + zoom al abrir; guardar con debounce de 800 ms y al cerrar o perder el foco.
- [ ] **1.F4 Abrir archivo** (`low`): diálogo para abrir un PDF (provisional hasta la biblioteca; `tauri-plugin-dialog`).

**Cierre:** abrir un PDF de más de 300 páginas, ir a la p. 150, cerrar la app y reabrir → misma posición.

## Fase 2. Biblioteca
**backend**
- [ ] **2.B1 Carpetas, escaneo y vigilancia** (`high`): `walkdir` + `notify`, archivos movidos (misma huella) o desaparecidos (`missing`), `import_files`, evento `library://changed`.
- [ ] **2.B2 Consultas y Salas** (`medium`): `get_home`, `list_books`, favoritos, CRUD de Salas, `save_book_scan` + portadas en disco, `list_pending_scans`.

**frontend**
- [ ] **2.F1 Indexador** (`high`): metadatos y portadas con pdf.js en segundo plano, de uno en uno.
- [ ] **2.F2 Biblioteca** (`high`): muro de galería según `DESIGN.md` (Seguir leyendo, Favoritos, Salas, Todos), búsqueda y orden.
- [ ] **2.F3 Salas y archivos** (`medium`): crear/renombrar/borrar Salas, añadir por menú contextual y arrastrando, soltar PDFs en la ventana, Ajustes › Carpetas.

**Cierre:** añadir una carpeta real, ver las portadas, crear una Sala y mover un archivo sin perder el progreso.

## Fase 3. Subrayados y notas
- [ ] **3.B1** (`medium`): CRUD de subrayados y `export_highlights` a Markdown.
- [ ] **3.F1 Geometría** (`xhigh`): selección → rectángulos en coordenadas PDF y vuelta (`geometry.ts`, con tests en varios zooms y rotaciones).
- [ ] **3.F2 Subrayar** (`high`): barra de selección (4 pigmentos + nota + copiar), modo subrayador (H), capa de subrayados, editar color/nota y borrar.
- [ ] **3.F3 Panel** (`medium`): panel de subrayados (clic → salta a la página) y exportar.

**Cierre:** subrayar con 3 zooms distintos y que encajen; cerrar sin "guardar" sin perder nada.

## Fase 4. Lectura cómoda
- [ ] **4.F1** (`medium`): índice (outline) en panel lateral.
- [ ] **4.F2** (`high`): búsqueda con Ctrl+F (`PDFFindController`).
- [ ] **4.F3** (`medium`): modo noche/sepia, tema cubo blanco, pantalla completa / modo foco.
- [ ] **4.B1** (`low`): campos de ajustes de lectura por defecto.

## Fase 5. Sistema y release para Linux
- [ ] **5.B1** (`high`): `fileAssociations`, `tauri-plugin-single-instance`, `app://open-file`, `set_default_pdf_reader` (`xdg-mime`), iconos.
- [ ] **5.F1** (`medium`): abrir el libro recibido por `app://open-file`, botón de lector predeterminado, pulido de estados vacíos y de error.
- [ ] **5.P1** (plan): workflow de release (.deb + AppImage), `QA.md` completo, README y CHANGELOG, **v1.0.0**.

**Cierre:** hacer doble clic en un PDF desde Nemo abre Atril; el .deb se instala limpio.

## Flujo de cada fase
1. `plan` y `backend` fijan el IPC de la fase en `IPC.md`.
2. Los dos agentes trabajan en paralelo; el front usa `mockIPC` hasta que el backend esté listo.
3. Cada agente hace commit de sus rutas y avisa a `plan`.
4. `plan` integra, pasa todos los checks y verifica en la app real (`npm run tauri dev`).
5. El usuario da el visto bueno → commit de cierre y tag `fase-N` (y push cuando exista el repo remoto).

## Definición de terminado
- `npm run lint`, `npm run typecheck` y `npm test` pasan.
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` y `cargo test` pasan.
- La funcionalidad está verificada **en la app real**, no solo con mocks.
- `IPC.md` coincide con el código y la documentación tocada está al día.
