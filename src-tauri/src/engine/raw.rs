//! Acceso directo a MuPDF para lo que el crate `mupdf` 0.8 no expone. Es el único módulo del motor con `unsafe`.
//!
//! El store de recursos de MuPDF (imágenes decodificadas, fuentes, objetos) es uno solo para el proceso: el crate
//! crea el contexto base con `FZ_STORE_DEFAULT` (256 MB) y cada hilo toma un `fz_clone_context`, que comparte ese
//! store. Sin límite, cada escaneo deja decodificadas decenas de MB, y el proceso crece hasta el tope. [`shrink_store`]
//! lo recorta: MuPDF evicta lo que no está en uso hasta el porcentaje pedido del tope.

use mupdf::Context;
use mupdf_sys::fz_context;

/// Tope del store con el que el crate `mupdf` 0.8.0 crea el contexto base (`FZ_STORE_DEFAULT`).
pub const STORE_MAX_BYTES: usize = 256 << 20;

/// Contexto de MuPDF del hilo que llama. El crate lo crea al primer uso y lo guarda en el único campo de `Context`,
/// que es privado; se lee desde ahí.
pub fn thread_context() -> *mut fz_context {
    const {
        assert!(
            std::mem::size_of::<Context>() == std::mem::size_of::<*mut fz_context>(),
            "mupdf::Context must hold only the context pointer (mupdf 0.8.0, pinned in Cargo.lock)"
        )
    };
    let context = Context::get();
    // SAFETY: `Context` contiene solo el puntero del contexto (ver el `const` de arriba); lo leemos en su sitio.
    unsafe { std::ptr::read(std::ptr::from_ref(&context).cast::<*mut fz_context>()) }
}

/// Recorta el store compartido a `percent` (1 a 99) de su tope. Con 100 o más no hace nada.
pub fn shrink_store(percent: u32) {
    if percent < 100 {
        let context = thread_context();
        // SAFETY: `context` es el contexto de este hilo, válido mientras viva el hilo. `fz_shrink_store` solo toma los
        // cerrojos de MuPDF y no lanza excepciones.
        unsafe {
            mupdf_sys::fz_shrink_store(context, percent);
        }
    }
    release_heap();
}

/// Pide a glibc que devuelva al sistema la memoria libre de sus heaps. Tras recortar el store, sin esto el RSS apenas
/// baja: glibc retiene las páginas de las decodificaciones grandes que MuPDF ya soltó.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn release_heap() {
    // SAFETY: `malloc_trim` solo reorganiza los heaps de glibc; no tiene precondiciones.
    unsafe {
        libc::malloc_trim(0);
    }
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
fn release_heap() {}

#[cfg(test)]
mod tests {
    use super::*;

    /// El puntero es el contexto del hilo: estable dentro del hilo, distinto en otro hilo, y un contexto vivo de
    /// MuPDF (guarda y devuelve su puntero de usuario).
    #[test]
    fn thread_context_is_this_threads_context() {
        let here = thread_context();
        assert_eq!(here, thread_context());
        let other = std::thread::spawn(|| thread_context() as usize)
            .join()
            .expect("the helper thread");
        assert_ne!(other, here as usize);

        let sentinel = 0x5eed as *mut std::ffi::c_void;
        // SAFETY: contexto de este hilo, válido mientras dure la prueba.
        unsafe {
            mupdf_sys::fz_set_user_context(here, sentinel);
            assert_eq!(mupdf_sys::fz_user_context(here), sentinel);
            mupdf_sys::fz_set_user_context(here, std::ptr::null_mut());
        }
    }

    #[test]
    fn shrinking_to_the_whole_store_is_a_no_op() {
        shrink_store(100);
        shrink_store(250);
    }
}
