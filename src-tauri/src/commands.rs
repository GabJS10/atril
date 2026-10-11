use std::path::Path;

use tauri::State;

use crate::AppState;
use crate::error::AppError;
use crate::library::{self, Book, OpenedBook, ReadingStateInput};
use crate::settings::{self, Settings, SettingsPatch};

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
