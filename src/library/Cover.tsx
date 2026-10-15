import { Link } from "@tanstack/react-router";
import type { Book } from "../api/types";
import { useT } from "../i18n";
import { StarIcon } from "../ui/icons";
import { useToggleFavorite } from "./actions";
import { useBookDragSource } from "./bookDrag";
import { BookMenu } from "./BookMenu";
import { useProgressLabel } from "./format";
import { coverToneOf } from "./identity";

export type CoverSize = "xl" | "lg" | "md" | "sm" | "xs" | "fluid";

/** Width of each cover size (DESIGN.md, portadas): the height follows the 2 : 3 proportion. */
const WIDTH: Record<CoverSize, string> = {
  xl: "w-55",
  lg: "w-40",
  md: "w-37.5",
  sm: "w-16",
  xs: "w-25",
  fluid: "w-full",
};

/**
 * A book cover, always in colour (DESIGN.md, portadas): the real one with its spine and shadow or, while there is
 * none (still indexing, or it failed), a typographic cover whose colours come from the book's id. The typographic
 * one is decoration: the title is always written next to it.
 */
export function Cover({
  book,
  size = "fluid",
  className = "",
}: {
  book: Book;
  size?: CoverSize;
  className?: string;
}) {
  const compact = size === "sm";
  return (
    <div
      className={`cover-box relative aspect-[2/3] shrink-0 overflow-hidden rounded-cover shadow-cover ${WIDTH[size]} ${
        book.missing ? "opacity-50" : ""
      } ${className}`}
    >
      {book.coverUrl ? (
        <img src={book.coverUrl} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <div
          aria-hidden="true"
          data-tone={coverToneOf(book.id)}
          className="cover-face absolute inset-0 flex flex-col justify-between overflow-hidden pt-[12cqw] pr-[7cqw] pb-[10cqw] pl-[13cqw]"
        >
          <div className="min-h-0">
            <div className="mb-[4.5cqw] h-px bg-current opacity-50" />
            <div className="cover-title line-clamp-5 font-serif leading-[1.02] font-semibold">
              {book.title}
            </div>
          </div>
          <div
            className={`cover-mark size-[8cqw] rounded-full ${book.scanState === "pending" ? "motion-safe:animate-pulse" : ""}`}
          />
          {compact ? null : (
            <div className="cover-author font-semibold tracking-[0.12em] uppercase leading-[1.3]">
              {book.author ?? ""}
            </div>
          )}
        </div>
      )}
      <span aria-hidden="true" className="cover-spine pointer-events-none absolute inset-y-0 left-0 w-1.5" />
    </div>
  );
}

/** Reading progress as a thin rounded bar with the accent fill (DESIGN.md, progreso). */
export function ProgressBar({
  progress,
  thick = false,
  className = "",
}: {
  progress: number | null;
  thick?: boolean;
  className?: string;
}) {
  const fill = Math.min(1, Math.max(0, progress ?? 0));
  return (
    <div
      aria-hidden="true"
      className={`overflow-hidden rounded-pill bg-track ${thick ? "h-1.5" : "h-1"} ${className}`}
    >
      <div className="h-full bg-accent" style={{ width: `${fill * 100}%` }} />
    </div>
  );
}

/**
 * A cover with its caption, linking to the reader. Drag it onto a Sala to add it (bookDrag.ts). The options menu and
 * the favourite toggle sit over the cover. A missing file is shown but cannot be opened.
 */
export function BookCard({
  book,
  size = "fluid",
  collectionId,
}: {
  book: Book;
  size?: CoverSize;
  collectionId?: string;
}) {
  const t = useT();
  const toggleFavorite = useToggleFavorite();
  const startDrag = useBookDragSource(book);
  const percent = useProgressLabel(book.progress);
  const finished = book.progress !== null && book.progress >= 1;
  const reading = book.progress !== null && book.progress > 0 && !finished;
  const body = (
    <>
      <div className="relative">
        <Cover
          book={book}
          size={size}
          className="transition-transform duration-base ease-atril group-hover:-translate-y-1"
        />
        {finished ? (
          <span className="absolute right-2.5 bottom-2.5 rounded-pill bg-scrim px-2.5 py-1 text-label font-semibold text-ink">
            {t("library.finished")}
          </span>
        ) : null}
      </div>
      <div className={`${WIDTH[size]} mt-3 flex min-w-0 flex-col gap-1`}>
        <div className="line-clamp-2 font-serif text-title-sm leading-[1.1] font-semibold">{book.title}</div>
        {book.author ? <div className="truncate text-caption text-ink-2">{book.author}</div> : null}
        {reading ? (
          <div className="mt-1.5 flex items-center gap-2.5">
            <ProgressBar progress={book.progress} className="flex-1" />
            <span className="text-label text-ink-3">{percent}</span>
          </div>
        ) : null}
        {book.missing ? (
          <div className="text-label tracking-label text-ink-3 uppercase">{t("library.missing.label")}</div>
        ) : book.scanState === "pending" ? (
          <div className="text-label tracking-label text-ink-3 uppercase">{t("library.pending")}</div>
        ) : book.scanState === "failed" ? (
          <div className="text-label tracking-label text-ink-3 uppercase">{t("library.failed.label")}</div>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="group relative min-w-0 shrink-0 select-none" onPointerDown={startDrag}>
      {book.missing ? (
        <div className="block">{body}</div>
      ) : (
        <Link to="/read/$bookId" params={{ bookId: book.id }} className="block rounded-tab" draggable={false}>
          {body}
        </Link>
      )}
      {book.missing ? null : <BookMenu book={book} collectionId={collectionId} />}
      {book.missing ? null : (
        <button
          type="button"
          aria-pressed={book.favorite}
          aria-label={book.favorite ? t("library.unfavorite") : t("library.favorite")}
          onClick={() => toggleFavorite.mutate({ bookId: book.id, favorite: !book.favorite })}
          className={`absolute top-2 right-2 flex size-8 items-center justify-center rounded-pill bg-scrim transition-opacity duration-base ${
            book.favorite
              ? "text-accent-text opacity-100"
              : "text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          <StarIcon size={16} filled={book.favorite} />
        </button>
      )}
    </div>
  );
}
