import { useT } from "../i18n";
import { CloseIcon } from "../ui/icons";

/**
 * The frame of the reader's side panels (DESIGN.md, paneles): opaque, a tone of its own, no line. A title in serif
 * with its count, a close button and the content. Escape closes it.
 */
export function SidePanel({
  label,
  title,
  count,
  onClose,
  children,
}: {
  label: string;
  title: string;
  count?: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <aside
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="absolute inset-y-0 right-0 z-10 flex w-90 flex-col gap-4.5 overflow-hidden bg-surface px-6 py-7 text-base text-ink"
    >
      <header className="flex items-center gap-2.5">
        <h2 className="font-serif text-panel leading-none font-semibold">{title}</h2>
        {count === undefined ? null : <span className="text-ui text-ink-3">{count}</span>}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("panel.close")}
          title={t("panel.close")}
          className="ml-auto flex size-11 items-center justify-center rounded-field text-ink-2 transition-colors duration-fast ease-atril hover:bg-surface-3 hover:text-ink"
        >
          <CloseIcon />
        </button>
      </header>
      {children}
    </aside>
  );
}
