import { mockIPC } from "@tauri-apps/api/mocks";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNativeOutline } from "./useNativeOutline";

describe("useNativeOutline", () => {
  it("loads the index of the book from the engine and turns it into the panel's entries", async () => {
    const calls: unknown[] = [];
    mockIPC((cmd, payload) => {
      calls.push([cmd, payload]);
      return [{ title: "Capítulo 1", page: 3, y: 20, uri: null, children: [] }];
    });

    const { result } = renderHook(() => useNativeOutline("book"));
    expect(result.current).toBeNull();

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual([
      { title: "Capítulo 1", dest: { page: 3, y: 20 }, page: 3, uri: null, items: [] },
    ]);
    expect(calls).toEqual([["get_outline", { bookId: "book" }]]);
  });

  it("treats a book whose index cannot be read as having none", async () => {
    mockIPC(() => {
      throw { code: "invalid_pdf", message: "x" };
    });
    const { result } = renderHook(() => useNativeOutline("book"));
    await waitFor(() => expect(result.current).toEqual([]));
  });
});
