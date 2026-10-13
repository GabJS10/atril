//! Texto de una página con la caja de cada palabra (`get_page_text`, docs/IPC.md "Texto, búsqueda, índice y
//! enlaces").
//!
//! MuPDF da el texto como bloques, líneas y caracteres, cada uno con su `quad` ya en espacio de página de
//! MuPDF, que es el mismo que el del visor a escala 1 (origen arriba a la izquierda, `/Rotate` y `/CropBox`
//! aplicados). Por eso las cajas salen directamente en coordenadas del visor, sin pasar por `transform`. Las
//! pruebas de `reading_tests` comprueban que el origen de cada glifo, deshaciendo `transform`, cae sobre la línea
//! base de su posición PDF, con cada rotación y con la `/CropBox` desplazada.
//!
//! El orden de las palabras es el de MuPDF: el orden en que el contenido de la página dibuja el texto (el mismo
//! que usa el capa de texto de pdf.js). Para casi todos los libros es el orden de lectura; en páginas con varias
//! columnas o con texto superpuesto puede no serlo.

use mupdf::Quad;
use mupdf::text_page::{TextBlockType, TextPage};
use serde::Serialize;

use super::document::OpenDocument;
use super::{EngineError, ViewRect};

/// Un carácter con su caja. `line` y `block` son índices crecientes en el orden del contenido: dos caracteres
/// con el mismo `line` están en la misma línea.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Glyph {
    pub ch: char,
    pub rect: ViewRect,
    pub line: u32,
    pub block: u32,
}

/// Una palabra (sin espacios) con su caja. `line_end` y `block_end` marcan el último elemento de su línea y de
/// su bloque: así el front sabe cuándo poner un salto de línea o de párrafo al copiar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextWord {
    pub text: String,
    pub rect: ViewRect,
    pub line_end: bool,
    pub block_end: bool,
}

/// Caracteres que no se muestran ni se buscan: guion blando, espacios de ancho cero y BOM.
pub fn is_ignorable(c: char) -> bool {
    matches!(
        c,
        '\u{AD}' | '\u{200B}'..='\u{200D}' | '\u{2060}' | '\u{FEFF}'
    )
}

/// Caracteres de una página en orden de contenido, solo de bloques de texto (no de imágenes ni de vectores).
pub fn glyphs(page: &TextPage) -> Vec<Glyph> {
    let mut glyphs = Vec::new();
    let mut line_id = 0_u32;
    for (block_index, block) in page.blocks().enumerate() {
        if block.r#type() != TextBlockType::Text {
            continue;
        }
        let block_id = u32::try_from(block_index).unwrap_or(u32::MAX);
        for line in block.lines() {
            for ch in line.chars() {
                let Some(value) = ch.char() else {
                    continue;
                };
                let Some(rect) = quad_rect(&ch.quad()) else {
                    continue;
                };
                glyphs.push(Glyph {
                    ch: value,
                    rect,
                    line: line_id,
                    block: block_id,
                });
            }
            line_id = line_id.saturating_add(1);
        }
    }
    glyphs
}

/// Caja mínima que contiene los cuatro puntos del `quad` como `[x0, y0, x1, y1]`.
pub fn quad_rect(quad: &Quad) -> Option<ViewRect> {
    let points = [quad.ul, quad.ur, quad.ll, quad.lr];
    if points
        .iter()
        .any(|point| !point.x.is_finite() || !point.y.is_finite())
    {
        return None;
    }
    let xs = points.map(|point| f64::from(point.x));
    let ys = points.map(|point| f64::from(point.y));
    Some([
        xs.iter().copied().fold(f64::INFINITY, f64::min),
        ys.iter().copied().fold(f64::INFINITY, f64::min),
        xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    ])
}

/// Caja que contiene a `a` y a `b`.
pub fn union(a: ViewRect, b: ViewRect) -> ViewRect {
    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
    ]
}

/// Agrupa los caracteres en palabras. Una palabra es una secuencia de caracteres sin espacios dentro de una
/// línea; cambiar de línea o de bloque la corta. Los caracteres ignorables no cuentan ni amplían la caja.
pub fn words(glyphs: &[Glyph]) -> Vec<TextWord> {
    let mut words: Vec<TextWord> = Vec::new();
    let mut current: Option<TextWord> = None;
    let mut previous: Option<(u32, u32)> = None;

    for glyph in glyphs {
        let position = (glyph.line, glyph.block);
        if let Some(before) = previous
            && before != position
        {
            flush(&mut words, &mut current);
            if let Some(last) = words.last_mut() {
                last.line_end = true;
                last.block_end |= before.1 != glyph.block;
            }
        }
        previous = Some(position);

        if glyph.ch.is_whitespace() {
            flush(&mut words, &mut current);
            continue;
        }
        if is_ignorable(glyph.ch) {
            continue;
        }
        match current.as_mut() {
            Some(word) => {
                word.text.push(glyph.ch);
                word.rect = union(word.rect, glyph.rect);
            }
            None => {
                current = Some(TextWord {
                    text: glyph.ch.to_string(),
                    rect: glyph.rect,
                    line_end: false,
                    block_end: false,
                });
            }
        }
    }
    flush(&mut words, &mut current);
    if let Some(last) = words.last_mut() {
        last.line_end = true;
        last.block_end = true;
    }
    words
}

fn flush(words: &mut Vec<TextWord>, current: &mut Option<TextWord>) {
    if let Some(word) = current.take() {
        words.push(word);
    }
}

/// Palabras de la página `page` (1-based) con su caja en coordenadas del visor a escala 1.
pub fn page_words(document: &OpenDocument, page: u32) -> Result<Vec<TextWord>, EngineError> {
    let text_page = document.text_page(page)?;
    Ok(words(&glyphs(&text_page)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn glyph(ch: char, x: f64, line: u32, block: u32) -> Glyph {
        Glyph {
            ch,
            rect: [x, 0.0, x + 5.0, 10.0],
            line,
            block,
        }
    }

    fn texts(words: &[TextWord]) -> Vec<&str> {
        words.iter().map(|word| word.text.as_str()).collect()
    }

    #[test]
    fn words_split_on_spaces_and_mark_line_and_block_ends() {
        let glyphs: Vec<Glyph> = "Hola mundo"
            .chars()
            .enumerate()
            .map(|(index, ch)| glyph(ch, index as f64 * 5.0, 0, 0))
            .chain(
                "Otra línea"
                    .chars()
                    .enumerate()
                    .map(|(index, ch)| glyph(ch, index as f64 * 5.0, 1, 0)),
            )
            .chain(
                "Bloque"
                    .chars()
                    .enumerate()
                    .map(|(index, ch)| glyph(ch, index as f64 * 5.0, 2, 1)),
            )
            .collect();

        let words = words(&glyphs);

        assert_eq!(
            texts(&words),
            vec!["Hola", "mundo", "Otra", "línea", "Bloque"]
        );
        let ends: Vec<(bool, bool)> = words
            .iter()
            .map(|word| (word.line_end, word.block_end))
            .collect();
        assert_eq!(
            ends,
            vec![
                (false, false),
                (true, false),
                (false, false),
                (true, true),
                (true, true)
            ]
        );
    }

    /// Un cambio de línea corta la palabra aunque no haya espacio: la copia lleva salto de línea, no espacio.
    #[test]
    fn a_line_change_cuts_a_word_and_marks_the_line_end() {
        let glyphs = vec![glyph('a', 0.0, 0, 0), glyph('b', 5.0, 1, 0)];

        let words = words(&glyphs);

        assert_eq!(texts(&words), vec!["a", "b"]);
        assert!(words[0].line_end && !words[0].block_end);
        assert_eq!(words[0].rect, [0.0, 0.0, 5.0, 10.0]);
        assert_eq!(words[1].rect, [5.0, 0.0, 10.0, 10.0]);
    }

    #[test]
    fn ignorable_characters_do_not_count() {
        let glyphs = vec![
            glyph('d', 0.0, 0, 0),
            glyph('\u{AD}', 5.0, 0, 0),
            glyph('i', 10.0, 0, 0),
            glyph(' ', 15.0, 0, 0),
            glyph('\u{FEFF}', 20.0, 0, 0),
        ];

        let words = words(&glyphs);

        assert_eq!(texts(&words), vec!["di"]);
        assert_eq!(words[0].rect, [0.0, 0.0, 15.0, 10.0]);
        assert!(words[0].line_end && words[0].block_end);
    }

    #[test]
    fn an_empty_page_has_no_words() {
        assert!(words(&[]).is_empty());
        assert!(words(&[glyph(' ', 0.0, 0, 0)]).is_empty());
    }

    #[test]
    fn quad_rect_takes_the_bounding_box_of_the_four_corners() {
        let quad = Quad::new(
            mupdf::Point { x: 10.0, y: 5.0 },
            mupdf::Point { x: 30.0, y: 4.0 },
            mupdf::Point { x: 9.0, y: 20.0 },
            mupdf::Point { x: 31.0, y: 21.0 },
        );

        assert_eq!(quad_rect(&quad), Some([9.0, 4.0, 31.0, 21.0]));
        let broken = Quad::new(
            mupdf::Point {
                x: f32::NAN,
                y: 0.0,
            },
            mupdf::Point { x: 1.0, y: 0.0 },
            mupdf::Point { x: 1.0, y: 1.0 },
            mupdf::Point { x: 0.0, y: 1.0 },
        );
        assert_eq!(quad_rect(&broken), None);
    }
}
