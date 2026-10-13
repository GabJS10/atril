import type { SearchResults } from "./searchModel";
import { rectToPercent } from "./searchModel";

export const SEARCH_LAYER_CLASS = "atril-search-hits";
export const SEARCH_HIT_CLASS = "atril-search-hit";

/** The size of a page at scale 1, in points: the reference for the percentages. */
export type PageSize = { width: number; height: number };

/**
 * Draws the matches inside each page element in view. Positions are percentages of the page box, so a zoom does not
 * need a redraw. The match in focus (`active`: its page and place among the page's matches) gets `data-active`.
 * The layer ignores the pointer, so the text under it stays selectable.
 */
export function paintSearchLayer(
  container: HTMLElement,
  sizeOf: (page: number) => PageSize | undefined,
  results: SearchResults | null,
  active: { page: number; ordinal: number } | null,
): void {
  for (const pageElement of container.querySelectorAll<HTMLElement>(".page[data-page-number]")) {
    const layer = pageElement.querySelector<HTMLElement>(`:scope > .${SEARCH_LAYER_CLASS}`);
    if (!layer) continue;
    layer.replaceChildren();
    const page = Number(pageElement.dataset.pageNumber);
    const size = sizeOf(page);
    if (!results || !size) continue;
    results.onPage(page).forEach((match, ordinal) => {
      const isActive = active?.page === page && active.ordinal === ordinal;
      for (const rect of match) {
        const box = rectToPercent(rect, size.width, size.height);
        const element = document.createElement("div");
        element.className = SEARCH_HIT_CLASS;
        if (isActive) element.dataset.active = "true";
        element.style.left = `${box.left}%`;
        element.style.top = `${box.top}%`;
        element.style.width = `${box.width}%`;
        element.style.height = `${box.height}%`;
        layer.append(element);
      }
    });
  }
}
