# QA manual

Lista de comprobación que se pasa sobre la app real (`npm run tauri dev`, y en la fase 5 sobre el `.deb` instalado) antes de cerrar cada fase. Usar libros reales del usuario; ninguno entra en el repo.

## Fase 0
- [ ] `npm run tauri dev` abre la ventana "Atril" (1280×800, no se puede reducir de 900×600).
- [ ] Rutas `/` y `/read/<id>` navegables; textos en el idioma del sistema; cambiar el idioma en código/ajustes funciona.
- [ ] `get_settings` devuelve los valores por defecto en una instalación limpia (borrar `~/.local/share/atril/`).

## Fase 1
- [ ] Abrir un PDF grande (300+ páginas) con el diálogo: la primera página aparece en menos de 1 s.
- [ ] Scroll continuo fluido; zoom ancho / página / %; atajos ←/→, j/k, espacio, +/−, Inicio/Fin.
- [ ] Ir a la p. 150, cerrar la app, reabrir el libro → misma página, mismo desplazamiento y mismo zoom.
- [ ] Renombrar el archivo y abrirlo de nuevo → conserva la posición.
- [ ] PDF escaneado (solo imágenes) y PDF con contraseña o dañado: error claro, sin cuelgues.
