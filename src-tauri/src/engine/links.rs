//! Enlaces de una página (`get_page_links`) y destinos de enlaces y marcadores (`get_outline`).
//!
//! Las cajas y los destinos de MuPDF ya están en el espacio de página de MuPDF, que es el del visor a escala 1
//! (`/CropBox` y `/Rotate` aplicados), así que no hace falta multiplicar por `transform`. Las pruebas de
//! `reading_tests` lo comprueban en páginas rotadas y con la `/CropBox` desplazada.

use mupdf::link::LinkDestination;
use mupdf::{DestinationKind, Rect};
use serde::Serialize;

use super::document::OpenDocument;
use super::{EngineError, ViewRect};

/// Longitud máxima de un enlace externo que se devuelve.
pub const MAX_URI_BYTES: usize = 2048;

/// Destino de un enlace o de un marcador.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum LinkTarget {
    /// Página `page` (1-based) y, si el destino fija una altura, `y` en coordenadas del visor a escala 1.
    Page { page: u32, y: Option<f64> },
    /// Enlace externo permitido: `http`, `https` o `mailto`.
    Uri { uri: String },
}

/// Un enlace de la página con su caja en coordenadas del visor a escala 1.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageLink {
    pub rect: ViewRect,
    pub target: LinkTarget,
}

/// Solo se devuelven enlaces externos `http`, `https` y `mailto`. Los demás (`file:`, `javascript:`, `launch`…)
/// se ignoran: el front no debe abrir nada que no sea web o correo.
pub fn is_allowed_external(uri: &str) -> bool {
    if uri.len() > MAX_URI_BYTES || uri.chars().any(char::is_control) {
        return false;
    }
    let lower = uri.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

/// Destino de un enlace o marcador. `dest` es el destino interno resuelto por MuPDF (si lo hay); `uri` la acción
/// (cadena vacía si no hay). Un destino fuera del libro no cuenta.
pub fn target_of(dest: Option<&LinkDestination>, uri: &str, page_count: u32) -> Option<LinkTarget> {
    match dest {
        Some(dest) => {
            let index = dest.loc.page_number;
            (index < page_count).then(|| LinkTarget::Page {
                page: index + 1,
                y: top_of(dest.kind),
            })
        }
        None => is_allowed_external(uri).then(|| LinkTarget::Uri {
            uri: uri.to_owned(),
        }),
    }
}

/// Altura del borde superior que fija el destino, si lo fija. MuPDF la da ya en coordenadas del visor.
fn top_of(kind: DestinationKind) -> Option<f64> {
    let top = match kind {
        DestinationKind::XYZ { top, .. }
        | DestinationKind::FitH { top }
        | DestinationKind::FitBH { top } => top,
        DestinationKind::FitR { top, .. } => Some(top),
        DestinationKind::Fit
        | DestinationKind::FitV { .. }
        | DestinationKind::FitB
        | DestinationKind::FitBV { .. } => None,
    };
    top.map(f64::from).filter(|y| y.is_finite())
}

/// Caja de MuPDF como `[x0, y0, x1, y1]` normalizada.
pub fn rect_of(rect: Rect) -> ViewRect {
    [
        f64::from(rect.x0.min(rect.x1)),
        f64::from(rect.y0.min(rect.y1)),
        f64::from(rect.x0.max(rect.x1)),
        f64::from(rect.y0.max(rect.y1)),
    ]
}

/// Enlaces de la página `page` (1-based). Los que no se pueden resolver (destino inexistente, esquema no
/// permitido) se omiten.
pub fn page_links(document: &OpenDocument, page: u32) -> Result<Vec<PageLink>, EngineError> {
    let page_object = document.page(page)?;
    let links = page_object
        .links()
        .map_err(|error| EngineError::Render(error.to_string()))?;
    let page_count = document.page_count();
    Ok(links
        .filter_map(|link| {
            let target = target_of(link.dest.as_ref(), &link.uri, page_count)?;
            Some(PageLink {
                rect: rect_of(link.bounds),
                target,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use mupdf::document::Location;

    use super::*;

    fn dest(page_number: u32, kind: DestinationKind) -> LinkDestination {
        LinkDestination {
            loc: Location {
                chapter: 0,
                page_in_chapter: page_number,
                page_number,
            },
            kind,
        }
    }

    #[test]
    fn only_web_and_mail_links_are_allowed() {
        assert!(is_allowed_external("https://example.org/a?b=c"));
        assert!(is_allowed_external("HTTP://example.org"));
        assert!(is_allowed_external("mailto:alguien@example.org"));
        assert!(!is_allowed_external("file:///etc/passwd"));
        assert!(!is_allowed_external("javascript:app.alert(1)"));
        assert!(!is_allowed_external("#page=3"));
        assert!(!is_allowed_external("https://example.org/\n"));
        assert!(!is_allowed_external(&format!(
            "https://example.org/{}",
            "a".repeat(MAX_URI_BYTES)
        )));
    }

    #[test]
    fn internal_destinations_give_the_one_based_page_and_the_top() {
        let xyz = dest(
            2,
            DestinationKind::XYZ {
                left: Some(10.0),
                top: Some(300.5),
                zoom: None,
            },
        );
        assert_eq!(
            target_of(Some(&xyz), "", 5),
            Some(LinkTarget::Page {
                page: 3,
                y: Some(300.5)
            })
        );
        let fit = dest(0, DestinationKind::Fit);
        assert_eq!(
            target_of(Some(&fit), "", 5),
            Some(LinkTarget::Page { page: 1, y: None })
        );
        let fit_r = dest(
            1,
            DestinationKind::FitR {
                left: 0.0,
                bottom: 50.0,
                right: 100.0,
                top: 20.0,
            },
        );
        assert_eq!(
            target_of(Some(&fit_r), "", 5),
            Some(LinkTarget::Page {
                page: 2,
                y: Some(20.0)
            })
        );
    }

    #[test]
    fn destinations_outside_the_book_are_dropped() {
        let beyond = dest(5, DestinationKind::Fit);

        assert_eq!(target_of(Some(&beyond), "", 5), None);
        assert_eq!(target_of(None, "file:///x", 5), None);
        assert_eq!(
            target_of(None, "https://example.org", 5),
            Some(LinkTarget::Uri {
                uri: "https://example.org".into()
            })
        );
    }

    #[test]
    fn rects_are_normalized() {
        let rect = Rect {
            x0: 30.0,
            y0: 20.0,
            x1: 10.0,
            y1: 5.0,
        };
        assert_eq!(rect_of(rect), [10.0, 5.0, 30.0, 20.0]);
    }

    #[test]
    fn a_non_finite_top_is_no_top() {
        let nan = dest(
            0,
            DestinationKind::FitH {
                top: Some(f32::NAN),
            },
        );
        assert_eq!(
            target_of(Some(&nan), "", 1),
            Some(LinkTarget::Page { page: 1, y: None })
        );
    }
}
