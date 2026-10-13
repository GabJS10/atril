//! El [`Engine`]: pool de hilos de render + cola priorizada + caché de JPEG + geometría de los libros.

use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;

use super::cache::{ByteLru, PageKey};
use super::document::{DocumentInfo, OpenDocument};
use super::scheduler::{Job, PageBytes, PageResult, Queue, Waiter};
use super::{
    DEFAULT_CACHE_BYTES, EngineError, OPEN_DOCUMENTS_PER_WORKER, WORKER_THREADS, dequantize_scale,
    quantize_scale,
};

#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// Hilos de render.
    pub threads: usize,
    /// Límite de la caché de JPEG, en bytes.
    pub cache_bytes: usize,
    /// Documentos abiertos por hilo.
    pub open_documents: usize,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            threads: WORKER_THREADS,
            cache_bytes: DEFAULT_CACHE_BYTES,
            open_documents: OPEN_DOCUMENTS_PER_WORKER,
        }
    }
}

/// Estado de un hilo del pool: los documentos que tiene abiertos (LRU, el más reciente al final).
pub struct Worker {
    index: usize,
    capacity: usize,
    docs: Vec<(String, PathBuf, OpenDocument)>,
}

impl Worker {
    fn new(index: usize, capacity: usize) -> Self {
        Self {
            index,
            capacity: capacity.max(1),
            docs: Vec::new(),
        }
    }

    /// Número de este hilo (0-based).
    pub fn index(&self) -> usize {
        self.index
    }

    /// El documento del libro, abriéndolo si hace falta. Si la ruta cambió, lo reabre.
    pub fn document(&mut self, book_id: &str, path: &Path) -> Result<&OpenDocument, EngineError> {
        if let Some(position) = self
            .docs
            .iter()
            .position(|(id, open_path, _)| id == book_id && open_path == path)
        {
            let entry = self.docs.remove(position);
            self.docs.push(entry);
        } else {
            self.docs.retain(|(id, _, _)| id != book_id);
            let document = OpenDocument::open(path)?;
            if self.docs.len() >= self.capacity {
                self.docs.remove(0);
            }
            self.docs
                .push((book_id.to_owned(), path.to_path_buf(), document));
        }
        match self.docs.last() {
            Some((_, _, document)) => Ok(document),
            None => Err(EngineError::Render("document cache is empty".into())),
        }
    }
}

type Call = Box<dyn FnOnce(&mut Worker) + Send>;

struct Shared {
    queue: Mutex<Queue<Call>>,
    wake: Condvar,
    cache: Mutex<ByteLru>,
    /// Geometría ya leída, por libro (con la ruta de la que salió).
    infos: Mutex<HashMap<String, (PathBuf, Arc<DocumentInfo>)>>,
    /// Número de páginas conocido, para no precargar más allá del final.
    page_counts: Mutex<HashMap<String, u32>>,
}

/// Cuántos libros se recuerdan en `infos`.
const MAX_CACHED_INFOS: usize = 8;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // Un pánico en un hilo no debe dejar el motor inutilizable: los datos son recuperables.
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct Engine {
    shared: Arc<Shared>,
    threads: Vec<JoinHandle<()>>,
    thread_count: usize,
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        let shared = Arc::new(Shared {
            queue: Mutex::new(Queue::default()),
            wake: Condvar::new(),
            cache: Mutex::new(ByteLru::new(config.cache_bytes)),
            infos: Mutex::new(HashMap::new()),
            page_counts: Mutex::new(HashMap::new()),
        });
        let thread_count = config.threads.max(1);
        let threads = (0..thread_count)
            .filter_map(|index| {
                let shared = Arc::clone(&shared);
                let capacity = config.open_documents;
                std::thread::Builder::new()
                    .name(format!("atril-render-{index}"))
                    .spawn(move || worker_loop(&shared, index, capacity))
                    .map_err(|error| tracing::error!(%error, "could not start a render thread"))
                    .ok()
            })
            .collect();
        Self {
            shared,
            threads,
            thread_count,
        }
    }

    /// Pide una página (1-based) a `scale` para el visor. `waiter` se llama una vez, desde un hilo del pool
    /// (o desde este mismo si la página ya está en caché). Además mueve la precarga alrededor de esa página.
    pub fn request_page(&self, book_id: &str, path: &Path, page: u32, scale: f64, waiter: Waiter) {
        let key = PageKey {
            book_id: book_id.to_owned(),
            page,
            scale_q: quantize_scale(scale),
        };
        let page_count = lock(&self.shared.page_counts).get(book_id).copied();

        let mut queue = lock(&self.shared.queue);
        if queue.is_shutdown() {
            drop(queue);
            waiter(Err(EngineError::Shutdown));
            return;
        }
        // Orden de cerrojos: cola, luego caché (el hilo de render los toma de uno en uno).
        let mut cache = lock(&self.shared.cache);
        let hit = cache.get(&key);
        let (queue_waiter, hit_waiter) = if hit.is_some() {
            (None, Some(waiter))
        } else {
            (Some(waiter), None)
        };
        let dropped = queue.viewer_request(
            key,
            path.to_path_buf(),
            queue_waiter,
            page_count,
            &|candidate| cache.contains(candidate),
        );
        drop(cache);
        drop(queue);

        self.shared.wake.notify_all();
        for stale in dropped {
            stale(Err(EngineError::Superseded));
        }
        if let (Some(waiter), Some(bytes)) = (hit_waiter, hit) {
            waiter(Ok(bytes));
        }
    }

    /// Ejecuta `f` en un hilo del pool con el documento del libro abierto, y espera el resultado.
    /// Es la puerta de entrada para todo lo que lea el PDF (geometría, texto, búsqueda, índice…).
    pub fn with_document<T, F>(&self, book_id: &str, path: &Path, f: F) -> Result<T, EngineError>
    where
        T: Send + 'static,
        F: FnOnce(&OpenDocument) -> Result<T, EngineError> + Send + 'static,
    {
        let book_id = book_id.to_owned();
        let path = path.to_path_buf();
        let counts = Arc::clone(&self.shared);
        self.run(move |worker| {
            let document = worker.document(&book_id, &path)?;
            lock(&counts.page_counts).insert(book_id.clone(), document.page_count());
            f(document)
        })
    }

    /// Ejecuta `f` en un hilo del pool y espera el resultado. Tiene prioridad sobre cualquier render.
    pub fn run<T, F>(&self, f: F) -> Result<T, EngineError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Worker) -> Result<T, EngineError> + Send + 'static,
    {
        let (tx, rx) = mpsc::channel();
        {
            let mut queue = lock(&self.shared.queue);
            if queue.is_shutdown() {
                return Err(EngineError::Shutdown);
            }
            queue.push_call(
                None,
                Box::new(move |worker| {
                    // Si el receptor ya no espera, no pasa nada.
                    let _ = tx.send(f(worker));
                }),
            );
        }
        self.shared.wake.notify_all();
        rx.recv()
            .unwrap_or_else(|_| Err(EngineError::Render("the render thread panicked".into())))
    }

    /// Número de páginas y geometría de un libro. La primera vez lee los diccionarios de página; después
    /// responde desde memoria.
    pub fn document_info(
        &self,
        book_id: &str,
        path: &Path,
    ) -> Result<Arc<DocumentInfo>, EngineError> {
        if let Some((cached_path, info)) = lock(&self.shared.infos).get(book_id)
            && cached_path == path
        {
            return Ok(Arc::clone(info));
        }
        let info = Arc::new(self.with_document(book_id, path, |document| Ok(document.info()))?);
        self.warm(book_id, path);
        let mut infos = lock(&self.shared.infos);
        if infos.len() >= MAX_CACHED_INFOS && !infos.contains_key(book_id) {
            // Pocos libros a la vez: se descarta uno cualquiera.
            if let Some(victim) = infos.keys().next().cloned() {
                infos.remove(&victim);
            }
        }
        infos.insert(book_id.to_owned(), (path.to_path_buf(), Arc::clone(&info)));
        Ok(info)
    }

    /// Pide a cada hilo que abra su copia del libro, sin esperar. Un PDF grande puede tardar casi un segundo
    /// en abrirse (la Biblia de 3997 páginas: ~700 ms); así ese coste se paga al abrir el libro, en paralelo,
    /// y no en la primera página que le toque a cada hilo. Los hilos que ya lo tienen abierto no hacen nada.
    pub fn warm(&self, book_id: &str, path: &Path) {
        let mut queue = lock(&self.shared.queue);
        if queue.is_shutdown() {
            return;
        }
        for index in 0..self.thread_count {
            let book_id = book_id.to_owned();
            let path = path.to_path_buf();
            queue.push_call(
                Some(index),
                Box::new(move |worker| {
                    let _ = worker.document(&book_id, &path);
                }),
            );
        }
        drop(queue);
        self.shared.wake.notify_all();
    }

    /// Versión bloqueante de `request_page` (pruebas, banco de pruebas y comandos que quieren los bytes).
    pub fn page_jpeg(
        &self,
        book_id: &str,
        path: &Path,
        page: u32,
        scale: f64,
    ) -> Result<PageBytes, EngineError> {
        let (tx, rx) = mpsc::channel();
        self.request_page(
            book_id,
            path,
            page,
            scale,
            Box::new(move |result| {
                let _ = tx.send(result);
            }),
        );
        rx.recv().unwrap_or(Err(EngineError::Shutdown))
    }

    /// Bytes de JPEG en caché y número de páginas guardadas.
    pub fn cache_stats(&self) -> (usize, usize) {
        let cache = lock(&self.shared.cache);
        (cache.used_bytes(), cache.len())
    }

    /// Hay una página en caché (sin tocar su antigüedad).
    pub fn is_cached(&self, book_id: &str, page: u32, scale: f64) -> bool {
        lock(&self.shared.cache).contains(&PageKey {
            book_id: book_id.to_owned(),
            page,
            scale_q: quantize_scale(scale),
        })
    }

    /// Olvida lo guardado de un libro (p. ej. si se quita de la biblioteca).
    pub fn forget_book(&self, book_id: &str) {
        lock(&self.shared.cache).remove_book(book_id);
        lock(&self.shared.infos).remove(book_id);
        lock(&self.shared.page_counts).remove(book_id);
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        let pending = lock(&self.shared.queue).shut_down();
        self.shared.wake.notify_all();
        for waiter in pending {
            waiter(Err(EngineError::Shutdown));
        }
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

fn worker_loop(shared: &Shared, index: usize, open_documents: usize) {
    let mut worker = Worker::new(index, open_documents);
    loop {
        let job = {
            let mut queue = lock(&shared.queue);
            loop {
                if queue.is_shutdown() {
                    // Los documentos se sueltan en este hilo (su contexto de MuPDF es de este hilo).
                    drop(queue);
                    drop(worker);
                    return;
                }
                if let Some(job) = queue.pop(index) {
                    break job;
                }
                queue = shared
                    .wake
                    .wait(queue)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        };
        match job {
            Job::Call(call) => {
                // Si el cierre entra en pánico, su canal se cierra y quien espera recibe un error.
                let _ = catch_unwind(AssertUnwindSafe(|| call(&mut worker)));
            }
            Job::Render { key, path } => {
                let result = catch_unwind(AssertUnwindSafe(|| {
                    render(shared, &mut worker, &key, &path)
                }))
                .unwrap_or_else(|_| Err(EngineError::Render("the renderer panicked".into())));
                if let Ok(bytes) = &result {
                    lock(&shared.cache).insert(key.clone(), Arc::clone(bytes));
                }
                let waiters = lock(&shared.queue).complete(&key);
                for waiter in waiters {
                    waiter(result.clone());
                }
            }
        }
    }
}

fn render(shared: &Shared, worker: &mut Worker, key: &PageKey, path: &Path) -> PageResult {
    let document = worker.document(&key.book_id, path)?;
    lock(&shared.page_counts).insert(key.book_id.clone(), document.page_count());
    let jpeg = document.render_jpeg(key.page, dequantize_scale(key.scale_q))?;
    Ok(Arc::new(jpeg))
}
