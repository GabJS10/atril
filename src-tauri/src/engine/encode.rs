//! Codificación JPEG de las páginas renderizadas.
//!
//! Se usa `jpeg-encoder` (Rust puro, con AVX2 detectado en tiempo de ejecución): a 1240 px de ancho tarda
//! ~22 ms frente a ~65 ms del crate `image` (calidad 85 en ambos). `turbojpeg` (libjpeg-turbo) bajaría a
//! ~8 ms, pero necesita cmake y nasm para compilar y su libjpeg estático choca con el de MuPDF al enlazar
//! (símbolos duplicados). Las cifras están en la descripción del PR de R1.1.
//!
//! Submuestreo de color 4:2:0 (el habitual en JPEG): el texto en gris no pierde nitidez y el archivo pesa
//! una cuarta parte menos que en 4:4:4.

use jpeg_encoder::{ColorType, Encoder};

use super::{EngineError, JPEG_QUALITY};

/// Codifica RGB de 8 bits (3 bytes por píxel, filas contiguas) como JPEG.
pub fn encode_jpeg(rgb: &[u8], width: u32, height: u32) -> Result<Vec<u8>, EngineError> {
    let (w, h) = (
        u16::try_from(width).map_err(|_| too_large(width, height))?,
        u16::try_from(height).map_err(|_| too_large(width, height))?,
    );
    // Una página en papel q85 suele pesar 100-500 KB.
    let mut out = Vec::with_capacity(rgb.len() / 10 + 1024);
    Encoder::new(&mut out, JPEG_QUALITY)
        .encode(rgb, w, h, ColorType::Rgb)
        .map_err(|error| EngineError::Render(format!("JPEG encoding failed: {error}")))?;
    Ok(out)
}

fn too_large(width: u32, height: u32) -> EngineError {
    EngineError::Render(format!("{width}x{height} is too large for a JPEG"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_a_valid_jpeg() {
        let rgb = vec![200u8; 16 * 8 * 3];

        let jpeg = encode_jpeg(&rgb, 16, 8).expect("encode");

        assert_eq!(&jpeg[..3], &[0xFF, 0xD8, 0xFF]);
        assert_eq!(&jpeg[jpeg.len() - 2..], &[0xFF, 0xD9]);
    }

    #[test]
    fn round_trips_a_gradient_closely() {
        let (w, h) = (64u32, 48u32);
        let mut rgb = Vec::new();
        for y in 0..h {
            for x in 0..w {
                rgb.extend_from_slice(&[(x * 4) as u8, (y * 5) as u8, 128]);
            }
        }

        let jpeg = encode_jpeg(&rgb, w, h).expect("encode");
        let decoded = image::load_from_memory_with_format(&jpeg, image::ImageFormat::Jpeg)
            .expect("decode")
            .to_rgb8();

        assert_eq!(decoded.dimensions(), (w, h));
        let error: u32 = decoded
            .as_raw()
            .iter()
            .zip(&rgb)
            .map(|(a, b)| u32::from(a.abs_diff(*b)))
            .sum();
        assert!(
            error / (rgb.len() as u32) < 6,
            "mean error {}",
            error / rgb.len() as u32
        );
    }

    #[test]
    fn sides_beyond_the_jpeg_limit_are_an_error() {
        assert!(matches!(
            encode_jpeg(&[], 70_000, 1),
            Err(EngineError::Render(_))
        ));
    }
}
