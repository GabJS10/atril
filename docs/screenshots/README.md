# Capturas de Atril

Capturas de la v1.0.0 para el `README.md` de la raíz. Todas salen de una biblioteca de muestra con **14 libros de dominio público**; ningún PDF está en el repositorio, solo las imágenes.

| Archivo | Pantalla | Libros que se ven |
|---|---|---|
| `library.png` | Inicio: «Seguir leyendo» teñido con la portada, y obras en curso | Pride and Prejudice (principal), Alice, Marianela, Meditations, Confessions, Imitación de Cristo, Moby-Dick |
| `library-shelves.png` | Inicio, más abajo: Favoritos y Salas | Alice, Don Quixote, Meditations, Pride and Prejudice, Treasure Island; las Salas «Clásicos» y «Filosofía» |
| `reader.png` | Lector (papel normal) con el panel de subrayados abierto y la píldora | Pride and Prejudice |
| `reader-night.png` | Lector en papel noche, con subrayados y la barra de selección | Alice's Adventures in Wonderland |
| `room.png` | Una Sala («Clásicos») | Hound of the Baskervilles, Jungle Book, Alice, Don Quixote, Marianela, Moby-Dick, Novelas ejemplares… |
| `light.png` | Inicio en el tema claro («cubo blanco») | los mismos que `library.png` |
| `settings.png` | Ajustes | ninguno |

Cómo se hicieron: app real (`tauri dev`) bajo Xvfb, ventana de 1440×900 con `devicePixelRatio` 2, manejada por WebDriver (`tauri-driver`) y con `XDG_DATA_HOME` y `XDG_CACHE_HOME` temporales. Se reescalaron a 2000×1250 y se redujeron a paleta de 256 colores para que cada PNG pese menos de 600 KB. La interfaz está en español. Las portadas son las primeras páginas de las propias ediciones antiguas.

## Origen de los libros

Todos proceden de [Internet Archive](https://archive.org) (la URL de cada ficha es `https://archive.org/details/<identificador>`). Todos son ediciones publicadas **antes de 1929**, así que son de dominio público en Estados Unidos, y cada autor (y traductor o ilustrador, cuando aparece) murió hace más de 70 años, de modo que también lo son en la Unión Europea y en España. Internet Archive marca como `NOT_IN_COPYRIGHT` la mayoría de las fichas; en las que no lo hace (Alice 1901, Moby-Dick 1851, Novelas ejemplares 1900) me baso en la fecha de edición y en la muerte del autor. Las dos fichas en español con la marca «Public Domain Mark 1.0» (La República e Imitación de Cristo) la ponen quienes subieron el archivo.

| Título (como se ve en la app) | Autor y obra original | Edición escaneada | Identificador en Internet Archive | Por qué es de dominio público |
|---|---|---|---|---|
| Pride and Prejudice | Jane Austen (1813) | Londres, George Allen, 1894; ilustraciones de Hugh Thomson | `prideprejudice00aust` | Austen murió en 1817; Thomson, en 1920; edición de 1894 |
| Treasure Island | Robert Louis Stevenson (1883) | Nueva York, Scribner, 1911; ilustraciones de N. C. Wyeth | `treasureisland00stev` | Stevenson murió en 1894; Wyeth, en 1945; edición de 1911 |
| Don Quixote | Miguel de Cervantes (1605 y 1615), en la versión abreviada de W. M. Thackeray | Londres y Nueva York, Thomas Nelson and Sons, 1912 | `adventuresofdonq00cerv` | Cervantes murió en 1616; Thackeray, en 1863; edición de 1912 |
| Alice's Adventures in Wonderland | Lewis Carroll (1865), con *Through the Looking-Glass* | Nueva York, Hurst, 1901; ilustraciones de John Tenniel | `alicesadventures1901carr` | Carroll murió en 1898; Tenniel, en 1914; edición de 1901 |
| The Hound of the Baskervilles | Arthur Conan Doyle (1902) | Londres, George Newnes, 1902 | `houndofbaskervil00doylrich` | Doyle murió en 1930 (más de 70 años); edición de 1902 |
| The Jungle Book | Rudyard Kipling (1894) | Nueva York, Century, 1910 (c1894); ilustraciones de J. L. Kipling, W. H. Drake y P. Frenzeny | `junglebook00kipl2` | Kipling murió en 1936 (más de 70 años); edición anterior a 1929 |
| Moby-Dick | Herman Melville (1851) | Nueva York, Harper & Brothers, 1851 (primera edición estadounidense) | `mobydickorwhale01melv` | Melville murió en 1891; edición de 1851 |
| The Origin of Species | Charles Darwin (1859) | Nueva York, P. F. Collier & Son, c. 1909 | `originofspecies00darwuoft` | Darwin murió en 1882; edición de c. 1909 |
| Meditations | Marco Aurelio (c. 170-180), trad. de Jeremy Collier | Londres, Walter Scott, 1887; edición de Alice Zimmern | `meditationsofmar00marc` | Marco Aurelio murió en 180; Collier, en 1726; Zimmern, en 1939; edición de 1887 |
| Confessions | San Agustín (c. 400), trad. de E. B. Pusey | Nueva York, P. F. Collier & Son, c. 1909 (Harvard Classics, junto con *La imitación de Cristo*) | `confessionsofsta00auguuoft` | Agustín murió en 430; Pusey, en 1882; edición de c. 1909 |
| Imitación de Cristo | Tomás de Kempis (c. 1420), trad. de Juan Eusebio Nieremberg | Madrid, Saturnino Calleja, 1876 | `imitacion-de-cristo_202606` | Kempis murió en 1471; Nieremberg, en 1658; edición de 1876 |
| La República | Platón (c. 375 a. C.), trad. de José Tomás y García | Madrid, Imprenta de Josef Collado, 1805 | `HCO191` | Platón murió en 347 a. C.; edición de 1805 |
| Novelas ejemplares | Miguel de Cervantes (1613) | Madrid, Aleu, c. 1900 | `lasdocenovelasej00cerv` | Cervantes murió en 1616; edición de c. 1900 |
| Marianela | Benito Pérez Galdós (1878) | Nueva York, W. S. Gottsberger, 1883 | `marianela00pereiala` | Galdós murió en 1920; edición de 1883 |

## Nota sobre los archivos de muestra

Para que los títulos y autores se vean limpios en la biblioteca, en **mis copias locales** de los PDF (no en el repositorio) reescribí el título y el autor del diccionario de metadatos con una actualización incremental (por ejemplo, «The hound of the Baskervilles : another adventure of Sherlock Holmes» pasó a «The Hound of the Baskervilles»). El contenido de las páginas no se tocó. Los PDF y los datos temporales se borraron al terminar.
