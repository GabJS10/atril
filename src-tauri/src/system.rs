//! Integración con el sistema (Linux): PDF pasados por línea de comandos, instancia única,
//! archivo pendiente de abrir y lector de PDF predeterminado (`docs/IPC.md`, fase 5).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use percent_encoding::percent_decode_str;
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::AppState;
use crate::error::AppError;
use crate::library::{self, Origin};

/// Nombre del `.desktop` que instala el bundle (ver `docs/IPC.md`, fase 5).
pub const DESKTOP_FILE: &str = "Atril.desktop";
const PDF_MIME: &str = "application/pdf";
/// Libros pendientes de abrir cuando el front todavía no estaba listo (primer lanzamiento con PDF).
#[derive(Default)]
pub struct PendingOpen(Mutex<VecDeque<String>>);

impl PendingOpen {
    pub fn push_all(&self, book_ids: Vec<String>) {
        if let Ok(mut queue) = self.0.lock() {
            queue.extend(book_ids);
        }
    }

    pub fn take(&self) -> Option<String> {
        self.0.lock().ok()?.pop_front()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilePayload {
    pub book_id: String,
}

/// Rutas de PDF en los argumentos. `args[0]` es el ejecutable y se ignora.
/// Acepta rutas relativas (se resuelven con `cwd`) y URI `file://` (con los `%` decodificados).
/// Ignora opciones (`-…`), lo que no sea PDF y las rutas repetidas.
pub fn pdf_paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') || arg.is_empty() {
            continue;
        }
        let Some(path) = path_from_argument(arg, cwd) else {
            continue;
        };
        if is_pdf(&path) && !paths.contains(&path) {
            paths.push(path);
        }
    }
    paths
}

fn path_from_argument(arg: &str, cwd: &Path) -> Option<PathBuf> {
    if let Some(uri) = arg.strip_prefix("file://") {
        // `file:///ruta` o `file://localhost/ruta`: lo que queda tras el host es la ruta.
        let raw = uri.strip_prefix("localhost").unwrap_or(uri);
        let decoded = percent_decode_str(raw).decode_utf8().ok()?;
        return Some(PathBuf::from(decoded.as_ref()));
    }
    let path = PathBuf::from(arg);
    Some(if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    })
}

fn is_pdf(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

/// Registra los PDF (como una importación) y devuelve los ids de los que se pudieron abrir.
/// Un archivo que falla no impide los demás; el fallo queda en el log.
pub fn open_paths(db: &Mutex<Connection>, paths: &[PathBuf]) -> Vec<String> {
    paths
        .iter()
        .filter_map(|path| match library::register(db, path, Origin::Import) {
            Ok(Some(commit)) => Some(commit.book.id),
            Ok(None) => None,
            Err(error) => {
                tracing::warn!(path = %path.display(), %error, "could not open PDF from arguments");
                None
            }
        })
        .collect()
}

/// Segundo lanzamiento: abre los PDF en la instancia que ya está corriendo, la enfoca y avisa al front.
pub fn handle_second_instance<R: Runtime>(app: &AppHandle<R>, args: &[String], cwd: &Path) {
    let paths = pdf_paths_from_args(args, cwd);
    let state = app.state::<AppState>();
    let opened = open_paths(&state.db, &paths);
    if !opened.is_empty() {
        state.indexer.wake();
    }
    for book_id in opened {
        if let Err(error) = app.emit("app://open-file", OpenFilePayload { book_id }) {
            tracing::warn!(%error, "could not emit app://open-file");
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Hace Atril el lector predeterminado de PDF (`xdg-mime default`).
pub fn set_default_pdf_reader() -> Result<(), AppError> {
    if !desktop_file_installed(&desktop_search_dirs()) {
        return Err(AppError::io(format!(
            "{DESKTOP_FILE} is not installed; install Atril before setting it as the default reader"
        )));
    }
    let status = Command::new("xdg-mime")
        .args(["default", DESKTOP_FILE, PDF_MIME])
        .status()?;
    if !status.success() {
        return Err(AppError::io(format!("xdg-mime exited with {status}")));
    }
    Ok(())
}

/// ¿Es Atril el lector predeterminado de PDF? (`xdg-mime query default`).
pub fn is_default_pdf_reader() -> Result<bool, AppError> {
    let output = Command::new("xdg-mime")
        .args(["query", "default", PDF_MIME])
        .output()?;
    if !output.status.success() {
        return Err(AppError::io(format!(
            "xdg-mime exited with {}",
            output.status
        )));
    }
    Ok(is_default_output(&String::from_utf8_lossy(&output.stdout)))
}

fn is_default_output(stdout: &str) -> bool {
    stdout.trim() == DESKTOP_FILE
}

/// Dónde pueden estar instalados los `.desktop` de la app.
fn desktop_search_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/usr/share/applications"),
        PathBuf::from("/usr/local/share/applications"),
    ];
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/share/applications"));
    }
    dirs
}

fn desktop_file_installed(dirs: &[PathBuf]) -> bool {
    dirs.iter().any(|dir| dir.join(DESKTOP_FILE).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn skips_the_executable_options_and_non_pdf_arguments() {
        let cwd = Path::new("/home/usuario");
        let paths = pdf_paths_from_args(
            &args(&[
                "/usr/bin/atril",
                "--debug",
                "notas.txt",
                "/libros/Ficciones.PDF",
            ]),
            cwd,
        );

        assert_eq!(paths, vec![PathBuf::from("/libros/Ficciones.PDF")]);
    }

    #[test]
    fn relative_paths_resolve_against_cwd_and_duplicates_collapse() {
        let cwd = Path::new("/home/usuario/Descargas");
        let paths = pdf_paths_from_args(
            &args(&["atril", "libro.pdf", "/home/usuario/Descargas/libro.pdf"]),
            cwd,
        );

        assert_eq!(
            paths,
            vec![PathBuf::from("/home/usuario/Descargas/libro.pdf")]
        );
    }

    #[test]
    fn file_uris_are_decoded() {
        let paths = pdf_paths_from_args(
            &args(&[
                "atril",
                "file:///home/u/Mi%20libro%C3%B1.pdf",
                "file://localhost/tmp/a.pdf",
            ]),
            Path::new("/"),
        );

        assert_eq!(
            paths,
            vec![
                PathBuf::from("/home/u/Mi libroñ.pdf"),
                PathBuf::from("/tmp/a.pdf"),
            ]
        );
    }

    #[test]
    fn no_arguments_means_no_paths() {
        assert!(pdf_paths_from_args(&args(&["atril"]), Path::new("/")).is_empty());
        assert!(pdf_paths_from_args(&[], Path::new("/")).is_empty());
    }

    #[test]
    fn pending_queue_is_first_in_first_out_and_empties() {
        let pending = PendingOpen::default();
        assert_eq!(pending.take(), None);

        pending.push_all(vec!["a".into(), "b".into()]);
        pending.push_all(vec!["c".into()]);

        assert_eq!(pending.take().as_deref(), Some("a"));
        assert_eq!(pending.take().as_deref(), Some("b"));
        assert_eq!(pending.take().as_deref(), Some("c"));
        assert_eq!(pending.take(), None);
    }

    #[test]
    fn open_paths_imports_valid_pdfs_and_skips_the_rest() {
        use crate::test_support::{open_temp_db, write_pdf};
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, conn) = open_temp_db();
        let db = Mutex::new(conn);
        let good = write_pdf(dir.path(), "bueno.pdf", 1);
        let bad = dir.path().join("malo.pdf");
        std::fs::write(&bad, b"no es pdf").expect("write");

        let ids = open_paths(&db, &[bad, good.clone()]);

        assert_eq!(ids.len(), 1);
        assert_eq!(ids[0], library::fingerprint(&good).expect("fingerprint"));
    }

    #[test]
    fn default_reader_output_is_compared_to_the_desktop_file() {
        assert!(is_default_output(&format!("{DESKTOP_FILE}\n")));
        assert!(!is_default_output("org.gnome.Evince.desktop\n"));
        assert!(!is_default_output(""));
    }

    #[test]
    fn desktop_file_is_found_only_when_present_in_a_search_dir() {
        let empty = tempfile::tempdir().expect("empty");
        let with_file = tempfile::tempdir().expect("with");
        std::fs::write(with_file.path().join(DESKTOP_FILE), "[Desktop Entry]").expect("write");

        assert!(!desktop_file_installed(&[empty.path().to_path_buf()]));
        assert!(desktop_file_installed(&[
            empty.path().to_path_buf(),
            with_file.path().to_path_buf()
        ]));
    }
}
