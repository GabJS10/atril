//! Libros: huella, alta (importación y escaneo), consulta, posición de lectura,
//! favoritos, quitar de la biblioteca y portadas.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::UNIX_EPOCH;

use chrono::{SecondsFormat, Utc};
use rusqlite::types::Type;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{AppError, ErrorCode};
use crate::protocol::{book_cover_url, book_file_url};
use crate::settings::{ViewMode, Zoom};

const CHUNK_SIZE: u64 = 1024 * 1024;
const PDF_MAGIC: &[u8] = b"%PDF-";
/// Tamaño máximo de una portada WebP.
const MAX_COVER_BYTES: usize = 2 * 1024 * 1024;
/// Ruta provisional de un libro cuyo archivo fue sustituido por otro contenido
/// en la misma ruta: conserva su progreso y subrayados, pero ya no tiene ruta real.
const DETACHED_PREFIX: &str = "detached:";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanState {
    Pending,
    Done,
    Failed,
}

/// Forma de `Book` en `docs/IPC.md`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub file_name: String,
    pub page_count: Option<i64>,
    pub file_url: String,
    pub cover_url: Option<String>,
    pub favorite: bool,
    pub missing: bool,
    pub scan_state: ScanState,
    pub progress: Option<f64>,
    pub current_page: Option<i64>,
    pub added_at: String,
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingState {
    pub page: i64,
    pub offset_in_page: f64,
    pub zoom: Zoom,
    pub view_mode: ViewMode,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedBook {
    pub book: Book,
    pub reading_state: Option<ReadingState>,
}

/// Argumento `state` de `save_reading_state`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStateInput {
    pub page: i64,
    pub offset_in_page: f64,
    pub zoom: Zoom,
    pub view_mode: ViewMode,
    pub page_count: i64,
}

impl ReadingStateInput {
    fn validate(&self) -> Result<(), AppError> {
        if self.page < 1 || self.page_count < 1 || self.page > self.page_count {
            return Err(AppError::invalid_input(format!(
                "page {} is outside 1..={}",
                self.page, self.page_count
            )));
        }
        if !(0.0..=1.0).contains(&self.offset_in_page) {
            return Err(AppError::invalid_input(
                "offsetInPage must be between 0 and 1",
            ));
        }
        if !self.zoom.is_valid() {
            return Err(AppError::invalid_input("zoom is out of range"));
        }
        Ok(())
    }
}

/// Datos de `save_book_scan` que no son la portada (los calcula el indexador nativo).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanInput {
    pub page_count: i64,
    pub title: Option<String>,
    pub author: Option<String>,
}

/// Huella del libro: sha256(tamaño + primer MiB + último MiB), en hex minúsculas.
/// Para archivos de hasta un MiB, el "primer" y el "último" trozo son el archivo entero.
pub fn fingerprint(path: &Path) -> Result<String, AppError> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();

    let mut hasher = Sha256::new();
    hasher.update(size.to_be_bytes());

    let chunk_len = size.min(CHUNK_SIZE) as usize;
    let mut chunk = vec![0u8; chunk_len];
    file.read_exact(&mut chunk)?;
    hasher.update(&chunk);

    file.seek(SeekFrom::End(-(chunk_len as i64)))?;
    file.read_exact(&mut chunk)?;
    hasher.update(&chunk);

    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn has_pdf_header(path: &Path) -> Result<bool, AppError> {
    let mut head = Vec::with_capacity(PDF_MAGIC.len());
    File::open(path)?
        .take(PDF_MAGIC.len() as u64)
        .read_to_end(&mut head)?;
    Ok(head == PDF_MAGIC)
}

/// Lo que se sabe de un archivo PDF antes de tocar la base de datos.
/// Se calcula sin el lock de la base, porque lee el archivo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedFile {
    pub id: String,
    pub path: String,
    pub file_size: i64,
    pub file_mtime: Option<i64>,
    pub title: String,
}

pub fn prepare_file(path: &Path) -> Result<PreparedFile, AppError> {
    let stored_path = path
        .to_str()
        .ok_or_else(|| AppError::invalid_input("path is not valid UTF-8"))?;

    if !has_pdf_header(path)? {
        return Err(AppError::new(
            ErrorCode::InvalidPdf,
            format!("{} is not a PDF file", path.display()),
        ));
    }

    let id = fingerprint(path)?;
    let metadata = std::fs::metadata(path)?;
    let file_size =
        i64::try_from(metadata.len()).map_err(|error| AppError::io(error.to_string()))?;
    let file_mtime = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_secs()).ok());
    let title = path.file_stem().map_or_else(
        || stored_path.to_owned(),
        |stem| stem.to_string_lossy().into_owned(),
    );

    Ok(PreparedFile {
        id,
        path: stored_path.to_owned(),
        file_size,
        file_mtime,
        title,
    })
}

/// Quién registra el archivo. Cambia lo que pasa con libros quitados y copias.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// El usuario lo importa: vuelve a la biblioteca si estaba quitado y su ruta pasa a ser esta.
    Import,
    /// Lo encontró un escaneo de carpeta: no devuelve libros quitados y, si ya hay
    /// otra copia existente con esa huella, la ruta conocida se mantiene.
    Scan,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Commit {
    pub book: Book,
    /// `true` si el libro no estaba en la base de datos.
    pub created: bool,
}

/// Inserta o actualiza el libro. `Ok(None)` si un escaneo decide no tocarlo.
pub fn commit_file(
    conn: &mut Connection,
    file: &PreparedFile,
    origin: Origin,
) -> Result<Option<Commit>, AppError> {
    let tx = conn.transaction()?;

    let existing: Option<(String, bool)> = tx
        .query_row(
            "SELECT path, removed_at IS NOT NULL FROM books WHERE id = ?1",
            params![file.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    if let (Some((known_path, removed)), Origin::Scan) = (&existing, origin) {
        if *removed {
            return Ok(None);
        }
        if known_path != &file.path && Path::new(known_path).is_file() {
            return Ok(None);
        }
    }
    let created = existing.is_none();

    // Otra huella ocupaba esta ruta: el archivo se reemplazó. Esa entrada ya no tiene archivo;
    // se conserva (progreso, subrayados) sin ruta real.
    let displaced: Option<String> = tx
        .query_row(
            "SELECT id FROM books WHERE path = ?1 AND id <> ?2",
            params![file.path, file.id],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(old_id) = displaced {
        tx.execute(
            "UPDATE books SET path = ?1, missing = 1 WHERE id = ?2",
            params![format!("{DETACHED_PREFIX}{old_id}"), old_id],
        )?;
    }

    tx.execute(
        "INSERT INTO books (id, path, file_size, file_mtime, title, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (id) DO UPDATE SET
             path = excluded.path,
             file_size = excluded.file_size,
             file_mtime = excluded.file_mtime,
             missing = 0,
             removed_at = NULL,
             -- Mientras el título venga del nombre del archivo, sigue al nombre.
             title = CASE WHEN books.title_source = 'filename' THEN excluded.title ELSE books.title END",
        params![
            file.id,
            file.path,
            file.file_size,
            file.file_mtime,
            file.title,
            now_iso()
        ],
    )?;

    let book = find_record(&tx, &file.id)?
        .ok_or_else(|| AppError::internal("book missing right after upsert"))?
        .book;
    tx.commit()?;
    Ok(Some(Commit { book, created }))
}

/// Prepara el archivo (sin lock) y lo registra (con lock, un momento).
pub fn register(
    db: &Mutex<Connection>,
    path: &Path,
    origin: Origin,
) -> Result<Option<Commit>, AppError> {
    let prepared = prepare_file(path)?;
    let mut conn = lock_db(db)?;
    commit_file(&mut conn, &prepared, origin)
}

/// Registra el PDF en `path` (o actualiza su ruta si su huella ya existe) y devuelve el libro.
pub fn open_path(conn: &mut Connection, path: &Path) -> Result<Book, AppError> {
    let prepared = prepare_file(path)?;
    commit_file(conn, &prepared, Origin::Import)?
        .map(|commit| commit.book)
        .ok_or_else(|| AppError::internal("import did not register the book"))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rejection {
    pub path: String,
    pub error: AppError,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: Vec<Book>,
    pub rejected: Vec<Rejection>,
}

/// Importa archivos sueltos. Cada ruta va por separado: un fallo no para el resto.
pub fn import_files(db: &Mutex<Connection>, paths: &[PathBuf]) -> Result<ImportResult, AppError> {
    if paths.is_empty() {
        return Err(AppError::invalid_input("no files to import"));
    }

    let mut result = ImportResult {
        imported: Vec::new(),
        rejected: Vec::new(),
    };
    for path in paths {
        match register(db, path, Origin::Import) {
            Ok(Some(commit)) => result.imported.push(commit.book),
            Ok(None) => {}
            Err(error) => result.rejected.push(Rejection {
                path: path.display().to_string(),
                error,
            }),
        }
    }
    Ok(result)
}

/// Abre un libro: marca `lastOpenedAt` y devuelve también su posición guardada.
pub fn open_book(conn: &Connection, id: &str) -> Result<OpenedBook, AppError> {
    let record = find_visible(conn, id)?.ok_or_else(|| not_found(id))?;

    if !Path::new(&record.path).is_file() {
        conn.execute("UPDATE books SET missing = 1 WHERE id = ?1", params![id])?;
        return Err(AppError::new(
            ErrorCode::FileMissing,
            format!("file of book {id} is missing at {}", record.path),
        ));
    }

    conn.execute(
        "UPDATE books SET last_opened_at = ?1, missing = 0 WHERE id = ?2",
        params![now_iso(), id],
    )?;

    let book = get_book(conn, id)?;
    let reading_state = find_reading_state(conn, id)?;
    Ok(OpenedBook {
        book,
        reading_state,
    })
}

pub fn get_book(conn: &Connection, id: &str) -> Result<Book, AppError> {
    find_visible(conn, id)?
        .map(|record| record.book)
        .ok_or_else(|| not_found(id))
}

/// Todos los libros de la biblioteca (sin quitados). El orden lo decide quien llama.
pub fn visible_books(conn: &Connection) -> Result<Vec<Book>, AppError> {
    Ok(query_records(conn, "WHERE b.removed_at IS NULL", [])?
        .into_iter()
        .map(|record| record.book)
        .collect())
}

/// Guarda la posición. `pageCount` se fija la primera vez; después manda el valor guardado.
pub fn save_reading_state(
    conn: &mut Connection,
    id: &str,
    input: &ReadingStateInput,
) -> Result<(), AppError> {
    input.validate()?;

    let tx = conn.transaction()?;

    let stored_count: Option<i64> = tx
        .query_row(
            "SELECT page_count FROM books WHERE id = ?1 AND removed_at IS NULL",
            params![id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| not_found(id))?;

    let page_count = match stored_count {
        Some(count) => count,
        None => {
            tx.execute(
                "UPDATE books SET page_count = ?1 WHERE id = ?2",
                params![input.page_count, id],
            )?;
            input.page_count
        }
    };
    if input.page > page_count {
        return Err(AppError::invalid_input(format!(
            "page {} is beyond the {page_count} pages of this book",
            input.page
        )));
    }

    let zoom = serde_json::to_string(&input.zoom)
        .map_err(|error| AppError::internal(error.to_string()))?;
    tx.execute(
        "INSERT INTO reading_state (book_id, page, offset_in_page, zoom, view_mode, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (book_id) DO UPDATE SET
             page = excluded.page,
             offset_in_page = excluded.offset_in_page,
             zoom = excluded.zoom,
             view_mode = excluded.view_mode,
             updated_at = excluded.updated_at",
        params![
            id,
            input.page,
            input.offset_in_page,
            zoom,
            enum_text(&input.view_mode)?,
            now_iso()
        ],
    )?;

    tx.commit()?;
    Ok(())
}

pub fn set_favorite(conn: &Connection, id: &str, favorite: bool) -> Result<Book, AppError> {
    let changed = conn.execute(
        "UPDATE books SET favorite = ?1 WHERE id = ?2 AND removed_at IS NULL",
        params![favorite, id],
    )?;
    if changed == 0 {
        return Err(not_found(id));
    }
    get_book(conn, id)
}

/// Quita el libro de la biblioteca. Nunca borra el archivo ni el progreso.
pub fn remove_book(conn: &Connection, id: &str) -> Result<(), AppError> {
    let changed = conn.execute(
        "UPDATE books SET removed_at = ?1 WHERE id = ?2 AND removed_at IS NULL",
        params![now_iso(), id],
    )?;
    if changed == 0 {
        return Err(not_found(id));
    }
    Ok(())
}

/// Id y ruta de los libros pendientes de indexar (sin `missing`), por fecha de alta. Es lo que lee el
/// indexador nativo (`indexer.rs`), que necesita la ruta para abrir el PDF.
pub fn pending_scan_paths(conn: &Connection) -> Result<Vec<(String, PathBuf)>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, path FROM books
         WHERE removed_at IS NULL AND scan_state = 'pending' AND missing = 0
         ORDER BY added_at, id",
    )?;
    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let path: String = row.get(1)?;
            Ok((id, PathBuf::from(path)))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Guarda los metadatos y la portada (WebP) que calculó el indexador.
pub fn save_book_scan(
    conn: &Connection,
    covers_dir: &Path,
    id: &str,
    scan: &ScanInput,
    cover: &[u8],
) -> Result<Book, AppError> {
    if scan.page_count < 1 {
        return Err(AppError::invalid_input("pageCount must be at least 1"));
    }
    let Some(format) = CoverFormat::detect(cover) else {
        return Err(AppError::invalid_input(
            "cover must be a JPEG or WebP image",
        ));
    };
    if cover.len() > MAX_COVER_BYTES {
        return Err(AppError::invalid_input("cover is larger than 2 MiB"));
    }
    if find_visible(conn, id)?.is_none() {
        return Err(not_found(id));
    }

    write_cover(covers_dir, id, format, cover)?;

    // Sin título válido en los metadatos, un título que antes salió de ellos (reindexación con reglas nuevas)
    // vuelve al nombre del archivo, y otra vez sigue al nombre si se renombra.
    let stored_path: String =
        conn.query_row("SELECT path FROM books WHERE id = ?1", params![id], |row| {
            row.get(0)
        })?;
    let file_title = Path::new(&stored_path)
        .file_stem()
        .map_or(stored_path.clone(), |stem| {
            stem.to_string_lossy().into_owned()
        });

    conn.execute(
        "UPDATE books SET
             page_count = COALESCE(page_count, ?1),
             title = CASE WHEN ?2 IS NOT NULL THEN ?2
                          WHEN title_source = 'metadata' THEN ?5
                          ELSE title END,
             author = COALESCE(?3, author),
             scan_state = 'done',
             title_source = CASE WHEN ?2 IS NOT NULL THEN 'metadata'
                                 WHEN title_source = 'metadata' THEN 'filename'
                                 ELSE title_source END,
             has_cover = 1
         WHERE id = ?4",
        params![scan.page_count, scan.title, scan.author, id, file_title],
    )?;
    get_book(conn, id)
}

pub fn mark_scan_failed(conn: &Connection, id: &str) -> Result<Book, AppError> {
    let changed = conn.execute(
        "UPDATE books SET scan_state = 'failed' WHERE id = ?1 AND removed_at IS NULL",
        params![id],
    )?;
    if changed == 0 {
        return Err(not_found(id));
    }
    get_book(conn, id)
}

/// Bloquea la base de datos compartida; un lock envenenado es un error interno.
pub fn lock_db(db: &Mutex<Connection>) -> Result<MutexGuard<'_, Connection>, AppError> {
    db.lock()
        .map_err(|_| AppError::internal("database connection lock was poisoned"))
}

/// Formatos de portada aceptados. Se reconocen por la firma del contenido, no por la extensión.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoverFormat {
    Jpeg,
    Webp,
}

impl CoverFormat {
    pub fn detect(bytes: &[u8]) -> Option<Self> {
        if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some(CoverFormat::Jpeg)
        } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            Some(CoverFormat::Webp)
        } else {
            None
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            CoverFormat::Jpeg => "jpg",
            CoverFormat::Webp => "webp",
        }
    }

    pub fn mime(self) -> &'static str {
        match self {
            CoverFormat::Jpeg => "image/jpeg",
            CoverFormat::Webp => "image/webp",
        }
    }

    fn other(self) -> Self {
        match self {
            CoverFormat::Jpeg => CoverFormat::Webp,
            CoverFormat::Webp => CoverFormat::Jpeg,
        }
    }
}

/// Guarda la portada tal cual en `covers/<id>.<ext>` (temporal + renombrado) y quita la
/// del otro formato si la había, para que solo quede una.
fn write_cover(
    covers_dir: &Path,
    id: &str,
    format: CoverFormat,
    cover: &[u8],
) -> Result<(), AppError> {
    let extension = format.extension();
    let temp = covers_dir.join(format!("{id}.{extension}.tmp"));
    std::fs::write(&temp, cover)?;
    std::fs::rename(&temp, covers_dir.join(format!("{id}.{extension}")))?;

    match std::fs::remove_file(covers_dir.join(format!("{id}.{}", format.other().extension()))) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// Borra todas las portadas de `covers/` (las regenera el indexador). Una carpeta que no existe no es error.
pub fn remove_all_covers(covers_dir: &Path) -> Result<(), AppError> {
    let entries = match std::fs::read_dir(covers_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let path = entry?.path();
        if path.is_file() {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

struct BookRecord {
    book: Book,
    /// Ruta tal como está en la base de datos (puede ser provisional).
    path: String,
    removed: bool,
}

const BOOK_SELECT: &str = "SELECT b.id, b.path, b.title, b.author, b.page_count, b.scan_state,
        b.favorite, b.missing, b.added_at, b.last_opened_at, r.page,
        b.removed_at IS NOT NULL, b.has_cover
    FROM books b
    LEFT JOIN reading_state r ON r.book_id = b.id";

/// Busca un libro por id, aunque esté quitado (lo usa el registro para restaurarlo).
fn find_record(conn: &Connection, id: &str) -> Result<Option<BookRecord>, AppError> {
    Ok(query_records(conn, "WHERE b.id = ?1", params![id])?.pop())
}

/// Busca un libro por id entre los que están en la biblioteca.
fn find_visible(conn: &Connection, id: &str) -> Result<Option<BookRecord>, AppError> {
    Ok(find_record(conn, id)?.filter(|record| !record.removed))
}

fn query_records(
    conn: &Connection,
    tail: &str,
    params: impl rusqlite::Params,
) -> Result<Vec<BookRecord>, AppError> {
    let mut stmt = conn.prepare(&format!("{BOOK_SELECT} {tail}"))?;
    let records = stmt
        .query_map(params, record_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(records)
}

fn record_from_row(row: &Row<'_>) -> rusqlite::Result<BookRecord> {
    let id: String = row.get(0)?;
    let path: String = row.get(1)?;
    let page_count: Option<i64> = row.get(4)?;
    let current_page: Option<i64> = row.get(10)?;
    let has_cover: bool = row.get(12)?;

    let progress = match (current_page, page_count) {
        (Some(page), Some(count)) if count > 0 => Some(page as f64 / count as f64),
        _ => None,
    };
    let file_name = Path::new(&path)
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());

    let book = Book {
        file_url: book_file_url(&id),
        cover_url: has_cover.then(|| book_cover_url(&id)),
        id,
        title: row.get(2)?,
        author: row.get(3)?,
        file_name,
        page_count,
        favorite: row.get(6)?,
        missing: row.get(7)?,
        scan_state: parse_enum(row, 5)?,
        progress,
        current_page,
        added_at: row.get(8)?,
        last_opened_at: row.get(9)?,
    };
    Ok(BookRecord {
        book,
        path,
        removed: row.get(11)?,
    })
}

fn find_reading_state(conn: &Connection, id: &str) -> Result<Option<ReadingState>, AppError> {
    let state = conn
        .query_row(
            "SELECT page, offset_in_page, zoom, view_mode, updated_at
             FROM reading_state WHERE book_id = ?1",
            params![id],
            |row| {
                let zoom_raw: String = row.get(2)?;
                let zoom =
                    serde_json::from_str(&zoom_raw).map_err(|error| conversion_error(2, error))?;
                Ok(ReadingState {
                    page: row.get(0)?,
                    offset_in_page: row.get(1)?,
                    zoom,
                    view_mode: parse_enum(row, 3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()?;
    Ok(state)
}

/// Lee una columna de texto con el nombre de un enum serde (`snake_case`).
fn parse_enum<T: DeserializeOwned>(row: &Row<'_>, index: usize) -> rusqlite::Result<T> {
    let raw: String = row.get(index)?;
    serde_json::from_value(Value::String(raw)).map_err(|error| conversion_error(index, error))
}

fn conversion_error(
    index: usize,
    error: impl std::error::Error + Send + Sync + 'static,
) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(error))
}

fn enum_text<T: Serialize>(value: &T) -> Result<String, AppError> {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| AppError::internal("enum does not serialize to a string"))
}

fn not_found(id: &str) -> AppError {
    AppError::new(ErrorCode::NotFound, format!("no book with id {id}"))
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::ZoomPreset;
    use crate::test_support::{import, open_temp_db, pdf_bytes, webp_bytes, write_pdf};

    fn save_input(page: i64, page_count: i64) -> ReadingStateInput {
        ReadingStateInput {
            page,
            offset_in_page: 0.25,
            zoom: Zoom::Preset(ZoomPreset::PageFit),
            view_mode: ViewMode::Night,
            page_count,
        }
    }

    fn scan_input(page_count: i64) -> ScanInput {
        ScanInput {
            page_count,
            title: None,
            author: None,
        }
    }

    fn error_code<T: std::fmt::Debug>(result: Result<T, AppError>) -> ErrorCode {
        result.expect_err("expected an error").code
    }

    #[test]
    fn fingerprint_is_lowercase_hex_sha256() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_pdf(dir.path(), "a.pdf", 1);

        let id = fingerprint(&path).expect("fingerprint");

        assert_eq!(id.len(), 64);
        assert!(
            id.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        );
    }

    #[test]
    fn fingerprint_survives_copy_and_rename_and_changes_with_content() {
        let dir = tempfile::tempdir().expect("tempdir");
        let original = write_pdf(dir.path(), "original.pdf", 7);
        let base = fingerprint(&original).expect("base");
        let renamed = dir.path().join("renamed.pdf");
        std::fs::copy(&original, &renamed).expect("copy");
        std::fs::remove_file(&original).expect("remove");
        assert_eq!(fingerprint(&renamed).expect("renamed"), base);

        let mut edited = pdf_bytes(4096, 7);
        edited[100] ^= 0xFF;
        let edited_path = dir.path().join("edited.pdf");
        std::fs::write(&edited_path, &edited).expect("write");
        assert_ne!(fingerprint(&edited_path).expect("edited"), base);
    }

    #[test]
    fn fingerprint_samples_only_first_and_last_mib() {
        let dir = tempfile::tempdir().expect("tempdir");
        let len = 3 * 1024 * 1024;
        let bytes = pdf_bytes(len, 3);
        let base_path = dir.path().join("base.pdf");
        std::fs::write(&base_path, &bytes).expect("write");
        let base = fingerprint(&base_path).expect("base");

        let mut middle = bytes.clone();
        middle[len / 2] ^= 0xFF;
        let middle_path = dir.path().join("middle.pdf");
        std::fs::write(&middle_path, &middle).expect("write");
        assert_eq!(fingerprint(&middle_path).expect("middle"), base);

        let mut tail = bytes;
        tail[len - 1] ^= 0xFF;
        let tail_path = dir.path().join("tail.pdf");
        std::fs::write(&tail_path, &tail).expect("write");
        assert_ne!(fingerprint(&tail_path).expect("tail"), base);
    }

    #[test]
    fn open_path_registers_a_new_pdf_with_title_from_the_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let path = write_pdf(dir.path(), "Mi libro.pdf", 1);

        let book = import(&mut conn, &path);

        assert_eq!(book.id, fingerprint(&path).expect("fingerprint"));
        assert_eq!(book.title, "Mi libro");
        assert_eq!(book.file_name, "Mi libro.pdf");
        assert_eq!(book.file_url, crate::protocol::book_file_url(&book.id));
        assert_eq!(book.cover_url, None);
        assert_eq!(book.scan_state, ScanState::Pending);
        assert_eq!(book.progress, None);
        assert_eq!(book.current_page, None);
        assert!(!book.missing);
    }

    #[test]
    fn open_path_on_a_moved_file_keeps_identity_and_progress() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let original = write_pdf(dir.path(), "viejo.pdf", 1);
        let book = import(&mut conn, &original);
        save_reading_state(&mut conn, &book.id, &save_input(2, 4)).expect("save");

        let moved = dir.path().join("nuevo.pdf");
        std::fs::rename(&original, &moved).expect("rename");
        assert_eq!(
            error_code(open_book(&conn, &book.id)),
            ErrorCode::FileMissing
        );
        assert!(get_book(&conn, &book.id).expect("get").missing);

        let reopened = import(&mut conn, &moved);

        assert_eq!(reopened.id, book.id);
        assert!(!reopened.missing);
        assert_eq!(reopened.progress, Some(0.5));
        let stored_path: String = conn
            .query_row(
                "SELECT path FROM books WHERE id = ?1",
                params![book.id],
                |row| row.get(0),
            )
            .expect("path");
        assert_eq!(stored_path, moved.to_str().expect("utf-8"));
    }

    #[test]
    fn open_path_rejects_non_pdf_and_reports_missing_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let text = dir.path().join("notas.pdf");
        std::fs::write(&text, b"hola").expect("write");

        assert_eq!(
            error_code(open_path(&mut conn, &text)),
            ErrorCode::InvalidPdf
        );
        assert_eq!(
            error_code(open_path(&mut conn, &dir.path().join("no-existe.pdf"))),
            ErrorCode::Io
        );
        assert!(visible_books(&conn).expect("list").is_empty());
    }

    #[test]
    fn open_book_marks_last_opened_and_returns_saved_position() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));

        let first = open_book(&conn, &book.id).expect("first open");
        assert_eq!(first.reading_state, None);
        assert!(first.book.last_opened_at.is_some());

        save_reading_state(&mut conn, &book.id, &save_input(1, 10)).expect("save");
        let second = open_book(&conn, &book.id).expect("second open");
        let state = second.reading_state.expect("saved position");
        assert_eq!(state.page, 1);
        assert_eq!(state.view_mode, ViewMode::Night);
        assert_eq!(second.book.current_page, Some(1));
    }

    #[test]
    fn save_reading_state_sets_page_count_progress_and_keeps_the_first_page_count() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));

        save_reading_state(&mut conn, &book.id, &save_input(5, 10)).expect("first save");
        let saved = get_book(&conn, &book.id).expect("get");
        assert_eq!(saved.page_count, Some(10));
        assert_eq!(saved.progress, Some(0.5));
        assert_eq!(saved.current_page, Some(5));

        save_reading_state(&mut conn, &book.id, &save_input(10, 20)).expect("second save");
        let again = get_book(&conn, &book.id).expect("get");
        assert_eq!(again.page_count, Some(10));
        assert_eq!(again.progress, Some(1.0));
    }

    #[test]
    fn save_reading_state_rejects_unknown_books_and_bad_input() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));

        assert_eq!(
            error_code(save_reading_state(&mut conn, "nope", &save_input(1, 10))),
            ErrorCode::NotFound
        );
        assert_eq!(
            error_code(save_reading_state(&mut conn, &book.id, &save_input(0, 10))),
            ErrorCode::InvalidInput
        );
        assert_eq!(
            error_code(save_reading_state(&mut conn, &book.id, &save_input(11, 10))),
            ErrorCode::InvalidInput
        );
        let mut bad_offset = save_input(1, 10);
        bad_offset.offset_in_page = 1.5;
        assert_eq!(
            error_code(save_reading_state(&mut conn, &book.id, &bad_offset)),
            ErrorCode::InvalidInput
        );
        assert_eq!(get_book(&conn, &book.id).expect("get").progress, None);
    }

    #[test]
    fn favorites_toggle_and_unknown_ids_are_not_found() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));

        assert!(set_favorite(&conn, &book.id, true).expect("fav").favorite);
        assert!(
            !set_favorite(&conn, &book.id, false)
                .expect("unfav")
                .favorite
        );
        assert_eq!(
            error_code(set_favorite(&conn, "nope", true)),
            ErrorCode::NotFound
        );
    }

    #[test]
    fn remove_book_hides_it_and_importing_again_restores_progress() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let path = write_pdf(dir.path(), "a.pdf", 1);
        let book = import(&mut conn, &path);
        save_reading_state(&mut conn, &book.id, &save_input(3, 10)).expect("save");

        remove_book(&conn, &book.id).expect("remove");
        assert!(visible_books(&conn).expect("list").is_empty());
        assert_eq!(error_code(get_book(&conn, &book.id)), ErrorCode::NotFound);
        assert_eq!(
            error_code(remove_book(&conn, &book.id)),
            ErrorCode::NotFound
        );
        assert!(
            path.exists(),
            "removing from the library never deletes the file"
        );

        let restored = import(&mut conn, &path);
        assert_eq!(restored.id, book.id);
        assert_eq!(restored.progress, Some(0.3));
    }

    #[test]
    fn title_follows_the_file_name_until_pdf_metadata_is_saved() {
        let dir = tempfile::tempdir().expect("tempdir");
        let covers = tempfile::tempdir().expect("covers");
        let (_db, mut conn) = open_temp_db();
        let original = write_pdf(dir.path(), "viejo.pdf", 1);
        let book = import(&mut conn, &original);
        assert_eq!(book.title, "viejo");

        let renamed = dir.path().join("meditaciones-prueba.pdf");
        std::fs::rename(&original, &renamed).expect("rename");
        assert_eq!(import(&mut conn, &renamed).title, "meditaciones-prueba");

        save_book_scan(
            &conn,
            covers.path(),
            &book.id,
            &ScanInput {
                page_count: 10,
                title: Some("Meditaciones".into()),
                author: None,
            },
            &webp_bytes(64),
        )
        .expect("scan");
        let source: String = conn
            .query_row(
                "SELECT title_source FROM books WHERE id = ?1",
                params![book.id],
                |row| row.get(0),
            )
            .expect("source");
        assert_eq!(source, "metadata");
        let back = dir.path().join("otro-nombre.pdf");
        std::fs::rename(&renamed, &back).expect("rename again");
        assert_eq!(
            import(&mut conn, &back).title,
            "Meditaciones",
            "metadata title is kept"
        );
    }

    #[test]
    fn save_book_scan_stores_the_cover_and_metadata() {
        let dir = tempfile::tempdir().expect("tempdir");
        let covers = tempfile::tempdir().expect("covers");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        let scan = ScanInput {
            page_count: 176,
            title: Some("Pedro Páramo".into()),
            author: Some("Juan Rulfo".into()),
        };

        let saved =
            save_book_scan(&conn, covers.path(), &book.id, &scan, &webp_bytes(100)).expect("scan");

        assert_eq!(saved.scan_state, ScanState::Done);
        assert_eq!(saved.page_count, Some(176));
        assert_eq!(saved.title, "Pedro Páramo");
        assert_eq!(saved.author.as_deref(), Some("Juan Rulfo"));
        assert_eq!(
            saved.cover_url,
            Some(crate::protocol::book_cover_url(&book.id))
        );
        assert!(covers.path().join(format!("{}.webp", book.id)).is_file());
        assert!(!covers.path().join(format!("{}.webp.tmp", book.id)).exists());
    }

    #[test]
    fn save_book_scan_validates_the_cover_and_the_page_count() {
        let dir = tempfile::tempdir().expect("tempdir");
        let covers = tempfile::tempdir().expect("covers");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));

        assert_eq!(
            error_code(save_book_scan(
                &conn,
                covers.path(),
                &book.id,
                &scan_input(10),
                b"not webp!!!"
            )),
            ErrorCode::InvalidInput
        );
        let too_big = webp_bytes(2 * 1024 * 1024 + 1);
        assert_eq!(
            error_code(save_book_scan(
                &conn,
                covers.path(),
                &book.id,
                &scan_input(10),
                &too_big
            )),
            ErrorCode::InvalidInput
        );
        assert_eq!(
            error_code(save_book_scan(
                &conn,
                covers.path(),
                &book.id,
                &scan_input(0),
                &webp_bytes(64)
            )),
            ErrorCode::InvalidInput
        );
        assert_eq!(
            error_code(save_book_scan(
                &conn,
                covers.path(),
                "nope",
                &scan_input(10),
                &webp_bytes(64)
            )),
            ErrorCode::NotFound
        );
        assert!(!covers.path().join(format!("{}.webp", book.id)).exists());
    }

    #[test]
    fn remove_all_covers_empties_the_folder_and_tolerates_a_missing_one() {
        let covers = tempfile::tempdir().expect("covers");
        std::fs::write(covers.path().join("a.webp"), b"x").expect("write");
        std::fs::write(covers.path().join("b.jpg"), b"x").expect("write");

        remove_all_covers(covers.path()).expect("remove");
        assert_eq!(std::fs::read_dir(covers.path()).expect("read").count(), 0);

        remove_all_covers(&covers.path().join("missing")).expect("missing folder is fine");
    }

    #[test]
    fn jpeg_cover_is_stored_as_jpg_and_replacing_formats_leaves_one_file() {
        use crate::test_support::jpeg_bytes;
        let dir = tempfile::tempdir().expect("tempdir");
        let covers = tempfile::tempdir().expect("covers");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        let jpg = covers.path().join(format!("{}.jpg", book.id));
        let webp = covers.path().join(format!("{}.webp", book.id));

        let saved = save_book_scan(
            &conn,
            covers.path(),
            &book.id,
            &scan_input(10),
            &jpeg_bytes(64),
        )
        .expect("jpeg");
        assert_eq!(
            saved.cover_url,
            Some(crate::protocol::book_cover_url(&book.id))
        );
        assert!(jpg.is_file());

        save_book_scan(
            &conn,
            covers.path(),
            &book.id,
            &scan_input(10),
            &webp_bytes(64),
        )
        .expect("webp");
        assert!(webp.is_file());
        assert!(!jpg.exists(), "the JPEG is replaced by the WebP");

        save_book_scan(
            &conn,
            covers.path(),
            &book.id,
            &scan_input(10),
            &jpeg_bytes(64),
        )
        .expect("jpeg again");
        assert!(jpg.is_file());
        assert!(!webp.exists(), "the WebP is replaced by the JPEG");
    }

    #[test]
    fn png_covers_are_rejected_by_signature() {
        let dir = tempfile::tempdir().expect("tempdir");
        let covers = tempfile::tempdir().expect("covers");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();

        assert_eq!(
            error_code(save_book_scan(
                &conn,
                covers.path(),
                &book.id,
                &scan_input(10),
                &png
            )),
            ErrorCode::InvalidInput
        );
        assert_eq!(CoverFormat::detect(&png), None);
    }

    #[test]
    fn pending_scan_paths_drop_done_failed_and_missing_books() {
        let dir = tempfile::tempdir().expect("tempdir");
        let covers = tempfile::tempdir().expect("covers");
        let (_db, mut conn) = open_temp_db();
        let pending = import(&mut conn, &write_pdf(dir.path(), "pendiente.pdf", 1));
        let done = import(&mut conn, &write_pdf(dir.path(), "hecho.pdf", 2));
        let failed = import(&mut conn, &write_pdf(dir.path(), "roto.pdf", 3));
        save_book_scan(
            &conn,
            covers.path(),
            &done.id,
            &scan_input(5),
            &webp_bytes(64),
        )
        .expect("done");
        mark_scan_failed(&conn, &failed.id).expect("failed");

        let list = pending_scan_paths(&conn).expect("pending");

        assert_eq!(
            list.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            vec![pending.id.as_str()]
        );
        assert_eq!(
            error_code(mark_scan_failed(&conn, "nope")),
            ErrorCode::NotFound
        );
    }

    #[test]
    fn import_files_reports_rejections_without_stopping() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, conn) = open_temp_db();
        let db = Mutex::new(conn);
        let good = write_pdf(dir.path(), "bueno.pdf", 1);
        let bad = dir.path().join("malo.pdf");
        std::fs::write(&bad, b"no es pdf").expect("write");

        let result = import_files(&db, &[bad.clone(), good.clone()]).expect("import");

        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.imported[0].file_name, "bueno.pdf");
        assert_eq!(result.rejected.len(), 1);
        assert_eq!(result.rejected[0].error.code, ErrorCode::InvalidPdf);
        assert_eq!(error_code(import_files(&db, &[])), ErrorCode::InvalidInput);
    }

    #[test]
    fn scan_origin_does_not_restore_removed_books_nor_replace_a_known_copy() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let original = write_pdf(dir.path(), "a.pdf", 1);
        let book = import(&mut conn, &original);
        let copy = dir.path().join("copia.pdf");
        std::fs::copy(&original, &copy).expect("copy");

        let prepared_copy = prepare_file(&copy).expect("prepare");
        assert!(
            commit_file(&mut conn, &prepared_copy, Origin::Scan)
                .expect("commit")
                .is_none()
        );
        assert_eq!(get_book(&conn, &book.id).expect("get").file_name, "a.pdf");

        remove_book(&conn, &book.id).expect("remove");
        let prepared_original = prepare_file(&original).expect("prepare");
        assert!(
            commit_file(&mut conn, &prepared_original, Origin::Scan)
                .expect("commit")
                .is_none()
        );
        assert!(visible_books(&conn).expect("list").is_empty());
    }
}
