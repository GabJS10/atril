import { Link } from "@tanstack/react-router";
import { useLocaleStore, useT } from "../i18n";
import { formatPercent } from "./zoom";
import { Segmented } from "../ui/Segmented";
import { PageField } from "./PageField";
import type { ViewMode } from "../api/types";

export type ReaderBarProps = {
  title: string;
  page: number;
  pageCount: number;
  scale: number;
  /** The page typed in the page field. */
  onGoToPage: (page: number) => void;
  visible: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Keeps the bar visible while focus is inside it (keyboard users). */
  onFocusWithin: (within: boolean) => void;
  /** The highlighter mode (H): every selection is highlighted with the last pigment. */
  highlightMode: boolean;
  onToggleHighlightMode: () => void;
  /** The side panels (DESIGN.md, barra del lector): index and highlights. Only one is open at a time. */
  highlightCount: number;
  highlightsOpen: boolean;
  onToggleHighlights: () => void;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  /** Opens the search bar (also Ctrl+F). */
  onOpenSearch: () => void;
  /** The paper of the reader: normal, sepia or night (DESIGN.md, lector: papel y tinta por modo). */
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
};

const CONTROL_CLASS = "flex h-8 min-w-8 items-center justify-center text-ink hover:text-ink-2";

/** Thin bottom bar of the reader: appears with the pointer and fades out after 2 s (DESIGN.md). */
export function ReaderBar({
  title,
  page,
  pageCount,
  scale,
  onGoToPage,
  visible,
  onZoomIn,
  onZoomOut,
  onFocusWithin,
  highlightMode,
  onToggleHighlightMode,
  highlightCount,
  highlightsOpen,
  onToggleHighlights,
  outlineOpen,
  onToggleOutline,
  onOpenSearch,
  viewMode,
  onViewMode,
}: ReaderBarProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  return (
    <nav
      aria-label={t("reader.controls")}
      inert={!visible}
      onFocus={() => onFocusWithin(true)}
      onBlur={() => onFocusWithin(false)}
      className={`absolute inset-x-0 bottom-0 flex h-14 items-center gap-6 border-t border-line bg-surface px-8 text-ui text-ink-2 transition-opacity duration-slow ease-atril ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <Link to="/" className="text-ink hover:text-ink-2">
        <span aria-hidden="true">← </span>
        {t("reader.back")}
      </Link>
      <span className="min-w-0 truncate font-serif text-cartela text-ink">{title}</span>
      <PageField page={page} pageCount={pageCount} onGoTo={onGoToPage} />
      <span className="flex-1" />
      <Segmented
        compact
        label={t("reader.paper")}
        value={viewMode}
        onChange={onViewMode}
        options={[
          { value: "normal", label: t("reader.paper.normal") },
          { value: "sepia", label: t("reader.paper.sepia") },
          { value: "night", label: t("reader.paper.night") },
        ]}
      />
      <button type="button" onClick={onOpenSearch} className={CONTROL_CLASS}>
        {t("search.open")}
      </button>
      <button
        type="button"
        aria-pressed={outlineOpen}
        onClick={onToggleOutline}
        className={`flex items-center gap-2 border px-2.5 py-1 text-label ${
          outlineOpen ? "border-ink bg-ink text-ink-inverse" : "border-line text-ink-2"
        }`}
      >
        {t("outline.title")}
      </button>
      <button
        type="button"
        aria-pressed={highlightsOpen}
        onClick={onToggleHighlights}
        className={`flex items-center gap-2 border px-2.5 py-1 text-label ${
          highlightsOpen ? "border-ink bg-ink text-ink-inverse" : "border-line text-ink-2"
        }`}
      >
        {t("highlightPanel.toggle")} · {highlightCount}
      </button>
      <button
        type="button"
        aria-pressed={highlightMode}
        onClick={onToggleHighlightMode}
        className={`flex items-center gap-2 border px-2.5 py-1 text-label ${
          highlightMode ? "border-ink bg-ink text-ink-inverse" : "border-line text-ink-2"
        }`}
      >
        <span
          aria-hidden="true"
          className="block h-2 w-2 rounded-full"
          style={{ background: "var(--pigment-ocre)" }}
        />
        {t("highlight.mode")}
      </button>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t("reader.zoomOut")} className={CONTROL_CLASS} onClick={onZoomOut}>
          −
        </button>
        <span className="min-w-14 text-center">{formatPercent(scale, locale)}</span>
        <button type="button" aria-label={t("reader.zoomIn")} className={CONTROL_CLASS} onClick={onZoomIn}>
          +
        </button>
      </div>
    </nav>
  );
}
