//! Utilidades de test: bases temporales y PDF/WebP generados (nunca libros reales).

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db;
use crate::library::{self, Book};

/// Base de datos nueva con todas las migraciones. Hay que guardar el `TempDir` mientras se use.
pub fn open_temp_db() -> (TempDir, Connection) {
    let dir = tempfile::tempdir().expect("tempdir");
    let conn = db::open(&dir.path().join("atril.db")).expect("open db");
    (dir, conn)
}

/// PDF mínimo de `len` bytes: cabecera `%PDF-` y relleno que depende de `seed`,
/// así dos archivos con distinta semilla tienen distinta huella.
pub fn pdf_bytes(len: usize, seed: u8) -> Vec<u8> {
    let mut bytes = b"%PDF-1.4\n".to_vec();
    while bytes.len() < len {
        bytes.push(seed.wrapping_add(bytes.len() as u8));
    }
    bytes.truncate(len);
    bytes
}

/// Escribe un PDF de 4 KiB en `dir/name`.
pub fn write_pdf(dir: &Path, name: &str, seed: u8) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, pdf_bytes(4096, seed)).expect("write pdf");
    path
}

/// Imita una portada WebP (cabecera RIFF/WEBP y relleno).
pub fn webp_bytes(len: usize) -> Vec<u8> {
    let mut bytes = b"RIFF\x00\x00\x00\x00WEBPVP8 ".to_vec();
    while bytes.len() < len {
        bytes.push(0xAB);
    }
    bytes
}

/// Importa el archivo como lo haría el usuario.
pub fn import(conn: &mut Connection, path: &Path) -> Book {
    library::open_path(conn, path).expect("import")
}

/// Imita una portada JPEG (firma FF D8 FF y relleno).
pub fn jpeg_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0xFF, 0xD8, 0xFF, 0xE0];
    while bytes.len() < len {
        bytes.push(0xCD);
    }
    bytes
}
