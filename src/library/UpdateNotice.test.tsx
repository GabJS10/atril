import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { createQueryClient, updateCheckQueryKey } from "../api/queries";
import type { Settings, UpdateCheck } from "../api/types";
import { createAppRouter } from "../router";

const RELEASE: UpdateCheck = {
  currentVersion: "1.2.0",
  latestVersion: "1.3.0",
  available: true,
  url: "https://github.com/GabJS10/atril/releases/tag/v1.3.0",
};

/** The library with no books, the given settings, and a `check_for_update` that answers with `check`. */
function mockLibrary(settings: Partial<Settings>, check: () => unknown) {
  const calls = { check: 0, opened: [] as string[] };
  mockIPC((cmd, args) => {
    switch (cmd) {
      case "get_settings":
        return {
          language: "es",
          theme: "dark",
          defaultZoom: "page_width",
          defaultViewMode: "normal",
          checkUpdates: true,
          ...settings,
        };
      case "check_for_update":
        calls.check += 1;
        return check();
      case "plugin:opener|open_url":
        calls.opened.push((args as { url: string }).url);
        return null;
      case "get_home":
        return { continueReading: [], favorites: [], favoriteCount: 0, bookCount: 0, collections: [] };
      case "list_books":
        return [];
      case "get_scan_status":
        return { running: false, found: 0 };
      case "list_library_folders":
        return [];
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  return calls;
}

function renderLibrary() {
  const queryClient = createQueryClient();
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
  render(<App router={router} queryClient={queryClient} />);
  return queryClient;
}

describe("update notice in the library", () => {
  it("offers the newer release with a download button that opens its page", async () => {
    const calls = mockLibrary({}, () => RELEASE);
    renderLibrary();
    const user = userEvent.setup();

    expect(await screen.findByText("Atril 1.3.0 está disponible")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Descargar" }));

    await waitFor(() => expect(calls.opened).toEqual([RELEASE.url]));
  });

  it("says nothing when the app is up to date", async () => {
    mockLibrary({}, () => ({ ...RELEASE, latestVersion: "1.2.0", available: false }));
    const queryClient = renderLibrary();

    expect(await screen.findByText("Tu biblioteca está vacía")).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryData(updateCheckQueryKey)).toBeDefined());
    expect(screen.queryByText(/está disponible/)).toBeNull();
  });

  it("does not ask GitHub when the startup check is off", async () => {
    const calls = mockLibrary({ checkUpdates: false }, () => RELEASE);
    renderLibrary();

    expect(await screen.findByText("Tu biblioteca está vacía")).toBeInTheDocument();
    expect(calls.check).toBe(0);
    expect(screen.queryByText(/está disponible/)).toBeNull();
  });

  it("hides for the rest of the session when 'Ahora no' is pressed", async () => {
    mockLibrary({}, () => RELEASE);
    renderLibrary();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Ahora no" }));

    expect(screen.queryByText("Atril 1.3.0 está disponible")).toBeNull();
  });

  it("shows nothing when the startup check cannot reach GitHub", async () => {
    mockLibrary({}, () => {
      throw { code: "network", message: "offline" };
    });
    const queryClient = renderLibrary();

    expect(await screen.findByText("Tu biblioteca está vacía")).toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryState(updateCheckQueryKey)?.status).toBe("error"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/está disponible/)).toBeNull();
  });
});
