import type { Book } from "../api/types";
import type { useT } from "../i18n";
import { useLocaleStore } from "../i18n";
import { formatPercent } from "../reader/zoom";

type Translate = ReturnType<typeof useT>;

/** "1 obra" / "3 obras" (or the English equivalents). */
export function countLabel(count: number, t: Translate): string {
  return count === 1
    ? t("library.all.countOne", { count: String(count) })
    : t("library.all.count", { count: String(count) });
}

/** "queda 1 página" / "quedan 84 páginas"; null when the book has no page or page count stored. */
export function pagesLeftLabel(book: Book, t: Translate): string | null {
  if (book.currentPage === null || book.pageCount === null) return null;
  const left = Math.max(0, book.pageCount - book.currentPage);
  return left === 1
    ? t("library.pagesLeftOne", { count: String(left) })
    : t("library.pagesLeft", { count: String(left) });
}

/** Percent label for a book's progress, formatted for the UI locale; null when never opened. */
export function useProgressLabel(progress: number | null): string | null {
  const locale = useLocaleStore((state) => state.locale);
  return progress === null ? null : formatPercent(progress, locale);
}
