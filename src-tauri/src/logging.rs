//! Registro de la app (`tracing`) en un archivo, para poder diagnosticar problemas de un usuario.
//!
//! En las compilaciones de release de Windows (`windows_subsystem = "windows"`) no hay consola: stdout y stderr no
//! existen y todo lo que se registre se pierde. Por eso el registro va siempre a `<data_dir>/atril.log` (en Windows,
//! `%LOCALAPPDATA%\atril\atril.log`). Al arrancar, el anterior pasa a `atril.old.log` (solo se guarda uno). En
//! desarrollo (`debug_assertions`) también va a stderr. Si el archivo no se puede abrir, la app sigue sin él.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::MakeWriter;

pub const LOG_FILE_NAME: &str = "atril.log";
pub const OLD_LOG_FILE_NAME: &str = "atril.old.log";

/// Ruta del registro actual dentro de `data_dir`.
pub fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOG_FILE_NAME)
}

/// Deja listo `<data_dir>/atril.log`: rota el anterior a `atril.old.log` y crea uno vacío.
/// Con `Err`, la app sigue sin registro en archivo.
pub fn open_log_file(data_dir: &Path) -> io::Result<File> {
    let current = log_path(data_dir);
    let old = data_dir.join(OLD_LOG_FILE_NAME);
    if current.exists() {
        // En Windows `rename` no sobrescribe: se borra el viejo antes. Si falla (otro proceso lo tiene abierto), el
        // actual se reutiliza añadiendo al final.
        let _ = std::fs::remove_file(&old);
        let _ = std::fs::rename(&current, &old);
    }
    OpenOptions::new().create(true).append(true).open(current)
}

/// Destino de cada línea: el archivo (si se pudo abrir) y, en desarrollo, stderr.
#[derive(Clone)]
struct LogWriter {
    file: Option<Arc<Mutex<File>>>,
    stderr: bool,
}

struct LogSink {
    file: Option<Arc<Mutex<File>>>,
    stderr: bool,
}

impl<'a> MakeWriter<'a> for LogWriter {
    type Writer = LogSink;

    fn make_writer(&'a self) -> LogSink {
        LogSink {
            file: self.file.clone(),
            stderr: self.stderr,
        }
    }
}

fn locked(file: &Mutex<File>) -> MutexGuard<'_, File> {
    // Un pánico en otro hilo mientras escribía no debe dejar la app sin registro.
    file.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Write for LogSink {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if let Some(file) = &self.file {
            // Registrar nunca debe romper la app: los errores de escritura se ignoran.
            let _ = locked(file).write_all(buf);
        }
        if self.stderr {
            let _ = io::stderr().write_all(buf);
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        if let Some(file) = &self.file {
            let _ = locked(file).flush();
        }
        Ok(())
    }
}

/// Instala el registro global. `data_dir` es `None` si la carpeta de datos no está disponible. Nivel `info` por
/// defecto, o el de `RUST_LOG`. Llamarlo dos veces no hace nada la segunda vez.
pub fn init(data_dir: Option<&Path>) {
    let (file, file_error) = match data_dir.map(open_log_file) {
        Some(Ok(file)) => (Some(Arc::new(Mutex::new(file))), None),
        Some(Err(error)) => (None, Some(error)),
        None => (None, None),
    };
    let writer = LogWriter {
        file,
        stderr: cfg!(debug_assertions),
    };
    let installed = tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_ansi(false)
        .with_writer(writer)
        .try_init()
        .is_ok();
    if !installed {
        return;
    }

    install_panic_hook();
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        os = std::env::consts::OS,
        arch = std::env::consts::ARCH,
        debug = cfg!(debug_assertions),
        data_dir = %data_dir.map_or_else(|| "<none>".to_owned(), |dir| dir.display().to_string()),
        "atril starting"
    );
    if let Some(error) = file_error {
        tracing::warn!(%error, "could not open the log file; logging without it");
    }
}

/// Que un pánico (en cualquier hilo) quede en el registro, con el hilo y la ubicación, y siga el hook anterior.
fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let location = info.location().map_or_else(
            || "<unknown>".to_owned(),
            |at| format!("{}:{}:{}", at.file(), at.line(), at.column()),
        );
        tracing::error!(
            thread = thread.name().unwrap_or("<unnamed>"),
            %location,
            "panic: {}",
            panic_message(info.payload())
        );
        previous(info);
    }));
}

fn panic_message(payload: &(dyn std::any::Any + Send)) -> &str {
    if let Some(text) = payload.downcast_ref::<&str>() {
        text
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text
    } else {
        "<non-string panic payload>"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_previous_log_is_rotated_and_only_one_is_kept() {
        let dir = tempfile::tempdir().expect("tempdir");

        let mut first = open_log_file(dir.path()).expect("first");
        first.write_all(b"run 1\n").expect("write");
        drop(first);
        let mut second = open_log_file(dir.path()).expect("second");
        second.write_all(b"run 2\n").expect("write");
        drop(second);
        let mut third = open_log_file(dir.path()).expect("third");
        third.write_all(b"run 3\n").expect("write");
        drop(third);

        let read = |name: &str| std::fs::read_to_string(dir.path().join(name)).expect("read");
        assert_eq!(read(LOG_FILE_NAME), "run 3\n");
        assert_eq!(read(OLD_LOG_FILE_NAME), "run 2\n");
    }

    #[test]
    fn a_missing_data_dir_means_no_file_and_no_panic() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(open_log_file(&dir.path().join("does-not-exist")).is_err());
    }

    #[test]
    fn the_sink_writes_whole_lines_to_the_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = open_log_file(dir.path()).expect("open");
        let writer = LogWriter {
            file: Some(Arc::new(Mutex::new(file))),
            stderr: false,
        };

        let mut sink = writer.make_writer();
        sink.write_all(b"hello\n").expect("write");
        sink.flush().expect("flush");

        let text = std::fs::read_to_string(log_path(dir.path())).expect("read");
        assert_eq!(text, "hello\n");
    }

    #[test]
    fn panic_payloads_are_readable() {
        let literal = std::panic::catch_unwind(|| panic!("literal")).expect_err("panic");
        assert_eq!(panic_message(literal.as_ref()), "literal");
        let formatted = std::panic::catch_unwind(|| panic!("n = {}", 3)).expect_err("panic");
        assert_eq!(panic_message(formatted.as_ref()), "n = 3");
    }
}
