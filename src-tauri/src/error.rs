use serde::Serialize;
use thiserror::Error;

/// Código de error que la UI usa para elegir su propio texto (ver `docs/IPC.md`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NotFound,
    FileMissing,
    InvalidPdf,
    InvalidInput,
    Io,
    Db,
    Internal,
}

/// Error que devuelve todo comando Tauri. `message` es un detalle técnico en inglés.
#[derive(Debug, Clone, PartialEq, Eq, Error, Serialize)]
#[error("{message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidInput, message)
    }

    pub fn db(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Db, message)
    }

    pub fn io(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Io, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::db(error.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::io(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn app_error_serializes_as_code_and_message() {
        let error = AppError::invalid_input("page must be >= 1");

        let value = serde_json::to_value(&error).expect("serialize");

        assert_eq!(
            value,
            json!({ "code": "invalid_input", "message": "page must be >= 1" })
        );
    }

    #[test]
    fn error_codes_match_the_ipc_contract() {
        let cases = [
            (ErrorCode::NotFound, "not_found"),
            (ErrorCode::FileMissing, "file_missing"),
            (ErrorCode::InvalidPdf, "invalid_pdf"),
            (ErrorCode::InvalidInput, "invalid_input"),
            (ErrorCode::Io, "io"),
            (ErrorCode::Db, "db"),
            (ErrorCode::Internal, "internal"),
        ];

        for (code, expected) in cases {
            let value = serde_json::to_value(code).expect("serialize");
            assert_eq!(value, json!(expected));
        }
    }

    #[test]
    fn sqlite_errors_become_db_errors() {
        let error = AppError::from(rusqlite::Error::QueryReturnedNoRows);

        assert_eq!(error.code, ErrorCode::Db);
    }
}
