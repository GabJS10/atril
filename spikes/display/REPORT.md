# Spike R0.2 · cómo mostrar páginas renderizadas en WebKitGTK

**Estado:** spike sin PR, rama `r0/display`, sin push. El código es desechable y no se fusiona: sirve para decidir el formato de las páginas del visor de la fase R.
**Equipo:** Linux Mint, WebKitGTK 2.52.6, 7,3 GB de RAM. Medición en Xvfb propio (`DISPLAY=:99`), que no usa GPU.

## Resumen y recomendación

- **Formato recomendado: JPEG calidad 85 (variante c), mostrado con `<img>`.** Es el que da más fluidez: en el scroll de lectura hay 2 fotogramas de más de 50 ms en 2.440 y ninguna página en blanco; el zoom nítido tarda unos 0,2 s; las 60 páginas de prueba ocupan 28 MB de caché y cada página llega en unos 66 ms.
- **BMP (a) y RGBA crudo (b): descartarlos para el visor.** Cada página pesa entre 6 y 9 MB: transporte de 270 a 330 ms por página, zoom nítido de 0,75 a 3 s y 450 a 600 MB de caché.
- **PNG (d): alternativa sin pérdida**, con casi el doble de p95 que JPEG en el scroll rápido (53 frente a 27 ms) y un zoom nítido unas dos veces más lento. Codificarlo en Rust cuesta 11 ms por página, frente a 72 ms de JPEG.
- **Pendiente en R1:** codificar JPEG con el crate `image` (`jpeg-encoder`) cuesta 72 ms por página de 1240 px y 300 ms a 2480 px. Eso consume el presupuesto de «página de texto en menos de 100 ms» junto con el render. Antes de fijar el diseño hay que medir un codificador más rápido (libjpeg-turbo, p. ej. el crate `turbojpeg`). Esta prueba no lo hizo.
- **Pendiente en R2:** con saltos grandes (20 páginas de golpe) quedan de 5 a 7 páginas en blanco de unas 47 entradas. Hace falta más margen de precarga, o precargar según la dirección del scroll.

## Tabla resumen

Ronda 2 (completa, las cuatro variantes). Scroll rápido: 4.000 px/s durante 20 s con saltos de 20 páginas. Zoom: 100 % a 200 %.

| Variante | Formato y forma de pintar | Transporte p50 por página (ms) | Lectura: p95 / fotogramas >50 ms | Rápido: p95 / >50 ms / entradas en blanco | Zoom nítido texto / escaneo (ms) | Caché precodificada (MB) | RSS app pico (MB) | Codificar en Rust, 1240 px, p50 (ms) |
|---|---|---|---|---|---|---|---|---|
| a | BMP en `<img>` | 328 | 26 / 5 | 116 / 61 / 14 de 47 | 753 / 874 | 450 | 815 | 14,6 |
| b | RGBA crudo en canvas | 273 | 33 / 12 | 105 / 54 / 11 de 47 | 1.458 / 2.971 | 601 | 984 | 14,1 |
| c | JPEG q85 en `<img>` | 66 | 26 / 2 | 27 / 14 / 5 de 48 | 174 / 180 | 28 | 293 | 72,1 |
| d | PNG en `<img>` | 118 | 25 / 0 | 53 / 41 / 7 de 48 | 313 / 435 | 49 | 322 | 10,6 |

**Repetición (ronda 3, solo c y d):** c da un p95 de 35 ms en el scroll rápido, 15 fotogramas de más de 50 ms, 7 entradas en blanco de 47 y zoom de 159 y 255 ms. d da 67 ms, 55 fotogramas de más de 50 ms, 8 entradas en blanco de 47 y zoom de 395 y 498 ms. La ordenación se mantiene en las dos rondas.

**Objetivos de la fase R** (de `docs/ROADMAP.md`): en JPEG se cumplen el transporte y el zoom nítido (menos de 300 ms) y el scroll de lectura. No se cumple «sin páginas en blanco ni tirones de más de 50 ms» en el scroll rápido con saltos. Este spike no mide el render ni la codificación del motor real, así que las cifras de latencia son para transporte y decodificación, no para el lector final.


## Entorno y condiciones

- Equipo: Linux Mint, WebKitGTK 2.52.6, 8 núcleos, 7,3 GB de RAM.
- Medición en **Xvfb** (`DISPLAY=:99`, propio, sin GPU): WebKit compone por software. Las cifras de fotograma y de dibujo **no** son las de la AMD Vega 11 del usuario.
- El escritorio del usuario seguía abierto durante toda la medición: la RAM libre era de unos 1,5 GB al empezar y hubo swap. Los tiempos incluyen esa contención; el muestreo registra el swap usado (`swap_used_mb` en `rss-*.csv`).
- Build: release de Tauri con `CARGO_PROFILE_RELEASE_LTO=false` y `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16`. El perfil del proyecto (`lto = true`, `codegen-units = 1`) no cabía en la RAM libre.
- Páginas de prueba (renderizadas con `pdftoppm -scale-to-x 1240|2480`, fuera del repo, nunca copiadas):
  - texto: *Compendio de Apologética Católica*, páginas 60 a 89;
  - escaneo: *La fe explicada* (Internet Archive), páginas 100 a 129, con JPEG 2000 y JBIG2 en la imagen.
  - tamaños: texto 1240×1613; escaneo 1240×2111 a 1240×2115; zoom 2480×3225 (texto) y 2480×4222 (escaneo).

## Método

**Backend (`src-tauri/src/spike_display.rs`, desechable)**

- Precodifica en memoria al arrancar, en un hilo aparte. Solo codifica los formatos de `ATRIL_SPIKE_FORMATS`: en cada medición, uno solo (no caben los cuatro a la vez en la RAM libre).
- Sirve `atril://localhost/spike/<t>.<fmt>?w=<ancho>&v=<etiqueta>`. `t` 0 a 29 es texto y 30 a 59 es escaneo. A 1240 px están las 60 páginas; a 2480 px, solo las dos del zoom (`t` 0 y 30).
- Formatos (crate `image` 0.25.10):
  - `bmp`: 24 bits, sin comprimir;
  - `rgba`: pixeles RGBA crudos precedidos de 8 bytes (ancho y alto como `u32` little endian);
  - `jpg`: calidad 85;
  - `png`: compresión por defecto de `image` (`CompressionType::Default`, que el crate `png` aplica como `Balanced`) y filtro por defecto.
- Todas las respuestas llevan `Cache-Control: no-store`.
- Coste de codificar en Rust: banco aparte (`ATRIL_SPIKE_BENCH=1`). Codifica las 60 páginas a 1240 px y las 2 del zoom a 2480 px en los cuatro formatos, midiendo solo la codificación. El PNG de origen se decodifica fuera de la medida.
- Coste de servir: cada respuesta copia el cuerpo a un `Vec<u8>`, que exige Tauri. Esa copia se mide en el backend (`serve` en el JSON).

**Front (`src/spike/display/`, desechable)**

- Visor de 300 páginas (las 60 de prueba repetidas). Cada hueco mide lo que mide su página. Solo existen en el DOM las páginas de la ventana visible ±2. Se manipula el DOM a mano, sin React, para no medir la propia UI.
- Cuatro variantes:
  - **a)** `<img>` con BMP, tras `img.decode()`;
  - **b)** `fetch` de RGBA, luego `ImageData`, `createImageBitmap` y `drawImage` en un canvas;
  - **c)** `<img>` con JPEG, tras `img.decode()`;
  - **d)** `<img>` con PNG, tras `img.decode()`.
  Ninguna se muestra antes de estar decodificada.
- Escenarios automáticos, una variante cada vez:
  - **Lectura:** 200 px/s durante 45 s.
  - **Rápido:** 4000 px/s durante 20 s, con saltos de 20 páginas cada 4 s (5 en total) que obligan a cargas en frío.
  - **Zoom 100 % → 200 %:** primero `transform: scale(2)` sobre la imagen de 1240 px (al instante). Después se pide la de 2480 px, se decodifica, se cambia el elemento de una vez y se quita el transform. Cada fotograma se comprueba por si la página se queda sin elemento.
- Métricas:
  - fotogramas con rAF (p50, p95, máximo y número por encima de 50 ms);
  - páginas en blanco visibles: fotogramas con alguna página visible sin imagen, y entradas en blanco;
  - latencia desde que una página entra en pantalla hasta que tiene imagen;
  - carga desde que entra en la ventana ±2, con su transporte (hasta tener bytes) y su decodificación;
  - RSS de la app y de sus procesos WebKit, muestreado cada segundo desde `/proc`, con el pico `VmHWM` al final.

## Resultados completos · ronda 2 (las cuatro variantes)

### Coste de codificar en Rust (banco, sin WebKit)
| Formato | Ancho | Páginas | p50 ms | p95 ms | máx ms | media ms | tamaño medio KiB |
|---|---|---|---|---|---|---|---|
| bmp | 1240 | 60 | 14.6 | 20.9 | 25.8 | 14.9 | 6786 |
| rgba | 1240 | 60 | 14.1 | 17.0 | 22.5 | 13.6 | 9048 |
| jpg | 1240 | 60 | 72.1 | 82.9 | 105.5 | 68.1 | 449 |
| png | 1240 | 60 | 10.6 | 18.9 | 19.3 | 11.7 | 763 |
| bmp | 2480 | 2 | 88.9 | 88.9 | 88.9 | 75.8 | 27054 |
| rgba | 2480 | 2 | 93.6 | 93.6 | 93.6 | 82.5 | 36071 |
| jpg | 2480 | 2 | 299.2 | 299.2 | 299.2 | 274.4 | 1003 |
| png | 2480 | 2 | 45.7 | 45.7 | 45.7 | 39.4 | 1943 |
Decodificar el PNG de origen a 1240 px: p50 9.5 ms, máx 27.2 ms.

### Scroll de lectura (200 px/s, 45 s)
| Variante | Fotogramas | p50 ms | p95 ms | máx ms | >50 ms | Fotogramas con blanco | Entradas en blanco | Latencia en blanco p50 / p95 / máx ms | Carga p50 / p95 / máx ms | Transporte p50 ms | Decodificación p50 ms | Saltos | Peticiones Rust |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a | 2233 | 19.0 | 26.0 | 119.0 | 5 | 0 | 0 / 5 | 0.0 / 0.0 / 0.0 | 250.0 / 309.0 / 309.0 | 198.0 | 50.0 | 0 | 5 |
| b | 2099 | 19.0 | 33.0 | 196.0 | 12 | 0 | 0 / 5 | 0.0 / 0.0 / 0.0 | 333.0 / 1078.0 / 1078.0 | 307.0 | 11.0 | 0 | 5 |
| c | 2440 | 17.0 | 26.0 | 131.0 | 2 | 0 | 0 / 5 | 0.0 / 0.0 / 0.0 | 55.0 / 150.0 / 150.0 | 31.0 | 26.0 | 0 | 5 |
| d | 2439 | 18.0 | 25.0 | 43.0 | 0 | 0 | 0 / 5 | 0.0 / 0.0 / 0.0 | 123.0 / 283.0 / 283.0 | 72.0 | 52.0 | 0 | 5 |

### Scroll rápido (4000 px/s, 20 s, saltos de 20 páginas cada 4 s)
| Variante | Fotogramas | p50 ms | p95 ms | máx ms | >50 ms | Fotogramas con blanco | Entradas en blanco | Latencia en blanco p50 / p95 / máx ms | Carga p50 / p95 / máx ms | Transporte p50 ms | Decodificación p50 ms | Saltos | Peticiones Rust |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a | 525 | 24.0 | 116.0 | 918.0 | 61 | 31 | 14 / 47 | 171.0 / 647.0 / 647.0 | 399.0 / 1152.0 / 1280.0 | 328.0 | 81.0 | 5 | 63 |
| b | 604 | 18.0 | 105.0 | 709.0 | 54 | 14 | 11 / 47 | 452.0 / 754.0 / 754.0 | 297.0 / 833.0 / 1060.0 | 273.0 | 10.0 | 5 | 67 |
| c | 1009 | 18.0 | 27.0 | 238.0 | 14 | 19 | 5 / 48 | 156.0 / 173.0 / 173.0 | 105.0 / 201.0 / 240.0 | 66.0 | 33.0 | 5 | 63 |
| d | 756 | 22.0 | 53.0 | 441.0 | 41 | 27 | 7 / 48 | 257.0 / 387.0 / 387.0 | 199.0 / 486.0 / 965.0 | 118.0 | 85.0 | 5 | 63 |

### Zoom 100 % → 200 % (página de texto y de escaneo)
| Variante | Página | Transform ms | Nítida ms | Transporte ms | Decodificación ms | Dibujo ms | Fotogramas sin elemento | Ancho nítido px |
|---|---|---|---|---|---|---|---|---|
| a | texto | 135.0 | 753.0 | 442.0 | 160.0 | 0.0 | 0 / 16 | 2480 |
| a | escaneo | 22.0 | 874.0 | 627.0 | 223.0 | 0.0 | 0 / 21 | 2480 |
| b | texto | 53.0 | 1458.0 | 539.0 | 601.0 | 139.0 | 0 / 19 | 2480 |
| b | escaneo | 20.0 | 2971.0 | 2407.0 | 186.0 | 352.0 | 0 / 38 | 2480 |
| c | texto | 29.0 | 174.0 | 43.0 | 91.0 | 0.0 | 0 / 9 | 2480 |
| c | escaneo | 17.0 | 180.0 | 43.0 | 105.0 | 0.0 | 0 / 11 | 2480 |
| d | texto | 60.0 | 313.0 | 59.0 | 179.0 | 0.0 | 0 / 13 | 2480 |
| d | escaneo | 44.0 | 435.0 | 141.0 | 244.0 | 0.0 | 0 / 24 | 2480 |

### Memoria (MB; pico = VmHWM; entre paréntesis, máximo muestreado cada segundo)
| Variante | Caché precodificada | RSS app (pico) | WebKit web (pico) | WebKit red (pico) | WebKit GPU (pico) | Sistema usado (máx.) | Swap usado (máx.) | RSS app sin caché (pico − caché) |
|---|---|---|---|---|---|---|---|---|
| a | 450 | 815 (810) | 504 (466) | 47 | 0 | 6708 | 3791 | 365 |
| b | 601 | 984 (911) | 331 (266) | 47 | 0 | 6959 | 4997 | 384 |
| c | 28 | 293 (294) | 340 (341) | 46 | 0 | 6687 | 4190 | 265 |
| d | 49 | 322 (269) | 402 (394) | 46 | 0 | 6705 | 3895 | 274 |

Precodificación de bmp (60 páginas a 1240 px y 2 a 2480 px): 3394 ms, caché 450 MB.

## Repetición · ronda 3 (c y d)

### Coste de codificar en Rust (banco, sin WebKit)
| Formato | Ancho | Páginas | p50 ms | p95 ms | máx ms | media ms | tamaño medio KiB |
|---|---|---|---|---|---|---|---|
| bmp | 1240 | 60 | 15.9 | 20.5 | 23.8 | 15.6 | 6786 |
| rgba | 1240 | 60 | 18.8 | 23.2 | 29.5 | 18.1 | 9048 |
| jpg | 1240 | 60 | 72.8 | 91.0 | 94.8 | 73.6 | 449 |
| png | 1240 | 60 | 9.4 | 23.1 | 25.2 | 11.8 | 763 |
| bmp | 2480 | 2 | 73.4 | 73.4 | 73.4 | 64.8 | 27054 |
| rgba | 2480 | 2 | 94.5 | 94.5 | 94.5 | 81.8 | 36071 |
| jpg | 2480 | 2 | 361.2 | 361.2 | 361.2 | 323.0 | 1003 |
| png | 2480 | 2 | 56.4 | 56.4 | 56.4 | 47.7 | 1943 |
Decodificar el PNG de origen a 1240 px: p50 8.8 ms, máx 19.6 ms.

### Scroll de lectura (200 px/s, 45 s)
| Variante | Fotogramas | p50 ms | p95 ms | máx ms | >50 ms | Fotogramas con blanco | Entradas en blanco | Latencia en blanco p50 / p95 / máx ms | Carga p50 / p95 / máx ms | Transporte p50 ms | Decodificación p50 ms | Saltos | Peticiones Rust |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| c | 2595 | 17.0 | 22.0 | 52.0 | 1 | 0 | 0 / 5 | 0.0 / 0.0 / 0.0 | 51.0 / 96.0 / 96.0 | 20.0 | 28.0 | 0 | 5 |
| d | 1862 | 23.0 | 36.0 | 146.0 | 22 | 0 | 0 / 5 | 0.0 / 0.0 / 0.0 | 182.0 / 710.0 / 710.0 | 85.0 | 59.0 | 0 | 5 |

### Scroll rápido (4000 px/s, 20 s, saltos de 20 páginas cada 4 s)
| Variante | Fotogramas | p50 ms | p95 ms | máx ms | >50 ms | Fotogramas con blanco | Entradas en blanco | Latencia en blanco p50 / p95 / máx ms | Carga p50 / p95 / máx ms | Transporte p50 ms | Decodificación p50 ms | Saltos | Peticiones Rust |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| c | 925 | 19.0 | 35.0 | 138.0 | 15 | 47 | 7 / 47 | 154.0 / 503.0 / 503.0 | 120.0 / 652.0 / 1581.0 | 69.0 | 37.0 | 5 | 66 |
| d | 602 | 27.0 | 67.0 | 269.0 | 55 | 40 | 8 / 47 | 247.0 / 412.0 / 412.0 | 271.0 / 455.0 / 543.0 | 140.0 | 101.0 | 5 | 62 |

### Zoom 100 % → 200 % (página de texto y de escaneo)
| Variante | Página | Transform ms | Nítida ms | Transporte ms | Decodificación ms | Dibujo ms | Fotogramas sin elemento | Ancho nítido px |
|---|---|---|---|---|---|---|---|---|
| c | texto | 30.0 | 159.0 | 15.0 | 110.0 | 0.0 | 0 / 8 | 2480 |
| c | escaneo | 46.0 | 255.0 | 86.0 | 116.0 | 0.0 | 0 / 13 | 2480 |
| d | texto | 96.0 | 395.0 | 74.0 | 211.0 | 0.0 | 0 / 14 | 2480 |
| d | escaneo | 36.0 | 498.0 | 195.0 | 265.0 | 0.0 | 0 / 27 | 2480 |

### Memoria (MB; pico = VmHWM; entre paréntesis, máximo muestreado cada segundo)
| Variante | Caché precodificada | RSS app (pico) | WebKit web (pico) | WebKit red (pico) | WebKit GPU (pico) | Sistema usado (máx.) | Swap usado (máx.) | RSS app sin caché (pico − caché) |
|---|---|---|---|---|---|---|---|---|
| c | 28 | 296 (282) | 414 (380) | 47 | 0 | 6649 | 3958 | 267 |
| d | 49 | 325 (267) | 312 (308) | 47 | 0 | 6234 | 4260 | 276 |

Precodificación de jpg (60 páginas a 1240 px y 2 a 2480 px): 6152 ms, caché 28 MB.

## Repetibilidad y ruido

- **Ronda 1** (solo la variante a, antes de corregir el muestreo de RSS; su JSON es válido): el p95 del scroll rápido fue de 71 ms y el zoom de 679 y 991 ms. La ronda 2 da para la misma variante 116 ms y 753 y 874 ms. El escritorio del usuario seguía abierto con swap (3,5 a 5 GB), así que los tiempos varían hasta un 60 %.
- Por eso las conclusiones se apoyan en diferencias grandes y repetidas: JPEG tiene un p95 de scroll rápido unas cuatro veces menor que BMP y RGBA, y su zoom nítido es entre 4 y 16 veces más rápido. JPEG frente a PNG se repite en las dos rondas.

## Limitaciones

- **Xvfb no usa GPU** (la app avisa de `libEGL ... DRI3`): WebKit compone por software. Los fotogramas y el coste de dibujo no son los de la AMD Vega 11 del usuario; las cifras absolutas no se trasladan tal cual.
- **Build sin LTO y con `codegen-units = 16`** por la RAM libre. WebKit es C++ y no cambia; la codificación en Rust podría bajar algo con LTO.
- **Equipo compartido**: durante las pruebas, la memoria usada llegó a 6,7 a 7,0 GB y el swap a 3,5 a 5 GB (`swap_used_mb` en los CSV). Los picos de fotograma son sensibles a eso.
- **Sin render**: las páginas están precodificadas en memoria. El coste de renderizar y codificar en el motor real no entra en las latencias.
- **Calidad visual sin evaluar**: JPEG q85 es con pérdida. No se han comparado capturas de texto a 2480 px. Solo se verificó que la pantalla manual se pinta (captura de un Xvfb propio).
- **Parpadeo**: se mide con los fotogramas sin elemento durante el zoom (0 en todas las variantes), no con capturas de pantalla. Por diseño, la imagen anterior sigue visible hasta que la nueva está decodificada.
- **Precarga**: el margen es de ±2 páginas. Los saltos de 20 páginas muestran que es corto.
- **Sin ejecutar**: `cargo clippy` y `cargo test`, incluidos los tests de `protocol.rs` y los de `spike_display.rs`. Con 7 GB de RAM, compilar en debug todas las dependencias no cabía en la prueba. `cargo fmt --check` sí pasa.
- **Etiqueta del banco**: el campo `pngSettings` de los `bench-encode.json` de las rondas 2 y 3 dice «zlib default», texto impreciso que se corrigió después en el código (sin cambiar la medición). El ajuste real es el de la sección de método.
- **Páginas de prueba**: 30 consecutivas de cada libro (texto: *Compendio de Apologética Católica*; escaneo: *La fe explicada*). No hay portadas ni páginas con imágenes muy grandes.

## Cómo probarlo a mano (escritorio real)

```bash
/home/gabriel/datos/projects/atril-wt/r0-display/spikes/display/run-manual.sh
```

Abre la pantalla del spike con el binario `/home/gabriel/datos/projects/atril-wt/.spike-display/bin/atril-spike`, en el escritorio del usuario. **No lo he abierto en su pantalla**: solo lo he probado en un Xvfb propio.

- Botones **a / b / c / d** para cambiar de variante. La rueda del ratón mueve el visor.
- **Suite completa**: corre la suite de la variante (lectura, rápido y zoom), tarda unos 90 s y guarda el JSON en `/home/gabriel/datos/projects/atril-wt/.spike-display/pages/results/<variante>.json`.
- **Solo zoom**: repite el zoom en la página de texto y en la de escaneo.
- Usa 10 páginas por tipo para no gastar RAM. Con los cuatro formatos son unos 460 MB de caché; conviene cerrar antes lo que no se use.

Para recompilar el binario del spike (mismos overrides de perfil que la medición):

```bash
cd /home/gabriel/datos/projects/atril-wt/r0-display
CARGO_TARGET_DIR=/home/gabriel/datos/projects/atril-wt/.target CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 npm run tauri -- build --no-bundle
cp /home/gabriel/datos/projects/atril-wt/.target/release/atril /home/gabriel/datos/projects/atril-wt/.spike-display/bin/atril-spike
```

Para repetir la medición en Xvfb: `spikes/display/bench.sh <binario> <carpeta-páginas> <carpeta-resultados> [variantes]`, y después `node spikes/display/summarize.mjs <carpeta-resultados>`.

## Archivos y verificación

**Código (desechable, sin PR):**

- `src-tauri/src/spike_display.rs`: precodificación, protocolo `atril://localhost/spike/…` y comandos `spike_status` y `spike_save_results`. Cambios en `protocol.rs`, `lib.rs`, `Cargo.toml` y `Cargo.lock` (crate `image`).
- `src/spike/display/` (visor, variantes, suite y pantalla), `src/routes/spike-display.tsx`, `src/main.tsx` (arranque) y `src/routeTree.gen.ts`.
- `spikes/display/`: `render-pages.sh` (renderizado con `pdftoppm`), `bench.sh`, `run-manual.sh`, `summarize.mjs` y este informe.
- `spikes/display/results/`: JSON, CSV de RSS y resúmenes de las rondas 2 y 3. No hay imágenes ni PDF.

**Fuera del repo** (`/home/gabriel/datos/projects/atril-wt/.spike-display/`): las 120 páginas renderizadas (103 MB), el binario `bin/atril-spike` y los logs.

| Comprobación | Resultado |
|---|---|
| `npm run lint` | pasa |
| `npm run typecheck` | pasa |
| `npm test` | 28 ficheros, 235 pruebas, pasan |
| `npm run build` | pasa |
| `cargo fmt --check` | pasa |
| `tauri build --no-bundle` (release) | compila y enlaza |
| `cargo clippy`, `cargo test` | no ejecutados (ver limitaciones) |

**Estado al cerrar:** la app, Xvfb y los procesos WebKit de la medición están parados, y los datos temporales se han borrado. El puerto 1420 lo ocupa un `vite` de otro proyecto (`/home/gabriel/datos/projects/yts-movie-player`, PID 130119, arrancado a las 21:23). No es de esta tarea y no lo he tocado; ninguno de mis procesos usa ese puerto.
