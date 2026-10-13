//! Vigilancia de las carpetas de la biblioteca y escaneos en segundo plano.
//!
//! Un único hilo recibe las peticiones (escanear, cambio de archivos de `notify`) y las
//! atiende en orden. Si una carpeta desaparece, se deja de vigilar y los libros pasan a
//! `missing`; cuando vuelve, se vuelve a vigilar y se escanea. Nada de esto tumba la app.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::folders;
use crate::indexer;
use crate::scan::{self, ScanStatus, SharedScanStatus};

/// Peticiones al hilo de biblioteca.
pub enum Msg {
    /// Escanear todas las carpetas (lo piden los comandos).
    Scan,
    /// `notify` vio un cambio en alguna carpeta vigilada.
    Fs,
}

/// Cada cuánto se revisa si una carpeta apareció o desapareció.
const TICK: Duration = Duration::from_secs(30);
/// Tiempo que se espera tras un cambio para agrupar ráfagas de eventos.
const DEBOUNCE: Duration = Duration::from_millis(500);
/// Intervalo mínimo entre dos `library://scan` de progreso.
const EMIT_EVERY: Duration = Duration::from_secs(1);

#[derive(Serialize, Clone, Copy)]
struct ChangedPayload {
    reason: &'static str,
}

/// Arranca el hilo. `tx` se usa también para que `notify` le avise. Tras cada escaneo despierta a
/// `indexer` para que indexe los libros nuevos.
pub fn spawn(
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    status: SharedScanStatus,
    tx: Sender<Msg>,
    rx: Receiver<Msg>,
    indexer: indexer::Handle,
) {
    let spawned = thread::Builder::new()
        .name("library-watch".into())
        .spawn(move || Worker::new(app, db, status, tx, indexer).run(rx));
    if let Err(error) = spawned {
        tracing::error!(%error, "could not start the library worker");
    }
}

struct Worker {
    app: AppHandle,
    db: Arc<Mutex<Connection>>,
    status: SharedScanStatus,
    indexer: indexer::Handle,
    watcher: Option<RecommendedWatcher>,
    /// Carpetas que están siendo vigiladas ahora mismo.
    watched: HashSet<PathBuf>,
    /// Carpetas de la biblioteca que existían en el último ciclo.
    available: HashSet<PathBuf>,
}

impl Worker {
    fn new(
        app: AppHandle,
        db: Arc<Mutex<Connection>>,
        status: SharedScanStatus,
        tx: Sender<Msg>,
        indexer: indexer::Handle,
    ) -> Self {
        let watcher = match notify::recommended_watcher(
            move |_event: notify::Result<notify::Event>| {
                // Errores de `notify` también cuentan: el escaneo lo deja todo bien.
                let _ = tx.send(Msg::Fs);
            },
        ) {
            Ok(watcher) => Some(watcher),
            Err(error) => {
                tracing::warn!(%error, "file watching unavailable; library updates on request only");
                None
            }
        };
        Self {
            app,
            db,
            status,
            indexer,
            watcher,
            watched: HashSet::new(),
            available: HashSet::new(),
        }
    }

    fn run(mut self, rx: Receiver<Msg>) {
        self.sync_and_scan("scan");
        loop {
            match rx.recv_timeout(TICK) {
                Ok(Msg::Scan) => self.sync_and_scan("scan"),
                Ok(Msg::Fs) => {
                    thread::sleep(DEBOUNCE);
                    while rx.try_recv().is_ok() {}
                    self.sync_and_scan("watch");
                }
                Err(RecvTimeoutError::Timeout) => {
                    if self.folders_changed() {
                        self.sync_and_scan("watch");
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    }

    /// Hay carpetas que aparecieron o desaparecieron desde el último ciclo, o que
    /// no se están vigilando aunque existan (p. ej. un `watch` que falló).
    fn folders_changed(&self) -> bool {
        let existing = self.existing_folders();
        existing != self.available || (self.watcher.is_some() && existing != self.watched)
    }

    fn existing_folders(&self) -> HashSet<PathBuf> {
        let folders = match self.db.lock() {
            Ok(conn) => folders::paths(&conn).unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        folders.into_iter().filter(|path| path.is_dir()).collect()
    }

    fn sync_and_scan(&mut self, reason: &'static str) {
        let folders: Vec<PathBuf> = match self.db.lock() {
            Ok(conn) => folders::paths(&conn).unwrap_or_default(),
            Err(_) => return,
        };
        let existing: HashSet<PathBuf> = folders.iter().filter(|p| p.is_dir()).cloned().collect();
        self.sync_watches(&existing);
        self.available = existing;

        self.set_status(|status| status.running = true);
        self.set_status(|status| status.found = 0);
        let mut last_emit = Instant::now() - EMIT_EVERY;
        let result = scan::scan_folders(&self.db, &folders, |found| {
            self.set_status(|status| status.found = found);
            if last_emit.elapsed() >= EMIT_EVERY {
                last_emit = Instant::now();
                self.emit_scan();
            }
        });

        match result {
            Ok(found) => self.set_status(|status| status.found = found),
            Err(error) => tracing::warn!(%error, "library scan failed"),
        }
        self.set_status(|status| status.running = false);
        self.emit_scan();
        self.emit_changed(reason);
        self.indexer.wake();
    }

    /// Vigila las carpetas que existen y deja de vigilar las que ya no.
    fn sync_watches(&mut self, existing: &HashSet<PathBuf>) {
        let Some(watcher) = self.watcher.as_mut() else {
            return;
        };
        for stale in self
            .watched
            .difference(existing)
            .cloned()
            .collect::<Vec<_>>()
        {
            // Si la carpeta ya no existe, `unwatch` puede fallar; no importa.
            let _ = watcher.unwatch(&stale);
            self.watched.remove(&stale);
        }
        for folder in existing
            .difference(&self.watched)
            .cloned()
            .collect::<Vec<_>>()
        {
            match watcher.watch(&folder, RecursiveMode::Recursive) {
                Ok(()) => {
                    self.watched.insert(folder);
                }
                Err(error) => {
                    tracing::warn!(path = %folder.display(), %error, "could not watch folder")
                }
            }
        }
    }

    fn set_status(&self, change: impl FnOnce(&mut ScanStatus)) {
        if let Ok(mut status) = self.status.lock() {
            change(&mut status);
        }
    }

    fn emit_scan(&self) {
        let status = self.status.lock().map(|status| *status).unwrap_or_default();
        if let Err(error) = self.app.emit("library://scan", status) {
            tracing::warn!(%error, "could not emit library://scan");
        }
    }

    fn emit_changed(&self, reason: &'static str) {
        emit_changed(&self.app, reason);
    }
}

/// Avisa al front de que la biblioteca cambió (`library://changed`). Lo emiten el escaneo y el indexador.
pub fn emit_changed(app: &AppHandle, reason: &'static str) {
    if let Err(error) = app.emit("library://changed", ChangedPayload { reason }) {
        tracing::warn!(%error, "could not emit library://changed");
    }
}

/// Ayuda a los comandos: pedir un escaneo sin esperar a que termine.
pub fn request_scan(tx: &Sender<Msg>) {
    let _ = tx.send(Msg::Scan);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_payload_serializes_reason() {
        let value = serde_json::to_value(ChangedPayload { reason: "scan" }).expect("serialize");
        assert_eq!(value, serde_json::json!({ "reason": "scan" }));
    }

    #[test]
    fn scan_status_serializes_in_camel_case() {
        let value = serde_json::to_value(ScanStatus {
            running: true,
            found: 3,
        })
        .expect("serialize");
        assert_eq!(value, serde_json::json!({ "running": true, "found": 3 }));
    }
}

#[cfg(test)]
mod watcher_tests {
    use std::sync::mpsc;
    use std::time::Duration;

    use notify::{RecursiveMode, Watcher};

    /// Comprueba que `notify` entrega eventos de un PDF nuevo en una carpeta vigilada.
    #[test]
    fn a_new_pdf_in_a_watched_folder_produces_an_event() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (tx, rx) = mpsc::channel();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                let _ = tx.send(result.is_ok());
            })
            .expect("watcher");
        watcher
            .watch(dir.path(), RecursiveMode::Recursive)
            .expect("watch");

        std::fs::write(dir.path().join("nuevo.pdf"), b"%PDF-1.4").expect("write");

        let event = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("event within 10 s");
        assert!(event);
    }
}
