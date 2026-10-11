pub mod commands;
pub mod db;
pub mod error;
pub mod library;
pub mod protocol;
pub mod settings;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::error::AppError;

/// Estado compartido de la app: la conexión SQLite única y la carpeta de portadas.
/// La conexión va en `Arc` para que el protocolo `atril://` la use desde un hilo de bloqueo.
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub covers_dir: PathBuf,
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
            let data_dir = db::data_dir()?;
            let conn = db::open_app_database(&data_dir)?;
            let covers_dir = data_dir.join("covers");
            std::fs::create_dir_all(&covers_dir)?;
            app.manage(AppState {
                db: Arc::new(Mutex::new(conn)),
                covers_dir,
            });
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, protocol::handle)
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::open_path,
            commands::open_book,
            commands::get_book,
            commands::save_reading_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
