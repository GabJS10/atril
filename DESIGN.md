# Sistema de diseño de Atril

**Estado:** definitivo para la fase 0 (0.F4). **Dueño:** `frontend`. **Referencia visual:** lienzo aprobado "Atril: propuestas", dirección B · Contemporánea (https://claude.ai/artifact/Uzb6H6qUTeG8qHC8EyTW9U, ronda 2).

Este documento se deriva de lo que está en el lienzo. Los tokens viven en `src/index.css` (`@theme inline` y variables por tema); si cambian, cambian aquí en el mismo commit. Lo que el lienzo no fijaba y se ha derivado (superficies claras, líneas fuertes del tema claro, tokens de la barra de selección) va marcado con **(derivado)**.

## 1. Principios visuales

- **Monocromo.** No hay color de acento. La jerarquía sale de la escala, el peso, el espacio y los rótulos, no del color.
- **El único color con función** son los pigmentos de los subrayados (y su indicador en la barra del lector).
- **Sin sombras, sin degradados, sin cristal, sin esquinas redondeadas.** Las únicas formas redondas son los puntos de pigmento.
- **Hilos finos.** Las separaciones son líneas de 1 px; los contenedores no llevan marco pesado.
- **La interfaz se retira.** En el lector no hay controles a la vista; la página manda.

## 2. Color

### 2.1 Temas

El tema oscuro es el predeterminado. El tema claro ("cubo blanco") se activa desde Ajustes (`Settings.theme`). El tema se aplica como `data-theme="dark" | "light"` en `<html>`; `index.html` arranca en oscuro para evitar un destello.

| Token (CSS) | Clase Tailwind | Oscuro | Cubo blanco | Uso |
|---|---|---|---|---|
| `--canvas` | `bg-canvas` | `#0D0D0D` | `#F5F4F0` | Fondo de la app y de las paredes |
| `--surface` | `bg-surface` | `#161616` | `#ECEBE6` (derivado) | Paneles, barras, bloques de estado |
| `--surface-2` | `bg-surface-2` | `#1F1F1F` | `#E2E0D9` (derivado) | Barra de selección, superficies elevadas sin sombra |
| `--line` | `border-line` | `#2A2A2A` | `#D9D6CE` | Hilos, separadores, marcos vacíos |
| `--line-strong` | `border-line-strong` | `#EDEAE4` | `#121212` | Rótulos de sección, cabeceras |
| `--ink` | `text-ink` | `#EDEAE4` | `#121212` | Texto principal (blanco hueso / negro) |
| `--ink-2` | `text-ink-2` | `#A39E95` | `#5C5852` | Texto secundario (autor, metadatos) |
| `--ink-3` | `text-ink-3` | `#8A857C` | `#6E6A63` | Texto terciario (rótulos, cifras de apoyo) |
| `--ink-inverse` | `text-ink-inverse` | `#0D0D0D` | `#F5F4F0` | Texto sobre `ink` (botón primario) |

**Contraste medido** (WCAG, texto normal salvo que se indique):

| Par | Ratio | |
|---|---|---|
| Ink sobre canvas (oscuro) | 16.2 | AA |
| Ink-2 sobre canvas (oscuro) | 7.3 | AA |
| Ink-3 sobre canvas (oscuro) | 5.3 | AA |
| Ink-3 sobre surface (oscuro) | 4.9 | AA |
| Ink sobre canvas (claro) | 17.0 | AA |
| Ink-2 sobre canvas (claro) | 6.4 | AA |
| Ink-3 sobre canvas (claro) | 4.9 | AA |
| Ink-3 sobre surface (claro) | 4.5 | AA (justo) |

### 2.2 Lector: papel y tinta por modo

El papel del lector no sigue al tema de la app: sigue a su modo de página (`ViewMode`: `normal`, `sepia`, `night`). Se aplica con `data-reader-mode` en `<html>` cuando exista la pantalla del lector (fase 1).

| Modo | `--paper` | `--paper-ink` |
|---|---|---|
| Normal | `#F4F1EA` | `#1C1A17` (15.4 : 1) |
| Sepia | `#F1E6CF` | `#3A2E22` (10.6 : 1) |
| Noche | `#0D0D0D` | `#EDEAE4` (16.2 : 1) |

## 3. Pigmentos de subrayado

Cuatro pigmentos apagados, distinguibles entre sí. Cada uno se muestra como **fondo de marca** (`mark`) con opacidad del 45 % detrás del texto, nunca como color del texto. Los nombres de dominio coinciden con `HighlightColor` de `docs/IPC.md`.

| Pigmento | `HighlightColor` | Hex | Token CSS | Clase Tailwind |
|---|---|---|---|---|
| Ocre | `ochre` | `#B5914F` | `--pigment-ocre` | `bg-pigment-ocre` |
| Siena | `sienna` | `#A0644A` | `--pigment-sienna` | `bg-pigment-sienna` |
| Salvia | `sage` | `#8A9A7B` | `--pigment-sage` | `bg-pigment-sage` |
| Pizarra | `slate` | `#6E7A88` | `--pigment-slate` | `bg-pigment-slate` |

Texto de subrayado (`--paper-ink` sobre el pigmento al 45 % mezclado con el papel):

| Pigmento | Normal | Sepia | Noche |
|---|---|---|---|
| Ocre | 10.4 : 1 | 7.4 : 1 | 7.3 : 1 |
| Siena | 8.7 : 1 | 6.2 : 1 | 9.4 : 1 |
| Salvia | 10.3 : 1 | 7.4 : 1 | 7.4 : 1 |
| Pizarra | 9.0 : 1 | 6.4 : 1 | 9.0 : 1 |

Los pigmentos como **indicador** (puntos, la barra de color del panel de subrayados) van sobre superficies oscuras o con su propio trazo; sobre papel claro quedan por debajo de 3 : 1 y no transmiten nada por sí solos.

## 4. Tipografía

### 4.1 Familias (OFL, empaquetadas en la app)

| Familia | Uso | Paquete | Pesos |
|---|---|---|---|
| **Cormorant Garamond** (serif de exhibición) | Títulos de obra y de Sala. Nunca UI | `@fontsource/cormorant-garamond` (latín) | 400, 500 |
| **Inter** (grotesca neutra, cifras tabulares) | UI, cartelas, cuerpo del lector, números | `@fontsource-variable/inter` | 400–700 (variable) |

Las fuentes se importan en `src/index.css`. **No hay Google Fonts en tiempo de ejecución**: los archivos viajan dentro de la app (Vite los incluye en el build). Las cifras son tabulares en todo el documento (`font-variant-numeric: tabular-nums`).

### 4.2 Escala

| Token | Tamaño | Familia / peso | Uso |
|---|---|---|---|
| `text-label` | 11 px | Inter 500, versalitas, `tracking-label` | Rótulos de cartela y de metadatos |
| `text-ui` | 13 px | Inter 400–500 | Controles secundarios, pies |
| `text-base` | 14 px | Inter 400–500 | UI, botones, campos |
| `text-reading` | 17 px / 1.75 | Inter 400 | Cuerpo del lector (sección 4.4) |
| `text-cartela` | 24 px | Cormorant 400–500 | Título de obra en muro y de cartela corta |
| `text-sala` | 34 px | Cormorant 400–500 | Título de Sala en rejilla |
| `text-obra` | 56 px | Cormorant 500 | Título de obra en pantalla grande |
| `text-display` | 76 px / 1 | Cormorant 500 | "Seguir leyendo" |
| `text-hero` | 112 px / 0.95 | Cormorant 500 | Título de Sala en cabecera |

Rótulos: versalitas (`uppercase`) con `tracking-label` (0.14 em) y peso 500–600. El wordmark `ATRIL` usa `tracking-wordmark` (0.32 em), peso 700.

### 4.3 Reglas

- Títulos de obra y de Sala: siempre Cormorant.
- Títulos de pantalla grandes (Ajustes, biblioteca vacía): Cormorant, como en el lienzo. Etiquetas de sección y controles: Inter.
- El cuerpo del lector es Inter (dirección B).
- Interlineado del cuerpo 1.75; de títulos de exhibición, 1 a 1.05.

### 4.4 Cuerpo del lector

Inter 17 px, interlineado 1.75, 560–620 px de medida, con el margen interior de la página (72–76 px). El papel es `--paper`; el texto `--paper-ink`.

## 5. Espaciado y rejilla

- **Base de 4 px.** Todos los espaciados son múltiplos de 4 (4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 72, 80, 88).
- **Rejilla de 12 columnas**, gutter de **24 px**, margen lateral de **64 px** en la biblioteca y la carcasa.
- **Alturas fijas:** cabecera de biblioteca 80 px; barra del lector 56 px; cabecera de escaneo 80 px.
- **Panel lateral del lector** (subrayados): 320 px, opaco, con hilo de 1 px a la izquierda.
- **Cartelas:** la obra (portada) sobre la cartela; la cartela va a 16 px bajo la portada (14 px en las rejillas pequeñas).
- **Portadas:** proporción 2 : 3. Tamaños de referencia: 240 × 360 (Seguir leyendo), 180 × 270 (Favoritos y muros), 110 × 165 (miniaturas de Sala).

## 6. Radios, bordes y hilos

- **Radio: 0** en todo lo que sea superficie, botón, campo, cubierta o barra.
- **Círculo** (`--radius-dot`): solo los puntos de pigmento y los controles de color.
- **Hilos:** 1 px, color `--line`. Los rótulos de sección llevan un hilo superior `--line-strong` de 1 px.
- **Foco visible:** contorno de 1 px `--ink` con separación de 3 a 4 px. Todo es alcanzable con teclado.

## 7. Movimiento

| Token | Valor | Uso |
|---|---|---|
| `--ease-atril` | `cubic-bezier(0.22, 1, 0.36, 1)` | Todo el movimiento (ease-out) |
| `--duration-fast` | 200 ms | Cambios de estado de control |
| `--duration-base` | 250 ms | Paneles, fundidos de página |
| `--duration-slow` | 300 ms | Recuperación de color de la portada al pasar el ratón o enfocarla |

- Fundidos lentos y sutiles, sin rebotes ni desplazamientos grandes.
- **`prefers-reduced-motion: reduce`**: las tres duraciones pasan a 0 ms (ver `src/index.css`). Ningún estado depende solo de la animación.

## 8. Portadas

- Portadas en **escala de grises** (`filter: grayscale(1)`) en reposo.
- Al **pasar el ratón** o **enfocarla** con teclado, recuperan el color en 300 ms (`--duration-slow`).
- Las portadas de muestra son **abstractas** (bloques y formas); nunca imágenes con copyright.
- Sin sombra ni marco pesado.

## 9. Componentes base

Cada componente se describe por sus tokens; ninguno se construye todavía como pantalla (eso es la fase 1 y siguientes).

| Componente | Descripción | Tokens |
|---|---|---|
| **Cartela** | Título en `text-cartela` (serif), autor en `text-base` `ink-2`, progreso como hilo de 1 px `--line` con relleno `--ink` y cifras "64 % · p. 112 de 176" en `text-ui` | `ink`, `ink-2`, `line` |
| **Obra (portada)** | Portada 2 : 3, gris en reposo, color al foco. Foco visible en el borde | `filter`, `--duration-slow` |
| **Barra del lector** | Franja inferior de 56 px, `surface`, hilo superior `line`. Aparece con el ratón y se oculta a los 2 s sin movimiento. Contenido: volver, título, página "112 / 176", índice, buscar, subrayados, modo de página, zoom, indicador del subrayador | `surface`, `line`, `text-ui` |
| **Indicador del subrayador** | Punto de pigmento (último usado) + rótulo "Subrayador · H" en `text-ui` con hilo `line` | pigmento, `line` |
| **Paneles** (índice, subrayados) | Opacos, `surface`, 320 px, hilo `line` a la izquierda. Sin cristal | `surface`, `line` |
| **Barra de selección** | Flotante y pequeña junto a la selección, `surface-2`, hilo `line`, sin sombra. Cuatro botones de pigmento (círculo de 22 px con `aria-label`), separador, "Nota" y "Copiar" en `text-base` | `surface-2`, `line`, pigmentos |
| **Botón primario** | Fondo `ink`, texto `ink-inverse`, `text-base` 600, sin radio, padding 12 × 22 | `ink`, `ink-inverse` |
| **Botón secundario** | Hilo `line-strong` (1 px), texto `ink`, `text-base` 500 | `line-strong`, `ink` |
| **Botón de texto** | Texto `ink-2`, subrayado de 4 px en acciones de apoyo | `ink-2` |
| **Segmentado** | Hilo `line` alrededor; opción activa con fondo `ink` y texto `ink-inverse` | `line`, `ink`, `ink-inverse` |
| **Chip de filtro** | Hilo `line`, `text-ui` `ink-2`; activo con fondo `ink` | `line`, `ink` |
| **Campo de búsqueda** | Sin caja; hilo inferior `line`, `text-base`, `ink` | `line`, `ink` |
| **Rótulo de sección** | Rótulo `text-label`, versalitas, numeración `ink-3`, hilo superior `line-strong` | `line-strong`, `ink-3` |
| **Aviso** | Bloque `surface`, hilo `line`, padding 24 × 28. Texto de título en serif 30 px | `surface`, `line` |
| **Línea de progreso global** | Hilo de 1 px sin controles, p. ej. al leer sin controles | `ink` al 50 % |

## 10. Accesibilidad

- Todo control es un `button`, `a` o `input` real con etiqueta accesible; los iconos sin texto llevan `aria-label`.
- Foco visible en todos los elementos interactivos.
- Contraste mínimo AA en todos los pares de texto (ver §2.1 y §3).
- Estados de movimiento respetan `prefers-reduced-motion`.
- No se transmite información solo por color: los subrayados se distinguen también por su posición y su rótulo de color en el panel.

## 11. Tailwind 4

Los tokens se exponen en `src/index.css` con `@theme inline`, de forma que las utilidades (`bg-canvas`, `text-ink-2`, `font-serif`, `tracking-label`, `ease-atril`, `duration-slow`) leen las variables del tema activo en tiempo de ejecución. Cambiar de tema no recompila nada.
