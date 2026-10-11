import { renderHook } from "@testing-library/react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vitest";
import { useReadingPosition } from "./useReadingPosition";
import type { ReadingStateInput } from "../api/types";

const state: ReadingStateInput = {
  page: 150,
  offsetInPage: 0.5,
  zoom: "page_width",
  viewMode: "normal",
  pageCount: 400,
};

function recordSaves(): { cmd: string; args: unknown }[] {
  mockWindows("main");
  const saves: { cmd: string; args: unknown }[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "save_reading_state") saves.push({ cmd, args });
    return null;
  });
  return saves;
}

describe("useReadingPosition", () => {
  it("saves the pending position when the reader is left", async () => {
    const saves = recordSaves();
    const { result, unmount } = renderHook(() => useReadingPosition("abc"));
    result.current.enable();
    result.current.update(state);

    unmount();
    await vi.waitFor(() => expect(saves).toHaveLength(1));

    expect(saves).toEqual([{ cmd: "save_reading_state", args: { bookId: "abc", state } }]);
  });

  it("saves the pending position when the window loses focus", async () => {
    const saves = recordSaves();
    const { result } = renderHook(() => useReadingPosition("abc"));
    result.current.enable();
    result.current.update(state);

    window.dispatchEvent(new Event("blur"));
    await vi.waitFor(() => expect(saves).toHaveLength(1));

    expect(result.current.isDirty()).toBe(false);
  });

  it("does nothing on leave when no position changed", async () => {
    const saves = recordSaves();
    const { result, unmount } = renderHook(() => useReadingPosition("abc"));
    result.current.enable();

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(saves).toEqual([]);
  });
});
