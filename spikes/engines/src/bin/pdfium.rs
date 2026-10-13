//! Bench de PDFium (crate `pdfium-render` 0.9.4 con libpdfium 157.0.8100 de bblanchon,
//! cargada en tiempo de ejecución) para el spike R0.1.
//!
//! Mismo diseño que `mupdf.rs`: una ejecución = un libro y una repetición, en un proceso
//! nuevo, con registros JSON en stdout y los mismos nombres de campos.
//!
//! Uso: bench-pdfium --lib <libpdfium.so> --file <pdf> --book <id> --run <n> [--sweep]
//!                   [--search <texto>] [--samples <dir>] [--parallel <k>] [--only-parallel]

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use engines_spike::common::{self as c, ms, Ctx};
use pdfium_render::prelude::*;
use serde_json::json;

const WIDTHS: [i32; 2] = [1240, 2480];
const SWEEP_WIDTH: i32 = 300;
const PARALLEL_THREADS: usize = 4;
const PARALLEL_WIDTH: i32 = 1240;

struct Args {
    lib: PathBuf,
    file: PathBuf,
    book: String,
    run: u32,
    sweep: bool,
    search: Option<String>,
    samples: Option<PathBuf>,
    parallel: usize,
    only_parallel: bool,
}

fn parse_args() -> Result<Args> {
    let mut a = Args {
        lib: PathBuf::new(),
        file: PathBuf::new(),
        book: String::new(),
        run: 1,
        sweep: false,
        search: None,
        samples: None,
        parallel: 0,
        only_parallel: false,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        match flag.as_str() {
            "--lib" => a.lib = PathBuf::from(it.next().ok_or_else(|| anyhow!("falta --lib"))?),
            "--file" => a.file = PathBuf::from(it.next().ok_or_else(|| anyhow!("falta --file"))?),
            "--book" => a.book = it.next().ok_or_else(|| anyhow!("falta --book"))?,
            "--run" => a.run = it.next().ok_or_else(|| anyhow!("falta --run"))?.parse()?,
            "--sweep" => a.sweep = true,
            "--search" => a.search = Some(it.next().ok_or_else(|| anyhow!("falta --search"))?),
            "--samples" => {
                a.samples = Some(PathBuf::from(
                    it.next().ok_or_else(|| anyhow!("falta --samples"))?,
                ))
            }
            "--parallel" => {
                a.parallel = it
                    .next()
                    .ok_or_else(|| anyhow!("falta --parallel"))?
                    .parse()?
            }
            "--only-parallel" => a.only_parallel = true,
            other => return Err(anyhow!("argumento desconocido: {other}")),
        }
    }
    if a.file.as_os_str().is_empty() || a.lib.as_os_str().is_empty() {
        return Err(anyhow!("hacen falta --lib y --file"));
    }
    Ok(a)
}

fn render_config(width: i32) -> PdfRenderConfig {
    PdfRenderConfig::new()
        .set_target_width(width)
        .render_annotations(true)
}

/// Imagen renderizada: RGBA normalizado (as_rgba_bytes) con su propio buffer (la fila puede llevar relleno, por eso
/// el stride sale de la longitud del buffer).
struct Frame {
    w: usize,
    h: usize,
    stride: usize,
    buf: Vec<u8>,
}

/// Renderiza una página a `width_px` de ancho. Devuelve el frame y los tiempos de carga de
/// página y de render por separado (la copia del buffer queda fuera de ambos tiempos).
fn render(doc: &PdfDocument<'_>, idx: i32, width_px: i32) -> Result<(Frame, Duration, Duration)> {
    let t0 = Instant::now();
    let page = doc.pages().get(idx)?;
    let t_load = t0.elapsed();
    let t1 = Instant::now();
    let bmp = page.render_with_config(&render_config(width_px))?;
    let t_render = t1.elapsed();
    let (w, h) = (bmp.width() as usize, bmp.height() as usize);
    let buf = bmp.as_rgba_bytes();
    let stride = if h > 0 { buf.len() / h } else { 0 };
    Ok((Frame { w, h, stride, buf }, t_load, t_render))
}

fn main() -> Result<()> {
    let a = parse_args()?;
    let ctx = Ctx {
        engine: "pdfium",
        book: a.book.clone(),
        run: a.run,
    };
    let t_proc = Instant::now();

    let t = Instant::now();
    let bindings = match Pdfium::bind_to_library(&a.lib) {
        Ok(b) => b,
        Err(e) => {
            ctx.rec("open", json!({"ok": false, "error": format!("bind: {e}")}));
            return Ok(());
        }
    };
    let pdfium = Pdfium::new(bindings);
    ctx.rec("bind", json!({"ms": ms(t.elapsed())}));

    // 1. Apertura del documento.
    let t = Instant::now();
    let doc = match pdfium.load_pdf_from_file(a.file.as_path(), None) {
        Ok(d) => d,
        Err(e) => {
            ctx.rec("open", json!({"ok": false, "error": e.to_string()}));
            return Ok(());
        }
    };
    ctx.rec("open", json!({"ok": true, "ms": ms(t.elapsed())}));

    if a.only_parallel {
        if a.parallel == 0 {
            return Err(anyhow!("--only-parallel necesita --parallel <k>"));
        }
        run_parallel(&ctx, &pdfium, &a.file, &doc, a.parallel)?;
        ctx.rec("done", json!({"ms_total": ms(t_proc.elapsed())}));
        return Ok(());
    }

    let n = doc.pages().len() as usize;
    if n == 0 {
        ctx.rec(
            "pages",
            json!({"n": 0, "ms": 0.0, "errors": 0, "sizes": []}),
        );
        ctx.rec("done", json!({"ms_total": ms(t_proc.elapsed())}));
        return Ok(());
    }

    // 2. Número de páginas y tamaño de todas.
    let t = Instant::now();
    let mut sizes = Vec::with_capacity(n);
    let mut size_errors = 0usize;
    for i in 0..n {
        match doc.pages().get(i as i32) {
            Ok(p) => sizes.push([round2(p.width().value), round2(p.height().value)]),
            Err(_) => {
                size_errors += 1;
                sizes.push([0.0, 0.0]);
            }
        }
    }
    ctx.rec(
        "pages",
        json!({"n": n, "ms": ms(t.elapsed()), "errors": size_errors, "sizes": sizes}),
    );

    // 3. Render: primera, central y 5 seguidas; a 1240 y 2480 px.
    //    Orden: 1240 primera vez (todas), 1240 segunda vez, 2480 primera, 2480 segunda.
    let pages = c::render_pages(n);
    let enc_pages = [pages[0], pages[1.min(pages.len() - 1)]];
    for width in WIDTHS {
        for pass in ["first", "second"] {
            for &p in &pages {
                match render(&doc, p as i32, width) {
                    Ok((f, t_load, t_render)) => {
                        let ratio = c::nonwhite_ratio(&f.buf, f.w, f.h, f.stride, 4);
                        ctx.rec(
                            "render",
                            json!({
                                "pass": pass, "width": width, "page": p, "ok": true,
                                "ms": ms(t_load + t_render), "ms_load": ms(t_load), "ms_render": ms(t_render),
                                "w_px": f.w, "h_px": f.h, "nonwhite": round4(ratio),
                                "raw_bytes": f.buf.len(),
                            }),
                        );
                        if pass == "first" && enc_pages.contains(&p) {
                            encode_costs(&ctx, &f, width, p);
                        }
                    }
                    Err(e) => ctx.rec(
                        "render",
                        json!({"pass": pass, "width": width, "page": p, "ok": false, "error": e.to_string()}),
                    ),
                }
            }
        }
    }

    // 4. Extracción de texto con cajas (un rectángulo por carácter), todas las páginas.
    let want_text = a.search.is_some();
    let mut per_page_ms = Vec::with_capacity(n);
    let mut chars_total = 0usize;
    let mut pages_with_text = 0usize;
    let mut text_errors = 0usize;
    let mut page_texts: Vec<String> = Vec::new();
    let t_text = Instant::now();
    for i in 0..n {
        let t = Instant::now();
        let r = extract_text(&doc, i as i32, want_text);
        per_page_ms.push(ms(t.elapsed()));
        match r {
            Ok((count, text)) => {
                chars_total += count;
                if count > 0 {
                    pages_with_text += 1;
                }
                if want_text {
                    page_texts.push(text);
                }
            }
            Err(_) => {
                text_errors += 1;
                if want_text {
                    page_texts.push(String::new());
                }
            }
        }
    }
    ctx.rec(
        "text",
        json!({
            "ms_total": ms(t_text.elapsed()), "pages": n, "pages_with_text": pages_with_text,
            "chars": chars_total, "errors": text_errors, "per_page_ms": per_page_ms,
        }),
    );

    // 5. Búsqueda (solo si se pide): PDFium search (sin distinguir mayúsculas, sin palabra completa).
    if let Some(term) = &a.search {
        let t = Instant::now();
        let mut hits = 0usize;
        let mut pages_hit = 0usize;
        let mut search_errors = 0usize;
        let opts = PdfSearchOptions::new()
            .match_case(false)
            .match_whole_word(false);
        for i in 0..n {
            let r = (|| -> Result<usize> {
                let page = doc.pages().get(i as i32)?;
                let tp = page.text()?;
                let found = tp.search(term, &opts)?;
                Ok(found.iter(PdfSearchDirection::SearchForward).count())
            })();
            match r {
                Ok(count) => {
                    hits += count;
                    if count > 0 {
                        pages_hit += 1;
                    }
                }
                Err(_) => search_errors += 1,
            }
        }
        let t_search = ms(t.elapsed());
        let term_lc = term.to_lowercase();
        let ref_count: usize = page_texts
            .iter()
            .map(|s| s.to_lowercase().matches(&term_lc).count())
            .sum();
        ctx.rec(
            "search",
            json!({
                "term": term, "hits": hits, "pages_hit": pages_hit, "errors": search_errors,
                "ms_total": t_search, "ref_count_text": ref_count,
            }),
        );
    }

    // 6. Barrido de todas las páginas a ancho bajo: errores y páginas en blanco.
    if a.sweep {
        let t = Instant::now();
        let mut ratios = Vec::with_capacity(n);
        let mut errors = Vec::new();
        for i in 0..n {
            match render(&doc, i as i32, SWEEP_WIDTH) {
                Ok((f, _, _)) => {
                    ratios.push(round4(c::nonwhite_ratio(&f.buf, f.w, f.h, f.stride, 4)))
                }
                Err(e) => {
                    errors.push(json!({"page": i, "error": e.to_string()}));
                    ratios.push(-1.0);
                }
            }
        }
        let blank: Vec<usize> = ratios
            .iter()
            .enumerate()
            .filter(|(_, r)| **r >= 0.0 && **r < 0.0005)
            .map(|(i, _)| i)
            .collect();
        ctx.rec(
            "sweep",
            json!({
                "width": SWEEP_WIDTH, "ms_total": ms(t.elapsed()), "pages": n,
                "errors": errors, "blank": blank, "ratios": ratios,
            }),
        );
    }

    // 7. Muestras PNG (para comparar a ojo): página primera y central a 1240 px.
    if let Some(dir) = &a.samples {
        for p in enc_pages {
            if let Ok((f, _, _)) = render(&doc, p as i32, 1240) {
                let rgb = c::pack_rgb(&f.buf, f.w, f.h, f.stride, 4, false);
                let png = c::encode_png(&rgb, f.w as u32, f.h as u32)?;
                let file = dir.join(format!("pdfium-{}-p{:04}-w1240.png", a.book, p));
                std::fs::write(&file, png)?;
            }
        }
    }

    ctx.rec("done", json!({"ms_total": ms(t_proc.elapsed())}));
    Ok(())
}

/// Codifica el bitmap BGRA a JPEG q85 y a BMP y registra los tiempos (el empaquetado a RGB
/// se registra aparte, porque PDFium entrega RGBA y MuPDF RGB).
fn encode_costs(ctx: &Ctx, f: &Frame, width: i32, page: usize) {
    let (w, h) = (f.w, f.h);
    let t = Instant::now();
    let rgb = c::pack_rgb(&f.buf, w, h, f.stride, 4, false);
    let pack = t.elapsed();
    let t = Instant::now();
    let jpeg = c::encode_jpeg85(&rgb, w as u32, h as u32);
    let jpeg_t = t.elapsed();
    let t = Instant::now();
    let bmp = c::encode_bmp(&rgb, w as u32, h as u32);
    let bmp_t = t.elapsed();
    ctx.rec(
        "encode",
        json!({
            "width": width, "page": page, "w_px": w, "h_px": h,
            "pack_ms": ms(pack),
            "jpeg85_ms": ms(jpeg_t), "jpeg85_bytes": jpeg.as_ref().map(|v| v.len()).unwrap_or(0),
            "jpeg85_ok": jpeg.is_ok(),
            "bmp_ms": ms(bmp_t), "bmp_bytes": bmp.as_ref().map(|v| v.len()).unwrap_or(0),
            "bmp_ok": bmp.is_ok(),
        }),
    );
}

/// Devuelve (número de caracteres con rectángulo, texto de la página si `keep`).
fn extract_text(doc: &PdfDocument<'_>, idx: i32, keep: bool) -> Result<(usize, String)> {
    let page = doc.pages().get(idx)?;
    let tp = page.text()?;
    let mut count = 0usize;
    let mut text = String::new();
    for ch in tp.chars().iter() {
        let _rect = ch.loose_bounds()?;
        if let Some(cc) = ch.unicode_char() {
            count += 1;
            if keep {
                text.push(cc);
            }
        }
    }
    Ok((count, text))
}

/// Prueba en paralelo: secuencial (tras calentar) frente a 4 hilos que comparten el mismo
/// `Pdfium` y abren cada uno su documento. Con `thread_safe`, pdfium-render serializa cada
/// llamada con un mutex global, así que se espera poca o ninguna ganancia.
fn run_parallel(
    ctx: &Ctx,
    pdfium: &Pdfium,
    path: &Path,
    doc: &PdfDocument<'_>,
    k: usize,
) -> Result<()> {
    let n = doc.pages().len() as usize;
    let pages = c::spread_pages(n, k.max(1));

    for &p in &pages {
        render(doc, p as i32, PARALLEL_WIDTH)?;
    }
    let t = Instant::now();
    for &p in &pages {
        render(doc, p as i32, PARALLEL_WIDTH)?;
    }
    let t_seq = t.elapsed();

    let barrier = std::sync::Barrier::new(PARALLEL_THREADS + 1);
    let t_par = std::thread::scope(|s| -> Result<Duration> {
        let mut handles = Vec::new();
        for tid in 0..PARALLEL_THREADS {
            let barrier = &barrier;
            let pages = &pages;
            handles.push(s.spawn(move || -> Result<usize> {
                let tdoc = pdfium.load_pdf_from_file(path, None)?;
                barrier.wait();
                let mut done = 0usize;
                for (j, &p) in pages.iter().enumerate() {
                    if j % PARALLEL_THREADS == tid {
                        render(&tdoc, p as i32, PARALLEL_WIDTH)?;
                        done += 1;
                    }
                }
                Ok(done)
            }));
        }
        barrier.wait();
        let t = Instant::now();
        let mut rendered = 0usize;
        for h in handles {
            rendered += h
                .join()
                .map_err(|_| anyhow!("un hilo ha entrado en pánico"))??;
        }
        let t_par = t.elapsed();
        ctx.rec("parallel_rendered", json!({"rendered": rendered}));
        Ok(t_par)
    })?;

    ctx.rec(
        "parallel",
        json!({
            "k": pages.len(), "threads": PARALLEL_THREADS, "width": PARALLEL_WIDTH,
            "ms_seq": ms(t_seq), "ms_par": ms(t_par),
            "pps_seq": round2_f(pages.len() as f64 / t_seq.as_secs_f64()),
            "pps_par": round2_f(pages.len() as f64 / t_par.as_secs_f64()),
            "speedup": round2_f(t_seq.as_secs_f64() / t_par.as_secs_f64()),
        }),
    );
    Ok(())
}

fn round2(v: f32) -> f32 {
    (v * 100.0).round() / 100.0
}

fn round2_f(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn round4(v: f64) -> f64 {
    (v * 10000.0).round() / 10000.0
}
