import type { PageLayout } from "./layout";
import type { ReaderPosition } from "../position";

/**
 * A place of the book that must stay under a point of the viewport while the layout changes (zoom, resize).
 * `index` and `fy` say where it is vertically (a fraction of that page's height), `fx` horizontally (a fraction of the
 * scroll content's width), and `cx`, `cy` are the viewport point it must stay under.
 */
export type ViewAnchor =
  | { kind: "point"; index: number; fy: number; fx: number; cx: number; cy: number }
  | { kind: "position"; position: ReaderPosition };

/** The place under viewport point (cx, cy) while the view is scrolled to (scrollLeft, scrollTop). */
export function captureAnchor(
  layout: PageLayout,
  contentWidth: number,
  scroll: { left: number; top: number },
  point: { x: number; y: number },
): ViewAnchor {
  const y = scroll.top + point.y;
  const index = layout.pageAt(y);
  const height = layout.heightOf(index);
  return {
    kind: "point",
    index,
    fy: height > 0 ? (y - layout.topOf(index)) / height : 0,
    fx: contentWidth > 0 ? (scroll.left + point.x) / contentWidth : 0,
    cx: point.x,
    cy: point.y,
  };
}

/** The scroll offsets that put the anchored place back under its viewport point in the new layout. */
export function scrollForAnchor(
  layout: PageLayout,
  contentWidth: number,
  viewport: { width: number },
  anchor: ViewAnchor,
): { left: number; top: number } {
  if (anchor.kind === "position") {
    const index = Math.min(Math.max(anchor.position.page - 1, 0), Math.max(layout.count - 1, 0));
    const offset = Math.min(Math.max(anchor.position.offsetInPage, 0), 1);
    return {
      top: layout.count === 0 ? 0 : layout.topOf(index) + offset * layout.heightOf(index),
      left: Math.max(0, (contentWidth - viewport.width) / 2),
    };
  }
  return {
    top: layout.topOf(anchor.index) + anchor.fy * layout.heightOf(anchor.index) - anchor.cy,
    left: anchor.fx * contentWidth - anchor.cx,
  };
}
