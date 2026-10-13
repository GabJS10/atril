//! PDF sintéticos para las pruebas del motor (nada con copyright): se generan al vuelo con un `xref` correcto.

use std::fmt::Write as _;

/// Una página del PDF de prueba.
#[derive(Debug, Clone, Default)]
pub struct PageSpec {
    pub media_box: Option<[f64; 4]>,
    pub crop_box: Option<[f64; 4]>,
    pub rotate: Option<i32>,
    pub user_unit: Option<f64>,
    /// Texto en Helvetica (fuente base-14, sin incrustar) a 36 pt en (72, 700). Sin texto, la página queda en
    /// blanco. Se ignora si hay `content`.
    pub text: Option<String>,
    /// Operadores de contenido tal cual (ver [`line`]). Reemplaza a `text`.
    pub content: Option<String>,
    /// Anotaciones `/Link` de la página.
    pub links: Vec<LinkSpec>,
    /// La `/MediaBox` va en un objeto indirecto (los PDF reales lo hacen a veces).
    pub indirect_media_box: bool,
    /// Una imagen JPEG 2000 (`/JPXDecode`) dibujada en un recuadro de 200x200 puntos en (100, 100).
    pub jpx_image: Option<Vec<u8>>,
}

impl PageSpec {
    pub fn with_text(text: &str) -> Self {
        Self {
            media_box: Some([0.0, 0.0, 612.0, 792.0]),
            text: Some(text.to_owned()),
            ..Self::default()
        }
    }

    /// Página Letter con los operadores de `content` (ver [`line`]).
    pub fn with_content(content: &str) -> Self {
        Self {
            media_box: Some([0.0, 0.0, 612.0, 792.0]),
            content: Some(content.to_owned()),
            ..Self::default()
        }
    }
}

/// Una anotación `/Link` con su caja y su acción.
#[derive(Debug, Clone)]
pub struct LinkSpec {
    /// `/Rect` en espacio de usuario PDF.
    pub rect: [f64; 4],
    pub target: LinkTarget,
}

#[derive(Debug, Clone)]
pub enum LinkTarget {
    /// Destino `/XYZ left top 0` de la página `page` (1-based).
    Page { page: usize, left: f64, top: f64 },
    /// Acción `/URI`.
    Uri(String),
}

/// Un elemento del esquema (marcadores). Sin destino, es un título sin acción.
#[derive(Debug, Clone)]
pub struct OutlineSpec {
    pub title: String,
    pub target: Option<LinkTarget>,
    pub children: Vec<OutlineSpec>,
}

/// Valores heredados del nodo `/Pages`.
#[derive(Debug, Clone, Default)]
pub struct Inherited {
    pub media_box: Option<[f64; 4]>,
    pub rotate: Option<i32>,
}

/// Diccionario `/Info` del PDF de prueba (los campos que no se pongan no se escriben).
#[derive(Debug, Clone, Default)]
pub struct Info {
    pub title: Option<String>,
    pub author: Option<String>,
}

/// Todo lo que no es una página: herencia, esquema y diccionario `/Info`.
#[derive(Debug, Clone, Default)]
pub struct PdfOptions {
    pub inherited: Inherited,
    pub outline: Vec<OutlineSpec>,
    pub info: Option<Info>,
}

/// Operador de texto para una línea: `text` en Helvetica de `size` puntos con origen en (`x`, `y`).
/// El texto va en WinAnsi (Latin-1): `é` y `ñ` funcionan.
pub fn line(x: f64, y: f64, size: f64, text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)");
    format!("BT /F1 {size} Tf 1 0 0 1 {x} {y} Tm ({escaped}) Tj ET\n")
}

fn rect(values: [f64; 4]) -> String {
    format!("[{} {} {} {}]", values[0], values[1], values[2], values[3])
}

/// Los flujos de contenido van en Latin-1 (WinAnsi); lo que no cabe se sustituye por `?`.
fn latin1(text: &str) -> Vec<u8> {
    text.chars()
        .map(|c| u8::try_from(u32::from(c)).unwrap_or(b'?'))
        .collect()
}

/// Cadena de texto PDF: literal si es ASCII, UTF-16BE hexadecimal con BOM si no.
fn pdf_text_string(text: &str) -> String {
    if text.is_ascii() {
        let escaped = text
            .replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)");
        format!("({escaped})")
    } else {
        let mut hex = String::from("<FEFF");
        for unit in text.encode_utf16() {
            write!(hex, "{unit:04X}").expect("write to string");
        }
        hex.push('>');
        hex
    }
}

/// Un objeto del PDF: un valor completo o un flujo (entradas del diccionario y datos).
enum Body {
    Plain(String),
    Stream(String, Vec<u8>),
}

/// Reparte números de objeto consecutivos (el xref necesita que no haya huecos).
struct Ids(usize);

impl Ids {
    fn next(&mut self) -> usize {
        self.0 += 1;
        self.0
    }
}

/// Los números de objeto de una página.
struct PageIds {
    page: usize,
    content: usize,
    media_box: Option<usize>,
    image: Option<usize>,
    links: Vec<usize>,
}

impl PageIds {
    fn allocate(page: &PageSpec, ids: &mut Ids) -> Self {
        let page_id = ids.next();
        let content = ids.next();
        let media_box = (page.indirect_media_box && page.media_box.is_some()).then(|| ids.next());
        let image = page.jpx_image.as_ref().map(|_| ids.next());
        let links = page.links.iter().map(|_| ids.next()).collect();
        Self {
            page: page_id,
            content,
            media_box,
            image,
            links,
        }
    }
}

/// Un nodo del esquema con su número de objeto.
struct OutlineNode {
    id: usize,
    children: Vec<OutlineNode>,
}

fn assign_outline(items: &[OutlineSpec], ids: &mut Ids) -> Vec<OutlineNode> {
    items
        .iter()
        .map(|item| {
            let id = ids.next();
            OutlineNode {
                id,
                children: assign_outline(&item.children, ids),
            }
        })
        .collect()
}

/// Destino o acción de un enlace o de un marcador.
fn action(target: &LinkTarget, page_refs: &[usize]) -> String {
    match target {
        LinkTarget::Page { page, left, top } => {
            format!("/Dest [{} 0 R /XYZ {left} {top} 0]", page_refs[page - 1])
        }
        LinkTarget::Uri(uri) => format!("/A << /S /URI /URI {} >>", pdf_text_string(uri)),
    }
}

fn write_outline_items(
    items: &[OutlineSpec],
    nodes: &[OutlineNode],
    parent: usize,
    page_refs: &[usize],
    out: &mut Vec<(usize, Body)>,
) {
    for (index, (item, node)) in items.iter().zip(nodes).enumerate() {
        let mut dict = format!(
            "<< /Title {} /Parent {parent} 0 R",
            pdf_text_string(&item.title)
        );
        if index > 0 {
            write!(dict, " /Prev {} 0 R", nodes[index - 1].id).expect("write to string");
        }
        if index + 1 < nodes.len() {
            write!(dict, " /Next {} 0 R", nodes[index + 1].id).expect("write to string");
        }
        if let (Some(first), Some(last)) = (node.children.first(), node.children.last()) {
            write!(
                dict,
                " /First {} 0 R /Last {} 0 R /Count {}",
                first.id,
                last.id,
                node.children.len()
            )
            .expect("write to string");
        }
        if let Some(target) = &item.target {
            dict.push(' ');
            dict.push_str(&action(target, page_refs));
        }
        dict.push_str(" >>");
        out.push((node.id, Body::Plain(dict)));
        write_outline_items(&item.children, &node.children, node.id, page_refs, out);
    }
}

/// Construye un PDF con una página por `PageSpec`.
pub fn build_pdf(pages: &[PageSpec], inherited: &Inherited) -> Vec<u8> {
    build_pdf_with(
        pages,
        &PdfOptions {
            inherited: inherited.clone(),
            ..PdfOptions::default()
        },
    )
}

/// Como `build_pdf`, con un diccionario `/Info` (título y autor) si `info` no es `None`.
pub fn build_pdf_with_info(
    pages: &[PageSpec],
    inherited: &Inherited,
    info: Option<&Info>,
) -> Vec<u8> {
    build_pdf_with(
        pages,
        &PdfOptions {
            inherited: inherited.clone(),
            info: info.cloned(),
            ..PdfOptions::default()
        },
    )
}

/// Como [`build_pdf`], con esquema (marcadores) en el catálogo.
pub fn build_pdf_with(pages: &[PageSpec], options: &PdfOptions) -> Vec<u8> {
    // 1 catálogo, 2 árbol de páginas y 3 fuente; el resto se reparte en orden.
    let mut ids = Ids(3);
    let layout: Vec<PageIds> = pages
        .iter()
        .map(|page| PageIds::allocate(page, &mut ids))
        .collect();
    let page_refs: Vec<usize> = layout.iter().map(|ids| ids.page).collect();
    let outline_root = (!options.outline.is_empty()).then(|| ids.next());
    let outline_nodes = assign_outline(&options.outline, &mut ids);
    let info_id = options.info.as_ref().map(|_| ids.next());

    let mut objects: Vec<(usize, Body)> = vec![(
        3,
        Body::Plain(
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
                .to_owned(),
        ),
    )];

    let mut catalog = "<< /Type /Catalog /Pages 2 0 R".to_owned();
    if let Some(root) = outline_root {
        write!(catalog, " /Outlines {root} 0 R").expect("write to string");
    }
    catalog.push_str(" >>");
    objects.push((1, Body::Plain(catalog)));

    let kids: String = page_refs.iter().map(|id| format!("{id} 0 R ")).collect();
    let mut pages_dict = format!("<< /Type /Pages /Kids [{kids}] /Count {}", pages.len());
    if let Some(media) = options.inherited.media_box {
        write!(pages_dict, " /MediaBox {}", rect(media)).expect("write to string");
    }
    if let Some(rotate) = options.inherited.rotate {
        write!(pages_dict, " /Rotate {rotate}").expect("write to string");
    }
    pages_dict.push_str(" >>");
    objects.push((2, Body::Plain(pages_dict)));

    for (page, page_ids) in pages.iter().zip(&layout) {
        let xobjects = page_ids
            .image
            .map(|id| format!(" /XObject << /Im0 {id} 0 R >>"))
            .unwrap_or_default();
        let mut dict = format!(
            "<< /Type /Page /Parent 2 0 R /Contents {} 0 R /Resources << /Font << /F1 3 0 R >>{xobjects} >>",
            page_ids.content
        );
        if let Some(id) = page_ids.media_box {
            write!(dict, " /MediaBox {id} 0 R").expect("write to string");
        } else if let Some(media) = page.media_box {
            write!(dict, " /MediaBox {}", rect(media)).expect("write to string");
        }
        if let Some(crop) = page.crop_box {
            write!(dict, " /CropBox {}", rect(crop)).expect("write to string");
        }
        if let Some(rotate) = page.rotate {
            write!(dict, " /Rotate {rotate}").expect("write to string");
        }
        if let Some(unit) = page.user_unit {
            write!(dict, " /UserUnit {unit}").expect("write to string");
        }
        if !page_ids.links.is_empty() {
            let annots: String = page_ids
                .links
                .iter()
                .map(|id| format!("{id} 0 R "))
                .collect();
            write!(dict, " /Annots [{annots}]").expect("write to string");
        }
        dict.push_str(" >>");
        objects.push((page_ids.page, Body::Plain(dict)));

        let mut content = match (&page.content, &page.text) {
            (Some(content), _) => content.clone(),
            (None, Some(text)) => line(72.0, 700.0, 36.0, text),
            (None, None) => String::new(),
        };
        if page_ids.image.is_some() {
            content.push_str(" q 200 0 0 200 100 100 cm /Im0 Do Q");
        }
        objects.push((
            page_ids.content,
            Body::Stream(String::new(), latin1(&content)),
        ));

        if let (Some(id), Some(media)) = (page_ids.media_box, page.media_box) {
            objects.push((id, Body::Plain(rect(media))));
        }
        if let (Some(id), Some(data)) = (page_ids.image, &page.jpx_image) {
            objects.push((
                id,
                Body::Stream(
                    "/Type /XObject /Subtype /Image /Width 48 /Height 64 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode"
                        .to_owned(),
                    data.clone(),
                ),
            ));
        }
        for (link, id) in page.links.iter().zip(&page_ids.links) {
            let dict = format!(
                "<< /Type /Annot /Subtype /Link /Rect {} /Border [0 0 0] {} >>",
                rect(link.rect),
                action(&link.target, &page_refs)
            );
            objects.push((*id, Body::Plain(dict)));
        }
    }

    if let Some(root) = outline_root {
        let first = outline_nodes.first().map_or(0, |node| node.id);
        let last = outline_nodes.last().map_or(0, |node| node.id);
        objects.push((
            root,
            Body::Plain(format!(
                "<< /Type /Outlines /First {first} 0 R /Last {last} 0 R /Count {} >>",
                outline_nodes.len()
            )),
        ));
        write_outline_items(
            &options.outline,
            &outline_nodes,
            root,
            &page_refs,
            &mut objects,
        );
    }

    let mut trailer_info = String::new();
    if let (Some(id), Some(info)) = (info_id, &options.info) {
        let mut dict = String::from("<<");
        if let Some(title) = &info.title {
            write!(dict, " /Title {}", pdf_text_string(title)).expect("write to string");
        }
        if let Some(author) = &info.author {
            write!(dict, " /Author {}", pdf_text_string(author)).expect("write to string");
        }
        dict.push_str(" >>");
        objects.push((id, Body::Plain(dict)));
        write!(trailer_info, " /Info {id} 0 R").expect("write to string");
    }

    serialize(objects, &trailer_info)
}

fn serialize(mut objects: Vec<(usize, Body)>, trailer_info: &str) -> Vec<u8> {
    objects.sort_by_key(|(id, _)| *id);
    debug_assert!(
        objects
            .iter()
            .enumerate()
            .all(|(index, (id, _))| *id == index + 1),
        "object numbers must be consecutive"
    );
    let mut out = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::with_capacity(objects.len());
    for (id, body) in &objects {
        offsets.push(out.len());
        match body {
            Body::Plain(value) => {
                out.extend_from_slice(format!("{id} 0 obj\n{value}\nendobj\n").as_bytes());
            }
            Body::Stream(dict, data) => {
                let head = format!("{id} 0 obj\n<< {dict} /Length {} >>\nstream\n", data.len());
                out.extend_from_slice(head.as_bytes());
                out.extend_from_slice(data);
                out.extend_from_slice(b"\nendstream\nendobj\n");
            }
        }
    }

    let xref_at = out.len();
    let total = objects.len() + 1;
    let mut xref = format!("xref\n0 {total}\n0000000000 65535 f \n");
    for offset in offsets {
        writeln!(xref, "{offset:010} 00000 n ").expect("write to string");
    }
    write!(
        xref,
        "trailer\n<< /Size {total} /Root 1 0 R{trailer_info} >>\nstartxref\n{xref_at}\n%%EOF\n"
    )
    .expect("write to string");
    out.extend_from_slice(xref.as_bytes());
    out
}

/// Un PDF de `count` páginas Letter con «Page N» escrito en cada una.
pub fn text_book(count: usize) -> Vec<u8> {
    let pages: Vec<PageSpec> = (1..=count)
        .map(|n| PageSpec::with_text(&format!("Page {n}")))
        .collect();
    build_pdf(&pages, &Inherited::default())
}
