//! Bench de MuPDF (crate `mupdf` 0.8.0, enlace estático) para el spike R0.1.
//!
//! Una ejecución = un libro y una repetición, en un proceso nuevo (así el primer render
//! es realmente «en frío» para el proceso). Imprime registros JSON en stdout.
//!
//! Uso: bench-mupdf --file <pdf> --book <id> --run <n> [--sweep] [--search <texto>]
//!                  [--samples <dir>] [--parallel <k>] [--only-parallel]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use engines_spike::common::{self as c, ms, Ctx};
use mupdf::{Colorspace, Document, Matrix, Pixmap, TextPageFlags};
use serde_json::json;

const WIDTHS: [u32; 2] = [1240, 2480];
const SWEEP_WIDTH: u32 = 300;
const PARALLEL_THREADS: usize = 4;
const PARALLEL_WIDTH: u32 = 1240;

struct Args {
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
    if a.file.as_os_str().is_empty() {
        return Err(anyhow!("hace falta --file"));
    }
    Ok(a)
}

/// Renderiza una página a `width_px` de ancho en RGB (sin alfa, con anotaciones).
/// Devuelve el pixmap y los tiempos de carga de página y de render por separado.
fn render(
    doc: &Document,
    cs: &Colorspace,
    idx: i32,
    width_px: u32,
) -> Result<(Pixmap, Duration, Duration)> {
    let t0 = Instant::now();
    let page = doc.load_page(idx)?;
    let t_load = t0.elapsed();
    let bounds = page.bounds()?;
    let s = c::scale_for_width(bounds.width(), width_px);
    let t1 = Instant::now();
    let pix = page.to_pixmap(&Matrix::new_scale(s, s), cs, false, true)?;
    let t_render = t1.elapsed();
    Ok((pix, t_load, t_render))
}

fn frame_ratio(pix: &Pixmap) -> f64 {
    c::nonwhite_ratio(
        pix.samples(),
        pix.width() as usize,
        pix.height() as usize,
        pix.stride() as usize,
        pix.n() as usize,
    )
}

fn main() -> Result<()> {
    let a = parse_args()?;
    let ctx = Ctx {
        engine: "mupdf",
        book: a.book.clone(),
        run: a.run,
    };
    let t_proc = Instant::now();

    // 1. Apertura del documento.
    let t = Instant::now();
    let doc = match Document::open(a.file.as_path()) {
        Ok(d) => d,
        Err(e) => {
            ctx.rec("open", json!({"ok": false, "error": e.to_string()}));
            return Ok(());
        }
    };
    let t_open = t.elapsed();
    ctx.rec("open", json!({"ok": true, "ms": ms(t_open)}));
    let cs = Colorspace::device_rgb();

    if a.only_parallel {
        if a.parallel == 0 {
            return Err(anyhow!("--only-parallel necesita --parallel <k>"));
        }
        run_parallel(&ctx, &a.file, &doc, a.parallel)?;
        ctx.rec("done", json!({"ms_total": ms(t_proc.elapsed())}));
        return Ok(());
    }

    let n = doc.page_count()? as usize;
    if n == 0 {
        ctx.rec(
            "pages",
            json!({"n": 0, "ms": 0.0, "errors": 0, "sizes": []}),
        );
        ctx.rec("done", json!({"ms_total": ms(t_proc.elapsed())}));
        return Ok(());
    }

    // 2. Número de páginas y tamaño de todas (carga cada página para leer sus límites).
    let t = Instant::now();
    let mut sizes = Vec::with_capacity(n);
    let mut size_errors = 0usize;
    for i in 0..n {
        match doc.load_page(i as i32).and_then(|p| p.bounds()) {
            Ok(b) => sizes.push([round2(b.width()), round2(b.height())]),
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
                match render(&doc, &cs, p as i32, width) {
                    Ok((pix, t_load, t_render)) => {
                        let ratio = frame_ratio(&pix);
                        ctx.rec(
                            "render",
                            json!({
                                "pass": pass, "width": width, "page": p, "ok": true,
                                "ms": ms(t_load + t_render), "ms_load": ms(t_load), "ms_render": ms(t_render),
                                "w_px": pix.width(), "h_px": pix.height(), "nonwhite": round4(ratio),
                                "raw_bytes": pix.samples().len(),
                            }),
                        );
                        // Codificación: solo en la primera vez, para la primera página y la central.
                        if pass == "first" && enc_pages.contains(&p) {
                            encode_costs(&ctx, &pix, width, p);
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

    // 5. Búsqueda (solo si se pide): MuPDF search por página y recuento de referencia en el texto.
    if let Some(term) = &a.search {
        let t = Instant::now();
        let mut hits = 0usize;
        let mut pages_hit = 0usize;
        let mut search_errors = 0usize;
        for i in 0..n {
            match doc.load_page(i as i32).and_then(|p| p.search(term, 1000)) {
                Ok(quads) => {
                    hits += quads.len();
                    if !quads.is_empty() {
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
            match render(&doc, &cs, i as i32, SWEEP_WIDTH) {
                Ok((pix, _, _)) => ratios.push(round4(frame_ratio(&pix))),
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
            if let Ok((pix, _, _)) = render(&doc, &cs, p as i32, 1240) {
                let rgb = c::pack_rgb(
                    pix.samples(),
                    pix.width() as usize,
                    pix.height() as usize,
                    pix.stride() as usize,
                    pix.n() as usize,
                    false,
                );
                let png = c::encode_png(&rgb, pix.width(), pix.height())?;
                let file = dir.join(format!("mupdf-{}-p{:04}-w1240.png", a.book, p));
                std::fs::write(&file, png)?;
            }
        }
    }

    ctx.rec("done", json!({"ms_total": ms(t_proc.elapsed())}));
    Ok(())
}

/// Codifica la imagen a JPEG q85 y a BMP y registra los tiempos (sin contar el empaquetado,
/// que se registra aparte).
fn encode_costs(ctx: &Ctx, pix: &Pixmap, width: u32, page: usize) {
    let (w, h) = (pix.width(), pix.height());
    let t = Instant::now();
    let rgb = c::pack_rgb(
        pix.samples(),
        w as usize,
        h as usize,
        pix.stride() as usize,
        pix.n() as usize,
        false,
    );
    let pack = t.elapsed();
    let t = Instant::now();
    let jpeg = c::encode_jpeg85(&rgb, w, h);
    let jpeg_t = t.elapsed();
    let t = Instant::now();
    let bmp = c::encode_bmp(&rgb, w, h);
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
fn extract_text(doc: &Document, idx: i32, keep: bool) -> Result<(usize, String)> {
    let page = doc.load_page(idx)?;
    let tp = page.to_text_page(TextPageFlags::empty())?;
    let mut count = 0usize;
    let mut text = String::new();
    for block in tp.blocks() {
        for line in block.lines() {
            for ch in line.chars() {
                let _rect = ch.quad();
                if let Some(cc) = ch.char() {
                    count += 1;
                    if keep {
                        text.push(cc);
                    }
                }
            }
        }
        if keep {
            text.push('\n');
        }
    }
    Ok((count, text))
}

/// Prueba en paralelo: secuencial (tras calentar) frente a 4 hilos, cada uno con su documento.
fn run_parallel(ctx: &Ctx, path: &Path, doc: &Document, k: usize) -> Result<()> {
    let n = doc.page_count()? as usize;
    let pages = c::spread_pages(n, k.max(1));
    let cs = Colorspace::device_rgb();

    // Calentamiento (no se cronometra) para que fuentes e imágenes estén en caché.
    for &p in &pages {
        render(doc, &cs, p as i32, PARALLEL_WIDTH)?;
    }
    let t = Instant::now();
    for &p in &pages {
        render(doc, &cs, p as i32, PARALLEL_WIDTH)?;
    }
    let t_seq = t.elapsed();

    // Cuatro hilos; cada uno abre su propio documento (MuPDF usa un contexto por hilo).
    let barrier = Arc::new(Barrier::new(PARALLEL_THREADS + 1));
    let pages_arc = Arc::new(pages.clone());
    let mut handles = Vec::new();
    for tid in 0..PARALLEL_THREADS {
        let barrier = Arc::clone(&barrier);
        let pages = Arc::clone(&pages_arc);
        let path = path.to_path_buf();
        handles.push(std::thread::spawn(move || -> Result<usize> {
            let doc = Document::open(path.as_path())?;
            let cs = Colorspace::device_rgb();
            barrier.wait();
            let mut done = 0usize;
            for (j, &p) in pages.iter().enumerate() {
                if j % PARALLEL_THREADS == tid {
                    render(&doc, &cs, p as i32, PARALLEL_WIDTH)?;
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

    ctx.rec(
        "parallel",
        json!({
            "k": pages.len(), "threads": PARALLEL_THREADS, "width": PARALLEL_WIDTH,
            "rendered": rendered,
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
