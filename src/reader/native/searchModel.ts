import type { ViewRect } from "../../api/types";

/** One match: the boxes it covers (one per line when it crosses a line break). */
export type Match = ViewRect[];

/** A match found by number: its page, its place among the page's matches, and its boxes. */
export type MatchRef = { page: number; ordinal: number; rects: Match };

/**
 * The matches of a search, in the order they arrive: by page, and inside a page in reading order. Pages come in
 * ascending order, so a match's number never changes once it exists. A lookup by number is a binary search.
 */
export class SearchResults {
  private pages: number[] = [];
  private matches: Match[][] = [];
  /** Matches before each page: `starts[i]` is the number of the first match of `pages[i]`. */
  private starts: number[] = [];
  total = 0;

  /** Adds the matches of a page. A page not after the last one is ignored (events arrive in page order). */
  add(page: number, matches: Match[]): void {
    if (matches.length === 0) return;
    const last = this.pages[this.pages.length - 1];
    if (last !== undefined && page <= last) return;
    this.pages.push(page);
    this.matches.push(matches);
    this.starts.push(this.total);
    this.total += matches.length;
  }

  /** The matches of one page; empty when it has none. */
  onPage(page: number): readonly Match[] {
    const index = this.indexOfPage(page);
    return index === -1 ? [] : this.matches[index]!;
  }

  /** The match with this number (0-based), or null when there is none. */
  at(number: number): MatchRef | null {
    if (!Number.isInteger(number) || number < 0 || number >= this.total) return null;
    let low = 0;
    let high = this.pages.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.starts[middle]! <= number) low = middle;
      else high = middle - 1;
    }
    const ordinal = number - this.starts[low]!;
    return { page: this.pages[low]!, ordinal, rects: this.matches[low]![ordinal]! };
  }

  /** The number of the first match on `page` or after it; null when none is that far. */
  firstFrom(page: number): number | null {
    let low = 0;
    let high = this.pages.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.pages[middle]! < page) low = middle + 1;
      else high = middle;
    }
    return low < this.pages.length ? this.starts[low]! : null;
  }

  private indexOfPage(page: number): number {
    let low = 0;
    let high = this.pages.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const value = this.pages[middle]!;
      if (value === page) return middle;
      if (value < page) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }
}

/** The number after `current` going `direction`, wrapping around the ends. With no current match, the first or the last. */
export function stepMatch(current: number | null, direction: 1 | -1, total: number): number | null {
  if (total <= 0) return null;
  if (current === null) return direction === 1 ? 0 : total - 1;
  return (((current + direction) % total) + total) % total;
}

/** Position of a match box as percentages of its page box, so a zoom needs no new geometry. */
export type PercentRect = { left: number; top: number; width: number; height: number };

export function rectToPercent(rect: ViewRect, pageWidth: number, pageHeight: number): PercentRect {
  const [x0, y0, x1, y1] = rect;
  return {
    left: (x0 / pageWidth) * 100,
    top: (y0 / pageHeight) * 100,
    width: ((x1 - x0) / pageWidth) * 100,
    height: ((y1 - y0) / pageHeight) * 100,
  };
}
