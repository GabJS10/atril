//! Subrayados y notas: CRUD y exportación a Markdown (`docs/IPC.md`, fase 3).
//! Los rectángulos van en coordenadas PDF; sirven a cualquier zoom.

use std::collections::BTreeMap;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, ErrorCode};
use crate::library::{self, now_iso};

const MAX_RECTS: usize = 500;
const MAX_TEXT_CHARS: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HighlightColor {
    Ochre,
    Sienna,
    Sage,
    Slate,
}

impl HighlightColor {
    fn as_str(self) -> &'static str {
        match self {
            HighlightColor::Ochre => "ochre",
            HighlightColor::Sienna => "sienna",
            HighlightColor::Sage => "sage",
            HighlightColor::Slate => "slate",
        }
    }

    fn parse(raw: &str) -> Result<Self, AppError> {
        serde_json::from_value(Value::String(raw.to_owned()))
            .map_err(|_| AppError::internal(format!("unknown highlight color {raw}")))
    }
}

/// `x1, y1, x2, y2` en el espacio de usuario PDF.
pub type PdfRect = [f64; 4];

/// Idioma de los textos fijos del Markdown exportado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Es,
    En,
}

impl Language {
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        serde_json::from_value(Value::String(raw.to_owned()))
            .map_err(|_| AppError::invalid_input("language must be \"es\" or \"en\""))
    }
}

/// Argumento `highlight` de `create_highlight`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightInput {
    pub book_id: String,
    pub page: i64,
    pub rects: Vec<PdfRect>,
    pub text: String,
    pub color: HighlightColor,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: String,
    pub book_id: String,
    pub page: i64,
    pub rects: Vec<PdfRect>,
    pub text: String,
    pub color: HighlightColor,
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Cambios de `update_highlight`. `note`: `None` = no cambia; `Some(None)` = borra la nota.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HighlightPatch {
    pub color: Option<HighlightColor>,
    pub note: Option<Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub count: usize,
}

/// Lee `{ highlightId, color?, note? }` del cuerpo de `update_highlight`.
/// Distingue la nota ausente (no cambia) de `null` (la borra).
pub fn parse_update(body: &Value) -> Result<(String, HighlightPatch), AppError> {
    let object = body
        .as_object()
        .ok_or_else(|| AppError::invalid_input("update_highlight expects an object"))?;
    let id = object
        .get("highlightId")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid_input("highlightId must be a string"))?
        .to_owned();

    let color = match object.get("color") {
        None => None,
        Some(value) => Some(
            serde_json::from_value::<HighlightColor>(value.clone())
                .map_err(|error| AppError::invalid_input(error.to_string()))?,
        ),
    };
    let note = match object.get("note") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(text)) => Some(Some(text.clone())),
        Some(_) => return Err(AppError::invalid_input("note must be a string or null")),
    };

    if color.is_none() && note.is_none() {
        return Err(AppError::invalid_input(
            "update_highlight needs color or note",
        ));
    }
    Ok((id, HighlightPatch { color, note }))
}

/// Ordena y valida los rectángulos: `x1 <= x2`, `y1 <= y2`, área no nula, entre 1 y 500.
pub fn normalize_rects(rects: &[PdfRect]) -> Result<Vec<PdfRect>, AppError> {
    if rects.is_empty() || rects.len() > MAX_RECTS {
        return Err(AppError::invalid_input(format!(
            "rects must have 1 to {MAX_RECTS} items"
        )));
    }
    rects
        .iter()
        .map(|rect| {
            if rect.iter().any(|value| !value.is_finite()) {
                return Err(AppError::invalid_input(
                    "rect coordinates must be finite numbers",
                ));
            }
            let normalized = [
                rect[0].min(rect[2]),
                rect[1].min(rect[3]),
                rect[0].max(rect[2]),
                rect[1].max(rect[3]),
            ];
            if normalized[2] <= normalized[0] || normalized[3] <= normalized[1] {
                return Err(AppError::invalid_input("rect has no area"));
            }
            Ok(normalized)
        })
        .collect()
}

fn check_text(text: &str, field: &str) -> Result<(), AppError> {
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(AppError::invalid_input(format!(
            "{field} is longer than {MAX_TEXT_CHARS} characters"
        )));
    }
    Ok(())
}

/// Una nota vacía o solo con espacios es "sin nota".
fn normalize_note(note: Option<String>) -> Result<Option<String>, AppError> {
    match note {
        None => Ok(None),
        Some(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            check_text(trimmed, "note")?;
            Ok(Some(trimmed.to_owned()))
        }
    }
}

pub fn create(conn: &Connection, input: HighlightInput) -> Result<Highlight, AppError> {
    let book = library::get_book(conn, &input.book_id)?;
    if input.page < 1 || book.page_count.is_some_and(|count| input.page > count) {
        return Err(AppError::invalid_input(format!(
            "page {} is outside the book",
            input.page
        )));
    }
    let rects = normalize_rects(&input.rects)?;
    check_text(&input.text, "text")?;
    let note = normalize_note(input.note)?;

    let now = now_iso();
    let highlight = Highlight {
        id: uuid::Uuid::new_v4().to_string(),
        book_id: input.book_id,
        page: input.page,
        rects,
        text: input.text,
        color: input.color,
        note,
        created_at: now.clone(),
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO highlights (id, book_id, page, rects, text, color, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            highlight.id,
            highlight.book_id,
            highlight.page,
            encode_rects(&highlight.rects)?,
            highlight.text,
            highlight.color.as_str(),
            highlight.note,
            highlight.created_at,
            highlight.updated_at
        ],
    )?;
    Ok(highlight)
}

/// Subrayados de un libro, opcionalmente de una página, por página y fecha de creación.
pub fn list(
    conn: &Connection,
    book_id: &str,
    page: Option<i64>,
) -> Result<Vec<Highlight>, AppError> {
    library::get_book(conn, book_id)?;
    let mut stmt = conn.prepare(
        "SELECT id, book_id, page, rects, text, color, note, created_at, updated_at
         FROM highlights
         WHERE book_id = ?1 AND (?2 IS NULL OR page = ?2)
         ORDER BY page, created_at, id",
    )?;
    let rows = stmt
        .query_map(params![book_id, page], read_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter().map(finish_row).collect()
}

pub fn update(conn: &Connection, id: &str, patch: &HighlightPatch) -> Result<Highlight, AppError> {
    let current = find(conn, id)?;
    let now = now_iso();
    let color = patch.color.unwrap_or(current.color);
    let note = match &patch.note {
        None => current.note.clone(),
        Some(note) => normalize_note(note.clone())?,
    };
    conn.execute(
        "UPDATE highlights SET color = ?1, note = ?2, updated_at = ?3 WHERE id = ?4",
        params![color.as_str(), note, now, id],
    )?;
    Ok(Highlight {
        color,
        note,
        updated_at: now,
        ..current
    })
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), AppError> {
    find(conn, id)?;
    conn.execute("DELETE FROM highlights WHERE id = ?1", params![id])?;
    Ok(())
}

/// Escribe el Markdown del libro en `dest` (ruta absoluta; el directorio ya debe existir).
/// Escribe a un temporal junto a `dest` y lo renombra al final.
pub fn export(
    conn: &Connection,
    book_id: &str,
    dest: &Path,
    language: Language,
    date: &str,
) -> Result<ExportResult, AppError> {
    let book = library::get_book(conn, book_id)?;
    let highlights = list(conn, book_id, None)?;

    if !dest.is_absolute() {
        return Err(AppError::invalid_input("destPath must be an absolute path"));
    }
    let (Some(parent), Some(file_name)) = (dest.parent(), dest.file_name()) else {
        return Err(AppError::invalid_input("destPath must name a file"));
    };
    if !parent.is_dir() {
        return Err(AppError::invalid_input(format!(
            "folder {} does not exist",
            parent.display()
        )));
    }

    let markdown = render_markdown(
        &book.title,
        book.author.as_deref(),
        &highlights,
        language,
        date,
    );
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        file_name.to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    if let Err(error) = std::fs::write(&temp, markdown).and_then(|()| std::fs::rename(&temp, dest))
    {
        let _ = std::fs::remove_file(&temp);
        return Err(error.into());
    }
    Ok(ExportResult {
        count: highlights.len(),
    })
}

/// Textos fijos del Markdown (regla 10 de `docs/IPC.md`).
struct Labels {
    heading_exported: &'static str,
    none: &'static str,
    page: &'static str,
    no_text: &'static str,
    one: &'static str,
    many: &'static str,
}

impl Labels {
    fn of(language: Language) -> Self {
        match language {
            Language::Es => Labels {
                heading_exported: "Subrayados exportados desde Atril el",
                none: "*Sin subrayados.*",
                page: "Página",
                no_text: "*(sin texto)*",
                one: "1 subrayado",
                many: "subrayados",
            },
            Language::En => Labels {
                heading_exported: "Highlights exported from Atril on",
                none: "*No highlights.*",
                page: "Page",
                no_text: "*(no text)*",
                one: "1 highlight",
                many: "highlights",
            },
        }
    }

    fn count(&self, count: usize) -> String {
        if count == 1 {
            self.one.to_owned()
        } else {
            format!("{count} {}", self.many)
        }
    }
}

/// Markdown de la exportación. Función pura: `date` la pone quien llama (AAAA-MM-DD, UTC).
pub fn render_markdown(
    title: &str,
    author: Option<&str>,
    highlights: &[Highlight],
    language: Language,
    date: &str,
) -> String {
    let labels = Labels::of(language);

    let mut heading = format!("# {}", escape(title));
    if let Some(author) = author {
        heading.push_str(&format!("\n*{}*", escape(author)));
    }
    let mut blocks = vec![
        heading,
        format!(
            "{} {date} · {}",
            labels.heading_exported,
            labels.count(highlights.len())
        ),
    ];

    if highlights.is_empty() {
        blocks.push(labels.none.to_owned());
    }

    let mut pages: BTreeMap<i64, Vec<&Highlight>> = BTreeMap::new();
    for highlight in highlights {
        pages.entry(highlight.page).or_default().push(highlight);
    }
    for (page, mut items) in pages {
        items.sort_by(|a, b| {
            reading_top(b)
                .total_cmp(&reading_top(a))
                .then_with(|| reading_left(a).total_cmp(&reading_left(b)))
                .then_with(|| a.created_at.cmp(&b.created_at))
        });
        blocks.push(format!("## {} {page}", labels.page));
        for highlight in items {
            blocks.push(quote(&highlight.text, &labels));
            if let Some(note) = &highlight.note {
                blocks.push(note.lines().map(escape).collect::<Vec<_>>().join("\n"));
            }
        }
    }

    let mut markdown = blocks.join("\n\n");
    markdown.push('\n');
    markdown
}

/// Cita de una sola línea: los espacios internos se colapsan.
fn quote(text: &str, labels: &Labels) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        format!("> {}", labels.no_text)
    } else {
        format!("> {}", escape(&collapsed))
    }
}

/// Escapa los caracteres de Markdown que el usuario no quiere como formato.
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '\\' | '*' | '_' | '#' | '[' | ']' | '<' | '>' | '`') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Borde superior y lateral izquierdo de un subrayado, para ordenar como se lee.
fn reading_top(highlight: &Highlight) -> f64 {
    highlight
        .rects
        .iter()
        .map(|rect| rect[3])
        .fold(f64::NEG_INFINITY, f64::max)
}

fn reading_left(highlight: &Highlight) -> f64 {
    highlight
        .rects
        .iter()
        .map(|rect| rect[0])
        .fold(f64::INFINITY, f64::min)
}

fn find(conn: &Connection, id: &str) -> Result<Highlight, AppError> {
    let row = conn
        .query_row(
            "SELECT h.id, h.book_id, h.page, h.rects, h.text, h.color, h.note, h.created_at, h.updated_at
             FROM highlights h
             JOIN books b ON b.id = h.book_id
             WHERE h.id = ?1 AND b.removed_at IS NULL",
            params![id],
            read_row,
        )
        .optional()?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, format!("no highlight with id {id}")))?;
    finish_row(row)
}

/// Fila sin decodificar: el JSON y el color se convierten fuera del closure de rusqlite.
type RawRow = (
    String,
    String,
    i64,
    String,
    String,
    String,
    Option<String>,
    String,
    String,
);

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
    ))
}

fn finish_row(raw: RawRow) -> Result<Highlight, AppError> {
    let (id, book_id, page, rects, text, color, note, created_at, updated_at) = raw;
    Ok(Highlight {
        id,
        book_id,
        page,
        rects: serde_json::from_str(&rects).map_err(|error| AppError::db(error.to_string()))?,
        text,
        color: HighlightColor::parse(&color)?,
        note,
        created_at,
        updated_at,
    })
}

fn encode_rects(rects: &[PdfRect]) -> Result<String, AppError> {
    serde_json::to_string(rects).map_err(|error| AppError::internal(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::remove_book;
    use crate::test_support::{import, open_temp_db, write_pdf};
    use serde_json::json;

    fn input(book_id: &str, page: i64, y: f64, text: &str) -> HighlightInput {
        HighlightInput {
            book_id: book_id.to_owned(),
            page,
            rects: vec![[72.0, y - 12.0, 300.0, y]],
            text: text.to_owned(),
            color: HighlightColor::Ochre,
            note: None,
        }
    }

    fn sample(id: &str, page: i64, y: f64, text: &str, note: Option<&str>) -> Highlight {
        Highlight {
            id: id.to_owned(),
            book_id: "libro".into(),
            page,
            rects: vec![[72.0, y - 12.0, 300.0, y]],
            text: text.to_owned(),
            color: HighlightColor::Ochre,
            note: note.map(str::to_owned),
            created_at: "2026-10-11T10:00:00.000Z".into(),
            updated_at: "2026-10-11T10:00:00.000Z".into(),
        }
    }

    /// Pedro Páramo, con la misma historia que el ejemplo de docs/IPC.md.
    fn golden_highlights() -> Vec<Highlight> {
        vec![
            sample(
                "h3",
                7,
                300.0,
                "Ya no hay nada que hacer, cuando todo está perdido",
                None,
            ),
            sample("h2", 2, 500.0, "Un subrayado sin nota", None),
            sample(
                "h1",
                2,
                700.0,
                "Vine a Comala porque me dijeron que acá vivía mi padre",
                Some("Esta es la primera frase, la que lo cambia todo."),
            ),
        ]
    }

    #[test]
    fn create_list_update_delete_round_trip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));

        let created = create(&conn, input(&book.id, 2, 600.0, "uno")).expect("create");
        assert_eq!(created.id.len(), 36, "uuid generated by the backend");
        assert_eq!(created.note, None);
        assert_eq!(created.created_at, created.updated_at);
        create(&conn, input(&book.id, 1, 600.0, "otro")).expect("second");

        let all = list(&conn, &book.id, None).expect("list");
        assert_eq!(all.iter().map(|h| h.page).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(list(&conn, &book.id, Some(2)).expect("page").len(), 1);

        let recolored = update(
            &conn,
            &created.id,
            &HighlightPatch {
                color: Some(HighlightColor::Sage),
                note: None,
            },
        )
        .expect("color");
        assert_eq!(recolored.color, HighlightColor::Sage);
        assert_eq!(recolored.text, "uno");

        delete(&conn, &created.id).expect("delete");
        assert_eq!(list(&conn, &book.id, None).expect("list").len(), 1);
        assert_eq!(
            delete(&conn, &created.id).expect_err("gone").code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn note_has_three_states() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        let mut with_note = input(&book.id, 1, 600.0, "x");
        with_note.note = Some("  una nota  ".into());
        let h = create(&conn, with_note).expect("create");
        assert_eq!(h.note.as_deref(), Some("una nota"), "trimmed");

        let unchanged = update(
            &conn,
            &h.id,
            &HighlightPatch {
                color: Some(HighlightColor::Slate),
                note: None,
            },
        )
        .expect("absent note");
        assert_eq!(unchanged.note.as_deref(), Some("una nota"));

        let replaced = update(
            &conn,
            &h.id,
            &HighlightPatch {
                color: None,
                note: Some(Some("otra".into())),
            },
        )
        .expect("replace");
        assert_eq!(replaced.note.as_deref(), Some("otra"));

        let cleared = update(
            &conn,
            &h.id,
            &HighlightPatch {
                color: None,
                note: Some(None),
            },
        )
        .expect("clear");
        assert_eq!(cleared.note, None);
    }

    #[test]
    fn parse_update_reads_absent_null_and_string_notes() {
        let (id, patch) =
            parse_update(&json!({ "highlightId": "h", "color": "sage" })).expect("color only");
        assert_eq!((id.as_str(), patch.note), ("h", None));

        let (_, patch) = parse_update(&json!({ "highlightId": "h", "note": null })).expect("null");
        assert_eq!(patch.note, Some(None));

        let (_, patch) = parse_update(&json!({ "highlightId": "h", "note": "x" })).expect("string");
        assert_eq!(patch.note, Some(Some("x".to_owned())));

        assert_eq!(
            parse_update(&json!({ "highlightId": "h" }))
                .expect_err("empty")
                .code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            parse_update(&json!({ "highlightId": "h", "color": "red" }))
                .expect_err("color")
                .code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            parse_update(&json!({ "highlightId": "h", "note": 3 }))
                .expect_err("note")
                .code,
            ErrorCode::InvalidInput
        );
    }

    #[test]
    fn rects_are_normalized_and_bad_ones_rejected() {
        let reversed = normalize_rects(&[[300.0, 200.0, 72.0, 188.0]]).expect("reversed");
        assert_eq!(reversed, vec![[72.0, 188.0, 300.0, 200.0]]);

        assert_eq!(
            normalize_rects(&[[1.0, 1.0, 1.0, 5.0]])
                .expect_err("zero width")
                .code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            normalize_rects(&[[f64::NAN, 0.0, 1.0, 1.0]])
                .expect_err("nan")
                .code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            normalize_rects(&[]).expect_err("none").code,
            ErrorCode::InvalidInput
        );
        let too_many = vec![[0.0, 0.0, 1.0, 1.0]; MAX_RECTS + 1];
        assert_eq!(
            normalize_rects(&too_many).expect_err("too many").code,
            ErrorCode::InvalidInput
        );
    }

    #[test]
    fn create_validates_page_text_and_note_length() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        library::save_reading_state(
            &mut conn,
            &book.id,
            &library::ReadingStateInput {
                page: 1,
                offset_in_page: 0.0,
                zoom: crate::settings::Zoom::Preset(crate::settings::ZoomPreset::PageWidth),
                view_mode: crate::settings::ViewMode::Normal,
                page_count: 10,
            },
        )
        .expect("set page count");

        assert_eq!(
            create(&conn, input(&book.id, 11, 600.0, "x"))
                .expect_err("beyond")
                .code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            create(&conn, input(&book.id, 0, 600.0, "x"))
                .expect_err("page 0")
                .code,
            ErrorCode::InvalidInput
        );
        let long = "x".repeat(MAX_TEXT_CHARS + 1);
        assert_eq!(
            create(&conn, input(&book.id, 1, 600.0, &long))
                .expect_err("text")
                .code,
            ErrorCode::InvalidInput
        );
        let mut blank_note = input(&book.id, 1, 600.0, "");
        blank_note.note = Some("   ".into());
        assert_eq!(create(&conn, blank_note).expect("empty text ok").note, None);
        assert_eq!(
            create(&conn, input("nope", 1, 600.0, "x"))
                .expect_err("book")
                .code,
            ErrorCode::NotFound
        );
    }

    #[test]
    fn highlights_of_removed_books_are_not_found_but_kept() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let path = write_pdf(dir.path(), "a.pdf", 1);
        let book = import(&mut conn, &path);
        let h = create(&conn, input(&book.id, 1, 600.0, "x")).expect("create");
        remove_book(&conn, &book.id).expect("remove");

        assert_eq!(
            list(&conn, &book.id, None).expect_err("list").code,
            ErrorCode::NotFound
        );
        assert_eq!(
            update(
                &conn,
                &h.id,
                &HighlightPatch {
                    color: Some(HighlightColor::Sage),
                    note: None
                }
            )
            .expect_err("update")
            .code,
            ErrorCode::NotFound
        );

        import(&mut conn, &path);
        assert_eq!(list(&conn, &book.id, None).expect("back").len(), 1);
    }

    #[test]
    fn golden_markdown_matches_the_contract_example_in_spanish() {
        let md = render_markdown(
            "Pedro Páramo",
            Some("Juan Rulfo"),
            &golden_highlights(),
            Language::Es,
            "2026-10-11",
        );

        assert_eq!(
            md,
            "# Pedro Páramo\n*Juan Rulfo*\n\n\
             Subrayados exportados desde Atril el 2026-10-11 · 3 subrayados\n\n\
             ## Página 2\n\n\
             > Vine a Comala porque me dijeron que acá vivía mi padre\n\n\
             Esta es la primera frase, la que lo cambia todo.\n\n\
             > Un subrayado sin nota\n\n\
             ## Página 7\n\n\
             > Ya no hay nada que hacer, cuando todo está perdido\n"
        );
    }

    #[test]
    fn golden_markdown_in_english() {
        let md = render_markdown(
            "Pedro Páramo",
            Some("Juan Rulfo"),
            &golden_highlights(),
            Language::En,
            "2026-10-11",
        );

        assert_eq!(
            md,
            "# Pedro Páramo\n*Juan Rulfo*\n\n\
             Highlights exported from Atril on 2026-10-11 · 3 highlights\n\n\
             ## Page 2\n\n\
             > Vine a Comala porque me dijeron que acá vivía mi padre\n\n\
             Esta es la primera frase, la que lo cambia todo.\n\n\
             > Un subrayado sin nota\n\n\
             ## Page 7\n\n\
             > Ya no hay nada que hacer, cuando todo está perdido\n"
        );
    }

    #[test]
    fn empty_book_and_singular_counts() {
        let es = render_markdown("T", None, &[], Language::Es, "2026-01-02");
        assert_eq!(
            es,
            "# T\n\nSubrayados exportados desde Atril el 2026-01-02 · 0 subrayados\n\n*Sin subrayados.*\n"
        );

        let en = render_markdown("T", None, &[], Language::En, "2026-01-02");
        assert!(en.ends_with("· 0 highlights\n\n*No highlights.*\n"), "{en}");

        let one = render_markdown(
            "T",
            None,
            &[sample("a", 1, 500.0, "solo", None)],
            Language::Es,
            "2026-01-02",
        );
        assert!(one.contains("· 1 subrayado\n"));
        let one_en = render_markdown(
            "T",
            None,
            &[sample("a", 1, 500.0, "solo", None)],
            Language::En,
            "2026-01-02",
        );
        assert!(one_en.contains("· 1 highlight\n"));
    }

    #[test]
    fn export_orders_top_to_bottom_then_left_to_right_within_a_page() {
        let mut same_line_right = sample("r", 1, 500.0, "derecha", None);
        same_line_right.rects = vec![[400.0, 488.0, 500.0, 500.0]];
        let mut same_line_left = sample("l", 1, 500.0, "izquierda", None);
        same_line_left.rects = vec![[72.0, 488.0, 150.0, 500.0]];
        let lower = sample("b", 1, 200.0, "abajo", None);
        let upper = sample("t", 1, 700.0, "arriba", None);

        let md = render_markdown(
            "T",
            None,
            &[lower, same_line_right, same_line_left, upper],
            Language::En,
            "2026-01-02",
        );

        let order: Vec<&str> = md.lines().filter(|l| l.starts_with("> ")).collect();
        assert_eq!(
            order,
            vec!["> arriba", "> izquierda", "> derecha", "> abajo"]
        );
    }

    #[test]
    fn markdown_characters_are_escaped_and_text_is_collapsed() {
        let text = "  *negrita* _cursiva_ #titulo [enlace] <b> `code` \\ a\n\n  b ";
        let md = render_markdown(
            "Título *raro*",
            Some("_autor_"),
            &[sample("e", 1, 500.0, text, Some("# nota\n> x"))],
            Language::Es,
            "2026-01-02",
        );

        assert!(
            md.starts_with("# Título \\*raro\\*\n*\\_autor\\_*\n"),
            "{md}"
        );
        assert!(
            md.contains(
                "> \\*negrita\\* \\_cursiva\\_ \\#titulo \\[enlace\\] \\<b\\> \\`code\\` \\\\ a b\n"
            ),
            "{md}"
        );
        assert!(md.contains("\\# nota\n\\> x\n"), "{md}");
    }

    #[test]
    fn export_writes_atomically_and_validates_the_destination() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (_db, mut conn) = open_temp_db();
        let book = import(&mut conn, &write_pdf(dir.path(), "a.pdf", 1));
        create(&conn, input(&book.id, 1, 600.0, "uno")).expect("create");
        let out = dir.path().join("salida.md");

        let result = export(&conn, &book.id, &out, Language::Es, "2026-01-02").expect("export");

        assert_eq!(result.count, 1);
        let written = std::fs::read_to_string(&out).expect("read");
        assert!(written.contains("> uno"));
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .expect("dir")
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temporary file renamed away");

        assert_eq!(
            export(
                &conn,
                &book.id,
                std::path::Path::new("relativa.md"),
                Language::Es,
                "2026-01-02"
            )
            .expect_err("relative")
            .code,
            ErrorCode::InvalidInput
        );
        let missing_dir = dir.path().join("no-existe").join("x.md");
        assert_eq!(
            export(&conn, &book.id, &missing_dir, Language::Es, "2026-01-02")
                .expect_err("dir")
                .code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            export(&conn, "nope", &out, Language::Es, "2026-01-02")
                .expect_err("book")
                .code,
            ErrorCode::NotFound
        );
        assert!(Language::parse("fr").is_err());
        assert_eq!(Language::parse("en").expect("en"), Language::En);
    }
}
