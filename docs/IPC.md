# Contrato IPC (frontend ⇄ backend)

**Versión:** v0.3 (borrador; fase 2 propuesta). **Dueño:** `plan`. `backend` propone los cambios y `frontend` los implementa en `src/api/tauri.ts`. Un cambio que rompa el contrato se coordina antes con `plan` (ver `AGENTS.md`).

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
| `atril://localhost/book/<id>` | El PDF. `200` sin `Range` (carga el archivo entero: evitarlo), `206` con `Range` (sirve **exactamente** el rango pedido, con `Content-Range` y `Content-Length`; solo el primer rango si piden varios), `416` si el rango es inválido. `Accept-Ranges: bytes`, `Content-Type: application/pdf`, CORS para el origen de la app con `Content-Range`, `Accept-Ranges` y `Content-Length` expuestas. `404` si el ID no existe o falta el archivo (y lo marca `missing`) |
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
  currentPage: number | null; // página guardada en reading_state (para "p. 112 de 176"); null si nunca se abrió
  progress: number | null;  // 0–1 = page / pageCount, calculado al leer; null si nunca se abrió o no hay pageCount
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
| `save_reading_state` | `{ bookId: string; state: { page; offsetInPage; zoom; viewMode; pageCount } }` | `null`. `pageCount` solo se guarda la primera vez (si el libro aún no lo tenía); después manda el valor guardado | `not_found`, `invalid_input`, `db` |

### Fase 2 (v0.3, aprobada)

**Biblioteca y consultas (2.B2)**
| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `get_home` | — | `HomeData` | `db` |
| `list_books` | `{ query: BookQuery }` (`{}` = todos los libros, por título) | `Book[]` (sin los quitados) | `invalid_input`, `db` |
| `set_favorite` | `{ bookId: string; favorite: boolean }` | `Book` | `not_found`, `db` |
| `remove_book` | `{ bookId: string }` | `null`. Solo lo quita de la biblioteca; nunca borra el archivo. Marca `removed_at` (migración 0002) en vez de borrar, así los subrayados, el progreso y las Salas vuelven si se importa el mismo archivo | `not_found`, `db` |

**Carpetas y escaneo (2.B1)**
| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `list_library_folders` | — | `LibraryFolder[]` | `db` |
| `add_library_folder` | `{ path: string }` | `LibraryFolder`. Si la carpeta ya estaba, devuelve la existente. Lanza el escaneo en segundo plano (`library://changed`, `reason: "scan"`) | `invalid_input` (no es una carpeta), `io`, `db` |
| `remove_library_folder` | `{ folderId: string }` | `null`. Deja de vigilar la carpeta; sus libros se quedan en la biblioteca | `not_found`, `db` |
| `rescan_library` | — | `null`. El resultado llega por `library://changed` | `db` |
| `get_scan_status` | — | `ScanStatus` (para pintar el estado "escaneando" al entrar en la biblioteca) | — |
| `import_files` | `{ paths: string[] }` | `ImportResult`. Cada ruta se procesa por separado; los fallos van en `rejected` y no detienen el resto | `invalid_input` (lista vacía), `db` |

**Indexador (2.B2, lo usa el front con pdf.js)**
| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `list_pending_scans` | — | `Book[]` con `scanState: "pending"` y sin `missing`, por fecha de alta | `db` |
| `save_book_scan` | Cabeceras: `X-Book-Id`, `X-Page-Count`; opcionales `X-Title`, `X-Author` (UTF-8, URL-encoded). Cuerpo binario: la portada en WebP (`invoke("save_book_scan", webpBytes, { headers })`) | `Book` (`scanState: "done"`, `coverUrl` listo). Escribe `covers/<id>.webp` con fichero temporal + renombrado | `not_found`, `invalid_input` (portada que no es WebP, de más de 2 MiB o `pageCount < 1`), `io`, `db` |
| `mark_scan_failed` | `{ bookId: string }` | `Book` (`scanState: "failed"`). Evita reintentar un PDF que pdf.js no puede leer | `not_found`, `db` |

> Por qué las cabeceras: con un cuerpo binario, Tauri no serializa la portada como un array JSON (lento). Los metadatos viajan en cabeceras, así que el comando no recibe `{ … }` como en el borrador de `PLAN.md`.

**Salas (2.B2)**
| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `list_collections` | — | `Collection[]`, en orden de `position` | `db` |
| `create_collection` | `{ name: string }` | `Collection` (al final). `name` sin espacios al borde, 1–100 caracteres | `invalid_input`, `db` |
| `rename_collection` | `{ collectionId: string; name: string }` | `Collection` | `not_found`, `invalid_input`, `db` |
| `delete_collection` | `{ collectionId: string }` | `null`. Borra la Sala, nunca los libros | `not_found`, `db` |
| `add_to_collection` | `{ bookIds: string[]; collectionId: string }` | `null`. Idempotente (un libro no se repite) | `not_found`, `db` |
| `remove_from_collection` | `{ bookIds: string[]; collectionId: string }` | `null` | `not_found`, `db` |

**Tipos de la fase 2**
```ts
type BookSort = "title" | "author" | "added" | "last_opened" | "progress";
type BookStatus = "unread" | "reading" | "finished"; // unread: sin progreso o 0; reading: 0 < progreso < 1; finished: progreso 1

type BookQuery = {
  text?: string;          // título, autor y nombre de archivo; sin distinguir mayúsculas ni acentos
  collectionId?: string;  // solo libros de esa Sala
  favoritesOnly?: boolean;
  status?: BookStatus;
  sort?: BookSort;        // por defecto "title"
  descending?: boolean;   // por defecto false
};

type HomeData = {
  continueReading: Book[]; // abiertos, progreso < 1, sin missing; por lastOpenedAt desc; máx. 8. El primero es la obra grande
  favorites: Book[];       // máx. 12, por título
  favoriteCount: number;
  bookCount: number;       // todos los libros sin quitar, missing incluidos
  collections: Collection[];
};

type Collection = {
  id: string;
  name: string;
  position: number;
  bookCount: number;
  sampleBooks: Book[];     // hasta 4 obras (por fecha de alta, sin missing) para el rótulo de la Sala
};

type ScanStatus = { running: boolean; found: number }; // found: PDFs nuevos encontrados en el escaneo en curso o el último

type LibraryFolder = { id: string; path: string; addedAt: string };

type ImportResult = {
  imported: Book[];
  rejected: { path: string; error: AppError }[];
};
```

**Notas de la pantalla "Muro de galería"**
- *Seguir leyendo* = `HomeData.continueReading`; el progreso y "p. 112 de 176" salen de `Book.progress` y `pageCount`.
- *Favoritos* = `HomeData.favorites`; "ver todo" llama a `list_books` con `favoritesOnly: true`.
- *Salas* = `HomeData.collections` con `sampleBooks` (las portadas que muestran).
- *Todos* = `list_books` con `sort`, `descending`, `status` y `text` del campo de búsqueda.
- Sin paginación: una biblioteca de cientos de libros cabe en una respuesta. Si crece, se añade `limit`/`offset` en v0.4.
- La búsqueda usa `LIKE` con normalización en Rust (sin acentos), no FTS, en esta fase.

### Fases 3–5 (borrador, se detalla al empezar cada fase)
- Carpetas y Salas: ver fase 2.
- Subrayados: `list_highlights`, `create_highlight`, `update_highlight` (color o nota), `delete_highlight`, `export_highlights(bookId, destPath)`
  ```ts
  type HighlightColor = "ochre" | "sienna" | "sage" | "slate";
  type PdfRect = [number, number, number, number]; // x1, y1, x2, y2 en el espacio de usuario PDF de la página
  type Highlight = { id: string; bookId: string; page: number; rects: PdfRect[]; text: string;
                     color: HighlightColor; note: string | null; createdAt: string; updatedAt: string };
  ```
- Metadatos: `update_book_metadata` (editar título y autor a mano; fuera del alcance de la fase 2).
- Ajustes: `set_default_pdf_reader`

## Eventos (borrador)
| Evento | Payload | Cuándo |
|---|---|---|
| `library://changed` | `{ reason: "scan" \| "watch" \| "import" }` | Cambió la biblioteca por algo que no pidió el front (escaneo de una carpeta, vigilancia, importación en segundo plano): el front invalida sus consultas. Los comandos que pide el propio front no emiten el evento; el front invalida lo suyo |
| `app://open-file` | `{ bookId: string }` | El sistema pidió abrir un PDF (segundo doble clic con la app abierta) |
