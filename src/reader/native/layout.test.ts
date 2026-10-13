import { describe, expect, it } from "vitest";
import type { PageGeometry } from "../../api/types";
import { positionAtScroll, scrollForPosition } from "../position";
import { createLayoutBase, PAGE_GAP, rangesTouch, sameRange, widenRange } from "./layout";

const IDENTITY: PageGeometry["transform"] = [1, 0, 0, -1, 0, 0];
const page = (width: number, height: number): PageGeometry => ({ width, height, transform: IDENTITY });

/** 100 pages of 200 x 300 points, then one of 400 x 100. */
const pages = [...Array.from({ length: 100 }, () => page(200, 300)), page(400, 100)];

describe("createLayoutBase", () => {
  it("knows the whole height from the page sizes alone", () => {
    const layout = createLayoutBase(pages).at(1);
    expect(layout.totalHeight).toBe(100 * 300 + 100 + 100 * PAGE_GAP);
    expect(layout.maxWidth).toBe(400);
  });

  it("scales the heights but not the gaps", () => {
    const layout = createLayoutBase([page(100, 200), page(100, 200)]).at(2);
    expect(layout.topOf(0)).toBe(0);
    expect(layout.heightOf(0)).toBe(400);
    expect(layout.topOf(1)).toBe(400 + PAGE_GAP);
    expect(layout.totalHeight).toBe(800 + PAGE_GAP);
    expect(layout.widthOf(1)).toBe(200);
  });

  it("finds the page at a scroll offset, in the gaps too", () => {
    const layout = createLayoutBase(pages).at(1);
    expect(layout.pageAt(-50)).toBe(0);
    expect(layout.pageAt(0)).toBe(0);
    expect(layout.pageAt(299)).toBe(0);
    expect(layout.pageAt(305)).toBe(0); // in the gap below page 1
    expect(layout.pageAt(310)).toBe(1);
    expect(layout.pageAt(1e9)).toBe(100);
  });

  it("lists the pages that intersect the band", () => {
    const layout = createLayoutBase(pages).at(1);
    expect(layout.visibleRange(0, 500)).toEqual({ first: 0, last: 1 });
    // Starts in the gap below page 1: the first page on screen is the next one.
    expect(layout.visibleRange(305, 100)).toEqual({ first: 1, last: 1 });
    expect(layout.visibleRange(310, 600)).toEqual({ first: 1, last: 2 });
    // The band ends exactly at the top of a page: that page is not on screen.
    expect(layout.visibleRange(0, 310)).toEqual({ first: 0, last: 0 });
    expect(layout.visibleRange(1e9, 600)).toEqual({ first: 100, last: 100 });
  });

  it("is empty for a book without pages", () => {
    const layout = createLayoutBase([]).at(1);
    expect(layout.totalHeight).toBe(0);
    expect(layout.visibleRange(0, 800).last).toBeLessThan(layout.visibleRange(0, 800).first);
  });

  it("works with the position helpers of the reader, and a zoom keeps the position", () => {
    const base = createLayoutBase(pages);
    const position = { page: 37, offsetInPage: 0.25 };
    for (const scale of [0.5, 1, 1.333, 4]) {
      const layout = base.at(scale);
      const top = scrollForPosition(layout, position);
      expect(top).toBeCloseTo(layout.topOf(36) + 0.25 * layout.heightOf(36), 6);
      expect(positionAtScroll(layout, top)).toEqual(position);
    }
  });

  it("answers in logarithmic time over a 4000-page book", () => {
    const book = Array.from({ length: 4000 }, (_, index) => page(612, 700 + (index % 5) * 20));
    const base = createLayoutBase(book);
    const layout = base.at(1.333);
    // A million lookups spread over the whole book must be far under a frame each: the cost does not scale with pages.
    const started = performance.now();
    let checksum = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const range = layout.visibleRange((i * 7919) % layout.totalHeight, 900);
      checksum += range.first + range.last;
    }
    const elapsed = performance.now() - started;
    expect(checksum).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
    // A zoom step is O(1) too: it only builds closures over the prefix sums.
    const zoomStarted = performance.now();
    for (let i = 0; i < 10_000; i += 1) base.at(1 + i / 10_000);
    expect(performance.now() - zoomStarted).toBeLessThan(200);
  });
});

describe("ranges", () => {
  it("widens inside the book", () => {
    expect(widenRange({ first: 0, last: 2 }, 1, 100)).toEqual({ first: 0, last: 3 });
    expect(widenRange({ first: 98, last: 99 }, 2, 100)).toEqual({ first: 96, last: 99 });
  });

  it("compares and tells a scroll from a jump", () => {
    expect(sameRange({ first: 1, last: 2 }, { first: 1, last: 2 })).toBe(true);
    expect(sameRange({ first: 1, last: 2 }, { first: 1, last: 3 })).toBe(false);
    expect(rangesTouch({ first: 10, last: 11 }, { first: 12, last: 13 }, 3)).toBe(true);
    expect(rangesTouch({ first: 10, last: 11 }, { first: 15, last: 16 }, 3)).toBe(false);
    expect(rangesTouch({ first: 10, last: 11 }, { first: 0, last: 1 }, 3)).toBe(false);
    expect(rangesTouch({ first: 0, last: -1 }, { first: 500, last: 501 }, 3)).toBe(false);
  });
});
