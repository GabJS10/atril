import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { createQueryClient } from "../api/queries";
import type { Settings, UpdateCheck } from "../api/types";
import { createAppRouter } from "../router";

const UP_TO_DATE: UpdateCheck = {
  currentVersion: "1.2.0",
  latestVersion: "1.2.0",
  available: false,
  url: "https://github.com/GabJS10/atril/releases/tag/v1.2.0",
};

const NEWER: UpdateCheck = { ...UP_TO_DATE, latestVersion: "1.3.0", available: true };

/**
 * Answers the settings and update commands and records every update_settings patch. `checks.answer` decides what
 * check_for_update returns; `checks.calls` counts the requests.
 */
function mockSettings(initial: Settings) {
  let current = initial;
  const patches: Partial<Settings>[] = [];
  const checks = { calls: 0, answer: (): unknown => UP_TO_DATE };
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
      case "check_for_update":
        checks.calls += 1;
        return checks.answer();
      case "plugin:app|version":
        return "1.2.0";
      case "list_library_folders":
        return [];
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  return { patches, checks };
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
  checkUpdates: false,
} as Settings;

describe("settings screen", () => {
  it("switches the app to the white cube theme", async () => {
    const { patches } = mockSettings(DEFAULTS);
    renderSettings();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Cubo blanco" }));

    await waitFor(() => expect(patches).toEqual([{ theme: "light" }]));
    expect(screen.getByRole("button", { name: "Cubo blanco" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("changes the default paper for books opened from now on", async () => {
    const { patches } = mockSettings(DEFAULTS);
    renderSettings();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Sepia" }));

    await waitFor(() => expect(patches).toEqual([{ defaultViewMode: "sepia" }]));
  });

  it("changes the default zoom", async () => {
    const { patches } = mockSettings(DEFAULTS);
    renderSettings();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Página entera" }));

    await waitFor(() => expect(patches).toEqual([{ defaultZoom: "page_fit" }]));
  });

  it("turns the startup check off and back on", async () => {
    const { patches } = mockSettings({ ...DEFAULTS, checkUpdates: true });
    renderSettings();
    const user = userEvent.setup();
    const toggle = await screen.findByRole("switch", { name: "Buscar actualizaciones al iniciar" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    await waitFor(() => expect(patches).toEqual([{ checkUpdates: false }]));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Buscar actualizaciones al iniciar" })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    await user.click(screen.getByRole("switch", { name: "Buscar actualizaciones al iniciar" }));
    await waitFor(() => expect(patches).toEqual([{ checkUpdates: false }, { checkUpdates: true }]));
  });

  it("checks now even when the startup check is off, and shows each result", async () => {
    const { checks } = mockSettings({ ...DEFAULTS, checkUpdates: false });
    renderSettings();
    const user = userEvent.setup();
    const section = await screen.findByRole("region", { name: "Actualizaciones" });
    expect(await within(section).findByText("Versión instalada: 1.2.0")).toBeInTheDocument();
    const check = within(section).getByRole("button", { name: "Comprobar ahora" });

    await user.click(check);
    expect(await within(section).findByText("Atril está al día.")).toBeInTheDocument();
    expect(checks.calls).toBe(1);

    checks.answer = () => NEWER;
    await user.click(check);
    expect(await within(section).findByText("Atril 1.3.0 está disponible.")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Descargar" })).toBeInTheDocument();
    expect(checks.calls).toBe(2);

    checks.answer = () => {
      throw { code: "network", message: "offline" };
    };
    await user.click(check);
    expect(await within(section).findByText("No se pudo comprobar. Revisa tu conexión.")).toBeInTheDocument();
    expect(checks.calls).toBe(3);
  });

  it("names a Windows library folder by its last name and shows the full path", async () => {
    mockIPC((cmd) => {
      switch (cmd) {
        case "get_settings":
          return DEFAULTS;
        case "list_library_folders":
          return [{ id: "f1", path: "C:\\Users\\x\\Libros", addedAt: "2026-01-10T10:00:00Z" }];
        default:
          throw new Error(`unexpected command ${cmd}`);
      }
    });
    renderSettings();

    expect(await screen.findByText("Libros")).toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\x\\Libros")).toBeInTheDocument();
  });
});
