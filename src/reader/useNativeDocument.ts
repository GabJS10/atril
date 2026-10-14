import { useCallback, useEffect, useState } from "react";
import { openDocument } from "../api/tauri";
import type { OpenedDocument } from "../api/types";

export type NativeDocumentState =
  { status: "loading" } | { status: "ready"; document: OpenedDocument } | { status: "error"; error: unknown };

/** Opens the book in the native engine (`open_document`). `reload` asks again after a failure. */
export function useNativeDocument(bookId: string): { state: NativeDocumentState; reload: () => void } {
  const [state, setState] = useState<NativeDocumentState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    openDocument(bookId).then(
      (document) => {
        if (!cancelled) setState({ status: "ready", document });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: "error", error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bookId, attempt]);

  return { state, reload };
}
