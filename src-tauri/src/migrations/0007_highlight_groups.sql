-- Grupos de subrayados (v1.2). docs/IPC.md, "Grupos de subrayados (v1.2)".

-- Un grupo pertenece a un libro. Quitar el libro (removed_at) no borra nada; borrar la fila sí borra sus grupos.
CREATE TABLE highlight_groups (
    id         TEXT PRIMARY KEY,                       -- uuid
    book_id    TEXT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,             -- orden dentro del libro; un grupo nuevo va al final
    created_at TEXT NOT NULL
);

-- Grupos de un libro, por orden.
CREATE INDEX idx_highlight_groups_book ON highlight_groups (book_id);

-- Un subrayado está en un grupo como mucho. NULL = sin grupo. Borrar el grupo no borra subrayados.
ALTER TABLE highlights ADD COLUMN group_id TEXT REFERENCES highlight_groups (id) ON DELETE SET NULL;
