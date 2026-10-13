//! Conexión SQLite y migraciones versionadas (`PRAGMA user_version`).

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::error::AppError;

/// Migraciones en orden: la número `n` (1-based) deja `user_version` en `n`.
/// No se edita una migración ya publicada: se añade un archivo nuevo.
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/0001_initial.sql"),
    include_str!("migrations/0002_library.sql"),
    include_str!("migrations/0003_title_source.sql"),
    include_str!("migrations/0004_regenerate_covers.sql"),
    include_str!("migrations/0005_reindex_filename_titles.sql"),
];

/// Versión que obliga a borrar las portadas de `covers/` al aplicarse (ver `0004_regenerate_covers.sql`).
pub const COVERS_RESET_VERSION: i64 = 4;

const APP_DIR_NAME: &str = "atril";
const DB_FILE_NAME: &str = "atril.db";

/// Carpeta de datos de la app (`~/.local/share/atril/`), creada si no existe.
pub fn data_dir() -> Result<PathBuf, AppError> {
    let data_dir = dirs::data_local_dir()
        .ok_or_else(|| AppError::internal("no data directory for this user"))?
        .join(APP_DIR_NAME);
    std::fs::create_dir_all(&data_dir)?;
    Ok(data_dir)
}

/// Abre la base de datos de la app dentro de `data_dir` y la deja al día con las migraciones.
/// Devuelve también las versiones aplicadas en esta llamada.
pub fn open_app_database(data_dir: &Path) -> Result<(Connection, Vec<i64>), AppError> {
    open_tracking(&data_dir.join(DB_FILE_NAME))
}

/// Abre (o crea) una base de datos en `path` y aplica las migraciones pendientes.
pub fn open(path: &Path) -> Result<Connection, AppError> {
    open_tracking(path).map(|(conn, _)| conn)
}

fn open_tracking(path: &Path) -> Result<(Connection, Vec<i64>), AppError> {
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    let applied = migrate(&mut conn)?;

    tracing::info!(path = %path.display(), "database ready");
    Ok((conn, applied))
}

/// Aplica las migraciones que falten y devuelve sus versiones. Cada una va en su propia
/// transacción junto con la subida de `user_version`, así que un fallo no deja medio esquema.
pub fn migrate(conn: &mut Connection) -> Result<Vec<i64>, AppError> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let latest = MIGRATIONS.len() as i64;

    if current > latest {
        return Err(AppError::db(format!(
            "database schema version {current} is newer than this app supports ({latest})"
        )));
    }

    let mut applied = Vec::new();
    for (index, sql) in MIGRATIONS.iter().enumerate() {
        let version = index as i64 + 1;
        if version <= current {
            continue;
        }

        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;

        tracing::info!(version, "applied database migration");
        applied.push(version);
    }

    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPECTED_TABLES: &[&str] = &[
        "book_collections",
        "books",
        "collections",
        "highlights",
        "library_folders",
        "reading_state",
        "settings",
    ];

    fn user_version(conn: &Connection) -> i64 {
        conn.pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("user_version")
    }

    fn table_names(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .expect("prepare");
        stmt.query_map([], |row| row.get(0))
            .expect("query")
            .map(|row| row.expect("row"))
            .collect()
    }

    #[test]
    fn fresh_database_gets_every_table_and_latest_version() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = open(&dir.path().join("atril.db")).expect("open");

        assert_eq!(user_version(&conn), MIGRATIONS.len() as i64);
        assert_eq!(table_names(&conn), EXPECTED_TABLES);
    }

    #[test]
    fn reapplying_migrations_keeps_schema_and_data() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("atril.db");
        {
            let conn = open(&path).expect("first open");
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('theme', '\"light\"')",
                [],
            )
            .expect("insert");
        }

        let mut conn = open(&path).expect("second open");
        assert!(migrate(&mut conn).expect("third migrate").is_empty());

        assert_eq!(user_version(&conn), MIGRATIONS.len() as i64);
        assert_eq!(table_names(&conn), EXPECTED_TABLES);
        let theme: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .expect("row survives");
        assert_eq!(theme, "\"light\"");
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = open(&dir.path().join("atril.db")).expect("open");

        let result = conn.execute(
            "INSERT INTO highlights (id, book_id, page, rects, color, created_at, updated_at)
             VALUES ('h1', 'missing-book', 1, '[]', 'ochre', 'now', 'now')",
            [],
        );

        assert!(result.is_err());
    }

    #[test]
    fn version_4_regenerates_done_and_failed_books_only() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = Connection::open(dir.path().join("atril.db")).expect("open");
        for sql in &MIGRATIONS[..3] {
            conn.execute_batch(sql).expect("old migration");
        }
        conn.pragma_update(None, "user_version", 3)
            .expect("version");
        for (id, state, has_cover) in [("a", "done", 1), ("b", "failed", 0), ("c", "pending", 0)] {
            conn.execute(
                "INSERT INTO books (id, path, file_size, title, added_at, scan_state, has_cover)
                 VALUES (?1, ?1, 1, ?1, 'now', ?2, ?3)",
                rusqlite::params![id, state, has_cover],
            )
            .expect("insert");
        }

        let applied = migrate(&mut conn).expect("migrate");

        assert!(applied.contains(&COVERS_RESET_VERSION));
        let states: Vec<(String, String, i64)> = conn
            .prepare("SELECT id, scan_state, has_cover FROM books ORDER BY id")
            .expect("prepare")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .expect("query")
            .map(|row| row.expect("row"))
            .collect();
        assert_eq!(
            states,
            vec![
                ("a".to_string(), "pending".to_string(), 0),
                ("b".to_string(), "pending".to_string(), 0),
                ("c".to_string(), "pending".to_string(), 0),
            ]
        );
    }

    #[test]
    fn version_5_reindexes_filename_like_metadata_titles_only() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = Connection::open(dir.path().join("atril.db")).expect("open");
        for sql in &MIGRATIONS[..4] {
            conn.execute_batch(sql).expect("old migration");
        }
        conn.pragma_update(None, "user_version", 4)
            .expect("version");
        let books = [
            // (id, título, origen, estado)
            ("pmd", "01-Prefacio_3a.pmd", "metadata", "done"),
            ("pdf", "scan_0012.pdf", "metadata", "done"),
            ("normal", "Fe Explicada", "metadata", "done"),
            ("doctor", "Dr. Smith", "metadata", "done"),
            ("by-name", "informe.final", "filename", "done"),
            ("user", "mi.titulo", "user", "done"),
            ("failed", "roto.pmd", "metadata", "failed"),
        ];
        for (id, title, source, state) in books {
            conn.execute(
                "INSERT INTO books (id, path, file_size, title, added_at, scan_state, title_source, has_cover)
                 VALUES (?1, ?1, 1, ?2, 'now', ?4, ?3, 1)",
                rusqlite::params![id, title, source, state],
            )
            .expect("insert");
        }

        assert_eq!(migrate(&mut conn).expect("migrate"), vec![5]);

        let states = |conn: &Connection| -> Vec<(String, String, i64)> {
            conn.prepare("SELECT id, scan_state, has_cover FROM books ORDER BY id")
                .expect("prepare")
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .expect("query")
                .map(|row| row.expect("row"))
                .collect()
        };
        let expected = |id: &str| -> &str {
            match id {
                "pmd" | "pdf" => "pending",
                "failed" => "failed",
                _ => "done",
            }
        };
        let after = states(&conn);
        for (id, state, has_cover) in &after {
            assert_eq!(state, expected(id), "book {id}");
            assert_eq!(*has_cover, 1, "the cover is kept until it is regenerated");
        }

        // Idempotente: no hay nada más que aplicar y repetir la sentencia no cambia nada.
        assert!(migrate(&mut conn).expect("second migrate").is_empty());
        conn.execute_batch(MIGRATIONS[4]).expect("rerun");
        assert_eq!(states(&conn), after);
    }

    #[test]
    fn newer_schema_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = Connection::open(dir.path().join("atril.db")).expect("open");
        conn.pragma_update(None, "user_version", MIGRATIONS.len() as i64 + 1)
            .expect("set version");

        let error = migrate(&mut conn).expect_err("must refuse");

        assert_eq!(error.code, crate::error::ErrorCode::Db);
    }
}
