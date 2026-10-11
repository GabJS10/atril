import { Link } from "@tanstack/react-router";
import { useT } from "../i18n";
import { BookCard } from "./Cover";
import { useBooks, useHome } from "./queries";
import { countLabel } from "./format";

/** A Sala: its books, in title order. */
export function CollectionScreen({ collectionId }: { collectionId: string }) {
  const t = useT();
  const home = useHome();
  const books = useBooks({ collectionId, sort: "title" });
  const collection = home.data?.collections.find((item) => item.id === collectionId);

  return (
    <main className="flex min-h-screen flex-col gap-12 px-16 pb-16">
      <header className="grid grid-cols-12 items-center gap-6 border-b border-line-strong py-5">
        <Link to="/" className="col-span-4 text-base font-medium text-ink">
          ← {t("settings.back")}
        </Link>
      </header>
      <div className="flex flex-col gap-3">
        <h1 className="font-serif text-hero leading-[0.95]">{collection?.name ?? ""}</h1>
        <div className="text-ui text-ink-3">{countLabel(books.data?.length ?? 0, t)}</div>
      </div>
      {books.data && books.data.length === 0 ? <p className="text-ink-2">{t("collection.empty")}</p> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-6 gap-y-10">
        {(books.data ?? []).map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </div>
    </main>
  );
}
