//! Cola priorizada del pool de render. Es una estructura de datos pura (sin hilos ni MuPDF):
//! quien la usa la protege con un `Mutex` y despierta a los hilos con un `Condvar`.
//!
//! Reglas:
//! 1. Trabajos genéricos (`Call`, p. ej. leer la geometría de un libro) antes que cualquier render.
//! 2. Páginas pedidas por el visor (`Viewer`) antes que la precarga (`Prefetch`).
//! 3. Entre las del visor gana la más cercana a la última página pedida del mismo libro (en un salto, lo que
//!    se ve ahora va antes que lo que se pidió hace un momento). A igual distancia, la más reciente.
//! 4. Cancelación: cada petición del visor descarta las del mismo libro que quedan a más de `STALE_DISTANCE`
//!    páginas (el visor ya está en otra zona) y toda la precarga pendiente de ese libro, que se vuelve a
//!    planificar alrededor de la nueva página. También descarta las del mismo libro en cola con otra escala
//!    (el usuario cambió el zoom y espera el render nítido, no el de la escala anterior). Las que ya están en
//!    curso no se cancelan: terminan, avisan a sus destinatarios y llenan la caché.
//!    Las peticiones descartadas reciben `EngineError::Superseded`.
//! 5. Peticiones iguales (mismo libro, página y escala) se funden en una sola con varios destinatarios.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::EngineError;
use super::cache::PageKey;

/// Si la última página pedida está a más de esto de una petición en cola, esa petición ya no se necesita.
pub const STALE_DISTANCE: u32 = 12;
/// Páginas que se precargan por delante (en el sentido de avance) y por detrás.
pub const PREFETCH_AHEAD: u32 = 2;
pub const PREFETCH_BEHIND: u32 = 2;

pub type PageBytes = Arc<Vec<u8>>;
pub type PageResult = Result<PageBytes, EngineError>;
/// Quien espera una página. Se llama una sola vez, fuera del cerrojo de la cola.
pub type Waiter = Box<dyn FnOnce(PageResult) + Send>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    Viewer,
    Prefetch,
}

pub struct RenderTask {
    pub key: PageKey,
    pub path: PathBuf,
    class: Class,
    seq: u64,
    /// Orden dentro de la precarga (0 = la más urgente).
    rank: u32,
    waiters: Vec<Waiter>,
}

pub enum Job<C> {
    Call(C),
    /// Una página que renderizar. Sus destinatarios quedan en la cola hasta `complete`.
    Render {
        key: PageKey,
        path: PathBuf,
    },
}

struct Focus {
    page: u32,
    /// +1 si el visor avanza, -1 si retrocede.
    direction: i64,
}

pub struct Queue<C> {
    seq: u64,
    /// Trabajos genéricos; `Some(i)` solo lo puede tomar el hilo `i`.
    calls: VecDeque<(Option<usize>, C)>,
    tasks: Vec<RenderTask>,
    inflight: HashMap<PageKey, Vec<Waiter>>,
    focus: HashMap<String, Focus>,
    shutdown: bool,
}

impl<C> Default for Queue<C> {
    fn default() -> Self {
        Self {
            seq: 0,
            calls: VecDeque::new(),
            tasks: Vec::new(),
            inflight: HashMap::new(),
            focus: HashMap::new(),
            shutdown: false,
        }
    }
}

impl<C> Queue<C> {
    pub fn is_shutdown(&self) -> bool {
        self.shutdown
    }

    /// Marca el cierre y devuelve los destinatarios pendientes para avisarles.
    pub fn shut_down(&mut self) -> Vec<Waiter> {
        self.shutdown = true;
        self.calls.clear();
        self.tasks.drain(..).flat_map(|task| task.waiters).collect()
    }

    /// Encola un trabajo genérico. Con `worker = Some(i)` solo lo ejecuta el hilo `i` (p. ej. para que cada
    /// hilo abra su copia de un documento); con `None`, el primero que quede libre.
    pub fn push_call(&mut self, worker: Option<usize>, call: C) {
        self.calls.push_back((worker, call));
    }

    /// ¿Hay ya un trabajo (en cola o en curso) para esta página?
    pub fn is_pending(&self, key: &PageKey) -> bool {
        self.inflight.contains_key(key) || self.tasks.iter().any(|task| task.key == *key)
    }

    /// Registra una petición del visor: actualiza el foco, descarta lo que ya no hace falta, encola la página
    /// (o se une a un trabajo existente) y replanifica la precarga. Devuelve los destinatarios descartados;
    /// quien llama debe avisarles con `Superseded` fuera del cerrojo.
    ///
    /// `waiter` es `None` cuando la página ya estaba en caché y solo hay que mover el foco y la precarga.
    pub fn viewer_request(
        &mut self,
        key: PageKey,
        path: PathBuf,
        waiter: Option<Waiter>,
        page_count: Option<u32>,
        is_cached: &dyn Fn(&PageKey) -> bool,
    ) -> Vec<Waiter> {
        let mut dropped = Vec::new();
        self.move_focus(&key.book_id, key.page);

        // Lo del visor que quedó lejos y toda la precarga de este libro.
        let mut kept = Vec::with_capacity(self.tasks.len());
        for task in self.tasks.drain(..) {
            let same_book = task.key.book_id == key.book_id;
            let stale = same_book
                && task.class == Class::Viewer
                && (task.key.page.abs_diff(key.page) > STALE_DISTANCE
                    || task.key.scale_q != key.scale_q);
            if same_book && (task.class == Class::Prefetch || stale) && task.key != key {
                dropped.extend(task.waiters);
            } else {
                kept.push(task);
            }
        }
        self.tasks = kept;

        if let Some(waiter) = waiter {
            self.enqueue_viewer(key.clone(), path.clone(), waiter);
        }
        self.plan_prefetch(&key, &path, page_count, is_cached);
        dropped
    }

    fn move_focus(&mut self, book_id: &str, page: u32) {
        match self.focus.get_mut(book_id) {
            Some(focus) => {
                if page > focus.page {
                    focus.direction = 1;
                } else if page < focus.page {
                    focus.direction = -1;
                }
                focus.page = page;
            }
            None => {
                self.focus
                    .insert(book_id.to_owned(), Focus { page, direction: 1 });
            }
        }
    }

    fn enqueue_viewer(&mut self, key: PageKey, path: PathBuf, waiter: Waiter) {
        if let Some(waiters) = self.inflight.get_mut(&key) {
            waiters.push(waiter);
            return;
        }
        self.seq += 1;
        let seq = self.seq;
        if let Some(task) = self.tasks.iter_mut().find(|task| task.key == key) {
            // Estaba en la cola (precarga o una petición anterior): ahora la pide el visor.
            task.class = Class::Viewer;
            task.seq = seq;
            task.waiters.push(waiter);
            return;
        }
        self.tasks.push(RenderTask {
            key,
            path,
            class: Class::Viewer,
            seq,
            rank: 0,
            waiters: vec![waiter],
        });
    }

    fn plan_prefetch(
        &mut self,
        key: &PageKey,
        path: &Path,
        page_count: Option<u32>,
        is_cached: &dyn Fn(&PageKey) -> bool,
    ) {
        let direction = self
            .focus
            .get(&key.book_id)
            .map_or(1, |focus| focus.direction);
        let ahead = (1..=PREFETCH_AHEAD).map(|step| i64::from(step) * direction);
        let behind = (1..=PREFETCH_BEHIND).map(|step| -i64::from(step) * direction);
        for (rank, offset) in ahead.chain(behind).enumerate() {
            let page = i64::from(key.page) + offset;
            if page < 1 || page_count.is_some_and(|count| page > i64::from(count)) {
                continue;
            }
            let candidate = PageKey {
                book_id: key.book_id.clone(),
                page: page as u32,
                scale_q: key.scale_q,
            };
            if is_cached(&candidate) || self.is_pending(&candidate) {
                continue;
            }
            self.seq += 1;
            self.tasks.push(RenderTask {
                key: candidate,
                path: path.to_path_buf(),
                class: Class::Prefetch,
                seq: self.seq,
                rank: rank as u32,
                waiters: Vec::new(),
            });
        }
    }

    /// Siguiente trabajo para el hilo `worker`, según las reglas del módulo. Los destinatarios de un render
    /// pasan a "en curso".
    pub fn pop(&mut self, worker: usize) -> Option<Job<C>> {
        if let Some(position) = self
            .calls
            .iter()
            .position(|(target, _)| target.is_none_or(|target| target == worker))
        {
            let (_, call) = self.calls.remove(position)?;
            return Some(Job::Call(call));
        }
        let index = self.best_task_index()?;
        let task = self.tasks.swap_remove(index);
        self.inflight.insert(task.key.clone(), task.waiters);
        Some(Job::Render {
            key: task.key,
            path: task.path,
        })
    }

    fn best_task_index(&self) -> Option<usize> {
        let viewer = self
            .tasks
            .iter()
            .enumerate()
            .filter(|(_, task)| task.class == Class::Viewer)
            .min_by_key(|(_, task)| {
                let focus = self
                    .focus
                    .get(&task.key.book_id)
                    .map_or(task.key.page, |focus| focus.page);
                (task.key.page.abs_diff(focus), std::cmp::Reverse(task.seq))
            });
        if let Some((index, _)) = viewer {
            return Some(index);
        }
        self.tasks
            .iter()
            .enumerate()
            .filter(|(_, task)| task.class == Class::Prefetch)
            .min_by_key(|(_, task)| (task.rank, task.seq))
            .map(|(index, _)| index)
    }

    /// Termina un render: devuelve quienes lo esperaban.
    pub fn complete(&mut self, key: &PageKey) -> Vec<Waiter> {
        self.inflight.remove(key).unwrap_or_default()
    }

    /// Trabajos de render pendientes (en cola), para pruebas y diagnóstico.
    pub fn queued(&self) -> usize {
        self.tasks.len()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    type Q = Queue<&'static str>;

    fn key(book: &str, page: u32) -> PageKey {
        PageKey {
            book_id: book.to_owned(),
            page,
            scale_q: 100,
        }
    }

    fn never_cached(_: &PageKey) -> bool {
        false
    }

    /// Un destinatario que apunta en `log` cómo terminó.
    fn waiter(log: &Arc<Mutex<Vec<String>>>, name: &str) -> Waiter {
        let log = Arc::clone(log);
        let name = name.to_owned();
        Box::new(move |result| {
            let outcome = match result {
                Ok(_) => "ok".to_owned(),
                Err(error) => error.to_string(),
            };
            log.lock().expect("log").push(format!("{name}:{outcome}"));
        })
    }

    fn request(q: &mut Q, book: &str, page: u32, w: Option<Waiter>) -> Vec<Waiter> {
        q.viewer_request(
            key(book, page),
            PathBuf::from("/x.pdf"),
            w,
            Some(100),
            &never_cached,
        )
    }

    fn pop_render(q: &mut Q) -> (String, u32) {
        match q.pop(0) {
            Some(Job::Render { key, .. }) => (key.book_id, key.page),
            _ => panic!("expected a render job"),
        }
    }

    fn fail_all(waiters: Vec<Waiter>) {
        for waiter in waiters {
            waiter(Err(EngineError::Superseded));
        }
    }

    #[test]
    fn calls_go_before_renders_and_viewer_before_prefetch() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let mut q = Q::default();
        request(&mut q, "a", 10, Some(waiter(&log, "p10")));
        q.push_call(None, "geometry");

        assert!(matches!(q.pop(0), Some(Job::Call("geometry"))));
        // La página pedida va antes que la precarga (11, 12, 9, 8), aunque se encolara primero o después.
        assert_eq!(pop_render(&mut q), ("a".into(), 10));
        assert_eq!(pop_render(&mut q), ("a".into(), 11));
    }

    #[test]
    fn targeted_calls_are_only_taken_by_their_worker() {
        let mut q = Q::default();
        q.push_call(Some(1), "warm worker 1");
        q.push_call(None, "anyone");

        assert!(matches!(q.pop(0), Some(Job::Call("anyone"))));
        assert!(q.pop(0).is_none());
        assert!(matches!(q.pop(1), Some(Job::Call("warm worker 1"))));
    }

    #[test]
    fn prefetch_is_biased_to_the_direction_of_travel() {
        let mut q = Q::default();
        request(&mut q, "a", 10, None);
        // Avanza: 11 y 12 primero, luego 9 y 8.
        let forward: Vec<u32> = (0..4).map(|_| pop_render(&mut q).1).collect();
        assert_eq!(forward, vec![11, 12, 9, 8]);

        request(&mut q, "a", 9, None);
        // Ahora retrocede: se salta lo que ya está en curso (8, 11) y va primero la 7, luego la 10.
        let backward: Vec<u32> = (0..q.queued()).map(|_| pop_render(&mut q).1).collect();
        assert_eq!(backward, vec![7, 10]);
    }

    #[test]
    fn prefetch_stays_inside_the_book() {
        let mut q = Q::default();
        q.viewer_request(key("a", 1), PathBuf::new(), None, Some(2), &never_cached);

        assert_eq!(q.queued(), 1); // solo la 2
        assert_eq!(pop_render(&mut q).1, 2);
    }

    #[test]
    fn prefetch_skips_cached_and_pending_pages() {
        let mut q = Q::default();
        let cached = |candidate: &PageKey| candidate.page == 11;
        q.viewer_request(key("a", 10), PathBuf::new(), None, Some(100), &cached);

        let pages: Vec<u32> = (0..q.queued()).map(|_| pop_render(&mut q).1).collect();
        assert_eq!(pages, vec![12, 9, 8]);
    }

    #[test]
    fn a_new_zone_drops_stale_requests_and_old_prefetch() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let mut q = Q::default();
        request(&mut q, "a", 5, Some(waiter(&log, "p5")));
        request(&mut q, "a", 6, Some(waiter(&log, "p6")));
        // El visor salta a la página 80: la 5 y la 6 ya no hacen falta, tampoco su precarga.
        let dropped = request(&mut q, "a", 80, Some(waiter(&log, "p80")));
        fail_all(dropped);

        let mut log = log.lock().expect("log").clone();
        log.sort();
        assert_eq!(log, vec!["p5:request superseded", "p6:request superseded"]);
        let pages: Vec<u32> = (0..q.queued()).map(|_| pop_render(&mut q).1).collect();
        assert_eq!(pages[0], 80);
        assert!(
            pages.iter().all(|page| (78..=82).contains(page)),
            "{pages:?}"
        );
    }

    #[test]
    fn a_new_scale_supersedes_queued_requests_at_the_old_one() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let mut q = Q::default();
        request(&mut q, "a", 10, Some(waiter(&log, "p10@100")));
        request(&mut q, "a", 11, Some(waiter(&log, "p11@100")));
        let zoomed = PageKey {
            scale_q: 150,
            ..key("a", 10)
        };
        let dropped = q.viewer_request(
            zoomed,
            PathBuf::from("/x.pdf"),
            Some(waiter(&log, "p10@150")),
            Some(100),
            &never_cached,
        );
        fail_all(dropped);

        let mut log = log.lock().expect("log").clone();
        log.sort();
        assert_eq!(
            log,
            vec!["p10@100:request superseded", "p11@100:request superseded"]
        );
        match q.pop(0) {
            Some(Job::Render { key, .. }) => assert_eq!((key.page, key.scale_q), (10, 150)),
            _ => panic!("expected a render job"),
        }
        // Y nada de lo que queda es de la escala vieja.
        while let Some(Job::Render { key, .. }) = q.pop(0) {
            assert_eq!(key.scale_q, 150);
        }
    }

    #[test]
    fn a_new_scale_does_not_cancel_renders_already_in_flight() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let mut q = Q::default();
        request(&mut q, "a", 10, Some(waiter(&log, "p10@100")));
        assert_eq!(pop_render(&mut q).1, 10); // en curso
        let zoomed = PageKey {
            scale_q: 150,
            ..key("a", 10)
        };
        let dropped = q.viewer_request(zoomed, PathBuf::new(), None, Some(100), &never_cached);

        assert!(dropped.is_empty());
        assert_eq!(q.complete(&key("a", 10)).len(), 1);
    }

    #[test]
    fn other_books_are_not_affected_by_a_jump() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let mut q = Q::default();
        request(&mut q, "a", 5, Some(waiter(&log, "a5")));
        let dropped = request(&mut q, "b", 80, Some(waiter(&log, "b80")));

        assert!(dropped.is_empty());
    }

    #[test]
    fn nearest_to_the_latest_request_goes_first() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let mut q = Q::default();
        for page in [10, 11, 12, 13] {
            request(&mut q, "a", page, Some(waiter(&log, "x")));
        }
        // Foco en 13: 13, 12, 11, 10 (lo último que ve el usuario va antes).
        let order: Vec<u32> = (0..4).map(|_| pop_render(&mut q).1).collect();
        assert_eq!(order, vec![13, 12, 11, 10]);
    }

    #[test]
    fn identical_requests_share_one_render() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let mut q = Q::default();
        request(&mut q, "a", 10, Some(waiter(&log, "first")));
        request(&mut q, "a", 10, Some(waiter(&log, "second")));
        let (_, page) = pop_render(&mut q);
        assert_eq!(page, 10);
        // Una tercera mientras se renderiza se une a la que está en curso.
        request(&mut q, "a", 10, Some(waiter(&log, "third")));

        let waiters = q.complete(&key("a", 10));
        assert_eq!(waiters.len(), 3);
        for waiter in waiters {
            waiter(Ok(Arc::new(vec![1])));
        }
        assert_eq!(log.lock().expect("log").len(), 3);
        // Y no queda un segundo render de la 10 en la cola.
        let rest: Vec<u32> = (0..q.queued()).map(|_| pop_render(&mut q).1).collect();
        assert!(!rest.contains(&10), "{rest:?}");
    }

    #[test]
    fn a_viewer_request_promotes_a_queued_prefetch() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let mut q = Q::default();
        request(&mut q, "a", 10, None); // precarga 11, 12, 9, 8
        request(&mut q, "a", 10, None);
        // El visor pide la 12, que estaba como precarga: pasa a ser del visor y va la primera.
        request(&mut q, "a", 12, Some(waiter(&log, "p12")));

        assert_eq!(pop_render(&mut q).1, 12);
    }

    #[test]
    fn shutdown_returns_pending_waiters() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let mut q = Q::default();
        request(&mut q, "a", 10, Some(waiter(&log, "p10")));

        let waiters = q.shut_down();

        assert_eq!(waiters.len(), 1);
        assert!(q.is_shutdown());
        assert!(q.pop(0).is_none());
    }
}
