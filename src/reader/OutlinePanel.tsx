import { useState } from "react";
import { useT } from "../i18n";
import { activeOutlineItem, hasOutline, type OutlineItem } from "./outline";

/** Indentation of each level of the index (Tailwind's spacing scale). */
const INDENT = ["pl-0", "pl-4", "pl-8", "pl-12"] as const;

function indentFor(depth: number): string {
  return INDENT[Math.min(depth, INDENT.length - 1)] ?? "pl-0";
}

/**
 * The reader's index panel (DESIGN.md, paneles: 320 px, opaque, a 1 px line on the left). The entry of the current
 * section is marked; a click goes to the entry; each entry with children folds.
 */
export function OutlinePanel({
  items,
  currentPage,
  onGo,
  onClose,
}: {
  /** The index, or null while it loads. */
  items: OutlineItem[] | null;
  currentPage: number;
  onGo: (item: OutlineItem) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const active = items ? activeOutlineItem(items, currentPage) : null;

  const toggle = (path: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderList = (list: OutlineItem[], depth: number, parent: string) => (
    <ul className="flex flex-col">
      {list.map((item, index) => {
        const path = `${parent}/${index}`;
        const isFolded = folded.has(path);
        const hasChildren = item.items.length > 0;
        return (
          <li key={path}>
            <div className={`flex items-center gap-2 py-1 ${indentFor(depth)}`}>
              {hasChildren ? (
                <button
                  type="button"
                  aria-expanded={!isFolded}
                  aria-label={t(isFolded ? "outline.expand" : "outline.collapse", { title: item.title })}
                  onClick={() => toggle(path)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center text-ui text-ink-3"
                >
                  {isFolded ? "+" : "−"}
                </button>
              ) : (
                <span aria-hidden="true" className="h-5 w-5 shrink-0" />
              )}
              <button
                type="button"
                aria-current={item === active ? "true" : undefined}
                onClick={() => onGo(item)}
                className={`min-w-0 flex-1 text-left text-base ${
                  item === active ? "font-medium text-ink" : "text-ink-2"
                }`}
              >
                <span className="block truncate">{item.title}</span>
              </button>
              {item.page !== null ? (
                <span className="shrink-0 text-ui text-ink-3">
                  {t("outline.page", { page: String(item.page) })}
                </span>
              ) : null}
            </div>
            {hasChildren && !isFolded ? renderList(item.items, depth + 1, path) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <aside
      aria-label={t("outline.label")}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="absolute bottom-14 right-0 top-0 flex w-80 flex-col border-l border-line bg-surface text-base text-ink"
    >
      <header className="flex items-center justify-between px-5 pb-3 pt-5">
        <h2 className="text-label font-medium uppercase tracking-label text-ink-2">{t("outline.title")}</h2>
        <button type="button" onClick={onClose} className="text-ui text-ink-2 underline underline-offset-4">
          {t("highlight.close")}
        </button>
      </header>
      <nav aria-label={t("outline.title")} className="flex-1 overflow-y-auto px-5 pb-5">
        {items === null ? (
          <p className="text-ui text-ink-2">{t("outline.loading")}</p>
        ) : hasOutline(items) ? (
          renderList(items, 0, "")
        ) : (
          <p className="text-ui text-ink-2">{t("outline.empty")}</p>
        )}
      </nav>
    </aside>
  );
}
