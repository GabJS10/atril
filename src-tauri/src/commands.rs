use tauri::State;

use crate::AppState;
use crate::error::AppError;
use crate::settings::{self, Settings, SettingsPatch};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, AppError> {
    let conn = state.db()?;
    settings::load(&conn)
}

/// `patch` llega como JSON crudo para que un parámetro mal formado sea
/// `invalid_input` (un `AppError`) y no un string de error de Tauri.
#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> Result<Settings, AppError> {
    let patch: SettingsPatch = serde_json::from_value(patch)
        .map_err(|error| AppError::invalid_input(error.to_string()))?;
    let mut conn = state.db()?;
    settings::update(&mut conn, &patch)
}
