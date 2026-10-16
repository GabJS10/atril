import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppError } from "../api/types";
import { useLocaleStore } from "../i18n";
import { folderErrorKey, useAddFolder } from "./actions";
import { FolderNotice } from "./Notices";

/** Answers the folder dialog with `picked` and `add_library_folder` with `addError` (or a folder). */
function mockFolderPick(picked: string | null, addError?: AppError) {
  const added: string[] = [];
  mockIPC((cmd, args) => {
    switch (cmd) {
      case "plugin:dialog|open":
        return picked;
      case "add_library_folder": {
        const path = (args as { path: string }).path;
        added.push(path);
        if (addError) throw addError;
        return { id: "f1", path, addedAt: "2026-10-01T10:00:00Z" };
      }
      case "list_library_folders":
        return [];
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
  return added;
}

/** A button that adds a folder through the real hook, next to the notice the screens show. */
function AddFolderHarness() {
  const addFolder = useAddFolder();
  return (
    <>
      <button type="button" onClick={() => addFolder.mutate()}>
        Añadir carpeta
      </button>
      <FolderNotice />
    </>
  );
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AddFolderHarness />
    </QueryClientProvider>,
  );
  return client;
}

describe("useAddFolder", () => {
  // The copy under test is Spanish; the test setup only pins the language after each test.
  beforeEach(() => useLocaleStore.getState().setLanguage("es"));

  it("shows the folder and the reason when the backend refuses it", async () => {
    const added = mockFolderPick("/home/x/libros/a.pdf", {
      code: "invalid_input",
      message: "not a directory",
    });
    renderHarness();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Añadir carpeta" }));

    expect(added).toEqual(["/home/x/libros/a.pdf"]);
    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain("«a.pdf»");
    expect(notice.textContent).toContain("No es una carpeta que Atril pueda vigilar.");
    expect(notice.textContent).not.toContain("not a directory");
  });

  it("uses the generic reason for an unknown error code", async () => {
    mockFolderPick("/libros/Viajes", { code: "db", message: "database is locked" });
    renderHarness();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Añadir carpeta" }));

    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain("«Viajes»");
    expect(notice.textContent).toContain("Atril no pudo añadirla.");
  });

  it("clears the notice when the user closes it", async () => {
    mockFolderPick("/libros/x", { code: "not_found", message: "missing" });
    renderHarness();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Añadir carpeta" }));
    await user.click(await screen.findByRole("button", { name: "Cerrar" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("does nothing when the dialog is cancelled", async () => {
    const added = mockFolderPick(null);
    const client = renderHarness();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Añadir carpeta" }));

    await waitFor(() => expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe("success"));
    expect(added).toEqual([]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(client.getQueryData(folderErrorKey) ?? null).toBeNull();
  });
});
