import { useQueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { onLibraryChanged, onScanStatus, listPendingScans, markScanFailed, saveBookScan } from "../api/tauri";
import { whenReaderIdle } from "./readerActivity";
import { invalidateLibrary, scanKey } from "./queries";
import { type IndexerDeps, renderFirstPageJpeg } from "./indexer";
import { scheduleIndexing } from "./indexerController";

/** The indexer wired to Tauri and pdf.js. pdf.js is imported only here, when indexing starts. */
export function createTauriIndexerDeps(onIndexed: () => void): IndexerDeps {
  return {
    listPending: listPendingScans,
    openPdf: async (fileUrl) => (await import("../reader/pdfLoader")).openPdfByRanges(fileUrl),
    renderCover: renderFirstPageJpeg,
    saveScan: saveBookScan,
    markFailed: markScanFailed,
    waitWhileReading: whenReaderIdle,
    onIndexed,
  };
}

/**
 * Keeps the library current while the app runs: indexes the pending books, refreshes the queries when the
 * library changes, and keeps the scan status up to date.
 */
export function useLibraryEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const deps = createTauriIndexerDeps(() => invalidateLibrary(queryClient));
    scheduleIndexing(deps);

    let disposed = false;
    const stops: UnlistenFn[] = [];
    Promise.all([
      onLibraryChanged(() => {
        invalidateLibrary(queryClient);
        scheduleIndexing(deps);
      }),
      onScanStatus((status) => {
        queryClient.setQueryData(scanKey, status);
      }),
    ]).then(
      (unlisten) => {
        if (disposed) unlisten.forEach((stop) => stop());
        else stops.push(...unlisten);
      },
      () => undefined, // Not running inside Tauri (e.g. a browser dev server).
    );

    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [queryClient]);
}
