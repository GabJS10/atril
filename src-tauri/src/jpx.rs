//! Decodificador JPEG 2000 para los JPX incrustados en los PDF (`POST /jpx`, docs/IPC.md).
//!
//! pdf.js decodifica JPX con OpenJPEG compilado a WebAssembly, o con su respaldo en JS cuando
//! WebKitGTK no compila el wasm: 17–25 s por página en los escaneos del usuario. Aquí se usa
//! `hayro-jpeg2000` (Rust puro; sin el feature `simd` ninguna dependencia usa `unsafe`) y los
//! píxeles salen con el formato de `imageData` de pdf.js (`src/decoder.c` y `src/myjs.js` de
//! mozilla/pdf.js.openjpeg): RGBA de 8 bits, salvo cuando se piden canales concretos.

use std::cmp::Ordering;
use std::fmt;

use hayro_jpeg2000::{ColorSpace, DecodeSettings, DecoderContext, Image};

/// Tamaño máximo del cuerpo de la petición (el codestream sin decodificar).
pub const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

/// Píxeles máximos de la imagen original. hayro reserva el tamaño completo aunque se pida
/// una reducción, así que el límite se mide sobre la resolución original. Medido: 24 Mpx en
/// RGB pedían unos 570 MB de RSS solo al decodificar (estimado: unos 380 MB para 16 Mpx).
pub const MAX_PIXELS: u64 = 16_000_000;

/// Reducción máxima aceptada (`2^31` deja cualquier imagen sin píxeles).
pub const MAX_REDUCE: u8 = 31;

/// Parámetros de la petición: los mismos que pdf.js pasa a `jp2_decode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Options {
    /// Canales de salida (`numComponents`). 0 = RGBA, como en la ruta de imágenes de pdf.js.
    pub components: u8,
    /// Paleta sin aplicar y sin escalar a 8 bits (`isIndexedColormap`).
    pub indexed: bool,
    /// El alfa viene dentro del JPX (`smaskInData`).
    pub smask: bool,
    /// Reducción de resolución: la salida mide `ceil(ancho / 2^reduce)` por `ceil(alto / 2^reduce)`.
    pub reduce: u8,
}

/// Píxeles decodificados: `channels` bytes por píxel, por filas de arriba abajo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    pub width: u32,
    pub height: u32,
    pub channels: u8,
    pub pixels: Vec<u8>,
}

/// Por qué no se pudo decodificar. El texto se devuelve tal cual en el cuerpo del 422.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum JpxError {
    /// Los datos no se pueden leer como JPEG 2000 (firma, cabeceras o datos corruptos).
    #[error("invalid JPEG 2000 data: {0}")]
    Invalid(String),
    /// La imagen original tiene más píxeles de los que se aceptan.
    #[error("image has {pixels} pixels; the limit is {limit}")]
    TooLarge { pixels: u64, limit: u64 },
    /// La reducción pedida deja la imagen sin píxeles o pasa de los niveles de resolución del JPX.
    #[error("reduce {reduce} is too high for a {width}x{height} image")]
    ReduceTooHigh { reduce: u8, width: u32, height: u32 },
    /// Combinación que pdf.js no sabe pintar, como dos canales sin alfa.
    #[error("unsupported output layout: {0}")]
    Unsupported(String),
}

/// Decodifica un JPX (JP2 o codestream) y devuelve los píxeles según `options`.
///
/// Diferencias con pdf.js, todas deliberadas o por limitación de hayro:
/// - Dos canales sin alfa (con `smask` falso) no escriben nada en pdf.js. Aquí son
///   `Unsupported` en lugar de devolver una imagen vacía.
/// - hayro trabaja en coma flotante: los valores pueden diferir en ±1 de OpenJPEG.
/// - `indexed` no desactiva las cajas `cdef` (hayro no tiene ese interruptor).
/// - El heurístico de sYCC por submuestreo de pdf.js (imágenes sin `colr`) no se aplica:
///   hayro no expone el submuestreo. El sYCC declarado en `colr` sí lo convierte hayro.
pub fn decode(data: &[u8], options: Options) -> Result<Decoded, JpxError> {
    let header = Image::new(data, &settings(options, None)).map_err(invalid)?;
    let (width, height) = (header.width(), header.height());
    let (out_width, out_height) = output_size(width, height, options.reduce)?;

    let image = if options.reduce == 0 {
        header
    } else {
        // hayro salta niveles de resolución con el cociente entre el tamaño original y el
        // objetivo. Con `width >> reduce` el cociente cae en `reduce`, y las dimensiones
        // resultantes son `ceil(width / 2^reduce)`, como en OpenJPEG.
        let target = (width >> options.reduce, height >> options.reduce);
        Image::new(data, &settings(options, Some(target))).map_err(invalid)?
    };

    let mut context = DecoderContext::default();
    let decoded = image.decode(&mut context).map_err(invalid)?;
    // `output_size` ya acotó el tamaño, así que el producto cabe de sobra en `usize`.
    let count = out_width as usize * out_height as usize;
    if decoded
        .components()
        .iter()
        .any(|component| component.samples().len() != count)
    {
        // hayro no falla si la reducción pasa de los niveles del JPX: devuelve la máxima
        // disponible. Esa resolución no es la pedida, así que se rechaza.
        return Err(JpxError::ReduceTooHigh {
            reduce: options.reduce,
            width,
            height,
        });
    }
    let sources = decoded
        .components()
        .iter()
        .map(Source::new)
        .collect::<Result<Vec<_>, _>>()?;

    let space = Space::from_color(image.color_space());
    let plan = plan(sources.len(), space, options)?;
    let pixels = compose(&sources, plan, options.indexed, count);

    Ok(Decoded {
        width: out_width,
        height: out_height,
        channels: plan.channels() as u8,
        pixels,
    })
}

fn settings(options: Options, target: Option<(u32, u32)>) -> DecodeSettings {
    DecodeSettings {
        // pdf.js no aplica la paleta cuando pide índices (IGNORE_PCLR_CMAP_CDEF).
        resolve_palette_indices: !options.indexed,
        target_resolution: target,
        ..DecodeSettings::default()
    }
}

fn invalid(error: impl fmt::Display) -> JpxError {
    JpxError::Invalid(error.to_string())
}

/// Comprueba el tamaño y la reducción de la imagen, y devuelve las dimensiones de salida.
fn output_size(width: u32, height: u32, reduce: u8) -> Result<(u32, u32), JpxError> {
    if width == 0 || height == 0 {
        return Err(JpxError::Invalid("image has no pixels".to_owned()));
    }
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_PIXELS {
        return Err(JpxError::TooLarge {
            pixels,
            limit: MAX_PIXELS,
        });
    }
    // Se mira `reduce` antes de desplazar: un desplazamiento de 32 bits o más no está definido.
    if reduce > MAX_REDUCE || width >> reduce == 0 || height >> reduce == 0 {
        return Err(JpxError::ReduceTooHigh {
            reduce,
            width,
            height,
        });
    }
    let factor = 1u32 << reduce;
    Ok((width.div_ceil(factor), height.div_ceil(factor)))
}

/// Un componente tal como lo entrega hayro: muestras en coma flotante en el rango
/// `0..2^precision`, y la profundidad original.
#[derive(Clone, Copy)]
struct Source<'a> {
    samples: &'a [f32],
    precision: u32,
}

impl<'a> Source<'a> {
    fn new(component: &'a hayro_jpeg2000::ComponentData) -> Result<Self, JpxError> {
        let samples = component.samples();
        let precision = u32::from(component.bit_depth());
        if !(1..=31).contains(&precision) {
            return Err(JpxError::Unsupported(format!(
                "bit depth {precision} is not supported"
            )));
        }
        Ok(Self { samples, precision })
    }

    /// Valor entero del componente, redondeado y acotado a su rango (como OpenJPEG).
    fn raw(&self, index: usize) -> i32 {
        let max = (1i64 << self.precision) - 1;
        let value = i64::from(self.samples[index].round() as i32);
        value.clamp(0, max) as i32
    }

    /// Byte de salida: escalado a 8 bits salvo con paleta sin aplicar, y acotado como
    /// `Uint8ClampedArray` de pdf.js.
    fn value(&self, index: usize, indexed: bool) -> u8 {
        let raw = self.raw(index);
        let value = if indexed {
            raw
        } else {
            scale_to_8(raw, self.precision)
        };
        value.clamp(0, 255) as u8
    }
}

/// Escala `value` de `precision` bits a 8, igual que `scale_component(comp, 8)` de OpenJPEG
/// (`src/bin/jp2/convert.c`): multiplica y divide con enteros al subir, y desplaza al bajar.
fn scale_to_8(value: i32, precision: u32) -> i32 {
    match precision.cmp(&8) {
        Ordering::Equal => value,
        Ordering::Less => (i64::from(value) * 255 / ((1i64 << precision) - 1)) as i32,
        Ordering::Greater => value >> (precision - 8),
    }
}

/// Espacio de color según hayro. OpenJPEG distingue más casos, pero pdf.js solo mira estos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Space {
    Gray,
    Srgb,
    Cmyk,
    /// ICC o desconocido: pdf.js lo trata como RGB si hay 3 o más canales.
    Other,
}

impl Space {
    fn from_color(color: &ColorSpace) -> Self {
        match color {
            ColorSpace::Gray => Self::Gray,
            ColorSpace::RGB => Self::Srgb,
            ColorSpace::CMYK => Self::Cmyk,
            ColorSpace::Unknown { .. } | ColorSpace::Icc { .. } => Self::Other,
        }
    }
}

/// Qué se escribe en cada píxel. Se decide una vez a partir de la cabecera.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Plan {
    /// Gris expandido a RGBA con alfa 255.
    GrayToRgba,
    /// Gris y alfa (`smask`) a RGBA.
    GrayAlphaToRgba,
    /// RGB a RGBA con alfa 255. Con `cmyk`, antes se convierte CMYK a RGB.
    RgbToRgba { cmyk: bool },
    /// Canales tal cual, sin conversión: 1, 3 o 4.
    Copy(usize),
}

impl Plan {
    fn channels(self) -> usize {
        match self {
            Self::Copy(channels) => channels,
            _ => 4,
        }
    }
}

/// Reproduce las ramas de `jp2_decode` (`decoder.c`) para `numComponents`, `smaskInData`
/// e `isIndexedColormap`.
fn plan(count: usize, space: Space, options: Options) -> Result<Plan, JpxError> {
    if count == 0 {
        return Err(JpxError::Invalid("image has no components".to_owned()));
    }

    if options.components > 0 {
        // Con `numComponents` no hay conversión de color: se copian los primeros canales.
        let channels = count.min(usize::from(options.components));
        return match channels {
            1 | 3 | 4 => Ok(Plan::Copy(channels)),
            _ => Err(JpxError::Unsupported(format!(
                "{channels} output channels; only 1, 3 or 4 are written"
            ))),
        };
    }

    // RGBA con alfa del fichero: pdf.js lo copia tal cual, sin convertir nada.
    if options.smask && count == 4 {
        return Ok(Plan::Copy(4));
    }

    let space = if count <= 2 { Space::Gray } else { space };
    if space == Space::Gray {
        return if count == 1 {
            Ok(Plan::GrayToRgba)
        } else if options.smask && count >= 2 {
            Ok(Plan::GrayAlphaToRgba)
        } else {
            Err(JpxError::Unsupported(
                "two channels without an alpha channel".to_owned(),
            ))
        };
    }

    Ok(Plan::RgbToRgba {
        // Solo con 4 o más canales hay CMYK que convertir; si no, pdf.js toma R, G y B tal cual.
        cmyk: space == Space::Cmyk && count >= 4,
    })
}

/// Escribe los píxeles según el plan. Cada píxel se calcula a partir de las muestras
/// originales, sin copias intermedias de los planos.
fn compose(sources: &[Source<'_>], plan: Plan, indexed: bool, count: usize) -> Vec<u8> {
    let mut pixels = Vec::with_capacity(count * plan.channels());
    for index in 0..count {
        match plan {
            Plan::GrayToRgba => {
                let gray = sources[0].value(index, indexed);
                pixels.extend_from_slice(&[gray, gray, gray, 255]);
            }
            Plan::GrayAlphaToRgba => {
                let gray = sources[0].value(index, indexed);
                let alpha = sources[1].value(index, indexed);
                pixels.extend_from_slice(&[gray, gray, gray, alpha]);
            }
            Plan::RgbToRgba { cmyk: false } => {
                let red = sources[0].value(index, indexed);
                let green = sources[1].value(index, indexed);
                let blue = sources[2].value(index, indexed);
                pixels.extend_from_slice(&[red, green, blue, 255]);
            }
            Plan::RgbToRgba { cmyk: true } => {
                // La conversión de CMYK usa los valores antes de escalar, como pdf.js.
                let raw = [
                    sources[0].raw(index),
                    sources[1].raw(index),
                    sources[2].raw(index),
                    sources[3].raw(index),
                ];
                let precision = [
                    sources[0].precision,
                    sources[1].precision,
                    sources[2].precision,
                    sources[3].precision,
                ];
                let [red, green, blue] = cmyk_to_rgb(raw, precision);
                pixels.extend_from_slice(&[red, green, blue, 255]);
            }
            Plan::Copy(channels) => {
                for source in &sources[..channels] {
                    pixels.push(source.value(index, indexed));
                }
            }
        }
    }
    pixels
}

/// CMYK a RGB como `color_cmyk_to_rgb` de OpenJPEG (`src/bin/common/color.c`): aritmética
/// en `f32` en el mismo orden, y truncado (no redondeado) al convertir a entero.
fn cmyk_to_rgb(raw: [i32; 4], precision: [u32; 4]) -> [u8; 3] {
    let mut inverted = [0f32; 4];
    for (channel, value) in inverted.iter_mut().enumerate() {
        let scale = 1.0f32 / ((1u32 << precision[channel]) - 1) as f32;
        *value = 1.0f32 - raw[channel] as f32 * scale;
    }
    let [cyan, magenta, yellow, black] = inverted;
    let channel = |value: f32| (255.0f32 * value * black) as i32;
    [
        channel(cyan).clamp(0, 255) as u8,
        channel(magenta).clamp(0, 255) as u8,
        channel(yellow).clamp(0, 255) as u8,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    const GRAY: &[u8] = include_bytes!("../tests/fixtures/jpx/gray.jp2");
    const GRAY_ALPHA: &[u8] = include_bytes!("../tests/fixtures/jpx/gray_alpha.jp2");
    const RGB: &[u8] = include_bytes!("../tests/fixtures/jpx/rgb.jp2");
    const RGBA: &[u8] = include_bytes!("../tests/fixtures/jpx/rgba.jp2");
    const CMYK: &[u8] = include_bytes!("../tests/fixtures/jpx/cmyk.jp2");
    const INDEXED: &[u8] = include_bytes!("../tests/fixtures/jpx/indexed.jp2");
    const GRAY16: &[u8] = include_bytes!("../tests/fixtures/jpx/gray16.jp2");
    const CONSTANT: &[u8] = include_bytes!("../tests/fixtures/jpx/constant.jp2");

    // Patrones de `tests/fixtures/jpx/generate.py`. Si cambian allí, cambian aquí.
    const W: u32 = 64;
    const H: u32 = 48;

    fn gray_pixel(x: u32, y: u32) -> u8 {
        ((x * 7 + y * 13) % 256) as u8
    }

    fn gray_alpha_pixel(x: u32, y: u32) -> (u8, u8) {
        (gray_pixel(x, y), ((x * 9 + y * 2) % 256) as u8)
    }

    fn rgb_pixel(x: u32, y: u32) -> [u8; 3] {
        [
            ((x * 4) % 256) as u8,
            ((y * 5) % 256) as u8,
            (((x + y) * 3) % 256) as u8,
        ]
    }

    fn rgba_alpha(x: u32, y: u32) -> u8 {
        ((x * 4 + y * 3) % 256) as u8
    }

    fn cmyk_pixel(x: u32, y: u32) -> [u8; 4] {
        let [c, m, y_value] = rgb_pixel(x, y);
        [c, m, y_value, ((x * y) % 256) as u8]
    }

    fn index_pixel(x: u32, y: u32) -> u8 {
        ((x / 16 + y / 12) % 4) as u8
    }

    const PALETTE: [[u8; 3]; 4] = [[200, 60, 40], [40, 160, 90], [230, 200, 60], [30, 60, 140]];

    fn gray16_pixel(x: u32, y: u32) -> u16 {
        ((x * 1000 + y * 777) % 65536) as u16
    }

    fn decode_ok(data: &[u8], options: Options) -> Decoded {
        decode(data, options).expect("decode")
    }

    fn assert_pixels(decoded: &Decoded, expected: impl Fn(u32, u32) -> Vec<u8>) {
        let channels = usize::from(decoded.channels);
        assert_eq!(decoded.width, W);
        assert_eq!(decoded.height, H);
        for y in 0..H {
            for x in 0..W {
                let start = ((y * W + x) as usize) * channels;
                assert_eq!(
                    &decoded.pixels[start..start + channels],
                    expected(x, y).as_slice(),
                    "pixel ({x}, {y})"
                );
            }
        }
    }

    #[test]
    fn gray_is_expanded_to_opaque_rgba() {
        let decoded = decode_ok(GRAY, Options::default());

        assert_eq!(decoded.channels, 4);
        assert_pixels(&decoded, |x, y| {
            let g = gray_pixel(x, y);
            vec![g, g, g, 255]
        });
    }

    #[test]
    fn rgb_is_expanded_to_opaque_rgba() {
        let decoded = decode_ok(RGB, Options::default());

        assert_eq!(decoded.channels, 4);
        assert_pixels(&decoded, |x, y| {
            let [r, g, b] = rgb_pixel(x, y);
            vec![r, g, b, 255]
        });
    }

    #[test]
    fn gray_alpha_takes_alpha_from_the_second_channel_when_smask_is_set() {
        let decoded = decode_ok(
            GRAY_ALPHA,
            Options {
                smask: true,
                ..Options::default()
            },
        );

        assert_pixels(&decoded, |x, y| {
            let (g, a) = gray_alpha_pixel(x, y);
            vec![g, g, g, a]
        });
    }

    #[test]
    fn gray_alpha_without_smask_is_unsupported_like_pdfjs_writes_nothing() {
        let error = decode(GRAY_ALPHA, Options::default()).expect_err("unsupported");

        assert!(matches!(error, JpxError::Unsupported(_)), "{error:?}");
    }

    #[test]
    fn rgba_with_smask_is_copied_as_it_is() {
        let decoded = decode_ok(
            RGBA,
            Options {
                smask: true,
                ..Options::default()
            },
        );

        assert_pixels(&decoded, |x, y| {
            let [r, g, b] = rgb_pixel(x, y);
            vec![r, g, b, rgba_alpha(x, y)]
        });
    }

    #[test]
    fn rgba_without_smask_drops_the_fourth_channel() {
        let decoded = decode_ok(RGBA, Options::default());

        assert_pixels(&decoded, |x, y| {
            let [r, g, b] = rgb_pixel(x, y);
            vec![r, g, b, 255]
        });
    }

    #[test]
    fn components_option_copies_the_requested_channels() {
        let rgb3 = decode_ok(
            RGB,
            Options {
                components: 3,
                ..Options::default()
            },
        );
        assert_eq!(rgb3.channels, 3);
        assert_eq!(rgb3.pixels.len(), (W * H * 3) as usize);
        assert_eq!(&rgb3.pixels[..3], &rgb_pixel(0, 0));

        let red_only = decode_ok(
            RGB,
            Options {
                components: 1,
                ..Options::default()
            },
        );
        assert_eq!(red_only.channels, 1);
        assert_eq!(red_only.pixels[1], rgb_pixel(1, 0)[0]);

        let four = decode_ok(
            RGB,
            Options {
                components: 4,
                ..Options::default()
            },
        );
        assert_eq!(four.channels, 3, "the image only has three channels");
    }

    #[test]
    fn two_output_channels_are_unsupported() {
        let error = decode(
            RGB,
            Options {
                components: 2,
                ..Options::default()
            },
        )
        .expect_err("unsupported");

        assert!(matches!(error, JpxError::Unsupported(_)), "{error:?}");
    }

    #[test]
    fn cmyk_is_converted_with_the_openjpeg_formula() {
        let decoded = decode_ok(CMYK, Options::default());

        assert_eq!(decoded.channels, 4);
        assert_pixels(&decoded, |x, y| {
            let [c, m, y_value, k] = cmyk_pixel(x, y);
            let rgb = cmyk_to_rgb(
                [i32::from(c), i32::from(m), i32::from(y_value), i32::from(k)],
                [8; 4],
            );
            vec![rgb[0], rgb[1], rgb[2], 255]
        });
    }

    #[test]
    fn cmyk_pure_colours_convert_to_the_expected_rgb() {
        let eight = [8; 4];

        assert_eq!(cmyk_to_rgb([0, 0, 0, 0], eight), [255, 255, 255]);
        assert_eq!(cmyk_to_rgb([255, 0, 0, 0], eight), [0, 255, 255]);
        assert_eq!(cmyk_to_rgb([0, 255, 0, 0], eight), [255, 0, 255]);
        assert_eq!(cmyk_to_rgb([0, 0, 255, 0], eight), [255, 255, 0]);
        assert_eq!(cmyk_to_rgb([0, 0, 0, 255], eight), [0, 0, 0]);
    }

    #[test]
    fn indexed_image_gets_its_palette_unless_indexed_is_set() {
        let palette = decode_ok(INDEXED, Options::default());
        assert_pixels(&palette, |x, y| {
            let [r, g, b] = PALETTE[usize::from(index_pixel(x, y))];
            vec![r, g, b, 255]
        });

        let indices = decode_ok(
            INDEXED,
            Options {
                indexed: true,
                ..Options::default()
            },
        );
        assert_pixels(&indices, |x, y| {
            let index = index_pixel(x, y);
            vec![index, index, index, 255]
        });
    }

    #[test]
    fn sixteen_bit_gray_is_scaled_down_by_shifting() {
        let decoded = decode_ok(GRAY16, Options::default());

        assert_pixels(&decoded, |x, y| {
            let gray = (gray16_pixel(x, y) >> 8) as u8;
            vec![gray, gray, gray, 255]
        });
    }

    #[test]
    fn reduce_halves_the_size_rounding_up_and_keeps_flat_colours() {
        let flat = decode_ok(
            CONSTANT,
            Options {
                reduce: 2,
                ..Options::default()
            },
        );
        assert_eq!((flat.width, flat.height), (16, 12));
        assert!(
            flat.pixels
                .chunks(4)
                .all(|pixel| pixel == [10, 200, 90, 255]),
            "a flat image stays flat after the wavelet reduction"
        );

        let rgb = decode_ok(
            RGB,
            Options {
                reduce: 1,
                ..Options::default()
            },
        );
        assert_eq!((rgb.width, rgb.height), (32, 24));
        assert_eq!(rgb.pixels.len(), 32 * 24 * 4);
    }

    #[test]
    fn reduce_beyond_the_resolution_levels_of_the_codestream_is_rejected() {
        // rgb.jp2 tiene 4 niveles de resolución: se puede reducir hasta 3 (8x6).
        let decoded = decode_ok(
            RGB,
            Options {
                reduce: 3,
                ..Options::default()
            },
        );
        assert_eq!((decoded.width, decoded.height), (8, 6));

        let error = decode(
            RGB,
            Options {
                reduce: 4,
                ..Options::default()
            },
        )
        .expect_err("only three levels");

        assert!(
            matches!(error, JpxError::ReduceTooHigh { reduce: 4, .. }),
            "{error:?}"
        );
    }

    #[test]
    fn reduce_beyond_the_image_is_rejected() {
        let error = decode(
            RGB,
            Options {
                reduce: 6,
                ..Options::default()
            },
        )
        .expect_err("48 >> 6 is 0");

        assert!(matches!(error, JpxError::ReduceTooHigh { .. }), "{error:?}");
    }

    #[test]
    fn corrupt_or_empty_data_is_an_error_not_a_panic() {
        assert!(matches!(
            decode(&[], Options::default()),
            Err(JpxError::Invalid(_))
        ));
        assert!(matches!(
            decode(b"not a jpeg 2000 file at all", Options::default()),
            Err(JpxError::Invalid(_))
        ));
        assert!(matches!(
            decode(&RGB[..RGB.len() / 3], Options::default()),
            Ok(_) | Err(JpxError::Invalid(_))
        ));
    }

    #[test]
    fn flipping_bytes_never_panics() {
        // La cabecera entera y cada 17.º byte del resto: el decodificador puede aceptar o
        // rechazar, pero no debe entrar en pánico con datos corruptos.
        for data in [GRAY, RGB, INDEXED, CMYK] {
            for position in (0..data.len()).filter(|position| *position < 64 || position % 17 == 0)
            {
                let mut corrupt = data.to_vec();
                corrupt[position] ^= 0xFF;
                let _ = decode(&corrupt, Options::default());
            }
        }
    }

    #[test]
    fn output_size_rounds_up_and_enforces_the_pixel_limit() {
        assert_eq!(output_size(1701, 2613, 0).expect("size"), (1701, 2613));
        assert_eq!(output_size(1701, 2613, 1).expect("size"), (851, 1307));
        assert_eq!(output_size(5, 3, 1).expect("size"), (3, 2));

        assert!(matches!(
            output_size(10_000, 10_000, 0),
            Err(JpxError::TooLarge { .. })
        ));
        assert_eq!(output_size(4000, 4000, 2).expect("size"), (1000, 1000));
        assert!(matches!(
            output_size(64, 64, MAX_REDUCE + 1),
            Err(JpxError::ReduceTooHigh { .. })
        ));
        assert!(matches!(output_size(0, 10, 0), Err(JpxError::Invalid(_))));
    }

    #[test]
    fn scale_to_8_matches_openjpeg_scaling_rules() {
        // Profundidades mayores: desplazamiento a la derecha (truncado).
        assert_eq!(scale_to_8(65535, 16), 255);
        assert_eq!(scale_to_8(256, 16), 1);
        assert_eq!(scale_to_8(255, 16), 0);
        // Menores: multiplicación y división enteras.
        assert_eq!(scale_to_8(1, 1), 255);
        assert_eq!(scale_to_8(0, 1), 0);
        assert_eq!(scale_to_8(3, 2), 255);
        assert_eq!(scale_to_8(1, 2), 85);
        // Igual: sin cambios.
        assert_eq!(scale_to_8(200, 8), 200);
    }

    #[test]
    fn plan_follows_the_pdfjs_branches() {
        let default = Options::default();
        let smask = Options {
            smask: true,
            ..Options::default()
        };

        assert_eq!(plan(1, Space::Gray, default), Ok(Plan::GrayToRgba));
        assert_eq!(plan(2, Space::Gray, smask), Ok(Plan::GrayAlphaToRgba));
        assert!(matches!(
            plan(2, Space::Gray, default),
            Err(JpxError::Unsupported(_))
        ));
        assert_eq!(
            plan(4, Space::Cmyk, default),
            Ok(Plan::RgbToRgba { cmyk: true })
        );
        assert_eq!(plan(4, Space::Cmyk, smask), Ok(Plan::Copy(4)));
        assert_eq!(
            plan(3, Space::Cmyk, default),
            Ok(Plan::RgbToRgba { cmyk: false })
        );
        assert_eq!(
            plan(5, Space::Srgb, default),
            Ok(Plan::RgbToRgba { cmyk: false })
        );
    }
}
