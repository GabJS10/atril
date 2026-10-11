import { describe, expect, it } from "vitest";
import { activeOutlineItem, loadOutline, type OutlineItem, type OutlineSource } from "./outline";

/** The reference of the fifth page; the fake document resolves it to index 4. */
const pageRef = { num: 10, gen: 0 };

/** A fake pdf.js document: named destinations and reference-based pages. */
function fakeSource(outline: unknown[] | null, extra: Partial<OutlineSource> = {}): OutlineSource {
  return {
    getOutline: async () => outline as never,
    getDestination: async (name: string) => (name === "cap2" ? [pageRef, { name: "XYZ" }] : null),
    getPageIndex: async (ref: object) => (ref === pageRef ? 4 : 0),
    ...extra,
  };
}

describe("loadOutline", () => {
  it("resolves explicit, named and nested destinations to 1-based pages", async () => {
    const items = await loadOutline(
      fakeSource([
        { title: "Prólogo", dest: [0, { name: "XYZ" }], items: [] },
        {
          title: "Parte 1",
          dest: [pageRef, { name: "XYZ" }],
          items: [{ title: " Capítulo 2 ", dest: "cap2", items: [] }],
        },
      ]),
    );

    expect(items.map((item) => [item.title, item.page])).toEqual([
      ["Prólogo", 1],
      ["Parte 1", 5],
    ]);
    expect(items[1]?.items.map((item) => [item.title, item.page])).toEqual([["Capítulo 2", 5]]);
  });

  it("keeps an entry whose destination cannot be read, without a page", async () => {
    const items = await loadOutline(
      fakeSource([{ title: "Roto", dest: "no-existe", items: [] }], {
        getDestination: async () => {
          throw new Error("bad destination");
        },
      }),
    );

    expect(items).toEqual([expect.objectContaining({ title: "Roto", page: null })]);
  });

  it("leaves out entries with no destination", async () => {
    const items = await loadOutline(fakeSource([{ title: "Enlace externo", dest: null, items: [] }]));

    expect(items).toEqual([]);
  });

  it("returns an empty index when the book has none", async () => {
    expect(await loadOutline(fakeSource(null))).toEqual([]);
  });
});

describe("activeOutlineItem", () => {
  const tree: OutlineItem[] = [
    { title: "A", dest: [], page: 1, items: [{ title: "A.1", dest: [], page: 3, items: [] }] },
    { title: "B", dest: [], page: 8, items: [] },
  ];

  it("is the last entry that starts on or before the page, in reading order", () => {
    expect(activeOutlineItem(tree, 1)?.title).toBe("A");
    expect(activeOutlineItem(tree, 5)?.title).toBe("A.1");
    expect(activeOutlineItem(tree, 8)?.title).toBe("B");
    expect(activeOutlineItem(tree, 60)?.title).toBe("B");
  });

  it("is null before the first entry", () => {
    expect(activeOutlineItem([{ title: "Tarde", dest: [], page: 9, items: [] }], 2)).toBeNull();
    expect(activeOutlineItem([], 2)).toBeNull();
  });
});
