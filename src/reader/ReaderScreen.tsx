import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../api/queries";
import { exportHighlights, isAppError, openBook, pickExportPath } from "../api/tauri";
import type { Book, ReadingStateInput, Zoom, ViewMode } from "../api/types";
import { useLocaleStore, useT } from "../i18n";
import { type FindResult, PdfViewer, type PdfViewerHandle, type ViewSnapshot } from "./PdfViewer";
import { SearchBar } from "./SearchBar";
import { ReaderBar } from "./ReaderBar";
import { initialReadingStart, type ReaderPosition, type ReadingStart } from "./position";
import { type ReaderAction, useReaderShortcuts } from "./shortcuts";
import { useChromeVisibility } from "./useChromeVisibility";
import { usePdfDocument } from "./usePdfDocument";
import { useReadingPosition } from "./useReadingPosition";
import { useHighlightSession } from "./useHighlightSession";
import { HighlightEditor } from "./HighlightEditor";
import { HighlightsPanel } from "./HighlightsPanel";
import { OutlinePanel } from "./OutlinePanel";
import { useOutline } from "./useOutline";
import { exportBookHighlights } from "./highlightExport";
import { SelectionToolbar } from "./SelectionToolbar";
import { readerClosed, readerOpened } from "../library/readerActivity";

export function ReaderScreen({ bookId }: { bookId: string }) {
  const t = useT();
  const opened = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => openBook(bookId),
    staleTime: Infinity,
    retry: false,
  });
  const settings = useSettings();

  if (opened.isPending || settings.isPending) return <ReaderMessage>{t("reader.loading")}</ReaderMessage>;
  if (opened.isError) {
    const missing = isAppError(opened.error) && opened.error.code === "file_missing";
    return <ReaderMessage>{missing ? t("reader.errorMissing") : t("reader.error")}</ReaderMessage>;
  }
  if (settings.isError) return <ReaderMessage>{t("reader.error")}</ReaderMessage>;

  const start = initialReadingStart(opened.data.readingState, settings.data);
  return <ReaderView key={bookId} book={opened.data.book} start={start} />;
}

function ReaderMessage({ children }: { children: string }) {
  const t = useT();
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-6 p-8 text-ink-2">
      <p>{children}</p>
      <Link to="/" className="text-ink underline underline-offset-4">
        {t("reader.back")}
      </Link>
    </main>
  );
}

function toSaveState(
  position: ReaderPosition,
  zoom: Zoom,
  viewMode: ViewMode,
  pageCount: number,
): ReadingStateInput {
  return { page: position.page, offsetInPage: position.offsetInPage, zoom, viewMode, pageCount };
}

function ReaderView({ book, start }: { book: Book; start: ReadingStart }) {
  const t = useT();
  const pdfState = usePdfDocument(book.fileUrl);
  const viewer = useRef<PdfViewerHandle>(null);
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
  const pageCount = pdfState.status === "ready" ? pdfState.pdf.numPages : 0;
  const highlightSession = useHighlightSession(book.id);
  const { toggleHighlightMode } = highlightSession;
  const locale = useLocaleStore((state) => state.locale);
  const [sidePanel, setSidePanel] = useState<"highlights" | "outline" | null>(null);
  const [exporting, setExporting] = useState(false);
  const outline = useOutline(pdfState.status === "ready" ? pdfState.pdf : null);
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

  // The background indexer waits while a book is open.
  useEffect(() => {
    readerOpened();
    return () => readerClosed();
  }, []);

  const onChange = useCallback(
    (snapshot: ViewSnapshot) => {
      setPage(snapshot.position.page);
      setView({ zoom: snapshot.zoom, scale: snapshot.scale });
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
      setView({ zoom: snapshot.zoom, scale: snapshot.scale });
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

  if (pdfState.status === "loading") return <ReaderMessage>{t("reader.loading")}</ReaderMessage>;
  if (pdfState.status === "error") return <ReaderMessage>{t("reader.error")}</ReaderMessage>;

  return (
    <div
      className="relative h-screen w-full overflow-hidden bg-canvas"
      onMouseMove={focusMode ? undefined : chrome.wake}
    >
      <PdfViewer
        ref={viewer}
        pdf={pdfState.pdf}
        start={{ zoom: start.zoom, position: start.position }}
        onChange={onChange}
        onRestored={onRestored}
        highlights={highlightSession.highlights}
        onSelectionEnd={highlightSession.handlers.onSelectionEnd}
        onSelectionClear={highlightSession.handlers.onSelectionClear}
        onHighlightPress={highlightSession.handlers.onHighlightPress}
        onFindResult={setFindResult}
      />
      {highlightSession.selection && !highlightSession.editing ? (
        <SelectionToolbar
          anchor={highlightSession.selection.anchor}
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
          className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 border border-line bg-surface px-5 py-3 text-ui text-ink-2"
        >
          {highlightSession.notice}
        </div>
      ) : null}
      <ReaderBar
        title={book.title}
        page={page}
        pageCount={pageCount}
        scale={view.scale}
        visible={chrome.visible && !focusMode}
        onZoomIn={() => viewer.current?.stepZoom(1)}
        onZoomOut={() => viewer.current?.stepZoom(-1)}
        onFocusWithin={chrome.pin}
        highlightMode={highlightSession.highlightMode}
        onToggleHighlightMode={toggleHighlightMode}
        highlightCount={highlightSession.highlights.length}
        highlightsOpen={sidePanel === "highlights"}
        onToggleHighlights={() => setSidePanel((open) => (open === "highlights" ? null : "highlights"))}
        outlineOpen={sidePanel === "outline"}
        onToggleOutline={() => setSidePanel((open) => (open === "outline" ? null : "outline"))}
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
          onGo={(item) => viewer.current?.goToDestination(item.dest)}
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
