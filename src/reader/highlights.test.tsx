import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Highlight } from "../api/types";
import { highlightsKey, useHighlightActions, useHighlights } from "./highlights";
import { useHighlightSession } from "./useHighlightSession";

const BOOK = "book-1";
const RECT: [number, number, number, number] = [72, 690, 200, 704];

function saved(id: string, overrides: Partial<Highlight> = {}): Highlight {
  return {
    id,
    bookId: BOOK,
    page: 1,
    rects: [RECT],
    text: "Primera linea",
    color: "ochre",
    note: null,
    createdAt: "2026-10-11T12:00:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
    ...overrides,
  };
}

function setup(handler: (cmd: string, args: unknown) => unknown) {
  const calls: { cmd: string; args: unknown }[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    return handler(cmd, args);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, calls, wrapper };
}

describe("highlight actions", () => {
  it("shows a new highlight at once and replaces it with the saved one", async () => {
    const { wrapper, calls, client } = setup((cmd) => {
      if (cmd === "list_highlights") return [];
      if (cmd === "create_highlight") return saved("real-1");
      return null;
    });
    const onError = vi.fn();
    const { result } = renderHook(() => useHighlightActions(BOOK, onError), { wrapper });
    await act(async () => {
      await client.fetchQuery({ queryKey: highlightsKey(BOOK), queryFn: () => [] });
    });

    let savedId = "";
    await act(async () => {
      savedId = await result.current.create({
        page: 1,
        rects: [RECT],
        text: "Primera linea",
        color: "ochre",
      });
    });

    expect(savedId).toBe("real-1");
    expect(calls.find((call) => call.cmd === "create_highlight")?.args).toEqual({
      highlight: { bookId: BOOK, page: 1, rects: [RECT], text: "Primera linea", color: "ochre" },
    });
    expect(client.getQueryData<Highlight[]>(highlightsKey(BOOK))?.map((item) => item.id)).toEqual(["real-1"]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("removes a highlight the backend refuses and reports it", async () => {
    const { wrapper } = setup((cmd) => {
      if (cmd === "list_highlights") return [];
      if (cmd === "create_highlight") throw { code: "db", message: "locked" };
      return null;
    });
    const onError = vi.fn();
    const { result } = renderHook(
      () => ({ list: useHighlights(BOOK), actions: useHighlightActions(BOOK, onError) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    await act(async () => {
      await result.current.actions
        .create({ page: 1, rects: [RECT], text: "x", color: "sage" })
        .catch(() => undefined);
    });

    expect(result.current.list.data).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("changes the colour at once and sends update_highlight", async () => {
    const { wrapper, calls, client } = setup((cmd) => {
      if (cmd === "update_highlight") return saved("h1", { color: "slate" });
      return null;
    });
    client.setQueryData(highlightsKey(BOOK), [saved("h1")]);
    const { result } = renderHook(() => useHighlightActions(BOOK, vi.fn()), { wrapper });

    await act(async () => {
      await result.current.update("h1", { color: "slate" });
    });

    expect(calls.find((call) => call.cmd === "update_highlight")?.args).toEqual({
      highlightId: "h1",
      color: "slate",
    });
    expect(client.getQueryData<Highlight[]>(highlightsKey(BOOK))?.[0]?.color).toBe("slate");
  });

  it("clears a note with null and keeps the colour", async () => {
    const { wrapper, calls, client } = setup((cmd) =>
      cmd === "update_highlight" ? saved("h1", { note: null }) : null,
    );
    client.setQueryData(highlightsKey(BOOK), [saved("h1", { note: "antes" })]);
    const { result } = renderHook(() => useHighlightActions(BOOK, vi.fn()), { wrapper });

    await act(async () => {
      await result.current.update("h1", { note: null });
    });

    expect(calls.find((call) => call.cmd === "update_highlight")?.args).toEqual({
      highlightId: "h1",
      note: null,
    });
  });

  it("removes a highlight at once and deletes it in the backend", async () => {
    const { wrapper, calls, client } = setup(() => null);
    client.setQueryData(highlightsKey(BOOK), [saved("h1"), saved("h2")]);
    const { result } = renderHook(() => useHighlightActions(BOOK, vi.fn()), { wrapper });

    await act(async () => {
      await result.current.remove("h1");
    });

    expect(calls.find((call) => call.cmd === "delete_highlight")?.args).toEqual({ highlightId: "h1" });
    expect(client.getQueryData<Highlight[]>(highlightsKey(BOOK))?.map((item) => item.id)).toEqual(["h2"]);
  });
});

describe("highlight editor", () => {
  it("closes once the note is saved, and sends the note", async () => {
    const { wrapper, calls } = setup((cmd) => {
      if (cmd === "list_highlights") return [saved("h1")];
      if (cmd === "update_highlight") return saved("h1", { note: "Una nota" });
      return null;
    });
    const { result } = renderHook(() => useHighlightSession(BOOK), { wrapper });
    await waitFor(() => expect(result.current.highlights).toHaveLength(1));

    const anchor = { left: 72, top: 100, right: 200, bottom: 120, width: 128, height: 20 } as DOMRect;
    act(() => result.current.handlers.onHighlightPress("h1", anchor));
    expect(result.current.editing?.highlight.id).toBe("h1");

    act(() => result.current.editor.saveNote("h1", "Una nota"));

    expect(result.current.editing).toBeNull();
    await waitFor(() =>
      expect(calls.find((call) => call.cmd === "update_highlight")?.args).toEqual({
        highlightId: "h1",
        note: "Una nota",
      }),
    );
  });
});
