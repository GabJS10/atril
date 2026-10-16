use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::Utc;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, State};

use crate::AppState;
use crate::collections::{self, Collection};
use crate::engine::links::PageLink;
use crate::engine::outline::OutlineItem;
use crate::engine::search::{SearchEvent, SearchStarted};
use crate::engine::text::TextWord;
use crate::engine::{self, api::OpenedDocument};
use crate::error::AppError;
use crate::folders::{self, LibraryFolder};
use crate::highlights::{self, ExportResult, Highlight, HighlightInput, Language};
use crate::library::{self, Book, ImportResult, OpenedBook, ReadingStateInput};
use crate::query::{self, BookQuery, HomeData};
use crate::scan::ScanStatus;
use crate::settings::{self, Settings, SettingsPatch};
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

/// Palabras de una página con su caja en coordenadas del visor a escala 1, en orden de lectura
/// (docs/IPC.md, "Texto, búsqueda, índice y enlaces").
#[tauri::command]
pub async fn get_page_text(
    app: State<'_, AppState>,
    book_id: String,
    page: i64,
) -> Result<Vec<TextWord>, AppError> {
    let page = page_number(page)?;
    let db = Arc::clone(&app.db);
    let engine = Arc::clone(&app.engine);
    tauri::async_runtime::spawn_blocking(move || {
        engine::api::page_text(&db, &engine, &book_id, page)
    })
    .await
    .map_err(|error| AppError::internal(format!("get_page_text task failed: {error}")))?
}

/// Enlaces de una página con su caja y su destino (docs/IPC.md).
#[tauri::command]
pub async fn get_page_links(
    app: State<'_, AppState>,
    book_id: String,
    page: i64,
) -> Result<Vec<PageLink>, AppError> {
    let page = page_number(page)?;
    let db = Arc::clone(&app.db);
    let engine = Arc::clone(&app.engine);
    tauri::async_runtime::spawn_blocking(move || {
        engine::api::page_links(&db, &engine, &book_id, page)
    })
    .await
    .map_err(|error| AppError::internal(format!("get_page_links task failed: {error}")))?
}

/// Índice del libro (docs/IPC.md, "Texto, búsqueda, índice y enlaces").
#[tauri::command]
pub async fn get_outline(
    app: State<'_, AppState>,
    book_id: String,
) -> Result<Vec<OutlineItem>, AppError> {
    let db = Arc::clone(&app.db);
    let engine = Arc::clone(&app.engine);
    tauri::async_runtime::spawn_blocking(move || engine::api::outline(&db, &engine, &book_id))
        .await
        .map_err(|error| AppError::internal(format!("get_outline task failed: {error}")))?
}

/// Empieza una búsqueda y devuelve su `searchId` enseguida. Los resultados llegan por los eventos
/// `search://progress` y `search://done` (docs/IPC.md).
#[tauri::command]
pub async fn search_document(
    app: AppHandle,
    state: State<'_, AppState>,
    book_id: String,
    query: String,
) -> Result<SearchStarted, AppError> {
    let db = Arc::clone(&state.db);
    let engine = Arc::clone(&state.engine);
    tauri::async_runtime::spawn_blocking(move || {
        let emitter = app.clone();
        engine::api::start_search(&db, &engine, &book_id, &query, move |event| {
            emit_search_event(&emitter, event);
        })
    })
    .await
    .map_err(|error| AppError::internal(format!("search_document task failed: {error}")))?
    .map(|search_id| SearchStarted { search_id })
}

/// Cancela una búsqueda. Si ya terminó o no existe, no hace nada.
#[tauri::command]
pub fn cancel_search(state: State<'_, AppState>, search_id: String) {
    state.engine.cancel_search(&search_id);
}

fn page_number(page: i64) -> Result<u32, AppError> {
    u32::try_from(page)
        .ok()
        .filter(|page| *page >= 1)
        .ok_or_else(|| AppError::invalid_input("page must be a page number from 1"))
}

fn emit_search_event(app: &AppHandle, event: SearchEvent) {
    let result = match event {
        SearchEvent::Progress(payload) => app.emit("search://progress", payload),
        SearchEvent::Done(payload) => app.emit("search://done", payload),
    };
    if let Err(error) = result {
        tracing::warn!(%error, "could not emit a search event");
    }
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
        let (folder, restored) = folders::add_restoring(&conn, Path::new(&path)).inspect_err(
            |error| tracing::warn!(received = %path, %error, "library folder refused"),
        )?;
        tracing::info!(received = %path, stored = %folder.path, restored, "library folder added");
        folder
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
    let result = library::import_files(&app.db, &paths)?;
    if !result.imported.is_empty() {
        app.indexer.wake();
    }
    Ok(result)
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
