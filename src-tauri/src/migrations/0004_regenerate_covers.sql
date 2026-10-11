-- Las portadas de los PDF con fuentes JPX/JBIG2 salieron en blanco: se vuelven a generar.
-- Quien aplica esta migración borra covers/ al arrancar (lib.rs), así que has_cover queda en 0.
UPDATE books SET scan_state = 'pending', has_cover = 0 WHERE scan_state IN ('done', 'failed');
