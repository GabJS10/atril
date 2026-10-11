import { useT } from "../i18n";
import type { Highlight } from "../api/types";
import { PIGMENT_COLOR } from "./highlightPresentation";
import { groupByPage } from "./highlightList";

/**
 * The reader's side panel with every highlight of the book, grouped by page (DESIGN.md, paneles: 320 px, opaque,
 * a 1 px line on the left). A click on a highlight goes to it; the export button writes the book as Markdown.
 */
export function HighlightsPanel({
  highlights,
  exporting,
  onJump,
  onExport,
  onClose,
}: {
  highlights: Highlight[];
  exporting: boolean;
  onJump: (highlight: Highlight) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const groups = groupByPage(highlights);

  return (
    <aside
      aria-label={t("highlightPanel.label")}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="absolute bottom-14 right-0 top-0 flex w-80 flex-col border-l border-line bg-surface text-base text-ink"
    >
      <header className="flex items-center justify-between px-5 pb-3 pt-5">
        <h2 className="text-label font-medium uppercase tracking-label text-ink-2">
          {t("highlightPanel.title")} · {highlights.length}
        </h2>
        <button type="button" onClick={onClose} className="text-ui text-ink-2 underline underline-offset-4">
          {t("highlight.close")}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {groups.length === 0 ? (
          <p className="text-ui text-ink-2">{t("highlightPanel.empty")}</p>
        ) : (
          groups.map((group) => (
            <section key={group.page} className="mt-4 border-t border-line-strong pt-3">
              <h3 className="text-label font-medium uppercase tracking-label text-ink-3">
                {t("highlightPanel.page", { page: String(group.page) })}
              </h3>
              <ul className="mt-2 flex flex-col">
                {group.items.map((highlight) => (
                  <li key={highlight.id}>
                    <button
                      type="button"
                      onClick={() => onJump(highlight)}
                      className="flex w-full gap-3 py-2 text-left"
                    >
                      <span
                        aria-hidden="true"
                        className="w-[3px] shrink-0 self-stretch"
                        style={{ background: PIGMENT_COLOR[highlight.color] }}
                      />
                      <span className="min-w-0">
                        <span className="block text-base text-ink">{highlight.text}</span>
                        {highlight.note ? (
                          <span className="mt-1 block text-ui text-ink-2">{highlight.note}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <footer className="border-t border-line px-5 py-4">
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="w-full border border-line-strong px-3 py-2 text-base font-medium text-ink disabled:text-ink-3"
        >
          {exporting ? t("highlightPanel.exporting") : t("highlightPanel.export")}
        </button>
      </footer>
    </aside>
  );
}
