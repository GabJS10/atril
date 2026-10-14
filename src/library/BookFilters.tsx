import type { BookSort, BookStatus } from "../api/types";
import type { BookFilters } from "./filters";
import { useT } from "../i18n";
import { chipButton } from "../ui/buttons";
import { ChevronDownIcon } from "../ui/icons";

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

/** Status chips and the sort selector, shared by "Todos los libros" and the Sala screen (DESIGN.md, chips). */
export function BookFilterBar({
  filters,
  onChange,
  showStatus = true,
}: {
  filters: BookFilters;
  onChange: (next: BookFilters) => void;
  showStatus?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showStatus ? (
        <div role="group" aria-label={t("library.filter.label")} className="flex flex-wrap gap-2">
          {STATUSES.map((status) => (
            <button
              key={status.key}
              type="button"
              aria-pressed={filters.status === status.value}
              className={chipButton(filters.status === status.value)}
              onClick={() => onChange({ ...filters, status: status.value })}
            >
              {t(status.key)}
            </button>
          ))}
        </div>
      ) : null}
      <label className="relative ml-auto inline-flex items-center">
        <span className="sr-only">{t("library.sort.label")}</span>
        <select
          value={filters.sort}
          onChange={(event) => onChange({ ...filters, sort: event.target.value as BookSort })}
          className="cursor-pointer appearance-none rounded-pill bg-field py-2.5 pr-10 pl-4 text-ui font-medium text-ink-2 hover:text-ink"
        >
          {SORTS.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {t(sort.key)}
            </option>
          ))}
        </select>
        <ChevronDownIcon size={16} className="pointer-events-none absolute right-3.5 text-ink-2" />
      </label>
    </div>
  );
}
