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

## Para la pausa de pruebas del usuario (antes de la fase 5)
- [ ] Soltar PDFs desde el escritorio o el gestor de archivos sobre la ventana (import_files): no se pudo simular en Xvfb.
- [ ] Selección de texto con arrastre (la app gestiona los arrastres de un clic sobre la capa de texto, `dragSelection.ts`): desde el margen, desde huecos entre palabras, hacia arriba y entre páginas; doble y triple clic.
- [ ] Guardado de la posición tras un uso largo (una vez dejó de guardarse tras recargas en caliente en desarrollo; no reproducido en arranques normales).
- [ ] Atajos del modo foco: F entra y Esc sale (decisión de frontend; DESIGN.md no los fijaba). ¿Te convencen?
- [ ] Pantalla completa con F11.
- [ ] PDF escaneados: no tienen capa de texto, así que no se pueden seleccionar, subrayar ni buscar (no hay OCR). ¿Es aceptable o va al backlog?
- [ ] "Abrir con Atril" desde el gestor de archivos: solo se puede probar con el `.deb` instalado (fase 5).
