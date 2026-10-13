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
