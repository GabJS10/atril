import { Link } from "@tanstack/react-router";
import { useT } from "../i18n";
import { ClockIcon, DownloadIcon, HomeIcon, LogoMark, ShelfIcon, SlidersIcon, StarIcon } from "../ui/icons";
import { secondaryButton } from "../ui/buttons";
import { useOpenPdfFile } from "./actions";
import { roomColorOf } from "./identity";
import { NewRoom } from "./NewRoom";
import { useBooks, useHome } from "./queries";

const NAV_ITEM =
  "flex min-h-6 items-center gap-3 rounded-control px-3 py-2.5 text-base text-ink-2 transition-colors duration-fast ease-atril hover:bg-raised hover:text-ink";
const NAV_ACTIVE = "bg-surface-2 text-ink";
const COUNT = "ml-auto text-caption text-ink-3";

/** The sidebar of the library (DESIGN.md, barra lateral): navigation with counters, the Salas, and the actions. */
export function Sidebar() {
  const t = useT();
  const home = useHome();
  const reading = useBooks({ status: "reading" });
  const openFile = useOpenPdfFile();
  const data = home.data;

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col gap-7 overflow-y-auto bg-surface px-5 py-8">
      <div className="flex items-center gap-3 px-3 text-accent-text">
        <LogoMark size={22} />
        <span className="text-body font-bold tracking-wordmark text-ink uppercase">{t("app.name")}</span>
      </div>

      <nav aria-label={t("nav.library")} className="flex flex-col gap-0.5">
        <Link
          to="/"
          activeOptions={{ exact: true }}
          className={NAV_ITEM}
          activeProps={{ className: NAV_ACTIVE }}
        >
          <HomeIcon />
          {t("nav.home")}
        </Link>
        <Link
          to="/books/$scope"
          params={{ scope: "all" }}
          className={NAV_ITEM}
          activeProps={{ className: NAV_ACTIVE }}
        >
          <ShelfIcon />
          {t("nav.all")}
          {data ? <span className={COUNT}>{data.bookCount}</span> : null}
        </Link>
        <Link
          to="/books/$scope"
          params={{ scope: "favorites" }}
          className={NAV_ITEM}
          activeProps={{ className: NAV_ACTIVE }}
        >
          <StarIcon />
          {t("library.favorites")}
          {data ? <span className={COUNT}>{data.favoriteCount}</span> : null}
        </Link>
        <Link
          to="/books/$scope"
          params={{ scope: "reading" }}
          className={NAV_ITEM}
          activeProps={{ className: NAV_ACTIVE }}
        >
          <ClockIcon />
          {t("library.filter.reading")}
          {reading.data ? <span className={COUNT}>{reading.data.length}</span> : null}
        </Link>
      </nav>

      <nav aria-label={t("library.collections")} className="flex flex-col gap-0.5">
        <h2 className="px-3 pb-2 text-label font-semibold tracking-label text-ink-3 uppercase">
          {t("library.collections")}
        </h2>
        {(data?.collections ?? []).map((collection) => (
          <Link
            key={collection.id}
            to="/collection/$collectionId"
            params={{ collectionId: collection.id }}
            className={NAV_ITEM}
            activeProps={{ className: NAV_ACTIVE }}
          >
            <span data-room={roomColorOf(collection.id)} className="size-2.5 shrink-0 rounded-xs bg-room" />
            <span className="min-w-0 truncate">{collection.name}</span>
            <span className={COUNT}>{collection.bookCount}</span>
          </Link>
        ))}
        <NewRoom
          className={`${NAV_ITEM} text-ink-3`}
          inputClassName="w-full rounded-control bg-field px-3 py-2.5 text-base text-ink placeholder:text-ink-3"
        />
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          onClick={() => openFile.mutate()}
          disabled={openFile.isPending}
          className={`${secondaryButton} bg-surface-2`}
        >
          <DownloadIcon />
          {t("library.openPdf")}
        </button>
        <Link to="/settings" className={NAV_ITEM} activeProps={{ className: NAV_ACTIVE }}>
          <SlidersIcon />
          {t("library.settings")}
        </Link>
      </div>
    </aside>
  );
}
