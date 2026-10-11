-- Biblioteca (fase 2). docs/IPC.md, "Fase 2".

-- Quitar un libro de la biblioteca no borra nada: la fila se marca y vuelve al importar el mismo archivo.
ALTER TABLE books ADD COLUMN removed_at TEXT;

-- Hay portada en covers/<id>.webp (la escribe save_book_scan).
ALTER TABLE books ADD COLUMN has_cover INTEGER NOT NULL DEFAULT 0 CHECK (has_cover IN (0, 1));

ALTER TABLE library_folders ADD COLUMN added_at TEXT NOT NULL DEFAULT '';
