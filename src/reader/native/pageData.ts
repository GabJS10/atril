import { useEffect, useState } from "react";
import { getPageLinks, getPageText } from "../../api/tauri";
import type { PageLink, TextWord } from "../../api/types";

/** Pages whose text and links are kept after they leave the view, so scrolling back does not ask again. */
const KEPT_PAGES = 24;

export type PageDataSource = {
  words: (page: number) => Promise<TextWord[]>;
  links: (page: number) => Promise<PageLink[]>;
  /** The data already loaded, for a first render without a flash. */
  cachedWords: (page: number) => TextWord[] | undefined;
  cachedLinks: (page: number) => PageLink[] | undefined;
};

type Fetch<T> = (bookId: string, page: number) => Promise<T>;

/** Remembers the last `KEPT_PAGES` answers and shares a request that is already on its way. A failure is not remembered. */
function memo<T>(bookId: string, fetch: Fetch<T>) {
  const done = new Map<number, T>();
  const pending = new Map<number, Promise<T>>();
  return {
    peek: (page: number) => {
      const value = done.get(page);
      if (value !== undefined) {
        // Most recently used goes last.
        done.delete(page);
        done.set(page, value);
      }
      return value;
    },
    get: (page: number): Promise<T> => {
      const value = done.get(page);
      if (value !== undefined) return Promise.resolve(value);
      let request = pending.get(page);
      if (!request) {
        request = fetch(bookId, page).then(
          (result) => {
            pending.delete(page);
            done.set(page, result);
            while (done.size > KEPT_PAGES) done.delete(done.keys().next().value as number);
            return result;
          },
          (error: unknown) => {
            pending.delete(page);
            throw error;
          },
        );
        pending.set(page, request);
      }
      return request;
    },
  };
}

/** The text and links of the pages of one book, asked for when a page enters the view. */
export function createPageDataSource(
  bookId: string,
  fetchers: { text?: Fetch<TextWord[]>; links?: Fetch<PageLink[]> } = {},
): PageDataSource {
  const text = memo(bookId, fetchers.text ?? getPageText);
  const links = memo(bookId, fetchers.links ?? getPageLinks);
  return {
    words: text.get,
    links: links.get,
    cachedWords: text.peek,
    cachedLinks: links.peek,
  };
}

/**
 * What a mounted page holds of its text and links: null until they arrive (or if they never do). The component that
 * calls it is mounted for one page of one source, so the state needs no key.
 */
export function usePageData(
  source: PageDataSource,
  page: number,
): { words: TextWord[] | null; links: PageLink[] | null } {
  const [words, setWords] = useState<TextWord[] | null>(() => source.cachedWords(page) ?? null);
  const [links, setLinks] = useState<PageLink[] | null>(() => source.cachedLinks(page) ?? null);

  useEffect(() => {
    let alive = true;
    source.words(page).then(
      (loaded) => alive && setWords(loaded),
      () => undefined,
    );
    source.links(page).then(
      (loaded) => alive && setLinks(loaded),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [source, page]);

  return { words, links };
}
