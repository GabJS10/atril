import { Link } from "@tanstack/react-router";
import { useT, useLocaleStore } from "../i18n";
import { SectionLabel } from "./sections";
import { useAddFolder } from "./actions";
import { useFolders } from "./queries";

/** Ajustes, minimal for now: the library folders, and adding one. */
export function SettingsScreen() {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const folders = useFolders();
  const addFolder = useAddFolder();

  return (
    <main className="flex min-h-screen flex-col gap-12 px-16 pb-16">
      <header className="grid grid-cols-12 items-center gap-6 border-b border-line-strong py-5">
        <Link to="/" className="col-span-4 text-base font-medium text-ink">
          ← {t("settings.back")}
        </Link>
      </header>
      <h1 className="font-serif text-hero leading-[0.95]">{t("settings.title")}</h1>

      <section className="flex flex-col gap-8">
        <SectionLabel number="01">{t("settings.folders")}</SectionLabel>
        <p className="max-w-[560px] text-base leading-[1.6] text-ink-2">{t("settings.folders.body")}</p>
        <ul className="flex flex-col">
          {(folders.data ?? []).map((folder) => (
            <li
              key={folder.id}
              className="flex items-baseline justify-between gap-6 border-b border-line py-4"
            >
              <span className="truncate text-base">{folder.path}</span>
              <span className="shrink-0 text-ui text-ink-3">
                {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(folder.addedAt))}
              </span>
            </li>
          ))}
          {folders.data && folders.data.length === 0 ? (
            <li className="py-4 text-ink-2">{t("settings.folders.empty")}</li>
          ) : null}
        </ul>
        <button
          type="button"
          onClick={() => addFolder.mutate()}
          disabled={addFolder.isPending}
          className="self-start border border-line-strong px-5 py-2.5 text-base font-medium disabled:opacity-50"
        >
          {t("settings.folders.add")}
        </button>
      </section>
    </main>
  );
}
