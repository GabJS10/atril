# AGENTS.md

Guía para agentes de IA (y personas) que trabajen en este repositorio.

## Proyecto
**Atril**: lector de PDF de escritorio, minimalista y ligero, pensado para leer libros. Tiene una biblioteca como pantalla de inicio (seguir leyendo, favoritos y colecciones, llamadas "Salas"), recuerda la posición exacta de cada libro y guarda los subrayados solos al crearlos (en SQLite: **el PDF original nunca se modifica**). Además: modo noche/sepia, índice, búsqueda, notas exportables a Markdown y abrir los PDF desde el sistema.

- Plan completo y decisiones de arquitectura: [`docs/PLAN.md`](docs/PLAN.md)
- Roadmap por fases (qué hace cada agente, con qué esfuerzo y criterios de cierre): [`docs/ROADMAP.md`](docs/ROADMAP.md)
- Arquitectura (módulos, hilos, flujos; se actualiza con cada cambio estructural): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Contrato IPC frontend ⇄ backend: [`docs/IPC.md`](docs/IPC.md)
- Brief de diseño ("museo de arte de noche"): [`docs/DESIGN-BRIEF.md`](docs/DESIGN-BRIEF.md). El sistema de diseño definitivo irá en `DESIGN.md` y el contexto de producto en `PRODUCT.md` (los escribe `frontend` cuando el usuario elija una propuesta)
- QA manual por fase: [`docs/QA.md`](docs/QA.md)

**Estado actual:** fases 0 a 4 cerradas (tags `fase-0` a `fase-4`). Tras la pausa de pruebas, el usuario pidió replantear el lector porque pdf.js en WebKitGTK no es lo bastante fluido: **fase R**, que sustituye pdf.js por un motor de PDF nativo en Rust y mantiene la misma interfaz (ver `docs/ROADMAP.md`). La fase 5 viene después.

## Forma de trabajo: subagentes + worktrees + pull requests
`plan` (la sesión principal de Claude Code) orquesta. Cada tarea la hace un **subagente** que trabaja en su propio **worktree de git** (una carpeta aparte con su propia rama) y la entrega como **pull request**. **Este `AGENTS.md` es la fuente de verdad**; `CLAUDE.md` solo lo importa, y los roles de los subagentes están en `.claude/agents/`.

| Rol | Responsabilidad | Es dueño de |
|---|---|---|
| `plan` | Orquestación, planificación, decisiones de arquitectura, contrato IPC, revisión y fusión de PRs, tareas comunes (CI, E2E, empaquetado, releases) | `docs/`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `README.md`, `CHANGELOG.md`, `.github/`, `e2e/`, configs de la raíz no específicas del front |
| `frontend` (`.claude/agents/frontend.md`) | UI en React, diseño, visor, estado del cliente y wrappers de `invoke()` | `src/`, `public/`, `DESIGN.md`, `PRODUCT.md`, `index.html`, `vite.config.*`, `tsconfig*.json`, configs de ESLint/Prettier/Vitest, `package.json` y `package-lock.json` |
| `backend` (`.claude/agents/backend.md`) | Core en Rust: biblioteca, protocolo `atril://`, motor de PDF, SQLite, subrayados, ajustes, comandos Tauri e integración con el sistema | `src-tauri/` (incluye `Cargo.toml`, `tauri.conf.json` y `capabilities/`) |

### Ramas
- **`dev`** es la rama de desarrollo: los worktrees salen de `dev` y todos los PR van a `dev`.
- **`main`** es la rama de releases. Recibe `dev` solo al cerrar una fase o una release, con un PR de `dev` a `main` fusionado con **merge commit** (no squash), para que las dos ramas no diverjan. Los tags `fase-N` van en `main`.

### Ciclo de una tarea
1. **Worktree:** `plan` lo crea a partir de `dev` actualizado: `git worktree add .claude/worktrees/<tema> -b <fase>/<tema>` (p. ej. rama `r1/motor`, carpeta `/home/gabriel/datos/projects/atril/.claude/worktrees/r1-motor`). La carpeta `.claude/worktrees/` está ignorada por git, ESLint, Prettier y el vigilante de Vite.
2. **Encargo:** `plan` lanza el subagente con un encargo autocontenido: carpeta del worktree, contexto, archivos, criterios de aceptación, checks y si puede lanzar la app.
3. **Trabajo:** el subagente trabaja solo en su worktree, pasa los checks, hace commit en su rama, `git push -u` y abre el PR con `gh pr create`. Su informe final es la respuesta que recibe `plan`.
4. **Revisión:** `plan` revisa el diff del PR, espera a la CI y pasa los checks en local. Las correcciones se piden al **mismo** subagente, que conserva su contexto, en vez de lanzar otro. El usuario puede revisar el PR en GitHub.
5. **Fusión:** `plan` fusiona con `gh pr merge --squash --delete-branch` (título del PR en Conventional Commits), actualiza `dev` en local y borra el worktree (`git worktree remove`).

Los spikes de medición van en un worktree **sin PR**: solo dejan un informe.

### Modelo y esfuerzo
- `plan` elige **modelo y esfuerzo por tarea** al lanzar cada subagente, para ahorrar tokens sin perder rendimiento:
  - **Haiku 5.5**, el modelo por defecto, para tareas bien acotadas: implementar con un contrato claro, tests, docs y cambios mecánicos. Esfuerzo `medium` en lo trivial, `high` en lo normal y `max` en lo complejo.
  - **Sonnet 5.5** para depuración difícil o entre capas, investigación de rendimiento, diseño de piezas centrales o cuando un agente en Haiku se atasca. Esfuerzo `high` o `max`.

### Reglas de coordinación
- **Cada agente edita solo sus archivos** (tabla de arriba), salvo que el encargo diga otra cosa. Excepción: una dependencia npm que necesite `backend` (p. ej. un plugin de Tauri) la añade `frontend`.
- **Cada subagente trabaja solo en su worktree.** Nunca toca `/home/gabriel/datos/projects/atril`, que es la carpeta principal (rama `dev`) y donde trabajan `plan` y el usuario, ni otros worktrees.
- **Commits y PRs sin la línea `Co-Authored-By: Claude …`** ni ninguna otra atribución a Claude (pedido del usuario). Mensajes de commit en inglés; **PRs en español** (título con prefijo Conventional Commits, p. ej. `feat(engine): búsqueda por eventos`; descripción en español). Conventional Commits con scope: `feat(frontend): …`, `feat(backend): …`, `docs: …`, `chore(ci): …`.
- **Límites del equipo** (7 GB de RAM y disco justo):
  - como mucho **2 subagentes a la vez**;
  - todos los comandos de cargo y tauri llevan delante **`CARGO_TARGET_DIR=/home/gabriel/datos/projects/atril/.claude/worktrees/.target`** (compilación de Rust compartida por todos los worktrees);
  - **un solo agente ejecuta la app a la vez** (puerto 1420), y lo indica el encargo.
- **Contrato IPC en `docs/IPC.md`:** comandos Tauri (nombre, parámetros, retorno y errores), eventos y URLs del protocolo `atril://`. Si un encargo lo cambia, el agente actualiza `IPC.md` en su rama y `plan` lo revisa en el PR. El frontend lo implementa en `src/api/tauri.ts`.
- **Mientras el backend no esté listo, el frontend trabaja contra `mockIPC`** (`@tauri-apps/api/mocks`) siguiendo `IPC.md` al pie de la letra.
- Los push a `dev` y a `main`, las fusiones, los tags y las releases los hace `plan`. Sus propios cambios de docs y de proceso (`docs/`, `AGENTS.md`, `.claude/`) van directos a `dev`, sin PR, y llegan a `main` con el siguiente PR de release.
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
- **JPEG 2000 lo decodifica Rust, no pdf.js.** `src/reader/jpxBridge.js` se sirve como `/pdfjs/wasm/openjpeg_nowasm_fallback.js` y manda cada imagen JPX a `POST atril://localhost/jpx` (`src-tauri/src/jpx.rs`, `hayro-jpeg2000`). Si el backend responde 422, decodifica con el respaldo JS original de pdf.js. No vuelvas a servir `openjpeg.wasm`: el build falla si aparece. Al actualizar pdf.js, revisa que la interfaz del módulo de respaldo (`_jp2_decode`, `imageData`…) no haya cambiado.
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
