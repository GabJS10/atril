//! Un PDF abierto en MuPDF: geometría de todas las páginas y render de una página a JPEG.
//!
//! Un `OpenDocument` pertenece al hilo que lo abrió (no es `Send`): lo crea y lo usa un `Worker` del pool.

use std::path::Path;

use mupdf::pdf::{PdfDocument, PdfObject};
use mupdf::text_page::{TextPage, TextPageFlags};
use mupdf::{Colorspace, Document, Matrix, Page};
use serde::Serialize;

use super::encode::encode_jpeg;
use super::geometry::{self, PageBoxes, PageGeometry, Rect};
use super::{EngineError, MAX_PIXELS, MAX_SIDE_PIXELS};

/// Número de páginas y geometría de cada una (ver `geometry`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub page_count: u32,
    pub pages: Vec<PageGeometry>,
}

/// Un PDF abierto. No es `Send` (MuPDF liga el documento al contexto del hilo).
pub struct OpenDocument {
    pdf: PdfDocument,
    page_count: u32,
}

impl OpenDocument {
    pub fn open(path: &Path) -> Result<Self, EngineError> {
        if !path.is_file() {
            return Err(EngineError::Io(format!("{} is not a file", path.display())));
        }
        let document = Document::open(path).map_err(invalid_pdf)?;
        if document.needs_password().map_err(invalid_pdf)? {
            return Err(EngineError::InvalidPdf(
                "the PDF is password protected".into(),
            ));
        }
        let pdf = PdfDocument::try_from(document).map_err(invalid_pdf)?;
        let count = pdf.page_count().map_err(invalid_pdf)?;
        let page_count = u32::try_from(count)
            .map_err(|_| EngineError::InvalidPdf(format!("invalid page count {count}")))?;
        Ok(Self { pdf, page_count })
    }

    pub fn page_count(&self) -> u32 {
        self.page_count
    }

    /// El `PdfDocument` de MuPDF, para quien necesite más (texto, búsqueda, índice…).
    pub fn pdf(&self) -> &PdfDocument {
        &self.pdf
    }

    /// Geometría de todas las páginas leyendo solo los diccionarios de página (`/MediaBox`, `/CropBox`,
    /// `/Rotate`, `/UserUnit`), sin cargar ni interpretar el contenido de ninguna.
    pub fn info(&self) -> DocumentInfo {
        let pages = (0..self.page_count)
            .map(|index| geometry::page_geometry(&self.page_boxes(index)))
            .collect();
        DocumentInfo {
            page_count: self.page_count,
            pages,
        }
    }

    /// Lo que dice el PDF de la página `index` (0-based). Si el árbol de páginas está roto para esa
    /// página, devuelve los valores por defecto de pdf.js (Letter).
    pub fn page_boxes(&self, index: u32) -> PageBoxes {
        let Ok(page) = self.pdf.find_page(index as i32) else {
            return PageBoxes::default();
        };
        PageBoxes {
            media_box: read_rect(page.get_dict_inheritable("MediaBox").ok().flatten()),
            crop_box: read_rect(page.get_dict_inheritable("CropBox").ok().flatten()),
            rotate: read_number(page.get_dict_inheritable("Rotate").ok().flatten()).unwrap_or(0.0),
            user_unit: read_number(page.get_dict("UserUnit").ok().flatten()).unwrap_or(1.0),
        }
    }

    /// La página `page` (1-based) de MuPDF. Fuera del libro, `PageOutOfRange`.
    pub fn page(&self, page: u32) -> Result<Page, EngineError> {
        if page == 0 || page > self.page_count {
            return Err(EngineError::PageOutOfRange {
                page,
                count: self.page_count,
            });
        }
        self.pdf.load_page(page as i32 - 1).map_err(render_error)
    }

    /// Texto estructurado de la página `page` (1-based): bloques, líneas y caracteres con sus cajas en espacio
    /// de página de MuPDF (el del visor a escala 1).
    pub fn text_page(&self, page: u32) -> Result<TextPage, EngineError> {
        self.page(page)?
            .to_text_page(TextPageFlags::empty())
            .map_err(render_error)
    }

    /// Tamaño de la página `page` (1-based) según MuPDF, ya rotada y recortada. Carga la página: es para
    /// comprobar `info()` (pruebas y banco de pruebas), no para el camino normal.
    pub fn native_size(&self, page: u32) -> Result<(f64, f64), EngineError> {
        if page == 0 || page > self.page_count {
            return Err(EngineError::PageOutOfRange {
                page,
                count: self.page_count,
            });
        }
        let page = self.pdf.load_page(page as i32 - 1).map_err(render_error)?;
        let bounds = page.bounds().map_err(render_error)?;
        Ok((f64::from(bounds.width()), f64::from(bounds.height())))
    }

    /// Renderiza la página `page` (1-based) a `scale` y la codifica como JPEG. Si `scale` produciría una
    /// imagen demasiado grande (`MAX_PIXELS`, `MAX_SIDE_PIXELS`) se renderiza a la mayor escala permitida.
    pub fn render_jpeg(&self, page: u32, scale: f64) -> Result<Vec<u8>, EngineError> {
        if page == 0 || page > self.page_count {
            return Err(EngineError::PageOutOfRange {
                page,
                count: self.page_count,
            });
        }
        let page = self.pdf.load_page(page as i32 - 1).map_err(render_error)?;
        let bounds = page.bounds().map_err(render_error)?;
        let scale = clamp_scale(scale, f64::from(bounds.width()), f64::from(bounds.height()));
        let scale = scale as f32;
        let pixmap = page
            .to_pixmap(
                &Matrix::new_scale(scale, scale),
                &Colorspace::device_rgb(),
                false,
                true,
            )
            .map_err(render_error)?;

        let (width, height) = (pixmap.width() as usize, pixmap.height() as usize);
        let components = usize::from(pixmap.n());
        let stride = usize::try_from(pixmap.stride()).unwrap_or(0);
        if components != 3 || width == 0 || height == 0 || stride < width * 3 {
            return Err(EngineError::Render(format!(
                "unexpected pixmap layout ({width}x{height}, {components} components, stride {stride})"
            )));
        }
        let samples = pixmap.samples();
        if stride == width * 3 {
            encode_jpeg(&samples[..width * height * 3], width as u32, height as u32)
        } else {
            let mut packed = Vec::with_capacity(width * height * 3);
            for row in samples.chunks(stride).take(height) {
                packed.extend_from_slice(&row[..width * 3]);
            }
            encode_jpeg(&packed, width as u32, height as u32)
        }
    }
}

/// Reduce `scale` si la imagen de `width` x `height` puntos pasaría de `MAX_PIXELS` o `MAX_SIDE_PIXELS`.
pub fn clamp_scale(scale: f64, width: f64, height: f64) -> f64 {
    let width = width.max(1.0);
    let height = height.max(1.0);
    let by_area = (MAX_PIXELS as f64 / (width * height)).sqrt();
    let by_side = MAX_SIDE_PIXELS / width.max(height);
    scale.min(by_area).min(by_side)
}

fn read_number(object: Option<PdfObject>) -> Option<f64> {
    let object = object?.resolve().ok().flatten()?;
    if object.is_number().ok()? {
        object.as_float().ok().map(f64::from)
    } else {
        None
    }
}

/// Un array de 4 números (resueltos si son referencias), normalizado y con área positiva.
fn read_rect(object: Option<PdfObject>) -> Option<Rect> {
    let array = object?.resolve().ok().flatten()?;
    if !array.is_array().ok()? || array.len().ok()? != 4 {
        return None;
    }
    let mut values = [0.0; 4];
    for (index, value) in values.iter_mut().enumerate() {
        *value = read_number(array.get_array(index as i32).ok().flatten())?;
    }
    geometry::normalize_rect(values)
}

fn invalid_pdf(error: mupdf::Error) -> EngineError {
    EngineError::InvalidPdf(error.to_string())
}

fn render_error(error: mupdf::Error) -> EngineError {
    EngineError::Render(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_scale_leaves_ordinary_requests_alone() {
        assert_eq!(clamp_scale(2.0, 612.0, 792.0), 2.0);
    }

    #[test]
    fn clamp_scale_limits_total_pixels() {
        let scale = clamp_scale(8.0, 2000.0, 2000.0);
        let pixels = (2000.0 * scale) * (2000.0 * scale);
        assert!(pixels <= MAX_PIXELS as f64 + 1.0, "{pixels}");
    }

    #[test]
    fn clamp_scale_limits_the_longest_side() {
        let scale = clamp_scale(8.0, 100.0, 14_400.0);
        assert!(14_400.0 * scale <= MAX_SIDE_PIXELS + 1e-6);
    }
}
