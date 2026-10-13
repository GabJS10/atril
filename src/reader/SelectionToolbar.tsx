import type { HighlightColor } from "../api/types";
import { useT } from "../i18n";
import { floatingPosition, PIGMENT_COLOR, PIGMENT_KEY, PIGMENTS } from "./highlightPresentation";

/**
 * The bar that appears next to a selection: four pigments, a note and copy (DESIGN.md, barra de selección).
 * It does not take the focus, so the selection stays while the user picks.
 */
/** Estimated width, to centre the bar before it is measured (the bar is about this wide). */
const TOOLBAR_WIDTH_ESTIMATE = 300;

const ACTION =
  "rounded-tab px-3 py-2 text-ui font-medium text-ink transition-colors duration-fast ease-atril hover:bg-surface-3";

export function SelectionToolbar({
  anchor,
  lastColor,
  onPick,
  onNote,
  onCopy,
}: {
  anchor: DOMRect;
  /** The pigment used last: it comes marked. */
  lastColor: HighlightColor;
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
      className="fixed z-20 flex items-center gap-2 rounded-tile bg-surface-2 px-2.5 py-2 text-ui text-ink shadow-float"
    >
      <div className="flex items-center gap-2">
        {PIGMENTS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={t("highlight.pickColor", { color: t(PIGMENT_KEY[color]) })}
            onClick={() => onPick(color)}
            aria-pressed={color === lastColor}
            className={`flex size-6 items-center justify-center rounded-dot ${
              color === lastColor ? "ring-2 ring-ink ring-offset-2 ring-offset-surface-2" : ""
            }`}
          >
            <span
              aria-hidden="true"
              className="block size-6 rounded-dot"
              style={{ background: PIGMENT_COLOR[color] }}
            />
          </button>
        ))}
      </div>
      <span aria-hidden="true" className="mx-1 h-6 w-px bg-line" />
      <button type="button" onClick={onNote} className={ACTION}>
        {t("highlight.note")}
      </button>
      <button type="button" onClick={onCopy} className={ACTION}>
        {t("highlight.copy")}
      </button>
    </div>
  );
}
