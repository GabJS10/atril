//! Salas: colecciones de libros. Borrar una Sala nunca borra libros.

use std::collections::HashMap;

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::error::{AppError, ErrorCode};
use crate::library::{self, Book};

/// Máximo de portadas que muestra una Sala.
const SAMPLE_SIZE: usize = 4;
const MAX_NAME_CHARS: usize = 100;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub book_count: i64,
    pub sample_books: Vec<Book>,
}

/// Todas las Salas, en orden de `position`.
pub fn list(conn: &Connection) -> Result<Vec<Collection>, AppError> {
    let books: HashMap<String, Book> = library::visible_books(conn)?
        .into_iter()
        .map(|book| (book.id.clone(), book))
        .collect();

    // Los libros de cada Sala, por fecha de alta, para que la muestra sea estable.
    let mut members: HashMap<String, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT bc.collection_id, bc.book_id
         FROM book_collections bc
         JOIN books b ON b.id = bc.book_id
         WHERE b.removed_at IS NULL
         ORDER BY b.added_at, b.id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (collection_id, book_id) = row?;
        members.entry(collection_id).or_default().push(book_id);
    }

    let mut stmt =
        conn.prepare("SELECT id, name, position FROM collections ORDER BY position, name")?;
    let collections = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(collections
        .into_iter()
        .map(|(id, name, position)| {
            let ids = members.get(&id).map_or(&[][..], Vec::as_slice);
            let sample_books = ids
                .iter()
                .filter_map(|book_id| books.get(book_id))
                .filter(|book| !book.missing)
                .take(SAMPLE_SIZE)
                .cloned()
                .collect();
            Collection {
                id,
                name,
                position,
                book_count: ids.len() as i64,
                sample_books,
            }
        })
        .collect())
}

pub fn create(conn: &Connection, name: &str) -> Result<Collection, AppError> {
    let name = validate_name(name)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO collections (id, name, position)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM collections))",
        params![id, name],
    )?;
    find(conn, &id)
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<Collection, AppError> {
    let name = validate_name(name)?;
    let changed = conn.execute(
        "UPDATE collections SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;
    if changed == 0 {
        return Err(not_found(id));
    }
    find(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), AppError> {
    let changed = conn.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(not_found(id));
    }
    Ok(())
}

/// Añade libros a una Sala. Idempotente: un libro no se repite.
pub fn add_books(
    conn: &mut Connection,
    collection_id: &str,
    book_ids: &[String],
) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    ensure_exists(&tx, collection_id)?;
    for book_id in book_ids {
        let known: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM books WHERE id = ?1 AND removed_at IS NULL)",
            params![book_id],
            |row| row.get(0),
        )?;
        if !known {
            return Err(AppError::new(
                ErrorCode::NotFound,
                format!("no book with id {book_id}"),
            ));
        }
        tx.execute(
            "INSERT OR IGNORE INTO book_collections (book_id, collection_id) VALUES (?1, ?2)",
            params![book_id, collection_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn remove_books(
    conn: &mut Connection,
    collection_id: &str,
    book_ids: &[String],
) -> Result<(), AppError> {
    let tx = conn.transaction()?;
    ensure_exists(&tx, collection_id)?;
    for book_id in book_ids {
        tx.execute(
            "DELETE FROM book_collections WHERE book_id = ?1 AND collection_id = ?2",
            params![book_id, collection_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

fn ensure_exists(conn: &Connection, id: &str) -> Result<(), AppError> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM collections WHERE id = ?1)",
        params![id],
        |row| row.get(0),
    )?;
    if exists { Ok(()) } else { Err(not_found(id)) }
}

fn find(conn: &Connection, id: &str) -> Result<Collection, AppError> {
    list(conn)?
        .into_iter()
        .find(|collection| collection.id == id)
        .ok_or_else(|| not_found(id))
}

/// Nombre sin espacios en los bordes, de 1 a 100 caracteres.
fn validate_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::invalid_input(format!(
            "collection name must have 1 to {MAX_NAME_CHARS} characters"
        )));
    }
    Ok(trimmed.to_owned())
}

fn not_found(id: &str) -> AppError {
    AppError::new(ErrorCode::NotFound, format!("no collection with id {id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn name_is_trimmed_and_length_checked() {
        assert_eq!(validate_name("  Novela  ").expect("valid"), "Novela");
        assert_eq!(
            validate_name("   ").expect_err("blank").code,
            ErrorCode::InvalidInput
        );
        let long = "x".repeat(MAX_NAME_CHARS + 1);
        assert_eq!(
            validate_name(&long).expect_err("long").code,
            ErrorCode::InvalidInput
        );
    }

    #[test]
    fn create_rename_delete_round_trip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = db::open(&dir.path().join("atril.db")).expect("db");

        let first = create(&conn, "Filosofía").expect("create");
        let second = create(&conn, "Novela").expect("create");
        assert_eq!(first.position, 0);
        assert_eq!(second.position, 1);

        let renamed = rename(&conn, &first.id, "Ensayo").expect("rename");
        assert_eq!(renamed.name, "Ensayo");

        delete(&conn, &second.id).expect("delete");
        let names: Vec<String> = list(&conn)
            .expect("list")
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(names, vec!["Ensayo"]);
        assert_eq!(
            delete(&conn, &second.id).expect_err("gone").code,
            ErrorCode::NotFound
        );
    }
}

#[cfg(test)]
mod membership_tests {
    use super::*;
    use crate::library;
    use crate::test_support::{import, open_temp_db, write_pdf};

    #[test]
    fn sample_shows_up_to_four_books_and_counts_all_of_them() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let ids: Vec<String> = (1..=5u8)
            .map(|seed| {
                import(
                    &mut conn,
                    &write_pdf(dir.path(), &format!("libro{seed}.pdf"), seed),
                )
                .id
            })
            .collect();
        let room = create(&conn, "Todos").expect("create");

        add_books(&mut conn, &room.id, &ids).expect("add");
        add_books(&mut conn, &room.id, &ids[..1]).expect("idempotent");

        let listed = list(&conn).expect("list").pop().expect("room");
        assert_eq!(listed.book_count, 5);
        assert_eq!(listed.sample_books.len(), SAMPLE_SIZE);
    }

    #[test]
    fn unknown_book_or_room_is_not_found_and_adds_nothing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        let room = create(&conn, "Sala").expect("create");

        let unknown_book = add_books(&mut conn, &room.id, &[book.id.clone(), "nope".into()]);
        assert_eq!(unknown_book.expect_err("book").code, ErrorCode::NotFound);
        assert_eq!(
            list(&conn).expect("list")[0].book_count,
            0,
            "transaction rolled back"
        );

        let unknown_room = add_books(&mut conn, "nope", std::slice::from_ref(&book.id));
        assert_eq!(unknown_room.expect_err("room").code, ErrorCode::NotFound);
    }

    #[test]
    fn removing_books_and_deleting_rooms_never_deletes_books() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        let room = create(&conn, "Sala").expect("create");
        add_books(&mut conn, &room.id, std::slice::from_ref(&book.id)).expect("add");

        remove_books(&mut conn, &room.id, std::slice::from_ref(&book.id)).expect("remove");
        assert_eq!(list(&conn).expect("list")[0].book_count, 0);

        add_books(&mut conn, &room.id, std::slice::from_ref(&book.id)).expect("add again");
        delete(&conn, &room.id).expect("delete room");
        assert!(list(&conn).expect("list").is_empty());
        assert!(library::get_book(&conn, &book.id).is_ok());
    }
}
