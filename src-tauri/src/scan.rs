//! Escaneo de las carpetas de la biblioteca. Lee el disco sin lock y toma el lock
//! de la base solo un momento por archivo, así que los comandos no esperan al recorrido.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, params};
use serde::Serialize;
use walkdir::WalkDir;

use crate::error::AppError;
use crate::library::{self, Origin};
use crate::path_rules;

/// Estado del escaneo (`docs/IPC.md`, `ScanStatus`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    pub running: bool,
    /// PDFs nuevos encontrados en el escaneo en curso o en el último.
    pub found: u64,
}

pub type SharedScanStatus = Arc<Mutex<ScanStatus>>;

/// Cuántos avisos individuales (errores de recorrido o archivos rechazados) se escriben por escaneo y por tipo; el
/// resto solo cuenta en el resumen. Un disco con miles de archivos ilegibles no debe llenar el registro.
const MAX_WARNINGS: u64 = 20;

/// Recorre `folders`, registra los PDF que encuentra y marca como `missing` los libros
/// cuyo archivo ya no existe. Devuelve cuántos libros nuevos se registraron.
/// `on_found` se llama con el contador cada vez que aparece uno nuevo.
///
/// Escribe en el registro (`atril.log`) un resumen por escaneo y un aviso por cada error (hasta [`MAX_WARNINGS`]):
/// en Windows no hay consola, y un escaneo que "no encuentra nada" no dejaba ninguna pista de por qué.
pub fn scan_folders(
    db: &Mutex<Connection>,
    folders: &[PathBuf],
    mut on_found: impl FnMut(u64),
) -> Result<u64, AppError> {
    let collected = collect_pdfs(folders);

    let mut found = 0;
    let mut known = 0u64;
    let mut skipped = 0u64;
    let mut rejected = 0u64;
    for path in &collected.pdfs {
        match library::register(db, path, Origin::Scan) {
            Ok(Some(commit)) if commit.created => {
                found += 1;
                on_found(found);
            }
            Ok(Some(_)) => known += 1,
            // Quitado de la biblioteca, o con otra copia ya conocida: un escaneo no lo toca.
            Ok(None) => skipped += 1,
            Err(error) => {
                rejected += 1;
                if rejected <= MAX_WARNINGS {
                    tracing::warn!(path = %path.display(), %error, "scan: file rejected");
                }
            }
        }
    }
    if rejected > MAX_WARNINGS {
        tracing::warn!(
            rejected,
            "scan: more rejected files than the ones listed above"
        );
    }

    mark_missing(db)?;
    tracing::info!(
        folders = folders.len(),
        entries = collected.entries,
        pdf_candidates = collected.pdfs.len(),
        registered = found,
        known,
        skipped_removed_or_duplicate = skipped,
        removed_books_in_db = count_removed(db),
        rejected,
        walk_errors = collected.walk_errors,
        pdf_named_not_files = collected.not_files,
        "scan finished"
    );
    Ok(found)
}

/// Cuántas entradas de cada carpeta se describen en el registro aunque sean normales: así se ve qué ve `walkdir`
/// (tipo y atributos) cuando un escaneo "no encuentra nada".
const SAMPLE_ENTRIES: u64 = 5;

/// Tipo y atributos de una entrada para el registro. En Windows, los atributos de `GetFileAttributes` en hexadecimal
/// (`0x400` = punto de reanálisis, `0x400000` = recall on data access, `0x40000` = recall on open, `0x1000` = fuera de
/// línea…); en el resto, solo el tipo.
fn describe(file_type: std::fs::FileType, metadata: Option<&std::fs::Metadata>) -> String {
    let kind = if file_type.is_symlink() {
        "symlink"
    } else if file_type.is_dir() {
        "dir"
    } else if file_type.is_file() {
        "file"
    } else {
        "other"
    };
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if let Some(metadata) = metadata {
            return format!("{kind} attributes=0x{:x}", metadata.file_attributes());
        }
    }
    let _ = metadata;
    kind.to_owned()
}

/// Libros que el usuario quitó de la biblioteca (solo para el resumen del registro; `0` si la base falla).
fn count_removed(db: &Mutex<Connection>) -> i64 {
    library::lock_db(db)
        .and_then(|conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM books WHERE removed_at IS NOT NULL",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(AppError::from)
        })
        .unwrap_or(0)
}

/// Lo que dejó el recorrido de las carpetas.
#[derive(Debug, Default)]
struct Collected {
    /// Los PDF, cada archivo una sola vez.
    pdfs: Vec<PathBuf>,
    /// Entradas (archivos y carpetas) recorridas en total.
    entries: u64,
    /// Entradas que `walkdir` no pudo leer (permisos, carpeta que desaparece…).
    walk_errors: u64,
    /// Entradas con nombre `.pdf` que no son archivos (una carpeta `x.pdf`, un enlace roto…).
    not_files: u64,
}

/// Los PDF de las carpetas (recursivo, sin seguir enlaces a carpetas), cada archivo una sola vez: carpetas repetidas,
/// anidadas o escritas distinto (en Windows, otras mayúsculas o separadores) encuentran el mismo archivo más de una vez.
/// Un enlace (o punto de reanálisis) que lleva a un archivo cuenta como archivo.
fn collect_pdfs(folders: &[PathBuf]) -> Collected {
    let mut collected = Collected::default();
    let mut seen = HashSet::new();
    for folder in folders {
        let before = (collected.entries, collected.pdfs.len());
        let root = std::fs::symlink_metadata(folder);
        tracing::info!(
            folder = %folder.display(),
            is_dir = folder.is_dir(),
            root = %root.as_ref().map_or_else(
                |error| format!("unreadable: {error}"),
                |meta| describe(meta.file_type(), Some(meta)),
            ),
            "scan: walking folder"
        );
        for entry in WalkDir::new(folder).follow_links(false) {
            collected.entries += 1;
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    collected.walk_errors += 1;
                    if collected.walk_errors <= MAX_WARNINGS {
                        tracing::warn!(
                            path = %error.path().map_or_else(String::new, |p| p.display().to_string()),
                            %error,
                            "scan: could not read an entry"
                        );
                    }
                    continue;
                }
            };
            let sampled = collected.entries - before.0 <= SAMPLE_ENTRIES;
            let pdf_named = is_pdf_name(entry.path());
            let regular = is_regular_file(&entry);
            // Las primeras entradas de cada carpeta, con su tipo y atributos.
            if sampled {
                let metadata = entry.metadata().ok();
                tracing::info!(
                    path = %entry.path().display(),
                    entry = %describe(entry.file_type(), metadata.as_ref()),
                    pdf_named,
                    regular,
                    "scan: entry"
                );
            }
            if !pdf_named {
                continue;
            }
            if !regular {
                if !entry.file_type().is_dir() {
                    collected.not_files += 1;
                    if collected.not_files <= MAX_WARNINGS {
                        // Un enlace, un punto de reanálisis, un marcador de la nube…: con su tipo y atributos.
                        let metadata = entry.metadata().ok();
                        tracing::warn!(
                            path = %entry.path().display(),
                            entry = %describe(entry.file_type(), metadata.as_ref()),
                            "scan: a .pdf entry is not a file"
                        );
                    }
                }
                continue;
            }
            if seen.insert(path_rules::native_key(entry.path())) {
                collected.pdfs.push(entry.into_path());
            }
        }
        tracing::info!(
            folder = %folder.display(),
            entries = collected.entries - before.0,
            pdf_candidates = collected.pdfs.len() - before.1,
            "scan: folder walked"
        );
    }
    if collected.walk_errors > MAX_WARNINGS {
        tracing::warn!(
            walk_errors = collected.walk_errors,
            "scan: more unreadable entries than the ones listed above"
        );
    }
    collected
}

/// Un archivo, o un enlace (en Windows, también otros puntos de reanálisis) cuyo destino es un archivo. Los enlaces
/// a carpetas nunca llegan aquí como archivos, y `walkdir` no entra en ellos.
fn is_regular_file(entry: &walkdir::DirEntry) -> bool {
    let kind = entry.file_type();
    kind.is_file()
        || (kind.is_symlink() && std::fs::metadata(entry.path()).is_ok_and(|meta| meta.is_file()))
}

fn is_pdf_name(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

/// Un libro está `missing` si su ruta ya no es un archivo. Se revisa tras el recorrido,
/// así que un libro movido ya tiene su ruta nueva y no cuenta como perdido.
fn mark_missing(db: &Mutex<Connection>) -> Result<(), AppError> {
    let conn = library::lock_db(db)?;
    let rows: Vec<(String, String, bool)> = {
        let mut stmt =
            conn.prepare("SELECT id, path, missing FROM books WHERE removed_at IS NULL")?;
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (id, path, missing) in rows {
        let gone = !Path::new(&path).is_file();
        if gone != missing {
            conn.execute(
                "UPDATE books SET missing = ?1 WHERE id = ?2",
                params![gone, id],
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::{
        ReadingStateInput, get_book, remove_book, save_reading_state, visible_books,
    };
    use crate::settings::{ViewMode, Zoom, ZoomPreset};
    use crate::test_support::{import, open_temp_db, write_pdf};

    fn scan(db: &Mutex<Connection>, folders: &[&Path]) -> u64 {
        let folders: Vec<PathBuf> = folders.iter().map(|p| p.to_path_buf()).collect();
        scan_folders(db, &folders, |_| {}).expect("scan")
    }

    #[test]
    fn scan_registers_pdfs_recursively_and_ignores_other_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, conn) = open_temp_db();
        let db = Mutex::new(conn);
        std::fs::create_dir_all(dir.path().join("sub")).expect("mkdir");
        write_pdf(dir.path(), "a.pdf", 1);
        write_pdf(&dir.path().join("sub"), "b.PDF", 2);
        std::fs::write(dir.path().join("notas.txt"), b"texto").expect("txt");
        std::fs::write(dir.path().join("falso.pdf"), b"no es un pdf").expect("fake");

        let mut seen = Vec::new();
        let found = scan_folders(&db, &[dir.path().to_path_buf()], |n| seen.push(n)).expect("scan");

        assert_eq!(found, 2);
        assert_eq!(seen, vec![1, 2]);
        let conn = db.lock().expect("lock");
        assert_eq!(visible_books(&conn).expect("list").len(), 2);
    }

    #[test]
    fn a_second_scan_finds_nothing_new() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, conn) = open_temp_db();
        let db = Mutex::new(conn);
        write_pdf(dir.path(), "a.pdf", 1);

        assert_eq!(scan(&db, &[dir.path()]), 1);
        assert_eq!(scan(&db, &[dir.path()]), 0);
    }

    #[test]
    fn moved_files_keep_their_book_and_progress() {
        let dir = tempfile::tempdir().expect("tempdir");
        let sub = dir.path().join("sub");
        std::fs::create_dir_all(&sub).expect("mkdir");
        let (_db_dir, mut conn) = open_temp_db();
        let original = write_pdf(dir.path(), "a.pdf", 1);
        let book = import(&mut conn, &original);
        save_reading_state(
            &mut conn,
            &book.id,
            &ReadingStateInput {
                page: 4,
                offset_in_page: 0.0,
                zoom: Zoom::Preset(ZoomPreset::PageWidth),
                view_mode: ViewMode::Normal,
                page_count: 8,
            },
        )
        .expect("save");
        let db = Mutex::new(conn);
        std::fs::rename(&original, sub.join("moved.pdf")).expect("move");

        let found = scan(&db, &[dir.path()]);

        assert_eq!(found, 0);
        let conn = db.lock().expect("lock");
        let books = visible_books(&conn).expect("list");
        assert_eq!(books.len(), 1);
        let moved = get_book(&conn, &book.id).expect("get");
        assert_eq!(moved.file_name, "moved.pdf");
        assert!(!moved.missing);
        assert_eq!(moved.progress, Some(0.5));
    }

    #[test]
    fn deleted_files_are_marked_missing_and_keep_their_progress() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();
        let path = write_pdf(dir.path(), "a.pdf", 1);
        let book = import(&mut conn, &path);
        let db = Mutex::new(conn);
        std::fs::remove_file(&path).expect("delete");

        scan(&db, &[dir.path()]);

        let conn = db.lock().expect("lock");
        let gone = get_book(&conn, &book.id).expect("get");
        assert!(gone.missing);
        assert_eq!(visible_books(&conn).expect("list").len(), 1);
    }

    #[test]
    fn a_folder_that_disappears_marks_its_books_missing_and_comes_back_clean() {
        let root = tempfile::tempdir().expect("tempdir");
        let folder = root.path().join("libros");
        std::fs::create_dir_all(&folder).expect("mkdir");
        let (_db_dir, mut conn) = open_temp_db();
        write_pdf(&folder, "a.pdf", 1);
        let db_book = {
            let path = folder.join("a.pdf");
            import(&mut conn, &path)
        };
        let db = Mutex::new(conn);
        scan(&db, &[folder.as_path()]);

        std::fs::rename(&folder, root.path().join("desmontada")).expect("unmount");
        scan(&db, &[folder.as_path()]);
        assert!(
            get_book(&db.lock().expect("lock"), &db_book.id)
                .expect("get")
                .missing
        );

        std::fs::rename(root.path().join("desmontada"), &folder).expect("remount");
        scan(&db, &[folder.as_path()]);
        assert!(
            !get_book(&db.lock().expect("lock"), &db_book.id)
                .expect("get")
                .missing
        );
    }

    #[test]
    fn scan_does_not_bring_back_removed_books() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();
        let path = write_pdf(dir.path(), "a.pdf", 1);
        let book = import(&mut conn, &path);
        remove_book(&conn, &book.id).expect("remove");
        let db = Mutex::new(conn);

        let found = scan(&db, &[dir.path()]);

        assert_eq!(found, 0);
        assert!(
            visible_books(&db.lock().expect("lock"))
                .expect("list")
                .is_empty()
        );
    }

    #[test]
    fn a_duplicate_copy_keeps_the_path_that_still_exists() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db_dir, mut conn) = open_temp_db();
        let original = write_pdf(dir.path(), "a.pdf", 1);
        let book = import(&mut conn, &original);
        std::fs::copy(&original, dir.path().join("copia.pdf")).expect("copy");
        let db = Mutex::new(conn);

        scan(&db, &[dir.path()]);
        scan(&db, &[dir.path()]);

        let conn = db.lock().expect("lock");
        assert_eq!(get_book(&conn, &book.id).expect("get").file_name, "a.pdf");
        assert_eq!(visible_books(&conn).expect("list").len(), 1);
    }
    #[test]
    fn overlapping_and_repeated_folders_list_each_pdf_once() {
        let dir = tempfile::tempdir().expect("tempdir");
        let sub = dir.path().join("sub");
        std::fs::create_dir_all(&sub).expect("mkdir");
        write_pdf(dir.path(), "a.pdf", 1);
        write_pdf(&sub, "b.pdf", 2);

        let pdfs = collect_pdfs(&[
            dir.path().to_path_buf(),
            sub.clone(),
            dir.path().join(""),
            dir.path().to_path_buf(),
        ])
        .pdfs;

        let mut names: Vec<String> = pdfs
            .iter()
            .map(|path| {
                path.file_name()
                    .expect("name")
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        assert_eq!(names, ["a.pdf", "b.pdf"]);
    }

    #[test]
    fn overlapping_folders_register_each_book_once() {
        let dir = tempfile::tempdir().expect("tempdir");
        let sub = dir.path().join("sub");
        std::fs::create_dir_all(&sub).expect("mkdir");
        let (_db_dir, conn) = open_temp_db();
        let db = Mutex::new(conn);
        write_pdf(dir.path(), "a.pdf", 1);
        write_pdf(&sub, "b.pdf", 2);

        let mut seen = Vec::new();
        let found =
            scan_folders(&db, &[dir.path().to_path_buf(), sub], |n| seen.push(n)).expect("scan");

        assert_eq!(found, 2);
        assert_eq!(seen, vec![1, 2]);
        assert_eq!(
            visible_books(&db.lock().expect("lock"))
                .expect("list")
                .len(),
            2
        );
    }

    /// Una carpeta con espacios, tildes y eñes, con PDF en la raíz y en subcarpetas (también con nombres así).
    fn library_folder() -> tempfile::TempDir {
        let dir = tempfile::Builder::new()
            .prefix("Mis libros ñandú ")
            .tempdir()
            .expect("tempdir");
        let deep = dir.path().join("Colección año 2024").join("tomo é");
        std::fs::create_dir_all(&deep).expect("mkdir");
        write_pdf(dir.path(), "Ficción larga.pdf", 1);
        write_pdf(dir.path(), "otro.PDF", 2);
        write_pdf(&dir.path().join("Colección año 2024"), "Poesía.pdf", 3);
        write_pdf(&deep, "ünico — con guion.pdf", 4);
        std::fs::write(dir.path().join("notas.txt"), b"texto").expect("txt");
        dir
    }

    /// La ruta de la carpeta como podría darla el diálogo del sistema (y variantes que no deben cambiar el resultado).
    fn dialog_variants(path: &Path) -> Vec<String> {
        let text = path.to_str().expect("utf-8").to_owned();
        let separator = std::path::MAIN_SEPARATOR;
        #[cfg_attr(not(windows), allow(unused_mut))]
        let mut variants = vec![text.clone(), format!("{text}{separator}")];
        #[cfg(windows)]
        {
            variants.push(text.replace('\\', "/"));
            variants.push(format!("{}/", text.replace('\\', "/")));
            variants.push(format!("{text}\\\\"));
            let mut chars = text.chars();
            if let Some(drive) = chars.next() {
                let lower = drive.to_ascii_lowercase();
                variants.push(format!("{lower}{}", chars.as_str()));
                variants.push(format!("{}{}", drive.to_ascii_uppercase(), chars.as_str()));
            }
            variants.push(format!(r"\\?\{text}"));
            variants.push(text.to_uppercase());
        }
        variants
    }

    /// El flujo real: el comando `add_library_folder` guarda la ruta del diálogo (`folders::add`) y el hilo de
    /// biblioteca escanea las rutas guardadas (`folders::paths`). Nada se registra a mano.
    #[test]
    fn a_folder_added_like_the_dialog_does_is_scanned_and_nothing_goes_missing() {
        let dir = library_folder();
        for variant in dialog_variants(dir.path()) {
            let (_db_dir, conn) = open_temp_db();

            let folder = crate::folders::add(&conn, Path::new(&variant))
                .unwrap_or_else(|error| panic!("add {variant:?}: {error:?}"));
            let paths = crate::folders::paths(&conn).expect("paths");
            let db = Mutex::new(conn);
            let found = scan_folders(&db, &paths, |_| {}).expect("scan");

            assert_eq!(found, 4, "variant {variant:?} stored as {:?}", folder.path);
            let conn = db.lock().expect("lock");
            let books = visible_books(&conn).expect("list");
            assert_eq!(books.len(), 4, "variant {variant:?}");
            assert!(
                books.iter().all(|book| !book.missing),
                "variant {variant:?}: a book was marked missing"
            );
            drop(conn);

            // El segundo escaneo (el del arranque, o el de cada cambio de archivos) no cambia nada.
            assert_eq!(
                scan_folders(&db, &paths, |_| {}).expect("rescan"),
                0,
                "variant {variant:?}"
            );
            let conn = db.lock().expect("lock");
            let books = visible_books(&conn).expect("list");
            assert_eq!(books.len(), 4, "variant {variant:?}");
            assert!(
                books.iter().all(|book| !book.missing),
                "variant {variant:?}"
            );
            assert_eq!(
                crate::folders::list(&conn).expect("folders").len(),
                1,
                "variant {variant:?}"
            );
        }
    }

    #[test]
    fn a_scan_reports_unreadable_roots_instead_of_hiding_them() {
        let dir = tempfile::tempdir().expect("tempdir");

        let collected = collect_pdfs(&[dir.path().join("does not exist")]);

        assert!(collected.pdfs.is_empty());
        assert_eq!(collected.walk_errors, 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_pdf_counts_as_a_file_but_a_link_to_a_folder_is_not_followed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let outside = tempfile::tempdir().expect("outside");
        let target = write_pdf(outside.path(), "real.pdf", 1);
        std::os::unix::fs::symlink(&target, dir.path().join("link.pdf")).expect("file link");
        std::os::unix::fs::symlink(outside.path(), dir.path().join("folder-link"))
            .expect("dir link");
        std::os::unix::fs::symlink(dir.path().join("nowhere"), dir.path().join("broken.pdf"))
            .expect("broken link");

        let collected = collect_pdfs(&[dir.path().to_path_buf()]);

        let names: Vec<_> = collected
            .pdfs
            .iter()
            .map(|p| p.file_name().expect("name").to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["link.pdf"]);
        assert_eq!(collected.not_files, 1);
    }
}
