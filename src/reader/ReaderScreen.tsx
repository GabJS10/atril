import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { isAppError, openBook } from "../api/tauri";
import type { Book } from "../api/types";
import { useT } from "../i18n";
import { PdfViewer, type PdfViewerHandle, type ViewerZoom } from "./PdfViewer";
import { ReaderBar } from "./ReaderBar";
import { type ReaderAction, useReaderShortcuts } from "./shortcuts";
import { useChromeVisibility } from "./useChromeVisibility";
import { usePdfDocument } from "./usePdfDocument";

export function ReaderScreen({ bookId }: { bookId: string }) {
  const t = useT();
  const opened = useQuery({
    queryKey: ["book", bookId],
    queryFn: () => openBook(bookId),
    staleTime: Infinity,
    retry: false,
  });

  if (opened.isPending) return <ReaderMessage>{t("reader.loading")}</ReaderMessage>;
  if (opened.isError) {
    const missing = isAppError(opened.error) && opened.error.code === "file_missing";
    return <ReaderMessage>{missing ? t("reader.errorMissing") : t("reader.error")}</ReaderMessage>;
  }
  return <ReaderView key={bookId} book={opened.data.book} />;
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

function ReaderView({ book }: { book: Book }) {
  const t = useT();
  const pdfState = usePdfDocument(book.fileUrl);
  const viewer = useRef<PdfViewerHandle>(null);
  const chrome = useChromeVisibility();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<ViewerZoom>({ zoom: "page_width", scale: 1 });
  const pageCount = pdfState.status === "ready" ? pdfState.pdf.numPages : 0;

  const onAction = useCallback(
    (action: ReaderAction) => {
      const handle = viewer.current;
      if (!handle) return;
      switch (action) {
        case "next-page":
          handle.goToPage(Math.min(page + 1, pageCount));
          break;
        case "previous-page":
          handle.goToPage(Math.max(page - 1, 1));
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
    [page, pageCount],
  );
  useReaderShortcuts(onAction);

  if (pdfState.status === "loading") return <ReaderMessage>{t("reader.loading")}</ReaderMessage>;
  if (pdfState.status === "error") return <ReaderMessage>{t("reader.error")}</ReaderMessage>;

  return (
    <div className="relative h-screen w-full overflow-hidden bg-canvas" onMouseMove={chrome.wake}>
      <PdfViewer
        ref={viewer}
        pdf={pdfState.pdf}
        zoom={zoom.zoom}
        onPageChange={setPage}
        onZoomChange={setZoom}
      />
      <ReaderBar
        title={book.title}
        page={page}
        pageCount={pageCount}
        scale={zoom.scale}
        visible={chrome.visible}
        onZoomIn={() => viewer.current?.stepZoom(1)}
        onZoomOut={() => viewer.current?.stepZoom(-1)}
        onFocusWithin={chrome.pin}
      />
    </div>
  );
}
