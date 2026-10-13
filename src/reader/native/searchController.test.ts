import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchDone, SearchProgress } from "../../api/types";
import type { FindResult } from "../viewerTypes";
import { SEARCH_DEBOUNCE_MS, SEARCH_FLUSH_MS, SearchController, type SearchApi } from "./searchController";
import type { MatchRef } from "./searchModel";

type Harness = {
  controller: SearchController;
  api: SearchApi & {
    search: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  progress: (event: SearchProgress) => void;
  done: (event: SearchDone) => void;
  results: FindResult[];
  revealed: MatchRef[];
  changes: () => number;
  resolveSearch: (id: string) => void;
  unlisten: ReturnType<typeof vi.fn>;
};

function harness(readingPage = 1, searchId: string | "manual" = "s1"): Harness {
  let onProgress: (event: SearchProgress) => void = () => undefined;
  let onDone: (event: SearchDone) => void = () => undefined;
  const unlisten = vi.fn();
  let resolveNext: (value: { searchId: string }) => void = () => undefined;
  const api = {
    search: vi.fn(() =>
      searchId === "manual"
        ? new Promise<{ searchId: string }>((resolve) => {
            resolveNext = resolve;
          })
        : Promise.resolve({ searchId }),
    ),
    cancel: vi.fn(() => Promise.resolve(null)),
    onProgress: vi.fn((handler: (event: SearchProgress) => void) => {
      onProgress = handler;
      return Promise.resolve(unlisten);
    }),
    onDone: vi.fn((handler: (event: SearchDone) => void) => {
      onDone = handler;
      return Promise.resolve(unlisten);
    }),
  };
  const results: FindResult[] = [];
  const revealed: MatchRef[] = [];
  let changes = 0;
  const controller = new SearchController(api, "book", {
    readingPage: () => readingPage,
    onResult: (result) => results.push(result),
    onChange: () => {
      changes += 1;
    },
    reveal: (match) => revealed.push(match),
  });
  return {
    controller,
    api,
    progress: (event) => onProgress(event),
    done: (event) => onDone(event),
    results,
    revealed,
    changes: () => changes,
    resolveSearch: (id) => resolveNext({ searchId: id }),
    unlisten,
  };
}

const progress = (searchId: string, page: number, count = 1): SearchProgress => ({
  searchId,
  page,
  matches: Array.from({ length: count }, (_, index) => ({ rects: [[index, page, index + 1, page + 1]] })),
});
const done = (searchId: string, total: number, extra: Partial<SearchDone> = {}): SearchDone => ({
  searchId,
  total,
  pagesSearched: 10,
  cancelled: false,
  error: null,
  ...extra,
});

/** Starts the search and lets the answer with the id arrive. */
async function begin(h: Harness, query = "dios") {
  h.controller.find(query);
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SearchController", () => {
  it("waits for the typing to pause, then searches once", async () => {
    const h = harness();
    h.controller.find("d");
    await vi.advanceTimersByTimeAsync(50);
    h.controller.find("di");
    await vi.advanceTimersByTimeAsync(50);
    h.controller.find("dio");
    expect(h.api.search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(h.api.search).toHaveBeenCalledTimes(1);
    expect(h.api.search).toHaveBeenCalledWith("book", "dio");
  });

  it("puts the first match from the reading page in focus and reveals it once", async () => {
    const h = harness(5);
    await begin(h);
    h.progress(progress("s1", 2, 3));
    expect(h.revealed).toEqual([]);
    h.progress(progress("s1", 6, 2));
    h.progress(progress("s1", 8));
    h.done(done("s1", 6));
    expect(h.revealed).toHaveLength(1);
    expect(h.revealed[0]).toMatchObject({ page: 6, ordinal: 0 });
    // The match is the 4th of 6: the first three are on page 2.
    expect(h.results.at(-1)).toEqual({ current: 4, total: 6, notFound: false });
    expect(h.controller.active).toBe(3);
  });

  it("wraps to the first match when none is at or after the reading page", async () => {
    const h = harness(50);
    await begin(h);
    h.progress(progress("s1", 2));
    h.progress(progress("s1", 9));
    expect(h.revealed).toEqual([]);
    h.done(done("s1", 2));
    expect(h.revealed).toHaveLength(1);
    expect(h.revealed[0]).toMatchObject({ page: 2 });
    expect(h.results.at(-1)).toEqual({ current: 1, total: 2, notFound: false });
  });

  it("says nothing was found only when the search is done and found none", async () => {
    const h = harness();
    await begin(h);
    expect(h.results.at(-1)).toEqual({ current: 0, total: 0, notFound: false });
    h.done(done("s1", 0));
    expect(h.results.at(-1)).toEqual({ current: 0, total: 0, notFound: true });
  });

  it("goes to the next and the previous match with Enter, wrapping around", async () => {
    const h = harness();
    await begin(h);
    h.progress(progress("s1", 1, 2));
    h.progress(progress("s1", 4));
    h.done(done("s1", 3));
    expect(h.controller.active).toBe(0);

    h.controller.find("dios", { again: true });
    expect(h.controller.active).toBe(1);
    h.controller.find("dios", { again: true });
    expect(h.controller.active).toBe(2);
    expect(h.revealed.at(-1)).toMatchObject({ page: 4 });
    h.controller.find("dios", { again: true });
    expect(h.controller.active).toBe(0);
    h.controller.find("dios", { again: true, findPrevious: true });
    expect(h.controller.active).toBe(2);
    expect(h.results.at(-1)).toEqual({ current: 3, total: 3, notFound: false });
    // Stepping does not start a new search.
    expect(h.api.search).toHaveBeenCalledTimes(1);
  });

  it("ignores events of a search that is not the current one", async () => {
    const h = harness();
    await begin(h);
    h.progress(progress("other", 1, 5));
    h.done(done("other", 5));
    h.progress(progress("s1", 2));
    h.done(done("s1", 1));
    expect(h.controller.results.total).toBe(1);
    expect(h.results.at(-1)).toEqual({ current: 1, total: 1, notFound: false });
  });

  it("keeps events that arrive before the answer carrying the search id, and plays them back", async () => {
    const h = harness(1, "manual");
    h.controller.find("dios");
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    // The engine already searched page 1 and 2: the events overtake the answer.
    h.progress(progress("s9", 1, 2));
    h.progress(progress("s9", 2));
    h.progress(progress("old", 1, 9));
    expect(h.controller.results.total).toBe(0);

    h.resolveSearch("s9");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.controller.results.total).toBe(3);
    h.done(done("s9", 3));
    expect(h.results.at(-1)).toEqual({ current: 1, total: 3, notFound: false });
  });

  it("cancels the running search when the query changes, and the answer of a replaced one", async () => {
    const h = harness(1, "manual");
    h.controller.find("dios");
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    // A new query before the first answer: the first search is cancelled as soon as its id is known.
    h.controller.find("diosa");
    h.resolveSearch("first");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.api.cancel).toHaveBeenCalledWith("first");

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    h.resolveSearch("second");
    await vi.advanceTimersByTimeAsync(0);
    h.progress(progress("first", 1, 4));
    h.progress(progress("second", 1));
    expect(h.controller.results.total).toBe(1);

    // A third query cancels the second, which has an id by now and is not done.
    h.api.cancel.mockClear();
    h.controller.find("diosas");
    expect(h.api.cancel).toHaveBeenCalledWith("second");
  });

  it("does not cancel a search that already finished", async () => {
    const h = harness();
    await begin(h);
    h.done(done("s1", 0));
    h.controller.find("otra");
    expect(h.api.cancel).not.toHaveBeenCalled();
  });

  it("clears the marks and the counter for an empty query, and cancels", async () => {
    const h = harness();
    await begin(h);
    h.progress(progress("s1", 1));
    h.controller.find("   ");
    expect(h.api.cancel).toHaveBeenCalledWith("s1");
    expect(h.controller.results.total).toBe(0);
    expect(h.controller.active).toBeNull();
    expect(h.results.at(-1)).toEqual({ current: 0, total: 0, notFound: false });
    // Late events of the cleared search are ignored.
    h.progress(progress("s1", 2));
    expect(h.controller.results.total).toBe(0);
  });

  it("cancels the running search and stops listening when the viewer closes", async () => {
    const h = harness();
    await begin(h);
    h.controller.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.api.cancel).toHaveBeenCalledWith("s1");
    expect(h.unlisten).toHaveBeenCalledTimes(2);
    h.controller.find("otra");
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(h.api.search).toHaveBeenCalledTimes(1);
  });

  it("starts the search at once when Enter comes before the debounce ends", async () => {
    const h = harness();
    h.controller.find("dios");
    h.controller.find("dios", { again: true });
    expect(h.api.search).toHaveBeenCalledTimes(1);
  });

  it("tells the bar nothing was found when the backend refuses the query", async () => {
    const h = harness();
    h.api.search.mockImplementationOnce(() => Promise.reject({ code: "invalid_input", message: "x" }));
    await begin(h);
    expect(h.results.at(-1)).toEqual({ current: 0, total: 0, notFound: true });
  });

  it("refreshes the counter at most every flush interval while matches stream in", async () => {
    const h = harness();
    await begin(h);
    const before = h.results.length;
    for (let page = 1; page <= 50; page += 1) h.progress(progress("s1", page));
    expect(h.results.length).toBe(before);
    await vi.advanceTimersByTimeAsync(SEARCH_FLUSH_MS);
    expect(h.results.length).toBe(before + 1);
    expect(h.results.at(-1)?.total).toBe(50);
  });
});
