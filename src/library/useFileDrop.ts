import { useQueryClient } from "@tanstack/react-query";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { importFiles, onFilesDropped } from "../api/tauri";
import type { ImportResult } from "../api/types";
import { invalidateLibrary } from "./queries";

/** Query key of the last import result, shown as a notice in the library (not a library query). */
export const importResultKey = ["importResult"] as const;

/** PDFs dropped on the window are imported; the rejected ones are kept for the notice. */
export function useFileDrop(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    let stop: UnlistenFn | undefined;

    Promise.resolve()
      .then(() =>
        onFilesDropped(async (paths) => {
          try {
            const result: ImportResult = await importFiles(paths);
            queryClient.setQueryData(importResultKey, result);
            invalidateLibrary(queryClient);
          } catch (error) {
            console.error("could not import the dropped files", error);
          }
        }),
      )
      .then(
        (unlisten) => {
          if (disposed) unlisten();
          else stop = unlisten;
        },
        () => undefined, // Not running inside Tauri.
      );

    return () => {
      disposed = true;
      stop?.();
    };
  }, [queryClient]);
}
