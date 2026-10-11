import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useSettings } from "../api/queries";
import { isAppError, openBook } from "../api/tauri";
import type { Book, ReadingStateInput, Zoom, ViewMode } from "../api/types";
import { useT } from "../i18n";
import { PdfViewer, type PdfViewerHandle, type ViewSnapshot } from "./PdfViewer";
import { ReaderBar } from "./ReaderBar";
import { initialReadingStart, type ReaderPosition, type ReadingStart } from "./position";
import { type ReaderAction, useReaderShortcuts } from "./shortcuts";
import { useChromeVisibility } from "./useChromeVisibility";
import { usePdfDocument } from "./usePdfDocument";
import { useReadingPosition } from "./useReadingPosition";

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
  const [view, setView] = useState<{ zoom: Zoom; scale: number }>({ zoom: start.zoom, scale: 1 });
  const pageCount = pdfState.status === "ready" ? pdfState.pdf.numPages : 0;

  const onChange = useCallback(
    (snapshot: ViewSnapshot) => {
      setPage(snapshot.position.page);
      setView({ zoom: snapshot.zoom, scale: snapshot.scale });
      saver.update(toSaveState(snapshot.position, snapshot.zoom, start.viewMode, pageCount));
    },
    [saver, start.viewMode, pageCount],
  );

  const onRestored = useCallback(
    (snapshot: ViewSnapshot) => {
      setPage(snapshot.position.page);
      setView({ zoom: snapshot.zoom, scale: snapshot.scale });
      saver.enable();
      // A book read for the first time has no page count stored yet: save its start position once.
      if (book.pageCount === null) {
        saver.update(toSaveState(snapshot.position, snapshot.zoom, start.viewMode, pageCount));
      }
    },
    [saver, start.viewMode, book.pageCount, pageCount],
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
      }
    },
    [pageCount],
  );
  useReaderShortcuts(onAction);

  if (pdfState.status === "loading") return <ReaderMessage>{t("reader.loading")}</ReaderMessage>;
  if (pdfState.status === "error") return <ReaderMessage>{t("reader.error")}</ReaderMessage>;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-canvas" onMouseMove={chrome.wake}>
      <PdfViewer
        ref={viewer}
        pdf={pdfState.pdf}
        start={{ zoom: start.zoom, position: start.position }}
        onChange={onChange}
        onRestored={onRestored}
      />
      <ReaderBar
        title={book.title}
        page={page}
        pageCount={pageCount}
        scale={view.scale}
        visible={chrome.visible}
        onZoomIn={() => viewer.current?.stepZoom(1)}
        onZoomOut={() => viewer.current?.stepZoom(-1)}
        onFocusWithin={chrome.pin}
      />
    </div>
  );
}
