//! Rutas comparables entre plataformas.
//!
//! En Linux dos rutas son la misma si sus caracteres lo son. En Windows no: las rutas no distinguen mayúsculas,
//! `/` y `\` valen lo mismo, `C:\Libros` y `c:\libros\` son la misma carpeta y a veces llegan con el prefijo
//! `\\?\` (rutas "verbatim"). Comparar cadenas tal cual duplicaría carpetas de la biblioteca y no reconocería un
//! libro reemplazado en su ruta.
//!
//! Todo es léxico: no toca el disco (no resuelve enlaces, junctions ni nombres cortos 8.3) y nunca bloquea en una
//! carpeta de red caída. Las reglas de cada plataforma son una función pura de [`Style`], así que se prueban
//! todas desde cualquier sistema; la app usa [`Style::NATIVE`].

use std::path::Path;

/// Reglas de comparación de rutas de una plataforma.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Style {
    /// Linux y macOS: distingue mayúsculas, el separador es `/`.
    Posix,
    /// Windows: no distingue mayúsculas, vale `\` y `/`, y existen unidades (`C:`), rutas de red (`\\servidor\recurso`)
    /// y el prefijo `\\?\`.
    Windows,
}

impl Style {
    /// Las reglas de la plataforma en la que corre la app.
    pub const NATIVE: Style = if cfg!(windows) {
        Style::Windows
    } else {
        Style::Posix
    };
}

/// Una ruta de Windows de al menos estos caracteres (UTF-16) conserva el prefijo `\\?\` al normalizar: sin él, Win32
/// no la abre (ver [`normalize`]).
const LONG_PATH_CHARS: usize = 248;

/// Forma normalizada de `path` para guardarla y mostrarla: separadores unificados (`\` en Windows), sin separadores
/// repetidos ni final, sin segmentos `.` y, en Windows, sin el prefijo `\\?\` cuando la ruta cabe sin él. Conserva
/// las mayúsculas. Idempotente.
pub fn normalize(path: &str, style: Style) -> String {
    match style {
        Style::Posix => normalize_posix(path),
        Style::Windows => normalize_windows(path, false),
    }
}

/// Clave para comparar: dos rutas que se refieren al mismo archivo o carpeta dan la misma clave. En Windows también
/// ignora las mayúsculas y siempre quita el prefijo `\\?\`.
pub fn key(path: &str, style: Style) -> String {
    match style {
        Style::Posix => normalize_posix(path),
        Style::Windows => fold_case(&normalize_windows(path, true)),
    }
}

/// [`key`] con las reglas de esta plataforma.
pub fn native_key(path: &Path) -> String {
    key(&path.to_string_lossy(), Style::NATIVE)
}

/// Las dos rutas son el mismo archivo o carpeta según las reglas de esta plataforma.
pub fn same(a: &str, b: &str) -> bool {
    key(a, Style::NATIVE) == key(b, Style::NATIVE)
}

/// `path` es `folder` o está dentro de ella (a cualquier nivel), según las reglas de `style`. Compara por segmentos
/// completos: `/libros/Economia/a.pdf` está dentro de `/libros/Economia`, pero `/libros/Economia2` o `/libros/Eco`
/// no. Léxico, sin tocar el disco.
pub fn is_within(path: &str, folder: &str, style: Style) -> bool {
    let path = key(path, style);
    let folder = key(folder, style);
    if path == folder {
        return true;
    }
    let separator = match style {
        Style::Posix => '/',
        Style::Windows => '\\',
    };
    // La raíz (`/`, `C:\`) ya termina en separador.
    let prefix = if folder.ends_with(separator) {
        folder
    } else {
        format!("{folder}{separator}")
    };
    path.starts_with(&prefix)
}

fn normalize_posix(path: &str) -> String {
    let absolute = path.starts_with('/');
    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect();
    let joined = segments.join("/");
    match (absolute, joined.is_empty()) {
        (true, _) => format!("/{joined}"),
        (false, true) if !path.is_empty() => ".".to_owned(),
        (false, _) => joined,
    }
}

/// Dónde acaba la parte raíz de una ruta de Windows y qué parte es.
struct WindowsPath {
    /// `C:\`, `C:`, `\`, `\\servidor\recurso` o vacío (ruta relativa).
    root: String,
    /// Sin nada por encima de la raíz: `..` no puede subir más.
    anchored: bool,
    /// El resto, ya separado por `\`.
    rest: String,
}

fn split_windows(path: &str, force_simple: bool) -> WindowsPath {
    let path = path.replace('/', r"\");
    let simple = |root: String, rest: &str| WindowsPath {
        root,
        anchored: true,
        rest: rest.to_owned(),
    };
    if let Some(verbatim) = path.strip_prefix(r"\\?\") {
        let (root, rest) = if let Some(unc) = strip_prefix_ignore_case(verbatim, r"UNC\") {
            let (server, after) = unc.split_once('\\').unwrap_or((unc, ""));
            let (share, rest) = after.split_once('\\').unwrap_or((after, ""));
            (format!(r"\\{server}\{share}"), rest)
        } else if let Some((drive, rest)) = drive_prefix(verbatim) {
            (format!(r"{drive}:\"), rest)
        } else {
            // `\\?\Volume{…}\` y similares: no hay equivalente sin prefijo.
            return WindowsPath {
                root: String::new(),
                anchored: true,
                rest: path,
            };
        };
        let fits = root.encode_utf16().count() + rest.encode_utf16().count() < LONG_PATH_CHARS;
        if force_simple || fits {
            return simple(root, rest);
        }
        // Demasiado larga para Win32 sin el prefijo: se conserva tal cual.
        return WindowsPath {
            root: String::new(),
            anchored: true,
            rest: path,
        };
    }
    if path.starts_with(r"\\.\") {
        return WindowsPath {
            root: String::new(),
            anchored: true,
            rest: path,
        };
    }
    if let Some(unc) = path.strip_prefix(r"\\") {
        let (server, after) = unc.split_once('\\').unwrap_or((unc, ""));
        let (share, rest) = after.split_once('\\').unwrap_or((after, ""));
        return simple(format!(r"\\{server}\{share}"), rest);
    }
    if let Some((drive, rest)) = drive_prefix(&path) {
        return match rest.strip_prefix('\\') {
            Some(rest) => simple(format!(r"{drive}:\"), rest),
            None => WindowsPath {
                root: format!("{drive}:"),
                anchored: false,
                rest: rest.to_owned(),
            },
        };
    }
    if let Some(rest) = path.strip_prefix('\\') {
        return simple(r"\".to_owned(), rest);
    }
    WindowsPath {
        root: String::new(),
        anchored: false,
        rest: path,
    }
}

/// `C:` al principio (una letra y dos puntos): devuelve la letra y lo que sigue.
fn drive_prefix(path: &str) -> Option<(char, &str)> {
    let mut chars = path.chars();
    let drive = chars.next().filter(char::is_ascii_alphabetic)?;
    (chars.next() == Some(':')).then(|| (drive, &path[2..]))
}

fn strip_prefix_ignore_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}

fn normalize_windows(path: &str, force_simple: bool) -> String {
    let parts = split_windows(path, force_simple);
    if parts.root.is_empty() && parts.anchored {
        // Rutas especiales (`\\.\`, `\\?\Volume{…}`) o demasiado largas: no se tocan.
        return parts.rest;
    }
    let mut segments: Vec<&str> = Vec::new();
    for segment in parts.rest.split('\\') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.last().is_some_and(|last| *last != "..") {
                    segments.pop();
                } else if !parts.anchored {
                    segments.push("..");
                }
            }
            other => segments.push(other),
        }
    }
    let joined = segments.join(r"\");
    if parts.root.is_empty() && joined.is_empty() {
        return if path.is_empty() {
            String::new()
        } else {
            ".".to_owned()
        };
    }
    if parts.root.ends_with('\\') || parts.root.is_empty() || parts.root.ends_with(':') {
        // `C:\`, `\` y relativas: la raíz ya lleva su separador (o no lo necesita: `C:carpeta`).
        format!("{}{joined}", parts.root)
    } else if joined.is_empty() {
        parts.root
    } else {
        // `\\servidor\recurso` + `\carpeta`.
        format!(r"{}\{joined}", parts.root)
    }
}

/// Pasa a mayúsculas carácter a carácter, como la tabla de NTFS (1 a 1): lo que se convertiría en varios
/// caracteres (`ß` → `SS`) se deja igual.
fn fold_case(text: &str) -> String {
    text.chars()
        .map(|c| {
            let mut upper = c.to_uppercase();
            match (upper.next(), upper.next()) {
                (Some(single), None) => single,
                _ => c,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(path: &str) -> String {
        key(path, Style::Windows)
    }

    fn posix(path: &str) -> String {
        key(path, Style::Posix)
    }

    #[test]
    fn windows_ignores_case_separators_and_the_trailing_slash() {
        let folder = win(r"C:\Libros");
        for spelling in [
            r"c:\libros\",
            "C:/Libros/",
            r"C:\LIBROS",
            r"C:\\Libros",
            r"c:/libros",
        ] {
            assert_eq!(win(spelling), folder, "{spelling}");
        }
        assert_ne!(win(r"C:\Libros2"), folder);
        assert_ne!(win(r"D:\Libros"), folder);
        assert_ne!(win(r"C:\Libros\Economía"), folder);
    }

    #[test]
    fn windows_case_folding_covers_non_ascii_letters() {
        assert_eq!(win(r"C:\Música\Ñandú"), win(r"c:\MÚSICA\ñANDÚ"));
        // `ß` no tiene mayúscula de un solo carácter en NTFS: no se confunde con `SS`.
        assert_ne!(win(r"C:\Strasse"), win(r"C:\Straße"));
    }

    #[test]
    fn windows_verbatim_paths_match_their_plain_form() {
        assert_eq!(win(r"\\?\C:\Libros"), win(r"C:\Libros"));
        assert_eq!(win(r"\\?\c:\libros\"), win(r"C:\Libros"));
        assert_eq!(win(r"\\?\UNC\srv\share\Libros"), win(r"\\SRV\Share\libros"));
    }

    #[test]
    fn windows_network_paths_keep_the_server_and_share() {
        assert_eq!(win(r"\\srv\share\Libros\"), win(r"\\SRV\SHARE\libros"));
        assert_ne!(win(r"\\srv\share\Libros"), win(r"\\srv\other\Libros"));
        assert_ne!(win(r"\\srv\share"), win(r"\srv\share"));
        assert_eq!(normalize(r"\\srv\share\", Style::Windows), r"\\srv\share");
        assert_eq!(
            normalize(r"//srv/share/a//b", Style::Windows),
            r"\\srv\share\a\b"
        );
    }

    #[test]
    fn windows_resolves_dot_segments_like_win32_does() {
        assert_eq!(win(r"C:\a\.\b\..\c"), win(r"C:\a\c"));
        assert_eq!(win(r"C:\..\a"), win(r"C:\a"), "nothing above the root");
        assert_eq!(
            win(r"a\..\..\b"),
            win(r"..\b"),
            "relative paths keep what they cannot resolve"
        );
    }

    #[test]
    fn windows_roots_and_drive_relative_paths() {
        assert_eq!(win(r"C:\"), win("c:/"));
        assert_eq!(normalize(r"C:\", Style::Windows), r"C:\");
        assert_ne!(
            win("C:"),
            win(r"C:\"),
            "C: is the current folder of the drive"
        );
        assert_eq!(normalize("C:libros/a", Style::Windows), r"C:libros\a");
        assert_eq!(normalize(r"\libros\", Style::Windows), r"\libros");
        assert_eq!(normalize("", Style::Windows), "");
        assert_eq!(normalize(".", Style::Windows), ".");
    }

    #[test]
    fn normalizing_windows_paths_keeps_the_case_and_strips_a_short_verbatim_prefix() {
        assert_eq!(normalize("c:/Libros/", Style::Windows), r"c:\Libros");
        assert_eq!(
            normalize(r"\\?\C:\Libros\Economía", Style::Windows),
            r"C:\Libros\Economía"
        );
        assert_eq!(
            normalize(r"\\?\UNC\srv\share\Libros", Style::Windows),
            r"\\srv\share\Libros"
        );
    }

    #[test]
    fn a_verbatim_path_too_long_for_win32_keeps_its_prefix() {
        let long = format!(r"\\?\C:\{}", "x".repeat(300));
        assert_eq!(normalize(&long, Style::Windows), long);
        // Para comparar sí se quita siempre.
        assert_eq!(win(&long), win(&format!(r"C:\{}", "x".repeat(300))));
    }

    #[test]
    fn special_windows_namespaces_are_left_alone() {
        for path in [
            r"\\.\COM1",
            r"\\?\Volume{26a21bda-a627-11d7-9931-806e6f6e6963}\x",
        ] {
            assert_eq!(normalize(path, Style::Windows), path);
        }
    }

    #[test]
    fn posix_distinguishes_case_but_ignores_empty_and_dot_segments() {
        assert_eq!(posix("/home/u/Libros"), "/home/u/Libros");
        assert_eq!(posix("/home/u/Libros/"), posix("/home/u//Libros"));
        assert_eq!(posix("/home/u/./Libros"), posix("/home/u/Libros"));
        assert_ne!(posix("/home/u/Libros"), posix("/home/u/libros"));
        assert_eq!(posix("/"), "/");
        assert_eq!(posix("//"), "/");
        assert_eq!(posix("rel/./a/"), "rel/a");
        assert_eq!(posix("."), ".");
        assert_eq!(posix(""), "");
    }

    #[test]
    fn posix_keeps_dot_dot_because_of_symlinks() {
        assert_eq!(posix("/a/b/../c"), "/a/b/../c");
        assert_ne!(posix("/a/b/../c"), posix("/a/c"));
    }

    #[test]
    fn posix_treats_backslashes_as_ordinary_file_name_characters() {
        assert_ne!(posix(r"/a\b"), posix("/a/b"));
    }

    #[test]
    fn normalizing_is_idempotent() {
        for style in [Style::Posix, Style::Windows] {
            for path in [
                "/a//b/./c/",
                r"C:/a//b/./c/",
                r"\\?\C:\a\b",
                r"\\srv\share\a",
                "rel/x/",
                "",
                ".",
            ] {
                let once = normalize(path, style);
                assert_eq!(normalize(&once, style), once, "{style:?} {path}");
            }
        }
    }

    #[test]
    fn the_native_helpers_follow_this_platform() {
        assert_eq!(
            native_key(Path::new("/home/u/Libros/")),
            key("/home/u/Libros/", Style::NATIVE)
        );
        assert!(same("/home/u/Libros", "/home/u/Libros/"));
        assert!(!same("/home/u/Libros", "/home/u/Libros2"));
        #[cfg(windows)]
        assert!(same(r"C:\Libros", r"c:\libros\"));
        #[cfg(not(windows))]
        assert!(!same("/home/u/Libros", "/home/u/libros"));
    }

    #[test]
    fn within_compares_whole_segments_at_any_depth() {
        let within = |path, folder| is_within(path, folder, Style::Posix);
        assert!(within("/libros/Economia/a.pdf", "/libros/Economia"));
        assert!(within("/libros/Economia/x/y/a.pdf", "/libros/Economia/"));
        assert!(within("/libros/Economia", "/libros/Economia"));
        assert!(within("/libros/a.pdf", "/"));
        assert!(!within("/libros/Economia2/a.pdf", "/libros/Economia"));
        assert!(!within("/libros/Eco/a.pdf", "/libros/Economia"));
        assert!(!within("/libros/economia/a.pdf", "/libros/Economia"));
    }

    #[test]
    fn within_on_windows_ignores_case_separators_and_the_verbatim_prefix() {
        let within = |path, folder| is_within(path, folder, Style::Windows);
        assert!(within(r"C:\Libros\Eco\a.pdf", r"c:/libros/eco/"));
        assert!(within(r"C:\Libros\Eco\sub\a.pdf", r"\\?\C:\LIBROS\ECO"));
        assert!(within(r"C:\a.pdf", r"C:\"));
        assert!(!within(r"C:\Libros\Economia\a.pdf", r"C:\Libros\Eco"));
        assert!(!within(r"D:\Libros\Eco\a.pdf", r"C:\Libros\Eco"));
    }
}
