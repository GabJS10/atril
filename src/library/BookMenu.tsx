import { useState } from "react";
import type { Book } from "../api/types";
import { useT } from "../i18n";
import { useRemoveBook } from "./actions";
import { useCollectionMutations } from "./collectionActions";
import { useHome } from "./queries";

/**
 * Options of one book: add it to a Sala, take it out of the Sala it is shown in, or remove it from the
 * library (asks first; the file is never deleted).
 */
export function BookMenu({ book, collectionId }: { book: Book; collectionId?: string }) {
  const t = useT();
  const home = useHome();
  const { add, removeBooks } = useCollectionMutations();
  const removeBook = useRemoveBook();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const collections = home.data?.collections ?? [];

  const close = () => {
    setOpen(false);
    setConfirming(false);
  };

  return (
    <div className="absolute top-2 left-2 z-10">
      <button
        type="button"
        aria-label={t("book.options")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-8 w-8 items-center justify-center bg-canvas/80 text-ink transition-opacity duration-base ${
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      >
        <span aria-hidden="true" className="text-base leading-none">
          ⋯
        </span>
      </button>

      {open ? (
        <div className="mt-2 flex w-[240px] flex-col gap-1 border border-line bg-surface p-2 text-ui">
          {collectionId ? (
            <button
              type="button"
              className="px-2 py-2 text-left hover:text-ink-2"
              onClick={() => {
                removeBooks.mutate({ bookIds: [book.id], collectionId });
                close();
              }}
            >
              {t("collections.removeFrom")}
            </button>
          ) : null}

          {collections.length === 0 ? (
            <span className="px-2 py-2 text-ink-3">{t("collections.noneYet")}</span>
          ) : (
            collections.map((collection) => (
              <button
                key={collection.id}
                type="button"
                className="px-2 py-2 text-left hover:text-ink-2"
                onClick={() => {
                  add.mutate({ bookIds: [book.id], collectionId: collection.id });
                  close();
                }}
              >
                {t("collections.addTo", { name: collection.name })}
              </button>
            ))
          )}

          <div className="my-1 border-t border-line" />
          {confirming ? (
            <div className="flex flex-col gap-2 px-2 py-2">
              <p className="text-ink-2">{t("book.removeConfirm")}</p>
              <div className="flex gap-4">
                <button
                  type="button"
                  className="font-medium text-ink"
                  onClick={() => {
                    removeBook.mutate(book.id);
                    close();
                  }}
                >
                  {t("collections.confirm")}
                </button>
                <button type="button" className="text-ink-2" onClick={() => setConfirming(false)}>
                  {t("collections.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="px-2 py-2 text-left hover:text-ink-2"
              onClick={() => setConfirming(true)}
            >
              {t("book.remove")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
