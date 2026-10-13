//! Caché LRU de JPEG ya codificados, limitada por bytes (no por número de entradas).

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

/// Identifica una página renderizada: libro, página (1-based) y escala cuantizada (ver `quantize_scale`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PageKey {
    pub book_id: String,
    pub page: u32,
    pub scale_q: u32,
}

/// LRU por bytes. Una entrada más grande que el límite no se guarda.
#[derive(Debug)]
pub struct ByteLru {
    limit: usize,
    used: usize,
    tick: u64,
    entries: HashMap<PageKey, (u64, Arc<Vec<u8>>)>,
    /// `tick` de último uso -> clave. El primer elemento es el menos reciente.
    order: BTreeMap<u64, PageKey>,
}

impl ByteLru {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            used: 0,
            tick: 0,
            entries: HashMap::new(),
            order: BTreeMap::new(),
        }
    }

    pub fn used_bytes(&self) -> usize {
        self.used
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn contains(&self, key: &PageKey) -> bool {
        self.entries.contains_key(key)
    }

    /// Devuelve la entrada y la marca como la más reciente.
    pub fn get(&mut self, key: &PageKey) -> Option<Arc<Vec<u8>>> {
        let (tick, value) = self.entries.get_mut(key)?;
        self.order.remove(tick);
        self.tick += 1;
        *tick = self.tick;
        self.order.insert(self.tick, key.clone());
        Some(Arc::clone(value))
    }

    pub fn insert(&mut self, key: PageKey, value: Arc<Vec<u8>>) {
        self.remove(&key);
        if value.len() > self.limit {
            return;
        }
        self.used += value.len();
        self.tick += 1;
        self.order.insert(self.tick, key.clone());
        self.entries.insert(key, (self.tick, value));
        while self.used > self.limit {
            let Some((_, oldest)) = self.order.pop_first() else {
                break;
            };
            if let Some((_, evicted)) = self.entries.remove(&oldest) {
                self.used -= evicted.len();
            }
        }
    }

    /// Quita todas las páginas de un libro (p. ej. si el archivo cambió).
    pub fn remove_book(&mut self, book_id: &str) {
        let keys: Vec<PageKey> = self
            .entries
            .keys()
            .filter(|key| key.book_id == book_id)
            .cloned()
            .collect();
        for key in keys {
            self.remove(&key);
        }
    }

    fn remove(&mut self, key: &PageKey) {
        if let Some((tick, value)) = self.entries.remove(key) {
            self.order.remove(&tick);
            self.used -= value.len();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(page: u32) -> PageKey {
        PageKey {
            book_id: "b".into(),
            page,
            scale_q: 100,
        }
    }

    fn blob(len: usize) -> Arc<Vec<u8>> {
        Arc::new(vec![0; len])
    }

    #[test]
    fn evicts_least_recently_used_when_over_the_byte_limit() {
        let mut cache = ByteLru::new(100);
        cache.insert(key(1), blob(40));
        cache.insert(key(2), blob(40));
        assert!(cache.get(&key(1)).is_some()); // 1 pasa a ser la más reciente
        cache.insert(key(3), blob(40));

        assert!(cache.contains(&key(1)));
        assert!(!cache.contains(&key(2)));
        assert!(cache.contains(&key(3)));
        assert_eq!(cache.used_bytes(), 80);
    }

    #[test]
    fn replacing_an_entry_does_not_double_count_its_bytes() {
        let mut cache = ByteLru::new(100);
        cache.insert(key(1), blob(60));
        cache.insert(key(1), blob(30));

        assert_eq!(cache.len(), 1);
        assert_eq!(cache.used_bytes(), 30);
    }

    #[test]
    fn an_entry_larger_than_the_limit_is_not_stored() {
        let mut cache = ByteLru::new(10);
        cache.insert(key(1), blob(11));

        assert!(cache.is_empty());
        assert_eq!(cache.used_bytes(), 0);
    }

    #[test]
    fn remove_book_frees_its_pages_only() {
        let mut cache = ByteLru::new(100);
        cache.insert(key(1), blob(10));
        cache.insert(
            PageKey {
                book_id: "other".into(),
                page: 1,
                scale_q: 100,
            },
            blob(10),
        );
        cache.remove_book("b");

        assert_eq!(cache.len(), 1);
        assert_eq!(cache.used_bytes(), 10);
    }
}
