import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../api/queries";
import { exportHighlights, isAppError, openExternalUrl, pickExportPath } from "../api/tauri";
import type { Book, ReadingStateInput, Zoom, ViewMode } from "../api/types";
import { useLocaleStore, useT } from "../i18n";
import { NativeViewer } from "./native/NativeViewer";
import type { FindResult, ViewerHandle, ViewSnapshot } from "./viewerTypes";
import { useNativeDocument } from "./useNativeDocument";
import { SearchBar } from "./SearchBar";
import { ReaderBar } from "./ReaderBar";
import { initialReadingStart, type ReaderPosition, type ReadingStart } from "./position";
import { type ReaderAction, useReaderShortcuts } from "./shortcuts";
import { useChromeVisibility } from "./useChromeVisibility";
import { useReadingPosition } from "./useReadingPosition";
import { useOpenedBook } from "./useOpenedBook";
import { useHighlightSession } from "./useHighlightSession";
import { HighlightEditor } from "./HighlightEditor";
import { HighlightsPanel } from "./HighlightsPanel";
import { OutlinePanel } from "./OutlinePanel";
import { followOutlineItem } from "./outline";
import { useNativeOutline } from "./useNativeOutline";
import { exportBookHighlights } from "./highlightExport";
import { SelectionToolbar } from "./SelectionToolbar";
import { secondaryButton } from "../ui/buttons";

/** The side panel a book can open with (the "Subrayados" link of the library). */
export type ReaderPanel = "highlights" | "outline";

export function ReaderScreen({ bookId, panel = null }: { bookId: string; panel?: ReaderPanel | null }) {
  const t = useT();
  const opened = useOpenedBook(bookId);
  const settings = useSettings();

  if (opened.isPending || settings.isPending) return <ReaderMessage>{t("reader.loading")}</ReaderMessage>;
  if (opened.isError) {
    const missing = isAppError(opened.error) && opened.error.code === "file_missing";
    return <ReaderMessage>{missing ? t("reader.errorMissing") : t("reader.error")}</ReaderMessage>;
  }
  if (settings.isError) return <ReaderMessage>{t("reader.error")}</ReaderMessage>;

  const start = initialReadingStart(opened.data.readingState, settings.data);
  return <ReaderView key={bookId} book={opened.data.book} start={start} initialPanel={panel} />;
}

function ReaderMessage({ children }: { children: string }) {
  const t = useT();
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-6 p-8 text-ink-2">
      <p>{children}</p>
      <Link to="/" className={secondaryButton}>
        {t("reader.back")}
      </Link>
    </main>
  );
}

/** A state updater that keeps the object when the zoom did not change (a scroll must not re-render the screen). */
function sameView(snapshot: ViewSnapshot) {
  return (previous: { zoom: Zoom; scale: number }) =>
    previous.zoom === snapshot.zoom && previous.scale === snapshot.scale
      ? previous
      : { zoom: snapshot.zoom, scale: snapshot.scale };
}

function toSaveState(
  position: ReaderPosition,
  zoom: Zoom,
  viewMode: ViewMode,
  pageCount: number,
): ReadingStateInput {
  return { page: position.page, offsetInPage: position.offsetInPage, zoom, viewMode, pageCount };
}

function ReaderView({
  book,
  start,
  initialPanel,
}: {
  book: Book;
  start: ReadingStart;
  initialPanel: ReaderPanel | null;
}) {
  const t = useT();
  const documentState = useNativeDocument(book.id);
  const viewer = useRef<ViewerHandle>(null);
  const chrome = useChromeVisibility();
  const saver = useReadingPosition(book.id);
  const [page, setPage] = useState(start.position?.page ?? 1);
  // The paper of the reader; saved with the position, and applied to the whole page through <html>.
  const [viewMode, setViewMode] = useState<ViewMode>(start.viewMode);
  const viewModeRef = useRef(start.viewMode);
  const lastView = useRef<ViewSnapshot | null>(null);
  useEffect(() => {
    document.documentElement.dataset.readerMode = viewMode;
    return () => {
      delete document.documentElement.dataset.readerMode;
    };
  }, [viewMode]);
  const [view, setView] = useState<{ zoom: Zoom; scale: number }>({ zoom: start.zoom, scale: 1 });
  const pageCount = documentState.status === "ready" ? documentState.document.pageCount : 0;
  const highlightSession = useHighlightSession(book.id);
  const { toggleHighlightMode } = highlightSession;
  const locale = useLocaleStore((state) => state.locale);
  const [sidePanel, setSidePanel] = useState<ReaderPanel | null>(initialPanel);
  const [exporting, setExporting] = useState(false);
  const outline = useNativeOutline(book.id);
  // Focus mode hides the bar and the panels; only the page stays. F or Escape leaves it.
  const [focusMode, setFocusMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [findResult, setFindResult] = useState<FindResult | null>(null);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => {
    viewer.current?.find("");
    setFindResult(null);
    setSearchOpen(false);
  }, []);

  // Ctrl+F (Cmd+F on macOS) opens the book's search instead of the browser's.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  const exportBook = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const count = await exportBookHighlights(book, locale, {
        pickPath: pickExportPath,
        exportTo: exportHighlights,
      });
      if (count !== null) highlightSession.showNotice(t("highlightPanel.exported", { count: String(count) }));
    } catch {
      highlightSession.showNotice(t("highlightPanel.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const onChange = useCallback(
    (snapshot: ViewSnapshot) => {
      setPage(snapshot.position.page);
      setView(sameView(snapshot));
      lastView.current = snapshot;
      saver.update(toSaveState(snapshot.position, snapshot.zoom, viewModeRef.current, pageCount));
    },
    [saver, pageCount],
  );

  const changeViewMode = useCallback(
    (mode: ViewMode) => {
      setViewMode(mode);
      viewModeRef.current = mode;
      if (lastView.current) {
        saver.update(toSaveState(lastView.current.position, lastView.current.zoom, mode, pageCount));
      }
    },
    [saver, pageCount],
  );

  const onRestored = useCallback(
    (snapshot: ViewSnapshot) => {
      setPage(snapshot.position.page);
      setView(sameView(snapshot));
      lastView.current = snapshot;
      saver.enable();
      // A book read for the first time has no page count stored yet: save its start position once.
      if (book.pageCount === null) {
        saver.update(toSaveState(snapshot.position, snapshot.zoom, viewModeRef.current, pageCount));
      }
    },
    [saver, book.pageCount, pageCount],
  );

  const onAction = useCallback(
    (action: ReaderAction) => {
      const handle = viewer.current;
      if (!handle) return;
      switch (action) {
        case "next-page":
          handle.turnPage(1);
          break;
        case "previous-page":
          handle.turnPage(-1);
          break;
        case "first-page":
          handle.goToPage(1);
          break;
        case "last-page":
          handle.goToPage(pageCount);
          break;
        case "scroll-down":
          handle.scrollLines(1);
          break;
        case "scroll-up":
          handle.scrollLines(-1);
          break;
        case "page-down":
          handle.scrollPages(1);
          break;
        case "page-up":
          handle.scrollPages(-1);
          break;
        case "zoom-in":
          handle.stepZoom(1);
          break;
        case "zoom-out":
          handle.stepZoom(-1);
          break;
        case "toggle-highlight-mode":
          toggleHighlightMode();
          break;
        case "toggle-focus-mode":
          setFocusMode((on) => !on);
          setSidePanel(null);
          break;
        case "exit-focus-mode":
          // Escape closes the open panel first, then leaves focus mode.
          if (sidePanel) setSidePanel(null);
          else setFocusMode(false);
          break;
      }
    },
    [pageCount, toggleHighlightMode, sidePanel],
  );
  useReaderShortcuts(onAction);

  if (documentState.status === "loading") return <ReaderMessage>{t("reader.loading")}</ReaderMessage>;
  if (documentState.status === "error") return <ReaderMessage>{t("reader.error")}</ReaderMessage>;

  const viewerProps = {
    start: { zoom: start.zoom, position: start.position },
    onChange,
    onRestored,
    highlights: highlightSession.highlights,
    onSelectionEnd: highlightSession.handlers.onSelectionEnd,
    onSelectionClear: highlightSession.handlers.onSelectionClear,
    onHighlightPress: highlightSession.handlers.onHighlightPress,
    onFindResult: setFindResult,
  };

  return (
    <div
      className="relative h-screen w-full overflow-hidden bg-canvas"
      onMouseMove={focusMode ? undefined : chrome.wake}
    >
      <ReadingProgress page={page} pageCount={pageCount} />
      <NativeViewer ref={viewer} bookId={book.id} document={documentState.document} {...viewerProps} />
      {highlightSession.selection && !highlightSession.editing ? (
        <SelectionToolbar
          anchor={highlightSession.selection.anchor}
          lastColor={highlightSession.lastColor}
          onPick={highlightSession.toolbar.pick}
          onNote={highlightSession.toolbar.note}
          onCopy={highlightSession.toolbar.copy}
        />
      ) : null}
      {highlightSession.editing ? (
        <HighlightEditor
          key={highlightSession.editing.highlight.id}
          highlight={highlightSession.editing.highlight}
          anchor={highlightSession.editing.anchor}
          focusNote={highlightSession.editing.focusNote}
          onColor={(color) =>
            highlightSession.editor.changeColor(highlightSession.editing!.highlight.id, color)
          }
          onNote={(text) => highlightSession.editor.saveNote(highlightSession.editing!.highlight.id, text)}
          onDelete={() => highlightSession.editor.remove(highlightSession.editing!.highlight.id)}
          onClose={highlightSession.editor.close}
        />
      ) : null}
      {highlightSession.notice ? (
        <div
          role="status"
          onClick={highlightSession.dismissNotice}
          className="fixed bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-pill bg-pill px-5 py-3 text-ui text-ink-2 shadow-float"
        >
          {highlightSession.notice}
        </div>
      ) : null}
      <ReaderBar
        title={book.title}
        author={book.author}
        page={page}
        pageCount={pageCount}
        scale={view.scale}
        onGoToPage={(target) => viewer.current?.goToPage(target)}
        visible={chrome.visible && !focusMode}
        onZoomIn={() => viewer.current?.stepZoom(1)}
        onZoomOut={() => viewer.current?.stepZoom(-1)}
        onFocusWithin={chrome.pin}
        highlightMode={highlightSession.highlightMode}
        lastColor={highlightSession.lastColor}
        onToggleHighlightMode={toggleHighlightMode}
        highlightCount={highlightSession.highlights.length}
        highlightsOpen={sidePanel === "highlights"}
        onToggleHighlights={() => setSidePanel((open) => (open === "highlights" ? null : "highlights"))}
        outlineOpen={sidePanel === "outline"}
        onToggleOutline={() => setSidePanel((open) => (open === "outline" ? null : "outline"))}
        panelOpen={sidePanel !== null}
        onOpenSearch={openSearch}
        viewMode={viewMode}
        onViewMode={changeViewMode}
      />
      {searchOpen ? (
        <SearchBar
          result={findResult}
          onFind={(query, options) => viewer.current?.find(query, options)}
          onClose={closeSearch}
        />
      ) : null}
      {sidePanel === "outline" ? (
        <OutlinePanel
          items={outline}
          currentPage={page}
          onGo={(item) =>
            followOutlineItem(item, {
              goTo: (dest) => viewer.current?.goToDestination(dest),
              openExternal: (uri) => void openExternalUrl(uri).catch(() => undefined),
            })
          }
          onClose={() => setSidePanel(null)}
        />
      ) : null}
      {sidePanel === "highlights" ? (
        <HighlightsPanel
          highlights={highlightSession.highlights}
          exporting={exporting}
          onJump={(highlight) => viewer.current?.revealHighlight(highlight)}
          onExport={() => void exportBook()}
          onClose={() => setSidePanel(null)}
        />
      ) : null}
    </div>
  );
}

/** The thin line at the top of the reader: how far into the book the page is (DESIGN.md, línea de progreso). */
function ReadingProgress({ page, pageCount }: { page: number; pageCount: number }) {
  const fill = pageCount > 0 ? Math.min(1, Math.max(0, page / pageCount)) : 0;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[3px] bg-track">
      <div className="h-full bg-accent" style={{ width: `${fill * 100}%` }} />
    </div>
  );
}
