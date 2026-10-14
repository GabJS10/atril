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
    : result?.failed
      ? t("search.failed")
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
      className="absolute top-6 left-1/2 z-30 flex w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-bar bg-pill px-4 py-2.5 text-ui text-ink-2 shadow-pill focus-within:ring-2 focus-within:ring-accent-text"
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
        className="min-w-0 flex-1 rounded-tab bg-transparent px-2 py-2 text-base text-ink outline-none placeholder:text-ink-3"
      />
      <span aria-live="polite" className="shrink-0 tabular-nums">
        {counter}
      </span>
      <button
        type="button"
        aria-label={t("search.previous")}
        onClick={() => step(true)}
        className="flex size-9 shrink-0 items-center justify-center rounded-field text-ink hover:bg-surface-3"
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={t("search.next")}
        onClick={() => step(false)}
        className="flex size-9 shrink-0 items-center justify-center rounded-field text-ink hover:bg-surface-3"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-tab px-2.5 py-2 text-ui font-medium text-ink-2 hover:text-ink"
      >
        {t("search.close")}
      </button>
    </div>
  );
}
