import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { SearchIcon } from "../ui/icons";
import { useAddFolder, useOpenPdfFile } from "./actions";
import { BookGrid } from "./BookGrid";
import { EmptyLibrary, ImportNotice, MissingBanner, ScanBar } from "./Notices";
import {
  AlsoReading,
  ContinueCard,
  FavoritesBand,
  RecentlyAdded,
  RoomsSection,
  SectionHeader,
} from "./sections";
import { useBooks, useHome, useScanStatus } from "./queries";
import { useDebouncedValue } from "./useDebouncedValue";

/** How many books "Añadidos hace poco" shows. */
const RECENT_LIMIT = 8;

/** Inicio (DESIGN.md, galería): the header with its summary and search, Seguir leyendo, Favoritos, Salas and the new books. */
export function LibraryScreen() {
  const t = useT();
  const home = useHome();
  const scan = useScanStatus();
  const everything = useBooks({});
  const reading = useBooks({ status: "reading" });
  const recent = useBooks({ sort: "added", descending: true });
  const addFolder = useAddFolder();
  const openFile = useOpenPdfFile();

  const searchField = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const search = useDebouncedValue(text.trim(), 250);
  const results = useBooks({ text: search || undefined, sort: "title" });

  // Ctrl+K (Cmd+K) jumps to the search field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchField.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const data = home.data;
  const missing = (everything.data ?? []).filter((book) => book.missing);
  const busy = addFolder.isPending || openFile.isPending;
  const [first, ...others] = data?.continueReading ?? [];
  const summary = data
    ? [
        data.bookCount === 1
          ? t("library.all.countOne", { count: "1" })
          : t("library.all.count", { count: String(data.bookCount) }),
        data.collections.length === 1
          ? t("home.rooms.one", { count: "1" })
          : t("home.rooms", { count: String(data.collections.length) }),
        t("home.reading", { count: String(reading.data?.length ?? 0) }),
      ].join(" · ")
    : "";

  return (
    <main className="flex min-h-screen flex-col gap-14 px-14 pt-9 pb-18">
      <header className="flex flex-wrap items-center gap-5">
        <div className="mr-auto flex flex-col gap-1.5">
          <h1 className="font-serif text-page leading-none font-semibold">{t("library.title")}</h1>
          <p className="text-base text-ink-2">{summary}</p>
        </div>
        <label className="flex min-w-55 flex-[0_1_380px] items-center gap-2.5 rounded-field bg-field px-4 py-3 text-ink-3">
          <SearchIcon />
          <input
            ref={searchField}
            aria-label={t("library.search")}
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("library.search.placeholder")}
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
          />
          <kbd
            aria-hidden="true"
            className="rounded-tab bg-surface-2 px-1.5 py-0.5 font-sans text-label text-ink-3"
          >
            Ctrl K
          </kbd>
        </label>
      </header>

      {scan.data?.running ? <ScanBar found={scan.data.found} /> : null}
      <ImportNotice />

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
          {search ? (
            <section aria-labelledby="results-title" className="flex flex-col gap-5">
              <SectionHeader
                id="results-title"
                title={t("library.results")}
                count={results.data?.length ?? 0}
              />
              <BookGrid books={results.data ?? []} empty={t("library.noResults")} />
            </section>
          ) : (
            <>
              {first ? <ContinueCard book={first} /> : null}
              <AlsoReading books={others} />
              <FavoritesBand books={data.favorites} total={data.favoriteCount} />
              <RoomsSection collections={data.collections} />
              <RecentlyAdded books={(recent.data ?? []).slice(0, RECENT_LIMIT)} />
            </>
          )}
        </>
      ) : null}
    </main>
  );
}
