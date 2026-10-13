//! Lo que el motor ofrece al resto de la app: el comando `open_document` y la resolución de la ruta de un
//! libro a partir de su ID (la misma comprobación que hace el protocolo `atril://`).

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;

use super::Engine;
use super::geometry::PageGeometry;
use crate::error::{AppError, ErrorCode};
use crate::protocol;

/// Respuesta de `open_document` (docs/IPC.md, "Motor de PDF").
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocument {
    pub page_count: u32,
    /// `atril://localhost/page/<bookId>`; el front añade `/<n>?scale=<f>` (n 1-based).
    pub page_base_url: String,
    /// Una entrada por página, en orden.
    pub pages: Vec<PageGeometry>,
}

/// Ruta del PDF de un libro que está en la biblioteca. Si el archivo ya no está, lo marca como `missing`.
pub fn resolve_book_path(db: &Mutex<Connection>, book_id: &str) -> Result<PathBuf, AppError> {
    if !protocol::is_book_id(book_id) {
        return Err(AppError::invalid_input(
            "bookId must be a 64-character lowercase hex fingerprint",
        ));
    }
    let Some(path) = protocol::lookup_book_path(db, book_id)? else {
        return Err(AppError::new(
            ErrorCode::NotFound,
            format!("no book with id {book_id}"),
        ));
    };
    let path = PathBuf::from(path);
    if !path.is_file() {
        protocol::mark_missing(db, book_id);
        return Err(AppError::new(
            ErrorCode::FileMissing,
            format!("file of book {book_id} is missing at {}", path.display()),
        ));
    }
    Ok(path)
}

/// Abre el libro en el motor y devuelve el número de páginas, la geometría de cada una y la URL base.
pub fn open_document(
    db: &Mutex<Connection>,
    engine: &Engine,
    book_id: &str,
) -> Result<OpenedDocument, AppError> {
    let path = resolve_book_path(db, book_id)?;
    let info = engine.document_info(book_id, &path)?;
    Ok(OpenedDocument {
        page_count: info.page_count,
        page_base_url: protocol::book_page_base_url(book_id),
        pages: info.pages.clone(),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::db;
    use crate::engine::EngineConfig;
    use crate::engine::testpdf::{PageSpec, build_pdf, text_book};
    use crate::library;

    fn register(pdf: &[u8]) -> (tempfile::TempDir, Mutex<Connection>, String, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = db::open(&dir.path().join("atril.db")).expect("db");
        let path = dir.path().join("libro.pdf");
        std::fs::write(&path, pdf).expect("write");
        let id = library::open_path(&mut conn, &path).expect("register").id;
        (dir, Mutex::new(conn), id, path)
    }

    #[test]
    fn open_document_returns_pages_geometry_and_the_url_base() {
        let pdf = build_pdf(
            &[
                PageSpec::with_text("one"),
                PageSpec {
                    rotate: Some(90),
                    ..PageSpec::with_text("two")
                },
            ],
            &Default::default(),
        );
        let (_dir, db, id, _path) = register(&pdf);
        let engine = Engine::new(EngineConfig::default());

        let opened = open_document(&db, &engine, &id).expect("open");

        assert_eq!(opened.page_count, 2);
        assert_eq!(opened.page_base_url, protocol::book_page_base_url(&id));
        let value = serde_json::to_value(&opened).expect("json");
        assert_eq!(value["pageCount"], json!(2));
        assert_eq!(
            value["pages"][1],
            json!({ "width": 792.0, "height": 612.0, "transform": [0.0, 1.0, 1.0, 0.0, 0.0, 0.0] })
        );
    }

    #[test]
    fn open_document_validates_the_id_and_the_file() {
        let (_dir, db, id, path) = register(&text_book(1));
        let engine = Engine::new(EngineConfig::default());

        let invalid = open_document(&db, &engine, "nope").expect_err("invalid id");
        assert_eq!(invalid.code, ErrorCode::InvalidInput);
        let unknown = open_document(&db, &engine, &"d".repeat(64)).expect_err("unknown");
        assert_eq!(unknown.code, ErrorCode::NotFound);

        std::fs::write(&path, b"not a pdf").expect("overwrite");
        let broken = open_document(&db, &engine, &id).expect_err("not a pdf");
        assert_eq!(broken.code, ErrorCode::InvalidPdf);

        std::fs::remove_file(&path).expect("remove");
        let missing = open_document(&db, &engine, &id).expect_err("missing");
        assert_eq!(missing.code, ErrorCode::FileMissing);
    }
}
