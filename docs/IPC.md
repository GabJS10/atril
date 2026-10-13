# Contrato IPC (frontend ⇄ backend)

**Versión:** v0.8 (texto con cajas, búsqueda por eventos, índice y enlaces son de la v0.8; el motor nativo, `open_document` y `GET /page/…`, es de la v0.7; la ruta `POST /jpx` es de la v0.6). **Dueño:** `plan`. `backend` propone los cambios y `frontend` los implementa en `src/api/tauri.ts`. Un cambio que rompa el contrato se coordina antes con `plan` (ver `AGENTS.md`).

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
| `atril://localhost/cover/<id>` | La portada, con su `Content-Type` real (`image/jpeg` o `image/webp`, según la firma del archivo guardado). `404` si no hay portada |
| `GET atril://localhost/page/<id>/<n>?scale=<f>` | La página `n` (1-based) del libro renderizada por el motor nativo (MuPDF), como `image/jpeg` (calidad 85). `scale` = píxeles por punto PDF (1 = 72 ppp), por defecto `1`, de `0.1` a `8`; se cuantiza a centésimas. El front **no construye la URL**: `open_document` devuelve la base `pageBaseUrl` y el front añade `/<n>?scale=<f>`. `Cache-Control: private, max-age=3600`. `400` si `scale` no es válido; `404` si el ID o la forma de la ruta no son válidos, el libro no existe, falta el archivo (lo marca `missing`) o `n` está fuera del libro; `410` si la petición quedó superada por otra zona o por un cambio de escala (ver "Motor de PDF (v0.7)"); `422` si el PDF no se puede leer; `500` si falla el render. Detalle en "Motor de PDF (v0.7)" |
| `POST atril://localhost/jpx?components=N&indexed=0\|1&smask=0\|1&reduce=R` | Decodifica un JPX (JP2 o codestream) que va en el cuerpo y devuelve los píxeles. `200` con `application/octet-stream` y las cabeceras `X-Jpx-Width`, `X-Jpx-Height`, `X-Jpx-Channels`; `422` con el motivo en texto; `400` si la query no es válida; `413` si el cuerpo pasa de 64 MiB. Detalle en "JPX (v0.6)" |

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

**Indexador (2.B2; desde R1.3 el front no recibe pendientes, ver abajo)**
| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `list_pending_scans` | — | `Book[]`. **Desde R1.3 siempre `[]`**: el indexador nativo (ver abajo) procesa los pendientes, así que el front no recibe ninguno y no hay dos indexadores sobre el mismo libro. Antes devolvía los `scanState: "pending"` sin `missing`. Se borra en R2 junto con el indexador de pdf.js | — |
| `save_book_scan` | Cabeceras: `X-Book-Id`, `X-Page-Count`; opcionales `X-Title`, `X-Author` (UTF-8, URL-encoded). Cuerpo binario: la portada en **JPEG** (o WebP), detectada por su firma (`invoke("save_book_scan", coverBytes, { headers })`). El front genera JPEG porque WebKitGTK no codifica WebP en `canvas.toBlob` | `Book` (`scanState: "done"`, `coverUrl` listo). Guarda los bytes tal cual en `covers/<id>.jpg` (o `.webp`), con fichero temporal + renombrado, y borra la portada anterior con la otra extensión | `not_found`, `invalid_input` (portada que no es JPEG ni WebP, de más de 2 MiB o `pageCount < 1`), `io`, `db` |
| `mark_scan_failed` | `{ bookId: string }` | `Book` (`scanState: "failed"`). Evita reintentar un PDF que pdf.js no puede leer | `not_found`, `db` |

> Por qué las cabeceras: con un cuerpo binario, Tauri no serializa la portada como un array JSON (lento). Los metadatos viajan en cabeceras, así que el comando no recibe `{ … }` como en el borrador de `PLAN.md`.
>
> `save_book_scan` y `mark_scan_failed` siguen funcionando hasta R2, aunque el front ya no reciba pendientes.

**Indexador nativo (R1.3, `src-tauri/src/indexer.rs`)**

Sustituye al indexador de pdf.js para los libros con `scanState: "pending"` y sin `missing`. Procesa uno a uno, en un hilo propio (`atril-indexer`) con su propia copia del documento de MuPDF. Ese hilo baja su prioridad (nice 19 en Linux) y no empieza un libro mientras haya renders del visor en cola, para no retrasar las páginas del lector.

- **Cuándo se ejecuta:** al arrancar la app; tras cada escaneo de carpetas (también el de vigilancia); tras `import_files` si entró algún libro; al abrir un PDF desde el sistema con la app ya abierta; y cada 30 s por si entra un libro por otra vía.
- **Qué hace con cada libro:**
  - si el archivo falta: `missing = 1`;
  - si MuPDF no lo puede abrir o no tiene páginas: `scanState: "failed"` (no se reintenta);
  - si no: número de páginas, título y autor (limpios como `cleanMetadataText` del front: espacios colapsados, sin basura como "Microsoft Word…", nombres de archivo, "Anónimo" o solo símbolos y dígitos, y como mucho 200 caracteres; si no vale, el título se queda con el nombre del archivo), y la portada: la página 1 a 400 px de ancho, JPEG (calidad 85). Se guarda como `save_book_scan` (`covers/<id>.jpg`, fichero temporal + renombrado) y el libro pasa a `scanState: "done"`.
- **Un libro no se reintenta en el mismo proceso.** Si no se puede guardar (error de base de datos o de disco) queda pendiente hasta reiniciar la app.
- **Evento:** por cada libro indexado con éxito se emite `library://changed` con `reason: "index"` (ver "Eventos"). El payload no lleva el libro: el front vuelve a pedir la biblioteca.

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

### Motor de PDF (v0.7): render nativo con MuPDF
| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `open_document` | `{ bookId: string }` | `OpenedDocument` | `invalid_input` (ID sin forma de huella), `not_found`, `file_missing` (y marca el libro como `missing`), `invalid_pdf` (no es un PDF, está cifrado o está roto), `io`, `internal` |

```ts
type OpenedDocument = {
  pageCount: number;
  pageBaseUrl: string;     // atril://localhost/page/<bookId>  (en Windows, http://atril.localhost/page/<bookId>)
  pages: PageGeometry[];   // pageCount entradas, en orden (índice 0 = página 1)
};
type PageGeometry = {
  width: number;           // ancho en puntos a escala 1, YA ROTADO por /Rotate (= viewport.width de pdf.js a scale 1)
  height: number;          // alto en puntos a escala 1, ya rotado
  transform: [number, number, number, number, number, number]; // espacio de usuario PDF -> píxeles del visor a escala 1
};
```

**`transform` es idéntico a `page.getViewport({ scale: 1 }).transform` de pdf.js** (mismo algoritmo: `/CropBox` recortada a la `/MediaBox`, `/Rotate` heredado y normalizado, `/UserUnit`; Letter si falta la `/MediaBox`). Los subrayados siguen guardados en espacio de usuario PDF (origen abajo-izquierda) y el front los convierte con esta matriz como hasta ahora (`PageMapping` de `src/reader/geometry.ts`): para escala `s`, `convertToViewportPoint(x, y) = (s·(a·x + c·y + e), s·(b·x + d·y + f))` con `[a, b, c, d, e, f] = transform`, y la inversa para `convertToPdfPoint`. La imagen de una página a escala `s` mide `ceil(width·s) × ceil(height·s)` píxeles (si `s` produciría más de 32 Mpx o más de 16 384 px por lado, el motor reduce la escala y la imagen sale más pequeña: el front la estira al recuadro `width·s × height·s`).

**Páginas.** El front construye cada URL como `` `${pageBaseUrl}/${n}?scale=${scale}` `` (n 1-based) y la pone en un `<img>`; `scale` ya incluye el zoom y el `devicePixelRatio`. `open_document` es rápido (lee solo los diccionarios de página, sin interpretar su contenido: 3997 páginas en ~110 ms) y la segunda llamada al mismo libro sale de memoria. Además pide a los hilos de render que abran el libro por adelantado.

**Cola, cancelación y precarga (backend).**
- Pool de 2 hilos de render; cada hilo tiene su copia del documento (MuPDF no comparte documentos entre hilos).
- Las páginas pedidas por el visor van antes que la precarga. Entre las pedidas va primero la más cercana a la última página pedida del mismo libro.
- Cada petición descarta las pendientes (en cola, no las que ya se están renderizando) del mismo libro que quedan a más de 12 páginas (el visor ya está en otra zona) o que son de otra escala (el usuario cambió el zoom): esas reciben `410 Gone`. Un `410` significa «ya no hacía falta»; si el `<img>` sigue en pantalla, hay que volver a pedirla. Una página que ya se está renderizando termina siempre y queda en caché.
- Tras cada petición se precargan ±2 páginas, primero las del sentido de avance, con la misma escala. La precarga no tiene destinatario: solo llena la caché.
- Caché de JPEG ya codificados en memoria (256 MB por defecto), clave (libro, página, escala cuantizada).
- Memoria de MuPDF: todos los contextos comparten un store de recursos de 256 MB (imágenes decodificadas, fuentes). El motor lo recorta a 64 MB tras cada trabajo (`EngineConfig::store_bytes`) y después pide a glibc que devuelva la memoria libre de sus heaps (`malloc_trim`). Con ambos, el proceso queda en torno a 230 MB tras 48 escaneos de render, y un escaneo ya visto se vuelve a dibujar en unos 13 ms (sin devolver el heap: unos 365 MB y unos 480 ms).

**Errores del protocolo en el visor:** `404` y `422` no se reintentan; `410` se reintenta si la página sigue visible; `500` se puede reintentar una vez.

### Texto, búsqueda, índice y enlaces (v0.8)

Todas las coordenadas de esta sección (`ViewRect`) están en el espacio del visor a escala 1: origen arriba a la izquierda, `y` hacia abajo, en puntos, el mismo que `width`, `height` y `transform` de `open_document`. El front multiplica por el zoom. Las páginas son 1-based.

| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `get_page_text` | `{ bookId: string; page: number }` | `TextWord[]` | `invalid_input` (página fuera del libro o ID sin forma de huella), `not_found`, `file_missing`, `invalid_pdf`, `internal` |
| `get_page_links` | `{ bookId: string; page: number }` | `PageLink[]` | `invalid_input` (página fuera del libro o ID sin forma de huella), `not_found`, `file_missing`, `invalid_pdf`, `internal` |
| `get_outline` | `{ bookId: string }` | `OutlineItem[]` (vacío si el PDF no tiene índice) | `invalid_input` (ID sin forma de huella), `not_found`, `file_missing`, `invalid_pdf`, `internal` |
| `search_document` | `{ bookId: string; query: string }` | `SearchStarted`. Devuelve enseguida; los resultados llegan por eventos | `invalid_input` (consulta vacía, solo espacios o de más de 200 caracteres; o ID sin forma de huella), `not_found`, `file_missing`, `invalid_pdf` |
| `cancel_search` | `{ searchId: string }` | `null`. Si la búsqueda ya terminó o no existe, no hace nada | — |

```ts
type ViewRect = [number, number, number, number]; // x0, y0, x1, y1 en el visor a escala 1
type TextWord = {
  text: string;       // palabra (sin espacios)
  rect: ViewRect;     // caja de todos sus caracteres
  lineEnd: boolean;   // última palabra de su línea
  blockEnd: boolean;  // última palabra de su bloque (párrafo)
};
type LinkTarget = { page: number; y: number | null } | { uri: string }; // interno | externo
type PageLink = { rect: ViewRect; target: LinkTarget };
type OutlineItem = {
  title: string;
  page: number | null; // destino, 1-based
  y: number | null;    // altura del destino, en el visor a escala 1 (null si el destino no la fija)
  uri: string | null;  // enlace externo permitido (http, https o mailto)
  children: OutlineItem[];
};
type SearchStarted = { searchId: string };
```

**Reglas**
- **`get_page_text`:** las palabras van en el orden del contenido de la página, el que da MuPDF (el mismo que sigue la capa de texto de pdf.js). Para casi todos los libros es el orden de lectura; en páginas con columnas o texto superpuesto puede no serlo. Dos palabras de la misma línea van separadas por un espacio; `lineEnd` marca un salto de línea al copiar y `blockEnd` una línea en blanco. El guion blando y los caracteres de ancho cero no aparecen.
- **`get_page_links`:** solo se devuelven enlaces utilizables: internos (`{ page, y }`, con `y` el borde superior del destino) y externos `http`, `https` y `mailto` (`{ uri }`). Otros esquemas (`file:`, `javascript:`, `launch`…), los destinos fuera del libro y los que MuPDF no puede resolver se omiten.
- **`get_outline`:** árbol de marcadores en el orden del PDF. Un marcador sin destino válido tiene `page`, `y` y `uri` a `null`. Las entradas de `children` tienen la misma forma. Se leen como mucho 32 niveles y 20 000 marcadores: lo que hay más abajo o más allá se ignora, así que un índice muy anidado no puede tumbar el proceso. Un destino con nombre se resuelve con MuPDF; un destino explícito (`/XYZ`, `/FitH`, `/FitR`) se convierte con la geometría de la página y su `y` se acota a la altura de la página.
- **`search_document`:** la búsqueda no distingue mayúsculas, acentos ni formas de compatibilidad (`ﬁ` casa con `fi`): «dios» encuentra «Dios», «DIOS» y «Diós». Una frase que cruza un salto de línea sí se encuentra y su coincidencia tiene un rectángulo por línea. Una búsqueda nueva del mismo libro cancela la anterior: su `search://done` llega con `cancelled: true`. Las búsquedas corren página a página en el hilo de lectura del motor, no en el pool de render, así que no retrasan los renders del visor más que lo que cuesta una página.
- El front ignora los eventos de un `searchId` que no reconoce (búsquedas anteriores).

**Eventos de búsqueda**
| Evento | Payload | Cuándo |
|---|---|---|
| `search://progress` | `{ searchId: string; page: number; matches: { rects: ViewRect[] }[] }` | Por cada página con coincidencias, en orden de página. `page` es 1-based |
| `search://done` | `{ searchId: string; total: number; pagesSearched: number; cancelled: boolean; error: AppError \| null }` | Una vez por búsqueda: al terminar, al cancelarla (`cancelled: true`) o si el libro no se puede leer (`error`). `total` cuenta las coincidencias encontradas |

### Fase 3 (v0.4, aprobada)

Los subrayados viven en la tabla `highlights` (migración 0001; no hace falta migración nueva). Los rectángulos se guardan como JSON en coordenadas PDF, así que sirven a cualquier zoom.

**Comandos (3.B1)**
| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `list_highlights` | `{ bookId: string; page?: number }` (sin `page`: todos los del libro) | `Highlight[]`, por página y, dentro de la página, por `createdAt` | `not_found`, `invalid_input`, `db` |
| `create_highlight` | `{ highlight: HighlightInput }` | `Highlight` completo, con `id` generado por el backend | `not_found` (libro), `invalid_input`, `db` |
| `update_highlight` | `{ highlightId: string; color?: HighlightColor; note?: string \| null }` | `Highlight` actualizado | `not_found`, `invalid_input`, `db` |
| `delete_highlight` | `{ highlightId: string }` | `null` | `not_found`, `db` |
| `export_highlights` | `{ bookId: string; destPath: string; language: "es" \| "en" }` (el idioma de la UI ya resuelto) | `{ count: number }`: subrayados exportados | `not_found`, `invalid_input` (ruta no absoluta o carpeta que no existe), `io`, `db` |

Notas de cada comando:
- **`create_highlight`** está pensado para la UI optimista: una sola inserción por clave primaria y el `Highlight` completo de vuelta, sin esperar nada más. No emite evento; el front actualiza su propia caché.
- **`update_highlight`**: `note` tiene tres estados. Ausente = no cambia; `null` = borra la nota; cadena = la reemplaza. Hace falta al menos uno de `color` o `note`; si no, `invalid_input`.
- **`delete_highlight`** borra solo el subrayado; no toca el libro ni el progreso.
- **`export_highlights`** escribe a un fichero temporal junto a `destPath` y lo renombra al final. Sobrescribe si existe: el front confirma antes con el diálogo de guardar. Si el libro no tiene subrayados, se escribe igualmente el encabezado y la línea de "sin subrayados".
- Un libro quitado de la biblioteca (`removed_at`) devuelve `not_found` en todos estos comandos, pero sus subrayados se conservan y vuelven si se importa el mismo archivo.

**Tipos de la fase 3**
```ts
type HighlightColor = "ochre" | "sienna" | "sage" | "slate";
type PdfRect = [number, number, number, number]; // x1, y1, x2, y2 en el espacio de usuario PDF (origen abajo a la izquierda)

type HighlightInput = {
  bookId: string;
  page: number;        // 1-based; si el libro ya tiene pageCount, page <= pageCount
  rects: PdfRect[];    // 1 a 500 rectángulos; el backend los normaliza (x1 <= x2, y1 <= y2) y rechaza área cero
  text: string;        // texto seleccionado; hasta 10 000 caracteres; puede estar vacío (subrayado de imagen)
  color: HighlightColor;
  note?: string | null; // hasta 10 000 caracteres; null o ausente = sin nota
};

type Highlight = {
  id: string;          // uuid v4, generado por el backend
  bookId: string;
  page: number;
  rects: PdfRect[];
  text: string;
  color: HighlightColor;
  note: string | null;
  createdAt: string;   // ISO 8601 UTC
  updatedAt: string;
};
```

**Formato del Markdown (`export_highlights`)**

Un único fichero UTF-8, con saltos de línea `\n` y un salto final. Ejemplo para *Pedro Páramo*, con dos páginas:

```markdown
# Pedro Páramo
*Juan Rulfo*

Subrayados exportados desde Atril el 2026-10-11 · 3 subrayados

## Página 2

> Vine a Comala porque me dijeron que acá vivía mi padre

Esta es la primera frase, la que lo cambia todo.

> Un subrayado sin nota

## Página 7

> Ya no hay nada que hacer, cuando todo está perdido
```

Reglas exactas:
1. Línea 1: `# <título>`. Si el libro tiene autor: línea 2 `*<autor>*`. Después, una línea en blanco, la línea "Subrayados exportados desde Atril el AAAA-MM-DD · N subrayados" (fecha UTC del momento de exportar, `N` en singular o plural según corresponda: "1 subrayado", "3 subrayados") y otra línea en blanco.
2. Sin subrayados: en lugar de las páginas, la línea `*Sin subrayados.*`.
3. Por cada página con subrayados, en orden ascendente: `## Página <n>`, línea en blanco, y los subrayados de esa página.
4. Orden dentro de una página: de arriba abajo (mayor `y2` primero) y, a igual altura, de izquierda a derecha (menor `x1` primero).
5. Cada subrayado es una cita: su texto en una sola línea con `> ` delante. Los espacios y saltos de línea internos se colapsan a un espacio. Si el texto está vacío: `> *(sin texto)*`.
6. Si tiene nota, un párrafo debajo, sin `>`, con sus saltos de línea tal cual. Un subrayado sin nota no lleva nada más.
7. Subrayados separados por una línea en blanco.
8. Escape: `\`, `*`, `_`, `#`, `[`, `]`, `<`, `>` y `` ` `` del texto y de la nota se preceden de `\` para que no se interpreten como Markdown.
9. El título y el autor llevan el mismo escape que las citas (son texto del usuario).
10. Textos fijos según `language` (`es` o `en`); los marcadores `*…*` de cursiva no se escapan:

| Texto | `es` | `en` |
|---|---|---|
| Cabecera de exportación | `Subrayados exportados desde Atril el AAAA-MM-DD · N` | `Highlights exported from Atril on AAAA-MM-DD · N` |
| Recuento | `1 subrayado` / `N subrayados` | `1 highlight` / `N highlights` |
| Página | `## Página N` | `## Page N` |
| Sin subrayados | `*Sin subrayados.*` | `*No highlights.*` |
| Cita sin texto | `> *(sin texto)*` | `> *(no text)*` |

**Lo que queda fuera de esta fase:** buscar dentro de los subrayados, exportar a otros formatos y el "modo subrayador" (es solo de front).

### Fases 3–5 (borrador, se detalla al empezar cada fase)
- Metadatos: `update_book_metadata` (editar título y autor a mano; fuera del alcance de la fase 2).

### Fase 5 (integración con el sistema, v0.5)

Linux primero. Un PDF llega a Atril de tres formas: doble clic con la app cerrada (argumentos de arranque), doble clic con la app abierta (segunda instancia) o desde el menú "Abrir con". En los tres casos el libro queda registrado como en una importación (`open_path`).

**Comandos (5.B1)**
| Comando | Argumentos | Devuelve | Errores |
|---|---|---|---|
| `take_pending_open_file` | — | `string \| null`: `bookId` de un PDF pendiente de abrir (primer lanzamiento con PDF). Cada id se devuelve una sola vez, en orden | — |
| `set_default_pdf_reader` | — | `null`. Ejecuta `xdg-mime default Atril.desktop application/pdf`. Falla si el `.desktop` no está instalado (no se puede hacer lector predeterminado desde un ejecutable suelto) | `io` |
| `is_default_pdf_reader` | — | `boolean`: si `xdg-mime query default application/pdf` devuelve `Atril.desktop` | `io` (`xdg-mime` no disponible) |

**Eventos**
- `app://open-file` `{ bookId }`: llega cuando una segunda instancia recibe un PDF. La instancia que ya está abierta importa el archivo, se enfoca y emite el evento. El primer lanzamiento no emite este evento: el front llama a `take_pending_open_file` al arrancar.

**Reglas**
1. Argumentos: el primero es el ejecutable y se ignora. Se aceptan rutas relativas (se resuelven con el directorio actual de la segunda instancia) y URI `file://` (con `%` decodificado). Las opciones (`-…`), lo que no es `.pdf` y los duplicados se ignoran. Un PDF inválido no impide abrir los demás.
2. `bundle.fileAssociations` declara `pdf` como `application/pdf` con rol `Viewer`: el `.deb` y el AppImage registran Atril como lector.
3. Con la instancia única, un segundo lanzamiento no arranca una ventana nueva.
4. Iconos: la app usa todavía los iconos de la plantilla. Los propios los define el diseño; no se añaden hasta que `frontend` los apruebe.

### JPX (v0.6): decodificación de escaneos JPEG 2000

**Por qué:** pdf.js decodifica los JPX de los escaneos con OpenJPEG en WebAssembly o, si WebKitGTK no compila el wasm, con su respaldo en JS: 17–25 s por página en los libros del usuario. El front pide aquí los píxeles y los pinta. El formato de salida es el de `imageData` de pdf.js (`src/decoder.c` y `src/myjs.js` de mozilla/pdf.js.openjpeg), así que no hace falta cambiar nada en pdf.js.

**Petición:** `POST atril://localhost/jpx?components=0&indexed=0&smask=0&reduce=0`, con los bytes del JPX (JP2 o codestream) como cuerpo.

| Parámetro | Valores | Significado (igual que `jp2_decode` de pdf.js) |
|---|---|---|
| `components` | 0–255, por defecto `0` | `0`: salida RGBA (4 canales). Mayor que 0: copia los primeros `min(canales, N)` canales sin convertir (solo 1, 3 o 4 son válidos) |
| `indexed` | `0` o `1`, por defecto `0` | `1`: no aplica la paleta y devuelve los índices sin escalar a 8 bits |
| `smask` | `0` o `1`, por defecto `0` | `1`: el alfa viene dentro del JPX. Con 4 canales se copian tal cual (el cuarto es el alfa); con gris + alfa se devuelve RGBA |
| `reduce` | 0–31, por defecto `0` | Reducción de resolución: las dimensiones de salida son `ceil(ancho / 2^reduce)` por `ceil(alto / 2^reduce)` |

Los parámetros que faltan valen lo indicado por defecto; los desconocidos se ignoran. Un valor no válido da `400`.

**Respuesta `200`:** el cuerpo son los píxeles de 8 bits, intercalados, de arriba abajo y de izquierda a derecha, con `X-Jpx-Channels` bytes por píxel. Cabeceras: `Content-Type: application/octet-stream`, `Content-Length`, `X-Jpx-Width`, `X-Jpx-Height` y `X-Jpx-Channels`. Las tres `X-Jpx-*` van en `Access-Control-Expose-Headers`.

**Salida** (con `components=0`, siempre 4 canales):
- Gris: `(g, g, g, 255)`.
- RGB: `(r, g, b, 255)`.
- CMYK: RGB con la fórmula de `color_cmyk_to_rgb` de OpenJPEG, y alfa 255. Solo si no hay `smask` con 4 canales.
- Gris + alfa con `smask=1`: `(g, g, g, a)`.
- 4 canales con `smask=1`: tal cual, RGBA.
- Con `indexed=0`, la paleta se aplica. Los valores se escalan a 8 bits como OpenJPEG: con más de 8 bits se desplazan a la derecha; con menos, `v · 255 / (2^n − 1)` entera.
- Con `components=N>0`: sin conversión de color, `min(canales, N)` canales (1, 3 o 4).

**Errores:**
- `422`: datos corruptos o que no son JPEG 2000 (y `decoder panicked` si hayro entra en pánico con ellos: la app sigue funcionando); imagen con más de 16 Mpx en la resolución original; reducción que deja la imagen sin píxeles o pasa de los niveles de resolución del JPX; combinación que pdf.js no pinta (dos canales sin `smask`, o `components=2`). El cuerpo es texto en inglés con el motivo. Ante un `422` por tamaño, el front puede dejar la página en manos del decodificador de pdf.js, que tarda más pero no tiene este límite.
- `400`: `components`, `indexed`, `smask` o `reduce` no válidos.
- `413`: el cuerpo pasa de 64 MiB.
- `405`: cualquier método distinto de `POST` en `/jpx` (el preflight `OPTIONS` sí se atiende).

**Preflight:** `OPTIONS /jpx` devuelve `204` con `Access-Control-Allow-Methods: POST, OPTIONS` y `Access-Control-Allow-Headers: Content-Type`, para el origen de la app. Las rutas de `GET` no cambian.

**Límites:** 64 MiB de cuerpo y 16 Mpx en la resolución original. El límite de píxeles se mide sobre la imagen sin reducir porque `hayro-jpeg2000` reserva el tamaño completo aunque se pida una reducción.

**Diferencias con pdf.js** (ver `src-tauri/src/jpx.rs`):
1. Dos canales sin alfa: pdf.js no escribe nada y devuelve `undefined`. Aquí es `422`.
2. Los valores difieren de los de pdf.js (que usa OpenJPEG) en ±1 en una fracción pequeña de los bytes (en 10 escaneos reales, entre el 0,002 % y el 0,04 %). `hayro-jpeg2000` trabaja en coma flotante.
3. Sin `colr` y con submuestreo de crominancia, pdf.js adivina sYCC y lo convierte. Aquí no, porque `hayro-jpeg2000` no expone el submuestreo. Un `colr` sYCC sí se convierte.
4. `indexed=1` no desactiva las cajas `cdef`, porque `hayro-jpeg2000` no tiene ese interruptor.

**Fixtures de los tests:** `src-tauri/tests/fixtures/jpx/*.jp2` (gris, gris + alfa, RGB, RGBA, CMYK, indexado, 16 bits y un patrón plano). Se generan con `python3 src-tauri/tests/fixtures/jpx/generate.py`, que necesita `ffmpeg` compilado con libopenjpeg. Los píxeles son patrones deterministas, no imágenes de nadie.

## Eventos (borrador)
| Evento | Payload | Cuándo |
|---|---|---|
| `library://changed` | `{ reason: "scan" \| "watch" \| "import" \| "index" }` | Cambió la biblioteca por algo que no pidió el front (escaneo de una carpeta, vigilancia, importación en segundo plano, o un libro indexado por el indexador nativo con `reason: "index"`): el front invalida sus consultas. Los comandos que pide el propio front no emiten el evento; el front invalida lo suyo |
| `library://scan` | `ScanStatus` | Empieza, avanza (como mucho una vez por segundo) o termina un escaneo |
| `app://open-file` | `{ bookId: string }` | El sistema pidió abrir un PDF (segundo doble clic con la app abierta) |
| `search://progress` | `{ searchId, page, matches }` | Coincidencias de una página durante una búsqueda (ver "Texto, búsqueda, índice y enlaces (v0.8)") |
| `search://done` | `{ searchId, total, pagesSearched, cancelled, error }` | Fin de una búsqueda: terminada, cancelada o con error |
