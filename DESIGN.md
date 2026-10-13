# Sistema de diseño de Atril

**Estado:** vigente desde el rediseño "Galería nocturna". **Dueño:** `frontend`. **Referencia visual:** lienzo aprobado, dirección A · Galería nocturna (https://claude.ai/artifact/81BBLVhSzEywWBi2VZpiFr). Sustituye al sistema anterior ("museo de noche", dirección B, monocromo y con hilos).

Este documento se deriva del lienzo. Los tokens viven en `src/index.css` (`@theme inline` y variables por tema); si cambian, cambian aquí en el mismo commit. Lo que el lienzo no fijaba y se ha derivado (tema claro, estados, escala intermedia) va marcado con **(derivado)**. Las maquetas usan grises sueltos para cada superficie; aquí se han reducido a una escala de ocho tonos (§2.1).

## 1. Principios visuales

- **El color está en las portadas.** Las portadas se ven siempre a color, con sombra y canto de lomo. La interfaz es cálida y oscura para que sean lo que más brilla.
- **Un solo acento.** El ocre `#C9A05A` marca lo principal: el botón primario, el progreso, el rótulo "SEGUIR LEYENDO", la selección activa. Los pigmentos de los subrayados son el otro color con función; nada más lleva color.
- **Tonos en vez de hilos.** Las secciones se separan con espacio y con superficies de tono distinto (tarjetas, banda de Favoritos, tarjetas de Sala). No hay líneas entre secciones ni rótulos con hilo. Solo quedan el separador dentro de la píldora del lector y el marco discontinuo de "Nueva Sala".
- **Radios y sombras suaves.** Esquinas redondeadas (10 a 24 px) en todo salvo la portada, que casi no se redondea (3 px el canto del lomo, 6 px el otro lado). Las sombras son anchas y oscuras y solo las llevan las portadas y lo que flota (píldora, barra de selección, menús).
- **Jerarquía por escala y tono.** Cormorant en títulos de obra, de Sala y de sección; Inter en la interfaz. Lo secundario baja de tono, no de tamaño por debajo de 11 px.
- **La interfaz se retira al leer.** En el lector no hay controles a la vista salvo la píldora, que aparece con el ratón y se oculta sola. La página manda.

## 2. Color

### 2.1 Temas

El tema oscuro es el predeterminado. El tema claro ("cubo blanco") se activa desde Ajustes (`Settings.theme`). Se aplica como `data-theme="dark" | "light"` en `<html>`; `index.html` arranca en oscuro para evitar un destello.

| Token (CSS) | Clase Tailwind | Oscuro | Cubo blanco (derivado) | Uso |
|---|---|---|---|---|
| `--canvas` | `bg-canvas` | `#12100E` | `#F5F4F0` | Fondo de la app |
| `--surface` | `bg-surface` | `#171512` | `#ECE9E1` | Barra lateral y paneles del lector |
| `--card` | `bg-card` | `#1A1714` | `#E9E5DB` | Tarjetas (en curso, Ajustes, banda de Favoritos) |
| `--field` | `bg-field` | `#1C1916` | `#E4E0D5` | Campos, chips en reposo, ordenar |
| `--raised` | `bg-raised` | `#221F1B` | `#F3F1EA` | Filas dentro de una tarjeta, tarjetas de subrayado, bandeja del segmentado de la píldora |
| `--surface-2` | `bg-surface-2` | `#24201B` | `#FBFAF7` | Elemento activo de la barra lateral, "Abrir un PDF…", barra de selección, menús |
| `--surface-3` | `bg-surface-3` | `#2A2621` | `#E0DCD0` | Estado `hover` de los botones de icono, campo de página |
| `--line` | `bg-line`, `border-line` | `#3A352E` | `#CFC9BC` | Separador dentro de la píldora, marco discontinuo |
| `--ink` | `text-ink` | `#EDEAE4` | `#1A1714` | Texto principal; relleno de la opción activa |
| `--ink-2` | `text-ink-2` | `#B3ADA3` | `#54504A` | Texto secundario (autor, descripciones) |
| `--ink-3` | `text-ink-3` | `#958F85` | `#5F5A52` | Texto terciario (contadores, rótulos) |
| `--ink-inverse` | `text-ink-inverse` | `#12100E` | `#F5F4F0` | Texto sobre `ink` |
| `--accent` | `bg-accent` | `#C9A05A` | `#85601C` | Relleno: botón primario, progreso |
| `--accent-ink` | `text-accent-ink` | `#1A1410` | `#FFFBF2` | Texto sobre `accent` |
| `--accent-text` | `text-accent-text` | `#C9A05A` | `#6F4F14` | Acento como texto (rótulos), icono activo y foco |
| `--wash` | `bg-wash` | `rgb(237 234 228 / 8 %)` | `rgb(26 23 20 / 7 %)` | Botón secundario sobre cualquier superficie |
| `--veil` | `bg-veil` | `rgb(0 0 0 / 28 %)` | `rgb(255 255 255 / 50 %)` | Bloque del último subrayado dentro de la tarjeta |
| `--track` | `bg-track` | `rgb(237 234 228 / 12 %)` | `rgb(26 23 20 / 14 %)` | Pista de las barras de progreso |
| `--pill` | `bg-pill` | `rgb(28 25 22 / 94 %)` | `rgb(251 250 247 / 94 %)` | Píldora del lector y barra de búsqueda |
| `--scrim` | `bg-scrim` | `rgb(18 16 14 / 82 %)` | `rgb(245 244 240 / 85 %)` | Botones y distintivos sobre una portada |

**Tema claro (cubo blanco).** Mismo criterio, con los tonos "hacia arriba": las superficies de fondo (barra lateral, tarjetas, campos) son más oscuras que el lienzo y lo que se eleva (elemento activo, barra de selección, filas de tarjeta) es más claro. Las portadas siguen a color y su sombra se suaviza. El acento se oscurece (`#85601C`, `#6F4F14` como texto) para mantener el contraste; el tinte de las tarjetas teñidas baja del 18 % al 12 %.

**Contraste medido** (WCAG, texto normal; en el tema oscuro y entre paréntesis en el claro):

| Par | Ratio | |
|---|---|---|
| `ink` sobre `canvas` | 15.8 (16.2) | AA |
| `ink-2` sobre `canvas` | 8.5 (7.3) | AA |
| `ink-2` sobre `surface-3` (el peor fondo) | 6.7 (5.8) | AA |
| `ink-3` sobre `canvas` | 5.9 (6.2) | AA |
| `ink-3` sobre `raised` | 5.1 (6.1) | AA |
| `ink-3` sobre `surface-3` (el peor fondo) | 4.7 (5.0) | AA |
| `ink-inverse` sobre `ink` (opción activa, chip activo) | 15.8 (16.2) | AA |
| `accent-ink` sobre `accent` (botón primario) | 7.5 (5.5) | AA |
| `accent-text` sobre `canvas` / `card` | 7.8 / 7.4 (6.8 / 6.0) | AA |
| `accent` como relleno sobre `card` (progreso, no texto) | 7.4 (4.5) | AA gráfico (≥ 3) |
| Tarjeta "Seguir leyendo": `ink` / `ink-2` / `accent-text`, peor de siete portadas de prueba | 10.2 / 5.5 / 5.0 (13.2 / 5.9 / 5.5) | AA |
| Tarjeta de Sala: `ink` / `ink-2` / `room-ink`, peor de los ocho colores | 12.4 / 6.7 / 7.6 (14.1 / 6.3 / 4.9) | AA |

`ink-3` no se usa sobre superficies teñidas por una portada. Las portadas tipográficas son decoración (`aria-hidden`): su título siempre está escrito al lado.

### 2.2 Superficies teñidas

- **Tarjeta "Seguir leyendo".** Fondo: `color-mix(in oklab, <coverColor> 18%, <canvas>)` (12 % en el claro), con `--tint` puesto desde `Book.coverColor`. Sin color (`null`) o con un gris casi blanco (saturación HSL < 0,12 y luminosidad > 0,85, la primera página en blanco de un escaneo), la tarjeta usa `card`. El color nunca es texto.
- **Tarjeta y cabecera de Sala.** Fondo: `color-mix(in oklab, var(--room) 16%, <canvas>)` (14 % en el claro). El color de cada Sala no está en el backend: sale de una paleta fija de ocho tonos apagados, elegido por una suma de comprobación del id (`library/identity.ts`, `[data-room]` en `index.css`). `text-room-ink` mezcla el color con la tinta al 55 % para el rótulo "SALA".

| `data-room` | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| `--room` | `#6F9A7E` | `#9C86C2` | `#C47A5A` | `#7C9CBF` | `#BF7C8E` | `#5FA3A0` | `#A3A566` | `#B8896A` |

### 2.3 Lector: papel y tinta por modo

El papel del lector no sigue al tema de la app: sigue a su modo de página (`ViewMode`: `normal`, `sepia`, `night`), con `data-reader-mode` en `<html>`. **No ha cambiado** con el rediseño. Los tres papeles también existen siempre como tokens propios (`--paper-normal`, `--paper-sepia`, `--paper-night`, con su `-ink`) para las muestras de Ajustes.

| Modo | `--paper` | `--paper-ink` |
|---|---|---|
| Normal | `#F4F1EA` | `#1C1A17` (15.4 : 1) |
| Sepia | `#F1E6CF` | `#3A2E22` (10.6 : 1) |
| Noche | `#0D0D0D` | `#EDEAE4` (16.2 : 1) |

## 3. Pigmentos de subrayado

Cuatro pigmentos apagados, distinguibles entre sí. En la página, cada uno es un **fondo de marca** con opacidad del 45 % detrás del texto, nunca color del texto. Los nombres coinciden con `HighlightColor` de `docs/IPC.md`.

| Pigmento | `HighlightColor` | Hex | Token CSS | Clase Tailwind |
|---|---|---|---|---|
| Ocre | `ochre` | `#B5914F` | `--pigment-ocre` | `bg-pigment-ocre` |
| Siena | `sienna` | `#A0644A` | `--pigment-sienna` | `bg-pigment-sienna` |
| Salvia | `sage` | `#8A9A7B` | `--pigment-sage` | `bg-pigment-sage` |
| Pizarra | `slate` | `#6E7A88` | `--pigment-slate` | `bg-pigment-slate` |

Texto de subrayado (`--paper-ink` sobre el pigmento al 45 % mezclado con el papel): Ocre 10.4 / 7.4 / 7.3, Siena 8.7 / 6.2 / 9.4, Salvia 10.3 / 7.4 / 7.4, Pizarra 9.0 / 6.4 / 9.0 (papel normal / sepia / noche).

Fuera de la página (cita del último subrayado, tarjetas del panel) el pigmento aparece como punto, como barra de 4 px o como fondo al 40 % (`highlight-mark`). Como indicador, el pigmento nunca va solo: lleva su nombre ("Ocre · p. 352").

## 4. Tipografía

### 4.1 Familias (OFL, empaquetadas en la app)

| Familia | Uso | Paquete | Pesos |
|---|---|---|---|
| **Cormorant Garamond** (serif de exhibición) | Títulos de obra, de Sala y de sección; citas de subrayados | `@fontsource/cormorant-garamond` (latín) | 500, 600, 500 cursiva |
| **Inter** (grotesca neutra, cifras tabulares) | Interfaz, cuerpo del lector, números | `@fontsource-variable/inter` | 400 a 700 (variable) |

Las fuentes se importan en `src/index.css`. **No hay Google Fonts en tiempo de ejecución**: los archivos viajan dentro de la app. Las cifras son tabulares en todo el documento.

### 4.2 Escala

| Token | Tamaño | Familia / peso | Uso |
|---|---|---|---|
| `text-label` | 11 px | Inter 600, versalitas, `tracking-label` | Rótulos ("SALAS", "ÚLTIMO SUBRAYADO · P. 66") |
| `text-caption` | 12 px | Inter 400 | Contadores, autor bajo una portada |
| `text-ui` | 13 px | Inter 400–600 | Chips, controles secundarios |
| `text-base` | 14 px | Inter 400–600 | Navegación, botones, campos |
| `text-body` | 15 px | Inter 400 | Autor en la tarjeta grande, nombre de carpeta |
| `text-reading` | 17 px / 1.75 | Inter 400 | Cuerpo del lector |
| `text-title-sm` | 18 px | Cormorant 600 | Título bajo una portada, título en la píldora |
| `text-title-md` | 21 px | Cormorant 600 | Título de una tarjeta "en curso" |
| `text-quote` | 22 px | Cormorant 500 cursiva | Cita del último subrayado |
| `text-cartela` | 24 px | Cormorant 600 | Título de un aviso |
| `text-panel` | 30 px | Cormorant 600 | Título de un panel y de una tarjeta de Ajustes |
| `text-sala` | 34 px | Cormorant 600 | Título de sección de Inicio |
| `text-room-name` | 40 px | Cormorant 600 | Nombre de Sala en su tarjeta |
| `text-page` | 48 px | Cormorant 600 | Título de pantalla; título largo en la tarjeta grande |
| `text-obra` | 56 px | Cormorant 600 | Ajustes; nombre de Sala medio |
| `text-feature` | 64 px / 0.98 | Cormorant 600 | Título en "Seguir leyendo" |
| `text-hero` | 96 px / 0.92 | Cormorant 600 | Nombre de Sala corto en su cabecera |

Reglas: los rótulos llevan `tracking-label` (0.14 em) o `tracking-kicker` (0.16 em, el rótulo acentuado). El wordmark `ATRIL` usa `tracking-wordmark` (0.32 em), peso 700. Los títulos largos bajan de nivel (tarjeta grande: 64, 48, 34 px según la longitud; Sala: 96, 56, 48) y se recortan a tres líneas.

### 4.3 Cuerpo del lector

Inter 17 px, interlineado 1.75, 560–620 px de medida. El papel es `--paper`; el texto `--paper-ink`. Sin cambios.

## 5. Espaciado y estructura

- **Base de 4 px** (escala de Tailwind). Márgenes de pantalla: 56 px laterales, 36 px arriba, 72 px abajo. Separación entre secciones de Inicio: 56 px; título de sección a contenido: 20 px.
- **Barra lateral fija** de 256 px (`bg-surface`, a pantalla completa y pegada arriba), con su desplazamiento propio. El contenido ocupa el resto.
- **Rejillas:** portadas `auto-fill` de 150 a 160 px mínimos (columnas 24–28 px, filas 32–40 px); tarjetas "en curso" de 260 px mínimo (hueco 16 px); tarjetas de Sala de 340 px mínimo (hueco 20 px).
- **Portadas:** proporción 2 : 3. Tamaños: `xl` 220 × 330 (Seguir leyendo), `lg` 160 × 240 (cabecera de Sala), `md` 150 × 225 (Favoritos), `xs` 100 × 150 (abanico), `sm` 64 × 96 (en curso), `fluid` al ancho de la rejilla.
- **Panel del lector:** 360 px, a todo el alto, `bg-surface`, sin línea.

## 6. Radios, sombras y hilos

| Token | Valor | Uso |
|---|---|---|
| `rounded-cover` | 3 px 6 px 6 px 3 px | Portadas (canto del lomo a la izquierda) |
| `rounded-tab` | 8 px | Opciones del segmentado, distintivos, tecla "Ctrl K" |
| `rounded-control` | 10 px | Botones, filas de navegación |
| `rounded-field` | 12 px | Campos, botones de icono, bandejas |
| `rounded-tile` | 14 px | Tarjetas pequeñas, filas, barra de selección, tarjetas de subrayado |
| `rounded-bar` | 18 px | Píldora del lector |
| `rounded-card` | 20 px | Tarjetas grandes |
| `rounded-panel` | 24 px | Cabecera de Sala |
| `rounded-pill` | 9999 px | Chips, distintivos, barras de progreso |
| `rounded-dot` | 9999 px | Puntos de pigmento |

| Sombra | Uso |
|---|---|
| `shadow-cover` | Portadas: dos inset (lomo y brillo) más sombra caída y de contacto |
| `shadow-float` | Barra de selección, editor de subrayado, menús, aviso |
| `shadow-pill` | Píldora del lector y barra de búsqueda |

La portada real lleva además su canto (`cover-spine`, 6 px) por encima de la imagen. **Hilos:** ninguno entre secciones. Foco visible: contorno de 2 px `accent-text` con separación de 2 px, en todo control.

## 7. Movimiento

| Token | Valor | Uso |
|---|---|---|
| `--ease-atril` | `cubic-bezier(0.22, 1, 0.36, 1)` | Todo el movimiento (ease-out) |
| `--duration-fast` | 200 ms | Estados de botones y chips |
| `--duration-base` | 250 ms | La portada sube 4 px al pasar el ratón; paneles |
| `--duration-slow` | 300 ms | Aparición de la píldora |

Sin rebotes. **`prefers-reduced-motion: reduce`**: las tres duraciones pasan a 0 ms. Ningún estado depende solo de la animación.

## 8. Portadas

- **Siempre a color.** Sin filtro de grises.
- **Portada real** (`Book.coverUrl`): imagen `object-cover` en 2 : 3, con `shadow-cover`, esquinas de 3 / 6 px y el canto del lomo encima.
- **Portada tipográfica** (libro sin portada: indexando o fallida): cara de color (`cover-face`) con una regla, el título en Cormorant 600, una marca circular y el autor en versalitas. Catorce combinaciones de fondo, tinta y marca (`[data-tone]` en `index.css`, tomadas de las maquetas); la de cada libro sale de una suma de comprobación de su id, así que no cambia entre sesiones. Los tamaños de letra siguen al ancho de la portada (`cqw`), de modo que el mismo componente sirve de 64 a 220 px; en `sm` no lleva autor.
- Un libro cuyo archivo falta se ve al 50 % de opacidad.
- Distintivo "Terminado" (progreso ≥ 1): pastilla `scrim` abajo a la derecha de la portada.

## 9. Componentes

| Componente | Descripción | Tokens |
|---|---|---|
| **Barra lateral** | 256 px, `surface`. Marca (icono en `accent-text` y wordmark), navegación (Inicio, Todos los libros, Favoritos, En curso) con contadores, lista de Salas con su color y "Nueva Sala" (el botón se vuelve campo de nombre), y abajo "Abrir un PDF…" y Ajustes. El destino activo lleva `surface-2` | `surface`, `surface-2`, `ink-2`, `ink-3` |
| **Cabecera de Inicio** | Título "Biblioteca" (`text-page`), resumen "24 obras · 2 Salas · 5 en curso" y buscador (`field`, tecla "Ctrl K" que lo enfoca) | `field`, `ink-2` |
| **Tarjeta "Seguir leyendo"** | `rounded-card`, teñida con la portada (§2.2). Portada `xl`, rótulo "SEGUIR LEYENDO" (`accent-text`), título, autor, barra de progreso gruesa con "38 %" y "p. 357 de 940", "Continuar leyendo" (primario) y "Subrayados · N" (secundario, solo si hay). A la derecha, el último subrayado del libro (el de `createdAt` más reciente) con su nota y "Ver los N subrayados →"; sin subrayados, el bloque no aparece | `accent`, `veil`, `wash` |
| **Tarjeta "en curso"** | `card`, `rounded-tile`: portada `sm`, título (`text-title-md`), autor, barra y "72 % · quedan 84 páginas" | `card`, `raised` (hover) |
| **Banda de Favoritos** | `card`, `rounded-card`, portadas `md` en una fila con desplazamiento horizontal | `card` |
| **Tarjeta de Sala** | `rounded-card`, teñida con el color de la Sala. Nombre (`text-room-name`), "14 obras" y tres portadas `xs` en abanico (`sampleBooks`). Al arrastrar un libro encima se marca con un anillo `accent`. "Nueva Sala": mismo tamaño, marco discontinuo `line` | `room`, `accent`, `line` |
| **Cabecera de Sala** | `rounded-panel`, teñida; "← Biblioteca", rótulo "SALA", nombre en `text-hero`, "14 obras · 3 en curso · 1 terminada", "Renombrar" y "Borrar Sala", y el abanico de portadas `lg` | `room` |
| **Chips de filtro** | `rounded-pill`, `field` en reposo, `ink` con `ink-inverse` activo; selector de orden con el mismo aspecto | `field`, `ink` |
| **Portada** y **portada tipográfica** | §8 | `shadow-cover`, `[data-tone]` |
| **Tarjeta de libro** | Portada `fluid`, título (`text-title-sm`), autor, y si está en curso barra y porcentaje. Sobre la portada: menú `⋯` y estrella de favorito (`scrim`) al pasar el ratón | `scrim` |
| **Botón primario** | `accent` con `accent-ink`, `rounded-control`, 14 px 600 | `accent` |
| **Botón secundario** | `wash` con `ink` | `wash` |
| **Botón de texto** | `ink-2`, sin fondo | `ink-2` |
| **Segmentado** | Bandeja redondeada (`canvas` sobre tarjeta, `raised` en la píldora); opción activa `ink` con `ink-inverse` | `ink` |
| **Tarjeta de Ajustes** | `card`, `rounded-card`, 32 px de margen interior; título en `text-panel`. Carpetas (filas `raised`, icono teñido por carpeta), Apariencia (tema e idioma), Lectura (zoom y tres muestras de papel "Aa" con anillo `accent` en la elegida) y Lector predeterminado | `card`, `raised`, `accent` |
| **Píldora del lector** | Flotante, 24 px sobre el borde inferior y centrada en la página que queda (si hay panel, se desplaza 376 px). `pill`, `rounded-bar`, `shadow-pill`. Contenido, en orden: volver, título y autor, campo de página "67 / 148", índice, buscar, subrayados (icono; activo en `accent-text`), papel (segmentado), alejar, "125 %", acercar y "Subrayador · H" con el punto del último pigmento. Aparece con el ratón y se oculta a los 2 s sin movimiento; mientras el foco está dentro se queda | `pill`, `surface-3`, `line` |
| **Línea de progreso del libro** | 3 px arriba del lector: pista `track`, relleno `accent` hasta la página actual | `track`, `accent` |
| **Paneles del lector** (subrayados, índice) | 360 px, `surface`, sin línea. Título serif con su cuenta y botón de cerrar. Subrayados: chips "Todos", "Con nota" y "Exportar a Markdown"; tarjetas `raised` con barra de pigmento de 4 px, rótulo "OCRE · P. 352", cita en cursiva y la nota en un bloque `surface-2` | `surface`, `raised` |
| **Barra de selección** | Flotante junto a la selección, `surface-2`, `rounded-tile`, `shadow-float`. Cuatro puntos de pigmento de 24 px (el último usado, con anillo `ink`), separador, "Nota" y "Copiar" | `surface-2`, pigmentos |
| **Barra de búsqueda** | Como la píldora, arriba y centrada: campo, "26 de 48", anterior, siguiente y cerrar | `pill` |
| **Aviso** | `card`, `rounded-card` o `rounded-tile`, sin marco; título en serif | `card` |

## 10. Accesibilidad

- Todo control es un `button`, `a` o `input` real con etiqueta accesible; los iconos sin texto llevan `aria-label` y `title`.
- Foco visible en todos los elementos interactivos (§6).
- Contraste mínimo AA en todos los pares de texto (§2.1).
- Los estados activos no dependen solo del color: llevan relleno (`ink`), `aria-pressed` o `aria-current`.
- Los subrayados llevan su nombre de color además del pigmento.
- `prefers-reduced-motion` respetado (§7).

## 11. Tailwind 4

Los tokens se exponen en `src/index.css` con `@theme inline`, de forma que las utilidades (`bg-card`, `text-ink-2`, `rounded-card`, `shadow-cover`, `text-sala`, `font-serif`, `ease-atril`) leen las variables del tema activo en tiempo de ejecución; cambiar de tema no recompila nada. Las utilidades propias (`bg-room-tint`, `bg-cover-tint`, `cover-spine`, `cover-face`, `highlight-mark`) se declaran con `@utility` en el mismo archivo. Los colores que vienen de datos (`--tint` de la portada, `--room`, `--cover-*`, `--mark`) se asignan con `data-*` o con una variable, nunca con un valor suelto en un componente.
