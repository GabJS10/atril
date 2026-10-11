import type { Settings } from "./api/types";

/** Applies Settings.theme as `data-theme` on <html>; the tokens in index.css read it. */
export function applyTheme(theme: Settings["theme"], root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}
