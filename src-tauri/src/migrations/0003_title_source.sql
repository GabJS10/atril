-- De dónde viene el título: del nombre del archivo, de los metadatos del PDF o del usuario.
-- Mientras sea 'filename', el título sigue al nombre cuando el archivo cambia de ruta.
ALTER TABLE books ADD COLUMN title_source TEXT NOT NULL DEFAULT 'filename'
    CHECK (title_source IN ('filename', 'metadata', 'user'));

-- Los libros ya indexados conservan el título que guardó el indexador.
UPDATE books SET title_source = 'metadata' WHERE scan_state = 'done';
