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
