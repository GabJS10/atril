# R0.1 · MuPDF frente a PDFium (informe del spike)

Medido en la máquina del usuario, build release, con los 23 libros de ~/datos/libros (solo lectura).
Medianas entre libros; mediciones intercaladas por libro (carga 3,5 frente a 3,4).

| Métrica | MuPDF (build por defecto) | PDFium |
|---|---|---|
| Abrir documento | 3,4 ms (b23: 602 ms) | 2,2 ms (b23: 80 ms) |
| Página 1 a 1240 px, 1ª / repetida | 64 / 22 ms | 34 / 29 ms |
| Página 1 a 2480 px, 1ª / repetida | 33 / 22 ms | 68 / 69 ms |
| Escaneo JPX a 1240 px, 1ª / repetida (b08, b12, b17) | 652–734 / 109–115 ms | 463–688 / 458–759 ms |
| Texto con cajas, por página | 1,4 ms | 2,7 ms |
| Búsqueda «dios» en La fe explicada | 2091 aciertos, 842 ms | 2091 aciertos, 1586 ms |
| Errores en 14 423 páginas | 0 | 0 |
| RSS mediana por libro | 125 MB | 130 MB |
| RSS en b17 / b19 / b23 | 366 / 489 / 178 MB | 162 / 743 / 371 MB |
| Aceleración con 4 hilos (texto b07 / escaneos b12, b17) | 0,84 / 1,39 / 1,46 | 0,62 / 0,91 / 0,94 |
| RSS con 4 hilos (escaneos) | 1,1 GB | 370–474 MB |
| Tamaño añadido (stripped) | 8,5 MB (base14: 5,7 MB) | 2,6 MB + libpdfium 6,8 MB |
| JPEG q85 / BMP a 1240 px | 63 ms, 285 KB / 10 ms, 6,2 MB | 62 ms, 259 KB / 10 ms, 6,2 MB |

## Hallazgos
- Escaneos JPEG 2000 en frío: 463–734 ms en ambos (openjpeg en los dos). MuPDF cachea imágenes y repite en ~110 ms; PDFium vuelve a decodificar.
- pdfium-render serializa todo con un mutex global: sin paralelismo.
- PDFium (vía pdfium-render) escala mal con libros enormes: b23 (3997 págs.) tamaños 113 s frente a 1,5 s; texto 118 s frente a 15 s.
- MuPDF con `system-fonts` es lentísimo en texto con fuentes no incrustadas (b03: 22,5 s). Con `base14` sin `system-fonts`: mismo texto, 2,6 s. La build mínima sin `base14` extrae mal el texto.
- 2091 frente a 2093 de pdf.js en «dios» sin explicar; en b22 MuPDF halla texto en 315 páginas y PDFium en 282.

## Recomendación
MuPDF con `base14`, sin `system-fonts`; limitar el pool a 2 hilos. Licencia AGPL.

## Pendiente para R1
Glifos de fuentes no incrustadas y CJK sin `system-fonts`; rendimiento completo de la build `base14`; estrategia de caché e hilos; libjpeg-turbo para codificar.

Reproducir: `scripts/fetch_deps.sh`, `scripts/build.sh <variantes>`, `scripts/run_all.sh {mupdf,pdfium} 3`, `scripts/aggregate.py` (datos en `out/summary.json`, ignorado por git).
