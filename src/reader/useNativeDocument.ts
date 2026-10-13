import { useEffect, useState } from "react";
import { openDocument } from "../api/tauri";
import type { OpenedDocument } from "../api/types";

export type NativeDocumentState =
  { status: "loading" } | { status: "ready"; document: OpenedDocument } | { status: "error"; error: unknown };

/** Opens the book in the native engine (`open_document`). Does nothing while `enabled` is false. */
export function useNativeDocument(bookId: string, enabled: boolean): NativeDocumentState {
  const [state, setState] = useState<NativeDocumentState>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
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
  }, [bookId, enabled]);

  return state;
}
