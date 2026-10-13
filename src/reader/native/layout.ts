import type { PageGeometry as PageSize } from "../../api/types";
import type { PageGeometry } from "../position";

/** Space between two pages, in CSS pixels. */
export const PAGE_GAP = 10;

/** The part of the book that is on screen: first and last 0-based page index, both included. */
export type PageRange = { first: number; last: number };

/** Positions of the whole page stack at one scale. Satisfies the `PageGeometry` of position.ts. */
export type PageLayout = PageGeometry & {
  /** CSS pixels per PDF point. */
  scale: number;
  /** Height of the whole stack. Known from the first instant: it only needs the page sizes. */
  totalHeight: number;
  /** Width of the widest page. */
  maxWidth: number;
  widthOf: (index: number) => number;
  /** Index of the page whose top is the last one at or above `y` (0 above the first page). */
  pageAt: (y: number) => number;
  /** Pages that intersect the vertical band [top, top + height). Empty stack: first > last. */
  visibleRange: (top: number, height: number) => PageRange;
};

/** What does not change with the zoom: page sizes at scale 1 and their running sums. */
export type LayoutBase = {
  count: number;
  /** `at(scale)` is O(1): the sums are scaled, not recomputed, so a zoom step costs nothing per page. */
  at: (scale: number) => PageLayout;
};

/**
 * Builds the page stack. The running heights are computed once (O(pages)); after that every question (where is page
 * n, which page is at this scroll offset, which pages are visible) costs O(1) or O(log pages).
 */
export function createLayoutBase(pages: readonly PageSize[], gap: number = PAGE_GAP): LayoutBase {
  const count = pages.length;
  const sums = new Float64Array(count + 1);
  let maxWidth = 0;
  for (let index = 0; index < count; index += 1) {
    sums[index + 1] = sums[index]! + pages[index]!.height;
    maxWidth = Math.max(maxWidth, pages[index]!.width);
  }

  return {
    count,
    at(scale) {
      const topOf = (index: number) => sums[index]! * scale + index * gap;
      const heightOf = (index: number) => pages[index]!.height * scale;
      const pageAt = (y: number) => {
        let low = 0;
        let high = count - 1;
        let found = 0;
        while (low <= high) {
          const middle = (low + high) >> 1;
          if (topOf(middle) <= y) {
            found = middle;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        return found;
      };
      return {
        count,
        scale,
        totalHeight: count === 0 ? 0 : sums[count]! * scale + (count - 1) * gap,
        maxWidth: maxWidth * scale,
        topOf,
        heightOf,
        widthOf: (index) => pages[index]!.width * scale,
        pageAt,
        visibleRange(top, height) {
          if (count === 0) return { first: 0, last: -1 };
          let first = pageAt(top);
          // In the gap below page `first`: the first page on screen is the next one.
          if (first < count - 1 && topOf(first) + heightOf(first) <= top) first += 1;
          const last = Math.max(first, pageAt(top + height - 1));
          return { first, last };
        },
      };
    },
  };
}

/** `range` widened by `pages` on each side and kept inside the book. */
export function widenRange(range: PageRange, pages: number, count: number): PageRange {
  return { first: Math.max(0, range.first - pages), last: Math.min(count - 1, range.last + pages) };
}

export function sameRange(a: PageRange, b: PageRange): boolean {
  return a.first === b.first && a.last === b.last;
}

/** True when the ranges share a page or are at most `slack` pages apart: the view moved on, it did not jump. */
export function rangesTouch(a: PageRange, b: PageRange, slack: number): boolean {
  return a.first <= b.last + slack && b.first <= a.last + slack;
}
