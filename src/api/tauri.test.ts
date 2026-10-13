import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import {
  cancelSearch,
  getOutline,
  getPageLinks,
  getPageText,
  getSettings,
  isAppError,
  onSearchDone,
  onSearchProgress,
  openExternalUrl,
  searchDocument,
  updateSettings,
} from "./tauri";
import type { Settings } from "./types";

const defaults: Settings = {
  language: "system",
  theme: "dark",
  defaultZoom: "page_width",
  defaultViewMode: "normal",
};

describe("tauri wrappers", () => {
  it("getSettings invokes get_settings without arguments", async () => {
    const calls: { cmd: string; payload: unknown }[] = [];
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      return defaults;
    });

    await expect(getSettings()).resolves.toEqual(defaults);
    expect(calls).toEqual([{ cmd: "get_settings", payload: {} }]);
  });

  it("updateSettings sends only the patch under `patch` and returns the full settings", async () => {
    const calls: { cmd: string; payload: unknown }[] = [];
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      return { ...defaults, theme: "light" };
    });

    const result = await updateSettings({ theme: "light" });

    expect(result.theme).toBe("light");
    expect(calls).toEqual([{ cmd: "update_settings", payload: { patch: { theme: "light" } } }]);
  });

  it("isAppError recognises the { code, message } shape from docs/IPC.md", () => {
    expect(isAppError({ code: "db", message: "locked" })).toBe(true);
    expect(isAppError({ message: "no code" })).toBe(false);
    expect(isAppError("boom")).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

describe("engine wrappers (docs/IPC.md, v0.8)", () => {
  it("send the book and the page of each call with the names of the contract", async () => {
    const calls: { cmd: string; payload: unknown }[] = [];
    mockIPC((cmd, payload) => {
      calls.push({ cmd, payload });
      return cmd === "search_document" ? { searchId: "s1" } : [];
    });

    await getPageText("b", 3);
    await getPageLinks("b", 4);
    await getOutline("b");
    await expect(searchDocument("b", "dios")).resolves.toEqual({ searchId: "s1" });
    await cancelSearch("s1");

    expect(calls).toEqual([
      { cmd: "get_page_text", payload: { bookId: "b", page: 3 } },
      { cmd: "get_page_links", payload: { bookId: "b", page: 4 } },
      { cmd: "get_outline", payload: { bookId: "b" } },
      { cmd: "search_document", payload: { bookId: "b", query: "dios" } },
      { cmd: "cancel_search", payload: { searchId: "s1" } },
    ]);
  });

  it("hand over the payload of the search events", async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const progress: unknown[] = [];
    const finished: unknown[] = [];
    const stopProgress = await onSearchProgress((event) => progress.push(event));
    const stopDone = await onSearchDone((event) => finished.push(event));

    await emit("search://progress", { searchId: "s1", page: 2, matches: [] });
    await emit("search://done", {
      searchId: "s1",
      total: 0,
      pagesSearched: 5,
      cancelled: false,
      error: null,
    });

    expect(progress).toEqual([{ searchId: "s1", page: 2, matches: [] }]);
    expect(finished).toEqual([{ searchId: "s1", total: 0, pagesSearched: 5, cancelled: false, error: null }]);
    await stopProgress();
    await stopDone();
  });
});

describe("openExternalUrl", () => {
  it("hands http, https and mailto addresses to the opener", async () => {
    const urls: unknown[] = [];
    mockIPC((cmd, payload) => {
      if (cmd === "plugin:opener|open_url") urls.push((payload as { url: string }).url);
      return null;
    });

    await openExternalUrl("https://example.org/a");
    await openExternalUrl("http://example.org");
    await openExternalUrl("mailto:a@b.org");

    expect(urls).toEqual(["https://example.org/a", "http://example.org", "mailto:a@b.org"]);
  });

  it("rejects any other scheme without calling the opener", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return null;
    });

    for (const uri of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "ftp://example.org",
      "tel:123",
      "not a url",
      "",
    ]) {
      await expect(openExternalUrl(uri)).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(calls).toEqual([]);
  });
});
