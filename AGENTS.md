# AGENTS.md

Guía para agentes de IA (y personas) que trabajen en este repositorio.

## Proyecto
**Atril**: lector de PDF de escritorio, minimalista y ligero, pensado para leer libros. Tiene una biblioteca como pantalla de inicio (seguir leyendo, favoritos y colecciones, llamadas "Salas"), recuerda la posición exacta de cada libro y guarda los subrayados solos al crearlos (en SQLite: **el PDF original nunca se modifica**). Además: modo noche/sepia, índice, búsqueda, notas exportables a Markdown y abrir los PDF desde el sistema.

- Plan completo y decisiones de arquitectura: [`docs/PLAN.md`](docs/PLAN.md)
- Roadmap por fases (qué hace cada agente, con qué esfuerzo y criterios de cierre): [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Contrato IPC frontend ⇄ backend: [`docs/IPC.md`](docs/IPC.md)
- Brief de diseño ("museo de arte de noche"): [`docs/DESIGN-BRIEF.md`](docs/DESIGN-BRIEF.md). El sistema de diseño definitivo irá en `DESIGN.md` y el contexto de producto en `PRODUCT.md` (los escribe `frontend` cuando el usuario elija una propuesta)
- QA manual por fase: [`docs/QA.md`](docs/QA.md)

**Estado actual:** fases 0 a 4 cerradas (tags `fase-0` a `fase-4`). **Pausa de pruebas del usuario:** no se empieza la fase 5 hasta su visto bueno. El backend tiene hechas sus tareas hasta la fase 5.

## Forma de trabajo (multi-agente)
El proyecto se desarrolla con **3 agentes en paralelo**, cada uno en un panel de la misma tab (`plan`) del workspace `atril` de [Herdr](https://herdr.dev): `plan` a la izquierda, `frontend` arriba a la derecha y `backend` abajo a la derecha. **Este `AGENTS.md` es la fuente de verdad**; `CLAUDE.md` solo lo importa.

| Agente (nombre en Herdr) | Panel | Responsabilidad | Es dueño de |
|---|---|---|---|
| `plan` | izquierda | Orquestación, planificación, decisiones de arquitectura, contrato IPC, tareas comunes (CI, E2E, empaquetado, releases) | `docs/`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `.github/`, `e2e/`, configs de la raíz no específicas del front |
| `frontend` | arriba a la derecha | UI en React, diseño (propuestas en Claude Design), visor pdf.js, estado del cliente y wrappers de `invoke()` | `src/`, `public/`, `DESIGN.md`, `PRODUCT.md`, `index.html`, `vite.config.*`, `tsconfig*.json`, configs de ESLint/Prettier/Vitest, `package.json` y `package-lock.json` |
| `backend` | abajo a la derecha | Core en Rust: biblioteca (escaneo, vigilancia, huella), protocolo `atril://`, SQLite, subrayados, ajustes, comandos Tauri e integración con el sistema | `src-tauri/` (incluye `Cargo.toml`, `tauri.conf.json` y `capabilities/`) |

### Modelo y esfuerzo
- `frontend` y `backend` corren en **Haiku 5.5** (`claude-haiku-5-5`). `plan` asigna el esfuerzo de cada tarea según su dificultad (`low`, `medium`, `high` o `xhigh`; **`max` solo cuando de verdad haga falta**: bugs muy difíciles o tareas en las que `xhigh` ya se quedó corto) y lo cambia con `/effort <nivel>` antes de mandarla. El nivel de cada tarea figura en `docs/ROADMAP.md`.
- Si una tarea resulta más difícil de lo previsto, no la fuerces: avisa a `plan` (puede subir el esfuerzo o partirla).

### Reglas de coordinación
- **Cada agente edita solo sus archivos.** Si necesitas un cambio en otra área, pídeselo a su dueño (o a `plan`) en lugar de hacerlo tú. Excepción: una dependencia npm que pida `backend` (p. ej. un plugin de Tauri) la añade `frontend`.
- **Commits sin la línea `Co-Authored-By: Claude …`** ni ninguna otra atribución a Claude (pedido del usuario). Mensajes en inglés, Conventional Commits con el scope del agente: `feat(frontend): …`, `feat(backend): …`, `docs: …`, `chore(ci): …`.
- **Nada de `git stash`, `git checkout -- .`, `git reset --hard`, `git clean` ni comandos que toquen todo el árbol:** el árbol de trabajo es compartido y los otros agentes tienen cambios sin commitear. Para hacer commit, usa `git add <tus rutas>` (nunca `git add -A` ni `git add .`) y **`git commit -m "…" -- <tus rutas>`**: el índice es compartido y un `git commit` sin rutas se lleva lo que otro agente haya dejado preparado.
- **Contrato IPC en `docs/IPC.md`:** comandos Tauri (nombre, parámetros, retorno y errores), eventos y URLs del protocolo `atril://`. `backend` lo propone o actualiza al crear o cambiar un comando (pidiéndoselo a `plan`, que es el dueño del archivo), y `frontend` lo implementa en `src/api/tauri.ts`. Un cambio que rompa el contrato se coordina antes con `plan`.
- **Mientras el backend no esté listo, el frontend trabaja contra `mockIPC`** (`@tauri-apps/api/mocks`) siguiendo `IPC.md` al pie de la letra.
- **`plan` reparte el trabajo** siguiendo `docs/ROADMAP.md`.
- **Al terminar una tarea o quedar bloqueado, avisa a `plan` por Herdr** (no basta con escribir el reporte en tu pantalla: `plan` no la está mirando). Último paso obligatorio, después del commit:
  ```bash
  herdr agent prompt plan "<agente>: <tarea> lista, commit <hash>. <notas breves o 'bloqueado: motivo'>"
  ```
  Sin `--wait`. Después comprueba con `herdr agent get plan` que el mensaje llegó (si `plan` estaba ocupado, queda en cola y lo procesa al terminar).
- Comunicación entre agentes con la CLI de Herdr, usando el nombre del agente (no el ID del pane):
  ```bash
  herdr agent list
  herdr agent prompt backend "..." --wait --timeout 600000
  herdr agent read frontend --source recent-unwrapped --lines 120
  ```
- No mandes un prompt a un agente que está `working` o `blocked` sin revisar antes su estado (`herdr agent get <nombre>`). Excepción: el aviso de "terminé / bloqueado" a `plan` se manda siempre.
- No cierres ni muevas paneles de otros agentes. Los push, tags y releases los hace `plan`.
- Decisiones de arquitectura nuevas: las registra `plan` en `docs/PLAN.md`.

## Stack
- **Escritorio:** Tauri 2
- **Frontend:** React 19 + TypeScript (strict) + Vite, Tailwind 4, TanStack Router (rutas basadas en archivos, `src/routes/`), TanStack Query (datos del backend), Zustand (estado de UI)
- **Visor PDF:** `pdfjs-dist` 6.x con sus componentes de visor (`pdfjs-dist/web/pdf_viewer.mjs`: `PDFViewer`, `EventBus`, `PDFLinkService`, `PDFFindController`). La UI alrededor es propia
- **Backend (Rust):** `rusqlite` (persistencia), `walkdir` + `notify` (escaneo y vigilancia de carpetas), `sha2` (huella), `thiserror`, `tracing`, `dirs`, `tokio`
- **Plataformas:** Linux (WebKitGTK) primero; Windows 10/11 en el backlog

## Estructura (prevista)
```
src/                       # Frontend React
  api/tauri.ts             # wrappers tipados de invoke(); único punto de contacto con Rust
  routes/                  # __root, index (biblioteca), collection.$id, read.$bookId, settings
  reader/                  # PdfViewer, HighlightLayer, SelectionToolbar, OutlinePanel, SearchBar, HighlightsPanel, geometry.ts
  library/                 # BookCard, Shelf, CollectionList, indexer.ts
  i18n/                    # es.ts, en.ts
  store/
src-tauri/src/
  lib.rs                   # setup, registro de comandos, protocolo y estado compartido
  commands.rs              # #[tauri::command]
  error.rs                 # AppError { code, message }
  db.rs (+ migrations/)    # SQLite + migraciones
  library.rs               # escaneo, vigilancia, huella, importación
  protocol.rs              # atril://book/<id> (Range) y atril://cover/<id>
  highlights.rs            # CRUD + exportar a Markdown
  settings.rs
docs/                      # documentación del proyecto (dueño: plan)
```

## Comandos
```bash
npm install                  # dependencias del frontend
npm run tauri dev            # app en modo desarrollo
npm run tauri build          # empaquetado (.deb / AppImage)
npm run lint && npm run typecheck && npm test
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```
Dependencias del sistema (Ubuntu/Mint): `libwebkit2gtk-4.1-dev build-essential libssl-dev librsvg2-dev libayatana-appindicator3-dev libxdo-dev` (ya instaladas en el equipo del usuario).

## Reglas y convenciones
- **Toda la E/S de disco va en Rust.** El frontend solo llama a comandos Tauri (vía `src/api/tauri.ts`) y escucha eventos. pdf.js lee los libros desde las URLs `atril://…` que devuelve el backend; **el front nunca construye URLs ni maneja rutas de archivos** (salvo pasar al backend la ruta que eligió el usuario en un diálogo o que soltó en la ventana).
- **Todo `getDocument` de pdf.js pasa por `openPdfByRanges` (`src/reader/pdfLoader.ts`),** que es quien le da los rangos por `atril://` y las URLs de los recursos de pdf.js (wasm, cmaps, fuentes estándar, ICC). No llames a `getDocument` en otro sitio.
- **El PDF original nunca se modifica.** Los archivos se abren en solo lectura. Subrayados, notas, progreso y colecciones viven en SQLite.
- **Identidad de un libro = huella de su contenido** (`sha256(tamaño + primer MiB + último MiB)`, hex): mover o renombrar un archivo conserva su progreso, subrayados y Salas.
- El protocolo `atril://` **solo sirve IDs que estén en la base de datos**, nunca rutas arbitrarias.
- Datos de usuario en `~/.local/share/atril/` (`atril.db`, `covers/`). En Windows, `%LOCALAPPDATA%\atril\`.
- Errores en Rust con `thiserror`; los comandos devuelven `Result<T, AppError>` (`{ code, message }`, ver `docs/IPC.md`). Nada de `unwrap()`/`expect()` en caminos de producción.
- TypeScript en modo `strict`. Componentes funcionales y hooks.
- **Diseño:** nada de colores, tamaños ni fuentes sueltos en los componentes: todo sale de los tokens de `DESIGN.md` / tema de Tailwind. La UI es monocroma; el único color con función son los pigmentos de los subrayados. Las fuentes van empaquetadas en la app (sin Google Fonts en tiempo de ejecución).
- La UI está en **español e inglés** (por defecto sigue al sistema, con selector en Ajustes). Todo texto visible va en `src/i18n/es.ts` y `src/i18n/en.ts`, nunca literal en los componentes. Identificadores y comentarios de código en inglés.
- `README.md`, `CHANGELOG.md` y las notas de las releases van en **inglés**. La documentación interna (`docs/`, `AGENTS.md`) va en español.
- Tests: PDFs pequeños generados como fixtures (nunca libros con copyright en el repo), migraciones en una DB temporal, huella estable al mover/renombrar, `Range` → 206, ida y vuelta de coordenadas de subrayados (PDF ⇄ viewport) con varios zooms.
- Mantener `docs/PLAN.md` y `docs/IPC.md` al día si cambian las decisiones o el contrato.
- **Cierra lo que arrancas:** al terminar una verificación, para `npm run tauri dev`, vite, la app y cualquier Xvfb que hayas lanzado (y comprueba que el puerto 1420 queda libre). Usa un `XDG_DATA_HOME` temporal para no dejar libros de prueba en los datos reales del usuario (`~/.local/share/atril/`).
- **Esperar procesos y logs sin colgarse:** los bucles `until grep …` llevan siempre un tiempo máximo (`timeout 300 bash -c '…'`). Para buscar texto en salidas de cargo/tauri/vite, desactiva los colores (`NO_COLOR=1 CARGO_TERM_COLOR=never`) o quita los códigos ANSI (`sed 's/\x1b\[[0-9;]*m//g'`).
