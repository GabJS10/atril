//! Grupos de subrayados ("Notas del capítulo 3"), por libro (`docs/IPC.md`, v1.2).
//! Borrar un grupo nunca borra subrayados: los suyos pasan a sin grupo.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::error::{AppError, ErrorCode};
use crate::library::{self, now_iso};

const MAX_NAME_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightGroup {
    pub id: String,
    pub book_id: String,
    pub name: String,
    pub position: i64,
    pub created_at: String,
}

/// Grupos de un libro, por `position` y luego por fecha de creación.
pub fn list(conn: &Connection, book_id: &str) -> Result<Vec<HighlightGroup>, AppError> {
    library::get_book(conn, book_id)?;
    let mut stmt = conn.prepare(
        "SELECT id, book_id, name, position, created_at
         FROM highlight_groups
         WHERE book_id = ?1
         ORDER BY position, created_at, id",
    )?;
    let groups = stmt
        .query_map(params![book_id], read_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(groups)
}

/// Un grupo nuevo va al final del libro.
pub fn create(conn: &Connection, book_id: &str, name: &str) -> Result<HighlightGroup, AppError> {
    library::get_book(conn, book_id)?;
    let name = validate_name(name)?;
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO highlight_groups (id, book_id, name, position, created_at)
         VALUES (?1, ?2, ?3,
                 (SELECT COALESCE(MAX(position), -1) + 1 FROM highlight_groups WHERE book_id = ?2),
                 ?4)",
        params![id, book_id, name, now_iso()],
    )?;
    find(conn, &id)
}

pub fn rename(conn: &Connection, group_id: &str, name: &str) -> Result<HighlightGroup, AppError> {
    find(conn, group_id)?;
    let name = validate_name(name)?;
    conn.execute(
        "UPDATE highlight_groups SET name = ?1 WHERE id = ?2",
        params![name, group_id],
    )?;
    find(conn, group_id)
}

/// Borra el grupo. Sus subrayados quedan sin grupo (`ON DELETE SET NULL`).
pub fn delete(conn: &Connection, group_id: &str) -> Result<(), AppError> {
    find(conn, group_id)?;
    conn.execute(
        "DELETE FROM highlight_groups WHERE id = ?1",
        params![group_id],
    )?;
    Ok(())
}

/// Comprueba que el grupo existe y es de `book_id`; si no, `invalid_input` (lo usan los subrayados).
pub fn ensure_in_book(conn: &Connection, group_id: &str, book_id: &str) -> Result<(), AppError> {
    let belongs: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM highlight_groups WHERE id = ?1 AND book_id = ?2)",
        params![group_id, book_id],
        |row| row.get(0),
    )?;
    if belongs {
        Ok(())
    } else {
        Err(AppError::invalid_input(format!(
            "group {group_id} does not belong to this book"
        )))
    }
}

/// Nombre sin espacios en los bordes, de 1 a 200 caracteres.
fn validate_name(name: &str) -> Result<String, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::invalid_input(format!(
            "highlight group name must have 1 to {MAX_NAME_CHARS} characters"
        )));
    }
    Ok(trimmed.to_owned())
}

/// Un grupo de un libro quitado de la biblioteca no existe, como en los subrayados.
fn find(conn: &Connection, id: &str) -> Result<HighlightGroup, AppError> {
    conn.query_row(
        "SELECT g.id, g.book_id, g.name, g.position, g.created_at
         FROM highlight_groups g
         JOIN books b ON b.id = g.book_id
         WHERE g.id = ?1 AND b.removed_at IS NULL",
        params![id],
        read_row,
    )
    .optional()?
    .ok_or_else(|| {
        AppError::new(
            ErrorCode::NotFound,
            format!("no highlight group with id {id}"),
        )
    })
}

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HighlightGroup> {
    Ok(HighlightGroup {
        id: row.get(0)?,
        book_id: row.get(1)?,
        name: row.get(2)?,
        position: row.get(3)?,
        created_at: row.get(4)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::highlights::{self, HighlightColor, HighlightInput};
    use crate::library::remove_book;
    use crate::test_support::{import, open_temp_db, write_pdf};

    #[test]
    fn name_is_trimmed_and_length_checked() {
        assert_eq!(
            validate_name("  Capítulo 3  ").expect("valid"),
            "Capítulo 3"
        );
        let longest = "x".repeat(MAX_NAME_CHARS);
        assert_eq!(validate_name(&longest).expect("200 ok"), longest);
        assert_eq!(
            validate_name("   ").expect_err("blank").code,
            ErrorCode::InvalidInput
        );
        let too_long = "x".repeat(MAX_NAME_CHARS + 1);
        assert_eq!(
            validate_name(&too_long).expect_err("long").code,
            ErrorCode::InvalidInput
        );
    }

    #[test]
    fn create_rename_delete_keep_order_per_book() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));

        let first = create(&conn, &book.id, "Capítulo 1").expect("create");
        let second = create(&conn, &book.id, "Capítulo 2").expect("create");
        assert_eq!((first.position, second.position), (0, 1));
        assert_eq!(first.book_id, book.id);

        let renamed = rename(&conn, &second.id, "  Capítulo 2 (revisado) ").expect("rename");
        assert_eq!(renamed.name, "Capítulo 2 (revisado)");
        assert_eq!(renamed.position, 1);

        let names: Vec<String> = list(&conn, &book.id)
            .expect("list")
            .into_iter()
            .map(|group| group.name)
            .collect();
        assert_eq!(names, vec!["Capítulo 1", "Capítulo 2 (revisado)"]);

        delete(&conn, &first.id).expect("delete");
        let left = list(&conn, &book.id).expect("list");
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].id, second.id);
        assert_eq!(
            delete(&conn, &first.id).expect_err("gone").code,
            ErrorCode::NotFound
        );
        assert_eq!(
            rename(&conn, &first.id, "otro").expect_err("gone").code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn new_group_goes_after_the_last_one_of_its_own_book() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        let other = import(&mut conn, &write_pdf(dir.path(), "b.pdf", 2));

        create(&conn, &book.id, "uno").expect("create");
        create(&conn, &book.id, "dos").expect("create");
        let elsewhere = create(&conn, &other.id, "otro libro").expect("create");

        assert_eq!(elsewhere.position, 0);
    }

    #[test]
    fn invalid_names_are_rejected_and_nothing_is_written() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        let group = create(&conn, &book.id, "bueno").expect("create");

        assert_eq!(
            create(&conn, &book.id, "  ").expect_err("blank").code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            create(&conn, &book.id, &"x".repeat(MAX_NAME_CHARS + 1))
                .expect_err("long")
                .code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            rename(&conn, &group.id, "").expect_err("blank rename").code,
            ErrorCode::InvalidInput
        );
        assert_eq!(list(&conn, &book.id).expect("list")[0].name, "bueno");
    }

    #[test]
    fn unknown_group_or_book_is_not_found() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));

        assert_eq!(
            list(&conn, "nope").expect_err("list").code,
            ErrorCode::NotFound
        );
        assert_eq!(
            create(&conn, "nope", "x").expect_err("create").code,
            ErrorCode::NotFound
        );
        assert_eq!(
            rename(&conn, "nope", "x").expect_err("rename").code,
            ErrorCode::NotFound
        );
        assert_eq!(
            delete(&conn, "nope").expect_err("delete").code,
            ErrorCode::NotFound
        );
        assert!(list(&conn, &book.id).expect("list").is_empty());
    }

    #[test]
    fn removed_book_hides_and_blocks_its_groups_but_keeps_them() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = write_pdf(dir.path(), "a.pdf", 1);
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &path);
        let group = create(&conn, &book.id, "capítulo").expect("create");
        remove_book(&conn, &book.id).expect("remove");

        assert_eq!(
            list(&conn, &book.id).expect_err("list").code,
            ErrorCode::NotFound
        );
        assert_eq!(
            rename(&conn, &group.id, "otro").expect_err("rename").code,
            ErrorCode::NotFound
        );
        assert_eq!(
            delete(&conn, &group.id).expect_err("delete").code,
            ErrorCode::NotFound
        );

        import(&mut conn, &path);
        assert_eq!(list(&conn, &book.id).expect("back")[0].name, "capítulo");
    }

    #[test]
    fn deleting_a_group_moves_its_highlights_to_no_group() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        let group = create(&conn, &book.id, "capítulo 3").expect("create");
        let highlight = highlights::create(
            &conn,
            HighlightInput {
                book_id: book.id.clone(),
                page: 1,
                rects: vec![[72.0, 100.0, 300.0, 112.0]],
                text: "subrayado".into(),
                color: HighlightColor::Sage,
                note: None,
                group_id: Some(group.id.clone()),
            },
        )
        .expect("highlight");
        assert_eq!(highlight.group_id.as_deref(), Some(group.id.as_str()));

        delete(&conn, &group.id).expect("delete group");

        let kept = highlights::list(&conn, &book.id, None).expect("list");
        assert_eq!(kept.len(), 1, "the highlight survives");
        assert_eq!(kept[0].group_id, None);
        assert_eq!(kept[0].text, "subrayado");
    }

    #[test]
    fn deleting_the_book_row_deletes_its_groups() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        create(&conn, &book.id, "uno").expect("create");
        create(&conn, &book.id, "dos").expect("create");

        // La app nunca borra la fila (solo la marca como quitada); el borrado real cae en cascada.
        conn.execute("DELETE FROM books WHERE id = ?1", params![book.id])
            .expect("hard delete");

        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM highlight_groups", [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(left, 0);
    }
}
