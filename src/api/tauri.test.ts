import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import { getSettings, isAppError, updateSettings } from "./tauri";
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
