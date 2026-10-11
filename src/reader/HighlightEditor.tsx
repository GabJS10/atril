import { useState } from "react";
import type { Highlight, HighlightColor } from "../api/types";
import { useT } from "../i18n";
import { floatingPosition, PIGMENT_COLOR, PIGMENT_KEY, PIGMENTS } from "./highlightPresentation";

const EDITOR_WIDTH = 300;

/** Editor of one highlight: its colour, its note, and deleting it. Escape closes it. */
export function HighlightEditor({
  highlight,
  anchor,
  focusNote,
  onColor,
  onNote,
  onDelete,
  onClose,
}: {
  highlight: Highlight;
  anchor: DOMRect;
  focusNote: boolean;
  onColor: (color: HighlightColor) => void;
  onNote: (text: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [text, setText] = useState(highlight.note ?? "");
  const { left, top } = floatingPosition(anchor, EDITOR_WIDTH, 260);

  return (
    <div
      role="dialog"
      aria-label={t("highlight.editor")}
      style={{ left, top, width: EDITOR_WIDTH }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="fixed z-20 flex flex-col gap-4 border border-line bg-surface-2 p-4 text-ui text-ink"
    >
      <div className="flex items-center justify-between">
        {PIGMENTS.map((color) => (
          <button
            key={color}
            type="button"
            aria-pressed={highlight.color === color}
            aria-label={t(PIGMENT_KEY[color])}
            onClick={() => onColor(color)}
            className="flex h-6 w-6 items-center justify-center rounded-full"
          >
            <span
              aria-hidden="true"
              className={`block h-[22px] w-[22px] rounded-full ${highlight.color === color ? "ring-1 ring-ink" : ""}`}
              style={{ background: PIGMENT_COLOR[color] }}
            />
          </button>
        ))}
        <button type="button" onClick={onClose} className="text-ink-2">
          {t("highlight.close")}
        </button>
      </div>
      <label className="flex flex-col gap-2">
        <span className="sr-only">{t("highlight.noteLabel")}</span>
        <textarea
          autoFocus={focusNote}
          value={text}
          maxLength={10_000}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          className="resize-none border border-line bg-canvas p-2 text-base text-ink"
        />
      </label>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNote(text)}
          className="border border-line-strong px-3 py-1.5 font-medium text-ink"
        >
          {t("highlight.saveNote")}
        </button>
        <button type="button" onClick={onDelete} className="text-ink-2 underline underline-offset-4">
          {t("highlight.delete")}
        </button>
      </div>
    </div>
  );
}
