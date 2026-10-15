//! Ajustes de la ventana que dependen de la plataforma y que Tauri no expone en su configuración.

use tauri::{AppHandle, Runtime};

/// Ajusta la ventana principal para la plataforma. En Windows desactiva los aceleradores del navegador de WebView2;
/// en Linux no hace nada.
///
/// **Por qué.** WebView2 atiende algunos atajos de navegador antes de que lleguen a la página (Ctrl+F busca en la
/// página, Ctrl+P imprime, F5 y Ctrl+R recargan la app, Alt+Izquierda va atrás en el historial…), así que el
/// `preventDefault` del front no siempre los frena. Atril tiene su propia búsqueda y su propio zoom, y recargar o
/// imprimir la interfaz no tiene sentido en un lector. `AreBrowserAcceleratorKeysEnabled = false` los entrega a la
/// página como teclas normales. No afecta a copiar, pegar ni a las teclas de movimiento.
///
/// `wry` permite fijarlo al crear el webview (`with_browser_accelerator_keys`), pero Tauri 2.12 no lo expone en
/// `WebviewWindowBuilder` ni en `tauri.conf.json`; por eso se hace después, con `with_webview`.
///
/// No se aplica en las compilaciones de desarrollo (`tauri dev`): ahí F5, Ctrl+R y F12 son útiles.
pub fn tune_main_window<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(windows)]
    if !cfg!(debug_assertions) {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            windows::disable_browser_accelerator_keys(&window);
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
mod windows {
    use tauri::{Runtime, WebviewWindow};
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;

    /// Desactiva los aceleradores del navegador (ver [`super::tune_main_window`]) del WebView2 de `window`.
    pub fn disable_browser_accelerator_keys<R: Runtime>(window: &WebviewWindow<R>) {
        let reached = window.with_webview(|webview| {
            // SAFETY: llamadas COM sobre el controlador vivo del WebView2; Tauri ejecuta este cierre en el hilo
            // principal, el que creó el webview.
            let outcome = unsafe {
                webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.Settings())
                    .and_then(|settings| settings.cast::<ICoreWebView2Settings3>())
                    .and_then(|settings| settings.SetAreBrowserAcceleratorKeysEnabled(false))
            };
            if let Err(error) = outcome {
                tracing::warn!(%error, "could not disable the browser accelerator keys of WebView2");
            }
        });
        if let Err(error) = reached {
            tracing::warn!(%error, "could not reach the WebView2 of the main window");
        }
    }
}
