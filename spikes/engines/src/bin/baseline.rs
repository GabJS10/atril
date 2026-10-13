//! Binario de referencia sin motor: solo el código común (codificadores incluidos).
//! Sirve para medir cuánto añade cada motor al tamaño del binario.
use engines_spike::common::{encode_bmp, encode_jpeg85, encode_png};

fn main() -> anyhow::Result<()> {
    // Se usan los codificadores para que el enlazador no los descarte.
    let rgb = vec![255u8; 4 * 4 * 3];
    let n = encode_jpeg85(&rgb, 4, 4)?.len()
        + encode_bmp(&rgb, 4, 4)?.len()
        + encode_png(&rgb, 4, 4)?.len();
    println!("baseline ok ({n} bytes de prueba)");
    Ok(())
}
