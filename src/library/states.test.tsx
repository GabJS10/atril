import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createMemoryHistory } from "@tanstack/react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createQueryClient } from "../api/queries";
import type { Book, BookQuery, Collection, HomeData } from "../api/types";
import { createAppRouter } from "../router";

function book(overrides: Partial<Book> & { id: string; title: string }): Book {
  return {
    author: null,
    fileName: `${overrides.id}.pdf`,
    pageCount: 100,
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

const aleph = book({ id: "a1", title: "El Aleph", author: "Borges" });
const room: Collection = { id: "c1", name: "Filosofía", position: 0, bookCount: 0, sampleBooks: [] };

function home(overrides: Partial<HomeData> = {}): HomeData {
  return {
    continueReading: [],
    favorites: [],
    favoriteCount: 0,
    bookCount: 1,
    collections: [],
    ...overrides,
  };
}

type Handlers = Record<string, (args: unknown) => unknown>;

/** Answers the library commands with the given overrides; anything not answered fails the test. */
function mockApp(handlers: Handlers = {}) {
  const answers: Handlers = {
    get_settings: () => ({
      language: "es",
      theme: "dark",
      defaultZoom: "page_width",
      defaultViewMode: "normal",
      checkUpdates: false,
    }),
    get_home: () => home(),
    get_scan_status: () => ({ running: false, found: 0 }),
    list_books: () => [aleph],
    list_library_folders: () => [],
    list_highlights: () => [],
    ...handlers,
  };
  mockIPC((cmd, args) => {
    const handler = answers[cmd];
    if (!handler) throw new Error(`unexpected command ${cmd}`);
    return handler(args);
  });
}

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  return render(<App router={router} queryClient={createQueryClient()} />);
}

const query = (args: unknown) => (args as { query: BookQuery }).query;

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("empty library", () => {
  const empty: Handlers = {
    get_home: () => home({ bookCount: 0 }),
    list_books: () => [],
  };

  it("welcomes with both ways in and the hint about dropping files", async () => {
    mockApp(empty);
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Tu biblioteca está vacía" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir carpeta…" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Abrir un PDF…" }).length).toBeGreaterThan(0);
    expect(screen.getByText(/arrastra uno o varios PDF a esta ventana/i)).toBeInTheDocument();
  });

  it("gives the whole screen to the first scan while it runs", async () => {
    mockApp({ ...empty, get_scan_status: () => ({ running: true, found: 12 }) });
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Escaneando tu biblioteca…" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("12 encontrados");
    expect(screen.queryByRole("heading", { name: "Tu biblioteca está vacía" })).toBeNull();
  });

  it("offers the same two ways in on 'Todos los libros'", async () => {
    mockApp(empty);
    renderAt("/books/all");

    expect(await screen.findByRole("heading", { name: "Tu biblioteca está vacía" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir carpeta…" })).toBeEnabled();
  });
});

describe("library errors", () => {
  it("says the library could not be loaded and tries again", async () => {
    let calls = 0;
    mockApp({
      get_home: () => {
        calls += 1;
        throw { code: "db", message: "SQLITE_BUSY: database is locked" };
      },
    });
    renderAt("/");

    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(
      "No se pudo cargar la biblioteca",
    );
    expect(screen.queryByText(/SQLITE/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(calls).toBeGreaterThan(1));
  });

  it("explains a list that could not be loaded", async () => {
    mockApp({
      list_books: () => {
        throw { code: "db", message: "locked" };
      },
    });
    renderAt("/books/all");

    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(
      "No se pudo cargar la biblioteca",
    );
  });

  it("leaves a notice when the PDF chosen in the dialog is refused", async () => {
    mockApp({
      "plugin:dialog|open": () => "/home/libros/roto.pdf",
      open_path: () => {
        throw { code: "invalid_pdf", message: "mupdf: cannot open" };
      },
    });
    renderAt("/");

    await userEvent.click((await screen.findAllByRole("button", { name: "Abrir un PDF…" }))[0]!);

    const notice = await screen.findByText("roto.pdf · No es un PDF que se pueda leer.");
    expect(notice).toBeInTheDocument();
    expect(screen.getByText("No se pudo añadir 1 archivo:")).toBeInTheDocument();
    expect(screen.queryByText(/mupdf/)).toBeNull();
  });
});

describe("books in odd states", () => {
  it("marks a book that is still indexing on its card", async () => {
    const pending = book({ id: "p1", title: "Rayuela", scanState: "pending", pageCount: null });
    mockApp({ list_books: () => [pending], get_home: () => home({ bookCount: 1 }) });
    renderAt("/books/all");

    expect(await screen.findByText("Indexando…")).toBeInTheDocument();
  });

  it("warns about a book that could not be indexed and keeps its actions", async () => {
    const broken = book({ id: "f1", title: "Escaneo roto", scanState: "failed", pageCount: null });
    mockApp({ list_books: () => [aleph, broken], get_home: () => home({ bookCount: 2 }) });
    renderAt("/");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudo leer «Escaneo roto»");
    expect(alert).toHaveTextContent("dañado, cifrado o no es un PDF");
    expect(screen.getByRole("button", { name: "Buscar archivo…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Quitar de la biblioteca" })).toBeEnabled();
  });

  it("labels the failed book on its card", async () => {
    const broken = book({ id: "f1", title: "Escaneo roto", scanState: "failed", pageCount: null });
    mockApp({ list_books: () => [broken] });
    renderAt("/books/all");

    expect(await screen.findByText("No se pudo indexar")).toBeInTheDocument();
  });
});

describe("lists with nothing to show", () => {
  it("search without results names the search and clears it", async () => {
    mockApp({ list_books: (args) => (query(args).text ? [] : [aleph]) });
    renderAt("/");
    await screen.findByRole("searchbox", { name: "Buscar en la biblioteca" });

    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar en la biblioteca" }), "zzz");

    expect(await screen.findByText(/Ningún libro coincide con «zzz»/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Borrar la búsqueda" }));
    await waitFor(() => expect(screen.queryByText(/Ningún libro coincide/)).toBeNull());
    expect(screen.getByRole("searchbox", { name: "Buscar en la biblioteca" })).toHaveValue("");
  });

  it("Favoritos explains how to add one", async () => {
    mockApp({ list_books: () => [] });
    renderAt("/books/favorites");

    expect(await screen.findByRole("heading", { name: "Todavía no hay favoritos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todos los libros" })).toBeInTheDocument();
  });

  it("En curso says when books show up", async () => {
    mockApp({ list_books: () => [] });
    renderAt("/books/reading");

    expect(await screen.findByRole("heading", { name: "No tienes libros en curso" })).toBeInTheDocument();
  });

  it("a status filter that leaves nothing can be lifted", async () => {
    mockApp({ list_books: (args) => (query(args).status === "finished" ? [] : [aleph]) });
    renderAt("/books/all");
    await screen.findAllByText("El Aleph");

    await userEvent.click(screen.getByRole("button", { name: "Terminados" }));

    expect(await screen.findByText(/Ningún libro cumple estos filtros/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Quitar filtros" }));
    expect((await screen.findAllByText("El Aleph")).length).toBeGreaterThan(0);
  });

  it("an empty Sala says how to fill it", async () => {
    mockApp({
      get_home: () => home({ collections: [room] }),
      list_books: () => [],
    });
    renderAt("/collection/c1");

    expect(await screen.findByRole("heading", { name: "Esta Sala está vacía" })).toBeInTheDocument();
    expect(screen.getByText(/Arrastra una obra sobre la Sala/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Elegir libros" })).toBeInTheDocument();
  });

  it("a link to a deleted Sala leads back to the library", async () => {
    mockApp({ get_home: () => home({ collections: [] }), list_books: () => [] });
    renderAt("/collection/borrada");

    expect(await screen.findByRole("heading", { name: "Esta Sala ya no existe" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver a la biblioteca" })).toBeInTheDocument();
  });
});

describe("settings states", () => {
  it("explains that there are no folders", async () => {
    mockApp();
    renderAt("/settings");

    expect(await screen.findByText("Todavía no hay carpetas")).toBeInTheDocument();
    expect(screen.getByText(/Añade una carpeta con tus PDF y Atril la vigilará/)).toBeInTheDocument();
  });

  it("no longer offers to be the default PDF reader", async () => {
    mockApp();
    renderAt("/settings");
    await screen.findByText("Apariencia");

    expect(screen.queryByText(/Lector predeterminado/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Usar Atril para abrir los PDF/ })).toBeNull();
  });

  it("says the settings could not be loaded and tries again", async () => {
    let calls = 0;
    mockApp({
      get_settings: () => {
        calls += 1;
        throw { code: "db", message: "locked" };
      },
    });
    renderAt("/settings");

    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toHaveTextContent(
      "No se pudieron cargar los ajustes",
    );
    const before = calls;
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });
});
