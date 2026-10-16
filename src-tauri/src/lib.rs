pub mod collections;
pub mod commands;
pub mod cover_color;
pub mod db;
pub mod engine;
pub mod error;
pub mod folders;
pub mod highlights;
pub mod indexer;
pub mod library;
pub mod logging;
#[cfg(test)]
mod packaging_tests;
pub mod path_rules;
pub mod platform;
pub mod protocol;
pub mod query;
pub mod scan;
pub mod settings;
#[cfg(test)]
pub mod test_support;
pub mod watch;

use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::{AppHandle, Manager, Runtime};

use crate::error::AppError;
use crate::scan::SharedScanStatus;

/// Estado compartido de la app: la conexión SQLite única, la carpeta de portadas,
/// el canal del hilo de biblioteca y el estado del escaneo.
/// La conexión va en `Arc` para que el protocolo `atril://` la use desde un hilo de bloqueo.
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub covers_dir: PathBuf,
    pub worker: Sender<watch::Msg>,
    pub scan: SharedScanStatus,
    /// Motor de PDF nativo (MuPDF): render de páginas y acceso a los documentos.
    pub engine: Arc<engine::Engine>,
    /// Despierta al indexador de metadatos y portadas (`indexer.rs`).
    pub indexer: indexer::Handle,
}

impl AppState {
    pub fn db(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        library::lock_db(&self.db)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // La instancia única va primero: así un segundo lanzamiento no llega a arrancar nada.
        // Sus argumentos se ignoran: Atril no es lector de PDF del sistema (ver docs/PLAN.md).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // El registro se instala aquí y no antes del `Builder`: un segundo lanzamiento termina en el plugin de
            // instancia única, antes de `setup`, y no debe rotar el registro de la instancia que sigue abierta.
            let data_dir = db::data_dir();
            logging::init(data_dir.as_ref().ok().map(PathBuf::as_path));
            let data_dir = data_dir?;
            let (conn, applied) = db::open_app_database(&data_dir)?;
            let covers_dir = data_dir.join("covers");
            std::fs::create_dir_all(&covers_dir)?;
            // La migración que regenera portadas deja los libros en 'pending': las viejas se borran una vez.
            if applied.contains(&db::COVERS_RESET_VERSION) {
                library::remove_all_covers(&covers_dir)?;
            }

            let db = Arc::new(Mutex::new(conn));
            let scan = SharedScanStatus::default();
            let engine = Arc::new(engine::Engine::new(engine::EngineConfig::default()));
            let indexer = indexer::spawn(
                app.handle().clone(),
                Arc::clone(&db),
                covers_dir.clone(),
                Arc::clone(&engine),
            );
            let (tx, rx) = mpsc::channel();
            watch::spawn(
                app.handle().clone(),
                Arc::clone(&db),
                Arc::clone(&scan),
                tx.clone(),
                rx,
                indexer.clone(),
            );

            app.manage(AppState {
                db,
                covers_dir,
                worker: tx,
                scan,
                engine,
                indexer,
            });
            platform::tune_main_window(app.handle());
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol(protocol::SCHEME, protocol::handle)
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::open_path,
            commands::open_book,
            commands::open_document,
            commands::get_page_text,
            commands::get_page_links,
            commands::get_outline,
            commands::search_document,
            commands::cancel_search,
            commands::get_book,
            commands::save_reading_state,
            commands::get_home,
            commands::list_books,
            commands::set_favorite,
            commands::remove_book,
            commands::list_library_folders,
            commands::add_library_folder,
            commands::remove_library_folder,
            commands::rescan_library,
            commands::get_scan_status,
            commands::import_files,
            commands::list_collections,
            commands::create_collection,
            commands::rename_collection,
            commands::delete_collection,
            commands::add_to_collection,
            commands::remove_from_collection,
            commands::list_highlights,
            commands::create_highlight,
            commands::update_highlight,
            commands::delete_highlight,
            commands::export_highlights
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Segundo lanzamiento: enfoca la ventana ya abierta, desminimizándola si hace falta.
fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
