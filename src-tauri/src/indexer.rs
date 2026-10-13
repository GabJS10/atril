//! Indexador nativo de la biblioteca (fase R1.3). Para cada libro pendiente saca el número de páginas, el título
//! y el autor del PDF, y la portada (la página 1 a 400 px de ancho, JPEG), y lo guarda con `library::save_book_scan`.
//!
//! Hilo y prioridad: un hilo propio (`atril-indexer`) con su propia copia del documento de MuPDF. Cada hilo de
//! MuPDF tiene su contexto, así que no comparte nada con el pool del visor. El hilo baja su prioridad del sistema
//! (nice 19 en Linux, por hilo) y no empieza un libro mientras haya renders del visor en cola.
//!
//! Es el único indexador: el front no indexa ni guarda portadas, solo recibe `library://changed` (docs/IPC.md).
//!
//! Título: el de los metadatos solo vale si dice algo (ver [`clean_metadata_text`] y [`clean_title`]). Si no vale,
//! el libro se queda con el nombre del archivo sin extensión.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use mupdf::MetadataName;
use regex::Regex;
use rusqlite::Connection;
use tauri::AppHandle;

use crate::engine::{Engine, EngineError, OpenDocument, geometry};
use crate::library::{self, ScanInput};
use crate::protocol;
use crate::watch;

/// Ancho de la portada en píxeles.
pub const COVER_WIDTH_PX: f64 = 400.0;
/// Longitud máxima de un título o autor, en caracteres.
pub const MAX_METADATA_LENGTH: usize = 200;
/// Cada cuánto se busca trabajo aunque nadie avise (libros que entran por una vía sin aviso).
const POLL: Duration = Duration::from_secs(30);
/// Espera entre comprobaciones de la cola del visor mientras el indexador cede.
const YIELD: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextKind {
    Title,
    Author,
}

/// Ningún carácter es una letra ASCII (solo dígitos, símbolos o letras no latinas).
const NO_LETTERS: &str = r"^[^A-Za-z]+$";

/// Títulos que no dicen nada.
static JUNK_TITLE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    compile(&[
        r"(?i)^microsoft (word|excel|powerpoint|office)\b",
        r"(?i)\.(docx?|pdf|indd|tex|pages|rtf|odt|pptx?|xlsx?|dvi|ps|txt)\s*$",
        r"(?i)^(untitled|sin t[ií]tulo)(\s*\d*)?$",
        r"(?i)^(null|undefined|none|n/a)$",
        // Un nombre de archivo: sin espacios y acabado en `.` + 2-5 letras o dígitos (`01-Prefacio_3a.pmd`).
        // Con espacios solo valen las extensiones conocidas de arriba, para no perder `Dr. Smith`.
        r"^\S+\.[A-Za-z0-9]{2,5}$",
        NO_LETTERS,
    ])
});

/// Autores que no dicen nada.
static JUNK_AUTHOR: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    compile(&[
        r"(?i)^(anonymous|anonimo|an[oó]nimo|unknown|desconocido|author|autor|null|undefined|none|n/a)$",
        NO_LETTERS,
    ])
});

/// Los patrones son constantes; un patrón inválido se omite (la prueba `junk_patterns_compile` lo vigila).
fn compile(patterns: &[&str]) -> Vec<Regex> {
    patterns
        .iter()
        .filter_map(|pattern| Regex::new(pattern).ok())
        .collect()
}

/// Limpia un título o autor de los metadatos del PDF: colapsa los espacios, descarta lo basura y limita la longitud.
/// `None` si no vale la pena mostrarlo (así el título se queda con el nombre del archivo).
pub fn clean_metadata_text(value: Option<&str>, kind: TextKind) -> Option<String> {
    let text = value?.split_whitespace().collect::<Vec<_>>().join(" ");
    // Como `text.length < 2` en JavaScript: cuenta unidades UTF-16.
    if text.encode_utf16().count() < 2 {
        return None;
    }
    let junk = match kind {
        TextKind::Title => &JUNK_TITLE,
        TextKind::Author => &JUNK_AUTHOR,
    };
    if junk.iter().any(|pattern| pattern.is_match(&text)) {
        return None;
    }
    Some(text.chars().take(MAX_METADATA_LENGTH).collect())
}

/// Título de los metadatos listo para guardar: limpio ([`clean_metadata_text`]) y distinto del nombre del archivo,
/// con o sin extensión y sin distinguir mayúsculas. `None` si no vale (el libro se queda con el nombre del archivo).
pub fn clean_title(value: Option<&str>, file_name: Option<&str>) -> Option<String> {
    let title = clean_metadata_text(value, TextKind::Title)?;
    let same_as_file = file_name.is_some_and(|name| {
        let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
        let stem = Path::new(&name)
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        title.to_lowercase() == name.to_lowercase() || title.to_lowercase() == stem.to_lowercase()
    });
    (!same_as_file).then_some(title)
}

/// Resultado de indexar un libro.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Metadatos y portada guardados (`scan_state = done`).
    Done,
    /// MuPDF no puede abrirlo o no tiene páginas (`scan_state = failed`).
    Failed,
    /// El archivo ya no está (`missing = 1`).
    Missing,
    /// Se calculó, pero no se pudo guardar (la base de datos o la portada). Queda pendiente hasta reiniciar.
    Error,
}

/// Un libro procesado en una pasada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Indexed {
    pub book_id: String,
    pub outcome: Outcome,
    pub elapsed: Duration,
}

/// Lo que se guarda de un libro: sus metadatos y la portada.
struct Scan {
    input: ScanInput,
    cover: Vec<u8>,
}

/// Abre el PDF con MuPDF y calcula lo que guarda el indexador. Trabaja sin tocar la base de datos.
fn read_scan(path: &Path) -> Result<Scan, EngineError> {
    let document = OpenDocument::open(path)?;
    let page_count = document.page_count();
    if page_count == 0 {
        return Err(EngineError::InvalidPdf("the PDF has no pages".into()));
    }
    let first = geometry::page_geometry(&document.page_boxes(0));
    let title = document.pdf().metadata(MetadataName::Title).ok();
    let file_name = path.file_name().map(|name| name.to_string_lossy());
    let author = document.pdf().metadata(MetadataName::Author).ok();
    let cover = document.render_jpeg(1, COVER_WIDTH_PX / first.width.max(1.0))?;

    Ok(Scan {
        input: ScanInput {
            page_count: i64::from(page_count),
            title: clean_title(title.as_deref(), file_name.as_deref()),
            author: clean_metadata_text(author.as_deref(), TextKind::Author),
        },
        cover,
    })
}

/// Indexa un libro: lee el PDF, guarda metadatos y portada, o lo marca `failed` / `missing`.
pub fn index_book(db: &Mutex<Connection>, covers_dir: &Path, id: &str, path: &Path) -> Outcome {
    if !path.is_file() {
        protocol::mark_missing(db, id);
        return Outcome::Missing;
    }
    let scan = match read_scan(path) {
        Ok(scan) => scan,
        Err(error) => {
            // El archivo pudo desaparecer entre la comprobación y la apertura.
            if !path.is_file() {
                protocol::mark_missing(db, id);
                return Outcome::Missing;
            }
            tracing::warn!(book = id, %error, "could not index book; marked as failed");
            return mark_failed(db, id);
        }
    };
    let saved = library::lock_db(db)
        .and_then(|conn| library::save_book_scan(&conn, covers_dir, id, &scan.input, &scan.cover));
    match saved {
        Ok(_) => Outcome::Done,
        Err(error) => {
            tracing::warn!(book = id, %error, "could not save the scan of book");
            Outcome::Error
        }
    }
}

fn mark_failed(db: &Mutex<Connection>, id: &str) -> Outcome {
    match library::lock_db(db).and_then(|conn| library::mark_scan_failed(&conn, id)) {
        Ok(_) => Outcome::Failed,
        Err(error) => {
            tracing::warn!(book = id, %error, "could not mark book as failed");
            Outcome::Error
        }
    }
}

/// Una pasada: indexa, uno a uno, los libros pendientes que no están ya en `attempted` (así un libro que falla
/// no se reintenta en bucle). `before_each` se llama antes de cada libro y `on_indexed` después de cada uno.
pub fn index_pending(
    db: &Mutex<Connection>,
    covers_dir: &Path,
    attempted: &mut HashSet<String>,
    mut before_each: impl FnMut(),
    mut on_indexed: impl FnMut(&Indexed),
) -> Vec<Indexed> {
    let pending = match library::lock_db(db).and_then(|conn| library::pending_scan_paths(&conn)) {
        Ok(pending) => pending,
        Err(error) => {
            tracing::warn!(%error, "could not list the books to index");
            return Vec::new();
        }
    };
    let mut report = Vec::new();
    for (id, path) in pending {
        if !attempted.insert(id.clone()) {
            continue;
        }
        before_each();
        let started = Instant::now();
        let outcome = index_book(db, covers_dir, &id, &path);
        let indexed = Indexed {
            book_id: id,
            outcome,
            elapsed: started.elapsed(),
        };
        tracing::info!(book = %indexed.book_id, ?outcome, elapsed_ms = indexed.elapsed.as_millis() as u64, "indexed book");
        on_indexed(&indexed);
        report.push(indexed);
    }
    report
}

/// Despierta al indexador. No espera: si ya hay una pasada en curso, se hace otra al acabar.
#[derive(Clone)]
pub struct Handle {
    wake: Sender<()>,
}

impl Handle {
    pub fn wake(&self) {
        // Si el hilo ya no existe, no hay nada que despertar.
        let _ = self.wake.send(());
    }
}

/// Arranca el hilo del indexador. Hace una pasada al momento y después al despertarlo o cada `POLL`.
pub fn spawn(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    covers_dir: PathBuf,
    engine: Arc<Engine>,
) -> Handle {
    let (tx, rx) = mpsc::channel();
    let spawned = thread::Builder::new()
        .name("atril-indexer".into())
        .spawn(move || run(&app, &db, &covers_dir, &engine, &rx));
    if let Err(error) = spawned {
        tracing::error!(%error, "could not start the library indexer");
    }
    Handle { wake: tx }
}

fn run(
    app: &AppHandle,
    db: &Mutex<Connection>,
    covers_dir: &Path,
    engine: &Engine,
    wakes: &Receiver<()>,
) {
    lower_priority();
    let mut attempted = HashSet::new();
    loop {
        index_pending(
            db,
            covers_dir,
            &mut attempted,
            // El visor tiene prioridad: no se empieza un libro mientras haya renders en cola.
            || {
                while engine.queued_renders() > 0 {
                    thread::sleep(YIELD);
                }
            },
            |indexed| {
                // Cada libro abre un documento y renderiza su portada en el store compartido de MuPDF: se recorta.
                engine.trim_store();
                if indexed.outcome == Outcome::Done {
                    watch::emit_changed(app, "index");
                }
            },
        );
        match wakes.recv_timeout(POLL) {
            Ok(()) => while wakes.try_recv().is_ok() {},
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// Baja la prioridad de este hilo. En Linux `nice` es por hilo, así que solo afecta al indexador.
/// En otros sistemas no hace nada (Windows está en el backlog).
fn lower_priority() {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: `gettid` no tiene precondiciones y `setpriority` solo cambia la prioridad de este hilo.
        let tid = unsafe { libc::gettid() } as libc::id_t;
        if unsafe { libc::setpriority(libc::PRIO_PROCESS, tid, 19) } != 0 {
            tracing::debug!("could not lower the priority of the indexer thread");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::testpdf::{Info, Inherited, PageSpec, build_pdf, build_pdf_with_info};
    use crate::library::{get_book, pending_scan_paths};
    use crate::test_support::{import, jpeg_bytes, open_temp_db, write_pdf};

    fn title(text: &str) -> Option<String> {
        clean_metadata_text(Some(text), TextKind::Title)
    }

    fn author(text: &str) -> Option<String> {
        clean_metadata_text(Some(text), TextKind::Author)
    }

    #[test]
    fn junk_patterns_compile() {
        assert_eq!(JUNK_TITLE.len(), 6);
        assert_eq!(JUNK_AUTHOR.len(), 2);
    }

    #[test]
    fn metadata_keeps_real_titles_and_authors_and_collapses_spaces() {
        assert_eq!(
            title("  El   Estado\n\tdel  bienestar ").as_deref(),
            Some("El Estado del bienestar")
        );
        assert_eq!(author("Ana Pérez").as_deref(), Some("Ana Pérez"));
        assert_eq!(title("Anónimo").as_deref(), Some("Anónimo"));
    }

    #[test]
    fn metadata_drops_word_processor_names_placeholders_and_numbers() {
        for junk in [
            "Microsoft Word - tesis.docx",
            "Microsoft Excel",
            "tesis.PDF",
            "capitulo 3.txt",
            "Untitled",
            "Untitled 2",
            "sin título",
            "null",
            "N/A",
            "1234",
            "— · —",
            "A",
            "   ",
        ] {
            assert_eq!(title(junk), None, "title {junk:?}");
        }
        for junk in [
            "Anónimo",
            "anonimo",
            "Autor",
            "desconocido",
            "n/a",
            "2024",
            "",
        ] {
            assert_eq!(author(junk), None, "author {junk:?}");
        }
    }

    #[test]
    fn metadata_is_capped_at_200_characters() {
        let long = "Historia ".repeat(40);
        let cleaned = title(&long).expect("kept");
        assert_eq!(cleaned.chars().count(), MAX_METADATA_LENGTH);
        assert_eq!(clean_metadata_text(None, TextKind::Title), None);
    }

    #[test]
    fn titles_without_ascii_letters_are_dropped() {
        // Sin letras ASCII es basura.
        assert_eq!(title("日本語"), None);
        assert_eq!(title("Ópera").as_deref(), Some("Ópera"));
    }

    #[test]
    fn titles_that_look_like_file_names_are_dropped() {
        for junk in [
            "01-Prefacio_3a.pmd",
            "scan_0012.pdf",
            "capitulo-1.QXD",
            "documento.doc",
            "IMG_0001.jpeg",
            "libro.x1",
        ] {
            assert_eq!(title(junk), None, "title {junk:?}");
        }
        for kept in [
            "Fe Explicada",
            "Dr. Smith",
            "El Estado",
            "Sagrada Biblia",
            "Historia de España. Siglo XX",
            "Fe",
        ] {
            assert_eq!(title(kept).as_deref(), Some(kept), "title {kept:?}");
        }
        // La regla es solo de títulos: un autor con punto se queda.
        assert_eq!(author("Smith.Jr").as_deref(), Some("Smith.Jr"));
    }

    #[test]
    fn a_title_equal_to_the_file_name_is_dropped_with_or_without_extension() {
        let file = Some("Socialismo, cálculo económico -- Huerta de Soto.pdf");
        assert_eq!(
            clean_title(
                Some("Socialismo, cálculo económico -- Huerta de Soto"),
                file
            ),
            None
        );
        assert_eq!(
            clean_title(
                Some("socialismo, cálculo económico -- huerta de soto.PDF"),
                file
            ),
            None
        );
        assert_eq!(
            clean_title(Some("Socialismo, cálculo económico"), file).as_deref(),
            Some("Socialismo, cálculo económico")
        );
        assert_eq!(
            clean_title(Some("Fe Explicada"), None).as_deref(),
            Some("Fe Explicada")
        );
    }

    #[test]
    fn reindexing_with_the_new_rule_leaves_the_file_stem_as_the_title() {
        let books = tempfile::tempdir().expect("books");
        let covers = tempfile::tempdir().expect("covers");
        let (_db_dir, mut conn) = open_temp_db();
        let path = pdf_with_info(
            books.path(),
            "Libro de prueba.pdf",
            1,
            Some(Info {
                title: Some("01-Prefacio_3a.pmd".into()),
                author: Some("Ana Pérez".into()),
            }),
        );
        let book = import(&mut conn, &path);
        // Estado de un libro indexado con la regla vieja: el título de los metadatos ganó al nombre del archivo.
        library::save_book_scan(
            &conn,
            covers.path(),
            &book.id,
            &ScanInput {
                page_count: 1,
                title: Some("01-Prefacio_3a.pmd".into()),
                author: None,
            },
            &jpeg_bytes(1000),
        )
        .expect("old scan");
        assert_eq!(
            get_book(&conn, &book.id).expect("book").title,
            "01-Prefacio_3a.pmd"
        );
        // La migración 0005 lo deja pendiente.
        conn.execute(
            "UPDATE books SET scan_state = 'pending' WHERE id = ?1",
            [&book.id],
        )
        .expect("pending");

        let db = Mutex::new(conn);
        let report = index_pending(&db, covers.path(), &mut HashSet::new(), || {}, |_| {});

        assert_eq!(report.len(), 1);
        assert_eq!(report[0].outcome, Outcome::Done);
        let conn = db.lock().expect("lock");
        let book = get_book(&conn, &book.id).expect("book");
        assert_eq!(book.title, "Libro de prueba");
        assert_eq!(book.author.as_deref(), Some("Ana Pérez"));
        let source: String = conn
            .query_row(
                "SELECT title_source FROM books WHERE id = ?1",
                [&book.id],
                |row| row.get(0),
            )
            .expect("source");
        assert_eq!(source, "filename", "the title follows the file name again");
    }

    #[test]
    fn a_user_title_survives_a_reindex_without_metadata_title() {
        let books = tempfile::tempdir().expect("books");
        let covers = tempfile::tempdir().expect("covers");
        let (_db_dir, mut conn) = open_temp_db();
        let book = import(&mut conn, &pdf_with_info(books.path(), "a.pdf", 1, None));
        conn.execute(
            "UPDATE books SET title = 'Mi título', title_source = 'user', scan_state = 'pending' WHERE id = ?1",
            [&book.id],
        )
        .expect("user title");

        let db = Mutex::new(conn);
        index_pending(&db, covers.path(), &mut HashSet::new(), || {}, |_| {});

        let conn = db.lock().expect("lock");
        assert_eq!(get_book(&conn, &book.id).expect("book").title, "Mi título");
    }

    /// Un PDF de `pages` páginas en `dir/name`, con el diccionario /Info indicado.
    fn pdf_with_info(dir: &Path, name: &str, pages: usize, info: Option<Info>) -> PathBuf {
        let specs: Vec<PageSpec> = (1..=pages)
            .map(|n| PageSpec::with_text(&format!("Page {n}")))
            .collect();
        let path = dir.join(name);
        std::fs::write(
            &path,
            build_pdf_with_info(&specs, &Inherited::default(), info.as_ref()),
        )
        .expect("write pdf");
        path
    }

    #[test]
    fn pending_books_are_indexed_with_clean_metadata_and_a_400_px_cover() {
        let books = tempfile::tempdir().expect("books");
        let covers = tempfile::tempdir().expect("covers");
        let (_db_dir, mut conn) = open_temp_db();

        let good = import(
            &mut conn,
            &pdf_with_info(
                books.path(),
                "good.pdf",
                2,
                Some(Info {
                    title: Some("  Mi   libro  ".into()),
                    author: Some("Ana Pérez".into()),
                }),
            ),
        );
        let junk = import(
            &mut conn,
            &pdf_with_info(
                books.path(),
                "junk.pdf",
                1,
                Some(Info {
                    title: Some("Microsoft Word - tesis.docx".into()),
                    author: Some("Anónimo".into()),
                }),
            ),
        );
        let broken = import(&mut conn, &write_pdf(books.path(), "broken.pdf", 3));
        let gone = import(&mut conn, &pdf_with_info(books.path(), "gone.pdf", 1, None));
        std::fs::remove_file(books.path().join("gone.pdf")).expect("remove");

        // Ya indexado: no debe volver a procesarse ni cambiar su portada. (Otro contenido: la huella es el contenido.)
        let kept = import(&mut conn, &pdf_with_info(books.path(), "kept.pdf", 3, None));
        library::save_book_scan(
            &conn,
            covers.path(),
            &kept.id,
            &ScanInput {
                page_count: 1,
                title: None,
                author: None,
            },
            &jpeg_bytes(1000),
        )
        .expect("save");

        let db = Mutex::new(conn);
        let mut attempted = HashSet::new();
        let report = index_pending(&db, covers.path(), &mut attempted, || {}, |_| {});

        let outcome = |id: &str| {
            report
                .iter()
                .find(|indexed| indexed.book_id == id)
                .map(|indexed| indexed.outcome)
        };
        assert_eq!(report.len(), 4, "the done book must not be attempted");
        assert_eq!(outcome(&good.id), Some(Outcome::Done));
        assert_eq!(outcome(&junk.id), Some(Outcome::Done));
        assert_eq!(outcome(&broken.id), Some(Outcome::Failed));
        assert_eq!(outcome(&gone.id), Some(Outcome::Missing));
        assert_eq!(outcome(&kept.id), None);

        let conn = db.lock().expect("lock");
        let good_book = get_book(&conn, &good.id).expect("good");
        assert_eq!(good_book.title, "Mi libro");
        assert_eq!(good_book.author.as_deref(), Some("Ana Pérez"));
        assert_eq!(good_book.page_count, Some(2));
        assert_eq!(good_book.scan_state, library::ScanState::Done);
        assert!(good_book.cover_url.is_some());

        let junk_book = get_book(&conn, &junk.id).expect("junk");
        assert_eq!(junk_book.title, "junk", "junk metadata keeps the file name");
        assert_eq!(junk_book.author, None);

        assert_eq!(
            get_book(&conn, &broken.id).expect("broken").scan_state,
            library::ScanState::Failed
        );
        assert!(get_book(&conn, &gone.id).expect("gone").missing);
        assert_eq!(
            get_book(&conn, &kept.id).expect("kept").scan_state,
            library::ScanState::Done
        );
        drop(conn);

        // La portada de 400 px de ancho, como JPEG, con la proporción de la página (Letter: 612 x 792).
        let cover = std::fs::read(covers.path().join(format!("{}.jpg", good.id))).expect("cover");
        let decoded =
            image::load_from_memory_with_format(&cover, image::ImageFormat::Jpeg).expect("jpeg");
        assert_eq!(decoded.width(), 400);
        assert!(
            decoded.height().abs_diff(518) <= 1,
            "height {}",
            decoded.height()
        );
        assert_eq!(
            std::fs::read(covers.path().join(format!("{}.jpg", kept.id))).expect("kept cover"),
            jpeg_bytes(1000),
            "a done book keeps its cover"
        );

        // Una segunda pasada no encuentra nada que hacer.
        let again = index_pending(&db, covers.path(), &mut attempted, || {}, |_| {});
        assert!(again.is_empty());
        let mut fresh = HashSet::new();
        let fresh_report = index_pending(&db, covers.path(), &mut fresh, || {}, |_| {});
        assert!(fresh_report.is_empty(), "nothing is pending any more");
        assert!(
            pending_scan_paths(&db.lock().expect("lock"))
                .expect("pending")
                .is_empty()
        );
    }

    #[test]
    fn a_pdf_without_metadata_keeps_the_file_name_and_the_page_count() {
        let books = tempfile::tempdir().expect("books");
        let covers = tempfile::tempdir().expect("covers");
        let (_db_dir, mut conn) = open_temp_db();
        let path = books.path().join("sin-metadatos.pdf");
        std::fs::write(
            &path,
            build_pdf(&[PageSpec::with_text("hola")], &Inherited::default()),
        )
        .expect("write");
        let book = import(&mut conn, &path);

        let db = Mutex::new(conn);
        let report = index_pending(&db, covers.path(), &mut HashSet::new(), || {}, |_| {});

        assert_eq!(report.len(), 1);
        assert_eq!(report[0].outcome, Outcome::Done);
        let conn = db.lock().expect("lock");
        let saved = get_book(&conn, &book.id).expect("book");
        assert_eq!(saved.title, "sin-metadatos");
        assert_eq!(saved.author, None);
        assert_eq!(saved.page_count, Some(1));
    }

    /// Prueba real, no se ejecuta por defecto. Indexa los PDF de `ATRIL_REAL_BOOKS` (por defecto `~/datos/libros`)
    /// en una base temporal, mide el tiempo por libro y deja las portadas en `ATRIL_REAL_OUT` para revisarlas.
    /// Solo lee los libros (nunca los copia al repo). Ejecutar con:
    /// `cargo test real_library_timing -- --ignored --nocapture`
    #[test]
    #[ignore = "uses the user's books; run by hand"]
    fn real_library_timing() {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        let books = std::env::var_os("ATRIL_REAL_BOOKS")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("datos/libros"));
        let out = std::env::var_os("ATRIL_REAL_OUT")
            .map(PathBuf::from)
            .expect("set ATRIL_REAL_OUT to a directory outside the repo");
        let covers = out.join("covers");
        std::fs::create_dir_all(&covers).expect("covers dir");
        let (_db_dir, conn) = open_temp_db();
        let db = Mutex::new(conn);

        let scan_started = Instant::now();
        let found = crate::scan::scan_folders(&db, &[books], |_| {}).expect("scan");
        println!(
            "scan: {found} PDF registered in {:.2?}",
            scan_started.elapsed()
        );

        let started = Instant::now();
        let report = index_pending(&db, &covers, &mut HashSet::new(), || {}, |_| {});
        let total = started.elapsed();
        let conn = db.lock().expect("lock");
        for indexed in &report {
            let book = get_book(&conn, &indexed.book_id).expect("book");
            println!(
                "{:>10.2?} {:<8?} pages={:<5} title={:?} author={:?} file={}",
                indexed.elapsed,
                indexed.outcome,
                book.page_count.unwrap_or_default(),
                book.title,
                book.author,
                book.file_name,
            );
        }
        let done = report.iter().filter(|i| i.outcome == Outcome::Done).count();
        println!(
            "total: {} books in {:.2?} ({} done, {} not done)",
            report.len(),
            total,
            done,
            report.len() - done
        );
    }
}
