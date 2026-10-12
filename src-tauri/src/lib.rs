pub mod collections;
pub mod commands;
pub mod db;
pub mod error;
pub mod folders;
pub mod highlights;
pub mod jpx;
pub mod library;
pub mod protocol;
pub mod query;
pub mod scan;
pub mod settings;
pub mod system;
#[cfg(test)]
pub mod test_support;
pub mod watch;

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::error::AppError;
use crate::scan::SharedScanStatus;
use crate::system::PendingOpen;

/// Estado compartido de la app: la conexión SQLite única, la carpeta de portadas,
/// el canal del hilo de biblioteca y el estado del escaneo.
/// La conexión va en `Arc` para que el protocolo `atril://` la use desde un hilo de bloqueo.
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub covers_dir: PathBuf,
    pub worker: Sender<watch::Msg>,
    pub scan: SharedScanStatus,
    pub pending_open: PendingOpen,
}

impl AppState {
    pub fn db(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        library::lock_db(&self.db)
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
        // La instancia única va primero: así un segundo lanzamiento no llega a arrancar nada.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            system::handle_second_instance(app, &args, Path::new(&cwd));
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = db::data_dir()?;
            let (conn, applied) = db::open_app_database(&data_dir)?;
            let covers_dir = data_dir.join("covers");
            std::fs::create_dir_all(&covers_dir)?;
            // La migración que regenera portadas deja los libros en 'pending': las viejas se borran una vez.
            if applied.contains(&db::COVERS_RESET_VERSION) {
                library::remove_all_covers(&covers_dir)?;
            }

            let db = Arc::new(Mutex::new(conn));
            // Primer lanzamiento con PDF en la línea de comandos: el front lo recoge con take_pending_open_file.
            let pending_open = PendingOpen::default();
            let argv: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            pending_open.push_all(system::open_paths(
                &db,
                &system::pdf_paths_from_args(&argv, &cwd),
            ));
            let scan = SharedScanStatus::default();
            let (tx, rx) = mpsc::channel();
            watch::spawn(
                app.handle().clone(),
                Arc::clone(&db),
                Arc::clone(&scan),
                tx.clone(),
                rx,
            );

            app.manage(AppState {
                db,
                covers_dir,
                worker: tx,
                scan,
                pending_open,
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
            commands::list_pending_scans,
            commands::save_book_scan,
            commands::mark_scan_failed,
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
            commands::export_highlights,
            commands::take_pending_open_file,
            commands::set_default_pdf_reader,
            commands::is_default_pdf_reader
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
