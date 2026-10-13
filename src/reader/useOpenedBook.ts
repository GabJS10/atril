import { useQuery } from "@tanstack/react-query";
import { openBook } from "../api/tauri";

/**
 * The book and its saved reading state, read when the reader opens. Never kept after the reader closes
 * (`gcTime: 0`): the reading state changes while the book is read, so a copy kept from the first visit would put the
 * reader back where it was when the book was opened, not where the reader left it. While the reader stays open the
 * data is not refetched (`staleTime: Infinity`), since the start position is only used once.
 */
export function useOpenedBook(bookId: string) {
  return useQuery({
    queryKey: ["book", bookId],
    queryFn: () => openBook(bookId),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}
