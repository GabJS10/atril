import { useEffect } from "react";

// The webview is a browser underneath (WebView2 on Windows, WebKitGTK on Linux). Its defaults (print, reload, page zoom,
// find bar, caret browsing, context menu) do not belong in a desktop reader, so they are cancelled here, in one place.
// The app's own keys keep working: cancelling a default never stops propagation, so the reader and library listeners run.
// Only WebView2 gets the guard for now: the Linux build keeps the webview's behaviour (see `platformOf`).

/** The fields of a keyboard event that decide whether the webview's default applies. */
export type BrowserKey = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey">;

/** Ctrl + letter defaults: print, save page, open file, view source, find next, reload and find. */
const CTRL_LETTERS = new Set(["p", "s", "o", "u", "g", "r", "f"]);
/** Ctrl + symbol defaults: page zoom (also on the numeric keypad). */
const CTRL_ZOOM_KEYS = new Set(["+", "=", "-", "_", "0"]);
/** Ctrl + Shift + letter defaults that open the developer tools (kept in development). */
const CTRL_SHIFT_DEVTOOLS = new Set(["i", "j", "c"]);

/**
 * True when the webview's default for this key is a browser feature the app must cancel.
 * `production` keeps the developer tools reachable in development builds.
 */
export function isBrowserDefaultKey(event: BrowserKey, production: boolean): boolean {
  if (event.key === "F5" || event.key === "F3" || event.key === "F7") return true; // reload, find next, caret browsing
  if (production && event.key === "F12") return true;
  if (event.altKey && !event.ctrlKey && (event.key === "ArrowLeft" || event.key === "ArrowRight"))
    return true; // history
  // Ctrl without Alt only: on Windows AltGr arrives as Ctrl + Alt and types characters (Spanish layout: \, @, €).
  if (!event.ctrlKey || event.altKey) return false;
  const letter = event.key.toLowerCase();
  if (CTRL_LETTERS.has(letter) || CTRL_ZOOM_KEYS.has(event.key)) return true;
  return production && event.shiftKey && CTRL_SHIFT_DEVTOOLS.has(letter);
}

/** True for a field where the user types: its context menu (cut, copy, paste, spelling) stays. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

/** The platform the webview runs on, from its user agent: WebView2 says "Windows NT", WebKitGTK says "Linux". */
export function platformOf(userAgent: string): "windows" | "other" {
  return /Windows/i.test(userAgent) ? "windows" : "other";
}

/** Writes the platform on <html> as `data-platform`, for the few styles that differ (scrollbars, index.css). */
export function markPlatform(root: HTMLElement, userAgent: string): void {
  root.dataset.platform = platformOf(userAgent);
}

/**
 * Cancels the webview's defaults on `target` (the window in the app). Only on Windows: on other platforms it does nothing.
 * Returns the function that removes the listeners.
 */
export function installBrowserDefaults(
  target: EventTarget,
  options: { production: boolean; userAgent: string },
): () => void {
  if (platformOf(options.userAgent) !== "windows") return () => undefined;
  const { production } = options;

  const onKeyDown = (event: Event) => {
    if (event instanceof KeyboardEvent && isBrowserDefaultKey(event, production)) event.preventDefault();
  };
  const onWheel = (event: Event) => {
    // Ctrl + wheel zooms the page; the reader zooms its own pages with it (NativeViewer), so the page never zooms.
    if (event instanceof WheelEvent && event.ctrlKey) event.preventDefault();
  };
  const onContextMenu = (event: Event) => {
    if (!isTextField(event.target)) event.preventDefault();
  };

  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("wheel", onWheel, { capture: true, passive: false });
  target.addEventListener("contextmenu", onContextMenu, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("wheel", onWheel, { capture: true });
    target.removeEventListener("contextmenu", onContextMenu, true);
  };
}

/** Installs the guard while the app is mounted (RootLayout). */
export function useBrowserDefaults(): void {
  useEffect(
    () =>
      installBrowserDefaults(window, {
        production: import.meta.env.PROD,
        userAgent: navigator.userAgent,
      }),
    [],
  );
}
