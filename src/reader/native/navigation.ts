import type { PageDestination } from "../viewerTypes";
import type { PageLayout } from "./layout";

/** Space kept above a destination so it does not sit against the edge of the view (CSS pixels). */
export const DESTINATION_MARGIN = 24;

/**
 * The `scrollTop` that shows a destination near the top of the view. Never above the top of its page, and rounded up
 * to a whole pixel: a browser keeps `scrollTop` whole, and a top rounded down would read as the page before.
 */
export function destinationScrollTop(layout: PageLayout, destination: PageDestination): number {
  if (layout.count === 0) return 0;
  const index = Math.min(Math.max(destination.page, 1), layout.count) - 1;
  const pageTop = layout.topOf(index);
  const inside = destination.y === null ? 0 : Math.max(0, destination.y * layout.scale - DESTINATION_MARGIN);
  return Math.ceil(pageTop + Math.min(inside, layout.heightOf(index)));
}

/** A match must keep this far (CSS pixels) from the edges of the view to count as already visible. */
const REVEAL_EDGE = 48;

/**
 * Where the view must scroll to show something at `top` (an absolute offset in the scroll content), or null when it is
 * already comfortably in view. A third of the view above it, as for highlights.
 */
export function scrollToReveal(top: number, scrollTop: number, viewHeight: number): number | null {
  if (top >= scrollTop + REVEAL_EDGE && top <= scrollTop + viewHeight - REVEAL_EDGE * 2) return null;
  return Math.max(0, Math.ceil(top - viewHeight / 3));
}
