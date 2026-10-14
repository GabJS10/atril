import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useT } from "../i18n";
import { ghostButton, primaryButton, secondaryButton } from "../ui/buttons";
import { StateCard } from "../ui/StateCard";
import { BookFilterBar } from "./BookFilters";
import { DEFAULT_FILTERS, filtersToQuery, type BookFilters } from "./filters";
import { BookGrid } from "./BookGrid";
import { EmptyRoom, NoFilterResults } from "./EmptyStates";
import { LoadError } from "./Notices";
import { useCollectionMutations } from "./collectionActions";
import { countLabel } from "./format";
import { roomColorOf } from "./identity";
import { useBooks, useHome } from "./queries";
import { CoverFan } from "./sections";

/** Size of the Sala's name in its header: long names step down. */
function nameClass(name: string): string {
  if (name.length <= 12) return "text-hero leading-[0.92]";
  if (name.length <= 24) return "text-obra leading-none";
  return "text-page leading-none";
}

/** A Sala (DESIGN.md, pantalla de Sala): a header tinted with its colour, filters, and its books. */
export function CollectionScreen({ collectionId }: { collectionId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const home = useHome();
  const [filters, setFilters] = useState<BookFilters>(DEFAULT_FILTERS);
  const everything = useBooks({ collectionId });
  const books = useBooks({ collectionId, ...filtersToQuery(filters) });
  const collection = home.data?.collections.find((item) => item.id === collectionId);
  const { rename, remove } = useCollectionMutations();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    rename.mutate({ collectionId, name: trimmed }, { onSuccess: () => setEditing(false) });
  };

  const all = everything.data ?? [];
  const readingCount = all.filter(
    (book) => book.progress !== null && book.progress > 0 && book.progress < 1,
  ).length;
  const finishedCount = all.filter((book) => book.progress !== null && book.progress >= 1).length;
  const summary = [
    countLabel(all.length, t),
    readingCount > 0 ? t("home.reading", { count: String(readingCount) }) : null,
    finishedCount === 1
      ? t("collection.finished.one", { count: "1" })
      : finishedCount > 1
        ? t("collection.finished", { count: String(finishedCount) })
        : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // A link to a Sala that was deleted (or never existed).
  if (home.data && !collection) {
    return (
      <main className="flex min-h-screen flex-col gap-11 px-14 pt-9 pb-18">
        <StateCard
          heading={1}
          title={t("collection.gone")}
          body={t("collection.gone.body")}
          actions={
            <Link to="/" className={primaryButton}>
              {t("notFound.back")}
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-11 px-14 pt-9 pb-18">
      <section
        aria-labelledby="room-title"
        data-room={roomColorOf(collectionId)}
        className="flex flex-wrap items-center gap-10 overflow-hidden rounded-panel bg-room-tint px-12 py-10"
      >
        <div className="flex min-w-0 flex-1 basis-95 flex-col gap-3">
          <Link to="/" className="self-start text-ui text-ink-2 hover:text-ink">
            ← {t("settings.back")}
          </Link>
          <div className="mt-3 text-label font-semibold tracking-kicker text-room-ink uppercase">
            {t("collection.kicker")}
          </div>
          {editing ? (
            <form
              className="flex flex-wrap items-center gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                saveName();
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                aria-label={t("collections.placeholder")}
                className="min-w-0 flex-1 basis-80 rounded-field bg-veil px-4 py-2 font-serif text-obra leading-none font-semibold text-ink"
              />
              <button type="submit" className={primaryButton}>
                {t("collections.save")}
              </button>
              <button type="button" className={ghostButton} onClick={() => setEditing(false)}>
                {t("collections.cancel")}
              </button>
            </form>
          ) : (
            <h1
              id="room-title"
              className={`font-serif font-semibold break-words ${nameClass(collection?.name ?? "")}`}
            >
              {collection?.name ?? ""}
            </h1>
          )}
          <p className="text-body text-ink-2">{summary}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setName(collection?.name ?? "");
                setEditing(true);
              }}
              className={secondaryButton}
            >
              {t("collections.rename")}
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} className={ghostButton}>
              {t("collections.delete")}
            </button>
          </div>
        </div>
        {collection ? (
          <CoverFan books={collection.sampleBooks} size="lg" className="hidden h-65 w-95 lg:block" />
        ) : null}
      </section>

      {confirmDelete ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-6 rounded-card bg-card px-8 py-5"
        >
          <span className="text-base text-ink-2">{t("collections.deleteConfirm")}</span>
          <div className="flex gap-3">
            <button
              type="button"
              className={primaryButton}
              onClick={() => remove.mutate(collectionId, { onSuccess: () => navigate({ to: "/" }) })}
            >
              {t("collections.confirm")}
            </button>
            <button type="button" className={ghostButton} onClick={() => setConfirmDelete(false)}>
              {t("collections.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {all.length > 0 ? <BookFilterBar filters={filters} onChange={setFilters} /> : null}
      {everything.isError || books.isError ? (
        <LoadError
          title={t("library.error")}
          body={t("library.error.body")}
          onRetry={() => {
            void everything.refetch();
            void books.refetch();
          }}
        />
      ) : null}
      {everything.data && all.length === 0 ? <EmptyRoom room={roomColorOf(collectionId)} /> : null}
      {books.data ? (
        <BookGrid
          books={books.data}
          collectionId={collectionId}
          empty={
            all.length > 0 ? (
              <NoFilterResults onClear={() => setFilters({ ...filters, status: undefined })} />
            ) : undefined
          }
        />
      ) : null}
    </main>
  );
}
