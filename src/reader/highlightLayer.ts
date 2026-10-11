import type { Highlight } from "../api/types";
import { pdfRectToPercent, type PageMapping } from "./geometry";

/** A page at scale 1 (the reference for percentages) and its conversions. */
export type PageAtScale1 = PageMapping & { width: number; height: number };

export const HIGHLIGHT_LAYER_CLASS = "atril-highlights";
export const HIGHLIGHT_CLASS = "atril-highlight";

/**
 * Draws the highlights inside each page element. Positions are percentages of the page box, so a zoom
 * does not need a redraw. The layer is a sibling of the text layer and ignores the pointer: text stays
 * selectable under it, and clicks are looked up by position (see highlightAtPoint).
 *
 * The layer is not part of the reading filters (night and sepia), so its colours keep their own tokens.
 */
export function paintHighlightLayer(
  container: HTMLElement,
  pageAtScale1: (page: number) => PageAtScale1 | undefined,
  highlights: Highlight[],
): void {
  for (const pageElement of container.querySelectorAll<HTMLElement>(".page[data-page-number]")) {
    const page = Number(pageElement.dataset.pageNumber);
    let layer = pageElement.querySelector<HTMLElement>(`:scope > .${HIGHLIGHT_LAYER_CLASS}`);
    if (!layer) {
      layer = document.createElement("div");
      layer.className = HIGHLIGHT_LAYER_CLASS;
      pageElement.append(layer);
    }
    layer.replaceChildren();

    const mapping = pageAtScale1(page);
    if (!mapping) continue;
    for (const highlight of highlights) {
      if (highlight.page !== page) continue;
      for (const rect of highlight.rects) {
        const box = pdfRectToPercent(rect, mapping);
        const element = document.createElement("div");
        element.className = HIGHLIGHT_CLASS;
        element.dataset.color = highlight.color;
        element.dataset.highlightId = highlight.id;
        element.style.left = `${box.left}%`;
        element.style.top = `${box.top}%`;
        element.style.width = `${box.width}%`;
        element.style.height = `${box.height}%`;
        layer.append(element);
      }
    }
  }
}

/** The highlight rectangle under a viewport point, if any. */
export function highlightAt(container: HTMLElement, x: number, y: number): HTMLElement | null {
  for (const element of container.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`)) {
    const box = element.getBoundingClientRect();
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return element;
  }
  return null;
}
