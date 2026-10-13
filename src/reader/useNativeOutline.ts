import { useEffect, useState } from "react";
import { getOutline } from "../api/tauri";
import { fromEngineOutline, type OutlineItem } from "./outline";

/**
 * The index of the open book from the native engine, loaded once. Null while it loads. A book whose index cannot be
 * read is treated as having none. Does nothing while `enabled` is false.
 */
export function useNativeOutline(bookId: string, enabled: boolean): OutlineItem[] | null {
  const [loaded, setLoaded] = useState<{ bookId: string; items: OutlineItem[] } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getOutline(bookId)
      .then(fromEngineOutline)
      .catch(() => [] as OutlineItem[])
      .then((items) => {
        if (!cancelled) setLoaded({ bookId, items });
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, enabled]);

  return enabled && loaded?.bookId === bookId ? loaded.items : null;
}
