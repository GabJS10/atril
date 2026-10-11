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

/** Percent label for a book's progress, formatted for the UI locale; null when never opened. */
export function useProgressLabel(progress: number | null): string | null {
  const locale = useLocaleStore((state) => state.locale);
  return progress === null ? null : formatPercent(progress, locale);
}
