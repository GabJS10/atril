import { useEffect, useState } from "react";
import { getOutline } from "../api/tauri";
import { fromEngineOutline, type OutlineItem } from "./outline";

/**
 * The index of the open book from the native engine, loaded once. Null while it loads. A book whose index cannot be
 * read is treated as having none.
 */
export function useNativeOutline(bookId: string): OutlineItem[] | null {
  const [loaded, setLoaded] = useState<{ bookId: string; items: OutlineItem[] } | null>(null);

  useEffect(() => {
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
  }, [bookId]);

  return loaded?.bookId === bookId ? loaded.items : null;
}
