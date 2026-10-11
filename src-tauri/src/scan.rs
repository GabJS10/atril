//! Escaneo de las carpetas de la biblioteca. Lee el disco sin lock y toma el lock
//! de la base solo un momento por archivo, así que los comandos no esperan al recorrido.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, params};
use serde::Serialize;
use walkdir::WalkDir;

use crate::error::AppError;
use crate::library::{self, Origin};

/// Estado del escaneo (`docs/IPC.md`, `ScanStatus`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStatus {
    pub running: bool,
    /// PDFs nuevos encontrados en el escaneo en curso o en el último.
    pub found: u64,
}

pub type SharedScanStatus = Arc<Mutex<ScanStatus>>;

/// Recorre `folders`, registra los PDF que encuentra y marca como `missing` los libros
/// cuyo archivo ya no existe. Devuelve cuántos libros nuevos se registraron.
/// `on_found` se llama con el contador cada vez que aparece uno nuevo.
pub fn scan_folders(
    db: &Mutex<Connection>,
    folders: &[PathBuf],
    mut on_found: impl FnMut(u64),
) -> Result<u64, AppError> {
    let mut pdfs = Vec::new();
    for folder in folders {
        for entry in WalkDir::new(folder).follow_links(false) {
            let Ok(entry) = entry else { continue };
            if entry.file_type().is_file() && is_pdf_name(entry.path()) {
                pdfs.push(entry.into_path());
            }
        }
    }

    let mut found = 0;
    for path in &pdfs {
        match library::register(db, path, Origin::Scan) {
            Ok(Some(commit)) if commit.created => {
                found += 1;
                on_found(found);
            }
            Ok(_) => {}
            Err(error) => {
                tracing::debug!(path = %path.display(), %error, "skipped file during scan")
            }
        }
    }

    mark_missing(db)?;
    Ok(found)
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
}
