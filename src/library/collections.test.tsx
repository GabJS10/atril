import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createMemoryHistory } from "@tanstack/react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createQueryClient } from "../api/queries";
import type { Book, Collection, HomeData } from "../api/types";
import { createAppRouter } from "../router";
import { resetReaderActivity } from "./readerActivity";
import { BOOK_DRAG_TYPE } from "./Cover";

function book(id: string, title: string): Book {
  return {
    id,
    title,
    author: null,
    fileName: `${id}.pdf`,
    pageCount: 10,
    fileUrl: `atril://localhost/book/${id}`,
    coverUrl: null,
    favorite: false,
    missing: false,
    scanState: "done",
    currentPage: null,
    progress: null,
    addedAt: "2026-10-11T12:00:00Z",
    lastOpenedAt: null,
  };
}

const meditaciones = book("m1", "Meditaciones");
const filosofia: Collection = {
  id: "c1",
  name: "Filosofía",
  position: 0,
  bookCount: 1,
  sampleBooks: [meditaciones],
};

function home(): HomeData {
  return { continueReading: [], favorites: [], favoriteCount: 0, bookCount: 1, collections: [filosofia] };
}

/** Records every command the library sends after the initial load. */
function recordCommands() {
  const calls: { cmd: string; args: unknown }[] = [];
  mockIPC((cmd, args) => {
    switch (cmd) {
      case "get_settings":
        return { language: "es", theme: "dark", defaultZoom: "page_width", defaultViewMode: "normal" };
      case "get_home":
        return home();
      case "get_scan_status":
        return { running: false, found: 0 };
      case "list_books":
        return [meditaciones];
      case "list_pending_scans":
      case "list_library_folders":
        return [];
      default:
        calls.push({ cmd, args });
        return null;
    }
  });
  return calls;
}

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  return render(<App router={router} queryClient={createQueryClient()} />);
}

beforeEach(() => resetReaderActivity());

describe("Salas and removals", () => {
  it("creates a Sala with the trimmed name", async () => {
    const calls = recordCommands();
    renderAt("/");

    await userEvent.type(await screen.findByPlaceholderText("Nombre de la Sala"), "  Ensayo  ");
    await userEvent.click(screen.getByRole("button", { name: "Crear" }));

    await waitFor(() => expect(calls).toContainEqual({ cmd: "create_collection", args: { name: "Ensayo" } }));
  });

  it("adds a book to a Sala when it is dropped on the Sala", async () => {
    const calls = recordCommands();
    renderAt("/");
    const row = (await screen.findByText("Filosofía")).closest("a") as HTMLElement;

    const dataTransfer = {
      types: [BOOK_DRAG_TYPE],
      getData: (type: string) => (type === BOOK_DRAG_TYPE ? "m1" : ""),
    };
    fireEvent.dragOver(row, { dataTransfer });
    fireEvent.drop(row, { dataTransfer });

    await waitFor(() =>
      expect(calls).toContainEqual({
        cmd: "add_to_collection",
        args: { bookIds: ["m1"], collectionId: "c1" },
      }),
    );
  });

  it("deletes a Sala only after confirmation, and never deletes books", async () => {
    const calls = recordCommands();
    renderAt("/collection/c1");

    await userEvent.click(await screen.findByRole("button", { name: "Borrar Sala" }));
    expect(calls.some((call) => call.cmd === "delete_collection")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(calls).toContainEqual({ cmd: "delete_collection", args: { collectionId: "c1" } }),
    );
    expect(calls.some((call) => call.cmd === "remove_book")).toBe(false);
  });

  it("removes a book from the library only after confirmation", async () => {
    const calls = recordCommands();
    renderAt("/");

    await userEvent.click((await screen.findAllByRole("button", { name: "Opciones del libro" }))[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Quitar de la biblioteca" }));
    expect(calls.some((call) => call.cmd === "remove_book")).toBe(false);
    expect(screen.getByText(/El archivo no se borra/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(calls).toContainEqual({ cmd: "remove_book", args: { bookId: "m1" } }));
  });
});
