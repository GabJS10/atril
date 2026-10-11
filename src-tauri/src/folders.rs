//! Carpetas de la biblioteca: lo que se escanea y se vigila.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::error::{AppError, ErrorCode};
use crate::library::now_iso;

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

/// Añade una carpeta. Si ya estaba, devuelve la existente.
pub fn add(conn: &Connection, path: &Path) -> Result<LibraryFolder, AppError> {
    if !path.is_dir() {
        return Err(AppError::invalid_input(format!(
            "{} is not a folder",
            path.display()
        )));
    }
    let stored = path
        .to_str()
        .ok_or_else(|| AppError::invalid_input("path is not valid UTF-8"))?;

    let existing = conn
        .query_row(
            "SELECT id, path, added_at FROM library_folders WHERE path = ?1",
            params![stored],
            |row| {
                Ok(LibraryFolder {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    added_at: row.get(2)?,
                })
            },
        )
        .optional()?;
    if let Some(folder) = existing {
        return Ok(folder);
    }

    let folder = LibraryFolder {
        id: uuid::Uuid::new_v4().to_string(),
        path: stored.to_owned(),
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
}
