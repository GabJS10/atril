-- Esquema inicial (docs/PLAN.md, "Modelo de datos").
-- Fechas: texto ISO 8601 UTC. Zoom y rectángulos: JSON en texto.

CREATE TABLE books (
    id             TEXT PRIMARY KEY,                -- sha256 del contenido, hex (ver PLAN.md)
    path           TEXT NOT NULL UNIQUE,
    file_size      INTEGER NOT NULL CHECK (file_size >= 0),
    file_mtime     INTEGER,                         -- segundos Unix
    title          TEXT NOT NULL,
    author         TEXT,
    page_count     INTEGER CHECK (page_count IS NULL OR page_count >= 1),
    scan_state     TEXT NOT NULL DEFAULT 'pending'
                   CHECK (scan_state IN ('pending', 'done', 'failed')),
    favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    missing        INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1)),
    added_at       TEXT NOT NULL,
    last_opened_at TEXT
);

-- "Seguir leyendo" ordena por la última apertura.
CREATE INDEX idx_books_last_opened ON books (last_opened_at);

CREATE TABLE reading_state (
    book_id        TEXT PRIMARY KEY REFERENCES books (id) ON DELETE CASCADE,
    page           INTEGER NOT NULL CHECK (page >= 1),        -- 1-based
    offset_in_page REAL NOT NULL DEFAULT 0 CHECK (offset_in_page BETWEEN 0 AND 1),
    zoom           TEXT NOT NULL,                              -- JSON: "page_width" | número
    scroll_mode    TEXT NOT NULL DEFAULT 'continuous',
    view_mode      TEXT NOT NULL DEFAULT 'normal'
                   CHECK (view_mode IN ('normal', 'sepia', 'night')),
    updated_at     TEXT NOT NULL
);

CREATE TABLE highlights (
    id          TEXT PRIMARY KEY,                          -- uuid
    book_id     TEXT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    page        INTEGER NOT NULL CHECK (page >= 1),
    rects       TEXT NOT NULL,                             -- JSON, coordenadas PDF
    text        TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL CHECK (color IN ('ochre', 'sienna', 'sage', 'slate')),
    note        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Subrayados de un libro, por página.
CREATE INDEX idx_highlights_book_page ON highlights (book_id, page);

CREATE TABLE collections (                               -- "Salas"
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);

-- Un libro puede estar en varias Salas.
CREATE TABLE book_collections (
    book_id       TEXT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections (id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, collection_id)
);

CREATE INDEX idx_book_collections_collection ON book_collections (collection_id);

CREATE TABLE library_folders (
    id   TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE
);

-- Ajustes: una fila por clave, valor en JSON.
CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
