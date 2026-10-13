# Producto: Atril

## Qué es
Atril es un lector de PDF de escritorio para leer libros. Es minimalista, ligero y silencioso. Abre los PDF desde el sistema, recuerda la posición exacta de cada libro y guarda los subrayados en cuanto se crean. El PDF original nunca se modifica: subrayados, notas, progreso y Salas viven en una base de datos local (SQLite).

## Para quién
Una sola persona que lee en su equipo con su propia biblioteca de PDF: decenas o cientos de libros, algunos sin terminar, otros releídos. Lee en Linux primero (Windows en el backlog). Quiere abrir un libro y seguir donde lo dejó, sin configurar nada.

## Qué resuelve
- **Seguir leyendo** sin buscar: el último libro abierto, con su progreso.
- **Organizar sin carpetas**: Favoritos y Salas (colecciones) sobre una biblioteca que vigila sus carpetas.
- **Subrayar y anotar** mientras se lee, con cuatro pigmentos, y exportar las notas a Markdown.
- **Leer cómodamente**: modo noche, sepia, índice, búsqueda y zoom, sin controles a la vista mientras se lee.

## Principios
1. **Silencioso.** La interfaz desaparece cuando se lee. Nada parpadea, nada pide atención sin motivo.
2. **El color está en los libros.** Una interfaz cálida y oscura donde brillan las portadas, con un solo acento ocre para lo principal. El otro color con función son los pigmentos de los subrayados.
3. **El contenido manda.** La página, la portada y el título son lo primero. Los controles aparecen cuando se mueve el ratón y se ocultan solos.
4. **Galería nocturna.** La biblioteca es una galería: cada libro es una obra, cada Sala una sala, con su color. Superficies de tono en vez de líneas, esquinas suaves, mucho aire.
5. **Sin sorpresas con los archivos.** Atril no escribe en los PDF, no los borra al quitarlos de la biblioteca y reconoce un libro movido o renombrado por su contenido.
6. **Sin ruido de producto.** Sin cuentas, sin nube, sin publicidad, sin notificaciones ni avisos que pidan atención sin motivo.

## Qué no es
- No es un gestor de bibliografía ni un editor de PDF.
- No sincroniza con servicios externos ni tiene cuentas.
- No es una tienda ni un catálogo: solo muestra lo que el usuario añade.

## Idiomas
Español e inglés. Por defecto sigue al idioma del sistema; se puede fijar en Ajustes. Toda la interfaz pasa por `src/i18n/`.

## Referencias
- Plan y arquitectura: [`docs/PLAN.md`](docs/PLAN.md)
- Brief de diseño: [`docs/DESIGN-BRIEF.md`](docs/DESIGN-BRIEF.md)
- Sistema de diseño: [`DESIGN.md`](DESIGN.md)
- Lienzo aprobado (dirección A, Galería nocturna): https://claude.ai/artifact/81BBLVhSzEywWBi2VZpiFr
