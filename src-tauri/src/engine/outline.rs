//! Índice del libro (`get_outline`): el árbol de marcadores del PDF con su destino.
//!
//! El recorrido lee los objetos del PDF (`/Outlines`, `/First`, `/Next`) con una pila explícita: no hay recursión
//! ni se usa `fz_load_outline` de MuPDF, que recursiona en C y puede desbordar la pila con un índice muy anidado (un
//! desbordamiento aborta el proceso y `catch_unwind` no lo evita). Se baja hasta [`MAX_OUTLINE_DEPTH`] niveles y se
//! leen como mucho [`MAX_OUTLINE_ITEMS`] marcadores: lo que hay más abajo o más allá se ignora, y un `/Next` que vuelve
//! atrás no puede hacer el recorrido infinito.
//!
//! Destinos: una matriz explícita (`[página /XYZ left top zoom]`, `/FitH`, `/FitR`…) se convierte con la geometría de la
//! página, igual que hace MuPDF (`y` en coordenadas del visor a escala 1, acotada a la página). Un destino con nombre
//! lo resuelve MuPDF (`#nameddest=`), que sabe leer el árbol de nombres y el diccionario `/Dests`.

use std::collections::HashMap;

use mupdf::pdf::{PdfDocument, PdfObject};
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde::Serialize;

use super::EngineError;
use super::document::OpenDocument;
use super::geometry::page_geometry;
use super::links::{self, LinkTarget};

/// Niveles que se leen (0 = primer nivel). Lo que hay debajo se ignora.
pub const MAX_OUTLINE_DEPTH: usize = 32;
/// Marcadores que se leen como mucho, en todo el índice.
pub const MAX_OUTLINE_ITEMS: usize = 20_000;

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

/// Árbol de marcadores de `document`, con los límites de [`MAX_OUTLINE_DEPTH`] y [`MAX_OUTLINE_ITEMS`].
/// Vacío si el PDF no tiene índice.
pub fn outline(document: &OpenDocument) -> Result<Vec<OutlineItem>, EngineError> {
    walk(document, MAX_OUTLINE_DEPTH, MAX_OUTLINE_ITEMS)
}

/// Recorrido con límites explícitos (las pruebas usan límites pequeños para ver el corte).
fn walk(
    document: &OpenDocument,
    max_depth: usize,
    max_items: usize,
) -> Result<Vec<OutlineItem>, EngineError> {
    let pdf = document.pdf();
    let Some(first) = first_outline(pdf) else {
        return Ok(Vec::new());
    };
    let mut pages = PageLookup::default();
    let mut flat: Vec<(usize, OutlineItem)> = Vec::new();
    // Pila de (profundidad, marcador). El hermano siguiente se apila antes que el primer hijo: así el hijo sale
    // primero y las entradas quedan en orden de aparición (preorden).
    let mut stack = vec![(0_usize, first)];
    while let Some((depth, node)) = stack.pop() {
        if flat.len() >= max_items {
            break;
        }
        if !node.is_dict().unwrap_or(false) {
            continue;
        }
        flat.push((depth, read_item(document, &mut pages, &node)));
        if let Some(next) = value(&node, "Next") {
            stack.push((depth, next));
        }
        if depth + 1 < max_depth
            && let Some(child) = value(&node, "First")
        {
            stack.push((depth + 1, child));
        }
    }
    Ok(nest(flat))
}

/// Primer marcador de primer nivel (`/Outlines /First` del catálogo), si lo hay.
fn first_outline(pdf: &PdfDocument) -> Option<PdfObject> {
    let catalog = pdf.catalog().ok()?.resolve().ok().flatten()?;
    let outlines = value(&catalog, "Outlines")?;
    value(&outlines, "First")
}

/// El valor de `key` en el diccionario `dict`, resuelto si es una referencia.
fn value(dict: &PdfObject, key: &str) -> Option<PdfObject> {
    let raw = dict.get_dict(key).ok().flatten()?;
    raw.resolve().ok().flatten()
}

fn read_item(document: &OpenDocument, pages: &mut PageLookup, node: &PdfObject) -> OutlineItem {
    let title = value(node, "Title")
        .and_then(|title| title.as_string().ok())
        .unwrap_or_default();
    let (page, y, uri) = match destination(document, pages, node) {
        Some(LinkTarget::Page { page, y }) => (Some(page), y, None),
        Some(LinkTarget::Uri { uri }) => (None, None, Some(uri)),
        None => (None, None, None),
    };
    OutlineItem {
        title,
        page,
        y,
        uri,
        children: Vec::new(),
    }
}

/// Destino de un marcador: su `/Dest`, o la acción `/A` si es `GoTo` o `URI`.
fn destination(
    document: &OpenDocument,
    pages: &mut PageLookup,
    node: &PdfObject,
) -> Option<LinkTarget> {
    if let Some(dest) = value(node, "Dest") {
        return dest_target(document, pages, &dest);
    }
    let action = value(node, "A")?;
    match value(&action, "S")?.as_name().ok()?.as_slice() {
        b"GoTo" => dest_target(document, pages, &value(&action, "D")?),
        b"URI" => {
            let uri = value(&action, "URI")?.as_string().ok()?;
            links::target_of(None, &uri, document.page_count())
        }
        _ => None,
    }
}

fn dest_target(
    document: &OpenDocument,
    pages: &mut PageLookup,
    dest: &PdfObject,
) -> Option<LinkTarget> {
    if dest.is_array().unwrap_or(false) {
        return explicit_target(document, pages, dest);
    }
    // Un nombre o una cadena es un destino con nombre: MuPDF lo busca en el árbol de nombres o en /Dests.
    let name = if dest.is_name().unwrap_or(false) {
        String::from_utf8_lossy(&dest.as_name().ok()?).into_owned()
    } else if dest.is_string().unwrap_or(false) {
        dest.as_string().ok()?
    } else {
        return None;
    };
    let uri = format!(
        "#nameddest={}",
        utf8_percent_encode(&name, NON_ALPHANUMERIC)
    );
    let resolved = document.pdf().resolve_link(&uri).ok().flatten();
    links::target_of(resolved.as_ref(), "", document.page_count())
}

/// Destino explícito `[página /Tipo ...]`. La página es una referencia; el `y` se calcula con la matriz de la
/// página, como `populate_destination` de MuPDF, y se acota a la altura de la página.
fn explicit_target(
    document: &OpenDocument,
    pages: &mut PageLookup,
    array: &PdfObject,
) -> Option<LinkTarget> {
    let reference = array.get_array(0).ok().flatten()?;
    let index = pages.index_of(document.pdf(), &reference, document.page_count())?;
    let kind = array.get_array(1).ok().flatten()?.as_name().ok()?;
    let geometry = page_geometry(&document.page_boxes(index));
    let [a, b, c, d, e, f] = geometry.transform;
    let to_view = |x: f64, y: f64| (a * x + c * y + e, b * x + d * y + f);
    let top = match kind.as_slice() {
        b"XYZ" => number(array, 3).map(|top| to_view(number(array, 2).unwrap_or(0.0), top).1),
        b"FitH" | b"FitBH" => number(array, 2).map(|top| to_view(0.0, top).1),
        b"FitR" => fit_r_top(array, to_view),
        _ => None,
    };
    Some(LinkTarget::Page {
        page: index + 1,
        y: top.map(|y| y.clamp(0.0, geometry.height)),
    })
}

/// Borde superior de un destino `/FitR left bottom right top`: la caja entera se transforma y se toma su punto más
/// alto, como MuPDF.
fn fit_r_top(array: &PdfObject, to_view: impl Fn(f64, f64) -> (f64, f64)) -> Option<f64> {
    let (left, bottom) = (number(array, 2)?, number(array, 3)?);
    let (right, top) = (number(array, 4)?, number(array, 5)?);
    let corners = [
        to_view(left, bottom).1,
        to_view(right, bottom).1,
        to_view(left, top).1,
        to_view(right, top).1,
    ];
    Some(corners.into_iter().fold(f64::INFINITY, f64::min))
}

/// Número de la posición `position` de `array`, resuelto si es una referencia.
fn number(array: &PdfObject, position: i32) -> Option<f64> {
    let value = array
        .get_array(position)
        .ok()
        .flatten()?
        .resolve()
        .ok()
        .flatten()?;
    if value.is_number().unwrap_or(false) {
        value.as_float().ok().map(f64::from)
    } else {
        None
    }
}

/// Lookup de páginas por la referencia que usa un destino. Se cachea por número de objeto.
#[derive(Default)]
struct PageLookup {
    by_reference: HashMap<i32, u32>,
}

impl PageLookup {
    /// Número de página (0-based) a la que apunta `reference`, si es una página del libro.
    fn index_of(
        &mut self,
        pdf: &PdfDocument,
        reference: &PdfObject,
        page_count: u32,
    ) -> Option<u32> {
        let number = reference.as_indirect().ok().filter(|number| *number > 0);
        if let Some(index) = number.and_then(|number| self.by_reference.get(&number)) {
            return Some(*index);
        }
        // MuPDF compara el número del objeto: hay que pasarle la referencia, no la página ya resuelta.
        let index = u32::try_from(pdf.lookup_page_number(reference).ok()?).ok()?;
        if index >= page_count {
            return None;
        }
        if let Some(number) = number {
            self.by_reference.insert(number, index);
        }
        Some(index)
    }
}

/// Monta el árbol a partir del preorden con profundidades (cada entrada es hija de la anterior de menor
/// profundidad). No recursivo: una pila con los marcadores abiertos.
fn nest(flat: Vec<(usize, OutlineItem)>) -> Vec<OutlineItem> {
    let mut roots = Vec::new();
    let mut open: Vec<(usize, OutlineItem)> = Vec::new();
    for (depth, item) in flat {
        while open
            .last()
            .is_some_and(|(open_depth, _)| *open_depth >= depth)
        {
            if let Some((_, closed)) = open.pop() {
                attach(&mut open, &mut roots, closed);
            }
        }
        open.push((depth, item));
    }
    while let Some((_, closed)) = open.pop() {
        attach(&mut open, &mut roots, closed);
    }
    roots
}

fn attach(open: &mut [(usize, OutlineItem)], roots: &mut Vec<OutlineItem>, item: OutlineItem) {
    match open.last_mut() {
        Some((_, parent)) => parent.children.push(item),
        None => roots.push(item),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::testpdf::{
        LinkTarget as Target, NamedDest, OutlineSpec, PageSpec, PdfOptions, build_pdf_with,
    };
    use std::path::PathBuf;

    fn open(bytes: &[u8]) -> (tempfile::TempDir, OpenDocument) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path: PathBuf = dir.path().join("index.pdf");
        std::fs::write(&path, bytes).expect("write");
        let document = OpenDocument::open(&path).expect("open");
        (dir, document)
    }

    fn pages(count: usize) -> Vec<PageSpec> {
        (0..count).map(|_| PageSpec::with_content("")).collect()
    }

    fn entry(title: &str, page: usize) -> OutlineSpec {
        OutlineSpec {
            title: title.into(),
            target: Some(Target::Page {
                page,
                left: 10.0,
                top: 700.0,
            }),
            children: Vec::new(),
        }
    }

    /// Un marcador `Nivel {level}` con `levels - level` niveles debajo.
    fn chain(level: usize, levels: usize) -> OutlineSpec {
        let children = if level < levels {
            vec![chain(level + 1, levels)]
        } else {
            Vec::new()
        };
        OutlineSpec {
            children,
            ..entry(&format!("Nivel {level}"), 1)
        }
    }

    /// Número de niveles del árbol (el más profundo cuenta).
    fn levels(items: &[OutlineItem]) -> usize {
        items
            .iter()
            .map(|item| 1 + levels(&item.children))
            .max()
            .unwrap_or(0)
    }

    fn deepest(items: &[OutlineItem]) -> &OutlineItem {
        let first = &items[0];
        if first.children.is_empty() {
            first
        } else {
            deepest(&first.children)
        }
    }

    #[test]
    fn a_deep_outline_is_cut_below_the_depth_limit() {
        let bytes = build_pdf_with(
            &pages(1),
            &PdfOptions {
                outline: vec![chain(1, 40)],
                ..PdfOptions::default()
            },
        );
        let (_dir, document) = open(&bytes);

        let items = outline(&document).expect("outline");

        assert_eq!(levels(&items), MAX_OUTLINE_DEPTH);
        assert_eq!(deepest(&items).title, "Nivel 32");
        let shallow = walk(&document, 4, MAX_OUTLINE_ITEMS).expect("walk");
        assert_eq!(levels(&shallow), 4);
        assert_eq!(deepest(&shallow).title, "Nivel 4");
    }

    #[test]
    fn the_item_limit_stops_the_walk_in_document_order() {
        let spec: Vec<OutlineSpec> = (1..=10).map(|n| entry(&format!("Cap {n}"), 1)).collect();
        let bytes = build_pdf_with(
            &pages(1),
            &PdfOptions {
                outline: spec,
                ..PdfOptions::default()
            },
        );
        let (_dir, document) = open(&bytes);

        let items = walk(&document, MAX_OUTLINE_DEPTH, 3).expect("walk");

        let titles: Vec<&str> = items.iter().map(|item| item.title.as_str()).collect();
        assert_eq!(titles, ["Cap 1", "Cap 2", "Cap 3"]);
    }

    #[test]
    fn a_wide_outline_keeps_every_sibling_in_order() {
        let spec: Vec<OutlineSpec> = (1..=60).map(|n| entry(&format!("Cap {n}"), 1)).collect();
        let bytes = build_pdf_with(
            &pages(1),
            &PdfOptions {
                outline: spec,
                ..PdfOptions::default()
            },
        );
        let (_dir, document) = open(&bytes);

        let items = outline(&document).expect("outline");

        assert_eq!(items.len(), 60);
        assert_eq!(items[59].title, "Cap 60");
    }

    #[test]
    fn named_destinations_resolve_through_the_catalog() {
        let bytes = build_pdf_with(
            &pages(2),
            &PdfOptions {
                outline: vec![OutlineSpec {
                    title: "Por nombre".into(),
                    target: Some(Target::Named("cap2".into())),
                    children: Vec::new(),
                }],
                named_dests: vec![NamedDest {
                    name: "cap2".into(),
                    page: 2,
                    left: 0.0,
                    top: 400.0,
                }],
                ..PdfOptions::default()
            },
        );
        let (_dir, document) = open(&bytes);

        let items = outline(&document).expect("outline");

        assert_eq!(items[0].page, Some(2));
        let geometry = page_geometry(&document.page_boxes(1));
        let expected = geometry.transform[3] * 400.0 + geometry.transform[5];
        let y = items[0].y.expect("y");
        assert!((y - expected).abs() < 1e-3, "{y} != {expected}");
    }

    /// `/FitH`, `/FitR` y `/FitV` con la matriz de la página: el `y` es el borde superior, transformado y acotado a
    /// la página (como MuPDF); `/FitV` no fija altura.
    #[test]
    fn fit_destinations_use_the_page_transform() {
        let cropped = [50.0, 100.0, 550.0, 700.0];
        let pages = [
            PageSpec::with_content(""),
            PageSpec {
                crop_box: Some(cropped),
                ..PageSpec::with_content("")
            },
            PageSpec {
                rotate: Some(90),
                crop_box: Some(cropped),
                ..PageSpec::with_content("")
            },
        ];
        let fit = |title: &str, page: usize, kind: &'static str, numbers: Vec<f64>| OutlineSpec {
            title: title.into(),
            target: Some(Target::PageWith {
                page,
                kind,
                numbers,
            }),
            children: Vec::new(),
        };
        let spec = vec![
            fit("FitH", 2, "FitH", vec![300.0]),
            fit("FitR", 3, "FitR", vec![150.0, 200.0, 400.0, 500.0]),
            fit("FitV", 3, "FitV", vec![120.0]),
        ];
        let bytes = build_pdf_with(
            &pages,
            &PdfOptions {
                outline: spec,
                ..PdfOptions::default()
            },
        );
        let (_dir, document) = open(&bytes);
        // `page_boxes` usa índices de 0; las páginas del esquema son de 1.
        let view = |index: u32| {
            let geometry = page_geometry(&document.page_boxes(index));
            let [a, b, c, d, e, f] = geometry.transform;
            let point = move |x: f64, y: f64| (a * x + c * y + e, b * x + d * y + f);
            (point, geometry.height)
        };

        let items = outline(&document).expect("outline");

        let (point, height) = view(1);
        let expected_h = point(0.0, 300.0).1;
        assert!(expected_h > 0.0 && expected_h < height, "{expected_h}");
        assert!((items[0].y.expect("FitH y") - expected_h).abs() < 1e-3);
        let (point, height) = view(2);
        let corners = [
            point(150.0, 200.0).1,
            point(400.0, 200.0).1,
            point(150.0, 500.0).1,
            point(400.0, 500.0).1,
        ];
        let expected_r = corners.into_iter().fold(f64::INFINITY, f64::min);
        assert!(expected_r > 0.0 && expected_r < height, "{expected_r}");
        assert!((items[1].y.expect("FitR y") - expected_r).abs() < 1e-3);
        assert_eq!((items[2].page, items[2].y), (Some(3), None));
    }

    #[test]
    fn a_missing_named_destination_has_no_page() {
        let bytes = build_pdf_with(
            &pages(1),
            &PdfOptions {
                outline: vec![OutlineSpec {
                    title: "Roto".into(),
                    target: Some(Target::Named("no-existe".into())),
                    children: Vec::new(),
                }],
                ..PdfOptions::default()
            },
        );
        let (_dir, document) = open(&bytes);

        let items = outline(&document).expect("outline");

        assert_eq!((items[0].page, items[0].y), (None, None));
    }
}
