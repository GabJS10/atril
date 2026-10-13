//! Pruebas del motor completo (MuPDF real) con PDF sintéticos.

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use image::GenericImageView;

use super::geometry::{LETTER, page_geometry};
use super::testpdf::{Inherited, PageSpec, build_pdf, text_book};
use super::{Engine, EngineConfig, EngineError};

const WAIT: Duration = Duration::from_secs(20);

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

fn wait_until(what: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + WAIT;
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn decode(jpeg: &[u8]) -> image::DynamicImage {
    image::load_from_memory_with_format(jpeg, image::ImageFormat::Jpeg).expect("valid JPEG")
}

fn dark_pixels(image: &image::DynamicImage) -> usize {
    image
        .to_rgb8()
        .pixels()
        .filter(|pixel| pixel.0.iter().all(|channel| *channel < 100))
        .count()
}

#[test]
fn renders_a_text_page_to_jpeg_at_the_requested_scale() {
    let book = fixture(&text_book(3));
    let engine = engine();

    let one = decode(&engine.page_jpeg("b", &book.path, 1, 1.0).expect("scale 1"));
    let two = decode(&engine.page_jpeg("b", &book.path, 1, 2.0).expect("scale 2"));

    assert_eq!(one.dimensions(), (612, 792));
    assert_eq!(two.dimensions(), (1224, 1584));
    assert!(dark_pixels(&one) > 200, "the text should leave dark pixels");
    // Un trozo de la esquina inferior (sin texto) es blanco.
    let rgb = one.to_rgb8();
    assert!(
        rgb.get_pixel(10, 780)
            .0
            .iter()
            .all(|channel| *channel > 240)
    );
}

#[test]
fn page_numbers_are_checked() {
    let book = fixture(&text_book(2));
    let engine = engine();

    assert!(matches!(
        engine.page_jpeg("b", &book.path, 3, 1.0),
        Err(EngineError::PageOutOfRange { page: 3, count: 2 })
    ));
    assert!(matches!(
        engine.page_jpeg("b", &book.path, 0, 1.0),
        Err(EngineError::PageOutOfRange { page: 0, .. })
    ));
}

#[test]
fn a_file_that_is_not_a_pdf_is_an_invalid_pdf_error() {
    let book = fixture(b"this is not a pdf at all");
    let engine = engine();

    assert!(matches!(
        engine.document_info("b", &book.path),
        Err(EngineError::InvalidPdf(_))
    ));
    assert!(matches!(
        engine.document_info("b", std::path::Path::new("/no/such/file.pdf")),
        Err(EngineError::Io(_))
    ));
}

#[test]
fn the_same_page_is_served_from_the_cache_the_second_time() {
    let book = fixture(&text_book(1));
    let engine = engine();

    let first = engine.page_jpeg("b", &book.path, 1, 1.0).expect("render");
    assert!(engine.is_cached("b", 1, 1.0));
    let second = engine.page_jpeg("b", &book.path, 1, 1.0).expect("cached");

    assert!(std::sync::Arc::ptr_eq(&first, &second));
    // 1.0 y 1.001 caen en la misma escala cuantizada.
    assert!(engine.is_cached("b", 1, 1.001));
}

#[test]
fn a_page_request_prefetches_its_neighbours() {
    let book = fixture(&text_book(10));
    let engine = engine();

    engine.page_jpeg("b", &book.path, 5, 1.0).expect("render");

    for page in [6, 7, 4, 3] {
        wait_until(&format!("page {page} to be prefetched"), || {
            engine.is_cached("b", page, 1.0)
        });
    }
    assert!(!engine.is_cached("b", 9, 1.0));
}

#[test]
fn a_request_for_another_zone_supersedes_the_old_one() {
    let pages: Vec<PageSpec> = (0..40).map(|_| PageSpec::with_text("x")).collect();
    let book = fixture(&build_pdf(&pages, &Inherited::default()));
    // Un solo hilo, ocupado con un trabajo que no termina hasta que lo soltemos.
    let engine = Engine::new(EngineConfig {
        threads: 1,
        ..EngineConfig::default()
    });
    let (release, hold) = mpsc::channel::<()>();
    let (started_tx, started) = mpsc::channel::<()>();
    let blocker = std::thread::scope(|scope| {
        let handle = scope.spawn(|| {
            engine.run(move |_| {
                started_tx.send(()).expect("started");
                let _ = hold.recv();
                Ok(())
            })
        });
        started.recv_timeout(WAIT).expect("worker is busy");

        let (old_tx, old_rx) = mpsc::channel();
        engine.request_page(
            "b",
            &book.path,
            2,
            1.0,
            Box::new(move |result| {
                let _ = old_tx.send(result);
            }),
        );
        let (new_tx, new_rx) = mpsc::channel();
        engine.request_page(
            "b",
            &book.path,
            35,
            1.0,
            Box::new(move |result| {
                let _ = new_tx.send(result);
            }),
        );
        // La vieja se descarta de inmediato, sin esperar al hilo ocupado.
        assert_eq!(
            old_rx.recv_timeout(WAIT).expect("old answered"),
            Err(EngineError::Superseded)
        );
        release.send(()).expect("release");
        assert!(new_rx.recv_timeout(WAIT).expect("new answered").is_ok());
        handle.join().expect("blocker thread")
    });
    assert!(blocker.is_ok());
}

#[test]
fn dropping_the_engine_answers_pending_requests() {
    let book = fixture(&text_book(1));
    let engine = Engine::new(EngineConfig {
        threads: 1,
        ..EngineConfig::default()
    });
    engine.page_jpeg("b", &book.path, 1, 1.0).expect("render");

    drop(engine);
}

/// La matriz que calcula `geometry` coincide con lo que MuPDF dice de cada página (tamaño tras rotar
/// y recortar) para todas las variantes: así el JPEG tiene el tamaño del recuadro que dibuja el visor.
#[test]
fn geometry_matches_mupdf_page_sizes() {
    let specs = vec![
        PageSpec::with_text("plain"),
        PageSpec {
            rotate: Some(90),
            ..PageSpec::with_text("rotated 90")
        },
        PageSpec {
            rotate: Some(270),
            ..PageSpec::with_text("rotated 270")
        },
        PageSpec {
            rotate: Some(180),
            ..PageSpec::with_text("rotated 180")
        },
        PageSpec {
            rotate: Some(-90),
            ..PageSpec::with_text("rotated -90")
        },
        PageSpec {
            crop_box: Some([50.0, 100.0, 550.0, 700.0]),
            ..PageSpec::with_text("crop")
        },
        PageSpec {
            crop_box: Some([50.0, 100.0, 550.0, 700.0]),
            rotate: Some(90),
            ..PageSpec::with_text("crop and rotate")
        },
        PageSpec {
            media_box: Some([100.0, 200.0, 400.0, 700.0]),
            ..PageSpec::with_text("offset media box")
        },
        PageSpec {
            crop_box: Some([-100.0, -100.0, 300.0, 300.0]),
            media_box: Some([0.0, 0.0, 400.0, 400.0]),
            ..PageSpec::default()
        },
        PageSpec {
            indirect_media_box: true,
            media_box: Some([0.0, 0.0, 300.0, 500.0]),
            ..PageSpec::default()
        },
        PageSpec {
            media_box: Some([0.0, 0.0, 200.0, 300.0]),
            user_unit: Some(2.0),
            ..PageSpec::default()
        },
    ];
    let book = fixture(&build_pdf(&specs, &Inherited::default()));
    let engine = engine();

    let info = engine.document_info("b", &book.path).expect("info");
    assert_eq!(info.page_count as usize, specs.len());
    let sizes = engine
        .with_document("b", &book.path, |document| {
            (1..=document.page_count())
                .map(|number| document.native_size(number))
                .collect::<Result<Vec<_>, _>>()
        })
        .expect("mupdf sizes");

    for (index, (geometry, (width, height))) in info.pages.iter().zip(sizes).enumerate() {
        assert!(
            (geometry.width - width).abs() < 0.01 && (geometry.height - height).abs() < 0.01,
            "page {}: geometry {}x{} but MuPDF says {width}x{height}",
            index + 1,
            geometry.width,
            geometry.height,
        );
    }
}

#[test]
fn open_document_reports_rotated_size_and_the_pdfjs_matrix() {
    let specs = vec![
        PageSpec::with_text("plain"),
        PageSpec {
            rotate: Some(90),
            ..PageSpec::with_text("rotated")
        },
        PageSpec {
            crop_box: Some([50.0, 100.0, 550.0, 700.0]),
            ..PageSpec::with_text("crop")
        },
    ];
    let book = fixture(&build_pdf(&specs, &Inherited::default()));
    let engine = engine();

    let info = engine.document_info("b", &book.path).expect("info");

    // Valores que da `page.getViewport({ scale: 1 })` de pdf.js (calculados a mano en geometry.rs).
    assert_eq!(info.pages[0].transform, [1.0, 0.0, 0.0, -1.0, 0.0, 792.0]);
    assert_eq!(info.pages[0].width, 612.0);
    assert_eq!(info.pages[1].transform, [0.0, 1.0, 1.0, 0.0, 0.0, 0.0]);
    assert_eq!((info.pages[1].width, info.pages[1].height), (792.0, 612.0));
    assert_eq!(info.pages[2].transform, [1.0, 0.0, 0.0, -1.0, -50.0, 700.0]);
    assert_eq!((info.pages[2].width, info.pages[2].height), (500.0, 600.0));
    // La segunda llamada sale de memoria (la misma `Arc`).
    let again = engine.document_info("b", &book.path).expect("again");
    assert!(std::sync::Arc::ptr_eq(&info, &again));
}

#[test]
fn rotation_and_media_box_are_inherited_from_the_page_tree() {
    let specs = vec![
        PageSpec::default(),
        PageSpec {
            rotate: Some(0),
            ..PageSpec::default()
        },
    ];
    let inherited = Inherited {
        media_box: Some([0.0, 0.0, 300.0, 400.0]),
        rotate: Some(90),
    };
    let book = fixture(&build_pdf(&specs, &inherited));
    let engine = engine();

    let info = engine.document_info("b", &book.path).expect("info");

    // La primera hereda /Rotate 90; la segunda lo anula con /Rotate 0.
    assert_eq!((info.pages[0].width, info.pages[0].height), (400.0, 300.0));
    assert_eq!((info.pages[1].width, info.pages[1].height), (300.0, 400.0));
}

#[test]
fn pages_without_a_media_box_are_letter_like_in_pdfjs() {
    let book = fixture(&build_pdf(&[PageSpec::default()], &Inherited::default()));
    let engine = engine();

    let info = engine.document_info("b", &book.path).expect("info");

    assert_eq!(info.pages[0], page_geometry(&Default::default()));
    assert_eq!(
        (info.pages[0].width, info.pages[0].height),
        (LETTER[2], LETTER[3])
    );
}

#[test]
fn rendering_a_rotated_page_gives_the_rotated_image() {
    let specs = vec![PageSpec {
        rotate: Some(90),
        ..PageSpec::with_text("rotated")
    }];
    let book = fixture(&build_pdf(&specs, &Inherited::default()));
    let engine = engine();

    let image = decode(&engine.page_jpeg("b", &book.path, 1, 1.0).expect("render"));

    assert_eq!(image.dimensions(), (792, 612));
    assert!(dark_pixels(&image) > 100);
}

#[test]
fn huge_scales_are_reduced_to_the_pixel_limit() {
    let specs = vec![PageSpec {
        media_box: Some([0.0, 0.0, 3000.0, 3000.0]),
        ..PageSpec::default()
    }];
    let book = fixture(&build_pdf(&specs, &Inherited::default()));
    let engine = engine();

    let image = decode(&engine.page_jpeg("b", &book.path, 1, 8.0).expect("render"));

    let (width, height) = image.dimensions();
    assert!(u64::from(width) * u64::from(height) <= super::MAX_PIXELS + 100_000);
    assert!(width < 24_000);
}

/// Un escaneo JPEG 2000 (aquí 48x64 px, el fixture de `tests/fixtures/jpx`) se dibuja con el openjpeg de MuPDF.
#[test]
fn a_page_with_a_jpeg_2000_image_renders_the_image() {
    let jpx = include_bytes!("../../tests/fixtures/jpx/rgb.jp2").to_vec();
    let specs = vec![PageSpec {
        media_box: Some([0.0, 0.0, 400.0, 400.0]),
        jpx_image: Some(jpx),
        ..PageSpec::default()
    }];
    let book = fixture(&build_pdf(&specs, &Inherited::default()));
    let engine = engine();

    let image = decode(&engine.page_jpeg("b", &book.path, 1, 1.0).expect("render"));

    let rgb = image.to_rgb8();
    // El recuadro de la imagen es (100, 100)-(300, 300) en puntos, es decir, y de 100 a 300 desde arriba.
    let inside = rgb.get_pixel(200, 200).0;
    assert!(
        inside.iter().any(|channel| *channel < 200),
        "the image area should not be white: {inside:?}"
    );
    assert_eq!(rgb.get_pixel(20, 20).0, [255, 255, 255]);
}
