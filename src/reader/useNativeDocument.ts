import { useEffect, useState } from "react";
import { openDocument } from "../api/tauri";
import type { OpenedDocument } from "../api/types";

export type NativeDocumentState =
  { status: "loading" } | { status: "ready"; document: OpenedDocument } | { status: "error"; error: unknown };

/** Opens the book in the native engine (`open_document`). */
export function useNativeDocument(bookId: string): NativeDocumentState {
  const [state, setState] = useState<NativeDocumentState>({ status: "loading" });

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
  }, [bookId]);

  return state;
}
