import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import { useOpenedBook } from "./useOpenedBook";

function Probe({ bookId }: { bookId: string }) {
  const opened = useOpenedBook(bookId);
  return <p>{opened.data ? `page ${opened.data.readingState?.page}` : "loading"}</p>;
}

describe("useOpenedBook", () => {
  it("reads the saved position again when the book is reopened, not the one of the first visit", async () => {
    // The reading state the backend holds moves on while the book is read: p. 1 at the first open, p. 250 later.
    let saved = 1;
    let opens = 0;
    mockIPC((command) => {
      if (command !== "open_book") return null;
      opens += 1;
      return { book: { id: "abc" }, readingState: { page: saved } };
    });
    const client = new QueryClient();
    const wrap = (bookId: string | null) => (
      <QueryClientProvider client={client}>
        {bookId ? <Probe bookId={bookId} /> : <p>library</p>}
      </QueryClientProvider>
    );

    const view = render(wrap("abc"));
    await waitFor(() => expect(screen.getByText("page 1")).toBeInTheDocument());

    // The reader is closed (back to the library), after the user read on to p. 250.
    saved = 250;
    view.rerender(wrap(null));
    await waitFor(() => expect(screen.getByText("library")).toBeInTheDocument());

    view.rerender(wrap("abc"));
    await waitFor(() => expect(screen.getByText("page 250")).toBeInTheDocument());
    expect(opens).toBe(2);
  });

  it("does not refetch while the reader stays open", async () => {
    let opens = 0;
    mockIPC((command) => {
      if (command !== "open_book") return null;
      opens += 1;
      return { book: { id: "abc" }, readingState: { page: 1 } };
    });
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <Probe bookId="abc" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("page 1")).toBeInTheDocument());
    window.dispatchEvent(new Event("focus"));
    view.rerender(
      <QueryClientProvider client={client}>
        <Probe bookId="abc" />
      </QueryClientProvider>,
    );
    expect(opens).toBe(1);
  });
});
