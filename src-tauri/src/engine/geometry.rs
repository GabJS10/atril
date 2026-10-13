//! Geometría de página idéntica a la de pdf.js.
//!
//! Los subrayados se guardan en espacio de usuario PDF (origen abajo-izquierda) y el front los convierte a
//! píxeles del visor con `page.getViewport({ scale: 1 }).transform` (`src/reader/geometry.ts`, `PageMapping`).
//! Para que el motor nativo no mueva ningún subrayado guardado, este módulo calcula esa misma matriz con el
//! mismo algoritmo que pdf.js (`Page.view`, `Page.rotate`, `Page.userUnit` del worker y `PageViewport`).
//! Es Rust puro, sin MuPDF: se prueba con valores calculados a mano contra pdf.js.

use serde::Serialize;

/// `[x0, y0, x1, y1]` en espacio de usuario PDF.
pub type Rect = [f64; 4];

/// Respaldo de pdf.js cuando una página no tiene `/MediaBox` válida (`LETTER_SIZE_MEDIABOX`).
pub const LETTER: Rect = [0.0, 0.0, 612.0, 792.0];

/// Lo que dice el PDF de una página, ya con la herencia del árbol de páginas aplicada.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageBoxes {
    /// `/MediaBox` ya normalizada, o `None` si falta o no es válida.
    pub media_box: Option<Rect>,
    /// `/CropBox` ya normalizada, o `None` si falta o no es válida.
    pub crop_box: Option<Rect>,
    /// `/Rotate` sin interpretar (puede ser negativo, múltiplo de 360 o disparatado).
    pub rotate: f64,
    /// `/UserUnit` de la página (no se hereda). Cualquier valor no positivo cuenta como 1.
    pub user_unit: f64,
}

impl Default for PageBoxes {
    fn default() -> Self {
        Self {
            media_box: None,
            crop_box: None,
            rotate: 0.0,
            user_unit: 1.0,
        }
    }
}

/// Tamaño y matriz de una página a escala 1, tal como las muestra el visor.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageGeometry {
    /// Ancho en puntos a escala 1, ya rotado (`viewport.width`).
    pub width: f64,
    /// Alto en puntos a escala 1, ya rotado (`viewport.height`).
    pub height: f64,
    /// Espacio de usuario PDF → píxeles del visor a escala 1 (`viewport.transform`).
    pub transform: [f64; 6],
}

/// Ordena las esquinas y exige un área positiva (`lookupNormalRect` + comprobación de `getBoundingBox`).
pub fn normalize_rect(raw: [f64; 4]) -> Option<Rect> {
    if raw.iter().any(|value| !value.is_finite()) {
        return None;
    }
    let rect = [
        raw[0].min(raw[2]),
        raw[1].min(raw[3]),
        raw[0].max(raw[2]),
        raw[1].max(raw[3]),
    ];
    (rect[2] - rect[0] > 0.0 && rect[3] - rect[1] > 0.0).then_some(rect)
}

/// `Util.intersect` de pdf.js: `None` si no se solapan.
fn intersect(a: Rect, b: Rect) -> Option<Rect> {
    let x_low = a[0].max(b[0]);
    let x_high = a[2].min(b[2]);
    if x_low > x_high {
        return None;
    }
    let y_low = a[1].max(b[1]);
    let y_high = a[3].min(b[3]);
    if y_low > y_high {
        return None;
    }
    Some([x_low, y_low, x_high, y_high])
}

/// `Page.view` de pdf.js: la `/CropBox` recortada a la `/MediaBox`; si queda vacía, la `/MediaBox`.
pub fn view_box(boxes: &PageBoxes) -> Rect {
    let media = boxes.media_box.unwrap_or(LETTER);
    let crop = boxes.crop_box.unwrap_or(media);
    if crop != media
        && let Some(view) = intersect(crop, media)
        && view[2] - view[0] > 0.0
        && view[3] - view[1] > 0.0
    {
        return view;
    }
    media
}

/// `Page.rotate` de pdf.js: múltiplos de 90 normalizados a 0..360; cualquier otro valor cuenta como 0.
pub fn normalized_rotation(rotate: f64) -> u16 {
    if !rotate.is_finite() || rotate % 90.0 != 0.0 {
        return 0;
    }
    // `rem_euclid` cubre negativos y >= 360. El resultado es 0, 90, 180 o 270.
    match rotate.rem_euclid(360.0) as u32 {
        90 => 90,
        180 => 180,
        270 => 270,
        _ => 0,
    }
}

/// El `PageViewport` de pdf.js a escala 1 y con la rotación propia de la página.
pub fn page_geometry(boxes: &PageBoxes) -> PageGeometry {
    let view = view_box(boxes);
    let rotation = normalized_rotation(boxes.rotate);
    let user_unit = if boxes.user_unit.is_finite() && boxes.user_unit > 0.0 {
        boxes.user_unit
    } else {
        1.0
    };
    // Escala 1 por la unidad de usuario (`scale *= userUnit` en el constructor de PageViewport).
    let scale = user_unit;
    let center_x = (view[2] + view[0]) / 2.0;
    let center_y = (view[3] + view[1]) / 2.0;

    let (rotate_a, rotate_b, rotate_c, rotate_d) = match rotation {
        180 => (-1.0, 0.0, 0.0, 1.0),
        90 => (0.0, 1.0, 1.0, 0.0),
        270 => (0.0, -1.0, -1.0, 0.0),
        _ => (1.0, 0.0, 0.0, -1.0),
    };
    let (offset_x, offset_y, width, height) = if rotate_a == 0.0 {
        (
            (center_y - view[1]).abs() * scale,
            (center_x - view[0]).abs() * scale,
            (view[3] - view[1]) * scale,
            (view[2] - view[0]) * scale,
        )
    } else {
        (
            (center_x - view[0]).abs() * scale,
            (center_y - view[1]).abs() * scale,
            (view[2] - view[0]) * scale,
            (view[3] - view[1]) * scale,
        )
    };
    // `+ 0.0` convierte los -0 de JS en +0: el JSON queda limpio.
    let transform = [
        rotate_a * scale + 0.0,
        rotate_b * scale + 0.0,
        rotate_c * scale + 0.0,
        rotate_d * scale + 0.0,
        offset_x - rotate_a * scale * center_x - rotate_c * scale * center_y + 0.0,
        offset_y - rotate_b * scale * center_x - rotate_d * scale * center_y + 0.0,
    ];
    PageGeometry {
        width,
        height,
        transform,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boxes(media: Option<Rect>, crop: Option<Rect>, rotate: f64) -> PageBoxes {
        PageBoxes {
            media_box: media,
            crop_box: crop,
            rotate,
            user_unit: 1.0,
        }
    }

    fn assert_close(actual: [f64; 6], expected: [f64; 6]) {
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < 1e-9, "{actual:?} != {expected:?}");
        }
    }

    /// pdf.js: `getViewport({ scale: 1 })` de una página Letter sin rotar.
    #[test]
    fn upright_letter_flips_y_around_the_page_height() {
        let geometry = page_geometry(&boxes(Some(LETTER), None, 0.0));

        assert_eq!((geometry.width, geometry.height), (612.0, 792.0));
        assert_close(geometry.transform, [1.0, 0.0, 0.0, -1.0, 0.0, 792.0]);
    }

    /// Con /Rotate 90 el ancho y el alto se intercambian y (x, y) pasa a (y, x).
    #[test]
    fn rotate_90_swaps_axes() {
        let geometry = page_geometry(&boxes(Some(LETTER), None, 90.0));

        assert_eq!((geometry.width, geometry.height), (792.0, 612.0));
        assert_close(geometry.transform, [0.0, 1.0, 1.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn rotate_180_and_270() {
        let upside_down = page_geometry(&boxes(Some(LETTER), None, 180.0));
        assert_close(upside_down.transform, [-1.0, 0.0, 0.0, 1.0, 612.0, 0.0]);

        let left = page_geometry(&boxes(Some(LETTER), None, 270.0));
        assert_eq!((left.width, left.height), (792.0, 612.0));
        assert_close(left.transform, [0.0, -1.0, -1.0, 0.0, 792.0, 612.0]);
    }

    /// El origen del CropBox desplaza la página: su esquina superior izquierda es el (0, 0) del visor.
    #[test]
    fn shifted_crop_box_moves_the_origin() {
        let geometry = page_geometry(&boxes(Some(LETTER), Some([50.0, 100.0, 550.0, 700.0]), 0.0));

        assert_eq!((geometry.width, geometry.height), (500.0, 600.0));
        assert_close(geometry.transform, [1.0, 0.0, 0.0, -1.0, -50.0, 700.0]);
        // La esquina superior izquierda del CropBox (50, 700) cae en (0, 0).
        let [a, b, c, d, e, f] = geometry.transform;
        let (x, y) = (50.0, 700.0);
        assert_eq!((a * x + c * y + e, b * x + d * y + f), (0.0, 0.0));
    }

    #[test]
    fn crop_box_and_rotation_combine() {
        let geometry = page_geometry(&boxes(
            Some(LETTER),
            Some([50.0, 100.0, 550.0, 700.0]),
            90.0,
        ));

        assert_eq!((geometry.width, geometry.height), (600.0, 500.0));
        // La esquina inferior izquierda del CropBox (50, 100) pasa a (0, 0) con /Rotate 90.
        let [a, b, c, d, e, f] = geometry.transform;
        let (x, y) = (50.0, 100.0);
        let (px, py) = (a * x + c * y + e, b * x + d * y + f);
        assert!(px.abs() < 1e-9 && py.abs() < 1e-9, "({px}, {py})");
    }

    #[test]
    fn crop_box_is_clipped_to_the_media_box() {
        let geometry = page_geometry(&boxes(
            Some([0.0, 0.0, 400.0, 400.0]),
            Some([-100.0, -100.0, 300.0, 300.0]),
            0.0,
        ));

        assert_eq!((geometry.width, geometry.height), (300.0, 300.0));
        assert_close(geometry.transform, [1.0, 0.0, 0.0, -1.0, 0.0, 300.0]);
    }

    #[test]
    fn crop_box_outside_the_media_box_falls_back_to_the_media_box() {
        let view = view_box(&boxes(
            Some([0.0, 0.0, 100.0, 100.0]),
            Some([200.0, 200.0, 300.0, 300.0]),
            0.0,
        ));

        assert_eq!(view, [0.0, 0.0, 100.0, 100.0]);
    }

    #[test]
    fn missing_media_box_is_letter() {
        assert_eq!(view_box(&PageBoxes::default()), LETTER);
    }

    #[test]
    fn odd_rotations_are_normalized_like_pdfjs() {
        assert_eq!(normalized_rotation(-90.0), 270);
        assert_eq!(normalized_rotation(450.0), 90);
        assert_eq!(normalized_rotation(720.0), 0);
        assert_eq!(normalized_rotation(45.0), 0);
        assert_eq!(normalized_rotation(f64::NAN), 0);
    }

    #[test]
    fn user_unit_scales_size_and_matrix() {
        let geometry = page_geometry(&PageBoxes {
            media_box: Some([0.0, 0.0, 100.0, 200.0]),
            user_unit: 2.0,
            ..PageBoxes::default()
        });

        assert_eq!((geometry.width, geometry.height), (200.0, 400.0));
        assert_close(geometry.transform, [2.0, 0.0, 0.0, -2.0, 0.0, 400.0]);
    }

    #[test]
    fn normalize_rect_orders_corners_and_rejects_empty_areas() {
        assert_eq!(
            normalize_rect([10.0, 20.0, 0.0, 5.0]),
            Some([0.0, 5.0, 10.0, 20.0])
        );
        assert_eq!(normalize_rect([0.0, 0.0, 0.0, 10.0]), None);
        assert_eq!(normalize_rect([0.0, 0.0, f64::NAN, 10.0]), None);
    }
}
