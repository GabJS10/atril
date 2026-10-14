-- Color dominante de la portada (`Book.coverColor`, "#rrggbb"). NULL = sin portada o aún sin calcular.
-- No se toca ningún dato: el indexador rellena la columna en segundo plano leyendo `covers/<id>.jpg`
-- (`cover_color::color_from_cover_file`), sin reindexar los libros.
ALTER TABLE books ADD COLUMN cover_color TEXT;
