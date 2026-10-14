import { useState } from "react";
import { useT } from "../i18n";
import { BookFilterBar } from "./BookFilters";
import { DEFAULT_FILTERS, filtersToQuery, type BookFilters } from "./filters";
import { BookGrid } from "./BookGrid";
import { EmptyScope, NoFilterResults } from "./EmptyStates";
import { LoadError } from "./Notices";
import { countLabel } from "./format";
import { useBooks } from "./queries";
import type { BooksScope } from "./booksScope";

/** "Todos los libros", "Favoritos" and "En curso" (the sidebar's three lists): the books with filters and sort. */
export function BooksScreen({ scope }: { scope: BooksScope }) {
  const t = useT();
  const [filters, setFilters] = useState<BookFilters>(DEFAULT_FILTERS);
  const books = useBooks({
    ...filtersToQuery(filters),
    status: scope === "reading" ? "reading" : filters.status,
    favoritesOnly: scope === "favorites" || undefined,
  });

  const title =
    scope === "favorites"
      ? t("library.favorites")
      : scope === "reading"
        ? t("library.filter.reading")
        : t("nav.all");
  // A status filter that leaves nothing is not the same as an empty list: it can be lifted.
  const filtered = scope !== "reading" && filters.status !== undefined;
  const empty = filtered ? (
    <NoFilterResults onClear={() => setFilters({ ...filters, status: undefined })} />
  ) : (
    <EmptyScope scope={scope} />
  );

  return (
    <main className="flex min-h-screen flex-col gap-8 px-14 pt-9 pb-18">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-serif text-page leading-none font-semibold">{title}</h1>
        <p className="text-base text-ink-2">{books.data ? countLabel(books.data.length, t) : ""}</p>
      </header>
      <BookFilterBar filters={filters} onChange={setFilters} showStatus={scope !== "reading"} />
      {books.isError ? (
        <LoadError
          title={t("library.error")}
          body={t("library.error.body")}
          onRetry={() => void books.refetch()}
        />
      ) : null}
      {books.data ? <BookGrid books={books.data} empty={empty} /> : null}
    </main>
  );
}
