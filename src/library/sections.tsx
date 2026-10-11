import { Link } from "@tanstack/react-router";
import type { Book, Collection } from "../api/types";
import { useT } from "../i18n";
import { BookCard, Cover, ProgressLine } from "./Cover";
import { countLabel, useProgressLabel } from "./format";

/** Section label in the DESIGN.md style: numbered, versalitas, with a hairline above. */
export function SectionLabel({
  number,
  children,
  action,
}: {
  number: string;
  children: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line-strong pt-3 text-label font-semibold tracking-label uppercase">
      <span className="flex items-baseline gap-4">
        <span className="font-medium text-ink-3">{number}</span>
        {children}
      </span>
      {action}
    </div>
  );
}

/** Seguir leyendo: the last book opened as the large piece, the other started books as a discreet row. */
export function ContinueSection({ books }: { books: Book[] }) {
  const t = useT();
  const [first, ...rest] = books;
  const percent = useProgressLabel(first?.progress ?? null);
  if (!first) return null;

  const pageLine =
    first.currentPage !== null && first.pageCount !== null
      ? t("library.pageOf", { page: String(first.currentPage), pages: String(first.pageCount) })
      : null;

  return (
    <section className="flex flex-col gap-8">
      <SectionLabel number="01">{t("library.continue")}</SectionLabel>
      <div className="flex flex-wrap items-end gap-16">
        <Link to="/read/$bookId" params={{ bookId: first.id }} className="group block">
          <Cover book={first} size="lg" />
        </Link>
        <div className="flex min-w-0 max-w-[460px] flex-col justify-end">
          <div className="font-serif text-display leading-none break-words">{first.title}</div>
          {first.author ? <div className="mt-4 text-base text-ink-2">{first.author}</div> : null}
          <ProgressLine progress={first.progress} className="mt-14" />
          <div className="mt-3 flex justify-between text-ui text-ink-2">
            <span>{percent}</span>
            <span>{pageLine}</span>
          </div>
        </div>
      </div>
      {rest.length > 0 ? (
        <div className="flex flex-wrap gap-6">
          {rest.map((book) => (
            <BookCard key={book.id} book={book} size="sm" />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function FavoritesSection({
  books,
  total,
  onViewAll,
}: {
  books: Book[];
  total: number;
  onViewAll: () => void;
}) {
  const t = useT();
  if (books.length === 0) return null;
  return (
    <section className="flex flex-col gap-8">
      <SectionLabel
        number="02"
        action={
          total > books.length ? (
            <button
              type="button"
              onClick={onViewAll}
              className="text-base font-medium tracking-normal normal-case text-ink"
            >
              {t("library.viewAll")} →
            </button>
          ) : null
        }
      >
        {t("library.favorites")}
      </SectionLabel>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-8">
        {books.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </div>
    </section>
  );
}

export function CollectionsSection({ collections }: { collections: Collection[] }) {
  const t = useT();
  if (collections.length === 0) return null;
  return (
    <section className="flex flex-col gap-8">
      <SectionLabel number="03">{t("library.collections")}</SectionLabel>
      <div className="flex flex-col">
        {collections.map((collection) => (
          <Link
            key={collection.id}
            to="/collection/$collectionId"
            params={{ collectionId: collection.id }}
            className="group flex flex-wrap items-end gap-10 border-t border-line py-6"
          >
            <div className="min-w-[220px] flex-1">
              <div className="font-serif text-sala leading-tight group-hover:text-ink-2">
                {collection.name}
              </div>
              <div className="mt-2 text-ui text-ink-3">{countLabel(collection.bookCount, t)}</div>
            </div>
            <div className="flex gap-4">
              {collection.sampleBooks.map((book) => (
                <Cover key={book.id} book={book} size="sm" />
              ))}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
