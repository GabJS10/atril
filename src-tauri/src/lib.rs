pub mod commands;
pub mod db;
pub mod error;
pub mod settings;

use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::error::AppError;

/// Estado compartido de la app: la conexión SQLite única.
pub struct AppState {
    db: Mutex<Connection>,
}

impl AppState {
    pub fn db(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        self.db
            .lock()
            .map_err(|_| AppError::internal("database connection lock was poisoned"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = db::open_app_database()?;
            app.manage(AppState {
                db: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
