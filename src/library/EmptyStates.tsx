import { Link } from "@tanstack/react-router";
import { useT } from "../i18n";
import { primaryButton, secondaryButton } from "../ui/buttons";
import { StateCard } from "../ui/StateCard";
import { useAddFolder, useOpenPdfFile } from "./actions";
import { AddBooksActions } from "./Notices";
import type { BooksScope } from "./booksScope";

/** The search found no book: says what was searched and offers to clear it. */
export function NoSearchResults({ query, onClear }: { query: string; onClear: () => void }) {
  const t = useT();
  return (
    <StateCard
      title={t("library.noResults.title")}
      body={t("library.noResults.search", { query })}
      actions={
        <button type="button" onClick={onClear} className={secondaryButton}>
          {t("library.noResults.clear")}
        </button>
      }
    />
  );
}

/** The status filter leaves nothing to show: offers to lift it. */
export function NoFilterResults({ onClear }: { onClear: () => void }) {
  const t = useT();
  return (
    <StateCard
      title={t("library.noResults.title")}
      body={t("library.noResults.filters")}
      actions={
        <button type="button" onClick={onClear} className={secondaryButton}>
          {t("library.noResults.clearFilters")}
        </button>
      }
    />
  );
}

/** An empty list of the sidebar (Todos, Favoritos, En curso) with no filter applied. */
export function EmptyScope({ scope }: { scope: BooksScope }) {
  const t = useT();
  const addFolder = useAddFolder();
  const openFile = useOpenPdfFile();

  if (scope === "all") {
    return (
      <StateCard
        title={t("library.empty.title")}
        body={t("library.empty.body")}
        actions={
          <AddBooksActions
            busy={addFolder.isPending || openFile.isPending}
            onAddFolder={() => addFolder.mutate()}
            onOpenFile={() => openFile.mutate()}
          />
        }
      />
    );
  }

  const browse = (
    <Link to="/books/$scope" params={{ scope: "all" }} className={primaryButton}>
      {t("books.empty.browse")}
    </Link>
  );
  return scope === "favorites" ? (
    <StateCard title={t("books.empty.favorites")} body={t("books.empty.favorites.body")} actions={browse} />
  ) : (
    <StateCard title={t("books.empty.reading")} body={t("books.empty.reading.body")} actions={browse} />
  );
}

/** A Sala without books, in its own colour. */
export function EmptyRoom({ room }: { room: number }) {
  const t = useT();
  return (
    <StateCard
      tone="room"
      room={room}
      title={t("collection.empty")}
      body={t("collection.empty.body")}
      actions={
        <Link to="/books/$scope" params={{ scope: "all" }} className={primaryButton}>
          {t("collection.empty.action")}
        </Link>
      }
    />
  );
}
