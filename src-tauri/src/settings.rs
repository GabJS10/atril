//! Ajustes de la app. Cada ajuste es una fila de `settings` con su valor en JSON.

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;

/// Límites del zoom numérico (1 = 100 %).
const MIN_SCALE: f64 = 0.1;
const MAX_SCALE: f64 = 8.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Language {
    System,
    Es,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewMode {
    Normal,
    Sepia,
    Night,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ZoomPreset {
    PageWidth,
    PageFit,
    Auto,
}

/// `"page_width" | "page_fit" | "auto"` o un número (escala, 1 = 100 %).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Zoom {
    Preset(ZoomPreset),
    Scale(f64),
}

impl Zoom {
    fn is_valid(self) -> bool {
        match self {
            Zoom::Preset(_) => true,
            Zoom::Scale(scale) => scale.is_finite() && (MIN_SCALE..=MAX_SCALE).contains(&scale),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub language: Language,
    pub theme: Theme,
    pub default_zoom: Zoom,
    pub default_view_mode: ViewMode,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: Language::System,
            theme: Theme::Dark,
            default_zoom: Zoom::Preset(ZoomPreset::PageWidth),
            default_view_mode: ViewMode::Normal,
        }
    }
}

/// Solo las claves presentes se cambian (`docs/IPC.md`).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub language: Option<Language>,
    pub theme: Option<Theme>,
    pub default_zoom: Option<Zoom>,
    pub default_view_mode: Option<ViewMode>,
}

impl SettingsPatch {
    fn validate(&self) -> Result<(), AppError> {
        if self.default_zoom.is_some_and(|zoom| !zoom.is_valid()) {
            return Err(AppError::invalid_input(format!(
                "defaultZoom must be a preset or a scale between {MIN_SCALE} and {MAX_SCALE}"
            )));
        }
        Ok(())
    }

    fn apply_to(&self, settings: &mut Settings) {
        if let Some(language) = self.language {
            settings.language = language;
        }
        if let Some(theme) = self.theme {
            settings.theme = theme;
        }
        if let Some(zoom) = self.default_zoom {
            settings.default_zoom = zoom;
        }
        if let Some(view_mode) = self.default_view_mode {
            settings.default_view_mode = view_mode;
        }
    }

    /// Pares clave/valor JSON listos para guardar en la tabla `settings`.
    fn entries(&self) -> Result<Vec<(&'static str, String)>, AppError> {
        let mut entries = Vec::new();
        if let Some(language) = self.language {
            entries.push(("language", encode(&language)?));
        }
        if let Some(theme) = self.theme {
            entries.push(("theme", encode(&theme)?));
        }
        if let Some(zoom) = self.default_zoom {
            entries.push(("defaultZoom", encode(&zoom)?));
        }
        if let Some(view_mode) = self.default_view_mode {
            entries.push(("defaultViewMode", encode(&view_mode)?));
        }
        Ok(entries)
    }
}

fn encode<T: Serialize>(value: &T) -> Result<String, AppError> {
    serde_json::to_string(value).map_err(|error| AppError::internal(error.to_string()))
}

/// Lee los ajustes guardados. Una fila corrupta o desconocida se ignora
/// (queda el valor por defecto) en lugar de romper la pantalla de ajustes.
pub fn load(conn: &Connection) -> Result<Settings, AppError> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut settings = Settings::default();
    for row in rows {
        let (key, raw) = row?;
        match parse_row(&key, &raw) {
            Some(patch) => patch.apply_to(&mut settings),
            None => tracing::warn!(key = %key, "ignoring invalid setting"),
        }
    }
    Ok(settings)
}

/// Aplica `patch` y devuelve los ajustes completos. Si el parche no es válido,
/// no escribe nada.
pub fn update(conn: &mut Connection, patch: &SettingsPatch) -> Result<Settings, AppError> {
    patch.validate()?;
    let entries = patch.entries()?;

    let tx = conn.transaction()?;
    for (key, value) in entries {
        tx.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
    }
    tx.commit()?;

    load(conn)
}

fn parse_row(key: &str, raw: &str) -> Option<SettingsPatch> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let mut object = serde_json::Map::new();
    object.insert(key.to_owned(), value);

    let patch: SettingsPatch = serde_json::from_value(Value::Object(object)).ok()?;
    patch.validate().ok()?;
    Some(patch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use serde_json::json;

    fn open_temp_db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = db::open(&dir.path().join("atril.db")).expect("open");
        (dir, conn)
    }

    #[test]
    fn default_settings_serialize_in_camel_case() {
        let value = serde_json::to_value(Settings::default()).expect("serialize");

        assert_eq!(
            value,
            json!({
                "language": "system",
                "theme": "dark",
                "defaultZoom": "page_width",
                "defaultViewMode": "normal"
            })
        );
    }

    #[test]
    fn numeric_zoom_serializes_as_a_number() {
        let value = serde_json::to_value(Zoom::Scale(1.5)).expect("serialize");

        assert_eq!(value, json!(1.5));
    }

    #[test]
    fn patch_deserializes_only_the_keys_present() {
        let patch: SettingsPatch = serde_json::from_value(json!({
            "theme": "light",
            "defaultZoom": 0.75
        }))
        .expect("deserialize");

        assert_eq!(
            patch,
            SettingsPatch {
                theme: Some(Theme::Light),
                default_zoom: Some(Zoom::Scale(0.75)),
                ..SettingsPatch::default()
            }
        );
    }

    #[test]
    fn patch_rejects_unknown_enum_values() {
        let result = serde_json::from_value::<SettingsPatch>(json!({ "language": "fr" }));

        assert!(result.is_err());
    }

    #[test]
    fn fresh_database_returns_defaults() {
        let (_dir, conn) = open_temp_db();

        assert_eq!(load(&conn).expect("load"), Settings::default());
    }

    #[test]
    fn update_changes_only_the_given_keys_and_persists_them() {
        let (_dir, mut conn) = open_temp_db();
        let patch = SettingsPatch {
            theme: Some(Theme::Light),
            default_view_mode: Some(ViewMode::Sepia),
            ..SettingsPatch::default()
        };

        let updated = update(&mut conn, &patch).expect("update");

        let expected = Settings {
            theme: Theme::Light,
            default_view_mode: ViewMode::Sepia,
            ..Settings::default()
        };
        assert_eq!(updated, expected);
        assert_eq!(load(&conn).expect("reload"), expected);
    }

    #[test]
    fn later_updates_keep_earlier_changes() {
        let (_dir, mut conn) = open_temp_db();
        update(
            &mut conn,
            &SettingsPatch {
                language: Some(Language::En),
                ..SettingsPatch::default()
            },
        )
        .expect("first update");

        let settings = update(
            &mut conn,
            &SettingsPatch {
                theme: Some(Theme::Light),
                ..SettingsPatch::default()
            },
        )
        .expect("second update");

        assert_eq!(settings.language, Language::En);
        assert_eq!(settings.theme, Theme::Light);
    }

    #[test]
    fn invalid_zoom_is_rejected_and_nothing_is_written() {
        let (_dir, mut conn) = open_temp_db();
        let patch = SettingsPatch {
            theme: Some(Theme::Light),
            default_zoom: Some(Zoom::Scale(f64::NAN)),
            ..SettingsPatch::default()
        };

        let error = update(&mut conn, &patch).expect_err("must reject");

        assert_eq!(error.code, crate::error::ErrorCode::InvalidInput);
        assert_eq!(load(&conn).expect("load"), Settings::default());
    }

    #[test]
    fn corrupt_stored_value_falls_back_to_default() {
        let (_dir, conn) = open_temp_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme', 'not json')",
            [],
        )
        .expect("insert");

        assert_eq!(load(&conn).expect("load"), Settings::default());
    }
}
