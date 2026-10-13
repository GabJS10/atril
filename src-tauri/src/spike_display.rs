//! SPIKE R0.2 (desechable, sin PR; ver `spikes/display/REPORT.md`).
//!
//! Sirve páginas de prueba ya renderizadas con pdftoppm (carpeta fuera del repo) en cuatro formatos:
//! BMP sin comprimir, RGBA crudo con cabecera de ancho y alto, JPEG q85 y PNG. Se codifican en memoria
//! al arrancar (solo los formatos de `ATRIL_SPIKE_FORMATS`) y se sirven desde
//! `atril://localhost/spike/<t>.<fmt>?w=<ancho>&v=<etiqueta>`. `t` es el índice de la página de prueba
//! (0..30 texto, 30..60 escaneo); `v` solo evita que el navegador reutilice la caché.
//!
//! Variables de entorno (sin `ATRIL_SPIKE_PAGES` no hace nada):
//! - `ATRIL_SPIKE_PAGES`: carpeta con `text-NN-<ancho>.png` y `scan-NN-<ancho>.png`.
//! - `ATRIL_SPIKE_OUT`: carpeta de resultados (por defecto `<PAGES>/results`).
//! - `ATRIL_SPIKE_FORMATS`: formatos a precodificar, p. ej. `bmp` (por defecto, los cuatro).
//! - `ATRIL_SPIKE_LIMIT`: páginas de prueba por tipo, de 1 a 30 (por defecto 30).
//! - `ATRIL_SPIKE_AUTO`: variante (`a`..`d`) para la suite automática del front.
//! - `ATRIL_SPIKE_BENCH=1`: mide solo el coste de codificar cada formato y sale.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};

use image::codecs::bmp::BmpEncoder;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{DynamicImage, ExtendedColorType, ImageEncoder};
use serde::Serialize;
use serde_json::json;
use tauri::http::{Method, Request, Response, StatusCode};

use crate::protocol::{empty, reply};

/// Prefijo de las rutas del spike dentro del protocolo `atril://`.
pub const PREFIX: &str = "/spike/";
/// Páginas de prueba por tipo; las de escaneo empiezan en `SCAN_OFFSET`.
const PER_KIND: u32 = 30;
const SCAN_OFFSET: u32 = 30;
/// Páginas que también se precodifican a 2480 px para el zoom: la primera de texto y la primera de escaneo.
const ZOOM_PAGES: [u32; 2] = [0, 30];
const DEFAULT_WIDTH: u32 = 1240;
const ZOOM_WIDTH: u32 = 2480;
const JPEG_QUALITY: u8 = 85;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Format {
    Bmp,
    Rgba,
    Jpg,
    Png,
}

impl Format {
    const ALL: [Format; 4] = [Format::Bmp, Format::Rgba, Format::Jpg, Format::Png];

    fn parse(name: &str) -> Option<Self> {
        match name {
            "bmp" => Some(Self::Bmp),
            "rgba" => Some(Self::Rgba),
            "jpg" => Some(Self::Jpg),
            "png" => Some(Self::Png),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Bmp => "bmp",
            Self::Rgba => "rgba",
            Self::Jpg => "jpg",
            Self::Png => "png",
        }
    }

    fn mime(self) -> &'static str {
        match self {
            Self::Bmp => "image/bmp",
            Self::Rgba => "application/octet-stream",
            Self::Jpg => "image/jpeg",
            Self::Png => "image/png",
        }
    }
}

#[derive(Clone, Debug)]
struct Config {
    pages_dir: PathBuf,
    out_dir: PathBuf,
    formats: Vec<Format>,
    limit: u32,
    auto: Option<String>,
    bench: bool,
}

impl Config {
    fn from_env() -> Option<Self> {
        let pages_dir = PathBuf::from(std::env::var_os("ATRIL_SPIKE_PAGES")?);
        let out_dir = std::env::var_os("ATRIL_SPIKE_OUT")
            .map_or_else(|| pages_dir.join("results"), PathBuf::from);
        let formats = match std::env::var("ATRIL_SPIKE_FORMATS") {
            Ok(list) => list
                .split(',')
                .filter_map(|name| Format::parse(name.trim()))
                .collect(),
            Err(_) => Format::ALL.to_vec(),
        };
        let limit = std::env::var("ATRIL_SPIKE_LIMIT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(PER_KIND)
            .clamp(1, PER_KIND);
        let auto = std::env::var("ATRIL_SPIKE_AUTO")
            .ok()
            .filter(|value| !value.is_empty());
        let bench = std::env::var("ATRIL_SPIKE_BENCH").is_ok_and(|value| value == "1");
        Some(Self {
            pages_dir,
            out_dir,
            formats,
            limit,
            auto,
            bench,
        })
    }

    /// Índices de prueba en orden: los `limit` primeros de texto y los `limit` primeros de escaneo.
    fn test_pages(&self) -> Vec<u32> {
        (0..self.limit)
            .chain(SCAN_OFFSET..SCAN_OFFSET + self.limit)
            .collect()
    }
}

/// Dimensiones de una página de prueba.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub t: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Default)]
struct Store {
    enabled: bool,
    ready: bool,
    error: Option<String>,
    mode: &'static str,
    config: Option<Config>,
    pages: Vec<PageInfo>,
    zoom_pages: Vec<PageInfo>,
    bodies: HashMap<(Format, u32, u32), Arc<Vec<u8>>>,
    cache_bytes: u64,
    precode_ms: f64,
}

static STORE: OnceLock<RwLock<Store>> = OnceLock::new();

fn store() -> &'static RwLock<Store> {
    STORE.get_or_init(|| RwLock::new(Store::default()))
}

static REQUESTS: AtomicU64 = AtomicU64::new(0);
static SERVED_BYTES: AtomicU64 = AtomicU64::new(0);
static SERVE_NS_TOTAL: AtomicU64 = AtomicU64::new(0);
static SERVE_NS_MAX: AtomicU64 = AtomicU64::new(0);

/// Arranca el spike si `ATRIL_SPIKE_PAGES` está definido. Precodifica (o hace el banco de codificación) en un
/// hilo aparte para no bloquear la ventana. El front espera a `ready` con `spike_status`.
pub fn start(app: tauri::AppHandle) {
    let Some(config) = Config::from_env() else {
        return;
    };
    let bench = config.bench;
    if let Ok(mut store) = store().write() {
        store.enabled = true;
        store.mode = if bench { "bench" } else { "serve" };
        store.config = Some(config.clone());
    }
    let spawned = std::thread::Builder::new()
        .name("atril-spike".into())
        .spawn(move || {
            let outcome = if bench {
                bench_encode(&config)
            } else {
                precode(&config)
            };
            if let Err(error) = outcome {
                tracing::error!(%error, "spike display failed");
                if let Ok(mut store) = store().write() {
                    store.error = Some(error);
                }
            }
            if bench {
                app.exit(0);
            }
        });
    if let Err(error) = spawned
        && let Ok(mut store) = store().write()
    {
        store.error = Some(error.to_string());
    }
}

/// Codifica todas las páginas de prueba en cada formato y guarda los bytes en memoria.
fn precode(config: &Config) -> Result<(), String> {
    let started = Instant::now();
    let mut pages = Vec::new();
    let mut zoom_pages = Vec::new();
    let mut bodies = HashMap::new();
    let mut encode_ms: HashMap<(Format, u32), Vec<f64>> = HashMap::new();
    let mut sizes: HashMap<(Format, u32), Vec<f64>> = HashMap::new();
    let mut cache_bytes = 0_u64;

    let plans = [
        (DEFAULT_WIDTH, config.test_pages()),
        (ZOOM_WIDTH, ZOOM_PAGES.to_vec()),
    ];
    for (width, indices) in plans {
        for t in indices {
            let page = load_page(config, t, width)?;
            let info = PageInfo {
                t,
                width: page.width(),
                height: page.height(),
            };
            if width == DEFAULT_WIDTH {
                pages.push(info);
            } else {
                zoom_pages.push(info);
            }
            for &format in &config.formats {
                let (body, ms) = encode_timed(format, &page)?;
                cache_bytes += u64::try_from(body.len()).unwrap_or(u64::MAX);
                encode_ms.entry((format, width)).or_default().push(ms);
                sizes
                    .entry((format, width))
                    .or_default()
                    .push(body.len() as f64);
                bodies.insert((format, width, t), Arc::new(body));
            }
        }
    }
    let precode_ms = started.elapsed().as_secs_f64() * 1000.0;

    let mut rows = Vec::new();
    for width in [DEFAULT_WIDTH, ZOOM_WIDTH] {
        for &format in &config.formats {
            let mut ms = encode_ms.remove(&(format, width)).unwrap_or_default();
            let mut bytes = sizes.remove(&(format, width)).unwrap_or_default();
            rows.push(json!({
                "format": format.name(),
                "width": width,
                "encodeMs": summary(&mut ms),
                "bytes": summary(&mut bytes),
            }));
        }
    }
    write_json(
        &config.out_dir,
        "precode.json",
        &json!({
            "mode": "serve",
            "formats": config.formats.iter().map(|format| format.name()).collect::<Vec<_>>(),
            "limit": config.limit,
            "pages1240": pages.len(),
            "pages2480": zoom_pages.len(),
            "cacheBytes": cache_bytes,
            "precodeMs": precode_ms,
            "rows": rows,
        }),
    )?;

    if let Ok(mut store) = store().write() {
        store.pages = pages;
        store.zoom_pages = zoom_pages;
        store.bodies = bodies;
        store.cache_bytes = cache_bytes;
        store.precode_ms = precode_ms;
        store.ready = true;
    }
    Ok(())
}

/// Mide cuánto cuesta codificar cada formato (sin guardar nada más que el tamaño). El PNG de origen se decodifica
/// fuera de la medida; también se anota aparte el coste de decodificarlo.
fn bench_encode(config: &Config) -> Result<(), String> {
    let mut rows = Vec::new();
    let plans = [
        (DEFAULT_WIDTH, config.test_pages()),
        (ZOOM_WIDTH, ZOOM_PAGES.to_vec()),
    ];
    for (width, indices) in plans {
        for format in Format::ALL {
            let mut ms = Vec::new();
            let mut sizes = Vec::new();
            for &t in &indices {
                let page = load_page(config, t, width)?;
                let (body, elapsed) = encode_timed(format, &page)?;
                ms.push(elapsed);
                sizes.push(body.len() as f64);
            }
            rows.push(json!({
                "format": format.name(),
                "width": width,
                "pages": indices.len(),
                "encodeMs": summary(&mut ms),
                "bytes": summary(&mut sizes),
            }));
        }
    }
    let mut decode_ms = Vec::new();
    for t in config.test_pages() {
        let started = Instant::now();
        load_page(config, t, DEFAULT_WIDTH)?;
        decode_ms.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    write_json(
        &config.out_dir,
        "bench-encode.json",
        &json!({
            "mode": "bench",
            "jpegQuality": JPEG_QUALITY,
            "pngSettings": "image 0.25 defaults (CompressionType::Default, que png aplica como Balanced; filtro por defecto)",
            "rows": rows,
            "decodeSourcePngMs1240": summary(&mut decode_ms),
        }),
    )?;
    Ok(())
}

fn source_name(t: u32, width: u32) -> String {
    if t < SCAN_OFFSET {
        format!("text-{:02}-{width}.png", t + 1)
    } else {
        format!("scan-{:02}-{width}.png", t - SCAN_OFFSET + 1)
    }
}

fn load_page(config: &Config, t: u32, width: u32) -> Result<DynamicImage, String> {
    let path = config.pages_dir.join(source_name(t, width));
    image::open(&path).map_err(|error| format!("{}: {error}", path.display()))
}

fn encode_timed(format: Format, page: &DynamicImage) -> Result<(Vec<u8>, f64), String> {
    let started = Instant::now();
    let body = encode(format, page)?;
    Ok((body, started.elapsed().as_secs_f64() * 1000.0))
}

/// Pasa la página al formato pedido. BMP, JPEG y PNG van en RGB de 8 bits (las páginas son opacas);
/// RGBA lleva la cabecera de 8 bytes con ancho y alto en little endian.
fn encode(format: Format, page: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let result = match format {
        Format::Bmp => {
            let rgb = page.to_rgb8();
            BmpEncoder::new(&mut out).write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                ExtendedColorType::Rgb8,
            )
        }
        Format::Jpg => {
            let rgb = page.to_rgb8();
            JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY).write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                ExtendedColorType::Rgb8,
            )
        }
        Format::Png => {
            let rgb = page.to_rgb8();
            PngEncoder::new(&mut out).write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                ExtendedColorType::Rgb8,
            )
        }
        Format::Rgba => {
            let rgba = page.to_rgba8();
            out.reserve_exact(8 + rgba.as_raw().len());
            out.extend_from_slice(&rgba.width().to_le_bytes());
            out.extend_from_slice(&rgba.height().to_le_bytes());
            out.extend_from_slice(rgba.as_raw());
            Ok(())
        }
    };
    result.map_err(|error| error.to_string())?;
    Ok(out)
}

fn summary(values: &mut [f64]) -> serde_json::Value {
    values.sort_by(f64::total_cmp);
    let mean = if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    };
    json!({
        "n": values.len(),
        "p50": percentile(values, 0.5),
        "p95": percentile(values, 0.95),
        "max": values.last().copied().unwrap_or(0.0),
        "mean": mean,
    })
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn write_json(dir: &Path, name: &str, value: &serde_json::Value) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let path = dir.join(name);
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    std::fs::write(&path, text).map_err(|error| error.to_string())?;
    Ok(path)
}

/// Atiende `GET /spike/<t>.<fmt>?w=<ancho>`. Lo llama `protocol::respond` para las rutas del spike.
pub fn respond(request: &Request<Vec<u8>>, origin: Option<&str>) -> Response<Vec<u8>> {
    if request.method() != Method::GET {
        return empty(StatusCode::METHOD_NOT_ALLOWED, origin);
    }
    let Some((t, format)) = parse_path(request.uri().path()) else {
        return empty(StatusCode::NOT_FOUND, origin);
    };
    let width = query_value(request.uri().query(), "w")
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_WIDTH);
    let body = {
        let Ok(store) = store().read() else {
            return empty(StatusCode::INTERNAL_SERVER_ERROR, origin);
        };
        if !store.ready {
            return empty(StatusCode::SERVICE_UNAVAILABLE, origin);
        }
        match store.bodies.get(&(format, width, t)) {
            Some(body) => Arc::clone(body),
            None => return empty(StatusCode::NOT_FOUND, origin),
        }
    };
    // Tauri exige un `Vec<u8>` por respuesta: la copia cuenta como coste de servir y se mide aparte.
    let started = Instant::now();
    let bytes = body.to_vec();
    record_serve(started.elapsed(), bytes.len());
    let length = bytes.len().to_string();
    reply(
        StatusCode::OK,
        origin,
        vec![
            ("Content-Type", format.mime().to_owned()),
            ("Content-Length", length),
            ("Cache-Control", "no-store".to_owned()),
        ],
        bytes,
    )
}

fn parse_path(path: &str) -> Option<(u32, Format)> {
    let (t, extension) = path.strip_prefix(PREFIX)?.split_once('.')?;
    Some((t.parse().ok()?, Format::parse(extension)?))
}

fn query_value<'a>(query: Option<&'a str>, name: &str) -> Option<&'a str> {
    query?.split('&').find_map(|pair| {
        pair.split_once('=')
            .filter(|(key, _)| *key == name)
            .map(|(_, value)| value)
    })
}

fn record_serve(elapsed: Duration, bytes: usize) {
    let nanos = u64::try_from(elapsed.as_nanos()).unwrap_or(u64::MAX);
    REQUESTS.fetch_add(1, Ordering::Relaxed);
    SERVED_BYTES.fetch_add(u64::try_from(bytes).unwrap_or(u64::MAX), Ordering::Relaxed);
    SERVE_NS_TOTAL.fetch_add(nanos, Ordering::Relaxed);
    SERVE_NS_MAX.fetch_max(nanos, Ordering::Relaxed);
}

#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServeStats {
    pub requests: u64,
    pub bytes: u64,
    pub total_ms: f64,
    pub max_ms: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpikeStatus {
    pub enabled: bool,
    pub ready: bool,
    pub error: Option<String>,
    pub mode: String,
    pub auto: Option<String>,
    pub formats: Vec<&'static str>,
    pub limit: u32,
    pub pages: Vec<PageInfo>,
    pub zoom_pages: Vec<PageInfo>,
    pub cache_bytes: u64,
    pub precode_ms: f64,
    pub out_dir: String,
    pub serve: ServeStats,
}

fn serve_stats() -> ServeStats {
    ServeStats {
        requests: REQUESTS.load(Ordering::Relaxed),
        bytes: SERVED_BYTES.load(Ordering::Relaxed),
        total_ms: SERVE_NS_TOTAL.load(Ordering::Relaxed) as f64 / 1e6,
        max_ms: SERVE_NS_MAX.load(Ordering::Relaxed) as f64 / 1e6,
    }
}

/// Estado del spike para el front: configuración, páginas precodificadas y contadores de servicio.
#[tauri::command]
pub fn spike_status() -> SpikeStatus {
    let serve = serve_stats();
    let Ok(store) = store().read() else {
        return SpikeStatus {
            enabled: false,
            ready: false,
            error: Some("spike store is poisoned".to_owned()),
            mode: String::new(),
            auto: None,
            formats: Vec::new(),
            limit: 0,
            pages: Vec::new(),
            zoom_pages: Vec::new(),
            cache_bytes: 0,
            precode_ms: 0.0,
            out_dir: String::new(),
            serve,
        };
    };
    let config = store.config.as_ref();
    SpikeStatus {
        enabled: store.enabled,
        ready: store.ready,
        error: store.error.clone(),
        mode: store.mode.to_owned(),
        auto: config.and_then(|config| config.auto.clone()),
        formats: config
            .map(|config| config.formats.iter().map(|format| format.name()).collect())
            .unwrap_or_default(),
        limit: config.map_or(0, |config| config.limit),
        pages: store.pages.clone(),
        zoom_pages: store.zoom_pages.clone(),
        cache_bytes: store.cache_bytes,
        precode_ms: store.precode_ms,
        out_dir: config
            .map(|config| config.out_dir.display().to_string())
            .unwrap_or_default(),
        serve,
    }
}

/// Guarda el JSON de resultados del front en `<ATRIL_SPIKE_OUT>/<name>.json`.
#[tauri::command]
pub fn spike_save_results(name: String, json: String) -> Result<String, String> {
    if name.is_empty()
        || !name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("invalid result name".to_owned());
    }
    let out_dir = {
        let store = store()
            .read()
            .map_err(|_| "spike store is poisoned".to_owned())?;
        store
            .config
            .as_ref()
            .map(|config| config.out_dir.clone())
            .ok_or_else(|| "spike is not enabled".to_owned())?
    };
    std::fs::create_dir_all(&out_dir).map_err(|error| error.to_string())?;
    let path = out_dir.join(format!("{name}.json"));
    std::fs::write(&path, json).map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_names_follow_the_render_script() {
        assert_eq!(source_name(0, 1240), "text-01-1240.png");
        assert_eq!(source_name(29, 2480), "text-30-2480.png");
        assert_eq!(source_name(30, 1240), "scan-01-1240.png");
        assert_eq!(source_name(59, 2480), "scan-30-2480.png");
    }

    #[test]
    fn paths_and_query_are_parsed() {
        assert_eq!(parse_path("/spike/42.rgba"), Some((42, Format::Rgba)));
        assert_eq!(parse_path("/spike/7.jpg"), Some((7, Format::Jpg)));
        assert_eq!(parse_path("/spike/7.gif"), None);
        assert_eq!(parse_path("/spike/x.png"), None);
        assert_eq!(query_value(Some("w=2480&v=a-1"), "w"), Some("2480"));
        assert_eq!(query_value(Some("v=a-1"), "w"), None);
    }

    #[test]
    fn rgba_body_starts_with_width_and_height() {
        let page = DynamicImage::new_rgb8(3, 2);
        let body = encode(Format::Rgba, &page).expect("encode");
        assert_eq!(&body[0..4], &3_u32.to_le_bytes());
        assert_eq!(&body[4..8], &2_u32.to_le_bytes());
        assert_eq!(body.len(), 8 + 3 * 2 * 4);
    }

    #[test]
    fn bmp_jpeg_and_png_bodies_have_their_magic_numbers() {
        let page = DynamicImage::new_rgb8(16, 16);
        assert!(encode(Format::Bmp, &page).expect("bmp").starts_with(b"BM"));
        assert!(
            encode(Format::Jpg, &page)
                .expect("jpg")
                .starts_with(&[0xFF, 0xD8])
        );
        assert!(
            encode(Format::Png, &page)
                .expect("png")
                .starts_with(&[0x89, b'P', b'N', b'G'])
        );
    }
}
