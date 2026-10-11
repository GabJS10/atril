import { Link } from "@tanstack/react-router";
import { useT, useLocaleStore } from "../i18n";
import { SectionLabel } from "./sections";
import { useAddFolder } from "./actions";
import { useFolders } from "./queries";
import { useFolderMutations } from "./collectionActions";
import { useState } from "react";

/** Ajustes, minimal for now: the library folders, and adding one. */
export function SettingsScreen() {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const folders = useFolders();
  const addFolder = useAddFolder();
  const { remove: removeFolder, rescan } = useFolderMutations();
  const [confirming, setConfirming] = useState<string | null>(null);

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
              <span className="flex shrink-0 items-center gap-6 text-ui text-ink-3">
                {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(folder.addedAt))}
                {confirming === folder.id ? (
                  <span className="flex items-center gap-4 text-ink">
                    <span className="max-w-[320px] text-ink-2">{t("settings.folders.removeConfirm")}</span>
                    <button
                      type="button"
                      className="font-medium text-ink"
                      onClick={() => {
                        removeFolder.mutate(folder.id);
                        setConfirming(null);
                      }}
                    >
                      {t("collections.confirm")}
                    </button>
                    <button type="button" className="text-ink-2" onClick={() => setConfirming(null)}>
                      {t("collections.cancel")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="text-ink-2 underline underline-offset-4"
                    onClick={() => setConfirming(folder.id)}
                  >
                    {t("settings.folders.remove")}
                  </button>
                )}
              </span>
            </li>
          ))}
          {folders.data && folders.data.length === 0 ? (
            <li className="py-4 text-ink-2">{t("settings.folders.empty")}</li>
          ) : null}
        </ul>
        <div className="flex gap-6">
          <button
            type="button"
            onClick={() => addFolder.mutate()}
            disabled={addFolder.isPending}
            className="border border-line-strong px-5 py-2.5 text-base font-medium disabled:opacity-50"
          >
            {t("settings.folders.add")}
          </button>
          <button
            type="button"
            onClick={() => rescan.mutate()}
            disabled={rescan.isPending}
            className="border border-line px-5 py-2.5 text-base text-ink-2 disabled:opacity-50"
          >
            {t("settings.folders.rescan")}
          </button>
        </div>
      </section>
    </main>
  );
}
