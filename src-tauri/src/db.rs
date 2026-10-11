//! Conexión SQLite y migraciones versionadas (`PRAGMA user_version`).

use std::path::Path;

use rusqlite::Connection;

use crate::error::AppError;

/// Migraciones en orden: la número `n` (1-based) deja `user_version` en `n`.
/// No se edita una migración ya publicada: se añade un archivo nuevo.
const MIGRATIONS: &[&str] = &[include_str!("migrations/0001_initial.sql")];

const APP_DIR_NAME: &str = "atril";
const DB_FILE_NAME: &str = "atril.db";

/// Abre la base de datos de la app en `~/.local/share/atril/atril.db`
/// (crea la carpeta si no existe) y la deja al día con las migraciones.
pub fn open_app_database() -> Result<Connection, AppError> {
    let data_dir = dirs::data_local_dir()
        .ok_or_else(|| AppError::internal("no data directory for this user"))?
        .join(APP_DIR_NAME);
    std::fs::create_dir_all(&data_dir)?;

    open(&data_dir.join(DB_FILE_NAME))
}

/// Abre (o crea) una base de datos en `path` y aplica las migraciones pendientes.
pub fn open(path: &Path) -> Result<Connection, AppError> {
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    migrate(&mut conn)?;

    tracing::info!(path = %path.display(), "database ready");
    Ok(conn)
}

/// Aplica las migraciones que falten. Cada una va en su propia transacción
/// junto con la subida de `user_version`, así que un fallo no deja medio esquema.
pub fn migrate(conn: &mut Connection) -> Result<(), AppError> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let latest = MIGRATIONS.len() as i64;

    if current > latest {
        return Err(AppError::db(format!(
            "database schema version {current} is newer than this app supports ({latest})"
        )));
    }

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
    }

    Ok(())
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
        migrate(&mut conn).expect("third migrate");

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
    fn newer_schema_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = Connection::open(dir.path().join("atril.db")).expect("open");
        conn.pragma_update(None, "user_version", MIGRATIONS.len() as i64 + 1)
            .expect("set version");

        let error = migrate(&mut conn).expect_err("must refuse");

        assert_eq!(error.code, crate::error::ErrorCode::Db);
    }
}
