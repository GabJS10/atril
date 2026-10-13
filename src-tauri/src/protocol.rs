//! Protocolo `atril://` (docs/IPC.md): sirve los PDF con `Range` y las portadas, y decodifica
//! los JPX que pide pdf.js (`POST /jpx`, ver `jpx.rs`).
//! Solo atiende IDs que estén en la base de datos; nunca rutas que vengan en la URL.

use std::fs::File;
use std::io::{ErrorKind, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OptionalExtension, params};
use tauri::http::{Method, Request, Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::AppState;
use crate::engine::scheduler::PageResult;
use crate::engine::{self, Engine, EngineError};
use crate::error::AppError;
use crate::jpx;
use crate::library::CoverFormat;

pub const SCHEME: &str = "atril";

/// Orígenes desde los que pdf.js puede pedir: la app en build (`tauri://localhost`,
/// `http(s)://tauri.localhost` en Windows) y el servidor de desarrollo.
const ALLOWED_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:1420",
];

/// Ruta de la decodificación JPX. Solo `POST`, con el JPX crudo en el cuerpo.
const JPX_PATH: &str = "/jpx";

const EXPOSED_HEADERS: &str =
    "Content-Range, Accept-Ranges, Content-Length, X-Jpx-Width, X-Jpx-Height, X-Jpx-Channels";

/// Origen del protocolo. En Windows el esquema se sirve como `http://atril.localhost`.
fn origin() -> &'static str {
    if cfg!(windows) {
        "http://atril.localhost"
    } else {
        "atril://localhost"
    }
}

/// URL del PDF de un libro, lista para pdf.js.
pub fn book_file_url(id: &str) -> String {
    format!("{}/book/{id}", origin())
}

/// URL de la portada de un libro (solo si tiene una guardada).
pub fn book_cover_url(id: &str) -> String {
    format!("{}/cover/{id}", origin())
}

/// URL base de las páginas de un libro: el front añade `/<n>?scale=<f>` (docs/IPC.md, "Motor de PDF").
pub fn book_page_base_url(id: &str) -> String {
    format!("{}/page/{id}", origin())
}

/// Resultado de interpretar la cabecera `Range` para un archivo de `len` bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ByteRange {
    /// Sin cabecera `Range` válida: se sirve el archivo entero (200).
    Full,
    /// Trozo `start..=end` (206).
    Span { start: u64, end: u64 },
    /// Fuera de los límites del archivo (416).
    Unsatisfiable,
}

/// Interpreta `Range: bytes=…`. Solo se atiende el primer rango de una lista;
/// una cabecera mal formada se ignora y se responde 200 (RFC 9110).
pub fn parse_range(header_value: Option<&str>, len: u64) -> ByteRange {
    let Some(spec) = header_value.and_then(|value| value.trim().strip_prefix("bytes=")) else {
        return ByteRange::Full;
    };
    let first = spec.split(',').next().unwrap_or_default().trim();
    let Some((start_raw, end_raw)) = first.split_once('-') else {
        return ByteRange::Full;
    };
    let (start_raw, end_raw) = (start_raw.trim(), end_raw.trim());

    if start_raw.is_empty() {
        // "-n": los últimos n bytes.
        let Ok(suffix) = end_raw.parse::<u64>() else {
            return ByteRange::Full;
        };
        if suffix == 0 || len == 0 {
            return ByteRange::Unsatisfiable;
        }
        return span(len.saturating_sub(suffix), len - 1);
    }

    let Ok(start) = start_raw.parse::<u64>() else {
        return ByteRange::Full;
    };
    let end = if end_raw.is_empty() {
        None
    } else {
        match end_raw.parse::<u64>() {
            Ok(end) => Some(end),
            Err(_) => return ByteRange::Full,
        }
    };
    if end.is_some_and(|end| end < start) {
        return ByteRange::Full;
    }
    if start >= len {
        return ByteRange::Unsatisfiable;
    }

    let last = end.map_or(len - 1, |end| end.min(len - 1));
    span(start, last)
}

/// El 206 sirve exactamente el rango pedido (pdf.js no tolera trozos más cortos).
fn span(start: u64, end: u64) -> ByteRange {
    ByteRange::Span { start, end }
}

#[derive(Debug, PartialEq, Eq)]
enum Route<'a> {
    Book(&'a str),
    Cover(&'a str),
    /// `/page/<id>/<n>` con `n` 1-based.
    Page(&'a str, u32),
}

/// `/book/<id>`, `/cover/<id>` o `/page/<id>/<n>`. El ID debe tener forma de huella (64 hex minúsculas).
fn parse_route(path: &str) -> Option<Route<'_>> {
    let (kind, rest) = path.strip_prefix('/')?.split_once('/')?;
    if kind == "page" {
        let (id, page) = rest.split_once('/')?;
        // Solo dígitos: sin signo, sin espacios y sin ceros a la izquierda raros que cambien la caché.
        if !is_book_id(id) || page.is_empty() || !page.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        let page: u32 = page.parse().ok().filter(|page| *page >= 1)?;
        return Some(Route::Page(id, page));
    }
    let id = rest;
    if !is_book_id(id) {
        return None;
    }
    match kind {
        "book" => Some(Route::Book(id)),
        "cover" => Some(Route::Cover(id)),
        _ => None,
    }
}

pub(crate) fn is_book_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn allowed_origin(request: &Request<Vec<u8>>) -> Option<String> {
    let origin = request.headers().get(header::ORIGIN)?.to_str().ok()?;
    ALLOWED_ORIGINS.contains(&origin).then(|| origin.to_owned())
}

fn reply(
    status: StatusCode,
    origin: Option<&str>,
    headers: Vec<(&'static str, String)>,
    body: Vec<u8>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, EXPOSED_HEADERS)
        .header(header::VARY, "Origin");
    if let Some(origin) = origin {
        builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
    }
    for (name, value) in headers {
        builder = builder.header(name, value);
    }
    builder.body(body).unwrap_or_else(|_| {
        let mut response = Response::new(Vec::new());
        *response.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
        response
    })
}

fn empty(status: StatusCode, origin: Option<&str>) -> Response<Vec<u8>> {
    reply(status, origin, Vec::new(), Vec::new())
}

/// Atiende una petición `atril://…`. Es síncrona para poder probarla;
/// `handle` la ejecuta fuera del hilo principal.
pub fn respond(
    db: &Mutex<Connection>,
    covers_dir: &Path,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let origin = allowed_origin(request);
    let origin = origin.as_deref();
    let path = request.uri().path();

    if request.method() == Method::OPTIONS {
        let (methods, allowed_headers) = if path == JPX_PATH {
            ("POST, OPTIONS", "Content-Type")
        } else {
            ("GET, OPTIONS", "Range")
        };
        return reply(
            StatusCode::NO_CONTENT,
            origin,
            vec![
                ("Access-Control-Allow-Methods", methods.to_owned()),
                ("Access-Control-Allow-Headers", allowed_headers.to_owned()),
                ("Access-Control-Max-Age", "86400".to_owned()),
            ],
            Vec::new(),
        );
    }
    if path == JPX_PATH {
        return if request.method() == Method::POST {
            serve_jpx(request, origin)
        } else {
            empty(StatusCode::METHOD_NOT_ALLOWED, origin)
        };
    }
    if request.method() != Method::GET {
        return empty(StatusCode::METHOD_NOT_ALLOWED, origin);
    }

    match parse_route(path) {
        Some(Route::Book(id)) => serve_book(db, id, request, origin),
        Some(Route::Cover(id)) => serve_cover(db, covers_dir, id, origin),
        // Las páginas las sirve el pool de render, de forma asíncrona (`serve_page`).
        Some(Route::Page(..)) | None => empty(StatusCode::NOT_FOUND, origin),
    }
}

/// `Cache-Control` de las páginas: la imagen solo depende del libro (su ID es su contenido), la página y la
/// escala. Una hora basta: el visor las pide una vez y la caché de Rust cubre lo demás.
const PAGE_CACHE_CONTROL: &str = "private, max-age=3600";

/// `?scale=<f>`: ausente = 1. Fuera de `MIN_SCALE..=MAX_SCALE` o no numérica = error (400).
fn parse_page_scale(query: Option<&str>) -> Result<f64, String> {
    let value = query
        .unwrap_or_default()
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find_map(|(name, value)| (name == "scale").then_some(value));
    let Some(value) = value else {
        return Ok(1.0);
    };
    let scale: f64 = value
        .parse()
        .map_err(|_| "scale must be a number".to_owned())?;
    if !scale.is_finite() || !(engine::MIN_SCALE..=engine::MAX_SCALE).contains(&scale) {
        return Err(format!(
            "scale must be between {} and {}",
            engine::MIN_SCALE,
            engine::MAX_SCALE
        ));
    }
    Ok(scale)
}

/// `GET /page/<id>/<n>?scale=<f>`: la página n del libro como `image/jpeg`, renderizada por el motor.
/// No bloquea al llamante: la respuesta se entrega con `deliver` cuando el pool termina (o ya, si la página
/// estaba en caché o la petición no es válida).
pub fn serve_page(
    engine: &Engine,
    db: &Mutex<Connection>,
    request: &Request<Vec<u8>>,
    deliver: impl FnOnce(Response<Vec<u8>>) + Send + 'static,
) {
    let origin = allowed_origin(request);
    let Some(Route::Page(id, page)) = parse_route(request.uri().path()) else {
        return deliver(empty(StatusCode::NOT_FOUND, origin.as_deref()));
    };
    let scale = match parse_page_scale(request.uri().query()) {
        Ok(scale) => scale,
        Err(message) => return deliver(text(StatusCode::BAD_REQUEST, origin.as_deref(), &message)),
    };
    let path = match lookup_book_path(db, id) {
        Ok(Some(path)) => std::path::PathBuf::from(path),
        Ok(None) => return deliver(empty(StatusCode::NOT_FOUND, origin.as_deref())),
        Err(error) => {
            tracing::error!(%error, "could not look up book for page request");
            return deliver(empty(StatusCode::INTERNAL_SERVER_ERROR, origin.as_deref()));
        }
    };
    if !path.is_file() {
        mark_missing(db, id);
        return deliver(empty(StatusCode::NOT_FOUND, origin.as_deref()));
    }

    engine.request_page(
        id,
        &path,
        page,
        scale,
        Box::new(move |result| deliver(page_response(result, origin.as_deref()))),
    );
}

fn page_response(result: PageResult, origin: Option<&str>) -> Response<Vec<u8>> {
    match result {
        Ok(jpeg) => reply(
            StatusCode::OK,
            origin,
            vec![
                ("Content-Type", "image/jpeg".to_owned()),
                ("Content-Length", jpeg.len().to_string()),
                ("Cache-Control", PAGE_CACHE_CONTROL.to_owned()),
            ],
            jpeg.as_ref().clone(),
        ),
        // El visor ya pidió otra zona: nadie espera esta imagen.
        Err(EngineError::Superseded) => empty(StatusCode::GONE, origin),
        Err(EngineError::PageOutOfRange { .. }) | Err(EngineError::Io(_)) => {
            empty(StatusCode::NOT_FOUND, origin)
        }
        Err(EngineError::InvalidPdf(message)) => {
            text(StatusCode::UNPROCESSABLE_ENTITY, origin, &message)
        }
        Err(EngineError::Shutdown) => empty(StatusCode::SERVICE_UNAVAILABLE, origin),
        Err(error @ EngineError::Render(_)) => {
            tracing::warn!(%error, "could not render page");
            text(
                StatusCode::INTERNAL_SERVER_ERROR,
                origin,
                &error.to_string(),
            )
        }
    }
}

/// `POST /jpx?components=N&indexed=0|1&smask=0|1&reduce=R` con el JPX en el cuerpo.
/// 200 con los píxeles (RGBA u otros canales según `components`); 422 con el motivo como
/// texto si no se puede decodificar; 400 si la query no es válida; 413 si el cuerpo pasa de 64 MiB.
fn serve_jpx(request: &Request<Vec<u8>>, origin: Option<&str>) -> Response<Vec<u8>> {
    let options = match parse_jpx_query(request.uri().query()) {
        Ok(options) => options,
        Err(message) => return text(StatusCode::BAD_REQUEST, origin, &message),
    };
    let body = request.body();
    if body.len() > jpx::MAX_BODY_BYTES {
        return text(
            StatusCode::PAYLOAD_TOO_LARGE,
            origin,
            "JPEG 2000 data is larger than 64 MiB",
        );
    }

    match jpx::decode(body, options) {
        Ok(decoded) => reply(
            StatusCode::OK,
            origin,
            vec![
                ("Content-Type", "application/octet-stream".to_owned()),
                ("Content-Length", decoded.pixels.len().to_string()),
                ("X-Jpx-Width", decoded.width.to_string()),
                ("X-Jpx-Height", decoded.height.to_string()),
                ("X-Jpx-Channels", decoded.channels.to_string()),
            ],
            decoded.pixels,
        ),
        Err(error) => {
            tracing::warn!(%error, "could not decode JPEG 2000 image");
            text(StatusCode::UNPROCESSABLE_ENTITY, origin, &error.to_string())
        }
    }
}

/// Lee los parámetros de `/jpx`. Los que faltan valen 0 o `false`, como en pdf.js.
fn parse_jpx_query(query: Option<&str>) -> Result<jpx::Options, String> {
    let mut options = jpx::Options::default();
    for pair in query
        .unwrap_or_default()
        .split('&')
        .filter(|pair| !pair.is_empty())
    {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        match name {
            "components" => options.components = parse_number(name, value)?,
            "indexed" => options.indexed = parse_flag(name, value)?,
            "smask" => options.smask = parse_flag(name, value)?,
            "reduce" => {
                options.reduce = parse_number(name, value)?;
                if options.reduce > jpx::MAX_REDUCE {
                    return Err(format!("reduce must be at most {}", jpx::MAX_REDUCE));
                }
            }
            _ => {}
        }
    }
    Ok(options)
}

fn parse_number(name: &str, value: &str) -> Result<u8, String> {
    value
        .parse()
        .map_err(|_| format!("{name} must be a number from 0 to 255"))
}

fn parse_flag(name: &str, value: &str) -> Result<bool, String> {
    match value {
        "0" => Ok(false),
        "1" => Ok(true),
        _ => Err(format!("{name} must be 0 or 1")),
    }
}

fn text(status: StatusCode, origin: Option<&str>, message: &str) -> Response<Vec<u8>> {
    reply(
        status,
        origin,
        vec![("Content-Type", "text/plain; charset=utf-8".to_owned())],
        message.as_bytes().to_vec(),
    )
}

fn serve_book(
    db: &Mutex<Connection>,
    id: &str,
    request: &Request<Vec<u8>>,
    origin: Option<&str>,
) -> Response<Vec<u8>> {
    let path = match lookup_book_path(db, id) {
        Ok(Some(path)) => path,
        Ok(None) => return empty(StatusCode::NOT_FOUND, origin),
        Err(error) => {
            tracing::error!(%error, "could not look up book for protocol request");
            return empty(StatusCode::INTERNAL_SERVER_ERROR, origin);
        }
    };

    let mut file = match File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            mark_missing(db, id);
            return empty(StatusCode::NOT_FOUND, origin);
        }
        Err(error) => {
            tracing::error!(%error, "could not open book file");
            return empty(StatusCode::INTERNAL_SERVER_ERROR, origin);
        }
    };
    let len = match file.metadata() {
        Ok(metadata) => metadata.len(),
        Err(error) => {
            tracing::error!(%error, "could not read book file metadata");
            return empty(StatusCode::INTERNAL_SERVER_ERROR, origin);
        }
    };

    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    let (status, content_range, body) = match parse_range(range, len) {
        ByteRange::Unsatisfiable => {
            return reply(
                StatusCode::RANGE_NOT_SATISFIABLE,
                origin,
                vec![
                    ("Accept-Ranges", "bytes".to_owned()),
                    ("Content-Range", format!("bytes */{len}")),
                ],
                Vec::new(),
            );
        }
        ByteRange::Full => (StatusCode::OK, None, read_bytes(&mut file, 0, len)),
        ByteRange::Span { start, end } => (
            StatusCode::PARTIAL_CONTENT,
            Some(format!("bytes {start}-{end}/{len}")),
            read_bytes(&mut file, start, end - start + 1),
        ),
    };
    let body = match body {
        Ok(body) => body,
        Err(error) => {
            tracing::error!(%error, "could not read book bytes");
            return empty(StatusCode::INTERNAL_SERVER_ERROR, origin);
        }
    };

    let mut headers = vec![
        ("Accept-Ranges", "bytes".to_owned()),
        ("Content-Type", "application/pdf".to_owned()),
        ("Content-Length", body.len().to_string()),
    ];
    if let Some(content_range) = content_range {
        headers.push(("Content-Range", content_range));
    }
    reply(status, origin, headers, body)
}

fn serve_cover(
    db: &Mutex<Connection>,
    covers_dir: &Path,
    id: &str,
    origin: Option<&str>,
) -> Response<Vec<u8>> {
    match lookup_book_path(db, id) {
        Ok(Some(_)) => {}
        Ok(None) => return empty(StatusCode::NOT_FOUND, origin),
        Err(error) => {
            tracing::error!(%error, "could not look up book for cover request");
            return empty(StatusCode::INTERNAL_SERVER_ERROR, origin);
        }
    }

    // `id` ya tiene forma de huella, así que no puede salirse de `covers_dir`.
    // Solo hay una portada (JPEG o WebP); el Content-Type sale de su firma.
    for format in [CoverFormat::Jpeg, CoverFormat::Webp] {
        let path = covers_dir.join(format!("{id}.{}", format.extension()));
        match std::fs::read(&path) {
            Ok(body) => {
                let Some(detected) = CoverFormat::detect(&body) else {
                    tracing::error!(path = %path.display(), "cover file is not JPEG or WebP");
                    return empty(StatusCode::INTERNAL_SERVER_ERROR, origin);
                };
                return reply(
                    StatusCode::OK,
                    origin,
                    vec![
                        ("Content-Type", detected.mime().to_owned()),
                        ("Content-Length", body.len().to_string()),
                    ],
                    body,
                );
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                tracing::error!(%error, "could not read cover file");
                return empty(StatusCode::INTERNAL_SERVER_ERROR, origin);
            }
        }
    }
    empty(StatusCode::NOT_FOUND, origin)
}

pub(crate) fn lookup_book_path(
    db: &Mutex<Connection>,
    id: &str,
) -> Result<Option<String>, AppError> {
    let conn = db
        .lock()
        .map_err(|_| AppError::internal("database connection lock was poisoned"))?;
    let path = conn
        .query_row(
            "SELECT path FROM books WHERE id = ?1 AND removed_at IS NULL",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(path)
}

pub(crate) fn mark_missing(db: &Mutex<Connection>, id: &str) {
    let Ok(conn) = db.lock() else {
        return;
    };
    if let Err(error) = conn.execute("UPDATE books SET missing = 1 WHERE id = ?1", params![id]) {
        tracing::warn!(%error, "could not mark book as missing");
    }
}

/// Lee `count` bytes desde `start` sin cargar el resto del archivo.
fn read_bytes(file: &mut File, start: u64, count: u64) -> std::io::Result<Vec<u8>> {
    let count = usize::try_from(count)
        .map_err(|error| std::io::Error::new(ErrorKind::InvalidInput, error))?;
    file.seek(SeekFrom::Start(start))?;
    let mut body = vec![0u8; count];
    file.read_exact(&mut body)?;
    Ok(body)
}

/// Punto de entrada registrado en el builder. La lectura del archivo se hace en un
/// hilo de bloqueo, así que el hilo principal no espera al disco.
pub fn handle<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let state = context.app_handle().state::<AppState>();
    let db = Arc::clone(&state.db);
    let covers_dir = state.covers_dir.clone();

    if request.method() == Method::GET
        && matches!(parse_route(request.uri().path()), Some(Route::Page(..)))
    {
        // La búsqueda en la base de datos es breve, pero se hace fuera del hilo principal; el render lo
        // hace el pool y responde cuando termina, sin ocupar ningún hilo de bloqueo mientras espera.
        let engine = Arc::clone(&state.engine);
        tauri::async_runtime::spawn_blocking(move || {
            serve_page(&engine, &db, &request, move |response| {
                responder.respond(response)
            });
        });
        return;
    }

    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(respond(&db, &covers_dir, &request));
    });
}

#[cfg(test)]
mod tests {
    use tauri::http::HeaderName;

    use super::*;
    use crate::db;
    use crate::library;

    const FILE_LEN: usize = 10_000;

    struct Fixture {
        _dir: tempfile::TempDir,
        db: Mutex<Connection>,
        covers_dir: std::path::PathBuf,
        pdf_path: std::path::PathBuf,
        bytes: Vec<u8>,
        id: String,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = db::open(&dir.path().join("atril.db")).expect("open db");
        let mut bytes = b"%PDF-1.4\n".to_vec();
        while bytes.len() < FILE_LEN {
            bytes.push((bytes.len() % 251) as u8);
        }
        let pdf_path = dir.path().join("libro.pdf");
        std::fs::write(&pdf_path, &bytes).expect("write pdf");
        let id = library::open_path(&mut conn, &pdf_path)
            .expect("register")
            .id;
        let covers_dir = dir.path().join("covers");
        std::fs::create_dir_all(&covers_dir).expect("covers dir");
        Fixture {
            _dir: dir,
            db: Mutex::new(conn),
            covers_dir,
            pdf_path,
            bytes,
            id,
        }
    }

    fn get(path: &str, range: Option<&str>, origin: Option<&str>) -> Request<Vec<u8>> {
        let mut builder = Request::builder()
            .method(Method::GET)
            .uri(format!("atril://localhost{path}"));
        if let Some(range) = range {
            builder = builder.header(header::RANGE, range);
        }
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        builder.body(Vec::new()).expect("request")
    }

    fn header_value(response: &Response<Vec<u8>>, name: header::HeaderName) -> Option<String> {
        response
            .headers()
            .get(name)
            .map(|value| value.to_str().expect("ascii header").to_owned())
    }

    #[test]
    fn parse_range_handles_closed_open_and_suffix_ranges() {
        let len = 1000;

        assert_eq!(
            parse_range(Some("bytes=0-99"), len),
            ByteRange::Span { start: 0, end: 99 }
        );
        assert_eq!(
            parse_range(Some("bytes=500-"), len),
            ByteRange::Span {
                start: 500,
                end: 999
            }
        );
        assert_eq!(
            parse_range(Some("bytes=-100"), len),
            ByteRange::Span {
                start: 900,
                end: 999
            }
        );
        assert_eq!(
            parse_range(Some("bytes=-5000"), len),
            ByteRange::Span { start: 0, end: 999 }
        );
        assert_eq!(
            parse_range(Some("bytes=999-999"), len),
            ByteRange::Span {
                start: 999,
                end: 999
            }
        );
        assert_eq!(
            parse_range(Some("bytes=0-5000"), len),
            ByteRange::Span { start: 0, end: 999 }
        );
    }

    #[test]
    fn parse_range_only_takes_the_first_of_several_ranges() {
        assert_eq!(
            parse_range(Some("bytes=0-9, 20-29"), 1000),
            ByteRange::Span { start: 0, end: 9 }
        );
    }

    #[test]
    fn parse_range_is_unsatisfiable_outside_the_file() {
        assert_eq!(
            parse_range(Some("bytes=1000-"), 1000),
            ByteRange::Unsatisfiable
        );
        assert_eq!(
            parse_range(Some("bytes=-0"), 1000),
            ByteRange::Unsatisfiable
        );
        assert_eq!(parse_range(Some("bytes=0-"), 0), ByteRange::Unsatisfiable);
    }

    #[test]
    fn parse_range_ignores_malformed_headers_and_serves_everything() {
        assert_eq!(parse_range(None, 1000), ByteRange::Full);
        assert_eq!(parse_range(Some("items=0-9"), 1000), ByteRange::Full);
        assert_eq!(parse_range(Some("bytes=abc-"), 1000), ByteRange::Full);
        assert_eq!(parse_range(Some("bytes=-"), 1000), ByteRange::Full);
        assert_eq!(parse_range(Some("bytes=9-2"), 1000), ByteRange::Full);
    }

    #[test]
    fn parse_range_serves_exactly_the_requested_span_even_when_large() {
        let len = 100 * 1024 * 1024;

        assert_eq!(
            parse_range(Some("bytes=0-"), len),
            ByteRange::Span {
                start: 0,
                end: len - 1
            }
        );
        assert_eq!(
            parse_range(Some("bytes=1048576-5242879"), len),
            ByteRange::Span {
                start: 1_048_576,
                end: 5_242_879
            }
        );
    }

    #[test]
    fn parse_route_accepts_only_book_and_cover_with_a_valid_id() {
        let id = "a".repeat(64);

        assert_eq!(parse_route(&format!("/book/{id}")), Some(Route::Book(&id)));
        assert_eq!(
            parse_route(&format!("/cover/{id}")),
            Some(Route::Cover(&id))
        );
        assert_eq!(parse_route("/book/not-a-hash"), None);
        assert_eq!(parse_route(&format!("/file/{id}")), None);
        assert_eq!(parse_route(&format!("/book/{}", "A".repeat(64))), None);
        assert_eq!(parse_route("/book/../../etc/passwd"), None);
        assert_eq!(parse_route("/"), None);
    }

    #[test]
    fn book_without_range_returns_the_whole_file_with_200() {
        let fixture = fixture();
        let path = format!("/book/{}", fixture.id);

        let response = respond(&fixture.db, &fixture.covers_dir, &get(&path, None, None));

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), &fixture.bytes);
        assert_eq!(
            header_value(&response, header::CONTENT_TYPE).as_deref(),
            Some("application/pdf")
        );
        assert_eq!(
            header_value(&response, header::ACCEPT_RANGES).as_deref(),
            Some("bytes")
        );
        assert_eq!(
            header_value(&response, header::CONTENT_LENGTH),
            Some(FILE_LEN.to_string())
        );
    }

    #[test]
    fn book_with_range_returns_the_exact_bytes_with_206() {
        let fixture = fixture();
        let path = format!("/book/{}", fixture.id);

        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &get(&path, Some("bytes=100-199"), None),
        );

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body(), &fixture.bytes[100..200]);
        assert_eq!(
            header_value(&response, header::CONTENT_RANGE),
            Some(format!("bytes 100-199/{FILE_LEN}"))
        );
        assert_eq!(
            header_value(&response, header::CONTENT_LENGTH),
            Some("100".to_owned())
        );
    }

    #[test]
    fn open_ended_and_suffix_ranges_return_the_right_slices() {
        let fixture = fixture();
        let path = format!("/book/{}", fixture.id);

        let open = respond(
            &fixture.db,
            &fixture.covers_dir,
            &get(&path, Some("bytes=9900-"), None),
        );
        assert_eq!(open.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(open.body(), &fixture.bytes[9900..]);

        let suffix = respond(
            &fixture.db,
            &fixture.covers_dir,
            &get(&path, Some("bytes=-50"), None),
        );
        assert_eq!(suffix.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(suffix.body(), &fixture.bytes[FILE_LEN - 50..]);
        assert_eq!(
            header_value(&suffix, header::CONTENT_RANGE),
            Some(format!("bytes 9950-9999/{FILE_LEN}"))
        );
    }

    #[test]
    fn range_outside_the_file_returns_416() {
        let fixture = fixture();
        let path = format!("/book/{}", fixture.id);

        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &get(&path, Some("bytes=20000-"), None),
        );

        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            header_value(&response, header::CONTENT_RANGE),
            Some(format!("bytes */{FILE_LEN}"))
        );
        assert!(response.body().is_empty());
    }

    #[test]
    fn allowed_origin_is_echoed_and_exposed_headers_are_listed() {
        let fixture = fixture();
        let path = format!("/book/{}", fixture.id);

        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &get(&path, Some("bytes=0-9"), Some("http://localhost:1420")),
        );

        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
            Some("http://localhost:1420")
        );
        let exposed =
            header_value(&response, header::ACCESS_CONTROL_EXPOSE_HEADERS).expect("expose");
        for name in ["Content-Range", "Accept-Ranges", "Content-Length"] {
            assert!(exposed.contains(name), "{name} not exposed");
        }
    }

    #[test]
    fn foreign_origin_gets_no_allow_origin_header() {
        let fixture = fixture();
        let path = format!("/book/{}", fixture.id);

        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &get(&path, None, Some("https://example.com")),
        );

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN),
            None
        );
    }

    #[test]
    fn preflight_options_is_answered_for_the_app_origin() {
        let fixture = fixture();
        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri(format!("atril://localhost/book/{}", fixture.id))
            .header(header::ORIGIN, "tauri://localhost")
            .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "range")
            .body(Vec::new())
            .expect("request");

        let response = respond(&fixture.db, &fixture.covers_dir, &request);

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
            Some("tauri://localhost")
        );
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_HEADERS).as_deref(),
            Some("Range")
        );
        assert!(response.body().is_empty());
    }

    #[test]
    fn unknown_ids_and_other_routes_return_404() {
        let fixture = fixture();
        let unknown = "b".repeat(64);

        for path in [
            format!("/book/{unknown}"),
            format!("/cover/{unknown}"),
            "/book/x".to_owned(),
        ] {
            let response = respond(&fixture.db, &fixture.covers_dir, &get(&path, None, None));
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }
    }

    #[test]
    fn non_get_methods_return_405() {
        let fixture = fixture();
        let request = Request::builder()
            .method(Method::POST)
            .uri(format!("atril://localhost/book/{}", fixture.id))
            .body(Vec::new())
            .expect("request");

        let response = respond(&fixture.db, &fixture.covers_dir, &request);

        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[test]
    fn missing_file_returns_404_and_marks_the_book_missing() {
        let fixture = fixture();
        std::fs::remove_file(&fixture.pdf_path).expect("remove");
        let path = format!("/book/{}", fixture.id);

        let response = respond(&fixture.db, &fixture.covers_dir, &get(&path, None, None));

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let conn = fixture.db.lock().expect("lock");
        let missing: bool = conn
            .query_row(
                "SELECT missing FROM books WHERE id = ?1",
                params![fixture.id],
                |row| row.get(0),
            )
            .expect("row");
        assert!(missing);
    }

    #[test]
    fn cover_is_served_as_webp_or_404_when_absent() {
        let fixture = fixture();
        let path = format!("/cover/{}", fixture.id);

        let absent = respond(&fixture.db, &fixture.covers_dir, &get(&path, None, None));
        assert_eq!(absent.status(), StatusCode::NOT_FOUND);

        let cover = b"RIFF\x00\x00\x00\x00WEBPVP8 ".to_vec();
        std::fs::write(
            fixture.covers_dir.join(format!("{}.webp", fixture.id)),
            &cover,
        )
        .expect("write cover");

        let present = respond(&fixture.db, &fixture.covers_dir, &get(&path, None, None));
        assert_eq!(present.status(), StatusCode::OK);
        assert_eq!(
            header_value(&present, header::CONTENT_TYPE).as_deref(),
            Some("image/webp")
        );
        assert_eq!(present.body(), &cover);
    }

    #[test]
    fn jpeg_cover_is_served_with_its_real_content_type() {
        let fixture = fixture();
        let jpeg = crate::test_support::jpeg_bytes(128);
        std::fs::write(
            fixture.covers_dir.join(format!("{}.jpg", fixture.id)),
            &jpeg,
        )
        .expect("write cover");

        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &get(&format!("/cover/{}", fixture.id), None, None),
        );

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            header_value(&response, header::CONTENT_TYPE).as_deref(),
            Some("image/jpeg")
        );
        assert_eq!(response.body(), &jpeg);
    }

    #[test]
    fn cover_of_an_unknown_book_is_404_even_if_a_file_matches() {
        let fixture = fixture();
        let unknown = "c".repeat(64);
        std::fs::write(fixture.covers_dir.join(format!("{unknown}.webp")), b"RIFF")
            .expect("write cover");

        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &get(&format!("/cover/{unknown}"), None, None),
        );

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    const RGB_JPX: &[u8] = include_bytes!("../tests/fixtures/jpx/rgb.jp2");

    fn post_jpx(query: &str, body: Vec<u8>, origin: Option<&str>) -> Request<Vec<u8>> {
        let mut builder = Request::builder()
            .method(Method::POST)
            .uri(format!("atril://localhost/jpx{query}"));
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        builder.body(body).expect("request")
    }

    #[test]
    fn jpx_post_returns_rgba_pixels_and_the_size_in_headers() {
        let fixture = fixture();
        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &post_jpx("?components=0", RGB_JPX.to_vec(), Some("tauri://localhost")),
        );

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            header_value(&response, header::CONTENT_TYPE).as_deref(),
            Some("application/octet-stream")
        );
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
            Some("tauri://localhost")
        );
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_EXPOSE_HEADERS)
                .expect("expose")
                .split(", ")
                .filter(|name| name.starts_with("X-Jpx-"))
                .count(),
            3
        );
        assert_eq!(
            header_value(&response, HeaderName::from_static("x-jpx-width")).as_deref(),
            Some("64")
        );
        assert_eq!(
            header_value(&response, HeaderName::from_static("x-jpx-height")).as_deref(),
            Some("48")
        );
        assert_eq!(
            header_value(&response, HeaderName::from_static("x-jpx-channels")).as_deref(),
            Some("4")
        );
        assert_eq!(response.body().len(), 64 * 48 * 4);
        // Píxel (1, 0) del patrón de rgb.jp2: R = 4, G = 0, B = 3, alfa 255.
        assert_eq!(&response.body()[4..8], &[4, 0, 3, 255]);
    }

    #[test]
    fn jpx_corrupt_data_is_422_with_the_reason_as_text() {
        let fixture = fixture();
        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &post_jpx(
                "",
                b"definitely not JPEG 2000".to_vec(),
                Some("tauri://localhost"),
            ),
        );

        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            header_value(&response, header::CONTENT_TYPE).as_deref(),
            Some("text/plain; charset=utf-8")
        );
        assert!(!response.body().is_empty());
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
            Some("tauri://localhost")
        );
    }

    #[test]
    fn jpx_invalid_query_is_400() {
        let fixture = fixture();
        for query in ["?smask=yes", "?components=-1", "?reduce=40", "?indexed=2"] {
            let response = respond(
                &fixture.db,
                &fixture.covers_dir,
                &post_jpx(query, RGB_JPX.to_vec(), None),
            );

            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{query}");
        }
    }

    #[test]
    fn jpx_body_over_64_mib_is_413_without_decoding() {
        let fixture = fixture();
        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &post_jpx("", vec![0u8; jpx::MAX_BODY_BYTES + 1], None),
        );

        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[test]
    fn jpx_preflight_allows_post_with_content_type() {
        let fixture = fixture();
        let request = Request::builder()
            .method(Method::OPTIONS)
            .uri("atril://localhost/jpx")
            .header(header::ORIGIN, "tauri://localhost")
            .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
            .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
            .body(Vec::new())
            .expect("request");

        let response = respond(&fixture.db, &fixture.covers_dir, &request);

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_METHODS).as_deref(),
            Some("POST, OPTIONS")
        );
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_HEADERS).as_deref(),
            Some("Content-Type")
        );
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
            Some("tauri://localhost")
        );
    }

    #[test]
    fn jpx_decoder_panic_is_422_and_the_next_request_still_works() {
        let fixture = fixture();
        crate::jpx::PANIC_ON_DECODE.with(|flag| flag.set(true));

        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &post_jpx("", RGB_JPX.to_vec(), Some("tauri://localhost")),
        );

        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(response.body().as_slice(), b"decoder panicked");
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
            Some("tauri://localhost")
        );

        let next = respond(
            &fixture.db,
            &fixture.covers_dir,
            &post_jpx("", RGB_JPX.to_vec(), None),
        );
        assert_eq!(next.status(), StatusCode::OK);
    }

    #[test]
    fn jpx_route_only_accepts_post() {
        let fixture = fixture();
        let get_request = Request::builder()
            .method(Method::GET)
            .uri("atril://localhost/jpx")
            .body(Vec::new())
            .expect("request");

        let response = respond(&fixture.db, &fixture.covers_dir, &get_request);

        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[test]
    fn parse_route_reads_page_requests() {
        let id = "a".repeat(64);

        assert_eq!(
            parse_route(&format!("/page/{id}/7")),
            Some(Route::Page(&id, 7))
        );
        for bad in [
            format!("/page/{id}"),
            format!("/page/{id}/"),
            format!("/page/{id}/0"),
            format!("/page/{id}/-1"),
            format!("/page/{id}/1.5"),
            format!("/page/{id}/abc"),
            format!("/page/{id}/99999999999"),
            format!("/page/{id}/1/2"),
            "/page/not-a-hash/1".to_owned(),
            format!("/page/{}/1", "A".repeat(64)),
        ] {
            assert_eq!(parse_route(&bad), None, "{bad}");
        }
    }

    #[test]
    fn page_scale_defaults_to_one_and_is_bounded() {
        assert_eq!(parse_page_scale(None), Ok(1.0));
        assert_eq!(parse_page_scale(Some("other=1")), Ok(1.0));
        assert_eq!(parse_page_scale(Some("scale=1.5")), Ok(1.5));
        assert_eq!(parse_page_scale(Some("x=1&scale=0.1")), Ok(0.1));
        assert_eq!(parse_page_scale(Some("scale=8")), Ok(8.0));
        for bad in [
            "scale=",
            "scale=abc",
            "scale=0",
            "scale=0.05",
            "scale=8.01",
            "scale=-1",
            "scale=NaN",
            "scale=inf",
            "scale=1e9",
        ] {
            assert!(parse_page_scale(Some(bad)).is_err(), "{bad}");
        }
    }

    struct PageFixture {
        _dir: tempfile::TempDir,
        db: Mutex<Connection>,
        engine: Engine,
        pdf_path: std::path::PathBuf,
        id: String,
    }

    fn page_fixture() -> PageFixture {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut conn = db::open(&dir.path().join("atril.db")).expect("open db");
        let pdf_path = dir.path().join("libro.pdf");
        std::fs::write(&pdf_path, crate::engine::testpdf::text_book(4)).expect("write pdf");
        let id = library::open_path(&mut conn, &pdf_path)
            .expect("register")
            .id;
        PageFixture {
            _dir: dir,
            db: Mutex::new(conn),
            engine: Engine::new(crate::engine::EngineConfig::default()),
            pdf_path,
            id,
        }
    }

    fn fetch_page(
        fixture: &PageFixture,
        path_and_query: &str,
        origin: Option<&str>,
    ) -> Response<Vec<u8>> {
        let (tx, rx) = std::sync::mpsc::channel();
        serve_page(
            &fixture.engine,
            &fixture.db,
            &get(path_and_query, None, origin),
            move |response| {
                let _ = tx.send(response);
            },
        );
        rx.recv_timeout(std::time::Duration::from_secs(20))
            .expect("a response")
    }

    #[test]
    fn page_route_serves_a_jpeg_with_cache_headers() {
        let fixture = page_fixture();

        let response = fetch_page(
            &fixture,
            &format!("/page/{}/2?scale=1.5", fixture.id),
            Some("tauri://localhost"),
        );

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            header_value(&response, header::CONTENT_TYPE).as_deref(),
            Some("image/jpeg")
        );
        assert_eq!(
            header_value(&response, header::CONTENT_LENGTH).as_deref(),
            Some(response.body().len().to_string().as_str())
        );
        assert_eq!(
            header_value(&response, header::CACHE_CONTROL).as_deref(),
            Some(PAGE_CACHE_CONTROL)
        );
        assert_eq!(
            header_value(&response, header::ACCESS_CONTROL_ALLOW_ORIGIN).as_deref(),
            Some("tauri://localhost")
        );
        let image = image::load_from_memory_with_format(response.body(), image::ImageFormat::Jpeg)
            .expect("a JPEG");
        assert_eq!(image::GenericImageView::dimensions(&image), (918, 1188));
    }

    #[test]
    fn page_route_without_scale_renders_at_scale_one() {
        let fixture = page_fixture();

        let response = fetch_page(&fixture, &format!("/page/{}/1", fixture.id), None);

        assert_eq!(response.status(), StatusCode::OK);
        let image = image::load_from_memory_with_format(response.body(), image::ImageFormat::Jpeg)
            .expect("a JPEG");
        assert_eq!(image::GenericImageView::dimensions(&image), (612, 792));
    }

    #[test]
    fn page_route_rejects_bad_scales_and_unknown_pages() {
        let fixture = page_fixture();
        let id = &fixture.id;

        for scale in ["abc", "0", "9", "-2", "NaN"] {
            let response = fetch_page(&fixture, &format!("/page/{id}/1?scale={scale}"), None);
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "scale={scale}");
        }
        // Página fuera del libro, formas de ruta inválidas y libros que no existen: 404.
        for path in [
            format!("/page/{id}/5"),
            format!("/page/{id}/0"),
            format!("/page/{id}/x"),
            "/page/nothex/1".to_owned(),
            format!("/page/{}/1", "b".repeat(64)),
        ] {
            let response = fetch_page(&fixture, &path, None);
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }
    }

    #[test]
    fn page_route_with_a_missing_file_is_404_and_marks_the_book() {
        let fixture = page_fixture();
        std::fs::remove_file(&fixture.pdf_path).expect("remove");

        let response = fetch_page(&fixture, &format!("/page/{}/1", fixture.id), None);

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let conn = fixture.db.lock().expect("db");
        let missing: i64 = conn
            .query_row(
                "SELECT missing FROM books WHERE id = ?1",
                params![fixture.id],
                |row| row.get(0),
            )
            .expect("row");
        assert_eq!(missing, 1);
    }

    #[test]
    fn page_urls_are_built_by_the_backend() {
        let id = "c".repeat(64);

        assert!(book_page_base_url(&id).ends_with(&format!("/page/{id}")));
        assert!(book_page_base_url(&id).starts_with("atril://localhost/"));
    }

    #[test]
    fn page_requests_are_not_served_by_the_synchronous_responder() {
        let fixture = fixture();
        let id = &fixture.id;

        let response = respond(
            &fixture.db,
            &fixture.covers_dir,
            &get(&format!("/page/{id}/1"), None, None),
        );

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
