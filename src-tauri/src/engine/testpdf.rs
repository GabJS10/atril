//! PDF sintéticos para las pruebas del motor (nada con copyright): se generan al vuelo con un `xref` correcto.

use std::fmt::Write as _;

/// Una página del PDF de prueba.
#[derive(Debug, Clone, Default)]
pub struct PageSpec {
    pub media_box: Option<[f64; 4]>,
    pub crop_box: Option<[f64; 4]>,
    pub rotate: Option<i32>,
    pub user_unit: Option<f64>,
    /// Texto en Helvetica (fuente base-14, sin incrustar). Sin texto, la página queda en blanco.
    pub text: Option<String>,
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

fn rect(values: [f64; 4]) -> String {
    format!("[{} {} {} {}]", values[0], values[1], values[2], values[3])
}

/// Texto de PDF en UTF-16BE con BOM (`<FEFF…>`), para que los acentos lleguen intactos.
fn pdf_text(text: &str) -> String {
    let mut hex = String::from("<FEFF");
    for unit in text.encode_utf16() {
        write!(hex, "{unit:04X}").expect("write to string");
    }
    hex.push('>');
    hex
}

/// Construye un PDF con una página por `PageSpec`.
pub fn build_pdf(pages: &[PageSpec], inherited: &Inherited) -> Vec<u8> {
    build_pdf_with_info(pages, inherited, None)
}

/// Como `build_pdf`, con un diccionario `/Info` (título y autor) si `info` no es `None`.
pub fn build_pdf_with_info(
    pages: &[PageSpec],
    inherited: &Inherited,
    info: Option<&Info>,
) -> Vec<u8> {
    // Objetos: 1 catálogo, 2 árbol de páginas, 3 fuente; por página: página, contenido y, si hace falta,
    // la caja indirecta.
    let mut objects: Vec<String> = Vec::new();
    let mut kids = String::new();
    let first_page_object = 4;
    let mut next = first_page_object;
    let mut page_objects = Vec::new();
    for page in pages {
        let page_id = next;
        let content_id = next + 1;
        next += 2;
        let box_id = page.indirect_media_box.then(|| {
            let id = next;
            next += 1;
            id
        });
        let image_id = page.jpx_image.as_ref().map(|_| {
            let id = next;
            next += 1;
            id
        });
        page_objects.push((page_id, content_id, box_id, image_id));
        write!(kids, "{page_id} 0 R ").expect("write to string");
    }

    objects.push("<< /Type /Catalog /Pages 2 0 R >>".to_owned());
    let mut pages_dict = format!("<< /Type /Pages /Kids [{kids}] /Count {}", pages.len());
    if let Some(media) = inherited.media_box {
        write!(pages_dict, " /MediaBox {}", rect(media)).expect("write to string");
    }
    if let Some(rotate) = inherited.rotate {
        write!(pages_dict, " /Rotate {rotate}").expect("write to string");
    }
    pages_dict.push_str(" >>");
    objects.push(pages_dict);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned());

    // (id, diccionario del flujo o cuerpo completo, datos del flujo)
    let mut streams: Vec<(usize, String, Option<Vec<u8>>)> = Vec::new();
    for (page, (page_id, content_id, box_id, image_id)) in pages.iter().zip(&page_objects) {
        let xobjects = image_id
            .map(|id| format!(" /XObject << /Im0 {id} 0 R >>"))
            .unwrap_or_default();
        let mut dict = format!(
            "<< /Type /Page /Parent 2 0 R /Contents {content_id} 0 R /Resources << /Font << /F1 3 0 R >>{xobjects} >>"
        );
        if let Some(id) = box_id {
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
        dict.push_str(" >>");
        let mut body = match &page.text {
            Some(text) => {
                let escaped = text
                    .replace('\\', "\\\\")
                    .replace('(', "\\(")
                    .replace(')', "\\)");
                format!("BT /F1 36 Tf 72 700 Td ({escaped}) Tj ET")
            }
            None => String::new(),
        };
        if image_id.is_some() {
            body.push_str(" q 200 0 0 200 100 100 cm /Im0 Do Q");
        }
        streams.push((*page_id, dict, None));
        streams.push((*content_id, String::new(), Some(body.into_bytes())));
        if let (Some(id), Some(media)) = (box_id, page.media_box) {
            streams.push((*id, rect(media), None));
        }
        if let (Some(id), Some(data)) = (image_id, &page.jpx_image) {
            streams.push((
                *id,
                "/Type /XObject /Subtype /Image /Width 48 /Height 64 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode"
                    .to_owned(),
                Some(data.clone()),
            ));
        }
    }
    let mut trailer_info = String::new();
    if let Some(info) = info {
        let info_id = next;
        let mut dict = String::from("<<");
        if let Some(title) = &info.title {
            write!(dict, " /Title {}", pdf_text(title)).expect("write to string");
        }
        if let Some(author) = &info.author {
            write!(dict, " /Author {}", pdf_text(author)).expect("write to string");
        }
        dict.push_str(" >>");
        streams.push((info_id, dict, None));
        write!(trailer_info, " /Info {info_id} 0 R").expect("write to string");
    }
    streams.sort_by_key(|(id, _, _)| *id);

    let mut out = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    let mut write_object = |out: &mut Vec<u8>, id: usize, dict: &str, data: Option<&[u8]>| {
        offsets.push((id, out.len()));
        match data {
            Some(data) => {
                let head = format!("{id} 0 obj\n<< {dict} /Length {} >>\nstream\n", data.len());
                out.extend_from_slice(head.as_bytes());
                out.extend_from_slice(data);
                out.extend_from_slice(b"\nendstream\nendobj\n");
            }
            None => out.extend_from_slice(format!("{id} 0 obj\n{dict}\nendobj\n").as_bytes()),
        }
    };
    for (index, body) in objects.iter().enumerate() {
        write_object(&mut out, index + 1, body, None);
    }
    for (id, dict, data) in &streams {
        write_object(&mut out, *id, dict, data.as_deref());
    }

    offsets.sort();
    let xref_at = out.len();
    let total = offsets.len() + 1;
    let mut xref = format!("xref\n0 {total}\n0000000000 65535 f \n");
    for (_, offset) in &offsets {
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
