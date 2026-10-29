import { describe, expect, it } from "vitest";
import type { Highlight, HighlightGroup } from "../api/types";
import {
  groupByPage,
  groupHighlights,
  scrollTopToReveal,
  sortHighlights,
  suggestedExportName,
} from "./highlightList";

function highlight(
  id: string,
  page: number,
  top: number,
  createdAt = "2026-10-11T12:00:00Z",
  groupId: string | null = null,
): Highlight {
  return {
    id,
    bookId: "b",
    page,
    rects: [[72, top - 20, 200, top]],
    text: id,
    color: "ochre",
    note: null,
    groupId,
    createdAt,
    updatedAt: createdAt,
  };
}

function group(id: string, position: number, createdAt = "2026-10-01T10:00:00Z"): HighlightGroup {
  return { id, bookId: "b", name: `Grupo ${id}`, position, createdAt };
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

describe("sortHighlights", () => {
  // The first page was made first, the last page last: the two orders are opposite here.
  const firstPage = highlight("first-page", 1, 100, "2026-10-11T10:00:00Z");
  const middle = highlight("middle", 5, 100, "2026-10-11T11:00:00Z");
  const lastPage = highlight("last-page", 9, 100, "2026-10-11T12:00:00Z");

  it("puts the newest first by default order 'recent', whatever the page", () => {
    expect(sortHighlights([firstPage, lastPage, middle], "recent").map((item) => item.id)).toEqual([
      "last-page",
      "middle",
      "first-page",
    ]);
  });

  it("orders by the reading order of the book for 'page'", () => {
    expect(sortHighlights([lastPage, firstPage, middle], "page").map((item) => item.id)).toEqual([
      "first-page",
      "middle",
      "last-page",
    ]);
    const page = [highlight("p3", 3, 100), highlight("p1-low", 1, 100), highlight("p1-high", 1, 700)];
    expect(sortHighlights(page, "page").map((item) => item.id)).toEqual(["p1-high", "p1-low", "p3"]);
  });

  it("keeps the reading order of the highlights saved at the same moment", () => {
    const sameMoment = "2026-10-11T12:00:00Z";
    const sorted = sortHighlights(
      [
        highlight("page2", 2, 500, sameMoment),
        highlight("page1", 1, 500, sameMoment),
        highlight("earlier", 1, 500, "2026-10-11T09:00:00Z"),
      ],
      "recent",
    );

    expect(sorted.map((item) => item.id)).toEqual(["page1", "page2", "earlier"]);
  });

  it("does not change the list it is given", () => {
    const list = [firstPage, lastPage];
    sortHighlights(list, "recent");
    expect(list.map((item) => item.id)).toEqual(["first-page", "last-page"]);
  });
});

describe("groupHighlights", () => {
  const chapter3 = group("c3", 1);
  const chapter1 = group("c1", 0);
  const groups = [chapter3, chapter1];

  it("makes one section per group in position order, with 'Sin grupo' last", () => {
    const sections = groupHighlights(
      [
        highlight("u", 1, 100, "2026-10-11T12:00:00Z", null),
        highlight("a", 2, 100, "2026-10-11T12:00:00Z", "c3"),
        highlight("b", 3, 100, "2026-10-11T12:00:00Z", "c1"),
      ],
      groups,
      true,
    );

    expect(sections.map((section) => section.group?.id ?? null)).toEqual(["c1", "c3", null]);
    expect(sections.map((section) => section.items.map((item) => item.id))).toEqual([["b"], ["a"], ["u"]]);
  });

  it("keeps the order of the list inside each section", () => {
    const sorted = [
      highlight("new", 1, 100, "2026-10-11T13:00:00Z", "c1"),
      highlight("old", 1, 100, "2026-10-11T10:00:00Z", "c1"),
    ];

    const [section] = groupHighlights(sorted, groups, true);

    expect(section?.items.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("shows the empty groups when keepEmpty is set, so highlights can be moved there", () => {
    const sections = groupHighlights([highlight("u", 1, 100)], groups, true);

    expect(sections.map((section) => section.group?.id ?? null)).toEqual(["c1", "c3", null]);
    expect(sections[0]?.items).toEqual([]);
  });

  it("drops the empty groups when keepEmpty is not set, and the empty 'Sin grupo' always", () => {
    const sections = groupHighlights([highlight("a", 2, 100, "2026-10-11T12:00:00Z", "c3")], groups, false);

    expect(sections.map((section) => section.group?.id ?? null)).toEqual(["c3"]);
  });

  it("counts a highlight whose group is unknown as ungrouped", () => {
    const sections = groupHighlights(
      [highlight("ghost", 1, 100, "2026-10-11T12:00:00Z", "deleted")],
      groups,
      false,
    );

    expect(sections).toEqual([{ group: null, items: [expect.objectContaining({ id: "ghost" })] }]);
  });

  it("returns no sections for no highlights and no groups", () => {
    expect(groupHighlights([], [], true)).toEqual([]);
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
