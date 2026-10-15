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
- ~~"Abrir con Atril" desde el gestor de archivos~~: descartado el 2026-10-13. Atril no se registra como lector de PDF (ver `PLAN.md`).

## v1.0.x (release, sobre los paquetes instalados)
Se pasa con el `.deb` instalado (`sudo apt install ./atril-libros_1.0.1_amd64.deb`) y otra vez con el AppImage (`chmod +x atril-libros_1.0.1_amd64.AppImage` y ejecutar). El paquete y el binario se llaman `atril-libros` para no chocar con el lector Atril de MATE (paquete `atril`); la app se sigue llamando «Atril». Primero con `~/.local/share/atril/` vacío (mover la carpeta a un lado) y después con la biblioteca real.

**Instalación**
- [ ] El `.deb` se instala sin errores ni dependencias rotas, y Atril aparece en el menú de aplicaciones con su icono.
- [ ] El AppImage arranca sin instalar nada más.
- [ ] Atril **no** aparece en "Abrir con" para un PDF, ni cambia el lector predeterminado (`xdg-mime query default application/pdf` sigue igual).
- [ ] Lanzar Atril con la app ya abierta enfoca la ventana existente; no se abre otra.
- [ ] `sudo apt remove atril-libros` lo desinstala; los datos de `~/.local/share/atril/` se conservan.
- [ ] `apt list --upgradable` no ofrece el `atril` de MATE como actualización de Atril.

**Primer arranque (datos vacíos)**
- [ ] Biblioteca vacía con "Añadir carpeta…" y "Abrir un PDF…".
- [ ] Añadir `~/datos/libros/Economia`: escaneo visible, portadas a color en segundo plano, el resto de la app usable mientras tanto.
- [ ] Soltar un PDF sobre la ventana lo añade.

**Biblioteca**
- [ ] Inicio: "Seguir leyendo" teñida con el color de la portada, último subrayado, "También en curso", Favoritos, Salas y "Añadidos hace poco".
- [ ] Barra lateral: contadores correctos; Todos, Favoritos, En curso y cada Sala.
- [ ] Buscar (Ctrl K), filtros y ordenación.
- [ ] Crear, renombrar y borrar una Sala; añadir y quitar libros.
- [ ] Mover o renombrar un PDF en disco: conserva progreso, subrayados y Salas. Borrarlo: aviso "no encontrado" con "Buscar archivo…".
- [ ] Tema oscuro y "cubo blanco"; español e inglés.

**Lector**
- [ ] Libro de 300+ páginas: primera página en menos de 300 ms; scroll sin páginas en blanco; zoom nítido.
- [ ] Escaneado (p. ej. de Internet Archive): se lee fluido.
- [ ] Posición: cerrar la app en la p. 150 y reabrir → misma página y desplazamiento.
- [ ] Seleccionar y copiar; subrayar en los 4 pigmentos a tres zooms; nota; editar y borrar; modo subrayador (H); exportar a Markdown.
- [ ] Ctrl F con resaltado; índice; enlaces internos y externos.
- [ ] Papel normal, sepia y noche; modo foco (F / Esc); pantalla completa (F11).
- [ ] PDF dañado o con contraseña: mensaje claro y vuelta a la biblioteca, sin cuelgues.

**Rendimiento y memoria**
- [ ] Memoria tras leer 50 páginas de un escaneado: comparable a Okular con el mismo libro.

## Fase W (Windows 10/11, sobre el instalador NSIS)

**Instalador**
- [ ] SmartScreen avisa (app sin firmar): "Más información → Ejecutar de todas formas" funciona.
- [ ] Instala sin pedir administrador; idioma del instalador según el sistema; acceso "Atril" en el menú Inicio; ejecutable `Atril.exe`.
- [ ] Sin WebView2 instalado (Windows 10 limpio), el instalador lo descarga.
- [ ] Desinstalar desde Configuración → Aplicaciones; los datos en `%LOCALAPPDATA%\atril\` se conservan (o no) según lo esperado.

**Biblioteca**
- [ ] Añadir una carpeta (con espacios, tildes y algún emoji en el nombre); escaneo, portadas y color de portada.
- [ ] La misma carpeta escrita con otras mayúsculas (`c:\libros` vs `C:\Libros`) no se añade dos veces.
- [ ] Soltar un PDF desde el Explorador en la ventana: se importa.
- [ ] Arrastrar un libro a una Sala (arrastre por punteros); un clic normal sigue abriendo el libro. Repetir en Linux.
- [ ] Renombrar, mover y borrar en el Explorador un libro de menos de 16 MiB **con el libro abierto**: se deja y Atril lo detecta. Uno de más de 16 MiB abierto: el Explorador no deja (límite conocido); al cerrar la app, sí.
- [ ] Carpeta en ruta larga (> 260 caracteres), unidad de red y OneDrive (si hay).
- [ ] Segunda instancia (abrir Atril otra vez): enfoca la ventana existente.

**Lector**
- [ ] Render, scroll, zoom (Ctrl + rueda y teclas) nítido y sin páginas en blanco; escaneado grande fluido.
- [ ] Seleccionar y copiar; subrayar, nota, exportar a Markdown (título con `:` o `?`: nombre de archivo válido).
- [ ] Ctrl F abre la búsqueda de Atril (no la del navegador); índice; enlaces internos y externos.
- [ ] Ctrl P, F5, Ctrl R, F3, F7, Alt+←/→, Ctrl+U, F12 y Ctrl+Shift+I no hacen nada del navegador; clic derecho fuera de campos de texto no muestra menú del navegador.
- [ ] Barras de scroll finas y acordes al tema (claro, oscuro, sepia, noche).
- [ ] Posición recordada al cerrar y reabrir; pantalla completa (F11); modo foco.

**Rendimiento y memoria**
- [ ] Memoria (Administrador de tareas) tras leer 50 páginas de un escaneado y tras abrir varios libros pequeños: razonable y comparable a Linux.
