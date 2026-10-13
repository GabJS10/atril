/** The engine behind the reader's viewer: pdf.js (the default) or the native one (development switch). */
export type ViewerKind = "pdfjs" | "native";

export const VIEWER_STORAGE_KEY = "atril.viewer";

/**
 * Which viewer to open. pdf.js stays the default until the native one has text selection, search, index and links
 * (R2.2). To try the native one: `localStorage.setItem("atril.viewer", "native")` in the webview console, then reopen
 * the book. `localStorage.removeItem("atril.viewer")` goes back.
 */
export function readViewerKind(storage: Pick<Storage, "getItem"> | null = safeStorage()): ViewerKind {
  try {
    return storage?.getItem(VIEWER_STORAGE_KEY) === "native" ? "native" : "pdfjs";
  } catch {
    return "pdfjs";
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
