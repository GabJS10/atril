//! Cómo se abre un PDF en MuPDF: por ruta (lo normal) o leído entero a memoria (archivos pequeños en Windows).
//!
//! **Bloqueo de archivos en Windows.** MuPDF abre los archivos con `fopen`, y el `fopen` de Windows no comparte
//! `FILE_SHARE_DELETE`: mientras un documento está abierto, el Explorador no puede renombrar, mover ni borrar el
//! PDF ("el archivo está abierto en otro programa"). Es justo lo que Atril promete evitar (mover o renombrar un
//! libro conserva su progreso). Los hilos del motor mantienen abiertos sus documentos (un LRU por hilo), así que
//! el bloqueo duraría mucho más que la lectura.
//!
//! La solución es no dejar el archivo abierto: los PDF de hasta [`IN_MEMORY_MAX_BYTES`] se leen enteros con
//! `std::fs` (que sí comparte `FILE_SHARE_DELETE`) y MuPDF trabaja sobre la copia en memoria. Los grandes siguen
//! abriéndose por ruta: cada hilo de MuPDF abre **su propia copia** del documento (3 hilos), y copiar cientos de MB
//! por hilo (un escaneo de 350 MB serían ~1 GB) costaría más que el bloqueo. En Linux y macOS borrar o renombrar un
//! archivo abierto no es problema, y siempre se abre por ruta.

use std::borrow::Cow;
use std::path::Path;

use mupdf::Document;

use super::EngineError;

/// En esta plataforma, un archivo abierto por MuPDF no se puede renombrar ni borrar.
pub const LOCKS_OPEN_FILES: bool = cfg!(windows);

/// Los PDF de hasta este tamaño se leen enteros a memoria cuando [`LOCKS_OPEN_FILES`] es `true`. Cada hilo de MuPDF
/// guarda su propia copia, así que un libro abierto ocupa hasta 3 veces su tamaño (48 MiB como máximo): la mayoría
/// de los libros de texto caben, y los escaneos grandes, no.
pub const IN_MEMORY_MAX_BYTES: u64 = 16 * 1024 * 1024;

/// Una ruta absoluta de Windows de al menos estos caracteres (UTF-16) se pasa a MuPDF con el prefijo `\\?\`: la
/// ruta normal de Win32 admite 259 y MuPDF abre con `_wfopen`, sin soporte de rutas largas.
const LONG_PATH_CHARS: usize = 248;

/// Prefijo de las rutas "verbatim" de Windows (sin límite de longitud, pero tampoco normalización).
const VERBATIM_PREFIX: &str = r"\\?\";

/// Cómo se le da el archivo a MuPDF.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strategy {
    /// MuPDF abre el archivo y lo mantiene abierto mientras viva el documento.
    Path,
    /// Se lee entero a memoria y el archivo se cierra enseguida.
    Memory,
}

/// Qué estrategia corresponde a un archivo de `size` bytes. Función pura (recibe la plataforma) para probar las
/// dos plataformas desde cualquiera.
pub fn strategy_for(size: u64, locks_open_files: bool) -> Strategy {
    if locks_open_files && size <= IN_MEMORY_MAX_BYTES {
        Strategy::Memory
    } else {
        Strategy::Path
    }
}

/// Abre el PDF `path` con la estrategia de esta plataforma (ver el módulo).
pub fn open_document(path: &Path) -> Result<Document, EngineError> {
    if LOCKS_OPEN_FILES {
        let size = std::fs::metadata(path)
            .map_err(|error| read_error(path, &error))?
            .len();
        if strategy_for(size, LOCKS_OPEN_FILES) == Strategy::Memory {
            return open_from_memory(path);
        }
    }
    open_by_path(path)
}

/// Abre el PDF por ruta: MuPDF mantiene el archivo abierto mientras viva el documento.
#[cfg(not(windows))]
pub fn open_by_path(path: &Path) -> Result<Document, EngineError> {
    Document::open(path).map_err(invalid_pdf)
}

/// Abre el PDF por ruta: MuPDF mantiene el archivo abierto mientras viva el documento. En Windows MuPDF pide la
/// ruta en UTF-8 y la convierte a UTF-16 (admite cualquier carácter Unicode, pero no rutas de más de 259
/// caracteres sin el prefijo `\\?\`, ver [`windows_path`]).
#[cfg(windows)]
pub fn open_by_path(path: &Path) -> Result<Document, EngineError> {
    let text = path
        .to_str()
        .ok_or_else(|| EngineError::Io(format!("{} is not a valid UTF-8 path", path.display())))?;
    let text: &str = &windows_path(text);
    Document::open(text).map_err(invalid_pdf)
}

/// Lee el PDF entero con `std::fs` (que no bloquea el archivo) y se lo da a MuPDF desde memoria.
pub fn open_from_memory(path: &Path) -> Result<Document, EngineError> {
    let bytes = std::fs::read(path).map_err(|error| read_error(path, &error))?;
    Document::from_bytes(&bytes, "pdf").map_err(invalid_pdf)
}

/// La ruta tal como se le pasa a MuPDF en Windows: igual, salvo las rutas absolutas largas (de
/// [`LONG_PATH_CHARS`] caracteres o más), que llevan el prefijo `\\?\` (`\\?\UNC\servidor\recurso\…` en las
/// de red) y solo barras `\`, porque el prefijo desactiva la normalización de Win32. No toca rutas relativas, ya
/// verbatim ni con segmentos `.` o `..`. Es pura y no depende de la plataforma para poder probarla en cualquiera.
pub fn windows_path(path: &str) -> Cow<'_, str> {
    if path.encode_utf16().count() < LONG_PATH_CHARS || path.starts_with(r"\\?\") {
        return Cow::Borrowed(path);
    }
    let backslashed = path.replace('/', r"\");
    let has_dot_segments = backslashed
        .split('\\')
        .any(|segment| segment == "." || segment == "..");
    if has_dot_segments {
        return Cow::Borrowed(path);
    }
    if let Some(unc) = backslashed.strip_prefix(r"\\") {
        // `\\.\` (dispositivos) no es una ruta de archivo; `\\servidor\recurso\…` sí.
        if unc.starts_with(".\\") || unc.is_empty() {
            return Cow::Borrowed(path);
        }
        return Cow::Owned(format!(r"{VERBATIM_PREFIX}UNC\{unc}"));
    }
    let mut chars = backslashed.chars();
    let is_drive_absolute = matches!(
        (chars.next(), chars.next(), chars.next()),
        (Some(drive), Some(':'), Some('\\')) if drive.is_ascii_alphabetic()
    );
    if is_drive_absolute {
        Cow::Owned(format!("{VERBATIM_PREFIX}{backslashed}"))
    } else {
        Cow::Borrowed(path)
    }
}

fn read_error(path: &Path, error: &std::io::Error) -> EngineError {
    EngineError::Io(format!("could not read {}: {error}", path.display()))
}

fn invalid_pdf(error: mupdf::Error) -> EngineError {
    EngineError::InvalidPdf(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::OpenDocument;
    use crate::engine::testpdf::text_book;

    /// Ruta absoluta de unidad con exactamente `len` caracteres ASCII.
    fn long_path(len: usize) -> String {
        let mut path = String::from(r"C:\Users\lector\Libros");
        while path.len() < len {
            path.push_str(r"\Economia y politica");
        }
        path.truncate(len);
        path
    }

    #[test]
    fn small_files_go_to_memory_only_where_open_files_are_locked() {
        assert_eq!(strategy_for(0, true), Strategy::Memory);
        assert_eq!(strategy_for(IN_MEMORY_MAX_BYTES, true), Strategy::Memory);
        assert_eq!(strategy_for(IN_MEMORY_MAX_BYTES + 1, true), Strategy::Path);
        assert_eq!(strategy_for(350 << 20, true), Strategy::Path);
        assert_eq!(strategy_for(0, false), Strategy::Path);
        assert_eq!(strategy_for(1024, false), Strategy::Path);
    }

    #[test]
    fn short_and_unusual_windows_paths_are_left_alone() {
        for path in [
            r"C:\Libros\a.pdf",
            r"\\servidor\recurso\a.pdf",
            r"relativa\a.pdf",
            r"\\?\C:\Libros\a.pdf",
            "",
        ] {
            assert_eq!(windows_path(path), path);
        }
    }

    #[test]
    fn long_drive_paths_get_the_verbatim_prefix_and_backslashes() {
        let path = long_path(300);
        assert_eq!(windows_path(&path), format!(r"\\?\{path}"));

        let slashed = path.replace('\\', "/");
        assert_eq!(windows_path(&slashed), format!(r"\\?\{path}"));
    }

    #[test]
    fn long_unc_paths_use_the_unc_form() {
        let mut path = String::from(r"\\servidor\recurso");
        while path.len() < 300 {
            path.push_str(r"\carpeta larga");
        }
        let converted = windows_path(&path);
        assert!(
            converted.starts_with(r"\\?\UNC\servidor\recurso\"),
            "{converted}"
        );
        assert_eq!(&converted[r"\\?\UNC".len()..], &path[1..]);
    }

    #[test]
    fn long_paths_that_cannot_be_made_verbatim_are_left_alone() {
        let with_dots = format!(r"{}\..\x.pdf", long_path(300));
        let relative = format!("libros{}", &long_path(300)[2..]);
        let device = format!(r"\\.\{}", "x".repeat(300));
        for path in [with_dots, relative, device] {
            assert_eq!(windows_path(&path), path.as_str());
        }
    }

    #[test]
    fn the_length_limit_counts_utf16_units_not_bytes() {
        // 120 letras con tilde son 240 bytes en UTF-8 pero 120 unidades en UTF-16: la ruta aún cabe en MAX_PATH.
        let accents = "é".repeat(120);
        let short = format!(r"C:\{accents}\a.pdf");
        assert!(short.len() > LONG_PATH_CHARS);
        assert_eq!(windows_path(&short), short.as_str());

        let long = format!(r"C:\{}\a.pdf", "é".repeat(LONG_PATH_CHARS));
        assert!(windows_path(&long).starts_with(r"\\?\C:\"));
    }

    fn write_book(dir: &Path, name: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, text_book(2)).expect("write pdf");
        path
    }

    #[test]
    fn opening_from_memory_and_by_path_give_the_same_document() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_book(dir.path(), "libro.pdf");

        let by_path = open_by_path(&path).expect("by path");
        let in_memory = open_from_memory(&path).expect("from memory");

        assert_eq!(by_path.page_count().expect("pages"), 2);
        assert_eq!(in_memory.page_count().expect("pages"), 2);
    }

    #[test]
    fn a_document_opened_from_memory_does_not_need_the_file_anymore() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_book(dir.path(), "libro.pdf");

        let document = open_from_memory(&path).expect("from memory");
        std::fs::remove_file(&path).expect("the file is free to delete");

        assert_eq!(document.page_count().expect("pages"), 2);
    }

    #[test]
    fn non_ascii_and_spaced_names_open_by_path_and_from_memory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let folder = dir.path().join("Economía y política");
        std::fs::create_dir_all(&folder).expect("mkdir");
        let path = write_book(&folder, "¿Qué es el dinero ñandú 日本語.pdf");

        assert_eq!(
            open_by_path(&path)
                .expect("by path")
                .page_count()
                .expect("pages"),
            2
        );
        assert_eq!(
            open_from_memory(&path)
                .expect("from memory")
                .page_count()
                .expect("pages"),
            2
        );
    }

    /// Rutas de más de 259 caracteres: `std` añade solo el prefijo `\\?\` en Windows, pero MuPDF abre con
    /// `_wfopen` y hay que dárselo (`windows_path`).
    #[test]
    fn a_book_in_a_very_long_path_opens_by_path_and_from_memory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut folder = dir.path().to_path_buf();
        while folder.as_os_str().len() < 330 {
            folder.push("una carpeta con un nombre bastante largo");
        }
        std::fs::create_dir_all(&folder).expect("a long folder");
        let path = write_book(&folder, "libro.pdf");
        assert!(path.as_os_str().len() > 330);

        assert_eq!(
            open_by_path(&path)
                .expect("by path")
                .page_count()
                .expect("pages"),
            2
        );
        assert_eq!(
            open_from_memory(&path)
                .expect("from memory")
                .page_count()
                .expect("pages"),
            2
        );
        assert_eq!(OpenDocument::open(&path).expect("open").page_count(), 2);
    }

    /// Documenta el límite de los libros grandes (que se abren por ruta): MuPDF mantiene el archivo abierto con
    /// `fopen` y Windows no deja renombrarlo hasta que se cierra el documento. Si esta prueba dejara de cumplirse,
    /// MuPDF ya no bloquea y `Strategy::Memory` sobraría.
    #[cfg(windows)]
    #[test]
    fn a_book_open_by_path_cannot_be_renamed_on_windows_until_it_is_closed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_book(dir.path(), "libro.pdf");
        let renamed = dir.path().join("renombrado.pdf");
        let document = open_by_path(&path).expect("by path");

        assert!(
            std::fs::rename(&path, &renamed).is_err(),
            "open files are locked"
        );

        drop(document);
        std::fs::rename(&path, &renamed).expect("free once the document is closed");
    }

    #[test]
    fn errors_keep_their_meaning_for_both_strategies() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fake = dir.path().join("falso.pdf");
        std::fs::write(&fake, b"this is not a pdf at all").expect("write");
        let missing = dir.path().join("no-existe.pdf");

        assert!(matches!(
            open_by_path(&fake),
            Err(EngineError::InvalidPdf(_))
        ));
        assert!(matches!(
            open_from_memory(&fake),
            Err(EngineError::InvalidPdf(_))
        ));
        assert!(matches!(
            open_from_memory(&missing),
            Err(EngineError::Io(_))
        ));
        assert!(matches!(
            OpenDocument::open(&missing),
            Err(EngineError::Io(_))
        ));
    }

    /// El motor no debe impedir que el usuario renombre, mueva o borre un libro pequeño que tiene abierto. En
    /// Windows lo garantiza leerlo a memoria; en Linux y macOS lo permite el sistema. La misma prueba corre en
    /// todas: es la que detecta si MuPDF volviera a dejar el archivo bloqueado.
    #[test]
    fn a_small_book_open_in_the_engine_can_be_renamed_and_deleted() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_book(dir.path(), "libro.pdf");
        let document = OpenDocument::open(&path).expect("open");

        let renamed = dir.path().join("renombrado.pdf");
        std::fs::rename(&path, &renamed).expect("rename an open book");
        assert_eq!(document.page_count(), 2);
        assert!(document.render_jpeg(1, 1.0).is_ok(), "still renders");

        std::fs::remove_file(&renamed).expect("delete an open book");
        assert!(document.render_jpeg(2, 1.0).is_ok(), "still renders");
    }
}
