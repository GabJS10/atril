import type { UnlistenFn } from "@tauri-apps/api/event";
import type { SearchDone, SearchProgress, SearchStarted } from "../../api/types";
import type { FindOptions, FindResult } from "../viewerTypes";
import { type MatchRef, SearchResults, stepMatch } from "./searchModel";

/** The part of the backend the search needs (`api/tauri.ts` has the real one). */
export type SearchApi = {
  search: (bookId: string, query: string) => Promise<SearchStarted>;
  cancel: (searchId: string) => Promise<unknown>;
  onProgress: (handler: (event: SearchProgress) => void) => Promise<UnlistenFn>;
  onDone: (handler: (event: SearchDone) => void) => Promise<UnlistenFn>;
};

export type SearchHooks = {
  /** The page the reader is on: the search starts at its first match from there. */
  readingPage: () => number;
  /** The counter for the search bar. */
  onResult: (result: FindResult) => void;
  /** The matches or the one in focus changed: repaint. */
  onChange: () => void;
  /** The match in focus changed because of the search (not for every progress event): show it. */
  reveal: (match: MatchRef) => void;
};

/** A new query waits this long for more typing before the search starts. */
export const SEARCH_DEBOUNCE_MS = 120;
/** The counter and the marks are refreshed at most this often while matches stream in. */
export const SEARCH_FLUSH_MS = 80;

type Event = { kind: "progress"; event: SearchProgress } | { kind: "done"; event: SearchDone };

/**
 * One search at a time over the book (roadmap R2.2). `search_document` answers with an id at once and the matches come
 * as events, page by page; a new query or `dispose` cancels the running search, and events of any other id are
 * ignored. An event can overtake the answer that carries its id, so events seen while the answer is pending are
 * kept and played back once the id is known.
 *
 * Plain TypeScript: the viewer owns one and repaints from `onChange`.
 */
export class SearchController {
  results = new SearchResults();
  /** The number of the match in focus, or null before the first one is chosen. */
  active: number | null = null;

  private query = "";
  private searchId: string | null = null;
  /** Counts the searches started; an answer from an older one is cancelled when it arrives. */
  private generation = 0;
  private awaitingId = false;
  private early: Event[] = [];
  private done = false;
  private failed = false;
  private startPage = 1;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private listening: Promise<UnlistenFn[]> | null = null;
  private disposed = false;

  constructor(
    private readonly api: SearchApi,
    private readonly bookId: string,
    private readonly hooks: SearchHooks,
  ) {}

  find(query: string, options: FindOptions = {}): void {
    if (this.disposed) return;
    if (query.trim() === "") {
      this.clear();
      return;
    }
    if (options.again && query === this.query) {
      // Enter before the typed query started searching: start it now.
      if (this.debounce !== undefined) this.startNow();
      else this.step(options.findPrevious ? -1 : 1);
      return;
    }
    this.cancelRunning();
    this.reset();
    this.query = query;
    this.startPage = this.hooks.readingPage();
    this.hooks.onResult({ current: 0, total: 0, notFound: false });
    this.hooks.onChange();
    window.clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.startNow(), SEARCH_DEBOUNCE_MS);
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.debounce);
    window.clearTimeout(this.flushTimer);
    this.cancelRunning();
    const listening = this.listening;
    this.listening = null;
    void listening
      ?.then((unlisten) => {
        for (const stop of unlisten) {
          // Stopping can fail (the listener is already gone, or there is no backend); there is nothing to do about it.
          try {
            void Promise.resolve(stop()).catch(() => undefined);
          } catch {
            // Same.
          }
        }
      })
      .catch(() => undefined);
  }

  /** Clears the marks and the counter (an empty query, or the search bar closed). */
  private clear(): void {
    window.clearTimeout(this.debounce);
    this.debounce = undefined;
    this.cancelRunning();
    this.reset();
    this.query = "";
    this.hooks.onResult({ current: 0, total: 0, notFound: false });
    this.hooks.onChange();
  }

  private reset(): void {
    this.generation += 1;
    this.searchId = null;
    this.awaitingId = false;
    this.early = [];
    this.done = false;
    this.failed = false;
    this.active = null;
    this.results = new SearchResults();
    window.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }

  private cancelRunning(): void {
    window.clearTimeout(this.debounce);
    this.debounce = undefined;
    // A search whose id has not arrived yet is cancelled when it does (see startNow).
    if (this.searchId !== null && !this.done) this.api.cancel(this.searchId).catch(() => undefined);
  }

  private ensureListening(): void {
    this.listening ??= Promise.all([
      this.api.onProgress((event) => this.receive({ kind: "progress", event })),
      this.api.onDone((event) => this.receive({ kind: "done", event })),
    ]);
    // A failed subscription (no backend) leaves the search without results; the next query tries again.
    this.listening.catch(() => {
      this.listening = null;
    });
  }

  private startNow(): void {
    window.clearTimeout(this.debounce);
    this.debounce = undefined;
    if (this.disposed) return;
    this.ensureListening();
    const generation = this.generation;
    this.awaitingId = true;
    this.api.search(this.bookId, this.query).then(
      ({ searchId }) => {
        if (generation !== this.generation || this.disposed) {
          this.api.cancel(searchId).catch(() => undefined);
          return;
        }
        this.searchId = searchId;
        this.awaitingId = false;
        const early = this.early;
        this.early = [];
        for (const event of early) this.receive(event);
      },
      () => {
        if (generation !== this.generation) return;
        // The backend refused the query (too long, unreadable book): nothing to find, and the bar says so.
        this.awaitingId = false;
        this.done = true;
        this.failed = true;
        this.flush();
      },
    );
  }

  private receive(event: Event): void {
    if (this.disposed) return;
    if (this.awaitingId) {
      this.early.push(event);
      return;
    }
    if (event.event.searchId !== this.searchId) return;
    if (event.kind === "progress") this.onProgress(event.event);
    else this.onDone(event.event);
  }

  private onProgress(event: SearchProgress): void {
    this.results.add(
      event.page,
      event.matches.map((match) => match.rects),
    );
    if (this.active === null) {
      const first = this.results.firstFrom(this.startPage);
      if (first !== null) this.focus(first);
    }
    this.scheduleFlush();
  }

  private onDone(event: SearchDone): void {
    this.done = true;
    this.failed = event.error !== null && event.error !== undefined;
    if (this.active === null && this.results.total > 0 && !event.cancelled) this.focus(0);
    window.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.flush();
  }

  /** Puts a match in focus and shows it. */
  private focus(number: number): void {
    this.active = number;
    const match = this.results.at(number);
    if (match) this.hooks.reveal(match);
  }

  private step(direction: 1 | -1): void {
    const next = stepMatch(this.active, direction, this.results.total);
    if (next === null) return;
    this.focus(next);
    this.flush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, SEARCH_FLUSH_MS);
  }

  private flush(): void {
    this.hooks.onResult({
      current: this.active === null ? 0 : this.active + 1,
      total: this.results.total,
      notFound: this.done && !this.failed && this.results.total === 0,
      ...(this.failed ? { failed: true } : {}),
    });
    this.hooks.onChange();
  }
}
