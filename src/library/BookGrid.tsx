import type { ReactNode } from "react";
import type { Book } from "../api/types";
import { BookCard } from "./Cover";

/** A grid of covers with their captions; `empty` is shown when there are no books. */
export function BookGrid({
  books,
  empty,
  collectionId,
}: {
  books: Book[];
  /** What to show when there are no books (a StateCard). */
  empty?: ReactNode;
  collectionId?: string;
}) {
  if (books.length === 0) return empty ? <>{empty}</> : null;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-7 gap-y-10">
      {books.map((book) => (
        <BookCard key={book.id} book={book} collectionId={collectionId} />
      ))}
    </div>
  );
}
