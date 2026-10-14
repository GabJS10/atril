import { useState } from "react";
import { useT } from "../i18n";
import { activeOutlineItem, hasOutline, type OutlineItem } from "./outline";
import { StateCard } from "../ui/StateCard";
import { SidePanel } from "./SidePanel";

/** Indentation of each level of the index (Tailwind's spacing scale). */
const INDENT = ["pl-0", "pl-4", "pl-8", "pl-12"] as const;

function indentFor(depth: number): string {
  return INDENT[Math.min(depth, INDENT.length - 1)] ?? "pl-0";
}

/**
 * The reader's index panel (DESIGN.md, paneles: opaque, a tone of its own). The entry of the current
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
            <div className={`flex items-center gap-2 py-0.5 ${indentFor(depth)}`}>
              {hasChildren ? (
                <button
                  type="button"
                  aria-expanded={!isFolded}
                  aria-label={t(isFolded ? "outline.expand" : "outline.collapse", { title: item.title })}
                  onClick={() => toggle(path)}
                  className="flex size-6 shrink-0 items-center justify-center rounded-tab text-ui text-ink-3 hover:bg-raised hover:text-ink"
                >
                  {isFolded ? "+" : "−"}
                </button>
              ) : (
                <span aria-hidden="true" className="size-6 shrink-0" />
              )}
              <button
                type="button"
                aria-current={item === active ? "true" : undefined}
                onClick={() => onGo(item)}
                className={`min-w-0 flex-1 rounded-control px-2.5 py-1.5 text-left text-base transition-colors duration-fast ease-atril hover:text-ink ${
                  item === active ? "bg-raised font-semibold text-ink" : "text-ink-2"
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
    <SidePanel label={t("outline.label")} title={t("outline.title")} onClose={onClose}>
      <nav aria-label={t("outline.title")} className="-mx-2 flex-1 overflow-y-auto px-2">
        {items === null ? (
          <p className="text-ui text-ink-2">{t("outline.loading")}</p>
        ) : hasOutline(items) ? (
          renderList(items, 0, "")
        ) : (
          <StateCard size="sm" tone="raised" title={t("outline.empty")} body={t("outline.empty.body")} />
        )}
      </nav>
    </SidePanel>
  );
}
