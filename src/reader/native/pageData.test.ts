import { describe, expect, it, vi } from "vitest";
import type { PageLink, TextWord } from "../../api/types";
import { createPageDataSource } from "./pageData";

const word = (text: string): TextWord => ({ text, rect: [0, 0, 1, 1], lineEnd: false, blockEnd: false });

function source() {
  const text = vi.fn((_book: string, page: number) => Promise.resolve([word(`p${page}`)]));
  const links = vi.fn((_book: string, _page: number) => Promise.resolve([] as PageLink[]));
  return { text, links, data: createPageDataSource("book", { text, links }) };
}

describe("createPageDataSource", () => {
  it("asks the engine for a page by book and page, once", async () => {
    const { text, data } = source();
    expect(await data.words(3)).toEqual([word("p3")]);
    expect(await data.words(3)).toEqual([word("p3")]);
    expect(text).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledWith("book", 3);
  });

  it("shares a request that is already on its way", async () => {
    const { text, data } = source();
    const [a, b] = await Promise.all([data.words(2), data.words(2)]);
    expect(a).toBe(b);
    expect(text).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failure", async () => {
    const text = vi
      .fn<(book: string, page: number) => Promise<TextWord[]>>()
      .mockRejectedValueOnce({ code: "internal", message: "x" })
      .mockResolvedValueOnce([word("ok")]);
    const data = createPageDataSource("book", { text });
    await expect(data.words(1)).rejects.toMatchObject({ code: "internal" });
    expect(await data.words(1)).toEqual([word("ok")]);
  });

  it("keeps the last pages and forgets the oldest", async () => {
    const { text, data } = source();
    for (let page = 1; page <= 30; page += 1) await data.words(page);
    expect(data.cachedWords(30)).toBeDefined();
    expect(data.cachedWords(1)).toBeUndefined();
    await data.words(1);
    expect(text).toHaveBeenCalledTimes(31);
  });

  it("keeps a page that is read again in preference to older ones", async () => {
    const { data } = source();
    for (let page = 1; page <= 24; page += 1) await data.words(page);
    data.cachedWords(1);
    await data.words(25);
    expect(data.cachedWords(1)).toBeDefined();
    expect(data.cachedWords(2)).toBeUndefined();
  });

  it("keeps text and links apart", async () => {
    const { text, links, data } = source();
    await data.links(4);
    expect(links).toHaveBeenCalledWith("book", 4);
    expect(text).not.toHaveBeenCalled();
    expect(data.cachedLinks(4)).toEqual([]);
    expect(data.cachedWords(4)).toBeUndefined();
  });
});
