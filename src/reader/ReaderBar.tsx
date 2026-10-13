import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useLocaleStore, useT } from "../i18n";
import { formatPercent } from "./zoom";
import { Segmented } from "../ui/Segmented";
import { BackIcon, ListIcon, MinusIcon, PenIcon, PlusIcon, SearchIcon } from "../ui/icons";
import { PageField } from "./PageField";
import { PIGMENT_COLOR } from "./highlightPresentation";
import type { HighlightColor, ViewMode } from "../api/types";

export type ReaderBarProps = {
  title: string;
  author: string | null;
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
  lastColor: HighlightColor;
  onToggleHighlightMode: () => void;
  /** The side panels (DESIGN.md, paneles): index and highlights. Only one is open at a time. */
  highlightCount: number;
  highlightsOpen: boolean;
  onToggleHighlights: () => void;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  /** A side panel is open: the bar centres on the page that is left. */
  panelOpen: boolean;
  /** Opens the search bar (also Ctrl+F). */
  onOpenSearch: () => void;
  /** The paper of the reader: normal, sepia or night (DESIGN.md, lector: papel y tinta por modo). */
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
};

const ICON_BUTTON =
  "flex size-10 shrink-0 items-center justify-center rounded-field transition-colors duration-fast ease-atril hover:bg-surface-3";

function Divider() {
  return <span aria-hidden="true" className="h-7 w-px shrink-0 bg-line" />;
}

function IconButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`${ICON_BUTTON} ${pressed ? "bg-surface-3 text-accent-text" : "text-ink-2 hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

/**
 * The floating pill of the reader (DESIGN.md, píldora del lector): it appears with the pointer and fades out
 * after 2 s without movement.
 */
export function ReaderBar({
  title,
  author,
  page,
  pageCount,
  scale,
  onGoToPage,
  visible,
  onZoomIn,
  onZoomOut,
  onFocusWithin,
  highlightMode,
  lastColor,
  onToggleHighlightMode,
  highlightCount,
  highlightsOpen,
  onToggleHighlights,
  outlineOpen,
  onToggleOutline,
  panelOpen,
  onOpenSearch,
  viewMode,
  onViewMode,
}: ReaderBarProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4 transition-[opacity,padding] duration-slow ease-atril ${
        panelOpen ? "pr-94" : ""
      } ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <nav
        aria-label={t("reader.controls")}
        inert={!visible}
        onFocus={() => onFocusWithin(true)}
        onBlur={() => onFocusWithin(false)}
        className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-bar bg-pill px-2.5 py-2 text-ui whitespace-nowrap text-ink-2 shadow-pill"
      >
        <Link
          to="/"
          aria-label={t("reader.backToLibrary")}
          title={t("reader.backToLibrary")}
          className={`${ICON_BUTTON} text-ink-2 hover:text-ink`}
        >
          <BackIcon size={20} />
        </Link>
        <div className="flex max-w-48 min-w-20 flex-col pr-2.5 pl-0.5">
          <span className="truncate font-serif text-title-sm leading-[1.1] font-semibold text-ink">
            {title}
          </span>
          {author ? <span className="truncate text-label text-ink-3">{author}</span> : null}
        </div>
        <Divider />
        <PageField page={page} pageCount={pageCount} onGoTo={onGoToPage} />
        <Divider />
        <IconButton label={t("outline.title")} pressed={outlineOpen} onClick={onToggleOutline}>
          <ListIcon size={20} />
        </IconButton>
        <IconButton label={t("search.open")} onClick={onOpenSearch}>
          <SearchIcon size={20} />
        </IconButton>
        <IconButton
          label={`${t("highlightPanel.toggle")} · ${highlightCount}`}
          pressed={highlightsOpen}
          onClick={onToggleHighlights}
        >
          <PenIcon size={20} />
        </IconButton>
        <Divider />
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
        <Divider />
        <IconButton label={t("reader.zoomOut")} onClick={onZoomOut}>
          <MinusIcon />
        </IconButton>
        <span className="min-w-11.5 text-center text-ui font-semibold text-ink">
          {formatPercent(scale, locale)}
        </span>
        <IconButton label={t("reader.zoomIn")} onClick={onZoomIn}>
          <PlusIcon />
        </IconButton>
        <Divider />
        <button
          type="button"
          aria-pressed={highlightMode}
          onClick={onToggleHighlightMode}
          className={`flex shrink-0 items-center gap-2 rounded-field px-2.5 py-2.5 text-ui font-medium transition-colors duration-fast ease-atril hover:bg-surface-3 hover:text-ink ${
            highlightMode ? "bg-surface-3 text-ink" : "text-ink-2"
          }`}
        >
          <span
            aria-hidden="true"
            className="block size-3 rounded-dot"
            style={{ background: PIGMENT_COLOR[lastColor] }}
          />
          {t("highlight.mode")}
        </button>
      </nav>
    </div>
  );
}
