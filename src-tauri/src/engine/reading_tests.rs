//! Pruebas de texto, búsqueda, índice y enlaces con MuPDF real y PDF sintéticos (fase R1.2).
//!
//! Lo que se comprueba en cada caso es la frontera con pdf.js: las cajas que salen de MuPDF deben caer donde
//! `transform` (la matriz de `open_document`) pone la posición PDF del mismo glifo, también con `/Rotate` y con
//! una `/CropBox` desplazada.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use mupdf::text_page::TextPage;
use rusqlite::Connection;

use super::api;
use super::links::{self, PageLink};
use super::outline::{self, OutlineItem};
use super::search::{SearchDone, SearchEvent, SearchProgress};
use super::testpdf::{
    Inherited, LinkSpec, LinkTarget, OutlineSpec, PageSpec, PdfOptions, build_pdf, build_pdf_with,
    line, text_book,
};
use super::text::{self, TextWord};
use super::{Engine, EngineConfig};
use crate::db;
use crate::error::ErrorCode;
use crate::library;

const WAIT: Duration = Duration::from_secs(30);
const BOOK: &str = "book";
/// Caja de recorte que desplaza el origen de la página (50, 700) respecto a la del PDF.
const CROP: [f64; 4] = [50.0, 100.0, 550.0, 700.0];

struct Fixture {
    _dir: tempfile::TempDir,
    path: PathBuf,
}

fn fixture(bytes: &[u8]) -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("book.pdf");
    std::fs::write(&path, bytes).expect("write pdf");
    Fixture { _dir: dir, path }
}

fn engine() -> Engine {
    Engine::new(EngineConfig::default())
}

/// Matriz `transform` de la página `page` (1-based), tal como la da `open_document`.
fn transform(engine: &Engine, path: &Path, page: usize) -> [f64; 6] {
    engine.document_info(BOOK, path).expect("info").pages[page - 1].transform
}

/// Espacio de usuario PDF -> visor, con la fórmula de pdf.js (`convertToViewportPoint`).
fn apply(t: [f64; 6], x: f64, y: f64) -> (f64, f64) {
    (t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5])
}

/// La inversa: del visor al espacio de usuario PDF.
fn to_pdf(t: [f64; 6], x: f64, y: f64) -> (f64, f64) {
    let [a, b, c, d, e, f] = t;
    let det = a * d - b * c;
    let (dx, dy) = (x - e, y - f);
    ((d * dx - c * dy) / det, (-b * dx + a * dy) / det)
}

/// Caja del visor que contiene las cuatro esquinas de `rect` (un rectángulo PDF) transformado.
fn view_bbox(t: [f64; 6], rect: [f64; 4]) -> [f64; 4] {
    let corners = [
        apply(t, rect[0], rect[1]),
        apply(t, rect[2], rect[1]),
        apply(t, rect[0], rect[3]),
        apply(t, rect[2], rect[3]),
    ];
    [
        corners.iter().map(|c| c.0).fold(f64::INFINITY, f64::min),
        corners.iter().map(|c| c.1).fold(f64::INFINITY, f64::min),
        corners
            .iter()
            .map(|c| c.0)
            .fold(f64::NEG_INFINITY, f64::max),
        corners
            .iter()
            .map(|c| c.1)
            .fold(f64::NEG_INFINITY, f64::max),
    ]
}

fn assert_close(actual: f64, expected: f64, tolerance: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{what}: {actual} != {expected} (±{tolerance})"
    );
}

fn assert_rect_close(actual: [f64; 4], expected: [f64; 4], tolerance: f64, what: &str) {
    for (index, (a, e)) in actual.iter().zip(expected).enumerate() {
        assert_close(*a, e, tolerance, &format!("{what}[{index}]"));
    }
}

fn contains(rect: [f64; 4], x: f64, y: f64, tolerance: f64) -> bool {
    x >= rect[0] - tolerance
        && x <= rect[2] + tolerance
        && y >= rect[1] - tolerance
        && y <= rect[3] + tolerance
}

fn page_words(engine: &Engine, path: &Path, page: u32) -> Vec<TextWord> {
    engine
        .read_document(BOOK, path, move |document| text::page_words(document, page))
        .expect("words")
}

/// Origen de cada carácter de la página, tal como lo da MuPDF (ya en espacio de visor).
fn glyph_origins(text_page: &TextPage) -> Vec<(char, (f64, f64))> {
    let mut origins = Vec::new();
    for block in text_page.blocks() {
        for line in block.lines() {
            for ch in line.chars() {
                if let Some(value) = ch.char() {
                    let origin = ch.origin();
                    origins.push((value, (f64::from(origin.x), f64::from(origin.y))));
                }
            }
        }
    }
    origins
}

fn word<'a>(words: &'a [TextWord], text: &str) -> &'a TextWord {
    words
        .iter()
        .find(|word| word.text == text)
        .unwrap_or_else(|| panic!("no word {text:?} in {words:?}"))
}

/// Recoge los eventos de una búsqueda hasta `search://done`.
fn collect(rx: &Receiver<SearchEvent>) -> (Vec<SearchProgress>, SearchDone) {
    let mut progress = Vec::new();
    loop {
        match rx.recv_timeout(WAIT).expect("an event before the timeout") {
            SearchEvent::Progress(page) => progress.push(page),
            SearchEvent::Done(done) => return (progress, done),
        }
    }
}

fn search(engine: &Engine, path: &Path, query: &str) -> (Vec<SearchProgress>, SearchDone) {
    let (tx, rx) = mpsc::channel();
    engine
        .start_search(BOOK, path, query, move |event| {
            let _ = tx.send(event);
        })
        .expect("start");
    collect(&rx)
}

fn rotated(rotate: i32, crop: Option<[f64; 4]>, content: &str) -> PageSpec {
    PageSpec {
        rotate: Some(rotate),
        crop_box: crop,
        ..PageSpec::with_content(content)
    }
}

/// Los caracteres de «Hola mundo» (baseline en y = 400 de PDF) caen en la caja de su palabra y su origen, al
/// deshacer `transform`, está sobre la línea base, en cada rotación y con la `/CropBox` desplazada.
#[test]
fn word_boxes_follow_the_viewer_transform_in_every_rotation_and_crop() {
    for crop in [None, Some(CROP)] {
        for rotate in [0, 90, 180, 270] {
            let page = rotated(rotate, crop, &line(150.0, 400.0, 24.0, "Hola mundo"));
            let book = fixture(&build_pdf(&[page], &Inherited::default()));
            let engine = engine();
            let t = transform(&engine, &book.path, 1);
            let origins = engine
                .read_document(BOOK, &book.path, |document| {
                    Ok(glyph_origins(&document.text_page(1)?))
                })
                .expect("origins");

            let case = format!("rotate {rotate}, crop {crop:?}");
            let (first, first_origin) = origins[0];
            assert_eq!(first, 'H', "{case}");
            let (x, y) = to_pdf(t, first_origin.0, first_origin.1);
            assert_close(x, 150.0, 0.05, &format!("{case}: x of H"));
            assert_close(y, 400.0, 0.05, &format!("{case}: baseline of H"));
            for (value, (vx, vy)) in &origins {
                let (_, py) = to_pdf(t, *vx, *vy);
                assert_close(py, 400.0, 0.05, &format!("{case}: baseline of {value:?}"));
            }

            let words = page_words(&engine, &book.path, 1);
            assert_eq!(
                words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(),
                ["Hola", "mundo"],
                "{case}"
            );
            let geometry = engine.document_info(BOOK, &book.path).expect("info").pages[0];
            let hola = word(&words, "Hola");
            assert!(
                contains(hola.rect, first_origin.0, first_origin.1, 0.5),
                "{case}: {:?}",
                hola.rect
            );
            let m_origin = origins
                .iter()
                .find(|(value, _)| *value == 'm')
                .map(|(_, origin)| *origin)
                .expect("m");
            let mundo = word(&words, "mundo");
            assert!(
                contains(mundo.rect, m_origin.0, m_origin.1, 0.5),
                "{case}: {:?}",
                mundo.rect
            );
            for w in &words {
                assert!(
                    w.rect[0] >= -1.0 && w.rect[1] >= -1.0,
                    "{case}: {:?}",
                    w.rect
                );
                assert!(w.rect[2] <= geometry.width + 1.0, "{case}: {:?}", w.rect);
                assert!(w.rect[3] <= geometry.height + 1.0, "{case}: {:?}", w.rect);
            }
        }
    }
}

#[test]
fn words_come_in_reading_order_with_line_and_block_ends() {
    let content = [
        line(72.0, 700.0, 14.0, "Primera línea del texto"),
        line(72.0, 680.0, 14.0, "segunda línea"),
        line(72.0, 400.0, 14.0, "Tercera"),
    ]
    .concat();
    let book = fixture(&build_pdf(
        &[PageSpec::with_content(&content)],
        &Inherited::default(),
    ));
    let engine = engine();

    let words = page_words(&engine, &book.path, 1);

    let texts: Vec<&str> = words.iter().map(|w| w.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "Primera", "línea", "del", "texto", "segunda", "línea", "Tercera"
        ]
    );
    let line_ends: Vec<bool> = words.iter().map(|w| w.line_end).collect();
    assert_eq!(line_ends, [false, false, false, true, false, true, true]);
    assert!(words.last().is_some_and(|w| w.block_end));
    // Las palabras de una línea están de izquierda a derecha y no se solapan en vertical.
    assert!(words[0].rect[0] < words[1].rect[0] && words[1].rect[0] < words[2].rect[0]);
    assert!(words[0].rect[1] < words[4].rect[1]);
}

#[test]
fn an_empty_page_has_no_words_and_a_bad_page_is_an_error() {
    let book = fixture(&build_pdf(
        &[PageSpec::with_content("")],
        &Inherited::default(),
    ));
    let engine = engine();

    assert!(page_words(&engine, &book.path, 1).is_empty());
    let error = engine
        .read_document(BOOK, &book.path, |document| text::page_words(document, 2))
        .expect_err("page 2 does not exist");
    assert!(matches!(
        error,
        super::EngineError::PageOutOfRange { page: 2, count: 1 }
    ));
}

/// Los resultados de la búsqueda no distinguen mayúsculas ni acentos, y una frase que cruza un salto de línea
/// da un rectángulo por línea.
#[test]
fn search_ignores_case_and_accents_and_finds_phrases_across_lines() {
    let content = [
        line(72.0, 700.0, 14.0, "Él dijo: Dios es amor."),
        line(72.0, 680.0, 14.0, "DIOS es vida; diós también."),
        line(72.0, 660.0, 14.0, "la fe de"),
        line(72.0, 646.0, 14.0, "Dios se revela."),
    ]
    .concat();
    let book = fixture(&build_pdf(
        &[PageSpec::with_content(&content)],
        &Inherited::default(),
    ));
    let engine = engine();

    let (progress, done) = search(&engine, &book.path, "dios");
    assert_eq!(done.total, 4);
    assert_eq!(done.pages_searched, 1);
    assert!(!done.cancelled && done.error.is_none());
    assert_eq!(progress.len(), 1);
    assert_eq!(progress[0].page, 1);
    assert_eq!(progress[0].matches.len(), 4);

    let (_, accented) = search(&engine, &book.path, "DIÓS");
    assert_eq!(accented.total, 4);
    let (_, el) = search(&engine, &book.path, "EL");
    assert_eq!(el.total, 2, "«Él» y «revela»");

    let (progress, phrase) = search(&engine, &book.path, "fe de dios");
    assert_eq!(phrase.total, 1);
    let rects = &progress[0].matches[0].rects;
    assert_eq!(rects.len(), 2, "una caja por línea: {rects:?}");
    assert!(rects[0][1] < rects[1][1], "la primera línea está encima");
}

/// Las cajas de las coincidencias van en el mismo espacio que las de las palabras, también rotadas y recortadas.
#[test]
fn search_rects_are_in_the_viewer_frame() {
    for crop in [None, Some(CROP)] {
        for rotate in [0, 90, 270] {
            let page = rotated(rotate, crop, &line(150.0, 400.0, 24.0, "Hola mundo"));
            let book = fixture(&build_pdf(&[page], &Inherited::default()));
            let engine = engine();
            let t = transform(&engine, &book.path, 1);

            let (progress, done) = search(&engine, &book.path, "mundo");

            assert_eq!(done.total, 1, "rotate {rotate}, crop {crop:?}");
            let rect = progress[0].matches[0].rects[0];
            // Deshaciendo `transform`, la caja cubre la línea base (y = 400) y empieza tras el origen de la página.
            let corners: Vec<(f64, f64)> = [
                (rect[0], rect[1]),
                (rect[2], rect[1]),
                (rect[0], rect[3]),
                (rect[2], rect[3]),
            ]
            .iter()
            .map(|(x, y)| to_pdf(t, *x, *y))
            .collect();
            let min_y = corners.iter().map(|c| c.1).fold(f64::INFINITY, f64::min);
            let max_y = corners
                .iter()
                .map(|c| c.1)
                .fold(f64::NEG_INFINITY, f64::max);
            assert!(min_y < 400.0 && max_y > 400.0, "{rect:?} -> {corners:?}");
            let min_x = corners.iter().map(|c| c.0).fold(f64::INFINITY, f64::min);
            assert!(min_x > 150.0, "{rect:?} -> {corners:?}");
        }
    }
}

#[test]
fn search_reports_each_page_with_matches_and_the_total() {
    let pages: Vec<PageSpec> = ["nada", "Dios y dios", "nada", "DIOS", "nada"]
        .iter()
        .map(|text| PageSpec::with_text(text))
        .collect();
    let book = fixture(&build_pdf(&pages, &Inherited::default()));
    let engine = engine();

    let (progress, done) = search(&engine, &book.path, "dios");

    let pages_found: Vec<(u32, usize)> =
        progress.iter().map(|p| (p.page, p.matches.len())).collect();
    assert_eq!(pages_found, [(2, 2), (4, 1)]);
    assert_eq!(done.total, 3);
    assert_eq!(done.pages_searched, 5);
    assert!(!done.cancelled);
}

#[test]
fn a_book_that_is_not_a_pdf_ends_the_search_with_an_error() {
    let book = fixture(b"esto no es un PDF");
    let engine = engine();
    let (tx, rx) = mpsc::channel();
    engine
        .start_search(BOOK, &book.path, "dios", move |event| {
            let _ = tx.send(event);
        })
        .expect("the query is valid");

    let (progress, done) = collect(&rx);

    assert!(progress.is_empty());
    assert_eq!(
        done.error.map(|error| error.code),
        Some(ErrorCode::InvalidPdf)
    );
}

/// Cancelar desde fuera: el evento de la primera página bloquea el hilo de lectura hasta que la búsqueda queda
/// cancelada, así que solo hay una página, sin más eventos después de la cancelación.
#[test]
fn cancelling_stops_the_search_after_the_current_page() {
    let pages: Vec<PageSpec> = (0..30).map(|_| PageSpec::with_text("dios")).collect();
    let book = fixture(&build_pdf(&pages, &Inherited::default()));
    let engine = engine();
    let (tx, rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let mut holding = true;
    let search_id = engine
        .start_search(BOOK, &book.path, "dios", move |event| {
            let first_progress = holding && matches!(event, SearchEvent::Progress(_));
            let _ = tx.send(event);
            if first_progress {
                holding = false;
                let _ = release_rx.recv_timeout(WAIT);
            }
        })
        .expect("start");

    let first = rx.recv_timeout(WAIT).expect("the first page");
    assert!(matches!(first, SearchEvent::Progress(_)));
    engine.cancel_search(&search_id);
    release_tx.send(()).expect("release");

    let (progress, done) = collect(&rx);
    assert!(
        progress.is_empty(),
        "no events after the cancellation: {progress:?}"
    );
    assert!(done.cancelled);
    assert_eq!(done.pages_searched, 1);
    assert_eq!(done.total, 1);
}

/// Una búsqueda nueva del mismo libro cancela la anterior; la de otro libro no se toca.
#[test]
fn a_new_search_on_the_same_book_cancels_the_previous_one() {
    let pages: Vec<PageSpec> = (0..10).map(|_| PageSpec::with_text("dios")).collect();
    let book = fixture(&build_pdf(&pages, &Inherited::default()));
    let engine = engine();
    let (tx_a, rx_a) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let mut holding = true;
    engine
        .start_search(BOOK, &book.path, "dios", move |event| {
            let first_progress = holding && matches!(event, SearchEvent::Progress(_));
            let _ = tx_a.send(event);
            if first_progress {
                holding = false;
                let _ = release_rx.recv_timeout(WAIT);
            }
        })
        .expect("first");
    assert!(matches!(
        rx_a.recv_timeout(WAIT).expect("first progress"),
        SearchEvent::Progress(_)
    ));

    // Mientras el hilo de lectura está retenido en la primera búsqueda, se lanza la segunda.
    let (tx_b, rx_b) = mpsc::channel();
    engine
        .start_search(BOOK, &book.path, "dios", move |event| {
            let _ = tx_b.send(event);
        })
        .expect("second");
    release_tx.send(()).expect("release");

    let (_, first_done) = collect(&rx_a);
    assert!(first_done.cancelled, "the superseded search reports it");
    assert_eq!(first_done.pages_searched, 1);
    let (second_progress, second_done) = collect(&rx_b);
    assert_eq!(second_done.total, 10);
    assert!(!second_done.cancelled);
    assert_eq!(second_progress.len(), 10);
}

#[test]
fn the_outline_points_to_the_viewer_frame_of_each_destination() {
    let pages = vec![
        PageSpec::with_content(""),
        rotated(90, Some(CROP), ""),
        rotated(270, None, ""),
    ];
    let outline = vec![
        OutlineSpec {
            title: "Capítulo 1".into(),
            target: Some(LinkTarget::Page {
                page: 2,
                left: 100.0,
                top: 500.0,
            }),
            children: vec![OutlineSpec {
                title: "Sección 1.1".into(),
                target: Some(LinkTarget::Page {
                    page: 3,
                    left: 50.0,
                    top: 300.0,
                }),
                children: Vec::new(),
            }],
        },
        OutlineSpec {
            title: "Web".into(),
            target: Some(LinkTarget::Uri("https://example.org/libro".into())),
            children: Vec::new(),
        },
        OutlineSpec {
            title: "Sin destino".into(),
            target: None,
            children: Vec::new(),
        },
        OutlineSpec {
            title: "Inicio".into(),
            target: Some(LinkTarget::Page {
                page: 1,
                left: 0.0,
                top: 792.0,
            }),
            children: Vec::new(),
        },
    ];
    let book = fixture(&build_pdf_with(
        &pages,
        &PdfOptions {
            inherited: Inherited::default(),
            outline,
            ..PdfOptions::default()
        },
    ));
    let engine = engine();
    let items = engine
        .read_document(BOOK, &book.path, outline::outline)
        .expect("outline");

    assert_eq!(items.len(), 4);
    let chapter = &items[0];
    assert_eq!(chapter.title, "Capítulo 1");
    assert_eq!(chapter.page, Some(2));
    let expected = apply(transform(&engine, &book.path, 2), 100.0, 500.0).1;
    assert_close(chapter.y.expect("y"), expected, 1e-3, "chapter y");
    assert_eq!(chapter.uri, None);
    let section: &OutlineItem = &chapter.children[0];
    assert_eq!(section.title, "Sección 1.1");
    assert_eq!(section.page, Some(3));
    let expected = apply(transform(&engine, &book.path, 3), 50.0, 300.0).1;
    assert_close(section.y.expect("y"), expected, 1e-3, "section y");

    let web = &items[1];
    assert_eq!((web.page, web.y), (None, None));
    assert_eq!(web.uri.as_deref(), Some("https://example.org/libro"));
    let none = &items[2];
    assert_eq!((none.page, none.y, none.uri.as_deref()), (None, None, None));
    let home = &items[3];
    assert_eq!(home.page, Some(1));
    let expected = apply(transform(&engine, &book.path, 1), 0.0, 792.0).1;
    assert_close(home.y.expect("y"), expected, 1e-3, "home y");
}

#[test]
fn a_document_without_outline_has_an_empty_one() {
    let book = fixture(&text_book(2));
    let engine = engine();

    let items = engine
        .read_document(BOOK, &book.path, outline::outline)
        .expect("outline");

    assert!(items.is_empty());
}

#[test]
fn page_links_have_viewer_boxes_and_only_safe_targets() {
    let first = PageSpec {
        rotate: Some(90),
        crop_box: Some(CROP),
        links: vec![
            LinkSpec {
                rect: [100.0, 500.0, 200.0, 520.0],
                target: LinkTarget::Page {
                    page: 2,
                    left: 0.0,
                    top: 300.0,
                },
            },
            LinkSpec {
                rect: [100.0, 300.0, 200.0, 320.0],
                target: LinkTarget::Uri("https://example.org/x".into()),
            },
            LinkSpec {
                rect: [300.0, 300.0, 350.0, 320.0],
                target: LinkTarget::Uri("file:///etc/passwd".into()),
            },
            LinkSpec {
                rect: [300.0, 400.0, 350.0, 420.0],
                target: LinkTarget::Uri("mailto:alguien@example.org".into()),
            },
        ],
        ..PageSpec::with_content("")
    };
    let book = fixture(&build_pdf(
        &[first, PageSpec::with_content("")],
        &Inherited::default(),
    ));
    let engine = engine();
    let t1 = transform(&engine, &book.path, 1);
    let t2 = transform(&engine, &book.path, 2);

    let links: Vec<PageLink> = engine
        .read_document(BOOK, &book.path, |document| links::page_links(document, 1))
        .expect("links");

    assert_eq!(links.len(), 3, "file: is dropped: {links:?}");
    let internal = links
        .iter()
        .find(|link| matches!(link.target, links::LinkTarget::Page { .. }))
        .expect("internal link");
    assert_rect_close(
        internal.rect,
        view_bbox(t1, [100.0, 500.0, 200.0, 520.0]),
        0.01,
        "internal rect",
    );
    match &internal.target {
        links::LinkTarget::Page { page, y } => {
            assert_eq!(*page, 2);
            // El destino está en la página 2: su `y` se mide con la matriz de esa página.
            assert_close(y.expect("y"), apply(t2, 0.0, 300.0).1, 1e-3, "internal y");
        }
        other => panic!("expected an internal link, got {other:?}"),
    }
    let web = links
        .iter()
        .find(|link| {
            matches!(&link.target, links::LinkTarget::Uri { uri } if uri.starts_with("https"))
        })
        .expect("web link");
    assert_rect_close(
        web.rect,
        view_bbox(t1, [100.0, 300.0, 200.0, 320.0]),
        0.01,
        "web rect",
    );
    assert!(links.iter().any(|link| matches!(
        &link.target,
        links::LinkTarget::Uri { uri } if uri.starts_with("mailto:")
    )));
}

/// Validación de los comandos: página fuera de rango, consulta vacía, libro desconocido y PDF roto.
#[test]
fn the_commands_reject_bad_arguments_with_app_errors() {
    let (_dir, db, id, _path) = register(&text_book(2));
    let engine = engine();

    let error = api::page_text(&db, &engine, &id, 0).expect_err("page 0");
    assert_eq!(error.code, ErrorCode::InvalidInput);
    let error = api::page_text(&db, &engine, &id, 3).expect_err("page 3");
    assert_eq!(error.code, ErrorCode::InvalidInput);
    let error = api::page_links(&db, &engine, &id, 3).expect_err("page 3");
    assert_eq!(error.code, ErrorCode::InvalidInput);
    let error = api::page_text(&db, &engine, &"d".repeat(64), 1).expect_err("unknown");
    assert_eq!(error.code, ErrorCode::NotFound);
    let error = api::outline(&db, &engine, "nope").expect_err("bad id");
    assert_eq!(error.code, ErrorCode::InvalidInput);
    let error =
        api::start_search(&db, &engine, &id, "   ", |_: SearchEvent| {}).expect_err("blank query");
    assert_eq!(error.code, ErrorCode::InvalidInput);

    // El libro se registra bien y luego el archivo se rompe (la biblioteca no admite un PDF roto al importar).
    let (_dir, db, id, path) = register(&text_book(1));
    std::fs::write(&path, b"not a pdf").expect("overwrite");
    let error =
        api::start_search(&db, &engine, &id, "dios", |_: SearchEvent| {}).expect_err("broken pdf");
    assert_eq!(error.code, ErrorCode::InvalidPdf);
}

#[test]
fn a_started_search_through_the_api_reports_its_id_and_events() {
    let (_dir, db, id, _path) = register(&text_book(3));
    let engine = engine();
    let (tx, rx) = mpsc::channel();

    let search_id = api::start_search(&db, &engine, &id, "page", move |event| {
        let _ = tx.send(event);
    })
    .expect("start");

    assert_eq!(search_id.len(), 36, "a uuid: {search_id}");
    let (progress, done) = collect(&rx);
    assert_eq!(done.search_id, search_id);
    assert_eq!(done.total, 3);
    assert_eq!(progress.len(), 3);
}

fn register(pdf: &[u8]) -> (tempfile::TempDir, Mutex<Connection>, String, PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut conn = db::open(&dir.path().join("atril.db")).expect("db");
    let path = dir.path().join("libro.pdf");
    std::fs::write(&path, pdf).expect("write");
    let id = library::open_path(&mut conn, &path).expect("register").id;
    (dir, Mutex::new(conn), id, path)
}
