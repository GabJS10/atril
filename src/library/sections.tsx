import { Link } from "@tanstack/react-router";
import type { Book, Collection, Highlight } from "../api/types";
import { useT } from "../i18n";
import { useHighlights } from "../reader/highlights";
import { PIGMENT_COLOR, PIGMENT_KEY } from "../reader/highlightPresentation";
import { ArrowRightIcon, BookOpenIcon, PlusIcon } from "../ui/icons";
import { primaryButton, secondaryButton, textLink } from "../ui/buttons";
import { useBookDragSource, useBookDragStore } from "./bookDrag";
import { BookCard, Cover, ProgressBar, type CoverSize } from "./Cover";
import { BookMenu } from "./BookMenu";
import { countLabel, pagesLeftLabel, useProgressLabel } from "./format";
import { roomColorOf, tintOf } from "./identity";
import { NewRoom } from "./NewRoom";

/** Title of a section: serif, with its count and, to the right, an optional action. */
export function SectionHeader({
  id,
  title,
  count,
  action,
}: {
  id: string;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3.5">
      <h2 id={id} className="font-serif text-sala leading-none font-semibold">
        {title}
      </h2>
      {count === undefined ? null : <span className="text-ui text-ink-3">{count}</span>}
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

/** The most recent highlight of a book, or null when it has none. */
function latestHighlight(highlights: Highlight[]): Highlight | null {
  let latest: Highlight | null = null;
  for (const highlight of highlights) {
    if (!latest || highlight.createdAt > latest.createdAt) latest = highlight;
  }
  return latest;
}

/** Size of the title in "Seguir leyendo": long titles step down so they stay a few lines. */
function heroTitleClass(title: string): string {
  if (title.length <= 22) return "text-feature leading-[0.98]";
  if (title.length <= 40) return "text-page leading-none";
  return "text-sala leading-[1.05]";
}

/**
 * Seguir leyendo (DESIGN.md, tarjeta "Seguir leyendo"): the last book opened as a large card tinted with the colour
 * of its cover, with its progress and, when it has one, its latest highlight.
 */
export function ContinueCard({ book }: { book: Book }) {
  const t = useT();
  const startDrag = useBookDragSource(book);
  const percent = useProgressLabel(book.progress);
  const highlights = useHighlights(book.id);
  const all = highlights.data ?? [];
  const last = latestHighlight(all);
  const pageLine =
    book.currentPage !== null && book.pageCount !== null
      ? t("library.pageOf", { page: String(book.currentPage), pages: String(book.pageCount) })
      : null;
  const color = tintOf(book.coverColor);
  const tint = color ? ({ "--tint": color } as React.CSSProperties) : undefined;

  return (
    <section
      aria-labelledby="continue-title"
      style={tint}
      className={`flex flex-wrap gap-8 rounded-card p-10 ${color ? "bg-cover-tint" : "bg-card"}`}
    >
      <div className="group relative self-center select-none" onPointerDown={startDrag}>
        <Link to="/read/$bookId" params={{ bookId: book.id }} className="block rounded-tab" draggable={false}>
          <Cover book={book} size="xl" />
        </Link>
        <BookMenu book={book} />
      </div>

      <div className="flex min-w-0 flex-1 basis-72 flex-col justify-center gap-3.5">
        <div className="text-label font-semibold tracking-kicker text-accent-text uppercase">
          {t("library.continue")}
        </div>
        <h2
          id="continue-title"
          className={`line-clamp-3 font-serif font-semibold break-words ${heroTitleClass(book.title)}`}
        >
          {book.title}
        </h2>
        {book.author ? <div className="text-body text-ink-2">{book.author}</div> : null}
        <div className="mt-4 flex max-w-115 flex-col gap-2.5">
          <ProgressBar progress={book.progress} thick />
          <div className="flex justify-between text-ui text-ink-2">
            <span>{percent}</span>
            <span>{pageLine}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/read/$bookId" params={{ bookId: book.id }} className={primaryButton}>
            <BookOpenIcon />
            {t("home.resume")}
          </Link>
          {all.length > 0 ? (
            <Link
              to="/read/$bookId"
              params={{ bookId: book.id }}
              search={{ panel: "highlights" }}
              className={secondaryButton}
            >
              {t("highlightPanel.toggle")} · {all.length}
            </Link>
          ) : null}
        </div>
      </div>

      {last ? (
        <aside
          aria-label={t("home.lastHighlight.label")}
          className="flex max-w-85 min-w-60 flex-1 basis-60 flex-col gap-4 rounded-tile bg-veil p-6"
        >
          <div className="flex items-center gap-2.5 text-label font-semibold tracking-label text-ink-2 uppercase">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-dot"
              style={{ background: PIGMENT_COLOR[last.color] }}
            />
            {t("home.lastHighlight", { page: String(last.page) })}
          </div>
          <p className="line-clamp-6 font-serif text-quote leading-[1.4] font-medium italic">
            <span
              className="highlight-mark px-0.5"
              style={{ "--mark": PIGMENT_COLOR[last.color] } as React.CSSProperties}
            >
              <span className="sr-only">{t(PIGMENT_KEY[last.color])}: </span>
              {last.text}
            </span>
          </p>
          {last.note ? (
            <div className="line-clamp-3 text-ui text-ink-2">
              {t("home.lastHighlight.note", { note: last.note })}
            </div>
          ) : null}
          <Link
            to="/read/$bookId"
            params={{ bookId: book.id }}
            search={{ panel: "highlights" }}
            className="mt-auto inline-flex items-center gap-2 text-ui font-semibold text-ink hover:text-ink-2"
          >
            {all.length === 1
              ? t("home.viewHighlightsOne")
              : t("home.viewHighlights", { count: String(all.length) })}
            <ArrowRightIcon size={16} />
          </Link>
        </aside>
      ) : null}
    </section>
  );
}

/** También en curso: the other started books, as cards with their progress. */
export function AlsoReading({ books }: { books: Book[] }) {
  const t = useT();
  if (books.length === 0) return null;
  return (
    <section aria-labelledby="also-title" className="flex flex-col gap-5">
      <SectionHeader id="also-title" title={t("home.alsoReading")} count={books.length} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {books.map((book) => (
          <ReadingTile key={book.id} book={book} />
        ))}
      </div>
    </section>
  );
}

function ReadingTile({ book }: { book: Book }) {
  const t = useT();
  const startDrag = useBookDragSource(book);
  const percent = useProgressLabel(book.progress);
  const left = pagesLeftLabel(book, t);
  return (
    <Link
      to="/read/$bookId"
      params={{ bookId: book.id }}
      draggable={false}
      onPointerDown={startDrag}
      className="flex items-center gap-4 rounded-tile bg-card p-4 transition-colors duration-fast ease-atril select-none hover:bg-raised"
    >
      <Cover book={book} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="line-clamp-2 font-serif text-title-md leading-[1.05] font-semibold">{book.title}</div>
        {book.author ? <div className="truncate text-ui text-ink-2">{book.author}</div> : null}
        <ProgressBar progress={book.progress} className="mt-1.5" />
        <div className="text-caption text-ink-3">{[percent, left].filter(Boolean).join(" · ")}</div>
      </div>
    </Link>
  );
}

/** Favoritos: a band of tone with the covers in a row. */
export function FavoritesBand({ books, total }: { books: Book[]; total: number }) {
  const t = useT();
  if (books.length === 0) return null;
  return (
    <section aria-labelledby="fav-title" className="flex flex-col gap-5">
      <SectionHeader
        id="fav-title"
        title={t("library.favorites")}
        count={total}
        action={
          <Link to="/books/$scope" params={{ scope: "favorites" }} className={textLink}>
            {t("library.viewAll")} →
          </Link>
        }
      />
      <div className="rounded-card bg-card px-9 pt-9 pb-7">
        <div className="flex gap-8 overflow-x-auto pb-2">
          {books.map((book) => (
            <BookCard key={book.id} book={book} size="md" />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Up to three covers in a fan: the preview of a Sala. */
export function CoverFan({
  books,
  size,
  className,
}: {
  books: Book[];
  size: Extract<CoverSize, "xs" | "lg">;
  className: string;
}) {
  const shown = books.slice(0, 3);
  const positions =
    size === "xs"
      ? {
          1: ["left-14 top-1 z-20"],
          2: ["left-6 top-0 -rotate-6 z-10", "left-22 top-1 rotate-6 z-20"],
          3: ["left-0 top-0 -rotate-9 z-10", "left-14 top-1 z-20", "left-28 top-0 rotate-9 z-10"],
        }
      : {
          1: ["left-27.5 top-0 z-20"],
          2: ["left-14 top-4.5 -rotate-10 z-10", "left-41 top-4.5 rotate-10 z-10"],
          3: ["left-0 top-4.5 -rotate-10 z-10", "left-27.5 top-0 z-20", "left-52.5 top-4.5 rotate-10 z-10"],
        };
  const slots = positions[shown.length as 1 | 2 | 3];
  if (!slots) return null;
  return (
    <div aria-hidden="true" className={`relative flex-none ${className}`}>
      {shown.map((book, index) => (
        <div key={book.id} className={`absolute ${slots[index]}`}>
          <Cover book={book} size={size} />
        </div>
      ))}
    </div>
  );
}

/** Salas: a card per Sala, tinted with its colour, with its covers in a fan. Drop a book on one to add it (bookDrag.ts). */
export function RoomsSection({ collections }: { collections: Collection[] }) {
  const t = useT();
  const overRoomId = useBookDragStore((state) => state.drag?.overRoomId ?? null);

  return (
    <section aria-labelledby="rooms-title" className="flex flex-col gap-5">
      <SectionHeader id="rooms-title" title={t("library.collections")} count={collections.length} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-5">
        {collections.map((collection) => (
          <Link
            key={collection.id}
            to="/collection/$collectionId"
            params={{ collectionId: collection.id }}
            data-room={roomColorOf(collection.id)}
            data-room-id={collection.id}
            className={`group flex min-h-50 flex-wrap items-center gap-6 rounded-card bg-room-tint p-8 transition-shadow duration-fast ease-atril ${
              overRoomId === collection.id ? "ring-2 ring-accent" : ""
            }`}
          >
            <div className="flex min-w-35 flex-1 flex-col gap-2">
              <div className="font-serif text-room-name leading-none font-semibold group-hover:text-ink-2">
                {collection.name}
              </div>
              <div className="text-ui text-ink-2">{countLabel(collection.bookCount, t)}</div>
            </div>
            <CoverFan books={collection.sampleBooks} size="xs" className="h-40 w-52.5" />
          </Link>
        ))}
        <NewRoom
          className="flex min-h-50 flex-col items-center justify-center gap-2.5 rounded-card border-[1.5px] border-dashed border-line text-base text-ink-2 transition-colors duration-fast ease-atril hover:text-ink"
          inputClassName="min-h-50 w-full rounded-card bg-field px-8 text-center text-base text-ink placeholder:text-ink-3"
        >
          <PlusIcon size={26} />
          {t("collections.create")}
        </NewRoom>
      </div>
    </section>
  );
}

/** Añadidos hace poco: the newest books of the library. */
export function RecentlyAdded({ books }: { books: Book[] }) {
  const t = useT();
  if (books.length === 0) return null;
  return (
    <section aria-labelledby="recent-title" className="flex flex-col gap-5">
      <SectionHeader
        id="recent-title"
        title={t("home.recent")}
        action={
          <Link to="/books/$scope" params={{ scope: "all" }} className={textLink}>
            {t("nav.all")} →
          </Link>
        }
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-6 gap-y-8">
        {books.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </div>
    </section>
  );
}
