//! Biblioteca: huella de los archivos, alta de libros y posición de lectura.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;

use chrono::{SecondsFormat, Utc};
use rusqlite::types::Type;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::{AppError, ErrorCode};
use crate::protocol::book_file_url;
use crate::settings::{ViewMode, Zoom};

const CHUNK_SIZE: u64 = 1024 * 1024;
const PDF_MAGIC: &[u8] = b"%PDF-";
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

/// Registra el PDF en `path` (o actualiza su ruta si su huella ya existe)
/// y devuelve el libro. Rechaza lo que no empiece por `%PDF-`.
pub fn open_path(conn: &mut Connection, path: &Path) -> Result<Book, AppError> {
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

    let tx = conn.transaction()?;

    let displaced: Option<String> = tx
        .query_row(
            "SELECT id FROM books WHERE path = ?1 AND id <> ?2",
            params![stored_path, id],
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
             missing = 0",
        params![id, stored_path, file_size, file_mtime, title, now_iso()],
    )?;

    let book = find_record(&tx, &id)?
        .ok_or_else(|| AppError::internal("book missing right after upsert"))?
        .book;
    tx.commit()?;
    Ok(book)
}

/// Abre un libro: marca `lastOpenedAt` y devuelve también su posición guardada.
pub fn open_book(conn: &Connection, id: &str) -> Result<OpenedBook, AppError> {
    let record = find_record(conn, id)?.ok_or_else(|| not_found(id))?;

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
    find_record(conn, id)?
        .map(|record| record.book)
        .ok_or_else(|| not_found(id))
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
            "SELECT page_count FROM books WHERE id = ?1",
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

struct BookRecord {
    book: Book,
    /// Ruta tal como está en la base de datos (puede ser provisional).
    path: String,
}

const BOOK_SELECT: &str = "SELECT b.id, b.path, b.title, b.author, b.page_count, b.scan_state,
        b.favorite, b.missing, b.added_at, b.last_opened_at, r.page
    FROM books b
    LEFT JOIN reading_state r ON r.book_id = b.id";

fn find_record(conn: &Connection, id: &str) -> Result<Option<BookRecord>, AppError> {
    let sql = format!("{BOOK_SELECT} WHERE b.id = ?1");
    Ok(conn
        .query_row(&sql, params![id], record_from_row)
        .optional()?)
}

fn record_from_row(row: &Row<'_>) -> rusqlite::Result<BookRecord> {
    let id: String = row.get(0)?;
    let path: String = row.get(1)?;
    let page_count: Option<i64> = row.get(4)?;
    let page: Option<i64> = row.get(10)?;

    let progress = match (page, page_count) {
        (Some(page), Some(count)) if count > 0 => Some(page as f64 / count as f64),
        _ => None,
    };
    let file_name = Path::new(&path)
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());

    let book = Book {
        file_url: book_file_url(&id),
        id,
        title: row.get(2)?,
        author: row.get(3)?,
        file_name,
        page_count,
        cover_url: None,
        favorite: row.get(6)?,
        missing: row.get(7)?,
        scan_state: parse_enum(row, 5)?,
        progress,
        added_at: row.get(8)?,
        last_opened_at: row.get(9)?,
    };
    Ok(BookRecord { book, path })
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

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::{Path, PathBuf};

    fn open_temp_db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = db::open(&dir.path().join("atril.db")).expect("open");
        (dir, conn)
    }

    /// PDF mínimo de `len` bytes: cabecera `%PDF-` y relleno determinista según `seed`.
    fn pdf_bytes(len: usize, seed: u8) -> Vec<u8> {
        let mut bytes = b"%PDF-1.4\n".to_vec();
        while bytes.len() < len {
            bytes.push(seed.wrapping_add(bytes.len() as u8));
        }
        bytes.truncate(len);
        bytes
    }

    fn write_file(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, bytes).expect("write fixture");
        path
    }

    fn save_input(page: i64, page_count: i64) -> ReadingStateInput {
        ReadingStateInput {
            page,
            offset_in_page: 0.25,
            zoom: Zoom::Preset(crate::settings::ZoomPreset::PageFit),
            view_mode: ViewMode::Night,
            page_count,
        }
    }

    #[test]
    fn fingerprint_is_lowercase_hex_sha256() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_file(dir.path(), "a.pdf", &pdf_bytes(4096, 1));

        let id = fingerprint(&path).expect("fingerprint");

        assert_eq!(id.len(), 64);
        assert!(
            id.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        );
    }

    #[test]
    fn fingerprint_survives_copy_and_rename() {
        let dir = tempfile::tempdir().expect("tempdir");
        let original = write_file(dir.path(), "original.pdf", &pdf_bytes(3 * 1024 * 1024, 7));
        let copied = dir.path().join("copia.pdf");
        std::fs::copy(&original, &copied).expect("copy");
        let renamed = dir.path().join("renamed.pdf");
        std::fs::rename(&copied, &renamed).expect("rename");

        assert_eq!(
            fingerprint(&original).expect("original"),
            fingerprint(&renamed).expect("renamed")
        );
    }

    #[test]
    fn fingerprint_changes_when_content_changes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bytes = pdf_bytes(4096, 1);
        let base = write_file(dir.path(), "base.pdf", &bytes);
        let base_id = fingerprint(&base).expect("base");

        let mut edited = bytes.clone();
        edited[100] ^= 0xFF;
        let edited_path = write_file(dir.path(), "edited.pdf", &edited);
        let longer = write_file(dir.path(), "longer.pdf", &pdf_bytes(4097, 1));

        assert_ne!(base_id, fingerprint(&edited_path).expect("edited"));
        assert_ne!(base_id, fingerprint(&longer).expect("longer"));
    }

    #[test]
    fn fingerprint_samples_only_first_and_last_mib() {
        let dir = tempfile::tempdir().expect("tempdir");
        let len = 3 * 1024 * 1024;
        let bytes = pdf_bytes(len, 3);
        let base = write_file(dir.path(), "base.pdf", &bytes);
        let base_id = fingerprint(&base).expect("base");

        let mut middle = bytes.clone();
        middle[3 * 1024 * 1024 / 2] ^= 0xFF;
        let middle_path = write_file(dir.path(), "middle.pdf", &middle);
        let mut tail = bytes.clone();
        tail[len - 1] ^= 0xFF;
        let tail_path = write_file(dir.path(), "tail.pdf", &tail);

        assert_eq!(base_id, fingerprint(&middle_path).expect("middle"));
        assert_ne!(base_id, fingerprint(&tail_path).expect("tail"));
    }

    #[test]
    fn open_path_registers_a_new_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();
        let path = write_file(dir.path(), "Mi libro.pdf", &pdf_bytes(2048, 1));

        let book = open_path(&mut conn, &path).expect("open_path");

        assert_eq!(book.id, fingerprint(&path).expect("fingerprint"));
        assert_eq!(book.title, "Mi libro");
        assert_eq!(book.file_name, "Mi libro.pdf");
        assert_eq!(book.file_url, book_file_url(&book.id));
        assert_eq!(book.scan_state, ScanState::Pending);
        assert_eq!(book.page_count, None);
        assert_eq!(book.progress, None);
        assert!(!book.missing);
        assert_eq!(book.last_opened_at, None);
    }

    #[test]
    fn open_path_on_a_moved_file_keeps_identity_and_updates_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();
        let original = write_file(dir.path(), "viejo.pdf", &pdf_bytes(2048, 1));
        let book = open_path(&mut conn, &original).expect("first open");
        save_reading_state_for(&mut conn, &book.id, &save_input(2, 4));

        let moved = dir.path().join("nuevo.pdf");
        std::fs::rename(&original, &moved).expect("rename");
        let open_result = open_book(&conn, &book.id);
        assert_eq!(
            open_result.expect_err("file moved").code,
            ErrorCode::FileMissing
        );
        assert!(get_book(&conn, &book.id).expect("get").missing);

        let reopened = open_path(&mut conn, &moved).expect("open moved");

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
    fn open_path_rejects_files_that_are_not_pdf() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();
        let path = write_file(dir.path(), "notas.pdf", b"hola, no soy un PDF");

        let error = open_path(&mut conn, &path).expect_err("must reject");

        assert_eq!(error.code, ErrorCode::InvalidPdf);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM books", [], |row| row.get(0))
            .expect("count");
        assert_eq!(count, 0);
    }

    #[test]
    fn open_path_reports_io_for_missing_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();

        let error = open_path(&mut conn, &dir.path().join("no-existe.pdf")).expect_err("missing");

        assert_eq!(error.code, ErrorCode::Io);
    }

    #[test]
    fn open_book_returns_not_found_for_unknown_id() {
        let (_db_dir, conn) = open_temp_db();

        let error = open_book(&conn, "desconocido").expect_err("unknown");

        assert_eq!(error.code, ErrorCode::NotFound);
        assert_eq!(
            get_book(&conn, "desconocido").expect_err("unknown").code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn open_book_marks_last_opened_and_returns_saved_position() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();
        let path = write_file(dir.path(), "a.pdf", &pdf_bytes(2048, 1));
        let book = open_path(&mut conn, &path).expect("open_path");

        let first = open_book(&conn, &book.id).expect("first open");
        assert_eq!(first.reading_state, None);
        assert!(first.book.last_opened_at.is_some());

        save_reading_state_for(&mut conn, &book.id, &save_input(1, 10));
        let second = open_book(&conn, &book.id).expect("second open");
        let state = second.reading_state.expect("saved position");
        assert_eq!(state.page, 1);
        assert_eq!(state.view_mode, ViewMode::Night);
        assert_eq!(
            state.zoom,
            Zoom::Preset(crate::settings::ZoomPreset::PageFit)
        );
    }

    #[test]
    fn save_reading_state_sets_page_count_and_progress() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();
        let path = write_file(dir.path(), "a.pdf", &pdf_bytes(2048, 1));
        let book = open_path(&mut conn, &path).expect("open_path");

        save_reading_state(&mut conn, &book.id, &save_input(5, 10)).expect("save");

        let saved = get_book(&conn, &book.id).expect("get");
        assert_eq!(saved.page_count, Some(10));
        assert_eq!(saved.progress, Some(0.5));
    }

    #[test]
    fn save_reading_state_keeps_the_first_page_count() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();
        let path = write_file(dir.path(), "a.pdf", &pdf_bytes(2048, 1));
        let book = open_path(&mut conn, &path).expect("open_path");
        save_reading_state(&mut conn, &book.id, &save_input(5, 10)).expect("first save");

        save_reading_state(&mut conn, &book.id, &save_input(10, 20)).expect("second save");

        let saved = get_book(&conn, &book.id).expect("get");
        assert_eq!(saved.page_count, Some(10));
        assert_eq!(saved.progress, Some(1.0));
    }

    #[test]
    fn save_reading_state_rejects_unknown_books_and_bad_input() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();
        let path = write_file(dir.path(), "a.pdf", &pdf_bytes(2048, 1));
        let book = open_path(&mut conn, &path).expect("open_path");

        let unknown = save_reading_state(&mut conn, "desconocido", &save_input(1, 10));
        assert_eq!(unknown.expect_err("unknown").code, ErrorCode::NotFound);

        let page_zero = save_reading_state(&mut conn, &book.id, &save_input(0, 10));
        assert_eq!(page_zero.expect_err("page 0").code, ErrorCode::InvalidInput);

        let beyond = save_reading_state(&mut conn, &book.id, &save_input(11, 10));
        assert_eq!(beyond.expect_err("beyond").code, ErrorCode::InvalidInput);

        let mut bad_offset = save_input(1, 10);
        bad_offset.offset_in_page = 1.5;
        let offset = save_reading_state(&mut conn, &book.id, &bad_offset);
        assert_eq!(offset.expect_err("offset").code, ErrorCode::InvalidInput);

        assert_eq!(get_book(&conn, &book.id).expect("get").progress, None);
    }

    /// Guarda una posición que ya se sabe válida y falla el test si no.
    fn save_reading_state_for(conn: &mut Connection, id: &str, input: &ReadingStateInput) {
        save_reading_state(conn, id, input).expect("save reading state");
    }
}
