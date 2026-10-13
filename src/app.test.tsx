import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { createQueryClient } from "./api/queries";
import type { Settings } from "./api/types";
import { createAppRouter } from "./router";

/** Answers for an empty library, so the screens that mount with the app have data. */
const emptyLibrary = {
  get_home: () => ({ continueReading: [], favorites: [], favoriteCount: 0, bookCount: 0, collections: [] }),
  list_books: () => [],
  get_scan_status: () => ({ running: false, found: 0 }),
  list_library_folders: () => [],
};

function mockSettings(language: Settings["language"], theme: Settings["theme"] = "dark") {
  mockCommands({
    get_settings: () =>
      ({
        language,
        theme,
        defaultZoom: "page_width",
        defaultViewMode: "normal",
      }) satisfies Settings,
  });
}

const book = {
  id: "abc123",
  title: "Meditaciones",
  author: null,
  fileName: "meditaciones.pdf",
  pageCount: null,
  fileUrl: "atril://localhost/book/abc123",
  coverUrl: null,
  favorite: false,
  missing: false,
  scanState: "pending",
  currentPage: null,
  progress: null,
  addedAt: "2026-10-11T12:00:00Z",
  lastOpenedAt: null,
};

/** Answers the given commands on top of an empty library and Spanish settings; anything else fails the test. */
function mockCommands(handlers: Record<string, (args: unknown) => unknown>) {
  const answers: Record<string, (args: unknown) => unknown> = {
    get_settings: () => ({
      language: "es",
      theme: "dark",
      defaultZoom: "page_width",
      defaultViewMode: "normal",
    }),
    ...emptyLibrary,
    ...handlers,
  };
  mockIPC((cmd, args) => {
    const handler = answers[cmd];
    if (handler) return handler(args);
    throw new Error(`unexpected command ${cmd}`);
  });
}

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  return render(<App router={router} queryClient={createQueryClient()} />);
}

describe("app shell", () => {
  it("shows the empty library at / in Spanish when the setting is 'es'", async () => {
    mockSettings("es");
    renderAt("/");

    expect(await screen.findByText("Tu biblioteca está vacía")).toBeInTheDocument();
  });

  it("switches the copy to English when the setting is 'en'", async () => {
    mockSettings("en");
    renderAt("/");

    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("applies the light theme ('cubo blanco') from settings", async () => {
    mockSettings("es", "light");
    renderAt("/");

    expect(await screen.findByText("Tu biblioteca está vacía")).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  });

  it("keeps the dark theme by default", async () => {
    mockSettings("es", "dark");
    renderAt("/");

    expect(await screen.findByText("Tu biblioteca está vacía")).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });

  it("tells the user when the book file is missing", async () => {
    mockCommands({
      open_book: () => {
        throw { code: "file_missing", message: "file gone" };
      },
    });
    renderAt("/read/abc123");

    expect(await screen.findByText("El archivo ya no está en su ruta.")).toBeInTheDocument();
  });

  it("opens a PDF chosen in the dialog and goes to the reader", async () => {
    const calls: string[] = [];
    mockCommands({
      "plugin:dialog|open": () => "/home/libros/meditaciones.pdf",
      open_path: () => book,
      open_book: (args) => {
        calls.push(JSON.stringify(args));
        throw { code: "file_missing", message: "stop before the viewer" };
      },
    });
    renderAt("/");

    await userEvent.click(await screen.findByRole("button", { name: "Abrir un PDF suelto" }));

    expect(await screen.findByText("El archivo ya no está en su ruta.")).toBeInTheDocument();
    expect(calls).toEqual([JSON.stringify({ bookId: "abc123" })]);
  });

  it("stays in the library when the dialog is cancelled", async () => {
    mockCommands({ "plugin:dialog|open": () => null });
    renderAt("/");

    await userEvent.click(await screen.findByRole("button", { name: "Abrir un PDF suelto" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Abrir un PDF suelto" })).toBeEnabled());
    expect(screen.getByText("Tu biblioteca está vacía")).toBeInTheDocument();
  });

  it("renders a localized not-found page for unknown routes", async () => {
    mockSettings("es");
    renderAt("/no-existe");

    expect(await screen.findByText("Página no encontrada")).toBeInTheDocument();
  });
});
