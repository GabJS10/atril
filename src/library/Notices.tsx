import { useT } from "../i18n";
import type { Book } from "../api/types";
import { useRelinkBook, useRemoveBook } from "./actions";

/** Scan in progress: one hairline line, no modal (DESIGN.md, estado escaneando). */
export function ScanBar({ found }: { found: number }) {
  const t = useT();
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-6 border-b border-line py-3 text-ui text-ink-2"
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
    <div
      role="alert"
      className="grid grid-cols-12 items-center gap-6 border border-line bg-surface px-7 py-6"
    >
      <div className="col-span-12 md:col-span-7">
        <div className="font-serif text-cartela leading-tight">
          {t("library.missing.title", { title: book.title })}
        </div>
        <div className="mt-2 text-base text-ink-2">{t("library.missing.body")}</div>
      </div>
      <div className="col-span-12 flex justify-end gap-6 md:col-span-5">
        <button
          type="button"
          onClick={() => relink.mutate()}
          disabled={relink.isPending}
          className="bg-ink px-4 py-2.5 text-base font-semibold text-ink-inverse disabled:opacity-50"
        >
          {t("library.missing.find")}
        </button>
        <button
          type="button"
          onClick={() => remove.mutate(book.id)}
          disabled={remove.isPending}
          className="text-base text-ink-2 underline underline-offset-4"
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
      <div className="text-label font-medium tracking-label text-ink-3 uppercase">
        {t("library.empty.kicker")}
      </div>
      <h2 className="font-serif text-display leading-none">{t("library.empty.title")}</h2>
      <p className="max-w-[560px] text-reading leading-[1.75] text-ink-2">{t("library.empty.body")}</p>
      <div className="flex items-center gap-8">
        <button
          type="button"
          onClick={onAddFolder}
          disabled={busy}
          className="bg-ink px-5 py-3 text-base font-semibold text-ink-inverse disabled:opacity-50"
        >
          {t("library.empty.folder")}
        </button>
        <button
          type="button"
          onClick={onOpenFile}
          disabled={busy}
          className="text-base text-ink-2 underline underline-offset-4"
        >
          {t("library.empty.file")}
        </button>
      </div>
      <div className="mt-10 flex gap-8">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-[204px] w-[136px] border border-line" />
        ))}
      </div>
    </section>
  );
}
