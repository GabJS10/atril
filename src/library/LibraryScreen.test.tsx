import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createMemoryHistory } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { createQueryClient } from "../api/queries";
import type { Book, BookQuery, HomeData } from "../api/types";
import { createAppRouter } from "../router";

function book(overrides: Partial<Book> & { id: string; title: string }): Book {
  return {
    author: null,
    fileName: `${overrides.id}.pdf`,
    pageCount: 176,
    fileUrl: `atril://localhost/book/${overrides.id}`,
    coverUrl: null,
    coverColor: null,
    favorite: false,
    missing: false,
    scanState: "done",
    currentPage: null,
    progress: null,
    addedAt: "2026-10-11T12:00:00Z",
    lastOpenedAt: null,
    ...overrides,
  };
}

const meditaciones = book({
  id: "m1",
  title: "Meditaciones",
  author: "Marco Aurelio",
  progress: 0.64,
  currentPage: 112,
});
const aleph = book({ id: "a1", title: "El Aleph", author: "Borges", favorite: true });

function home(overrides: Partial<HomeData> = {}): HomeData {
  return {
    continueReading: [meditaciones],
    favorites: [aleph],
    favoriteCount: 1,
    bookCount: 2,
    collections: [],
    ...overrides,
  };
}

/** Answers the library commands; `queries` records the list_books queries it received. */
function mockLibrary(options: {
  home?: HomeData;
  books?: Book[];
  scan?: { running: boolean; found: number };
  queries?: BookQuery[];
}) {
  mockIPC((cmd, args) => {
    switch (cmd) {
      case "get_settings":
        return { language: "es", theme: "dark", defaultZoom: "page_width", defaultViewMode: "normal" };
      case "get_home":
        return options.home ?? home();
      case "get_scan_status":
        return options.scan ?? { running: false, found: 0 };
      case "list_books": {
        const query = (args as { query: BookQuery }).query;
        options.queries?.push(query);
        return options.books ?? [meditaciones, aleph];
      }
      case "list_library_folders":
        return [];
      case "list_highlights":
        return [];
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  });
}

function renderLibrary() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
  return render(<App router={router} queryClient={createQueryClient()} />);
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("library screen", () => {
  it("shows Seguir leyendo with the progress and the page", async () => {
    mockLibrary({});
    renderLibrary();

    expect(await screen.findByText("Seguir leyendo")).toBeInTheDocument();
    expect(screen.getAllByText("64 %").length).toBeGreaterThan(0);
    expect(screen.getByText("p. 112 de 176")).toBeInTheDocument();
  });

  it("shows the favourites and the whole library", async () => {
    mockLibrary({});
    renderLibrary();

    expect(await screen.findByRole("heading", { name: "Favoritos" })).toBeInTheDocument();
    expect(screen.getAllByText("El Aleph").length).toBeGreaterThan(0);
  });

  it("invites to add a folder when the library is empty", async () => {
    mockLibrary({
      home: home({ continueReading: [], favorites: [], favoriteCount: 0, bookCount: 0 }),
      books: [],
    });
    renderLibrary();

    expect(await screen.findByText("Tu biblioteca está vacía")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir carpeta…" })).toBeEnabled();
  });

  it("shows the scan status while the library is being scanned", async () => {
    mockLibrary({ scan: { running: true, found: 37 } });
    renderLibrary();

    expect(await screen.findByRole("status")).toHaveTextContent("Escaneando la biblioteca…");
    expect(screen.getByRole("status")).toHaveTextContent("37 encontrados");
  });

  it("tells the user about a book whose file is gone, and keeps the actions", async () => {
    const gone = book({ id: "g1", title: "Rayuela", author: "Cortázar", missing: true });
    mockLibrary({ books: [meditaciones, aleph, gone] });
    renderLibrary();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No encontramos el archivo de «Rayuela»");
    expect(screen.getByRole("button", { name: "Buscar archivo…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Quitar de la biblioteca" })).toBeEnabled();
  });

  it("sends the search text to the backend", async () => {
    const queries: BookQuery[] = [];
    mockLibrary({ queries });
    renderLibrary();
    await screen.findByText("Seguir leyendo");

    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar en la biblioteca" }), "aleph");

    await waitFor(() => expect(queries.some((query) => query.text === "aleph")).toBe(true));
  });
});
