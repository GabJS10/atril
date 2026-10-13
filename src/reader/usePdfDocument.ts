import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";

export type PdfState =
  { status: "loading" } | { status: "ready"; pdf: PDFDocumentProxy } | { status: "error"; error: unknown };

/**
 * Loads a book by byte ranges. The pdf.js engine is imported here, so it is only downloaded
 * when a book is opened (not at all while `enabled` is false: the native viewer does not need it). The document is destroyed when the component unmounts or the URL changes.
 */
export function usePdfDocument(fileUrl: string, enabled = true): PdfState {
  const [state, setState] = useState<PdfState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;

    import("./pdfLoader")
      .then(({ openPdfByRanges }) => openPdfByRanges(fileUrl))
      .then(async (loadingTask) => {
        if (cancelled) {
          await loadingTask.destroy();
          return;
        }
        task = loadingTask;
        const pdf = await loadingTask.promise;
        if (!cancelled) setState({ status: "ready", pdf });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", error });
      });

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [fileUrl, enabled]);

  return state;
}
