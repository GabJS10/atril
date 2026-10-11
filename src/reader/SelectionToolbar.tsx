import type { HighlightColor } from "../api/types";
import { useT } from "../i18n";
import { floatingPosition, PIGMENT_COLOR, PIGMENT_KEY, PIGMENTS } from "./highlightPresentation";

/**
 * The bar that appears next to a selection: four pigments, a note and copy (DESIGN.md, barra de selección).
 * It does not take the focus, so the selection stays while the user picks.
 */
/** Estimated width, to centre the bar before it is measured (the bar is about this wide). */
const TOOLBAR_WIDTH_ESTIMATE = 260;

export function SelectionToolbar({
  anchor,
  onPick,
  onNote,
  onCopy,
}: {
  anchor: DOMRect;
  onPick: (color: HighlightColor) => void;
  onNote: () => void;
  onCopy: () => void;
}) {
  const t = useT();
  const { left, top } = floatingPosition(anchor, TOOLBAR_WIDTH_ESTIMATE);
  return (
    <div
      role="toolbar"
      aria-label={t("highlight.toolbar")}
      onMouseDown={(event) => event.preventDefault()}
      style={{ left, top }}
      className="fixed z-20 flex items-center gap-3 border border-line bg-surface-2 px-4 py-3 text-ui text-ink"
    >
      <div className="flex items-center gap-2">
        {PIGMENTS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={t("highlight.pickColor", { color: t(PIGMENT_KEY[color]) })}
            onClick={() => onPick(color)}
            className="flex h-6 w-6 items-center justify-center rounded-full"
          >
            <span
              aria-hidden="true"
              className="block h-[22px] w-[22px] rounded-full"
              style={{ background: PIGMENT_COLOR[color] }}
            />
          </button>
        ))}
      </div>
      <span aria-hidden="true" className="h-5 w-px bg-line" />
      <button type="button" onClick={onNote} className="text-ink hover:text-ink-2">
        {t("highlight.note")}
      </button>
      <button type="button" onClick={onCopy} className="text-ink hover:text-ink-2">
        {t("highlight.copy")}
      </button>
    </div>
  );
}
