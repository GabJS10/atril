//! URLs del protocolo `atril://` (el protocolo en sí llega en 1.B1).
//! Toda URL de libro sale de aquí: en Windows el esquema se sirve como `http://atril.localhost/`.

/// URL del PDF de un libro, lista para pdf.js.
pub fn book_file_url(id: &str) -> String {
    let origin = if cfg!(windows) {
        "http://atril.localhost"
    } else {
        "atril://localhost"
    };
    format!("{origin}/book/{id}")
}
