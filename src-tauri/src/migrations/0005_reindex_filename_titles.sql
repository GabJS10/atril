-- Algunos PDF traen como título de los metadatos un nombre de archivo (`01-Prefacio_3a.pmd`). El indexador ya
-- descarta esos títulos (`indexer::clean_title`); aquí se vuelven a indexar los candidatos para que la regla nueva
-- decida: un texto sin espacios y con un punto. Criterio amplio a propósito: reindexar es barato y, si el título
-- vale, se guarda igual. No se toca `has_cover`: la portada vieja se sigue mostrando hasta que se regenera.
UPDATE books SET scan_state = 'pending'
WHERE title_source = 'metadata'
  AND scan_state = 'done'
  AND title NOT LIKE '% %'
  AND title LIKE '%.%';
