import { describe, expect, it, vi } from "vitest";
import type { EngineOutlineItem } from "../api/types";
import { activeOutlineItem, followOutlineItem, fromEngineOutline, type OutlineItem } from "./outline";

describe("activeOutlineItem", () => {
  const tree: OutlineItem[] = [
    {
      title: "A",
      dest: { page: 1, y: null },
      page: 1,
      items: [{ title: "A.1", dest: { page: 3, y: null }, page: 3, items: [] }],
    },
    { title: "B", dest: { page: 8, y: null }, page: 8, items: [] },
  ];

  it("is the last entry that starts on or before the page, in reading order", () => {
    expect(activeOutlineItem(tree, 1)?.title).toBe("A");
    expect(activeOutlineItem(tree, 5)?.title).toBe("A.1");
    expect(activeOutlineItem(tree, 8)?.title).toBe("B");
    expect(activeOutlineItem(tree, 60)?.title).toBe("B");
  });

  it("is null before the first entry", () => {
    expect(
      activeOutlineItem([{ title: "Tarde", dest: { page: 9, y: null }, page: 9, items: [] }], 2),
    ).toBeNull();
    expect(activeOutlineItem([], 2)).toBeNull();
  });
});

describe("fromEngineOutline", () => {
  const entry = (
    title: string,
    page: number | null,
    children: EngineOutlineItem[] = [],
    extra: Partial<EngineOutlineItem> = {},
  ): EngineOutlineItem => ({ title, page, y: page === null ? null : 40, uri: null, children, ...extra });

  it("turns each entry into a page destination and keeps the nesting", () => {
    const items = fromEngineOutline([entry("Parte 1", 3, [entry(" Capítulo 1 ", 5)])]);

    expect(items).toEqual([
      {
        title: "Parte 1",
        dest: { page: 3, y: 40 },
        page: 3,
        uri: null,
        items: [{ title: "Capítulo 1", dest: { page: 5, y: 40 }, page: 5, uri: null, items: [] }],
      },
    ]);
  });

  it("keeps a heading with no destination when entries below it lead somewhere, and drops an empty one", () => {
    const items = fromEngineOutline([
      entry("Sin destino", null, [entry("Dentro", 7)]),
      entry("Vacío", null),
      entry("Vacío con hijos vacíos", null, [entry("Nada", null)]),
    ]);

    expect(items.map((item) => item.title)).toEqual(["Sin destino"]);
    expect(items[0]?.dest).toBeNull();
    expect(items[0]?.page).toBeNull();
    expect(items[0]?.items[0]?.page).toBe(7);
  });

  it("keeps an external entry as a link with no place in the book", () => {
    const [item] = fromEngineOutline([entry("Web", null, [], { uri: "https://example.org" })]);

    expect(item).toMatchObject({ title: "Web", dest: null, page: null, uri: "https://example.org" });
  });

  it("names an untitled entry with a dash, as the pdf.js index does", () => {
    expect(fromEngineOutline([entry("  ", 1)])[0]?.title).toBe("—");
  });

  it("feeds the active entry of the panel", () => {
    const items = fromEngineOutline([entry("A", 1), entry("B", 10, [entry("B1", 20)])]);
    expect(activeOutlineItem(items, 25)?.title).toBe("B1");
    expect(activeOutlineItem(items, 12)?.title).toBe("B");
  });
});

describe("followOutlineItem", () => {
  const item = (extra: Partial<OutlineItem>): OutlineItem => ({
    title: "x",
    dest: null,
    page: null,
    items: [],
    ...extra,
  });

  it("goes to the place of an entry", () => {
    const goTo = vi.fn();
    const openExternal = vi.fn();
    followOutlineItem(item({ dest: { page: 4, y: 10 } }), { goTo, openExternal });
    expect(goTo).toHaveBeenCalledWith({ page: 4, y: 10 });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("opens the link of an entry outside, and only an allowed one", () => {
    const goTo = vi.fn();
    const openExternal = vi.fn();
    followOutlineItem(item({ uri: "mailto:a@b.org" }), { goTo, openExternal });
    followOutlineItem(item({ uri: "file:///etc/passwd" }), { goTo, openExternal });
    expect(openExternal.mock.calls).toEqual([["mailto:a@b.org"]]);
    expect(goTo).not.toHaveBeenCalled();
  });

  it("does nothing for a heading that leads nowhere", () => {
    const goTo = vi.fn();
    const openExternal = vi.fn();
    followOutlineItem(item({}), { goTo, openExternal });
    expect(goTo).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
