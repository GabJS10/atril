import { useState } from "react";
import { useT } from "../i18n";
import type { FindOptions, FindResult } from "./viewerTypes";

/**
 * The search bar of the reader (roadmap 4.F2, DESIGN.md: search field without a box, a line underneath). Typing
 * searches at once; Enter goes to the next match and Shift+Enter to the previous one; Escape closes it.
 */
export function SearchBar({
  result,
  onFind,
  onClose,
}: {
  result: FindResult | null;
  onFind: (query: string, options?: FindOptions) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");

  const counter = !query
    ? ""
    : result?.notFound
      ? t("search.none")
      : result && result.total > 0
        ? t("search.count", { current: String(result.current), total: String(result.total) })
        : "";

  const step = (findPrevious: boolean) => {
    if (query) onFind(query, { again: true, findPrevious });
  };

  return (
    <div
      role="search"
      className="absolute inset-x-0 top-0 z-30 flex h-14 items-center gap-6 border-b border-line bg-surface px-8 text-ui text-ink-2"
    >
      <input
        type="search"
        autoFocus
        aria-label={t("search.label")}
        placeholder={t("search.label")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          onFind(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            step(event.shiftKey);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        className="min-w-0 flex-1 border-b border-line bg-transparent py-2 text-base text-ink outline-none placeholder:text-ink-3 focus-visible:border-ink"
      />
      <span aria-live="polite" className="shrink-0 tabular-nums">
        {counter}
      </span>
      <button
        type="button"
        aria-label={t("search.previous")}
        onClick={() => step(true)}
        className="shrink-0 text-ink hover:text-ink-2"
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={t("search.next")}
        onClick={() => step(false)}
        className="shrink-0 text-ink hover:text-ink-2"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 text-ui text-ink-2 underline underline-offset-4"
      >
        {t("search.close")}
      </button>
    </div>
  );
}
