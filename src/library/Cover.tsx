import { Link } from "@tanstack/react-router";
import type { Book } from "../api/types";
import { useT } from "../i18n";
import { useToggleFavorite } from "./actions";
import { BookMenu } from "./BookMenu";

export type CoverSize = "lg" | "md" | "sm";

const WIDTH: Record<CoverSize, string> = { lg: "w-[240px]", md: "w-full", sm: "w-[110px]" };
const TITLE: Record<CoverSize, string> = { lg: "text-sala", md: "text-cartela", sm: "text-ui" };

/**
 * A cover in greyscale; it recovers its colour on hover or keyboard focus (DESIGN.md, portadas).
 * Without a cover yet, the book's title stands in for it.
 */
export function Cover({ book, size = "md" }: { book: Book; size?: CoverSize }) {
  const t = useT();
  return (
    <div
      className={`aspect-[2/3] ${WIDTH[size]} overflow-hidden bg-surface grayscale transition-[filter] duration-slow ease-atril group-hover:grayscale-0 group-focus-visible:grayscale-0 ${
        book.missing ? "opacity-50" : ""
      }`}
    >
      {book.coverUrl ? (
        <img src={book.coverUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col justify-between border border-line p-3">
          <span className="text-label tracking-label text-ink-3 uppercase">
            {book.scanState === "pending" ? t("library.pending") : ""}
          </span>
          <span className={`font-serif leading-tight text-ink-2 ${TITLE[size]}`}>{book.title}</span>
        </div>
      )}
    </div>
  );
}

/** Reading progress as a hairline with its fill (DESIGN.md, cartela). */
export function ProgressLine({ progress, className = "" }: { progress: number | null; className?: string }) {
  const fill = Math.min(1, Math.max(0, progress ?? 0));
  return (
    <div className={`relative h-px bg-line ${className}`}>
      <span className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${fill * 100}%` }} />
    </div>
  );
}

export const BOOK_DRAG_TYPE = "application/x-atril-book";

/**
 * A cover with its caption, linking to the reader. Drag it onto a Sala to add it. The options menu and the
 * favourite toggle sit over the cover. A missing file is shown but cannot be opened.
 */
export function BookCard({
  book,
  size = "md",
  collectionId,
}: {
  book: Book;
  size?: CoverSize;
  collectionId?: string;
}) {
  const t = useT();
  const toggleFavorite = useToggleFavorite();
  const body = (
    <>
      <Cover book={book} size={size} />
      <div className={`${WIDTH[size]} mt-4 min-w-0`}>
        <div className={`truncate font-serif leading-tight ${TITLE[size]}`}>{book.title}</div>
        {book.author ? <div className="mt-1 truncate text-ui text-ink-2">{book.author}</div> : null}
        {book.missing ? (
          <div className="mt-1 text-label tracking-label text-ink-3 uppercase">
            {t("library.missing.label")}
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <div
      className="group relative min-w-0"
      draggable={!book.missing}
      onDragStart={(event) => {
        event.dataTransfer.setData(BOOK_DRAG_TYPE, book.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
    >
      {book.missing ? (
        <div className="block">{body}</div>
      ) : (
        <Link to="/read/$bookId" params={{ bookId: book.id }} className="block" draggable={false}>
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
          className={`absolute top-2 right-2 flex h-8 w-8 items-center justify-center bg-canvas/80 text-ink transition-opacity duration-base ${
            book.favorite ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill={book.favorite ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.25"
            aria-hidden="true"
          >
            <path d="M12 3.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3.1-5.4 3.1 1.2-6-4.5-4.2 6.1-.7z" />
          </svg>
        </button>
      )}
    </div>
  );
}
