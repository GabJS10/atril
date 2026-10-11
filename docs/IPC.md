# Contrato IPC (frontend ⇄ backend)

**Versión:** v0.1 (borrador). **Dueño:** `plan`. `backend` propone los cambios y `frontend` los implementa en `src/api/tauri.ts`. Un cambio que rompa el contrato se coordina antes con `plan` (ver `AGENTS.md`).

Este documento es la única fuente de verdad sobre los comandos Tauri, los eventos, las URLs del protocolo `atril://` y los tipos compartidos. Si el código y este archivo no coinciden, se corrige uno de los dos en el mismo cambio.

## Convenciones
- **Comandos:** `snake_case` en Rust (`#[tauri::command]`); desde el front, `invoke("open_book", { bookId })`.
- **Argumentos:** en `camelCase` (Tauri convierte `book_id` en `bookId`). Con más de 2 parámetros se agrupan en un objeto.
- **Payloads:** `#[serde(rename_all = "camelCase")]`. Los enums van como strings en `snake_case`.
- **Unidades:** páginas **1-based**; fechas en **ISO 8601 UTC** (`string`); tamaños en bytes (`number`).
- **IDs de libro:** huella del contenido en hex minúsculas (`sha256(tamaño + primer MiB + último MiB)`).
- **Campos opcionales en las salidas:** `T | null`, nunca `undefined` (`Option<T>` sin `skip_serializing_if`).
- **Campos opcionales en las entradas:** `campo?: T` (`Option<T>` con `#[serde(default)]`); omitido = valor por defecto.
- **URLs:** las construye siempre el backend y llegan listas para usar en pdf.js o `<img>`. El front nunca construye URLs ni maneja rutas de archivos (salvo pasar al backend la ruta que eligió el usuario en un diálogo o que soltó en la ventana).

## Errores
Todo comando devuelve `Result<T, AppError>`. Si hay error, `invoke` rechaza la promesa con:
```ts
type AppError = {
  code: ErrorCode;
  message: string; // detalle técnico en inglés; la UI muestra su propio texto según `code`
};
type ErrorCode =
  | "not_found"      // el ID no existe en la DB
  | "file_missing"   // el libro existe pero su archivo ya no está en la ruta conocida
  | "invalid_pdf"    // no es un PDF o no se puede leer
  | "invalid_input"  // argumentos inválidos
  | "io"             // error de disco
  | "db"             // error de SQLite
  | "internal";
```

## Protocolo `atril://`
| URL | Respuesta |
|---|---|
| `atril://localhost/book/<id>` | El PDF. `200` o `206` con `Range`; `Accept-Ranges: bytes`, `Content-Type: application/pdf`. `404` si el ID no existe o falta el archivo |
| `atril://localhost/cover/<id>` | La portada (`image/webp`). `404` si no hay portada |

En Windows la forma es `http://atril.localhost/…`: por eso las URLs vienen siempre del backend (`Book.fileUrl`, `Book.coverUrl`).

## Tipos compartidos
```ts
type Book = {
  id: string;
  title: string;            // de los metadatos o, si no hay, del nombre del archivo
  author: string | null;
  fileName: string;         // solo para mostrar
  pageCount: number | null; // null hasta que se indexa o se abre
  fileUrl: string;          // atril://localhost/book/<id>
  coverUrl: string | null;
  favorite: boolean;
  missing: boolean;
  scanState: "pending" | "done" | "failed";
  progress: number | null;  // 0–1; null si nunca se abrió
  addedAt: string;
  lastOpenedAt: string | null;
};

type Zoom = "page_width" | "page_fit" | "auto" | number; // número = escala (1 = 100 %)
type ViewMode = "normal" | "sepia" | "night";

type ReadingState = {
  page: number;         // 1-based
  offsetInPage: number; // 0–1: posición vertical dentro de la página
  zoom: Zoom;
  viewMode: ViewMode;
  updatedAt: string;
};

type Settings = {
  language: "system" | "es" | "en";
  theme: "dark" | "light";        // light = "cubo blanco"
  defaultZoom: Zoom;
  defaultViewMode: ViewMode;
};
type SettingsPatch = Partial<Settings>; // solo las claves presentes se cambian
```

## Comandos

### Fase 0
| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `get_settings` | — | `Settings` | `db` |
| `update_settings` | `{ patch: SettingsPatch }` | `Settings` (completos, ya actualizados) | `invalid_input`, `db` |

Valores por defecto: `language: "system"`, `theme: "dark"`, `defaultZoom: "page_width"`, `defaultViewMode: "normal"`.

### Fase 1
| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `open_path` | `{ path: string }` | `Book` (lo registra si es nuevo; si la huella ya existe con otra ruta, actualiza la ruta) | `invalid_pdf`, `io`, `db` |
| `open_book` | `{ bookId: string }` | `{ book: Book; readingState: ReadingState \| null }` (marca `lastOpenedAt`) | `not_found`, `file_missing`, `db` |
| `get_book` | `{ bookId: string }` | `Book` | `not_found`, `db` |
| `save_reading_state` | `{ bookId: string; state: { page; offsetInPage; zoom; viewMode; pageCount } }` | `null` (actualiza también `progress` y, si faltaba, `pageCount`) | `not_found`, `invalid_input`, `db` |

### Fases 2–5 (borrador, se detalla al empezar cada fase)
- Biblioteca: `get_home`, `list_books(query)`, `import_files(paths)`, `remove_book` (solo lo quita de la biblioteca, nunca borra el archivo), `set_favorite`, `update_book_metadata`, `save_book_scan(bookId, { pageCount, title?, author?, cover: bytes })`, `list_pending_scans`
- Carpetas: `list_library_folders`, `add_library_folder`, `remove_library_folder`, `rescan_library`
- Salas: `list_collections`, `create_collection`, `rename_collection`, `delete_collection`, `add_to_collection(bookIds, collectionId)`, `remove_from_collection`
- Subrayados: `list_highlights`, `create_highlight`, `update_highlight` (color o nota), `delete_highlight`, `export_highlights(bookId, destPath)`
  ```ts
  type HighlightColor = "ochre" | "sienna" | "sage" | "slate";
  type PdfRect = [number, number, number, number]; // x1, y1, x2, y2 en el espacio de usuario PDF de la página
  type Highlight = { id: string; bookId: string; page: number; rects: PdfRect[]; text: string;
                     color: HighlightColor; note: string | null; createdAt: string; updatedAt: string };
  ```
- Ajustes: `set_default_pdf_reader`

## Eventos (borrador)
| Evento | Payload | Cuándo |
|---|---|---|
| `library://changed` | `{ reason: "scan" \| "watch" \| "import" }` | Cambió la biblioteca: el front invalida sus consultas |
| `app://open-file` | `{ bookId: string }` | El sistema pidió abrir un PDF (segundo doble clic con la app abierta) |
