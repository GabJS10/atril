//! Motor de PDF nativo (fase R): renderiza las páginas con MuPDF y las sirve como JPEG.
//!
//! Piezas:
//! - [`geometry`]: tamaño y matriz de cada página, idénticos a `page.getViewport({ scale: 1 })` de pdf.js.
//! - [`document`]: un PDF abierto en MuPDF (geometría de todas las páginas y render a JPEG).
//! - [`scheduler`]: cola priorizada con cancelación y precarga (estructura pura, sin hilos).
//! - [`cache`]: caché LRU de JPEG limitada por bytes.
//! - [`pool`]: el [`Engine`], que une todo con un pool de hilos de render y un hilo de lectura.
//! - [`text`], [`search`], [`outline`] y [`links`]: texto con cajas, búsqueda por eventos, índice y enlaces (R1.2).
//! - [`api`]: los comandos del motor y la resolución de libros.
//!
//! Modelo de hilos de MuPDF: cada hilo tiene su propio contexto (`fz_context`) y un `Document` no se puede
//! pasar de un hilo a otro. Por eso cada hilo abre **su propia copia** de los documentos que usa (un LRU pequeño
//! por hilo). El pool de render atiende las páginas del visor; el hilo de lectura atiende el texto, los enlaces,
//! el índice y la búsqueda, que avanza por páginas para que nunca bloquee a una petición larga.

pub mod api;
pub mod cache;
pub mod document;
pub mod encode;
#[cfg(test)]
mod engine_tests;
pub mod geometry;
pub mod links;
pub mod outline;
pub mod pool;
#[cfg(test)]
mod reading_tests;
pub mod scheduler;
pub mod search;
#[cfg(test)]
pub mod testpdf;
pub mod text;

use thiserror::Error;

use crate::error::{AppError, ErrorCode};

pub use document::{DocumentInfo, OpenDocument};
pub use pool::{Engine, EngineConfig, Worker};

/// Rectángulo `[x0, y0, x1, y1]` en coordenadas del visor a escala 1 (origen arriba a la izquierda, `y` hacia
/// abajo), el mismo espacio que `width`, `height` y `transform` de `open_document`.
pub type ViewRect = [f64; 4];

/// Hilos de render. Con 4 la memoria de los escaneos llegaba a 1,1 GB y no se ganaba velocidad (spike R0.1).
pub const WORKER_THREADS: usize = 2;
/// Documentos que cada hilo mantiene abiertos.
pub const OPEN_DOCUMENTS_PER_WORKER: usize = 3;
/// Documentos que mantiene el hilo de lectura (búsqueda y texto de varios libros a la vez).
pub const OPEN_DOCUMENTS_READER: usize = 3;
/// Límite por defecto de la caché de JPEG. Fácil de cambiar: `EngineConfig::cache_bytes`.
pub const DEFAULT_CACHE_BYTES: usize = 256 * 1024 * 1024;
/// Calidad JPEG de las páginas (63 ms a 1240 px con `image`; ver la medición en el PR).
pub const JPEG_QUALITY: u8 = 85;

/// Escalas aceptadas (1 = 72 ppp, un punto PDF por píxel).
pub const MIN_SCALE: f64 = 0.1;
pub const MAX_SCALE: f64 = 8.0;
/// Máximo de píxeles de una imagen. Si la escala pedida lo supera, se renderiza a menos escala.
pub const MAX_PIXELS: u64 = 32_000_000;
/// Máximo de píxeles por lado (límite de JPEG: 65 535).
pub const MAX_SIDE_PIXELS: f64 = 16_384.0;

/// Errores del motor. Son `Clone` porque una misma página puede tener varios destinatarios.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EngineError {
    #[error("could not read the file: {0}")]
    Io(String),
    #[error("not a readable PDF: {0}")]
    InvalidPdf(String),
    #[error("page {page} is out of range (the document has {count} pages)")]
    PageOutOfRange { page: u32, count: u32 },
    #[error("could not render the page: {0}")]
    Render(String),
    /// La petición ya no hacía falta (el visor pidió otra zona antes de que se atendiera).
    #[error("request superseded")]
    Superseded,
    /// Argumentos que no se pueden usar (consulta vacía o demasiado larga).
    #[error("{0}")]
    InvalidInput(String),
    #[error("the PDF engine is shutting down")]
    Shutdown,
}

impl From<EngineError> for AppError {
    fn from(error: EngineError) -> Self {
        let code = match &error {
            EngineError::Io(_) => ErrorCode::Io,
            EngineError::InvalidPdf(_) => ErrorCode::InvalidPdf,
            EngineError::PageOutOfRange { .. } | EngineError::InvalidInput(_) => {
                ErrorCode::InvalidInput
            }
            EngineError::Render(_) | EngineError::Superseded | EngineError::Shutdown => {
                ErrorCode::Internal
            }
        };
        AppError::new(code, error.to_string())
    }
}

/// Escala cuantizada a centésimas: es la que entra en la clave de la caché y con la que se renderiza.
pub fn quantize_scale(scale: f64) -> u32 {
    (scale.clamp(MIN_SCALE, MAX_SCALE) * 100.0).round() as u32
}

pub fn dequantize_scale(scale_q: u32) -> f64 {
    f64::from(scale_q) / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_is_quantized_to_hundredths_and_clamped() {
        assert_eq!(quantize_scale(1.0), 100);
        assert_eq!(quantize_scale(1.3333), 133);
        assert_eq!(quantize_scale(0.0001), 10);
        assert_eq!(quantize_scale(100.0), 800);
        assert!((dequantize_scale(133) - 1.33).abs() < 1e-9);
    }
}
