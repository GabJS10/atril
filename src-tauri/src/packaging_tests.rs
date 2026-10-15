//! La configuración de empaquetado de cada plataforma, leída con los mismos tipos que usa Tauri (que rechazan los
//! campos que no conocen). Un error en `tauri.windows.conf.json` solo se vería al construir el instalador en
//! Windows; así lo detecta la CI de Linux.

use serde_json::Value;
use tauri::utils::config::{
    BundleTarget, BundleType, Config, NSISInstallerMode, WebviewInstallMode,
};

const BASE: &str = include_str!("../tauri.conf.json");
const WINDOWS: &str = include_str!("../tauri.windows.conf.json");

/// JSON Merge Patch (RFC 7396): lo que hace Tauri al unir `tauri.<plataforma>.conf.json` con `tauri.conf.json`.
fn merge(target: &mut Value, patch: &Value) {
    let Value::Object(patch) = patch else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = Value::Object(Default::default());
    }
    if let Value::Object(target) = target {
        for (key, value) in patch {
            if value.is_null() {
                target.remove(key);
            } else {
                merge(target.entry(key.clone()).or_insert(Value::Null), value);
            }
        }
    }
}

/// La configuración de la plataforma: la base, y encima el archivo específico si lo hay.
fn config(platform_patch: Option<&str>) -> Config {
    let mut merged: Value = serde_json::from_str(BASE).expect("tauri.conf.json is JSON");
    if let Some(patch) = platform_patch {
        let patch: Value = serde_json::from_str(patch).expect("the platform config is JSON");
        merge(&mut merged, &patch);
    }
    serde_json::from_value(merged).expect("a config Tauri accepts")
}

#[test]
fn linux_keeps_the_atril_libros_package_and_binary() {
    let config = config(None);

    assert_eq!(config.product_name.as_deref(), Some("atril-libros"));
    assert_eq!(config.main_binary_name, None);
    assert_eq!(config.bundle.targets, BundleTarget::All);
}

#[test]
fn windows_is_called_atril_in_the_installer_the_start_menu_and_the_executable() {
    let config = config(Some(WINDOWS));

    assert_eq!(config.product_name.as_deref(), Some("Atril"));
    assert_eq!(config.main_binary_name.as_deref(), Some("Atril"));
    assert_eq!(config.app.windows[0].title, "Atril");
}

#[test]
fn windows_builds_a_per_user_nsis_installer_in_english_and_spanish() {
    let config = config(Some(WINDOWS));

    assert_eq!(
        config.bundle.targets,
        BundleTarget::List(vec![BundleType::Nsis])
    );
    let windows = &config.bundle.windows;
    assert_eq!(
        windows.webview_install_mode,
        WebviewInstallMode::DownloadBootstrapper { silent: true }
    );
    let nsis = windows.nsis.as_ref().expect("an NSIS section");
    assert_eq!(nsis.install_mode, NSISInstallerMode::CurrentUser);
    assert_eq!(
        nsis.languages.as_deref(),
        Some(["English".to_owned(), "Spanish".to_owned()].as_slice())
    );
    assert!(!nsis.display_language_selector);
}

#[test]
fn the_windows_file_changes_only_what_it_means_to() {
    let linux = config(None);
    let windows = config(Some(WINDOWS));

    assert_eq!(windows.identifier, linux.identifier);
    assert_eq!(windows.version, linux.version);
    assert_eq!(windows.bundle.publisher, linux.bundle.publisher);
    assert_eq!(windows.bundle.icon, linux.bundle.icon);
    assert!(
        windows
            .bundle
            .icon
            .iter()
            .any(|icon| icon == "icons/icon.ico"),
        "the installer and the executable use the .ico"
    );
    assert_eq!(
        windows.bundle.linux, linux.bundle.linux,
        "Linux packaging is untouched"
    );
}
