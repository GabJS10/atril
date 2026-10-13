import { describe, expect, it } from "vitest";
import type { PageGeometry } from "../../api/types";
import { createLayoutBase } from "./layout";
import { DESTINATION_MARGIN, destinationScrollTop, scrollToReveal } from "./navigation";

// Three pages of 600 points at scale 2 (1200 px each) and a 10 px gap.
const pages: PageGeometry[] = Array.from({ length: 3 }, () => ({
  width: 400,
  height: 600,
  transform: [1, 0, 0, -1, 0, 600],
}));
const layout = createLayoutBase(pages).at(2);

describe("destinationScrollTop", () => {
  it("goes to the top of the page when the destination has no height", () => {
    expect(destinationScrollTop(layout, { page: 2, y: null })).toBe(1210);
  });

  it("puts the destination a margin below the top of the view", () => {
    // y = 100 points = 200 px; the page top is 1210.
    expect(destinationScrollTop(layout, { page: 2, y: 100 })).toBe(1210 + 200 - DESTINATION_MARGIN);
  });

  it("never goes above the top of its page", () => {
    expect(destinationScrollTop(layout, { page: 3, y: 5 })).toBe(2420);
    expect(destinationScrollTop(layout, { page: 3, y: 0 })).toBe(2420);
  });

  it("rounds up to a whole pixel and keeps inside the book", () => {
    const fractional = createLayoutBase(pages).at(1.1234);
    expect(Number.isInteger(destinationScrollTop(fractional, { page: 2, y: 33.3 }))).toBe(true);
    expect(destinationScrollTop(layout, { page: 99, y: null })).toBe(2420);
    expect(destinationScrollTop(layout, { page: 0, y: null })).toBe(0);
    // A height past the page does not leave it.
    expect(destinationScrollTop(layout, { page: 1, y: 9999 })).toBe(1200);
  });

  it("is zero for an empty book", () => {
    expect(destinationScrollTop(createLayoutBase([]).at(1), { page: 1, y: null })).toBe(0);
  });
});

describe("scrollToReveal", () => {
  it("leaves the view alone when the match is comfortably inside it", () => {
    expect(scrollToReveal(500, 100, 600)).toBeNull();
  });

  it("scrolls when the match is above, below or at the edge", () => {
    expect(scrollToReveal(90, 100, 600)).toBe(0);
    expect(scrollToReveal(2000, 100, 600)).toBe(1800);
    expect(scrollToReveal(100 + 600 - 10, 100, 600)).toBe(490);
  });

  it("does not scroll above the start of the book", () => {
    expect(scrollToReveal(30, 0, 900)).toBe(0);
  });
});
