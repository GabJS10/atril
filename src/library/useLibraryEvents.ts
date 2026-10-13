import { useQueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { onLibraryChanged, onScanStatus } from "../api/tauri";
import { invalidateLibrary, scanKey } from "./queries";

/**
 * Keeps the library current while the app runs: refreshes the queries when the library changes (the backend
 * indexes the books and scans the folders) and keeps the scan status up to date.
 */
export function useLibraryEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    const stops: UnlistenFn[] = [];
    Promise.all([
      onLibraryChanged(() => {
        invalidateLibrary(queryClient);
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
