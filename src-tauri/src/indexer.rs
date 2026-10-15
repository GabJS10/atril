//! Indexador nativo de la biblioteca (fase R1.3). Para cada libro pendiente saca el número de páginas, el título
//! y el autor del PDF, y la portada (la página 1 a 400 px de ancho, JPEG), y lo guarda con `library::save_book_scan`.
//!
//! Hilo y prioridad: un hilo propio (`atril-indexer`) con su propia copia del documento de MuPDF. Cada hilo de
//! MuPDF tiene su contexto, así que no comparte nada con el pool del visor. El hilo baja su prioridad del sistema
//! (nice 19 en Linux, por hilo) y no empieza un libro mientras haya renders del visor en cola.
//!
//! Los libros que ya tenían portada antes de `Book.coverColor` reciben el color en segundo plano, sin reindexar
//! ([`backfill_cover_colors`]).
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

use crate::cover_color;
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
/// Portadas por lote al rellenar el color de las que ya existen (un aviso a la UI por lote).
const COLOR_BATCH: usize = 25;
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
    let (cover, cover_color) = document.render_cover(1, COVER_WIDTH_PX / first.width.max(1.0))?;

    Ok(Scan {
        input: ScanInput {
            page_count: i64::from(page_count),
            title: clean_title(title.as_deref(), file_name.as_deref()),
            author: clean_metadata_text(author.as_deref(), TextKind::Author),
            cover_color,
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

/// Rellena `books.cover_color` de los libros que ya tenían portada antes de que existiera el color, sin reindexarlos:
/// lee `covers/<id>.jpg` (o `.webp`), la decodifica con el crate `image` (Rust puro; no hace falta abrir el PDF ni
/// usar MuPDF, así que es barato: unos ms por portada de 400 px) y calcula el color. Va por lotes de
/// [`COLOR_BATCH`]: `before_each` se llama antes de cada portada (ahí cede al visor) y `on_batch` con el número de
/// libros actualizados al acabar cada lote. Una portada que falla (ilegible o ausente) entra en `attempted` y no se
/// vuelve a intentar durante la sesión. Devuelve cuántos libros se actualizaron.
pub fn backfill_cover_colors(
    db: &Mutex<Connection>,
    covers_dir: &Path,
    attempted: &mut HashSet<String>,
    mut before_each: impl FnMut(),
    mut on_batch: impl FnMut(usize),
) -> usize {
    let ids = match library::lock_db(db).and_then(|conn| library::books_without_cover_color(&conn))
    {
        Ok(ids) => ids,
        Err(error) => {
            tracing::warn!(%error, "could not list the books without a cover color");
            return 0;
        }
    };
    let ids: Vec<String> = ids
        .into_iter()
        .filter(|id| attempted.insert(id.clone()))
        .collect();
    let mut total = 0;
    for batch in ids.chunks(COLOR_BATCH) {
        let mut updated = 0;
        for id in batch {
            before_each();
            let color = match cover_color::color_from_cover_file(covers_dir, id) {
                Ok(color) => color,
                Err(reason) => {
                    tracing::warn!(book = %id, %reason, "could not compute the cover color");
                    continue;
                }
            };
            match library::lock_db(db).and_then(|conn| library::set_cover_color(&conn, id, &color))
            {
                Ok(true) => updated += 1,
                Ok(false) => {}
                Err(error) => tracing::warn!(book = %id, %error, "could not save the cover color"),
            }
        }
        if updated > 0 {
            on_batch(updated);
        }
        total += updated;
    }
    total
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
    if !lower_priority() {
        tracing::debug!("could not lower the priority of the indexer thread");
    }
    let mut attempted = HashSet::new();
    let mut color_attempted = HashSet::new();
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
        backfill_cover_colors(
            db,
            covers_dir,
            &mut color_attempted,
            || {
                while engine.queued_renders() > 0 {
                    thread::sleep(YIELD);
                }
            },
            |_| watch::emit_changed(app, "index"),
        );
        match wakes.recv_timeout(POLL) {
            Ok(()) => while wakes.try_recv().is_ok() {},
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// Baja la prioridad de este hilo para que el render del visor gane la CPU. Es por hilo en las dos plataformas:
/// `nice` 19 en Linux y `THREAD_PRIORITY_LOWEST` en Windows. Devuelve `false` si el sistema no lo permite o si en
/// este sistema no hay nada que hacer.
fn lower_priority() -> bool {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: `gettid` no tiene precondiciones y `setpriority` solo cambia la prioridad de este hilo.
        let tid = unsafe { libc::gettid() } as libc::id_t;
        unsafe { libc::setpriority(libc::PRIO_PROCESS, tid, 19) == 0 }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_LOWEST,
        };
        // SAFETY: `GetCurrentThread` devuelve un seudo-handle del hilo que llama (no hay que cerrarlo) y
        // `SetThreadPriority` solo cambia la prioridad de ese hilo.
        unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_LOWEST) != 0 }
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        false
    }
}

/// La prioridad es por hilo: la prueba la baja en un hilo propio para no afectar al resto de las pruebas.
#[cfg(all(test, any(target_os = "linux", windows)))]
mod priority_tests {
    use super::lower_priority;

    /// Prioridad actual de este hilo, en la escala de cada sistema (`nice` en Linux, `THREAD_PRIORITY_*` en Windows).
    fn current_priority() -> i32 {
        #[cfg(target_os = "linux")]
        {
            // SAFETY: `gettid` no tiene precondiciones y `getpriority` solo lee la prioridad del hilo.
            unsafe { libc::getpriority(libc::PRIO_PROCESS, libc::gettid() as libc::id_t) }
        }
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::Threading::{GetCurrentThread, GetThreadPriority};
            // SAFETY: `GetCurrentThread` devuelve un seudo-handle del hilo que llama.
            unsafe { GetThreadPriority(GetCurrentThread()) }
        }
    }

    #[test]
    fn the_indexer_thread_runs_at_the_lowest_priority() {
        let (lowered, priority) = std::thread::spawn(|| (lower_priority(), current_priority()))
            .join()
            .expect("priority thread");

        assert!(lowered, "the system accepted the new priority");
        #[cfg(target_os = "linux")]
        assert_eq!(priority, 19);
        #[cfg(windows)]
        assert_eq!(
            priority,
            windows_sys::Win32::System::Threading::THREAD_PRIORITY_LOWEST
        );
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
                cover_color: None,
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
                cover_color: None,
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

    #[test]
    fn indexing_stores_the_cover_color_from_the_rendered_pixels() {
        let books = tempfile::tempdir().expect("books");
        let covers = tempfile::tempdir().expect("covers");
        let (_db_dir, mut conn) = open_temp_db();
        let book = import(&mut conn, &pdf_with_info(books.path(), "a.pdf", 1, None));

        let db = Mutex::new(conn);
        let report = index_pending(&db, covers.path(), &mut HashSet::new(), || {}, |_| {});

        assert_eq!(report[0].outcome, Outcome::Done);
        let conn = db.lock().expect("lock");
        let color = get_book(&conn, &book.id).expect("book").cover_color;
        // Texto negro sobre papel blanco: no hay color, sale un gris.
        let color = color.expect("a color");
        assert!(cover_color::is_valid_hex(&color), "{color}");
        assert_eq!(color[1..3], color[3..5]);
        assert_eq!(color[3..5], color[5..7]);
    }

    /// Inserta un libro con portada (`covers/<id>.jpg`) y sin color, como los indexados antes de `coverColor`.
    fn insert_book_with_cover(conn: &Connection, covers: &Path, id: &str, jpeg: &[u8]) {
        conn.execute(
            "INSERT INTO books (id, path, file_size, title, added_at, scan_state, has_cover)
             VALUES (?1, ?1, 1, ?1, ?1, 'done', 1)",
            [id],
        )
        .expect("insert");
        std::fs::write(covers.join(format!("{id}.jpg")), jpeg).expect("cover");
    }

    fn red_jpeg() -> Vec<u8> {
        let rgb: Vec<u8> = (0..40 * 60).flat_map(|_| [200u8, 30, 30]).collect();
        crate::engine::encode::encode_jpeg(&rgb, 40, 60).expect("jpeg")
    }

    #[test]
    fn backfill_fills_existing_covers_in_batches_and_skips_undecodable_ones() {
        let covers = tempfile::tempdir().expect("covers");
        let (_db_dir, conn) = open_temp_db();
        let total = COLOR_BATCH + 1;
        for n in 0..total {
            insert_book_with_cover(&conn, covers.path(), &format!("book{n:02}"), &red_jpeg());
        }
        insert_book_with_cover(&conn, covers.path(), "broken", &jpeg_bytes(1000));
        let db = Mutex::new(conn);
        let mut attempted = HashSet::new();
        let (mut before, mut batches) = (0, Vec::new());

        let updated = backfill_cover_colors(
            &db,
            covers.path(),
            &mut attempted,
            || before += 1,
            |count| batches.push(count),
        );

        assert_eq!(updated, total);
        // 26 legibles = dos lotes (25 + 1); el ilegible no suma a ninguno.
        assert_eq!(batches.iter().sum::<usize>(), total);
        assert_eq!(batches.len(), 2, "{batches:?}");
        assert_eq!(
            before,
            total + 1,
            "yields before every cover, readable or not"
        );
        {
            let conn = db.lock().expect("lock");
            let book = get_book(&conn, "book00").expect("book");
            let [r, g, b] = {
                let color = book.cover_color.expect("color");
                let value = |at: usize| u8::from_str_radix(&color[at..at + 2], 16).expect("hex");
                [value(1), value(3), value(5)]
            };
            assert!(r > 150 && g < 80 && b < 80, "{r},{g},{b}");
            assert_eq!(get_book(&conn, "broken").expect("book").cover_color, None);
        }

        // No se reintenta: ni el ilegible ni nada más en la misma sesión.
        let mut again = 0;
        let updated =
            backfill_cover_colors(&db, covers.path(), &mut attempted, || again += 1, |_| {});
        assert_eq!((updated, again), (0, 0));
        // Una sesión nueva sí lo intenta una vez (y vuelve a fallar sin romper nada).
        let mut fresh = HashSet::new();
        let mut tried = 0;
        let updated = backfill_cover_colors(&db, covers.path(), &mut fresh, || tried += 1, |_| {});
        assert_eq!((updated, tried), (0, 1));
    }

    #[test]
    fn backfill_ignores_books_with_a_missing_cover_file() {
        let covers = tempfile::tempdir().expect("covers");
        let (_db_dir, conn) = open_temp_db();
        insert_book_with_cover(&conn, covers.path(), "gone", &red_jpeg());
        std::fs::remove_file(covers.path().join("gone.jpg")).expect("remove");
        let db = Mutex::new(conn);

        let updated = backfill_cover_colors(&db, covers.path(), &mut HashSet::new(), || {}, |_| {});

        assert_eq!(updated, 0);
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
                "{:>10.2?} {:<8?} pages={:<5} color={:?} title={:?} author={:?} file={}",
                indexed.elapsed,
                indexed.outcome,
                book.page_count.unwrap_or_default(),
                book.cover_color,
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
