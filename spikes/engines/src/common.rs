//! Utilidades compartidas por los dos benchs (MuPDF y PDFium): tiempos, salida JSONL,
//! proporción de píxeles no blancos, empaquetado de píxeles y codificadores JPEG/BMP/PNG.
//!
//! Cada medición se imprime como una línea JSON en stdout; el script `scripts/run_all.sh`
//! las guarda en `out/` y `scripts/aggregate.py` construye las tablas del informe.

use std::io::{self, Write};
use std::time::Duration;

use anyhow::Result;
use image::codecs::bmp::BmpEncoder;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};
use serde_json::{Map, Value};

/// Un canal por debajo de este valor cuenta como píxel «no blanco».
pub const NONWHITE_CHANNEL_MAX: u8 = 250;

/// Milisegundos con 3 decimales.
pub fn ms(d: Duration) -> f64 {
    (d.as_secs_f64() * 1_000_000.0).round() / 1000.0
}

/// Identifica la ejecución: motor, libro (id corto), repetición y pasada.
#[derive(Clone)]
pub struct Ctx {
    pub engine: &'static str,
    pub book: String,
    pub run: u32,
}

impl Ctx {
    /// Emite un registro `{engine, book, run, kind, ...extra}` en una línea JSON.
    pub fn rec(&self, kind: &str, extra: Value) {
        let mut m = Map::new();
        m.insert("engine".into(), self.engine.into());
        m.insert("book".into(), self.book.clone().into());
        m.insert("run".into(), self.run.into());
        m.insert("kind".into(), kind.into());
        if let Value::Object(fields) = extra {
            m.extend(fields);
        }
        let stdout = io::stdout();
        let mut lock = stdout.lock();
        let _ = writeln!(lock, "{}", Value::Object(m));
        let _ = lock.flush();
    }
}

/// Proporción de píxeles con algún canal RGB por debajo de `NONWHITE_CHANNEL_MAX`.
/// `stride` en bytes por fila y `bpp` bytes por píxel (3 para RGB, 4 para BGRA);
/// el alfa (si lo hay) no cuenta y el relleno de fila se ignora.
pub fn nonwhite_ratio(buf: &[u8], w: usize, h: usize, stride: usize, bpp: usize) -> f64 {
    let mut nonwhite = 0usize;
    for y in 0..h {
        let row = &buf[y * stride..y * stride + w * bpp];
        for px in row.chunks_exact(bpp) {
            if px[0] < NONWHITE_CHANNEL_MAX
                || px[1] < NONWHITE_CHANNEL_MAX
                || px[2] < NONWHITE_CHANNEL_MAX
            {
                nonwhite += 1;
            }
        }
    }
    nonwhite as f64 / (w * h).max(1) as f64
}

/// Copia las filas sin relleno a un buffer RGB compacto. `bgr` indica orden BGR(A) de origen.
pub fn pack_rgb(buf: &[u8], w: usize, h: usize, stride: usize, bpp: usize, bgr: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        let row = &buf[y * stride..y * stride + w * bpp];
        for px in row.chunks_exact(bpp) {
            if bgr {
                out.extend_from_slice(&[px[2], px[1], px[0]]);
            } else {
                out.extend_from_slice(&px[..3]);
            }
        }
    }
    out
}

/// JPEG con calidad 85 (codificador de la crate `image`, equivalente a libjpeg-turbo en calidad).
pub fn encode_jpeg85(rgb: &[u8], w: u32, h: u32) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 85).write_image(rgb, w, h, ExtendedColorType::Rgb8)?;
    Ok(out)
}

/// BMP de 24 bits sin compresión.
pub fn encode_bmp(rgb: &[u8], w: u32, h: u32) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    BmpEncoder::new(&mut out).write_image(rgb, w, h, ExtendedColorType::Rgb8)?;
    Ok(out)
}

/// PNG (solo para las muestras que se comparan a ojo; no se cronometra).
pub fn encode_png(rgb: &[u8], w: u32, h: u32) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    PngEncoder::new(&mut out).write_image(rgb, w, h, ExtendedColorType::Rgb8)?;
    Ok(out)
}

/// Escala para que la página ocupe `width_px` píxeles de ancho.
pub fn scale_for_width(page_width_pt: f32, width_px: u32) -> f32 {
    width_px as f32 / page_width_pt.max(1.0)
}

/// Páginas que se miden en el render: primera, central y 5 consecutivas.
pub fn render_pages(n: usize) -> Vec<usize> {
    if n == 0 {
        return vec![];
    }
    let mid = n / 2;
    let mut v = vec![0usize];
    for p in [mid, mid + 1, mid + 2, mid + 3, mid + 4, mid + 5] {
        let p = p.min(n - 1);
        if !v.contains(&p) {
            v.push(p);
        }
    }
    v
}

/// Páginas repartidas de forma uniforme por el documento (para la prueba en paralelo).
pub fn spread_pages(n: usize, k: usize) -> Vec<usize> {
    if n == 0 || k == 0 {
        return vec![];
    }
    let mut v: Vec<usize> = (0..k.min(n)).map(|i| i * n / k.min(n)).collect();
    v.dedup();
    v
}
