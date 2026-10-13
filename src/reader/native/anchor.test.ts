import { describe, expect, it } from "vitest";
import type { PageGeometry } from "../../api/types";
import { captureAnchor, scrollForAnchor } from "./anchor";
import { createLayoutBase } from "./layout";

const page = (width: number, height: number): PageGeometry => ({
  width,
  height,
  transform: [1, 0, 0, -1, 0, height],
});
const base = createLayoutBase(Array.from({ length: 50 }, () => page(400, 600)));

describe("view anchors", () => {
  it("keeps the point under the cursor fixed while zooming", () => {
    const before = base.at(1);
    const viewportWidth = 800;
    const scroll = { left: 0, top: 5000 };
    const cursor = { x: 300, y: 250 };
    const anchor = captureAnchor(before, Math.max(viewportWidth, before.maxWidth), scroll, cursor);

    for (const scale of [0.5, 1.5, 3]) {
      const after = base.at(scale);
      const content = Math.max(viewportWidth, Math.ceil(after.maxWidth));
      const next = scrollForAnchor(after, content, { width: viewportWidth }, anchor);
      // The page fraction under the cursor is the same before and after.
      const y = next.top + cursor.y;
      const index = after.pageAt(y);
      const fraction = (y - after.topOf(index)) / after.heightOf(index);
      const y0 = scroll.top + cursor.y;
      const index0 = before.pageAt(y0);
      expect(index).toBe(index0);
      expect(fraction).toBeCloseTo((y0 - before.topOf(index0)) / before.heightOf(index0), 9);
    }
  });

  it("keeps the horizontal fraction when the content is wider than the viewport", () => {
    const before = base.at(3); // 1200 px wide pages in a 500 px viewport
    const anchor = captureAnchor(before, 1200, { left: 300, top: 0 }, { x: 100, y: 0 });
    const after = base.at(4);
    const next = scrollForAnchor(after, 1600, { width: 500 }, anchor);
    expect(next.left + 100).toBeCloseTo(((300 + 100) / 1200) * 1600, 9);
  });

  it("restores a reading position: the page and the fraction of it", () => {
    const layout = base.at(1.333);
    const next = scrollForAnchor(
      layout,
      Math.ceil(layout.maxWidth),
      { width: 1000 },
      { kind: "position", position: { page: 10, offsetInPage: 0.5 } },
    );
    expect(next.top).toBeCloseTo(layout.topOf(9) + layout.heightOf(9) / 2, 9);
    expect(next.left).toBe(0);
  });

  it("clamps a saved position that no longer fits the book", () => {
    const layout = base.at(1);
    const anchor = { kind: "position", position: { page: 9999, offsetInPage: 7 } } as const;
    const next = scrollForAnchor(layout, 400, { width: 400 }, anchor);
    expect(next.top).toBeCloseTo(layout.topOf(49) + layout.heightOf(49), 9);
  });
});
