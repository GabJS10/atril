import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "../i18n";
import type { ImportResult } from "../api/types";
import { importResultKey } from "./useFileDrop";
import type { Book } from "../api/types";
import { useRelinkBook, useRemoveBook } from "./actions";
import { ghostButton, primaryButton, smallButton } from "../ui/buttons";

/** Scan in progress: one hairline line, no modal (DESIGN.md, estado escaneando). */
export function ScanBar({ found }: { found: number }) {
  const t = useT();
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-6 rounded-tile bg-card px-6 py-4 text-ui text-ink-2"
    >
      <span>{t("library.scanning")}</span>
      <span>{t("library.scanningFound", { found: String(found) })}</span>
    </div>
  );
}

/** Books whose file is gone: the reader cannot open them, but nothing is lost (DESIGN.md, aviso). */
export function MissingBanner({ books }: { books: Book[] }) {
  const t = useT();
  if (books.length === 0) return null;
  return (
    <div className="flex flex-col gap-6">
      {books.map((book) => (
        <MissingItem key={book.id} book={book} t={t} />
      ))}
    </div>
  );
}

function MissingItem({ book, t }: { book: Book; t: ReturnType<typeof useT> }) {
  const relink = useRelinkBook();
  const remove = useRemoveBook();
  return (
    <div role="alert" className="grid grid-cols-12 items-center gap-6 rounded-card bg-card px-8 py-6">
      <div className="col-span-12 md:col-span-7">
        <div className="font-serif text-cartela leading-tight font-semibold">
          {t("library.missing.title", { title: book.title })}
        </div>
        <div className="mt-2 text-base text-ink-2">{t("library.missing.body")}</div>
      </div>
      <div className="col-span-12 flex justify-end gap-6 md:col-span-5">
        <button
          type="button"
          onClick={() => relink.mutate()}
          disabled={relink.isPending}
          className={primaryButton}
        >
          {t("library.missing.find")}
        </button>
        <button
          type="button"
          onClick={() => remove.mutate(book.id)}
          disabled={remove.isPending}
          className={ghostButton}
        >
          {t("library.missing.remove")}
        </button>
      </div>
    </div>
  );
}

/** First time: invites to add a folder, with the empty wall of frames behind (DESIGN.md, estado vacío). */
export function EmptyLibrary({
  onAddFolder,
  onOpenFile,
  busy,
}: {
  onAddFolder: () => void;
  onOpenFile: () => void;
  busy: boolean;
}) {
  const t = useT();
  return (
    <section className="flex flex-col items-center gap-10 py-16 text-center">
      <div className="text-label font-semibold tracking-kicker text-accent-text uppercase">
        {t("library.empty.kicker")}
      </div>
      <h2 className="font-serif text-feature leading-none font-semibold">{t("library.empty.title")}</h2>
      <p className="max-w-[560px] text-reading leading-[1.75] text-ink-2">{t("library.empty.body")}</p>
      <div className="flex items-center gap-8">
        <button type="button" onClick={onAddFolder} disabled={busy} className={primaryButton}>
          {t("library.empty.folder")}
        </button>
        <button type="button" onClick={onOpenFile} disabled={busy} className={ghostButton}>
          {t("library.empty.file")}
        </button>
      </div>
      <div className="mt-10 flex gap-8">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-51 w-34 rounded-cover bg-card" />
        ))}
      </div>
    </section>
  );
}

/** Result of the last files dropped on the window: how many were added, and which were refused. */
export function ImportNotice() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: importResultKey,
    queryFn: async (): Promise<ImportResult | null> => null,
    staleTime: Infinity,
  });
  if (!data) return null;
  const dismiss = () => queryClient.setQueryData(importResultKey, null);
  return (
    <div role="status" className="flex flex-col gap-3 rounded-card bg-card px-8 py-5 text-ui text-ink-2">
      {data.imported.length > 0 ? (
        <span>{t("import.imported", { count: String(data.imported.length) })}</span>
      ) : null}
      {data.rejected.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-ink">{t("import.rejected", { count: String(data.rejected.length) })}</span>
          {data.rejected.map((item) => (
            <span key={item.path} className="truncate">
              {item.path} · {item.error.message}
            </span>
          ))}
        </div>
      ) : null}
      <button type="button" onClick={dismiss} className={`${smallButton} self-end`}>
        {t("import.dismiss")}
      </button>
    </div>
  );
}
