//! Consultas de la biblioteca: `get_home` y `list_books`.
//! Se filtra y ordena en Rust sobre la lista completa: son cientos de libros y así la búsqueda
//! puede ignorar acentos, algo que SQLite no hace.

use std::cmp::Ordering;
use std::collections::HashSet;

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::collections::{self, Collection};
use crate::error::AppError;
use crate::library::{self, Book};

const HOME_CONTINUE_LIMIT: usize = 8;
const HOME_FAVORITES_LIMIT: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookSort {
    #[default]
    Title,
    Author,
    Added,
    LastOpened,
    Progress,
}

/// unread: sin progreso o 0; reading: 0 < progreso < 1; finished: progreso 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BookStatus {
    Unread,
    Reading,
    Finished,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BookQuery {
    pub text: Option<String>,
    pub collection_id: Option<String>,
    pub favorites_only: bool,
    pub status: Option<BookStatus>,
    pub sort: BookSort,
    pub descending: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeData {
    pub continue_reading: Vec<Book>,
    pub favorites: Vec<Book>,
    pub favorite_count: i64,
    pub book_count: i64,
    pub collections: Vec<Collection>,
}

pub fn list_books(conn: &Connection, query: &BookQuery) -> Result<Vec<Book>, AppError> {
    let members: Option<HashSet<String>> = match &query.collection_id {
        Some(collection_id) => Some(collection_members(conn, collection_id)?),
        None => None,
    };
    let needle = query
        .text
        .as_deref()
        .map(fold)
        .filter(|text| !text.is_empty());

    let mut books: Vec<Book> = library::visible_books(conn)?
        .into_iter()
        .filter(|book| !query.favorites_only || book.favorite)
        .filter(|book| members.as_ref().is_none_or(|ids| ids.contains(&book.id)))
        .filter(|book| {
            query
                .status
                .is_none_or(|status| matches_status(book, status))
        })
        .filter(|book| needle.as_ref().is_none_or(|text| matches_text(book, text)))
        .collect();

    books.sort_by(|a, b| {
        let order = compare(a, b, query.sort).then_with(|| fold(&a.title).cmp(&fold(&b.title)));
        let order = order.then_with(|| a.id.cmp(&b.id));
        if query.descending {
            order.reverse()
        } else {
            order
        }
    });
    Ok(books)
}

pub fn get_home(conn: &Connection) -> Result<HomeData, AppError> {
    let books = library::visible_books(conn)?;

    let mut continue_reading: Vec<Book> = books
        .iter()
        .filter(|book| {
            book.last_opened_at.is_some()
                && !book.missing
                && book.progress.is_some_and(|progress| progress < 1.0)
        })
        .cloned()
        .collect();
    continue_reading.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));
    continue_reading.truncate(HOME_CONTINUE_LIMIT);

    let favorite_count = books.iter().filter(|book| book.favorite).count() as i64;
    let mut favorites: Vec<Book> = books.iter().filter(|book| book.favorite).cloned().collect();
    favorites.sort_by_cached_key(|book| fold(&book.title));
    favorites.truncate(HOME_FAVORITES_LIMIT);

    Ok(HomeData {
        continue_reading,
        favorites,
        favorite_count,
        book_count: books.len() as i64,
        collections: collections::list(conn)?,
    })
}

fn collection_members(conn: &Connection, collection_id: &str) -> Result<HashSet<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT bc.book_id FROM book_collections bc
         JOIN books b ON b.id = bc.book_id
         WHERE bc.collection_id = ?1 AND b.removed_at IS NULL",
    )?;
    let ids = stmt
        .query_map(params![collection_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    Ok(ids)
}

fn matches_status(book: &Book, status: BookStatus) -> bool {
    let progress = book.progress.unwrap_or(0.0);
    match status {
        BookStatus::Unread => progress <= 0.0,
        BookStatus::Reading => progress > 0.0 && progress < 1.0,
        BookStatus::Finished => progress >= 1.0,
    }
}

fn matches_text(book: &Book, needle: &str) -> bool {
    let haystack = format!(
        "{} {} {}",
        fold(&book.title),
        book.author.as_deref().map(fold).unwrap_or_default(),
        fold(&book.file_name)
    );
    haystack.contains(needle)
}

fn compare(a: &Book, b: &Book, sort: BookSort) -> Ordering {
    match sort {
        BookSort::Title => fold(&a.title).cmp(&fold(&b.title)),
        BookSort::Author => a
            .author
            .as_deref()
            .map(fold)
            .cmp(&b.author.as_deref().map(fold)),
        BookSort::Added => a.added_at.cmp(&b.added_at),
        BookSort::LastOpened => a.last_opened_at.cmp(&b.last_opened_at),
        BookSort::Progress => a
            .progress
            .unwrap_or(-1.0)
            .total_cmp(&b.progress.unwrap_or(-1.0)),
    }
}

/// Minúsculas y sin marcas diacríticas: "Páramo" → "paramo".
pub fn fold(text: &str) -> String {
    text.nfd()
        .filter(|c| !('\u{0300}'..='\u{036F}').contains(c))
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_ignores_case_and_accents() {
        assert_eq!(fold("Pedro Páramo"), "pedro paramo");
        assert_eq!(fold("Año Nuevo"), "ano nuevo");
        assert_eq!(fold("Ñandú"), "nandu");
    }

    #[test]
    fn default_query_sorts_by_title_ascending() {
        let query = BookQuery::default();

        assert_eq!(query.sort, BookSort::Title);
        assert!(!query.descending);
        assert!(!query.favorites_only);
    }

    #[test]
    fn query_deserializes_from_camel_case_and_empty_object() {
        let empty: BookQuery = serde_json::from_value(serde_json::json!({})).expect("empty");
        assert_eq!(empty, BookQuery::default());

        let query: BookQuery = serde_json::from_value(serde_json::json!({
            "text": "paramo",
            "collectionId": "abc",
            "favoritesOnly": true,
            "status": "reading",
            "sort": "last_opened",
            "descending": true
        }))
        .expect("full");
        assert_eq!(query.sort, BookSort::LastOpened);
        assert_eq!(query.status, Some(BookStatus::Reading));
        assert!(query.favorites_only && query.descending);
    }
}

#[cfg(test)]
mod listing_tests {
    use super::*;
    use crate::collections;
    use crate::library::{
        self, ReadingStateInput, ScanInput, save_book_scan, save_reading_state, set_favorite,
    };
    use crate::settings::{ViewMode, Zoom, ZoomPreset};
    use crate::test_support::{import, open_temp_db, webp_bytes, write_pdf};
    use rusqlite::Connection;

    /// Biblioteca de muestra: (nombre de archivo, autor, páginas leídas de `total`).
    fn sample_library(conn: &mut Connection, dir: &std::path::Path) -> Vec<Book> {
        let covers = tempfile::tempdir().expect("covers");
        let entries = [
            ("Pedro Páramo.pdf", 1u8, 2i64, 10i64),
            ("Ficciones.pdf", 2, 0, 0),
            ("Meditaciones.pdf", 3, 10, 10),
            ("Rayuela.pdf", 4, 3, 10),
        ];
        let mut books = Vec::new();
        for (name, seed, page, total) in entries {
            let book = import(conn, &write_pdf(dir, name, seed));
            if page > 0 {
                save_reading_state(
                    conn,
                    &book.id,
                    &ReadingStateInput {
                        page,
                        offset_in_page: 0.0,
                        zoom: Zoom::Preset(ZoomPreset::PageWidth),
                        view_mode: ViewMode::Normal,
                        page_count: total,
                    },
                )
                .expect("save state");
            }
            books.push(book);
        }
        // Portada solo en Rayuela, para comprobar cover_url.
        let rayuela = &books[3];
        save_book_scan(
            conn,
            covers.path(),
            &rayuela.id,
            &ScanInput {
                page_count: 10,
                title: None,
                author: Some("Julio Cortázar".into()),
            },
            &webp_bytes(64),
        )
        .expect("scan");
        books
    }

    fn titles(books: &[Book]) -> Vec<&str> {
        books.iter().map(|book| book.title.as_str()).collect()
    }

    #[test]
    fn default_listing_is_sorted_by_title_and_search_ignores_accents() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        sample_library(&mut conn, dir.path());

        let all = list_books(&conn, &BookQuery::default()).expect("all");
        assert_eq!(
            titles(&all),
            vec!["Ficciones", "Meditaciones", "Pedro Páramo", "Rayuela"]
        );

        let found = list_books(
            &conn,
            &BookQuery {
                text: Some("PARAMO".into()),
                ..BookQuery::default()
            },
        )
        .expect("search");
        assert_eq!(titles(&found), vec!["Pedro Páramo"]);

        let by_author = list_books(
            &conn,
            &BookQuery {
                text: Some("cortazar".into()),
                ..BookQuery::default()
            },
        )
        .expect("author search");
        assert_eq!(titles(&by_author), vec!["Rayuela"]);
    }

    #[test]
    fn status_filter_and_progress_sort() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        sample_library(&mut conn, dir.path());

        let finished = list_books(
            &conn,
            &BookQuery {
                status: Some(BookStatus::Finished),
                ..BookQuery::default()
            },
        )
        .expect("finished");
        assert_eq!(titles(&finished), vec!["Meditaciones"]);

        let reading = list_books(
            &conn,
            &BookQuery {
                status: Some(BookStatus::Reading),
                ..BookQuery::default()
            },
        )
        .expect("reading");
        assert_eq!(titles(&reading), vec!["Pedro Páramo", "Rayuela"]);

        let unread = list_books(
            &conn,
            &BookQuery {
                status: Some(BookStatus::Unread),
                ..BookQuery::default()
            },
        )
        .expect("unread");
        assert_eq!(titles(&unread), vec!["Ficciones"]);

        let by_progress = list_books(
            &conn,
            &BookQuery {
                sort: BookSort::Progress,
                descending: true,
                ..BookQuery::default()
            },
        )
        .expect("sorted");
        assert_eq!(titles(&by_progress)[0], "Meditaciones");
    }

    #[test]
    fn favorites_and_collection_filters() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let books = sample_library(&mut conn, dir.path());
        set_favorite(&conn, &books[1].id, true).expect("fav");
        let room = collections::create(&conn, "Novela").expect("room");
        collections::add_books(
            &mut conn,
            &room.id,
            &[books[0].id.clone(), books[3].id.clone()],
        )
        .expect("add");

        let favorites = list_books(
            &conn,
            &BookQuery {
                favorites_only: true,
                ..BookQuery::default()
            },
        )
        .expect("favorites");
        assert_eq!(titles(&favorites), vec!["Ficciones"]);

        let in_room = list_books(
            &conn,
            &BookQuery {
                collection_id: Some(room.id.clone()),
                ..BookQuery::default()
            },
        )
        .expect("room");
        assert_eq!(titles(&in_room), vec!["Pedro Páramo", "Rayuela"]);
    }

    #[test]
    fn home_has_continue_reading_favorites_and_rooms() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let books = sample_library(&mut conn, dir.path());
        set_favorite(&conn, &books[2].id, true).expect("fav");
        let room = collections::create(&conn, "Filosofía").expect("room");
        collections::add_books(&mut conn, &room.id, &[books[2].id.clone()]).expect("add");
        for book in &books {
            library::open_book(&conn, &book.id).expect("open");
        }

        let home = get_home(&conn).expect("home");

        // Meditaciones está terminada: no sale en "Seguir leyendo".
        assert_eq!(home.continue_reading.len(), 2);
        assert!(
            home.continue_reading
                .iter()
                .all(|book| book.progress.is_some_and(|p| p < 1.0))
        );
        assert_eq!(home.book_count, 4);
        assert_eq!(home.favorite_count, 1);
        assert_eq!(titles(&home.favorites), vec!["Meditaciones"]);
        assert_eq!(home.collections.len(), 1);
        assert_eq!(home.collections[0].book_count, 1);
        assert_eq!(
            titles(&home.collections[0].sample_books),
            vec!["Meditaciones"]
        );
    }

    #[test]
    fn cover_url_appears_only_after_a_scan_saved_one() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let books = sample_library(&mut conn, dir.path());

        let listed = list_books(&conn, &BookQuery::default()).expect("list");
        let rayuela = listed
            .iter()
            .find(|b| b.title == "Rayuela")
            .expect("rayuela");
        let ficciones = listed
            .iter()
            .find(|b| b.title == "Ficciones")
            .expect("ficciones");

        assert_eq!(
            rayuela.cover_url,
            Some(crate::protocol::book_cover_url(&books[3].id))
        );
        assert_eq!(ficciones.cover_url, None);
        assert_eq!(rayuela.author.as_deref(), Some("Julio Cortázar"));
    }
}
