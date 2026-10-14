import { useState } from "react";
import { useT } from "../i18n";

export type PageFieldProps = {
  page: number;
  pageCount: number;
  onGoTo: (page: number) => void;
};

/**
 * The current page, which is also where to type another one: Enter goes there, Escape or leaving the field puts the
 * current page back. While the field is being edited the reading position does not overwrite what is typed.
 */
export function PageField({ page, pageCount, onGoTo }: PageFieldProps) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const target = Number.parseInt(draft ?? "", 10);
    if (Number.isFinite(target) && pageCount > 0) onGoTo(Math.min(Math.max(target, 1), pageCount));
    setDraft(null);
  };

  return (
    <span className="flex items-center gap-1.5 px-1 text-ui text-ink-2">
      <input
        type="text"
        inputMode="numeric"
        aria-label={t("reader.goToPage")}
        value={draft ?? String(page)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 5))}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        className="w-11 rounded-tab bg-surface-3 px-1.5 py-2 text-center text-ui font-semibold text-ink"
      />
      <span>{t("reader.pagesTotal", { pages: String(pageCount) })}</span>
    </span>
  );
}
