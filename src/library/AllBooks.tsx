import { useT } from "../i18n";
import { BookCard } from "./Cover";
import { countLabel } from "./format";
import { SectionLabel } from "./sections";
import type { Book, BookSort, BookStatus } from "../api/types";

export type AllBooksFilters = {
  status: BookStatus | undefined;
  sort: BookSort;
  favoritesOnly: boolean;
};

const STATUSES: {
  value: BookStatus | undefined;
  key: "library.filter.all" | "library.filter.unread" | "library.filter.reading" | "library.filter.finished";
}[] = [
  { value: undefined, key: "library.filter.all" },
  { value: "unread", key: "library.filter.unread" },
  { value: "reading", key: "library.filter.reading" },
  { value: "finished", key: "library.filter.finished" },
];

const SORTS: {
  value: BookSort;
  key:
    | "library.sort.title"
    | "library.sort.author"
    | "library.sort.added"
    | "library.sort.lastOpened"
    | "library.sort.progress";
}[] = [
  { value: "title", key: "library.sort.title" },
  { value: "author", key: "library.sort.author" },
  { value: "added", key: "library.sort.added" },
  { value: "last_opened", key: "library.sort.lastOpened" },
  { value: "progress", key: "library.sort.progress" },
];

/** Todos: the whole library with status filter, sort and the header search. */
export function AllBooks({
  books,
  filters,
  onChange,
  searching,
  label,
  hasFilters,
}: {
  books: Book[];
  filters: AllBooksFilters;
  onChange: (next: AllBooksFilters) => void;
  searching: boolean;
  label: string;
  hasFilters: boolean;
}) {
  const t = useT();
  const chip = (active: boolean) =>
    `border px-3 py-1.5 text-ui ${active ? "border-ink bg-ink text-ink-inverse" : "border-line text-ink-2"}`;

  return (
    <section className="flex flex-col gap-8">
      <SectionLabel number="04">{label}</SectionLabel>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="group" aria-label={t("library.filter.all")} className="flex flex-wrap gap-2">
          {STATUSES.map((status) => (
            <button
              key={status.key}
              type="button"
              aria-pressed={filters.status === status.value}
              className={chip(filters.status === status.value)}
              onClick={() => onChange({ ...filters, status: status.value })}
            >
              {t(status.key)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-3 text-ui text-ink-2">
          <span className="sr-only">{t("library.sort.label")}</span>
          <select
            value={filters.sort}
            onChange={(event) => onChange({ ...filters, sort: event.target.value as BookSort })}
            className="border border-line bg-canvas px-3 py-1.5 text-ui text-ink"
          >
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>
                {t(sort.key)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {books.length === 0 ? (
        <p className="text-ink-2">{hasFilters || searching ? t("library.noResults") : null}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-6 gap-y-10">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}
      <p className="text-ui text-ink-3">{countLabel(books.length, t)}</p>
    </section>
  );
}
