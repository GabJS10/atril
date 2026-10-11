import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useT } from "../i18n";
import { useCollectionMutations } from "./collectionActions";
import { BookCard } from "./Cover";
import { countLabel } from "./format";
import { useBooks, useHome } from "./queries";

/** A Sala: its books, with rename and delete. Deleting a Sala never deletes books. */
export function CollectionScreen({ collectionId }: { collectionId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const home = useHome();
  const books = useBooks({ collectionId, sort: "title" });
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

  return (
    <main className="flex min-h-screen flex-col gap-12 px-16 pb-16">
      <header className="grid grid-cols-12 items-center gap-6 border-b border-line-strong py-5">
        <Link to="/" className="col-span-4 text-base font-medium text-ink">
          ← {t("settings.back")}
        </Link>
        <div className="col-span-8 flex justify-end gap-6 text-base">
          <button
            type="button"
            onClick={() => {
              setName(collection?.name ?? "");
              setEditing(true);
            }}
            className="text-ink"
          >
            {t("collections.rename")}
          </button>
          <button type="button" onClick={() => setConfirmDelete(true)} className="text-ink-2">
            {t("collections.delete")}
          </button>
        </div>
      </header>

      {confirmDelete ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-6 border border-line bg-surface px-7 py-5"
        >
          <span className="text-base text-ink-2">{t("collections.deleteConfirm")}</span>
          <div className="flex gap-6">
            <button
              type="button"
              className="font-medium text-ink"
              onClick={() => remove.mutate(collectionId, { onSuccess: () => navigate({ to: "/" }) })}
            >
              {t("collections.confirm")}
            </button>
            <button type="button" className="text-ink-2" onClick={() => setConfirmDelete(false)}>
              {t("collections.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-4"
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
              className="min-w-[320px] border-0 border-b border-line bg-transparent font-serif text-hero leading-[0.95] text-ink"
            />
            <button type="submit" className="border border-line-strong px-4 py-2 text-base font-medium">
              {t("collections.save")}
            </button>
            <button type="button" className="text-base text-ink-2" onClick={() => setEditing(false)}>
              {t("collections.cancel")}
            </button>
          </form>
        ) : (
          <h1 className="font-serif text-hero leading-[0.95]">{collection?.name ?? ""}</h1>
        )}
        <div className="text-ui text-ink-3">{countLabel(books.data?.length ?? 0, t)}</div>
      </div>

      {books.data && books.data.length === 0 ? <p className="text-ink-2">{t("collection.empty")}</p> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-6 gap-y-10">
        {(books.data ?? []).map((book) => (
          <BookCard key={book.id} book={book} collectionId={collectionId} />
        ))}
      </div>
    </main>
  );
}
