//! Carpetas de la biblioteca: lo que se escanea y se vigila.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::error::{AppError, ErrorCode};
use crate::library::now_iso;
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
}
