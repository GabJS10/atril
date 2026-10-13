//! Banco de pruebas de texto, búsqueda, índice y enlaces (fase R1.2). No usa libros del repo: se le pasa una ruta.
//!
//!   cargo run --release --example text_bench -- <libro.pdf> [consulta]
//!
//! Imprime tiempos en milisegundos: abrir el libro, `get_page_text` y `get_page_links` por página (muestra repartida
//! por el libro), el índice, una búsqueda completa (primer resultado y total) y el efecto de una búsqueda en curso
//! sobre el render de páginas del visor (las mismas páginas en reposo y con la búsqueda corriendo).

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use atril_lib::engine::search::SearchEvent;
use atril_lib::engine::{Engine, EngineConfig, links, outline, text};

/// Páginas repartidas por el libro para medir el texto y los enlaces.
const SAMPLE_PAGES: u32 = 40;
/// Páginas de render por fase.
const RENDER_SAMPLES: u32 = 16;
const BOOK: &str = "bench";

fn ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

/// Media, mediana, percentil 95 y máximo.
fn summary(mut values: Vec<f64>) -> [f64; 4] {
    if values.is_empty() {
        return [0.0; 4];
    }
    values.sort_by(f64::total_cmp);
    let count = values.len();
    let mean = values.iter().sum::<f64>() / count as f64;
    let p95 = values[((count as f64 * 0.95).ceil() as usize)
        .saturating_sub(1)
        .min(count - 1)];
    [mean, values[count / 2], p95, values[count - 1]]
}

fn print_row(label: &str, count: usize, stats: [f64; 4]) {
    println!(
        "| {label} | {count} | {:.1} | {:.1} | {:.1} | {:.1} |",
        stats[0], stats[1], stats[2], stats[3]
    );
}

/// Memoria residente actual (VmRSS) en MB.
fn rss_mb() -> f64 {
    std::fs::read_to_string("/proc/self/status")
        .unwrap_or_default()
        .lines()
        .find_map(|line| line.strip_prefix("VmRSS:"))
        .and_then(|rest| {
            rest.trim()
                .trim_end_matches("kB")
                .trim()
                .parse::<f64>()
                .ok()
        })
        .map_or(0.0, |kb| kb / 1024.0)
}

/// Renderiza cada página (no cacheada) a `scale` y devuelve los tiempos.
fn render_times(engine: &Engine, path: &std::path::Path, pages: &[u32], scale: f64) -> Vec<f64> {
    pages
        .iter()
        .map(|page| {
            let started = Instant::now();
            engine
                .page_jpeg(BOOK, path, *page, scale)
                .expect("render a page");
            ms(started.elapsed())
        })
        .collect()
}

/// Carga media del sistema al empezar (1 minuto): sirve para juzgar el ruido de las medidas.
fn load_average() -> String {
    std::fs::read_to_string("/proc/loadavg")
        .unwrap_or_default()
        .split_whitespace()
        .next()
        .unwrap_or("?")
        .to_owned()
}

/// Lanza una búsqueda y marca `running` hasta su `search://done`. Devuelve el receptor de sus eventos.
fn start_background_search(
    engine: &Engine,
    path: &std::path::Path,
    query: &str,
    running: &Arc<AtomicBool>,
) -> mpsc::Receiver<SearchEvent> {
    let (tx, rx) = mpsc::channel();
    running.store(true, Ordering::SeqCst);
    let flag = Arc::clone(running);
    engine
        .start_search(BOOK, path, query, move |event| {
            if matches!(event, SearchEvent::Done(_)) {
                flag.store(false, Ordering::SeqCst);
            }
            let _ = tx.send(event);
        })
        .expect("start a background search");
    rx
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(book) = args.first() else {
        eprintln!("uso: text_bench <libro.pdf> [consulta]");
        std::process::exit(2);
    };
    let query = args.get(1).map_or("dios", String::as_str);
    let path = PathBuf::from(book);
    let engine = Engine::new(EngineConfig::default());

    let started = Instant::now();
    let info = engine.document_info(BOOK, &path).expect("open the book");
    let pages = info.page_count;
    println!(
        "libro: {pages} páginas; abrir (geometría): {:.0} ms; RSS {:.0} MB",
        ms(started.elapsed()),
        rss_mb()
    );

    // Texto y enlaces: muestra repartida por el libro (la primera llamada abre el libro en el hilo de lectura).
    let started = Instant::now();
    engine
        .read_document(BOOK, &path, |document| text::page_words(document, 1))
        .expect("text");
    println!(
        "primera página de texto (abre el libro en el hilo de lectura): {:.0} ms",
        ms(started.elapsed())
    );
    let sample: Vec<u32> = (0..SAMPLE_PAGES)
        .map(|index| 1 + index * (pages.max(2) - 1) / (SAMPLE_PAGES - 1))
        .collect();
    let mut text_ms = Vec::new();
    let mut link_ms = Vec::new();
    let (mut words, mut links_found) = (0_usize, 0_usize);
    for &page in &sample {
        let started = Instant::now();
        let page_words = engine
            .read_document(BOOK, &path, move |document| {
                text::page_words(document, page)
            })
            .expect("text of a page");
        text_ms.push(ms(started.elapsed()));
        words += page_words.len();

        let started = Instant::now();
        let page_links = engine
            .read_document(BOOK, &path, move |document| {
                links::page_links(document, page)
            })
            .expect("links of a page");
        link_ms.push(ms(started.elapsed()));
        links_found += page_links.len();
    }
    println!("| Operación | Muestras | Media | Mediana | p95 | Máx. (ms) |");
    println!("|---|---|---|---|---|---|");
    print_row(
        "get_page_text (página)",
        text_ms.len(),
        summary(text_ms.clone()),
    );
    print_row(
        "get_page_links (página)",
        link_ms.len(),
        summary(link_ms.clone()),
    );
    println!(
        "{} palabras y {links_found} enlaces en las {} páginas de la muestra",
        words,
        sample.len()
    );

    let started = Instant::now();
    let items = engine
        .read_document(BOOK, &path, outline::outline)
        .expect("outline");
    fn count(items: &[outline::OutlineItem]) -> usize {
        items.iter().map(|item| 1 + count(&item.children)).sum()
    }
    println!(
        "índice: {} marcadores de primer nivel, {} en total, {:.0} ms",
        items.len(),
        count(&items),
        ms(started.elapsed())
    );

    // Búsqueda completa: tiempo hasta el primer resultado y hasta `search://done`.
    let (tx, rx) = mpsc::channel();
    let started = Instant::now();
    engine
        .start_search(BOOK, &path, query, move |event| {
            let _ = tx.send((Instant::now(), event));
        })
        .expect("start the search");
    let mut first_result: Option<Duration> = None;
    let (total, pages_searched, search_ms) = loop {
        let (at, event) = rx
            .recv_timeout(Duration::from_secs(900))
            .expect("the search finishes");
        match event {
            SearchEvent::Progress(_) => {
                first_result.get_or_insert(at.duration_since(started));
            }
            SearchEvent::Done(done) => {
                assert!(done.error.is_none(), "{:?}", done.error);
                break (
                    done.total,
                    done.pages_searched,
                    ms(at.duration_since(started)),
                );
            }
        }
    };
    println!(
        "búsqueda «{query}»: {total} coincidencias en {pages_searched} páginas; primer resultado a {:.0} ms; \
         total {:.0} ms ({:.1} ms por página)",
        first_result.map_or(0.0, ms),
        search_ms,
        search_ms / f64::from(pages_searched.max(1))
    );

    // Efecto de la búsqueda sobre el render: las mismas páginas en reposo y con búsquedas corriendo todo el rato
    // (cuando una termina se lanza otra). Las páginas están separadas 10 (la precarga cubre ±2).
    let idle_pages: Vec<u32> = (0..RENDER_SAMPLES)
        .map(|index| 3 + index * 10)
        .filter(|page| *page + 5 <= pages)
        .collect();
    let busy_pages: Vec<u32> = idle_pages.iter().map(|page| page + 5).collect();
    println!(
        "RSS tras texto, índice y búsqueda: {:.0} MB; carga del sistema (1 min): {}",
        rss_mb(),
        load_average()
    );
    let idle = render_times(&engine, &path, &idle_pages, 1.0);

    let running = Arc::new(AtomicBool::new(false));
    let mut search_rx = start_background_search(&engine, &path, query, &running);
    let mut busy = Vec::new();
    let mut during = 0_usize;
    for page in &busy_pages {
        if !running.load(Ordering::SeqCst) {
            search_rx = start_background_search(&engine, &path, query, &running);
        }
        let was_running = running.load(Ordering::SeqCst);
        let started = Instant::now();
        engine
            .page_jpeg(BOOK, &path, *page, 1.0)
            .expect("render during the search");
        busy.push(ms(started.elapsed()));
        if was_running {
            during += 1;
        }
    }
    while let Ok(event) = search_rx.recv_timeout(Duration::from_secs(900)) {
        if matches!(event, SearchEvent::Done(_)) {
            break;
        }
    }
    // Control: las mismas páginas a otra escala (otra clave de caché) en reposo, después de la fase con búsqueda.
    let after = render_times(&engine, &path, &idle_pages, 1.01);
    println!("carga del sistema (1 min) al final: {}", load_average());
    println!("| Render (página no cacheada) | Muestras | Media | Mediana | p95 | Máx. (ms) |");
    println!("|---|---|---|---|---|---|");
    print_row("en reposo, escala 1", idle.len(), summary(idle.clone()));
    print_row(
        &format!(
            "con búsqueda en curso, escala 1 ({during} de {} muestras con ella activa)",
            busy.len()
        ),
        busy.len(),
        summary(busy.clone()),
    );
    print_row(
        "en reposo, escala 1,01 (control)",
        after.len(),
        summary(after.clone()),
    );
    println!("RSS al final: {:.0} MB", rss_mb());
}
