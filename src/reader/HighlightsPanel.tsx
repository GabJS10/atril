import { useState } from "react";
import { useT } from "../i18n";
import type { Highlight } from "../api/types";
import { chipButton } from "../ui/buttons";
import { displayHighlightText, PIGMENT_COLOR, PIGMENT_KEY } from "./highlightPresentation";
import { groupByPage } from "./highlightList";
import { StateCard } from "../ui/StateCard";
import { SidePanel } from "./SidePanel";

/**
 * The reader's side panel with every highlight of the book, as cards in reading order (DESIGN.md, paneles). A click
 * on a card goes to the highlight; "Con nota" keeps the ones with a note; the export chip writes the book as Markdown.
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
  const [onlyNotes, setOnlyNotes] = useState(false);
  const ordered = groupByPage(highlights).flatMap((group) => group.items);
  const shown = onlyNotes ? ordered.filter((highlight) => highlight.note) : ordered;

  return (
    <SidePanel
      label={t("highlightPanel.label")}
      title={t("highlightPanel.title")}
      count={highlights.length}
      onClose={onClose}
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={!onlyNotes}
          onClick={() => setOnlyNotes(false)}
          className={chipButton(!onlyNotes, true)}
        >
          {t("highlightPanel.all")}
        </button>
        <button
          type="button"
          aria-pressed={onlyNotes}
          onClick={() => setOnlyNotes(true)}
          className={chipButton(onlyNotes, true)}
        >
          {t("highlightPanel.withNote")}
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className={`${chipButton(false, true)} ml-auto disabled:opacity-60`}
        >
          {exporting ? t("highlightPanel.exporting") : t("highlightPanel.export")}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto">
        {highlights.length === 0 ? (
          <StateCard
            size="sm"
            tone="raised"
            title={t("highlightPanel.empty")}
            body={t("highlightPanel.empty.body")}
          />
        ) : shown.length === 0 ? (
          <StateCard
            size="sm"
            tone="raised"
            title={t("highlightPanel.noNotes")}
            body={t("highlightPanel.noNotes.body")}
          />
        ) : (
          shown.map((highlight) => (
            <button
              key={highlight.id}
              type="button"
              onClick={() => onJump(highlight)}
              className="flex gap-3.5 rounded-tile bg-raised p-4 text-left transition-colors duration-fast ease-atril hover:bg-surface-2"
            >
              <span
                aria-hidden="true"
                className="w-1 flex-none rounded-xs"
                style={{ background: PIGMENT_COLOR[highlight.color] }}
              />
              <span className="flex min-w-0 flex-col gap-2">
                <span className="text-label font-semibold tracking-label text-ink-3 uppercase">
                  {t("highlightPanel.cardLabel", {
                    color: t(PIGMENT_KEY[highlight.color]),
                    page: String(highlight.page),
                  })}
                </span>
                <span className="font-serif text-title-sm leading-[1.35] font-medium text-ink italic">
                  {displayHighlightText(highlight.text)}
                </span>
                {highlight.note ? (
                  <span className="rounded-tab bg-surface-2 px-2.5 py-2 text-ui text-ink-2">
                    {highlight.note}
                  </span>
                ) : null}
              </span>
            </button>
          ))
        )}
      </div>
    </SidePanel>
  );
}
