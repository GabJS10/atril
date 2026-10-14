//! Color dominante de una portada (`Book.coverColor`, docs/IPC.md v1.1).
//!
//! [`dominant_color`] es una función pura sobre los píxeles RGB. Lo calcula el indexador con los píxeles que ya
//! renderiza MuPDF para la portada, y [`color_from_cover_file`] lo calcula a partir de un `covers/<id>.jpg` que ya
//! existe (libros indexados antes de que hubiera color).
//!
//! Algoritmo:
//! 1. Se descartan los píxeles casi blancos, casi negros y grises (saturación baja): la página de un libro es
//!    papel y tinta, y eso no dice nada de la portada.
//! 2. El resto se agrupa en 12 matices (30° cada uno) x 3 saturaciones x 3 valores = 108 grupos, y cada píxel
//!    pesa `0,2 + saturación²`: un bloque pequeño pero vivo gana a un fondo apagado.
//! 3. Gana el grupo de más peso (el primero en caso de empate, así el resultado es determinista) y el color es la
//!    media de sus píxeles, con lo que no queda un cuantizado tosco.
//! 4. Si queda menos de un 0,5 % de píxeles con color (ruido de compresión, una mota), no hay color: se devuelve
//!    el gris medio de la portada.

use std::io::Cursor;
use std::path::Path;

use image::{ImageDecoder, ImageReader};

use crate::library::CoverFormat;

/// Por debajo de este valor (máximo de los canales, 0-255) un píxel es casi negro.
const MIN_VALUE: u8 = 28;
/// Si el mínimo de los canales supera esto, el píxel es casi blanco.
const MAX_FLOOR: u8 = 228;
/// Saturación HSV mínima (0-1) para considerar que un píxel tiene color.
const MIN_SATURATION: f32 = 0.20;
/// Fracción mínima de píxeles con color para que haya color dominante.
const MIN_COLORED_FRACTION: f64 = 0.005;
/// Lado máximo de una portada que se decodifica para el respaldo (las generadas miden 400 px de ancho).
const MAX_DECODE_SIDE: u32 = 4096;

const HUE_BINS: usize = 12;
const SATURATION_BINS: usize = 3;
const VALUE_BINS: usize = 3;

#[derive(Default, Clone, Copy)]
struct Bin {
    weight: f64,
    r: f64,
    g: f64,
    b: f64,
}

/// Color más representativo de `rgb` (3 bytes por píxel), como `#rrggbb` en minúsculas.
/// `None` si no hay ningún píxel.
pub fn dominant_color(rgb: &[u8]) -> Option<String> {
    let pixels = rgb.len() / 3;
    if pixels == 0 {
        return None;
    }
    let mut bins = [Bin::default(); HUE_BINS * SATURATION_BINS * VALUE_BINS];
    let mut colored = 0usize;
    let mut luma_sum = 0.0f64;

    for pixel in rgb.as_chunks::<3>().0 {
        let (r, g, b) = (pixel[0], pixel[1], pixel[2]);
        luma_sum += 0.299 * f64::from(r) + 0.587 * f64::from(g) + 0.114 * f64::from(b);

        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        if max < MIN_VALUE || min > MAX_FLOOR {
            continue;
        }
        let delta = f32::from(max - min);
        let saturation = delta / f32::from(max);
        if saturation < MIN_SATURATION {
            continue;
        }

        let hue = hue_degrees(r, g, b, max, min);
        // Los grupos de matiz van centrados en 0°, 30°, 60°… para que el rojo no quede partido en dos.
        let hue_bin = (((hue + 15.0) / 30.0) as usize) % HUE_BINS;
        let saturation_bin =
            ((saturation * SATURATION_BINS as f32) as usize).min(SATURATION_BINS - 1);
        let value_bin = ((f32::from(max) / 256.0 * VALUE_BINS as f32) as usize).min(VALUE_BINS - 1);
        let bin = &mut bins[(hue_bin * SATURATION_BINS + saturation_bin) * VALUE_BINS + value_bin];

        let weight = 0.2 + f64::from(saturation * saturation);
        bin.weight += weight;
        bin.r += weight * f64::from(r);
        bin.g += weight * f64::from(g);
        bin.b += weight * f64::from(b);
        colored += 1;
    }

    if (colored as f64) < pixels as f64 * MIN_COLORED_FRACTION || colored == 0 {
        let gray = (luma_sum / pixels as f64).round().clamp(0.0, 255.0) as u8;
        return Some(hex(gray, gray, gray));
    }

    let mut best: Option<&Bin> = None;
    for bin in &bins {
        if bin.weight > 0.0 && best.is_none_or(|current| bin.weight > current.weight) {
            best = Some(bin);
        }
    }
    let bin = best?;
    let channel = |sum: f64| (sum / bin.weight).round().clamp(0.0, 255.0) as u8;
    Some(hex(channel(bin.r), channel(bin.g), channel(bin.b)))
}

/// Matiz en grados (0-360) de un píxel con `max > min`.
fn hue_degrees(r: u8, g: u8, b: u8, max: u8, min: u8) -> f32 {
    let delta = f32::from(max - min);
    let (rf, gf, bf) = (f32::from(r), f32::from(g), f32::from(b));
    let hue = if max == r {
        ((gf - bf) / delta).rem_euclid(6.0)
    } else if max == g {
        (bf - rf) / delta + 2.0
    } else {
        (rf - gf) / delta + 4.0
    };
    (hue * 60.0).rem_euclid(360.0)
}

fn hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// `true` si `value` tiene la forma `#rrggbb` en minúsculas.
pub fn is_valid_hex(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Calcula el color a partir de los bytes de una portada JPEG o WebP ya generada.
pub fn color_from_cover_bytes(bytes: &[u8]) -> Result<String, String> {
    let format = CoverFormat::detect(bytes).ok_or("not a JPEG or WebP image")?;
    let format = match format {
        CoverFormat::Jpeg => image::ImageFormat::Jpeg,
        CoverFormat::Webp => image::ImageFormat::WebP,
    };
    let reader = ImageReader::with_format(Cursor::new(bytes), format);
    let decoder = reader.into_decoder().map_err(|error| error.to_string())?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 || width > MAX_DECODE_SIDE || height > MAX_DECODE_SIDE {
        return Err(format!("unexpected cover size {width}x{height}"));
    }
    let image = image::DynamicImage::from_decoder(decoder).map_err(|error| error.to_string())?;
    dominant_color(image.to_rgb8().as_raw()).ok_or_else(|| "empty image".to_string())
}

/// Lee `covers/<id>.jpg` (o `.webp`) y calcula su color. `Err` con el motivo si falta o no se puede decodificar.
pub fn color_from_cover_file(covers_dir: &Path, id: &str) -> Result<String, String> {
    for format in [CoverFormat::Jpeg, CoverFormat::Webp] {
        let path = covers_dir.join(format!("{id}.{}", format.extension()));
        match std::fs::read(&path) {
            Ok(bytes) => return color_from_cover_bytes(&bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("cover file not found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: usize = 100;
    const H: usize = 150;

    fn solid(color: [u8; 3]) -> Vec<u8> {
        (0..W * H).flat_map(|_| color).collect()
    }

    /// Rellena el rectángulo `[x0, x1) x [y0, y1)`.
    fn fill(buffer: &mut [u8], x0: usize, y0: usize, x1: usize, y1: usize, color: [u8; 3]) {
        for y in y0..y1 {
            for x in x0..x1 {
                let at = (y * W + x) * 3;
                buffer[at..at + 3].copy_from_slice(&color);
            }
        }
    }

    fn parse(color: &str) -> [u8; 3] {
        assert!(is_valid_hex(color), "{color}");
        let value = |at: usize| u8::from_str_radix(&color[at..at + 2], 16).expect("hex");
        [value(1), value(3), value(5)]
    }

    fn encode(color: [u8; 3]) -> String {
        hex(color[0], color[1], color[2])
    }

    #[test]
    fn empty_input_has_no_color() {
        assert_eq!(dominant_color(&[]), None);
        assert_eq!(dominant_color(&[1, 2]), None);
    }

    #[test]
    fn white_cover_with_a_red_block_is_red() {
        let mut cover = solid([255, 255, 255]);
        fill(&mut cover, 20, 40, 80, 100, [200, 30, 30]);

        let [r, g, b] = parse(&dominant_color(&cover).expect("color"));

        assert!(r > 150 && g < 70 && b < 70, "{r},{g},{b}");
    }

    #[test]
    fn a_small_vivid_block_beats_a_big_dull_background() {
        // Fondo marrón apagado (saturación justo por encima del umbral) y un bloque azul vivo más pequeño.
        let mut cover = solid([140, 118, 108]);
        fill(&mut cover, 0, 0, W, 45, [20, 60, 220]);

        let [r, _, b] = parse(&dominant_color(&cover).expect("color"));

        assert!(b > 150 && r < 80, "expected blue, got {r},_,{b}");
    }

    #[test]
    fn grayscale_cover_gives_a_gray() {
        let mut cover = solid([255, 255, 255]);
        fill(&mut cover, 10, 10, 90, 60, [0, 0, 0]);
        fill(&mut cover, 10, 80, 90, 140, [128, 128, 128]);

        let [r, g, b] = parse(&dominant_color(&cover).expect("color"));

        assert!(r == g && g == b, "{r},{g},{b}");
        assert!(r > 60 && r < 230, "{r}");
    }

    #[test]
    fn pure_white_and_pure_black_covers_are_gray_extremes() {
        assert_eq!(
            dominant_color(&solid([255, 255, 255])).as_deref(),
            Some("#ffffff")
        );
        assert_eq!(
            dominant_color(&solid([0, 0, 0])).as_deref(),
            Some("#000000")
        );
    }

    #[test]
    fn dark_saturated_blue_cover_is_blue() {
        let cover = solid([10, 20, 90]);

        let [r, g, b] = parse(&dominant_color(&cover).expect("color"));

        assert!(b > 70 && b > r + 40 && b > g + 30, "{r},{g},{b}");
    }

    #[test]
    fn near_black_and_near_white_noise_is_not_a_color() {
        // Un negro con matiz (3, 0, 10) y un blanco crema (252, 250, 240) son tinta y papel.
        let mut cover = solid([252, 250, 240]);
        fill(&mut cover, 0, 0, W, 60, [3, 0, 10]);

        let [r, g, b] = parse(&dominant_color(&cover).expect("color"));

        assert!(r == g && g == b, "{r},{g},{b}");
    }

    #[test]
    fn a_few_colored_pixels_are_not_enough() {
        let mut cover = solid([240, 240, 240]);
        fill(&mut cover, 0, 0, 3, 3, [255, 0, 0]); // 9 de 15.000 píxeles (0,06 %)

        let [r, g, b] = parse(&dominant_color(&cover).expect("color"));

        assert!(r == g && g == b);
    }

    #[test]
    fn red_is_not_split_across_the_hue_wrap() {
        // Rojos con matiz poco por encima y por debajo de 0°: son el mismo grupo.
        let mut cover = solid([255, 255, 255]);
        fill(&mut cover, 0, 0, W, 50, [220, 20, 40]);
        fill(&mut cover, 0, 50, W, 100, [220, 40, 20]);
        fill(&mut cover, 0, 100, W, 140, [20, 200, 60]);

        let [r, g, _] = parse(&dominant_color(&cover).expect("color"));

        assert!(r > 180 && g < 70, "{r},{g}");
    }

    #[test]
    fn the_result_is_deterministic() {
        let mut cover = solid([255, 255, 255]);
        fill(&mut cover, 0, 0, 50, 75, [200, 30, 30]);
        fill(&mut cover, 50, 75, 100, 150, [30, 30, 200]);

        let first = dominant_color(&cover);

        for _ in 0..5 {
            assert_eq!(dominant_color(&cover), first);
        }
        // Dos grupos con el mismo peso: gana siempre el mismo.
        assert!(first.is_some());
    }

    #[test]
    fn output_is_lowercase_rrggbb() {
        let color = dominant_color(&solid([200, 30, 30])).expect("color");

        assert_eq!(color.len(), 7);
        assert_eq!(color, color.to_lowercase());
        assert!(is_valid_hex(&color));
        assert!(!is_valid_hex("#ABCDEF"));
        assert!(!is_valid_hex("#abc"));
        assert!(!is_valid_hex("abcdef0"));
    }

    fn jpeg_of(color: [u8; 3]) -> Vec<u8> {
        crate::engine::encode::encode_jpeg(&solid(color), W as u32, H as u32).expect("jpeg")
    }

    #[test]
    fn color_is_read_back_from_a_jpeg_cover() {
        let [r, g, b] = parse(&color_from_cover_bytes(&jpeg_of([30, 60, 200])).expect("color"));

        assert!(b > 150 && r < 80 && g < 100, "{r},{g},{b}");
    }

    #[test]
    fn undecodable_covers_are_an_error() {
        assert!(color_from_cover_bytes(b"not an image").is_err());
        assert!(color_from_cover_bytes(&crate::test_support::jpeg_bytes(64)).is_err());
        assert!(color_from_cover_bytes(&crate::test_support::webp_bytes(64)).is_err());
    }

    #[test]
    fn color_from_file_finds_jpg_and_reports_a_missing_cover() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("abc.jpg"), jpeg_of([200, 30, 30])).expect("write");

        let color = color_from_cover_file(dir.path(), "abc").expect("color");

        assert_eq!(encode(parse(&color)), color);
        assert!(color_from_cover_file(dir.path(), "nope").is_err());
    }
}
