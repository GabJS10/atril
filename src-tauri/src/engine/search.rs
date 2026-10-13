//! Búsqueda de texto en un libro (`search_document`, docs/IPC.md "Texto, búsqueda, índice y enlaces").
//!
//! Cómo funciona:
//! - Texto plegado: se compara en minúsculas, sin diacríticos y con la forma de compatibilidad (`ﬁ` → `fi`), igual
//!   que la búsqueda de pdf.js en Firefox. La consulta y el texto de la página pasan por la misma función
//!   ([`fold_char`]). Una búsqueda de «dios» encuentra «Dios», «DIOS» y «Diós».
//! - Saltos de línea: el paso de una línea a otra (o de un bloque a otro) cuenta como un espacio, así que
//!   «fe de» + «Dios» en la línea siguiente casa con «fe de dios». Cada línea de la coincidencia es un rectángulo.
//! - Trabajo por páginas en el hilo de lectura del motor ([`Engine`](super::Engine)), no en el pool de render: cada
//!   página es un paso, y tras cada paso el hilo atiende lo que haya en cola (texto, enlaces, otra búsqueda). Un
//!   render del visor no espera más que a un paso, y nunca a la búsqueda entera.
//! - Eventos: `search://progress` por cada página con coincidencias y `search://done` al final (también cuando
//!   se cancela o falla). Una búsqueda nueva del mismo libro cancela la anterior.

use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};

use serde::Serialize;
use unicode_normalization::char::{decompose_compatible, is_combining_mark};

use super::document::OpenDocument;
use super::pool::{ReaderJob, Worker, lock};
use super::text::{self, Glyph, union};
use super::{EngineError, ViewRect};
use crate::error::AppError;

/// Longitud máxima de la consulta, en caracteres.
pub const MAX_QUERY_CHARS: usize = 200;

/// Respuesta de `search_document`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStarted {
    pub search_id: String,
}

/// Una coincidencia: un rectángulo por línea que toca (en coordenadas del visor a escala 1).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub rects: Vec<ViewRect>,
}

/// Payload de `search://progress`: las coincidencias de una página, en orden.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchProgress {
    pub search_id: String,
    /// 1-based.
    pub page: u32,
    pub matches: Vec<SearchMatch>,
}

/// Payload de `search://done`. `error` solo si la búsqueda no pudo leer el libro.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDone {
    pub search_id: String,
    /// Coincidencias encontradas hasta el final (o hasta la cancelación).
    pub total: u32,
    /// Páginas recorridas, incluidas las que no tienen coincidencias.
    pub pages_searched: u32,
    pub cancelled: bool,
    pub error: Option<AppError>,
}

/// Lo que se envía al exterior durante una búsqueda.
#[derive(Debug, Clone, PartialEq)]
pub enum SearchEvent {
    Progress(SearchProgress),
    Done(SearchDone),
}

/// Pliega un carácter para comparar: minúscula, sin diacríticos y con la forma de compatibilidad. Los espacios no
/// pasan por aquí (ver [`fold_query`] y [`fold_glyphs`]).
pub fn fold_char(c: char, out: &mut Vec<char>) {
    if c.is_ascii() {
        out.push(c.to_ascii_lowercase());
    } else if !text::is_ignorable(c) {
        decompose_compatible(c, |decomposed| {
            if !is_combining_mark(decomposed) {
                out.extend(decomposed.to_lowercase());
            }
        });
    }
}

/// Consulta plegada. Los espacios se reducen a uno. Falla si está vacía, si solo tiene espacios o si es larga.
pub fn fold_query(query: &str) -> Result<Vec<char>, EngineError> {
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(EngineError::InvalidInput(format!(
            "the search has more than {MAX_QUERY_CHARS} characters"
        )));
    }
    let mut folded = Vec::new();
    for c in query.chars() {
        if c.is_whitespace() {
            if folded.last() != Some(&' ') {
                folded.push(' ');
            }
        } else {
            fold_char(c, &mut folded);
        }
    }
    if folded.iter().all(|c| *c == ' ') {
        return Err(EngineError::InvalidInput("the search is empty".into()));
    }
    Ok(folded)
}

/// Texto plegado de una página y, para cada carácter, el índice del carácter de origen (`None` si es el espacio
/// que se pone entre líneas).
#[derive(Debug, Default, PartialEq)]
pub struct Folded {
    pub chars: Vec<char>,
    pub source: Vec<Option<usize>>,
}

pub fn fold_glyphs(glyphs: &[Glyph]) -> Folded {
    let mut chars = Vec::with_capacity(glyphs.len());
    let mut source = Vec::with_capacity(glyphs.len());
    let mut previous: Option<(u32, u32)> = None;
    for (index, glyph) in glyphs.iter().enumerate() {
        let position = (glyph.line, glyph.block);
        if previous.is_some_and(|before| before != position) && chars.last() != Some(&' ') {
            // Un salto de línea o de bloque cuenta como un espacio que no tiene caracter propio.
            chars.push(' ');
            source.push(None);
        }
        previous = Some(position);

        if glyph.ch.is_whitespace() {
            if chars.last() != Some(&' ') {
                chars.push(' ');
                source.push(Some(index));
            }
            continue;
        }
        let before = chars.len();
        fold_char(glyph.ch, &mut chars);
        source.extend(std::iter::repeat_n(Some(index), chars.len() - before));
    }
    Folded { chars, source }
}

/// Posiciones (inicio, fin) de cada coincidencia, sin solapamientos.
pub fn find_all(haystack: &[char], needle: &[char]) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    if needle.is_empty() || needle.len() > haystack.len() {
        return found;
    }
    let mut start = 0;
    while start + needle.len() <= haystack.len() {
        if haystack[start..start + needle.len()] == *needle {
            found.push((start, start + needle.len()));
            start += needle.len();
        } else {
            start += 1;
        }
    }
    found
}

/// Un rectángulo por línea de los caracteres de origen de una coincidencia.
fn rects_of(glyphs: &[Glyph], sources: &[Option<usize>]) -> Vec<ViewRect> {
    let mut lines: Vec<(u32, ViewRect)> = Vec::new();
    for index in sources.iter().flatten() {
        let glyph = glyphs[*index];
        match lines.last_mut() {
            Some((line, rect)) if *line == glyph.line => *rect = union(*rect, glyph.rect),
            _ => lines.push((glyph.line, glyph.rect)),
        }
    }
    lines.into_iter().map(|(_, rect)| rect).collect()
}

/// Coincidencias de `needle` (ya plegada) en los caracteres de una página.
pub fn search_glyphs(glyphs: &[Glyph], needle: &[char]) -> Vec<SearchMatch> {
    let folded = fold_glyphs(glyphs);
    find_all(&folded.chars, needle)
        .into_iter()
        .filter_map(|(start, end)| {
            let rects = rects_of(glyphs, &folded.source[start..end]);
            (!rects.is_empty()).then_some(SearchMatch { rects })
        })
        .collect()
}

/// Coincidencias de una página (1-based) de `document`.
pub fn page_matches(
    document: &OpenDocument,
    page: u32,
    needle: &[char],
) -> Result<Vec<SearchMatch>, EngineError> {
    let text_page = document.text_page(page)?;
    Ok(search_glyphs(&text::glyphs(&text_page), needle))
}

/// Búsquedas activas. Una búsqueda nueva del mismo libro cancela la que había.
#[derive(Debug, Default)]
pub struct SearchRegistry {
    /// `searchId` -> (`bookId`, bandera de cancelación).
    active: HashMap<String, (String, Arc<AtomicBool>)>,
}

impl SearchRegistry {
    pub fn register(&mut self, book_id: &str, search_id: &str, cancel: Arc<AtomicBool>) {
        let superseded: Vec<String> = self
            .active
            .iter()
            .filter(|(_, (book, _))| book == book_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in superseded {
            self.cancel(&id);
        }
        self.active
            .insert(search_id.to_owned(), (book_id.to_owned(), cancel));
    }

    /// Marca la búsqueda como cancelada y la quita. Un id desconocido no hace nada.
    pub fn cancel(&mut self, search_id: &str) {
        if let Some((_, flag)) = self.active.remove(search_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    /// Quita una búsqueda que ya terminó.
    pub fn finish(&mut self, search_id: &str) {
        self.active.remove(search_id);
    }

    pub fn cancel_all(&mut self) {
        for (_, (_, flag)) in self.active.drain() {
            flag.store(true, Ordering::SeqCst);
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.active.len()
    }
}

/// Estado de una búsqueda entre pasos. Cada paso procesa una página y se reenvía al hilo de lectura.
pub struct SearchState {
    pub(super) search_id: String,
    pub(super) book_id: String,
    pub(super) path: PathBuf,
    pub(super) needle: Vec<char>,
    pub(super) cancel: Arc<AtomicBool>,
    pub(super) registry: Arc<Mutex<SearchRegistry>>,
    pub(super) reader: mpsc::Sender<ReaderJob>,
    pub(super) sink: Box<dyn FnMut(SearchEvent) + Send>,
    pub(super) page_count: Option<u32>,
    pub(super) next_page: u32,
    pub(super) total: u32,
    pub(super) pages_searched: u32,
}

impl SearchState {
    fn emit(&mut self, event: SearchEvent) {
        (self.sink)(event);
    }

    /// Último evento de la búsqueda. Quita la búsqueda del registro.
    fn finish(mut self, error: Option<AppError>, cancelled: bool) {
        lock(&self.registry).finish(&self.search_id);
        let done = SearchDone {
            search_id: self.search_id.clone(),
            total: self.total,
            pages_searched: self.pages_searched,
            cancelled: cancelled || self.cancel.load(Ordering::SeqCst),
            error,
        };
        self.emit(SearchEvent::Done(done));
    }
}

/// Un paso de búsqueda: procesa la siguiente página y reenvía la búsqueda al hilo de lectura. Se ejecuta en ese
/// hilo, que abre su propia copia del libro.
pub(super) fn step(mut state: SearchState, worker: &mut Worker) {
    if state.cancel.load(Ordering::SeqCst) {
        return state.finish(None, true);
    }
    let page_count = match state.page_count {
        Some(count) => count,
        None => match worker.document(&state.book_id, &state.path) {
            Ok(document) => {
                let count = document.page_count();
                state.page_count = Some(count);
                count
            }
            Err(error) => return state.finish(Some(error.into()), false),
        },
    };
    if state.next_page > page_count {
        return state.finish(None, false);
    }

    let page = state.next_page;
    state.next_page += 1;
    state.pages_searched += 1;
    let matches = match worker.document(&state.book_id, &state.path) {
        Ok(document) => {
            let needle = &state.needle;
            match catch_unwind(AssertUnwindSafe(|| page_matches(document, page, needle))) {
                Ok(Ok(matches)) => matches,
                Ok(Err(error)) => {
                    tracing::warn!(page, %error, "search skipped a page");
                    Vec::new()
                }
                Err(_) => {
                    tracing::warn!(page, "search skipped a page after a panic");
                    Vec::new()
                }
            }
        }
        Err(error) => return state.finish(Some(error.into()), false),
    };

    if !matches.is_empty() && !state.cancel.load(Ordering::SeqCst) {
        state.total = state
            .total
            .saturating_add(u32::try_from(matches.len()).unwrap_or(u32::MAX));
        let progress = SearchProgress {
            search_id: state.search_id.clone(),
            page,
            matches,
        };
        state.emit(SearchEvent::Progress(progress));
    }

    let reader = state.reader.clone();
    // Si el hilo ya no existe, el motor se está cerrando y nadie espera el resto.
    let _ = reader.send(Box::new(move |worker: &mut Worker| step(state, worker)));
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

    /// Caracteres de `text` en una línea (`line`), a partir de `x` con 5 puntos por carácter.
    fn row(text: &str, x: f64, line: u32) -> Vec<Glyph> {
        text.chars()
            .enumerate()
            .map(|(index, ch)| glyph(ch, x + index as f64 * 5.0, line, 0))
            .collect()
    }

    fn fold(text: &str) -> String {
        let mut out = Vec::new();
        for c in text.chars() {
            fold_char(c, &mut out);
        }
        out.into_iter().collect()
    }

    #[test]
    fn folding_ignores_case_accents_and_compatibility_forms() {
        assert_eq!(fold("DIOS"), "dios");
        assert_eq!(fold("Diós"), "dios");
        assert_eq!(fold("Ñandú"), "nandu");
        assert_eq!(fold("ﬁel"), "fiel");
        assert_eq!(fold("İ"), "i");
        assert_eq!(fold("ß"), "ß");
        assert_eq!(fold("\u{AD}d\u{200B}"), "d");
    }

    #[test]
    fn queries_are_folded_and_checked() {
        let folded: String = fold_query("  Fe  De ")
            .expect("query")
            .into_iter()
            .collect();
        assert_eq!(folded, " fe de ");
        assert!(matches!(
            fold_query("   "),
            Err(EngineError::InvalidInput(_))
        ));
        assert!(matches!(fold_query(""), Err(EngineError::InvalidInput(_))));
        assert!(matches!(
            fold_query("\u{AD}"),
            Err(EngineError::InvalidInput(_))
        ));
        let long = "a".repeat(MAX_QUERY_CHARS + 1);
        assert!(matches!(
            fold_query(&long),
            Err(EngineError::InvalidInput(_))
        ));
        assert!(fold_query(&"a".repeat(MAX_QUERY_CHARS)).is_ok());
    }

    #[test]
    fn matches_do_not_overlap() {
        let aa: Vec<char> = "aa".chars().collect();
        let haystack: Vec<char> = "aaaaa".chars().collect();

        assert_eq!(find_all(&haystack, &aa), vec![(0, 2), (2, 4)]);
        assert!(find_all(&haystack, &[]).is_empty());
        assert!(find_all(&aa, &haystack).is_empty());
    }

    #[test]
    fn a_match_across_a_line_break_gives_one_rect_per_line() {
        let mut glyphs = row("la fe de", 0.0, 0);
        glyphs.extend(row("Dios", 0.0, 1));
        let needle: Vec<char> = fold_query("FE DE dios").expect("query");

        let matches = search_glyphs(&glyphs, &needle);

        assert_eq!(matches.len(), 1);
        assert_eq!(
            matches[0].rects,
            vec![[15.0, 0.0, 40.0, 10.0], [0.0, 0.0, 20.0, 10.0]]
        );
    }

    #[test]
    fn accents_and_case_match_each_other() {
        let glyphs = row("Él dijo: el EL él", 0.0, 0);
        let needle = fold_query("el").expect("query");

        let matches = search_glyphs(&glyphs, &needle);

        assert_eq!(matches.len(), 4);
        assert_eq!(matches[0].rects, vec![[0.0, 0.0, 10.0, 10.0]]);
    }

    #[test]
    fn a_match_inside_one_line_is_one_rect() {
        let glyphs = row("abc dios xyz", 0.0, 0);
        let needle = fold_query("dios").expect("query");

        let matches = search_glyphs(&glyphs, &needle);

        assert_eq!(matches[0].rects, vec![[20.0, 0.0, 40.0, 10.0]]);
    }

    #[test]
    fn a_page_without_text_has_no_matches() {
        assert!(search_glyphs(&[], &fold_query("a").expect("query")).is_empty());
    }

    #[test]
    fn the_registry_cancels_the_previous_search_of_the_same_book() {
        let first = Arc::new(AtomicBool::new(false));
        let other_book = Arc::new(AtomicBool::new(false));
        let second = Arc::new(AtomicBool::new(false));
        let mut registry = SearchRegistry::default();

        registry.register("a", "s1", Arc::clone(&first));
        registry.register("b", "s2", Arc::clone(&other_book));
        registry.register("a", "s3", Arc::clone(&second));

        assert!(first.load(Ordering::SeqCst));
        assert!(!other_book.load(Ordering::SeqCst));
        assert!(!second.load(Ordering::SeqCst));
        assert_eq!(registry.len(), 2);
        registry.cancel("unknown");
        registry.finish("s2");
        registry.cancel_all();
        assert!(second.load(Ordering::SeqCst));
        assert_eq!(registry.len(), 0);
    }
}
