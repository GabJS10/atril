import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { createQueryClient } from "../api/queries";
import type { Settings } from "../api/types";
import { createAppRouter } from "../router";

/** Answers the settings commands and records every update_settings patch. */
function mockSettings(initial: Settings) {
  let current = initial;
  const patches: Partial<Settings>[] = [];
  mockIPC((cmd, args) => {
    switch (cmd) {
      case "get_settings":
        return current;
      case "update_settings": {
        const patch = (args as { patch: Partial<Settings> }).patch;
        patches.push(patch);
        current = { ...current, ...patch };
        return current;
      }
      case "list_library_folders":
        return [];
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  return patches;
}

function renderSettings() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/settings"] }));
  return render(<App router={router} queryClient={createQueryClient()} />);
}

const DEFAULTS: Settings = {
  language: "es",
  theme: "dark",
  defaultZoom: "page_width",
  defaultViewMode: "normal",
} as Settings;

describe("settings screen", () => {
  it("switches the app to the white cube theme", async () => {
    const patches = mockSettings(DEFAULTS);
    renderSettings();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Cubo blanco" }));

    await waitFor(() => expect(patches).toEqual([{ theme: "light" }]));
    expect(screen.getByRole("button", { name: "Cubo blanco" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("changes the default paper for books opened from now on", async () => {
    const patches = mockSettings(DEFAULTS);
    renderSettings();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Sepia" }));

    await waitFor(() => expect(patches).toEqual([{ defaultViewMode: "sepia" }]));
  });

  it("changes the default zoom", async () => {
    const patches = mockSettings(DEFAULTS);
    renderSettings();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Página entera" }));

    await waitFor(() => expect(patches).toEqual([{ defaultZoom: "page_fit" }]));
  });
});
