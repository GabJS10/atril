//! Banco de pruebas del motor de PDF (fase R1.1). No usa libros del repo: se le pasan rutas.
//!
//!   cargo run --release --example engine_bench -- <libro.pdf> [<libro.pdf> ...]
//!
//! Por cada libro imprime una fila de tabla en Markdown con (ms): apertura del documento, `open_document`
//! (geometría de todas las páginas), primera página a escala 1 y 2 (en frío), la misma otra vez sin pasar por
//! la caché de JPEG (MuPDF ya caliente), una página central en frío y en caliente, tamaño del JPEG y memoria
//! (RSS). Después simula una lectura (una página nueva cada 400 ms) para ver el efecto de la precarga, y
//! comprueba que la geometría coincide con la de MuPDF en una muestra de páginas.
//!
//! Con `ENGINE_BENCH_THREADS=n` se cambia el número de hilos de la sección de lectura (por defecto 2).
//! Con `ENGINE_BENCH_SAVE=<carpeta>` guarda además unas páginas como JPEG a escala 1,5 para mirarlas
//! (`ENGINE_BENCH_PAGES=1,50,200` elige cuáles; por defecto la primera y la central): sirve para comprobar
//! a ojo los glifos de las fuentes no incrustadas.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use atril_lib::engine::{Engine, EngineConfig, EngineError};

const BOOK: &str = "bench";

fn ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

/// (RSS actual, pico) en MB, de /proc/self/status.
fn memory_mb() -> (f64, f64) {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    let read = |name: &str| {
        status
            .lines()
            .find_map(|line| line.strip_prefix(name))
            .and_then(|rest| {
                rest.trim()
                    .trim_end_matches("kB")
                    .trim()
                    .parse::<f64>()
                    .ok()
            })
            .map_or(0.0, |kb| kb / 1024.0)
    };
    (read("VmRSS:"), read("VmHWM:"))
}

struct Row {
    name: String,
    pages: u32,
    open: f64,
    info: f64,
    first_1: f64,
    first_2: f64,
    first_hot: f64,
    mid_cold: f64,
    mid_hot: f64,
    jpeg_kb: f64,
    rss: f64,
    peak: f64,
}

fn single(path: &Path, name: &str) -> Result<Row, EngineError> {
    // Un solo hilo: así «en frío» es de verdad (el documento se abre una vez, en el hilo que atiende).
    let engine = Engine::new(EngineConfig {
        threads: 1,
        ..EngineConfig::default()
    });
    let t = Instant::now();
    engine.with_document(BOOK, path, |_| Ok(()))?;
    let open = ms(t.elapsed());
    let t = Instant::now();
    let info = engine.document_info(BOOK, path)?;
    let info_ms = ms(t.elapsed());
    let pages = info.page_count;

    let timed = |page: u32, scale: f64| -> Result<(f64, usize), EngineError> {
        let t = Instant::now();
        let jpeg = engine.page_jpeg(BOOK, path, page, scale)?;
        Ok((ms(t.elapsed()), jpeg.len()))
    };
    // Render sin pasar por la caché de JPEG (MuPDF ya tiene fuentes e imágenes en su caché).
    let hot = |page: u32, scale: f64| -> Result<f64, EngineError> {
        engine.with_document(BOOK, path, move |document| {
            let t = Instant::now();
            document.render_jpeg(page, scale)?;
            Ok(ms(t.elapsed()))
        })
    };

    let (first_1, bytes) = timed(1, 1.0)?;
    let (first_2, _) = timed(1, 2.0)?;
    let first_hot = hot(1, 1.0)?;
    let middle = pages / 2 + 1;
    let (mid_cold, _) = timed(middle, 1.0)?;
    let mid_hot = hot(middle, 1.0)?;
    let (rss, peak) = memory_mb();
    Ok(Row {
        name: name.to_owned(),
        pages,
        open,
        info: info_ms,
        first_1,
        first_2,
        first_hot,
        mid_cold,
        mid_hot,
        jpeg_kb: bytes as f64 / 1024.0,
        rss,
        peak,
    })
}

/// Lectura simulada: una página nueva cada 400 ms desde la central. Devuelve latencias (ms).
fn reading(path: &Path, threads: usize) -> Result<Vec<f64>, EngineError> {
    let engine = Engine::new(EngineConfig {
        threads,
        ..EngineConfig::default()
    });
    let info = engine.document_info(BOOK, path)?;
    let start = info.page_count / 2 + 1;
    let last = (start + 9).min(info.page_count);
    let mut latencies = Vec::new();
    for page in start..=last {
        let t = Instant::now();
        engine.page_jpeg(BOOK, path, page, 1.0)?;
        latencies.push(ms(t.elapsed()));
        std::thread::sleep(Duration::from_millis(400));
    }
    Ok(latencies)
}

/// Compara la geometría con la de MuPDF en unas 40 páginas repartidas. Devuelve (comprobadas, distintas).
fn geometry_check(path: &Path) -> Result<(usize, Vec<String>), EngineError> {
    let engine = Engine::new(EngineConfig {
        threads: 1,
        ..EngineConfig::default()
    });
    let info = engine.document_info(BOOK, path)?;
    let count = info.page_count as usize;
    let step = (count / 40).max(1);
    let pages: Vec<usize> = (0..count).step_by(step).collect();
    let checked = pages.len();
    let info2 = info.clone();
    let mismatches = engine.with_document(BOOK, path, move |document| {
        let mut bad = Vec::new();
        for &index in &pages {
            let (width, height) = document.native_size(index as u32 + 1)?;
            let ours = &info2.pages[index];
            if (ours.width - width).abs() > 0.5 || (ours.height - height).abs() > 0.5 {
                bad.push(format!(
                    "p{}: {}x{} vs MuPDF {width}x{height}",
                    index + 1,
                    ours.width,
                    ours.height
                ));
            }
        }
        Ok(bad)
    })?;
    Ok((checked, mismatches))
}

/// Guarda páginas como `<carpeta>/<libro>-p<N>.jpg`.
fn save_pages(path: &Path, dir: &Path, pages: &[u32]) -> Result<Vec<PathBuf>, EngineError> {
    std::fs::create_dir_all(dir).map_err(|error| EngineError::Io(error.to_string()))?;
    let engine = Engine::new(EngineConfig::default());
    let info = engine.document_info(BOOK, path)?;
    let stem: String = short_name(path)
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let mut saved = Vec::new();
    let chosen: Vec<u32> = if pages.is_empty() {
        vec![1, info.page_count / 2 + 1]
    } else {
        pages.to_vec()
    };
    for page in chosen {
        if page == 0 || page > info.page_count {
            continue;
        }
        let jpeg = engine.page_jpeg(BOOK, path, page, 1.5)?;
        let target = dir.join(format!("{stem}-p{page}.jpg"));
        std::fs::write(&target, jpeg.as_slice())
            .map_err(|error| EngineError::Io(error.to_string()))?;
        saved.push(target);
    }
    Ok(saved)
}

fn short_name(path: &Path) -> String {
    let name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let chars: Vec<char> = name.chars().collect();
    if chars.len() <= 40 {
        name
    } else {
        // Principio y final: los volúmenes de una misma obra solo se distinguen al final.
        let head: String = chars[..24].iter().collect();
        let tail: String = chars[chars.len() - 14..].iter().collect();
        format!("{head}..{tail}")
    }
}

fn main() {
    let paths: Vec<PathBuf> = std::env::args().skip(1).map(PathBuf::from).collect();
    if paths.is_empty() {
        eprintln!("usage: engine_bench <book.pdf> [<book.pdf> ...]");
        std::process::exit(2);
    }
    let threads: usize = std::env::var("ENGINE_BENCH_THREADS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(2);

    println!(
        "| Book | Pages | open | open_document | p1 @1 cold | p1 @2 cold | p1 @1 hot | mid @1 cold | mid @1 hot | JPEG KB | RSS MB (peak) |"
    );
    println!("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    let mut details = Vec::new();
    for path in &paths {
        let name = short_name(path);
        match single(path, &name) {
            Ok(row) => println!(
                "| {} | {} | {:.0} | {:.0} | {:.0} | {:.0} | {:.0} | {:.0} | {:.0} | {:.0} | {:.0} ({:.0}) |",
                row.name,
                row.pages,
                row.open,
                row.info,
                row.first_1,
                row.first_2,
                row.first_hot,
                row.mid_cold,
                row.mid_hot,
                row.jpeg_kb,
                row.rss,
                row.peak
            ),
            Err(error) => println!("| {name} | error: {error} |"),
        }
        let reading = reading(path, threads).map(|latencies| {
            let avg = latencies.iter().sum::<f64>() / latencies.len().max(1) as f64;
            let max = latencies.iter().copied().fold(0.0, f64::max);
            format!(
                "reading with {threads} threads (1 page / 400 ms): avg {avg:.0} ms, max {max:.0} ms"
            )
        });
        let geometry = geometry_check(path).map(|(checked, bad)| {
            if bad.is_empty() {
                format!("geometry: {checked} pages checked against MuPDF, all equal")
            } else {
                format!(
                    "geometry: {} of {checked} differ: {}",
                    bad.len(),
                    bad.join("; ")
                )
            }
        });
        details.push(format!(
            "{name}: {}; {}",
            reading.unwrap_or_else(|error| format!("reading failed: {error}")),
            geometry.unwrap_or_else(|error| format!("geometry check failed: {error}"))
        ));
    }
    println!();
    for line in details {
        println!("{line}");
    }

    if let Some(dir) = std::env::var_os("ENGINE_BENCH_SAVE") {
        let pages: Vec<u32> = std::env::var("ENGINE_BENCH_PAGES")
            .map(|list| {
                list.split(',')
                    .filter_map(|n| n.trim().parse().ok())
                    .collect()
            })
            .unwrap_or_default();
        for path in &paths {
            match save_pages(path, Path::new(&dir), &pages) {
                Ok(saved) => saved
                    .iter()
                    .for_each(|target| println!("saved {}", target.display())),
                Err(error) => println!("could not save pages of {}: {error}", path.display()),
            }
        }
    }
}
