import { describe, expect, it } from "vitest";
import type { ReadingState, Settings } from "../api/types";
import { initialReadingStart, type PageGeometry, positionAtScroll, scrollForPosition } from "./position";

/** Pages stacked with `gap` pixels between them; page i starts after the ones before it. */
function stack(heights: number[], gap = 10): PageGeometry {
  const tops: number[] = [];
  let y = 0;
  for (const height of heights) {
    tops.push(y);
    y += height + gap;
  }
  return { count: heights.length, topOf: (index) => tops[index]!, heightOf: (index) => heights[index]! };
}

describe("positionAtScroll", () => {
  const geometry = stack([100, 200, 100]); // tops: 0, 110, 320

  it("gives the first page at the top of the document", () => {
    expect(positionAtScroll(geometry, 0)).toEqual({ page: 1, offsetInPage: 0 });
  });

  it("gives the page under the top edge and how far down it the view is", () => {
    expect(positionAtScroll(geometry, 110 + 100)).toEqual({ page: 2, offsetInPage: 0.5 });
  });

  it("clamps the gap between pages to the end of the page above", () => {
    expect(positionAtScroll(geometry, 105)).toEqual({ page: 1, offsetInPage: 1 });
  });

  it("clamps past the last page", () => {
    expect(positionAtScroll(geometry, 10_000)).toEqual({ page: 3, offsetInPage: 1 });
  });

  it("handles an empty document", () => {
    expect(positionAtScroll(stack([]), 500)).toEqual({ page: 1, offsetInPage: 0 });
  });

  it("finds the page in a long document (binary search)", () => {
    const long = stack(
      Array.from({ length: 400 }, () => 1000),
      0,
    );
    expect(positionAtScroll(long, 150 * 1000 + 250)).toEqual({ page: 151, offsetInPage: 0.25 });
  });
});

describe("scrollForPosition", () => {
  it("puts the position at the top of the view", () => {
    expect(scrollForPosition(stack([100, 200, 100]), { page: 3, offsetInPage: 0.25 })).toBe(320 + 25);
  });

  it("clamps an out-of-range page and offset", () => {
    const geometry = stack([100, 200]);
    expect(scrollForPosition(geometry, { page: 99, offsetInPage: 2 })).toBe(110 + 200);
    expect(scrollForPosition(geometry, { page: 0, offsetInPage: -1 })).toBe(0);
  });

  it("is the inverse of positionAtScroll", () => {
    const geometry = stack([842, 842, 842, 1000], 12);
    for (const position of [
      { page: 1, offsetInPage: 0 },
      { page: 2, offsetInPage: 0.4321 },
      { page: 4, offsetInPage: 0.9999 },
    ]) {
      expect(positionAtScroll(geometry, scrollForPosition(geometry, position))).toEqual(position);
    }
  });

  it("keeps the same place in the page when the zoom changes", () => {
    const at100 = stack([800, 800, 800], 0);
    const at200 = stack([1600, 1600, 1600], 0);
    const position = { page: 2, offsetInPage: 0.3 };
    expect(scrollForPosition(at200, position)).toBe(2 * scrollForPosition(at100, position));
  });
});

describe("initialReadingStart", () => {
  const settings: Settings = {
    language: "system",
    theme: "dark",
    defaultZoom: "page_fit",
    defaultViewMode: "sepia",
  };

  it("uses the Settings defaults and the first page when the book was never read", () => {
    expect(initialReadingStart(null, settings)).toEqual({
      zoom: "page_fit",
      viewMode: "sepia",
      position: null,
    });
  });

  it("restores the saved page, offset, zoom and view mode", () => {
    const state: ReadingState = {
      page: 150,
      offsetInPage: 0.61,
      zoom: 1.25,
      viewMode: "night",
      updatedAt: "2026-10-11T12:00:00Z",
    };
    expect(initialReadingStart(state, settings)).toEqual({
      zoom: 1.25,
      viewMode: "night",
      position: { page: 150, offsetInPage: 0.61 },
    });
  });
});
