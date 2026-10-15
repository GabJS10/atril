import { describe, expect, it } from "vitest";
import type { Highlight } from "../api/types";
import { groupByPage, scrollTopToReveal, suggestedExportName } from "./highlightList";

function highlight(id: string, page: number, top: number, createdAt = "2026-10-11T12:00:00Z"): Highlight {
  return {
    id,
    bookId: "b",
    page,
    rects: [[72, top - 20, 200, top]],
    text: id,
    color: "ochre",
    note: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("groupByPage", () => {
  it("orders pages, and inside a page the highest line first", () => {
    const groups = groupByPage([
      highlight("low-p2", 2, 100),
      highlight("high-p1", 1, 700),
      highlight("low-p1", 1, 300),
      highlight("high-p2", 2, 600),
    ]);

    expect(groups.map((group) => group.page)).toEqual([1, 2]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["high-p1", "low-p1"]);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(["high-p2", "low-p2"]);
  });

  it("keeps creation order for highlights on the same line", () => {
    const groups = groupByPage([
      highlight("second", 1, 500, "2026-10-11T12:05:00Z"),
      highlight("first", 1, 500, "2026-10-11T12:01:00Z"),
    ]);

    expect(groups[0]?.items.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupByPage([])).toEqual([]);
  });
});

describe("suggestedExportName", () => {
  it("is the title followed by the export suffix", () => {
    expect(suggestedExportName("Pedro Páramo")).toBe("Pedro Páramo - subrayados.md");
  });

  it("replaces characters that cannot be in a file name", () => {
    expect(suggestedExportName("Cartas/a Lucilio: libro 1?")).toBe(
      "Cartas a Lucilio libro 1 - subrayados.md",
    );
  });

  it("removes the Windows path separator and the other unsafe characters", () => {
    expect(suggestedExportName("C:\\Users\\x\\Libros\\a.pdf")).toBe("C Users x Libros a.pdf - subrayados.md");
  });

  it("falls back to the app name when the title is empty", () => {
    expect(suggestedExportName("  ")).toBe("Atril - subrayados.md");
  });
});

describe("scrollTopToReveal", () => {
  it("places the highlight a third of the viewport from the top", () => {
    // Page top at 1000 px, page 800 px tall, highlight at 25 % of the page, viewport 900 px.
    expect(scrollTopToReveal(1000, 800, 25, 900)).toBe(1000 + 200 - 300);
  });

  it("never scrolls above the start of the document", () => {
    expect(scrollTopToReveal(0, 800, 0, 900)).toBe(0);
  });
});
