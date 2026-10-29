import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Highlight, HighlightGroup } from "../api/types";
import {
  highlightGroupsKey,
  highlightsKey,
  useHighlightActions,
  useHighlightGroupActions,
  useHighlightGroups,
  useHighlights,
} from "./highlights";
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
    groupId: null,
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

function group(id: string, position: number, name = "Capítulo 3"): HighlightGroup {
  return { id, bookId: BOOK, name, position, createdAt: "2026-10-01T10:00:00Z" };
}

describe("highlight groups in the cache", () => {
  it("puts a new highlight in its group at once, and sends the group", async () => {
    const { wrapper, calls, client } = setup((cmd) =>
      cmd === "create_highlight" ? saved("real-1", { groupId: "c1" }) : null,
    );
    client.setQueryData(highlightsKey(BOOK), []);
    const { result } = renderHook(() => useHighlightActions(BOOK, vi.fn()), { wrapper });

    let request: Promise<string> | undefined;
    act(() => {
      request = result.current.create({ page: 1, rects: [RECT], text: "x", color: "ochre", groupId: "c1" });
    });
    expect(client.getQueryData<Highlight[]>(highlightsKey(BOOK))?.[0]?.groupId).toBe("c1");

    await act(async () => {
      await request;
    });
    expect(calls.find((call) => call.cmd === "create_highlight")?.args).toEqual({
      highlight: { bookId: BOOK, page: 1, rects: [RECT], text: "x", color: "ochre", groupId: "c1" },
    });
  });

  it("moves a highlight to a group at once and sends groupId", async () => {
    const { wrapper, calls, client } = setup((cmd) =>
      cmd === "update_highlight" ? saved("h1", { groupId: "c1" }) : null,
    );
    client.setQueryData(highlightsKey(BOOK), [saved("h1")]);
    const { result } = renderHook(() => useHighlightActions(BOOK, vi.fn()), { wrapper });

    await act(async () => {
      await result.current.update("h1", { groupId: "c1" });
    });

    expect(calls.find((call) => call.cmd === "update_highlight")?.args).toEqual({
      highlightId: "h1",
      groupId: "c1",
    });
    expect(client.getQueryData<Highlight[]>(highlightsKey(BOOK))?.[0]?.groupId).toBe("c1");
  });

  it("takes a highlight back to 'Sin grupo' with null, and keeps its group when only the colour changes", async () => {
    // The backend answers with the group the patch asks for; without groupId it keeps c1.
    const { wrapper, calls, client } = setup((_cmd, args) => {
      const patch = args as { groupId?: string | null };
      return saved("h1", { groupId: patch.groupId === undefined ? "c1" : patch.groupId });
    });
    client.setQueryData(highlightsKey(BOOK), [saved("h1", { groupId: "c1" })]);
    const { result } = renderHook(() => useHighlightActions(BOOK, vi.fn()), { wrapper });

    await act(async () => {
      await result.current.update("h1", { color: "sienna" });
    });
    expect(calls.find((call) => call.cmd === "update_highlight")?.args).toEqual({
      highlightId: "h1",
      color: "sienna",
    });
    expect(client.getQueryData<Highlight[]>(highlightsKey(BOOK))?.[0]?.groupId).toBe("c1");

    await act(async () => {
      await result.current.update("h1", { groupId: null });
    });
    expect(calls.findLast((call) => call.cmd === "update_highlight")?.args).toEqual({
      highlightId: "h1",
      groupId: null,
    });
    expect(client.getQueryData<Highlight[]>(highlightsKey(BOOK))?.[0]?.groupId).toBeNull();
  });
});

describe("highlight group actions", () => {
  it("loads the groups of the book by position", async () => {
    const { wrapper } = setup((cmd) =>
      cmd === "list_highlight_groups" ? [group("c1", 0), group("c2", 1, "Capítulo 4")] : null,
    );
    const { result } = renderHook(() => useHighlightGroups(BOOK), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((item) => item.name)).toEqual(["Capítulo 3", "Capítulo 4"]);
  });

  it("creates a group after the backend answers, and adds it last", async () => {
    const { wrapper, calls, client } = setup((cmd) =>
      cmd === "create_highlight_group" ? group("c2", 1, "Notas del capítulo 3") : null,
    );
    client.setQueryData(highlightGroupsKey(BOOK), [group("c1", 0)]);
    const onError = vi.fn();
    const { result } = renderHook(() => useHighlightGroupActions(BOOK, onError), { wrapper });

    let created: HighlightGroup | null = null;
    await act(async () => {
      created = await result.current.create("Notas del capítulo 3");
    });

    expect(calls.find((call) => call.cmd === "create_highlight_group")?.args).toEqual({
      bookId: BOOK,
      name: "Notas del capítulo 3",
    });
    expect(created).toEqual(group("c2", 1, "Notas del capítulo 3"));
    expect(client.getQueryData<HighlightGroup[]>(highlightGroupsKey(BOOK))?.map((item) => item.id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("resolves a refused create to null and reports it, without changing the list", async () => {
    const { wrapper, client } = setup((cmd) => {
      if (cmd === "create_highlight_group") throw { code: "invalid_input", message: "name" };
      return null;
    });
    client.setQueryData(highlightGroupsKey(BOOK), [group("c1", 0)]);
    const onError = vi.fn();
    const { result } = renderHook(() => useHighlightGroupActions(BOOK, onError), { wrapper });

    let created: HighlightGroup | null | undefined;
    await act(async () => {
      created = await result.current.create("   x");
    });

    expect(created).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<HighlightGroup[]>(highlightGroupsKey(BOOK))?.map((item) => item.id)).toEqual([
      "c1",
    ]);
  });

  it("renames a group at once and sends the new name", async () => {
    const { wrapper, calls, client } = setup((cmd) =>
      cmd === "rename_highlight_group" ? group("c1", 0, "Capítulo 3, la guerra") : null,
    );
    client.setQueryData(highlightGroupsKey(BOOK), [group("c1", 0)]);
    const { result } = renderHook(() => useHighlightGroupActions(BOOK, vi.fn()), { wrapper });

    await act(async () => {
      await result.current.rename("c1", "Capítulo 3, la guerra");
    });

    expect(calls.find((call) => call.cmd === "rename_highlight_group")?.args).toEqual({
      groupId: "c1",
      name: "Capítulo 3, la guerra",
    });
    expect(client.getQueryData<HighlightGroup[]>(highlightGroupsKey(BOOK))?.[0]?.name).toBe(
      "Capítulo 3, la guerra",
    );
  });

  it("deletes a group at once; its highlights go to 'Sin grupo' and the others keep theirs", async () => {
    const { wrapper, calls, client } = setup(() => null);
    client.setQueryData(highlightGroupsKey(BOOK), [group("c1", 0), group("c2", 1, "Capítulo 4")]);
    client.setQueryData(highlightsKey(BOOK), [
      saved("h1", { groupId: "c1" }),
      saved("h2", { groupId: "c2" }),
      saved("h3", { groupId: null }),
    ]);
    const { result } = renderHook(() => useHighlightGroupActions(BOOK, vi.fn()), { wrapper });

    await act(async () => {
      await result.current.remove("c1");
    });

    expect(calls.find((call) => call.cmd === "delete_highlight_group")?.args).toEqual({ groupId: "c1" });
    expect(client.getQueryData<HighlightGroup[]>(highlightGroupsKey(BOOK))?.map((item) => item.id)).toEqual([
      "c2",
    ]);
    expect(
      client.getQueryData<Highlight[]>(highlightsKey(BOOK))?.map((item) => [item.id, item.groupId]),
    ).toEqual([
      ["h1", null],
      ["h2", "c2"],
      ["h3", null],
    ]);
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
