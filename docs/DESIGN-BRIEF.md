# Brief de diseño: Atril, "museo de arte de noche"

**Para:** `frontend`. **Dueño:** `plan`. Las decisiones de este brief las tomó el usuario; las propuestas exploran **dentro** de ellas, no fuera.

## Qué es Atril
Un lector de PDF de escritorio para leer libros: minimalista, ligero y silencioso. Lo usa una sola persona con su propia biblioteca (decenas o cientos de PDF). Se abre para leer: la interfaz tiene que desaparecer cuando se lee y ser un placer tranquilo cuando se elige qué leer.

## Concepto
**Un museo de arte de noche.** La biblioteca es una galería, cada libro es una **obra**, las colecciones son **Salas** y los datos de cada libro van en una **cartela** (como la etiqueta junto a un cuadro). Leer es estar delante de una obra iluminada en una sala a oscuras.

Referencias de tono: la sobriedad de la señalética de museos (Prado, Met, MoMA, Tate) y de los catálogos de arte. Nada de "app genérica": ni tarjetas con sombra, ni degradados, ni glassmorphism, ni iconos de colores, ni esquinas muy redondeadas.

## Decisiones fijadas
| Tema | Decisión |
|---|---|
| Paleta | **Monocromo puro, sin color de acento.** Negro carbón (fondo de ~`#0D0D0D`, superficies `#161616`/`#1F1F1F`, líneas ~`#2A2A2A`) y blanco hueso (~`#EDEAE4`), con grises ligeramente cálidos (luz de galería) para texto secundario y terciario. La jerarquía sale de la **escala, el peso, el espacio y los rótulos en versalitas espaciadas**, no del color. Valores orientativos: la propuesta los fija, con contraste **AA** como mínimo |
| Tema claro | **"Cubo blanco"**, opcional (Ajustes): paredes ~`#F5F4F0`, texto ~`#121212`, misma sobriedad. **El oscuro es el predeterminado** |
| Tipografía | **Serif de exhibición** (tipo Cormorant Garamond) para títulos de obras y de Salas; **grotesca neutra** (tipo Inter, con cifras tabulares) para la UI, las cartelas y los números. Licencias libres (OFL) y **empaquetadas en la app** |
| Biblioteca | **Muro de galería** (ver abajo) |
| Portadas | **En escala de grises**; recuperan el color al pasar el ratón o al enfocarlas con el teclado (transición de ~300 ms). Sin sombras ni marcos pesados |
| Lector | **Sala a oscuras** (ver abajo) |
| Subrayados | **Pigmentos apagados**: ocre, siena, salvia y pizarra. Poco saturados, distinguibles entre sí, legibles sobre página blanca, sepia y en modo noche. Es **el único color con función** en toda la app |
| Movimiento | **Fundidos lentos y sutiles** (200–300 ms, ease-out). Al abrir un libro, la portada se funde con la primera página. Respeta `prefers-reduced-motion` |
| Iconos | Lineales y finos (trazo de 1.25–1.5 px), pocos y siempre con etiqueta accesible |
| Accesibilidad | Foco visible (contorno de 1 px con separación), todo usable con el teclado, contraste AA |
| Ventana | Mínima de 900×600; diseñar para **1280×800** |

### Biblioteca: "Muro de galería"
- Cabecera mínima: `ATRIL` (rótulo en versalitas espaciadas) · buscar · ajustes.
- **Seguir leyendo:** una sola obra grande (el último libro abierto) con su cartela al lado: título (serif), autor, progreso como una línea de 1 px y "p. 112 de 176". Si hay más libros empezados, una fila discreta de los siguientes.
- Después: **Favoritos**, **Salas** (cada Sala como un rótulo + muestra de sus obras) y **Todos** (rejilla con orden y filtro). Mucho aire entre las obras: es un muro de galería, no una estantería llena.
- Cada obra lleva debajo su cartela corta: título y autor (y progreso si está empezada).

```
ATRIL                                 ⌕   ⚙
────────────────────────────────────────────
  SEGUIR LEYENDO
  ┌──────────┐
  │          │   Meditaciones
  │          │   Marco Aurelio
  │          │   ──────────────  64 %
  └──────────┘   p. 112 de 176

  FAVORITOS                      ver todo →
  ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
  │      │   │      │   │      │   │      │
  └──────┘   └──────┘   └──────┘   └──────┘
  El Aleph    Ficciones   Rayuela     Pedro P.
  Borges      Borges      Cortázar    Rulfo
```

### Lector: "Sala a oscuras"
- La página centrada sobre negro, sin ningún control a la vista. Scroll continuo vertical.
- Al mover el ratón aparece una **barra inferior fina** (se oculta a los 2 s sin movimiento): ← Biblioteca · título · `112 / 176` · índice · buscar · subrayados · modo de página (normal / sepia / noche) · zoom.
- Paneles laterales (índice y subrayados): estrechos, opacos, con fundido. Sin glassmorphism.
- **Barra de selección** (al seleccionar texto): flotante y pequeña, junto a la selección: los 4 pigmentos + nota + copiar. Elegir un pigmento subraya y guarda al momento (no hay botón "guardar" en ningún sitio de la app).
- **Modo subrayador** (tecla H): cualquier selección se subraya directamente con el último pigmento. Necesita un indicador discreto de que está activo.
- Modo noche: la página se invierte (texto claro sobre fondo oscuro); sepia: tono papel cálido. Los subrayados deben seguir leyéndose en los tres modos.

```
▓▓▓▓▓▓▓▓▓▓▓┌────────────────────┐▓▓▓▓▓▓▓▓▓▓▓▓▓
▓▓▓▓▓▓▓▓▓▓▓│ Libro II            │▓▓▓▓▓▓▓▓▓▓▓▓▓
▓▓▓▓▓▓▓▓▓▓▓│ Al despuntar la     │▓▓▓▓▓▓▓▓▓▓▓▓▓
▓▓▓▓▓▓▓▓▓▓▓│ aurora, hazte estas │▓▓▓▓▓▓▓▓▓▓▓▓▓
▓▓▓▓▓▓▓▓▓▓▓│ consideraciones…    │▓▓▓▓▓▓▓▓▓▓▓▓▓
▓▓▓▓▓▓▓▓▓▓▓└────────────────────┘▓▓▓▓▓▓▓▓▓▓▓▓▓
  (con el ratón en movimiento, abajo:)
  ← Biblioteca   Meditaciones   112 / 176  ☰ ⌕ ✦
```

## Cómo entregar las propuestas (Claude Design)
Usa el tipo de artefacto **"Design"** de claude.ai: herramienta `Artifact`, primero `action: "quickstart"` con `intent: "design"` y **`design_systems: false`** (este brief es el sistema de diseño; no apliques ningún design system existente de la cuenta). El artefacto es privado; pásale el enlace a `plan` por Herdr para que se lo enseñe al usuario.

**Ronda 1: direcciones.** Un lienzo titulado "Atril: propuestas" con **2–3 direcciones** dentro de este brief (por ejemplo, una más clásica, de serif protagonista y composición centrada, tipo Prado/Met, y otra más contemporánea, con rejilla estricta y más peso de la grotesca, tipo MoMA/Tate). Por cada dirección:
1. Biblioteca (oscuro), con datos realistas.
2. Lector con los controles visibles.
3. Una muestra de tokens: paleta (oscuro y cubo blanco), escala tipográfica y los 4 pigmentos sobre página blanca, sepia y noche.

**Ronda 2 (cuando el usuario elija):** en la dirección elegida, el resto de pantallas:
1. Lector con los controles ocultos.
2. Lector con la barra de selección y el panel de subrayados abierto.
3. Una Sala.
4. Ajustes (carpetas de la biblioteca, idioma, tema, lector predeterminado).
5. Estados: biblioteca vacía (primera vez: invitar a añadir una carpeta), escaneando y archivo no encontrado.
6. La Biblioteca en cubo blanco.

**Después:** escribe `DESIGN.md` (tokens: colores de ambos temas, tipografía y escala, espaciado, radios, movimiento, pigmentos, componentes base) y `PRODUCT.md`, y pasa los tokens al tema de Tailwind. Ninguna pantalla se construye antes del visto bueno del usuario.

### Datos de muestra
Libros reales en español, para que la composición sea creíble: *Meditaciones* (Marco Aurelio), *Ficciones* y *El Aleph* (Borges), *Rayuela* (Cortázar), *Pedro Páramo* (Rulfo), *La peste* (Camus), *Cien años de soledad* (García Márquez), *Ensayo sobre la ceguera* (Saramago), *El nombre de la rosa* (Eco), *Crimen y castigo* (Dostoievski). Salas de ejemplo: Filosofía, Novela, Ensayo, Pendientes. **Las portadas de muestra tienen que ser abstractas** (composiciones tipográficas o bloques generados), nunca imágenes reales con copyright.

## Decisión de la ronda 1 (2026-10-11)
El usuario eligió la **dirección B · Contemporánea** (MoMA/Tate): rejilla de 12 columnas, la grotesca con más peso y la serif solo en los títulos de las obras y de las Salas. Lienzo: https://claude.ai/artifact/Uzb6H6qUTeG8qHC8EyTW9U. La ronda 2 se hace sobre esta dirección. **Ronda 2 aprobada por el usuario (2026-10-11):** el lienzo es la referencia visual de `DESIGN.md`.
