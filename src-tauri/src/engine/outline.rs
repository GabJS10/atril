//! Índice del libro (`get_outline`): el árbol de marcadores del PDF con su destino.

use mupdf::Outline;
use serde::Serialize;

use super::EngineError;
use super::document::OpenDocument;
use super::links::{LinkTarget, target_of};

/// Un marcador. `page` y `y` salen del destino (`y` en coordenadas del visor a escala 1); `uri` solo si es un
/// enlace externo permitido. Un marcador sin destino válido tiene los tres a `null`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineItem {
    pub title: String,
    /// Página 1-based.
    pub page: Option<u32>,
    pub y: Option<f64>,
    pub uri: Option<String>,
    pub children: Vec<OutlineItem>,
}

/// Árbol de marcadores de `document`. Vacío si el PDF no tiene índice.
pub fn outline(document: &OpenDocument) -> Result<Vec<OutlineItem>, EngineError> {
    let items = document.outlines()?;
    let page_count = document.page_count();
    Ok(items.iter().map(|item| convert(item, page_count)).collect())
}

fn convert(item: &Outline, page_count: u32) -> OutlineItem {
    let target = target_of(
        item.dest.as_ref(),
        item.uri.as_deref().unwrap_or(""),
        page_count,
    );
    let (page, y, uri) = match target {
        Some(LinkTarget::Page { page, y }) => (Some(page), y, None),
        Some(LinkTarget::Uri { uri }) => (None, None, Some(uri)),
        None => (None, None, None),
    };
    OutlineItem {
        title: item.title.clone(),
        page,
        y,
        uri,
        children: item
            .down
            .iter()
            .map(|child| convert(child, page_count))
            .collect(),
    }
}
