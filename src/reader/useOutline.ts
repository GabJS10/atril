import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";
import { loadOutline, type OutlineItem } from "./outline";

/**
 * The index of the open book, loaded once per document. Null while it loads. A book whose index cannot be read
 * is treated as having none.
 */
export function useOutline(pdf: PDFDocumentProxy | null): OutlineItem[] | null {
  const [loaded, setLoaded] = useState<{ pdf: PDFDocumentProxy; items: OutlineItem[] } | null>(null);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    loadOutline(pdf)
      .catch(() => [] as OutlineItem[])
      .then((items) => {
        if (!cancelled) setLoaded({ pdf, items });
      });
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  return pdf && loaded?.pdf === pdf ? loaded.items : null;
}
