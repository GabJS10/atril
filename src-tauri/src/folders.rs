//! Carpetas de la biblioteca: lo que se escanea y se vigila.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::error::{AppError, ErrorCode};
use crate::library::{self, now_iso};
use crate::path_rules;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolder {
    pub id: String,
    pub path: String,
    pub added_at: String,
}

pub fn list(conn: &Connection) -> Result<Vec<LibraryFolder>, AppError> {
    let mut stmt =
        conn.prepare("SELECT id, path, added_at FROM library_folders ORDER BY added_at, path")?;
    let folders = stmt
        .query_map([], |row| {
            Ok(LibraryFolder {
                id: row.get(0)?,
                path: row.get(1)?,
                added_at: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(folders)
}

pub fn paths(conn: &Connection) -> Result<Vec<PathBuf>, AppError> {
    Ok(list(conn)?
        .into_iter()
        .map(|folder| PathBuf::from(folder.path))
        .collect())
}

/// Añade una carpeta. Si ya estaba, devuelve la existente. "Ya estaba" es según las reglas de rutas de la
/// plataforma (`paths`): en Windows `C:\Libros` y `c:/libros/` son la misma carpeta. Se guarda la forma normalizada
/// (separadores unificados, sin barra final), conservando las mayúsculas que dio el usuario.
pub fn add(conn: &Connection, path: &Path) -> Result<LibraryFolder, AppError> {
    if !path.is_dir() {
        return Err(AppError::invalid_input(format!(
            "{} is not a folder",
            path.display()
        )));
    }
    let text = path
        .to_str()
        .ok_or_else(|| AppError::invalid_input("path is not valid UTF-8"))?;
    let normalized = path_rules::normalize(text, path_rules::Style::NATIVE);
    // Si normalizar rompiera la ruta (nombres que Win32 no admite sin el prefijo `\\?\`), se guarda tal cual.
    let stored = if Path::new(&normalized).is_dir() {
        normalized
    } else {
        text.to_owned()
    };

    let wanted = path_rules::key(&stored, path_rules::Style::NATIVE);
    if let Some(existing) = list(conn)?
        .into_iter()
        .find(|folder| path_rules::key(&folder.path, path_rules::Style::NATIVE) == wanted)
    {
        return Ok(existing);
    }

    let folder = LibraryFolder {
        id: uuid::Uuid::new_v4().to_string(),
        path: stored,
        added_at: now_iso(),
    };
    conn.execute(
        "INSERT INTO library_folders (id, path, added_at) VALUES (?1, ?2, ?3)",
        params![folder.id, folder.path, folder.added_at],
    )?;
    Ok(folder)
}

/// [`add`] más lo que implica que sea una acción explícita del usuario: los libros que quitó de la biblioteca y que
/// están dentro de esa carpeta (a cualquier nivel) vuelven, con su progreso, subrayados y Salas. Vale también si la
/// carpeta ya estaba añadida. Devuelve la carpeta y cuántos libros volvieron. Un escaneo normal no los devuelve.
pub fn add_restoring(conn: &Connection, path: &Path) -> Result<(LibraryFolder, u64), AppError> {
    let folder = add(conn, path)?;
    let restored = library::restore_removed_in_folder(conn, &folder.path)?;
    Ok((folder, restored))
}

pub fn remove(conn: &Connection, id: &str) -> Result<(), AppError> {
    let changed = conn.execute("DELETE FROM library_folders WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::new(
            ErrorCode::NotFound,
            format!("no library folder with id {id}"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn adding_the_same_folder_twice_returns_the_existing_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = db::open(&dir.path().join("atril.db")).expect("db");
        let books = tempfile::tempdir().expect("books");

        let first = add(&conn, books.path()).expect("first");
        let second = add(&conn, books.path()).expect("second");

        assert_eq!(first, second);
        assert_eq!(list(&conn).expect("list").len(), 1);
    }

    #[test]
    fn adding_a_file_or_missing_path_is_invalid_input() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = db::open(&dir.path().join("atril.db")).expect("db");
        let file = dir.path().join("a.pdf");
        std::fs::write(&file, b"%PDF-").expect("write");

        assert_eq!(
            add(&conn, &file).expect_err("file").code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            add(&conn, &dir.path().join("no-existe"))
                .expect_err("missing")
                .code,
            ErrorCode::InvalidInput
        );
    }

    #[test]
    fn removing_an_unknown_folder_is_not_found() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = db::open(&dir.path().join("atril.db")).expect("db");

        assert_eq!(
            remove(&conn, "nope").expect_err("unknown").code,
            ErrorCode::NotFound
        );
    }
    #[test]
    fn a_trailing_separator_or_a_repeated_one_is_the_same_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = db::open(&dir.path().join("atril.db")).expect("db");
        let books = tempfile::tempdir().expect("books");

        let first = add(&conn, books.path()).expect("first");
        let second = add(&conn, &books.path().join("")).expect("with a trailing separator");

        assert_eq!(first, second);
        assert_eq!(Path::new(&first.path), books.path());
        assert_eq!(list(&conn).expect("list").len(), 1);
    }

    #[test]
    fn a_folder_saved_with_a_trailing_separator_is_recognized_and_kept_as_it_was() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = db::open(&dir.path().join("atril.db")).expect("db");
        let books = tempfile::tempdir().expect("books");
        let legacy = format!("{}{}", books.path().display(), std::path::MAIN_SEPARATOR);
        conn.execute(
            "INSERT INTO library_folders (id, path, added_at) VALUES ('legacy', ?1, 'now')",
            params![legacy],
        )
        .expect("insert");

        let found = add(&conn, books.path()).expect("add");

        assert_eq!(found.id, "legacy");
        assert_eq!(found.path, legacy);
        assert_eq!(list(&conn).expect("list").len(), 1);
    }

    #[test]
    fn nested_folders_are_different_folders() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = db::open(&dir.path().join("atril.db")).expect("db");
        let books = tempfile::tempdir().expect("books");
        let sub = books.path().join("sub");
        std::fs::create_dir_all(&sub).expect("mkdir");

        let outer = add(&conn, books.path()).expect("outer");
        let inner = add(&conn, &sub).expect("inner");

        assert_ne!(outer.id, inner.id);
        assert_eq!(list(&conn).expect("list").len(), 2);
    }

    #[cfg(windows)]
    #[test]
    fn on_windows_case_and_slashes_do_not_make_another_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = db::open(&dir.path().join("atril.db")).expect("db");
        let books = tempfile::tempdir().expect("books");
        let text = books.path().to_str().expect("utf-8").to_owned();

        let first = add(&conn, books.path()).expect("first");
        let shouting = add(&conn, Path::new(&text.to_uppercase())).expect("upper case");
        let slashed = add(&conn, Path::new(&text.replace('\\', "/"))).expect("forward slashes");

        assert_eq!(first, shouting);
        assert_eq!(first, slashed);
        assert_eq!(list(&conn).expect("list").len(), 1);
    }

    /// Un libro importado con la ruta tal cual y quitado después, como hace «Quitar de la biblioteca».
    fn removed_book(conn: &mut Connection, dir: &Path, name: &str, seed: u8) -> library::Book {
        let path = crate::test_support::write_pdf(dir, name, seed);
        let book = crate::test_support::import(conn, &path);
        library::remove_book(conn, &book.id).expect("remove");
        book
    }

    fn is_removed(conn: &Connection, id: &str) -> bool {
        conn.query_row(
            "SELECT removed_at IS NOT NULL FROM books WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .expect("row")
    }

    #[test]
    fn adding_a_folder_brings_back_the_removed_books_inside_it_at_any_depth() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = db::open(&dir.path().join("atril.db")).expect("db");
        let root = tempfile::tempdir().expect("books");
        let economia = root.path().join("Economia");
        let sub = economia.join("tomos").join("uno");
        let sibling = root.path().join("Economia2");
        for folder in [&sub, &sibling] {
            std::fs::create_dir_all(folder).expect("mkdir");
        }
        let top = removed_book(&mut conn, &economia, "a.pdf", 1);
        let deep = removed_book(&mut conn, &sub, "b.pdf", 2);
        let elsewhere = removed_book(&mut conn, &sibling, "c.pdf", 3);

        let (_, restored) = add_restoring(&conn, &economia).expect("add");

        assert_eq!(restored, 2);
        assert!(!is_removed(&conn, &top.id));
        assert!(!is_removed(&conn, &deep.id));
        assert!(
            is_removed(&conn, &elsewhere.id),
            "a folder whose name only starts the same is another folder"
        );
    }

    #[test]
    fn adding_a_folder_that_was_already_there_also_brings_books_back() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = db::open(&dir.path().join("atril.db")).expect("db");
        let books = tempfile::tempdir().expect("books");
        add(&conn, books.path()).expect("first");
        let book = removed_book(&mut conn, books.path(), "a.pdf", 1);

        let (_, restored) = add_restoring(&conn, &books.path().join("")).expect("again");

        assert_eq!(restored, 1);
        assert!(!is_removed(&conn, &book.id));
        assert_eq!(list(&conn).expect("list").len(), 1);
    }

    #[test]
    fn a_normal_scan_does_not_bring_removed_books_back() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = db::open(&dir.path().join("atril.db")).expect("db");
        let books = tempfile::tempdir().expect("books");
        let book = removed_book(&mut conn, books.path(), "a.pdf", 1);
        add(&conn, books.path()).expect("plain add");
        let db = std::sync::Mutex::new(conn);

        crate::scan::scan_folders(&db, &[books.path().to_path_buf()], |_| {}).expect("scan");

        assert!(is_removed(&db.lock().expect("lock"), &book.id));
    }

    #[test]
    fn restored_books_keep_their_progress_and_a_missing_file_stays_missing() {
        use crate::settings::{ViewMode, Zoom, ZoomPreset};
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = db::open(&dir.path().join("atril.db")).expect("db");
        let books = tempfile::tempdir().expect("books");
        let kept = crate::test_support::write_pdf(books.path(), "a.pdf", 1);
        let kept = crate::test_support::import(&mut conn, &kept);
        library::save_reading_state(
            &mut conn,
            &kept.id,
            &library::ReadingStateInput {
                page: 4,
                offset_in_page: 0.0,
                zoom: Zoom::Preset(ZoomPreset::PageWidth),
                view_mode: ViewMode::Normal,
                page_count: 8,
            },
        )
        .expect("save");
        library::remove_book(&conn, &kept.id).expect("remove");
        let gone = removed_book(&mut conn, books.path(), "b.pdf", 2);
        std::fs::remove_file(books.path().join("b.pdf")).expect("delete");
        let db = std::sync::Mutex::new(conn);

        let (_, restored) = add_restoring(&db.lock().expect("lock"), books.path()).expect("add");
        let paths = list(&db.lock().expect("lock")).expect("list");
        let paths: Vec<_> = paths.iter().map(|f| PathBuf::from(&f.path)).collect();
        crate::scan::scan_folders(&db, &paths, |_| {}).expect("scan");

        assert_eq!(restored, 2);
        let conn = db.lock().expect("lock");
        let kept = library::get_book(&conn, &kept.id).expect("kept");
        assert!(!kept.missing);
        assert_eq!(kept.progress, Some(0.5));
        assert!(library::get_book(&conn, &gone.id).expect("gone").missing);
    }

    #[cfg(windows)]
    #[test]
    fn on_windows_the_folder_matches_the_removed_books_whatever_its_case_or_separators() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = db::open(&dir.path().join("atril.db")).expect("db");
        let books = tempfile::tempdir().expect("books");
        let book = removed_book(&mut conn, books.path(), "a.pdf", 1);
        let text = books.path().to_str().expect("utf-8").to_owned();

        for variant in [
            text.to_uppercase(),
            text.to_lowercase().replace('\\', "/"),
            format!(r"\\?\{text}"),
        ] {
            conn.execute("UPDATE books SET removed_at = ?1", params!["2000-01-01"])
                .expect("remove again");
            let (_, restored) = add_restoring(&conn, Path::new(&variant)).expect("add");
            assert_eq!(restored, 1, "variant {variant:?}");
            assert!(!is_removed(&conn, &book.id), "variant {variant:?}");
        }
    }
}
