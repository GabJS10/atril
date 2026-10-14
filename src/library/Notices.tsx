import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "../i18n";
import type { Book, ImportResult } from "../api/types";
import { ghostButton, primaryButton, secondaryButton, smallButton } from "../ui/buttons";
import { DownloadIcon } from "../ui/icons";
import { StateCard } from "../ui/StateCard";
import { useRelinkBook, useRemoveBook } from "./actions";
import { importResultKey } from "./useFileDrop";

/** Scan in progress, over a library that already has books: a slim card with a quiet pulse (DESIGN.md, aviso). */
export function ScanBar({ found }: { found: number }) {
  const t = useT();
  return (
    <div role="status" className="flex items-center gap-3 rounded-tile bg-card px-6 py-4 text-ui text-ink-2">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-dot bg-accent motion-safe:animate-pulse" />
      <span>{t("library.scanning")}</span>
      <span className="ml-auto tabular-nums">{t("library.scanningFound", { found: String(found) })}</span>
    </div>
  );
}

/** First scan over an empty library: there is nothing else to show yet, so the wait gets the whole screen. */
export function ScanningLibrary({ found }: { found: number }) {
  const t = useT();
  return (
    <StateCard role="status" size="lg" title={t("library.scanning.title")} body={t("library.scanning.body")}>
      <div className="flex items-center gap-3 text-ui text-ink-2">
        <span aria-hidden="true" className="size-2 rounded-dot bg-accent motion-safe:animate-pulse" />
        <span className="tabular-nums">{t("library.scanningFound", { found: String(found) })}</span>
      </div>
    </StateCard>
  );
}

/** Books whose file is gone: the reader cannot open them, but nothing is lost (DESIGN.md, aviso). One card each; the caller spaces them. */
export function MissingBanner({ books }: { books: Book[] }) {
  const t = useT();
  const relink = useRelinkBook();
  const remove = useRemoveBook();
  if (books.length === 0) return null;
  return (
    <>
      {books.map((book) => (
        <StateCard
          key={book.id}
          role="alert"
          title={t("library.missing.title", { title: book.title })}
          body={t("library.missing.body")}
          actions={
            <>
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
            </>
          }
        />
      ))}
    </>
  );
}

/** Books Atril could not index (`scanState: failed`): the file is there but unreadable. Same two ways out as a missing one. */
export function UnreadableBanner({ books }: { books: Book[] }) {
  const t = useT();
  const relink = useRelinkBook();
  const remove = useRemoveBook();
  if (books.length === 0) return null;
  return (
    <>
      {books.map((book) => (
        <StateCard
          key={book.id}
          role="alert"
          title={t("library.failed.title", { title: book.title })}
          body={t("library.failed.body")}
          actions={
            <>
              <button
                type="button"
                onClick={() => relink.mutate()}
                disabled={relink.isPending}
                className={secondaryButton}
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
            </>
          }
        />
      ))}
    </>
  );
}

/** The library or a list could not be loaded: say so in plain words and offer to try again. */
export function LoadError({ onRetry, title, body }: { onRetry: () => void; title: string; body: string }) {
  const t = useT();
  return (
    <StateCard
      role="alert"
      title={title}
      body={body}
      actions={
        <button type="button" onClick={onRetry} className={primaryButton}>
          {t("common.retry")}
        </button>
      }
    />
  );
}

/** The two ways to bring books in, shared by every screen that can find the library empty. */
export function AddBooksActions({
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
    <>
      <button type="button" onClick={onAddFolder} disabled={busy} className={primaryButton}>
        {t("library.empty.folder")}
      </button>
      <button type="button" onClick={onOpenFile} disabled={busy} className={secondaryButton}>
        {t("library.empty.file")}
      </button>
    </>
  );
}

/** First time: a welcome with the two ways in and a hint about dropping files on the window (DESIGN.md, estado vacío). */
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
    <StateCard
      size="lg"
      kicker={t("library.empty.kicker")}
      title={t("library.empty.title")}
      body={t("library.empty.body")}
      actions={<AddBooksActions onAddFolder={onAddFolder} onOpenFile={onOpenFile} busy={busy} />}
    >
      <p className="mt-6 flex items-center gap-3 rounded-tile border-[1.5px] border-dashed border-line px-6 py-4 text-ui text-ink-2">
        <DownloadIcon size={20} />
        {t("library.empty.drop")}
      </p>
    </StateCard>
  );
}

/** The last name of a path, whatever the separator. */
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Result of the last files dropped on the window or opened from the dialog: how many were added, and which were refused. */
export function ImportNotice({ className = "" }: { className?: string }) {
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
    <div
      role="status"
      className={`flex flex-col gap-3 rounded-card bg-card px-8 py-5 text-ui text-ink-2 ${className}`}
    >
      {data.imported.length > 0 ? (
        <span>{t("import.imported", { count: String(data.imported.length) })}</span>
      ) : null}
      {data.rejected.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-ink">
            {data.rejected.length === 1
              ? t("import.rejectedOne")
              : t("import.rejected", { count: String(data.rejected.length) })}
          </span>
          {data.rejected.map((item) => (
            <span key={item.path} className="truncate">
              {baseName(item.path)} ·{" "}
              {t(item.error.code === "invalid_pdf" ? "import.reason.invalid" : "import.reason.other")}
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
