use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::Utc;
use percent_encoding::percent_decode_str;
use tauri::State;
use tauri::http::HeaderMap;
use tauri::ipc::{InvokeBody, Request};

use crate::AppState;
use crate::collections::{self, Collection};
use crate::engine::{self, api::OpenedDocument};
use crate::error::AppError;
use crate::folders::{self, LibraryFolder};
use crate::highlights::{self, ExportResult, Highlight, HighlightInput, Language};
use crate::library::{self, Book, ImportResult, OpenedBook, ReadingStateInput, ScanInput};
use crate::query::{self, BookQuery, HomeData};
use crate::scan::ScanStatus;
use crate::settings::{self, Settings, SettingsPatch};
use crate::system;
use crate::watch;

#[tauri::command]
pub fn get_settings(app: State<'_, AppState>) -> Result<Settings, AppError> {
    let conn = app.db()?;
    settings::load(&conn)
}

/// `patch` llega como JSON crudo para que un parámetro mal formado sea
/// `invalid_input` (un `AppError`) y no un string de error de Tauri.
#[tauri::command]
pub fn update_settings(
    app: State<'_, AppState>,
    patch: serde_json::Value,
) -> Result<Settings, AppError> {
    let patch: SettingsPatch = serde_json::from_value(patch)
        .map_err(|error| AppError::invalid_input(error.to_string()))?;
    let mut conn = app.db()?;
    settings::update(&mut conn, &patch)
}

#[tauri::command]
pub fn open_path(app: State<'_, AppState>, path: String) -> Result<Book, AppError> {
    let mut conn = app.db()?;
    library::open_path(&mut conn, Path::new(&path))
}

#[tauri::command]
pub fn open_book(app: State<'_, AppState>, book_id: String) -> Result<OpenedBook, AppError> {
    let conn = app.db()?;
    library::open_book(&conn, &book_id)
}

/// Abre el libro en el motor nativo: páginas, geometría y URL base de las imágenes (docs/IPC.md).
/// Es `async` y trabaja en un hilo de bloqueo: la primera vez abre el PDF y lee sus páginas.
#[tauri::command]
pub async fn open_document(
    app: State<'_, AppState>,
    book_id: String,
) -> Result<OpenedDocument, AppError> {
    let db = Arc::clone(&app.db);
    let engine = Arc::clone(&app.engine);
    tauri::async_runtime::spawn_blocking(move || engine::api::open_document(&db, &engine, &book_id))
        .await
        .map_err(|error| AppError::internal(format!("open_document task failed: {error}")))?
}

#[tauri::command]
pub fn get_book(app: State<'_, AppState>, book_id: String) -> Result<Book, AppError> {
    let conn = app.db()?;
    library::get_book(&conn, &book_id)
}

/// `state` llega como JSON crudo por la misma razón que `update_settings`.
#[tauri::command]
pub fn save_reading_state(
    app: State<'_, AppState>,
    book_id: String,
    state: serde_json::Value,
) -> Result<(), AppError> {
    let input: ReadingStateInput = serde_json::from_value(state)
        .map_err(|error| AppError::invalid_input(error.to_string()))?;
    let mut conn = app.db()?;
    library::save_reading_state(&mut conn, &book_id, &input)
}

#[tauri::command]
pub fn get_home(app: State<'_, AppState>) -> Result<HomeData, AppError> {
    let conn = app.db()?;
    query::get_home(&conn)
}

/// `query` llega como JSON crudo para que un filtro mal formado sea `invalid_input`.
#[tauri::command]
pub fn list_books(
    app: State<'_, AppState>,
    query: serde_json::Value,
) -> Result<Vec<Book>, AppError> {
    let query: BookQuery = serde_json::from_value(query)
        .map_err(|error| AppError::invalid_input(error.to_string()))?;
    let conn = app.db()?;
    query::list_books(&conn, &query)
}

#[tauri::command]
pub fn set_favorite(
    app: State<'_, AppState>,
    book_id: String,
    favorite: bool,
) -> Result<Book, AppError> {
    let conn = app.db()?;
    library::set_favorite(&conn, &book_id, favorite)
}

#[tauri::command]
pub fn remove_book(app: State<'_, AppState>, book_id: String) -> Result<(), AppError> {
    let conn = app.db()?;
    library::remove_book(&conn, &book_id)
}

#[tauri::command]
pub fn list_library_folders(app: State<'_, AppState>) -> Result<Vec<LibraryFolder>, AppError> {
    let conn = app.db()?;
    folders::list(&conn)
}

#[tauri::command]
pub fn add_library_folder(
    app: State<'_, AppState>,
    path: String,
) -> Result<LibraryFolder, AppError> {
    let folder = {
        let conn = app.db()?;
        folders::add(&conn, Path::new(&path))?
    };
    watch::request_scan(&app.worker);
    Ok(folder)
}

#[tauri::command]
pub fn remove_library_folder(app: State<'_, AppState>, folder_id: String) -> Result<(), AppError> {
    {
        let conn = app.db()?;
        folders::remove(&conn, &folder_id)?;
    }
    watch::request_scan(&app.worker);
    Ok(())
}

#[tauri::command]
pub fn rescan_library(app: State<'_, AppState>) -> Result<(), AppError> {
    watch::request_scan(&app.worker);
    Ok(())
}

#[tauri::command]
pub fn get_scan_status(app: State<'_, AppState>) -> Result<ScanStatus, AppError> {
    let status = app
        .scan
        .lock()
        .map_err(|_| AppError::internal("scan status lock was poisoned"))?;
    Ok(*status)
}

#[tauri::command]
pub fn import_files(
    app: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<ImportResult, AppError> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    library::import_files(&app.db, &paths)
}

#[tauri::command]
pub fn list_pending_scans(app: State<'_, AppState>) -> Result<Vec<Book>, AppError> {
    let conn = app.db()?;
    library::list_pending_scans(&conn)
}

/// Metadatos en cabeceras (`X-Book-Id`, `X-Page-Count`, opcionales `X-Title`, `X-Author`)
/// y la portada WebP como cuerpo binario (`docs/IPC.md`, fase 2).
#[tauri::command]
pub fn save_book_scan(app: State<'_, AppState>, request: Request<'_>) -> Result<Book, AppError> {
    let (book_id, scan) = parse_scan_headers(request.headers())?;
    let cover = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        InvokeBody::Json(_) => {
            return Err(AppError::invalid_input(
                "the cover must be sent as a binary body",
            ));
        }
    };
    let conn = app.db()?;
    library::save_book_scan(&conn, &app.covers_dir, &book_id, &scan, cover)
}

#[tauri::command]
pub fn mark_scan_failed(app: State<'_, AppState>, book_id: String) -> Result<Book, AppError> {
    let conn = app.db()?;
    library::mark_scan_failed(&conn, &book_id)
}

#[tauri::command]
pub fn list_collections(app: State<'_, AppState>) -> Result<Vec<Collection>, AppError> {
    let conn = app.db()?;
    collections::list(&conn)
}

#[tauri::command]
pub fn create_collection(app: State<'_, AppState>, name: String) -> Result<Collection, AppError> {
    let conn = app.db()?;
    collections::create(&conn, &name)
}

#[tauri::command]
pub fn rename_collection(
    app: State<'_, AppState>,
    collection_id: String,
    name: String,
) -> Result<Collection, AppError> {
    let conn = app.db()?;
    collections::rename(&conn, &collection_id, &name)
}

#[tauri::command]
pub fn delete_collection(app: State<'_, AppState>, collection_id: String) -> Result<(), AppError> {
    let conn = app.db()?;
    collections::delete(&conn, &collection_id)
}

#[tauri::command]
pub fn add_to_collection(
    app: State<'_, AppState>,
    book_ids: Vec<String>,
    collection_id: String,
) -> Result<(), AppError> {
    let mut conn = app.db()?;
    collections::add_books(&mut conn, &collection_id, &book_ids)
}

#[tauri::command]
pub fn remove_from_collection(
    app: State<'_, AppState>,
    book_ids: Vec<String>,
    collection_id: String,
) -> Result<(), AppError> {
    let mut conn = app.db()?;
    collections::remove_books(&mut conn, &collection_id, &book_ids)
}

#[tauri::command]
pub fn list_highlights(
    app: State<'_, AppState>,
    book_id: String,
    page: Option<i64>,
) -> Result<Vec<Highlight>, AppError> {
    let conn = app.db()?;
    highlights::list(&conn, &book_id, page)
}

/// `highlight` llega como JSON crudo para que un campo mal formado sea `invalid_input`.
#[tauri::command]
pub fn create_highlight(
    app: State<'_, AppState>,
    highlight: serde_json::Value,
) -> Result<Highlight, AppError> {
    let input: HighlightInput = serde_json::from_value(highlight)
        .map_err(|error| AppError::invalid_input(error.to_string()))?;
    let conn = app.db()?;
    highlights::create(&conn, input)
}

/// El cuerpo entero son los argumentos: así `note` ausente (no cambia) y `null` (la borra) se distinguen.
#[tauri::command]
pub fn update_highlight(
    app: State<'_, AppState>,
    request: Request<'_>,
) -> Result<Highlight, AppError> {
    let InvokeBody::Json(body) = request.body() else {
        return Err(AppError::invalid_input(
            "update_highlight expects JSON arguments",
        ));
    };
    let (id, patch) = highlights::parse_update(body)?;
    let conn = app.db()?;
    highlights::update(&conn, &id, &patch)
}

#[tauri::command]
pub fn delete_highlight(app: State<'_, AppState>, highlight_id: String) -> Result<(), AppError> {
    let conn = app.db()?;
    highlights::delete(&conn, &highlight_id)
}

/// Escribe el Markdown en `dest_path` (ruta absoluta que eligió el usuario en el diálogo).
#[tauri::command]
pub fn export_highlights(
    app: State<'_, AppState>,
    book_id: String,
    dest_path: String,
    language: String,
) -> Result<ExportResult, AppError> {
    let language = Language::parse(&language)?;
    let date = Utc::now().format("%Y-%m-%d").to_string();
    let conn = app.db()?;
    highlights::export(&conn, &book_id, Path::new(&dest_path), language, &date)
}

/// Libro que abrir al arrancar (primer lanzamiento con PDF). `null` si no hay ninguno.
#[tauri::command]
pub fn take_pending_open_file(app: State<'_, AppState>) -> Option<String> {
    app.pending_open.take()
}

#[tauri::command]
pub fn set_default_pdf_reader() -> Result<(), AppError> {
    system::set_default_pdf_reader()
}

#[tauri::command]
pub fn is_default_pdf_reader() -> Result<bool, AppError> {
    system::is_default_pdf_reader()
}

/// Lee las cabeceras de `save_book_scan`. Títulos y autores van URL-encoded en UTF-8.
fn parse_scan_headers(headers: &HeaderMap) -> Result<(String, ScanInput), AppError> {
    let text = |name: &str| -> Result<Option<String>, AppError> {
        match headers.get(name) {
            None => Ok(None),
            Some(value) => {
                let raw = value
                    .to_str()
                    .map_err(|_| AppError::invalid_input(format!("{name} is not ASCII")))?;
                let decoded = percent_decode_str(raw)
                    .decode_utf8()
                    .map_err(|_| AppError::invalid_input(format!("{name} is not UTF-8")))?
                    .trim()
                    .to_owned();
                Ok((!decoded.is_empty()).then_some(decoded))
            }
        }
    };

    let book_id =
        text("x-book-id")?.ok_or_else(|| AppError::invalid_input("missing X-Book-Id header"))?;
    let page_count = text("x-page-count")?
        .ok_or_else(|| AppError::invalid_input("missing X-Page-Count header"))?
        .parse::<i64>()
        .map_err(|_| AppError::invalid_input("X-Page-Count is not a number"))?;

    Ok((
        book_id,
        ScanInput {
            page_count,
            title: text("x-title")?,
            author: text("x-author")?,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::http::HeaderValue;

    #[test]
    fn scan_headers_are_parsed_and_decoded() {
        let mut headers = HeaderMap::new();
        headers.insert("x-book-id", HeaderValue::from_static("abc"));
        headers.insert("x-page-count", HeaderValue::from_static("176"));
        headers.insert("x-title", HeaderValue::from_static("Pedro%20P%C3%A1ramo"));
        headers.insert("x-author", HeaderValue::from_static("%20"));

        let (id, scan) = parse_scan_headers(&headers).expect("parse");

        assert_eq!(id, "abc");
        assert_eq!(scan.page_count, 176);
        assert_eq!(scan.title.as_deref(), Some("Pedro Páramo"));
        assert_eq!(scan.author, None);
    }

    #[test]
    fn scan_headers_require_id_and_page_count() {
        let mut headers = HeaderMap::new();
        headers.insert("x-page-count", HeaderValue::from_static("10"));
        assert_eq!(
            parse_scan_headers(&headers).expect_err("no id").code,
            crate::error::ErrorCode::InvalidInput
        );

        let mut headers = HeaderMap::new();
        headers.insert("x-book-id", HeaderValue::from_static("abc"));
        headers.insert("x-page-count", HeaderValue::from_static("diez"));
        assert_eq!(
            parse_scan_headers(&headers).expect_err("not a number").code,
            crate::error::ErrorCode::InvalidInput
        );
    }
}
