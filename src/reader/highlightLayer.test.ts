import { describe, expect, it } from "vitest";
import type { Highlight } from "../api/types";
import { highlightAt, HIGHLIGHT_CLASS, type PageAtScale1, paintHighlightLayer } from "./highlightLayer";
import { floatingPosition, PIGMENT_COLOR, PIGMENTS } from "./highlightPresentation";

/** A US-letter page at scale 1: 612 x 792 points, origin bottom-left in PDF space, top-left in the viewport. */
const page: PageAtScale1 = {
  width: 612,
  height: 792,
  convertToViewportPoint: (x, y) => [x, 792 - y],
  convertToPdfPoint: (x, y) => [x, 792 - y],
};

function highlight(id: string, pageNumber: number, rects: [number, number, number, number][]): Highlight {
  return {
    id,
    bookId: "b",
    page: pageNumber,
    rects,
    text: "x",
    color: "sage",
    note: null,
    groupId: null,
    createdAt: "2026-10-11T12:00:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
  };
}

function container(pages: number): HTMLElement {
  const root = document.createElement("div");
  for (let number = 1; number <= pages; number += 1) {
    const element = document.createElement("div");
    element.className = "page";
    element.dataset.pageNumber = String(number);
    root.append(element);
  }
  document.body.append(root);
  return root;
}

describe("paintHighlightLayer", () => {
  it("draws each rectangle as a percentage of its page, in the highlight's pigment", () => {
    const root = container(2);
    // Top-left quarter of page 1: x 0..306, y 0..396 in PDF space is the upper-left in the viewport at y 396..792.
    const item = highlight("h1", 1, [[0, 396, 306, 792]]);

    paintHighlightLayer(root, () => page, [item]);

    const element = root.querySelector<HTMLElement>(`.${HIGHLIGHT_CLASS}`)!;
    expect(element.dataset.color).toBe("sage");
    expect(element.dataset.highlightId).toBe("h1");
    expect(element.style.left).toBe("0%");
    expect(element.style.top).toBe("0%");
    expect(parseFloat(element.style.width)).toBeCloseTo(50, 4);
    expect(parseFloat(element.style.height)).toBeCloseTo(50, 4);
  });

  it("paints only the highlights of each page, and repaints without duplicates", () => {
    const root = container(2);
    const items = [highlight("a", 1, [[0, 0, 100, 20]]), highlight("b", 2, [[0, 0, 100, 20]])];

    paintHighlightLayer(root, () => page, items);
    paintHighlightLayer(root, () => page, items);

    const pageOne = root.querySelector(".page[data-page-number='1']")!;
    const pageTwo = root.querySelector(".page[data-page-number='2']")!;
    expect(pageOne.querySelectorAll(`.${HIGHLIGHT_CLASS}`)).toHaveLength(1);
    expect(pageTwo.querySelectorAll(`.${HIGHLIGHT_CLASS}`)).toHaveLength(1);
  });

  it("skips a page whose geometry is not ready yet", () => {
    const root = container(1);
    paintHighlightLayer(root, () => undefined, [highlight("a", 1, [[0, 0, 100, 20]])]);
    expect(root.querySelectorAll(`.${HIGHLIGHT_CLASS}`)).toHaveLength(0);
  });
});

describe("highlightAt", () => {
  it("finds the highlight rectangle under a point", () => {
    const root = container(1);
    paintHighlightLayer(root, () => page, [highlight("hit", 1, [[0, 0, 100, 20]])]);
    const element = root.querySelector<HTMLElement>(`.${HIGHLIGHT_CLASS}`)!;
    element.getBoundingClientRect = () =>
      ({ left: 10, top: 10, right: 60, bottom: 30, width: 50, height: 20 }) as DOMRect;

    expect(highlightAt(root, 20, 20)).toBe(element);
    expect(highlightAt(root, 200, 200)).toBeNull();
  });
});

describe("floatingPosition", () => {
  it("sits above the anchor when there is room", () => {
    const anchor = { left: 300, top: 300, width: 100, height: 20, right: 400, bottom: 320 } as DOMRect;
    expect(floatingPosition(anchor, 200, 56).top).toBe(300 - 56 - 8);
  });

  it("goes below the anchor at the top of the window", () => {
    const anchor = { left: 300, top: 20, width: 100, height: 20, right: 400, bottom: 40 } as DOMRect;
    expect(floatingPosition(anchor, 200, 56).top).toBe(40 + 8);
  });
});

describe("PIGMENT_COLOR", () => {
  it("maps every pigment to its colour token, including ochre (whose token is --pigment-ocre)", () => {
    expect(PIGMENT_COLOR).toEqual({
      ochre: "var(--pigment-ocre)",
      sienna: "var(--pigment-sienna)",
      sage: "var(--pigment-sage)",
      slate: "var(--pigment-slate)",
    });
    expect(PIGMENTS).toEqual(["ochre", "sienna", "sage", "slate"]);
  });
});
