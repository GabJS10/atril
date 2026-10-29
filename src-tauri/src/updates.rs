//! Comprobación de actualizaciones (v1.3, `docs/IPC.md`, "Actualizaciones (v1.3)").
//!
//! Atril solo **avisa** de una versión nueva: no descarga ni instala nada. Es la única llamada de red de la app.
//! La lógica pura (`parse_release`, `build_check`) no toca la red y se prueba sin conexión; la E/S
//! (`fetch_release_json`) es bloqueante, así que el comando la ejecuta en `spawn_blocking`.

use std::time::Duration;

use semver::Version;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Última release publicada (GitHub excluye drafts y prereleases de `latest`).
const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/GabJS10/atril/releases/latest";
/// Tiempo máximo de toda la petición (conexión, cabeceras y cuerpo).
const TIMEOUT: Duration = Duration::from_secs(10);

/// Resultado de `check_for_update`. Se serializa en camelCase (`currentVersion`, `latestVersion`…).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// Versión de esta app (`CARGO_PKG_VERSION`), p. ej. `"1.2.0"`.
    pub current_version: String,
    /// Tag de la última release, sin la `v`.
    pub latest_version: String,
    /// `latest_version` > `current_version` (semver).
    pub available: bool,
    /// `html_url` de esa release en GitHub.
    pub url: String,
}

/// Campos de la respuesta de la API de GitHub que usamos. El resto se ignora.
#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
}

/// User-Agent que exige la API de GitHub: `atril/<versión>`.
pub fn user_agent(current: &str) -> String {
    format!("atril/{current}")
}

/// Lee `tag_name` y `html_url` de la respuesta de la API. Devuelve la versión del tag (sin `v`) y la URL.
/// JSON roto, sin esos campos o con un tag que no es semver → `internal`.
pub fn parse_release(body: &str) -> Result<(Version, String), AppError> {
    let release: Release = serde_json::from_str(body)
        .map_err(|error| AppError::internal(format!("unexpected release JSON: {error}")))?;

    let tag = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name);
    let version = Version::parse(tag).map_err(|error| {
        AppError::internal(format!(
            "release tag {:?} is not semver: {error}",
            release.tag_name
        ))
    })?;

    Ok((version, release.html_url))
}

/// Compara la versión actual con la respuesta de la API y arma el resultado. Función pura.
pub fn build_check(current: &str, body: &str) -> Result<UpdateCheck, AppError> {
    let current_version = Version::parse(current)
        .map_err(|error| AppError::internal(format!("current version is not semver: {error}")))?;
    let (latest, url) = parse_release(body)?;

    Ok(UpdateCheck {
        current_version: current.to_owned(),
        latest_version: latest.to_string(),
        available: latest > current_version,
        url,
    })
}

/// Pide la última release a GitHub y devuelve el cuerpo de la respuesta.
/// Sin conexión, timeout, error de cuerpo o HTTP distinto de 200 (también 403/429 por el límite de
/// peticiones) → `network`.
pub fn fetch_release_json(url: &str, user_agent: &str) -> Result<String, AppError> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        // Los códigos de error se tratan aquí, no como `Err` de ureq, para dar el mensaje propio.
        .http_status_as_error(false)
        .build()
        .into();

    let mut response = agent
        .get(url)
        .header("User-Agent", user_agent)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|error| AppError::network(format!("cannot reach GitHub: {error}")))?;

    let status = response.status();
    if status.as_u16() != 200 {
        return Err(AppError::network(format!(
            "GitHub answered HTTP {}",
            status.as_u16()
        )));
    }

    response
        .body_mut()
        .read_to_string()
        .map_err(|error| AppError::network(format!("cannot read GitHub response: {error}")))
}

/// Comprueba si hay una release más nueva que `current` (la versión de la app). Bloqueante.
pub fn check(current: &str) -> Result<UpdateCheck, AppError> {
    let body = fetch_release_json(LATEST_RELEASE_URL, &user_agent(current))?;
    build_check(current, &body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    /// Respuesta de ejemplo con la forma real de `GET /releases/latest` (campos recortados).
    const SAMPLE: &str = r#"{
        "url": "https://api.github.com/repos/GabJS10/atril/releases/1",
        "html_url": "https://github.com/GabJS10/atril/releases/tag/v1.3.0",
        "tag_name": "v1.3.0",
        "name": "Atril 1.3.0",
        "draft": false,
        "prerelease": false,
        "published_at": "2026-11-02T10:00:00Z",
        "assets": [{ "name": "atril_1.3.0_amd64.deb", "size": 1024 }]
    }"#;

    fn body_with_tag(tag: &str) -> String {
        format!(
            r#"{{"tag_name": "{tag}", "html_url": "https://github.com/GabJS10/atril/releases/tag/{tag}"}}"#
        )
    }

    #[test]
    fn parses_tag_html_url_and_ignores_other_fields() {
        let (version, url) = parse_release(SAMPLE).expect("parse");

        assert_eq!(version, Version::new(1, 3, 0));
        assert_eq!(url, "https://github.com/GabJS10/atril/releases/tag/v1.3.0");
    }

    #[test]
    fn newer_release_is_available() {
        let check = build_check("1.2.0", SAMPLE).expect("check");

        assert_eq!(
            check,
            UpdateCheck {
                current_version: "1.2.0".into(),
                latest_version: "1.3.0".into(),
                available: true,
                url: "https://github.com/GabJS10/atril/releases/tag/v1.3.0".into(),
            }
        );
    }

    #[test]
    fn same_version_is_not_available() {
        let check = build_check("1.3.0", SAMPLE).expect("check");

        assert_eq!(check.latest_version, "1.3.0");
        assert!(!check.available);
    }

    #[test]
    fn older_release_is_not_available() {
        let check = build_check("1.4.0", SAMPLE).expect("check");

        assert!(!check.available);
    }

    #[test]
    fn tag_without_v_is_accepted() {
        let check = build_check("1.2.0", &body_with_tag("1.2.1")).expect("check");

        assert_eq!(check.latest_version, "1.2.1");
        assert!(check.available);
    }

    #[test]
    fn prerelease_tag_is_older_than_its_final_version() {
        let check = build_check("1.3.0", &body_with_tag("v1.3.0-rc.1")).expect("check");

        assert_eq!(check.latest_version, "1.3.0-rc.1");
        assert!(!check.available);
    }

    #[test]
    fn invalid_tag_is_internal() {
        let error = build_check("1.2.0", &body_with_tag("latest")).expect_err("must fail");

        assert_eq!(error.code, ErrorCode::Internal);
    }

    #[test]
    fn broken_json_is_internal() {
        let error = build_check("1.2.0", "{ \"tag_name\": ").expect_err("must fail");

        assert_eq!(error.code, ErrorCode::Internal);
    }

    #[test]
    fn missing_fields_are_internal() {
        let error = build_check("1.2.0", r#"{ "message": "Not Found" }"#).expect_err("must fail");

        assert_eq!(error.code, ErrorCode::Internal);
    }

    #[test]
    fn user_agent_carries_the_app_version() {
        assert_eq!(user_agent("1.2.0"), "atril/1.2.0");
    }

    /// Servidor HTTP de un solo uso en un hilo: responde `response` a la primera conexión.
    fn serve_once(response: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0_u8; 4096];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{address}/releases/latest")
    }

    #[test]
    fn http_200_returns_the_body() {
        let url = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
        );

        let body = fetch_release_json(&url, "atril/test").expect("fetch");

        assert_eq!(body, "{}");
    }

    #[test]
    fn rate_limit_is_a_network_error() {
        let url = serve_once(
            "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
        );

        let error = fetch_release_json(&url, "atril/test").expect_err("must fail");

        assert_eq!(error.code, ErrorCode::Network);
    }

    #[test]
    fn closed_port_is_a_network_error() {
        // Puerto libre: se reserva y se suelta, así que nadie escucha en él.
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
            listener.local_addr().expect("addr").port()
        };

        let error = fetch_release_json(&format!("http://127.0.0.1:{port}/"), "atril/test")
            .expect_err("must fail");

        assert_eq!(error.code, ErrorCode::Network);
    }

    /// Petición real a GitHub. No corre en `cargo test`: `cargo test updates -- --ignored --nocapture`.
    #[test]
    #[ignore = "hits the network: run by hand with --ignored"]
    fn live_request_reads_the_latest_release() {
        let check = check(env!("CARGO_PKG_VERSION")).expect("live check");

        println!("live update check: {check:?}");
        assert_eq!(check.current_version, env!("CARGO_PKG_VERSION"));
        assert!(
            check
                .url
                .starts_with("https://github.com/GabJS10/atril/releases/tag/")
        );
    }
}
