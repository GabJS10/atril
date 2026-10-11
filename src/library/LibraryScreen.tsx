import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { BookQuery } from "../api/types";
import { useT } from "../i18n";
import { AllBooks, type AllBooksFilters } from "./AllBooks";
import { useAddFolder, useOpenPdfFile } from "./actions";
import { CollectionsSection, ContinueSection, FavoritesSection } from "./sections";
import { useBooks, useHome, useScanStatus } from "./queries";
import { EmptyLibrary, MissingBanner, ScanBar } from "./Notices";
import { useDebouncedValue } from "./useDebouncedValue";

/** The gallery wall (DESIGN.md, dirección B): Seguir leyendo, Favoritos, Salas and Todos. */
export function LibraryScreen() {
  const t = useT();
  const home = useHome();
  const scan = useScanStatus();
  const everything = useBooks({});
  const addFolder = useAddFolder();
  const openFile = useOpenPdfFile();

  const [text, setText] = useState("");
  const search = useDebouncedValue(text.trim(), 250);
  const [filters, setFilters] = useState<AllBooksFilters>({
    status: undefined,
    sort: "title",
    favoritesOnly: false,
  });
  const query: BookQuery = {
    text: search || undefined,
    status: filters.status,
    sort: filters.sort,
    favoritesOnly: filters.favoritesOnly || undefined,
  };
  const todos = useBooks(query);

  const data = home.data;
  const missing = (everything.data ?? []).filter((book) => book.missing);
  const busy = addFolder.isPending || openFile.isPending;
  const showFullWall = !search;

  return (
    <main className="flex min-h-screen flex-col gap-16 px-16 pb-16">
      <header className="grid grid-cols-12 items-center gap-6 border-b border-line-strong py-5">
        <div className="col-span-3 text-base font-semibold tracking-wordmark uppercase">{t("app.name")}</div>
        <div className="col-span-6">
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label={t("library.search")}
            placeholder={t("library.search")}
            className="w-full border-0 border-b border-line bg-transparent py-2 text-base text-ink placeholder:text-ink-3"
          />
        </div>
        <div className="col-span-3 flex justify-end">
          <Link to="/settings" className="text-base font-medium text-ink">
            {t("library.settings")}
          </Link>
        </div>
      </header>

      {scan.data?.running ? <ScanBar found={scan.data.found} /> : null}

      {home.isError ? (
        <p role="alert" className="text-ink-2">
          {t("library.error")}
        </p>
      ) : null}

      {data && data.bookCount === 0 && !scan.data?.running ? (
        <EmptyLibrary
          busy={busy}
          onAddFolder={() => addFolder.mutate()}
          onOpenFile={() => openFile.mutate()}
        />
      ) : null}

      {data && data.bookCount > 0 ? (
        <>
          <MissingBanner books={missing} />
          {showFullWall ? (
            <>
              <ContinueSection books={data.continueReading} />
              <FavoritesSection
                books={data.favorites}
                total={data.favoriteCount}
                onViewAll={() => setFilters((current) => ({ ...current, favoritesOnly: true }))}
              />
              <CollectionsSection collections={data.collections} />
            </>
          ) : null}
          <AllBooks
            books={todos.data ?? []}
            filters={filters}
            onChange={setFilters}
            searching={!!search}
            hasFilters={filters.status !== undefined || filters.favoritesOnly}
            label={filters.favoritesOnly ? t("library.favorites") : t("library.all")}
          />
          {filters.favoritesOnly ? (
            <button
              type="button"
              onClick={() => setFilters((current) => ({ ...current, favoritesOnly: false }))}
              className="self-start text-ui text-ink-2 underline underline-offset-4"
            >
              {t("library.all")}
            </button>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
