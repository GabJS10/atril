/** The engine behind the reader's viewer: pdf.js (the default) or the native one (development switch). */
export type ViewerKind = "pdfjs" | "native";

export const VIEWER_STORAGE_KEY = "atril.viewer";

function parse(value: string | null | undefined): ViewerKind | null {
  return value === "native" || value === "pdfjs" ? value : null;
}

/**
 * Which viewer to open. pdf.js stays the default until the native one has text selection, search, index and links
 * (R2.2). Two ways to try the native one, in priority order:
 * 1. `localStorage.setItem("atril.viewer", "native")` in the webview console, then reopen the book
 *    (`"pdfjs"` forces pdf.js; `removeItem` clears it).
 * 2. Start the app with `VITE_ATRIL_VIEWER=native npm run tauri dev -- --release`.
 */
export function readViewerKind(
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
  envValue: string | undefined = import.meta.env.VITE_ATRIL_VIEWER,
): ViewerKind {
  try {
    const stored = parse(storage?.getItem(VIEWER_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Storage denied: fall through to the environment.
  }
  return parse(envValue) ?? "pdfjs";
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
