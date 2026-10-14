import { useState } from "react";
import { useSettings, useUpdateSettings } from "../api/queries";
import type { LibraryFolder, Settings } from "../api/types";
import { useLocaleStore, useT } from "../i18n";
import { ghostButton, primaryButton, secondaryButton, smallButton } from "../ui/buttons";
import { FolderIcon } from "../ui/icons";
import { Segmented } from "../ui/Segmented";
import { useAddFolder } from "./actions";
import { LoadError } from "./Notices";
import { useFolderMutations } from "./collectionActions";
import { roomColorOf } from "./identity";
import { useFolders } from "./queries";

const CARD = "flex flex-col gap-6 rounded-card bg-card p-8";
const CARD_TITLE = "font-serif text-panel leading-none font-semibold";
const ROW = "flex flex-wrap items-center gap-x-5 gap-y-3";

/** The title of a setting and, under it, what it does. */
function Label({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex min-w-50 flex-1 basis-50 flex-col gap-1">
      <b className="text-base font-semibold text-ink">{title}</b>
      {hint ? <span className="text-ui text-ink-2">{hint}</span> : null}
    </div>
  );
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

const PAPERS = [
  { value: "normal", key: "reader.paper.normal", paper: "bg-paper-normal text-paper-normal-ink" },
  { value: "sepia", key: "reader.paper.sepia", paper: "bg-paper-sepia text-paper-sepia-ink" },
  { value: "night", key: "reader.paper.night", paper: "bg-paper-night text-paper-night-ink" },
] as const;

/** Ajustes (DESIGN.md, ajustes): a card per section, with what the app has today. */
export function SettingsScreen() {
  const t = useT();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const change = (patch: Partial<Settings>) => updateSettings.mutate(patch);

  return (
    <main className="flex min-h-screen flex-col gap-8 px-14 pt-9 pb-18">
      <h1 className="font-serif text-obra leading-none font-semibold">{t("settings.title")}</h1>

      <FoldersCard />

      {settings.isError ? (
        <LoadError
          title={t("settings.error")}
          body={t("settings.error.body")}
          onRetry={() => void settings.refetch()}
        />
      ) : null}

      {settings.data ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] gap-6">
          <section className={CARD} aria-labelledby="appearance-title">
            <h2 id="appearance-title" className={CARD_TITLE}>
              {t("settings.appearance")}
            </h2>
            <div className={ROW}>
              <Label title={t("settings.theme")} hint={t("settings.theme.hint")} />
              <Segmented
                label={t("settings.theme")}
                value={settings.data.theme}
                onChange={(theme) => change({ theme })}
                options={[
                  { value: "dark", label: t("settings.theme.dark") },
                  { value: "light", label: t("settings.theme.light") },
                ]}
              />
            </div>
            <div className={ROW}>
              <Label title={t("settings.language")} hint={t("settings.language.hint")} />
              <Segmented
                label={t("settings.language")}
                value={settings.data.language}
                onChange={(language) => change({ language })}
                options={[
                  { value: "system", label: t("settings.language.system") },
                  { value: "es", label: t("settings.language.es") },
                  { value: "en", label: t("settings.language.en") },
                ]}
              />
            </div>
          </section>

          <section className={CARD} aria-labelledby="reading-title">
            <h2 id="reading-title" className={CARD_TITLE}>
              {t("settings.reading")}
            </h2>
            <div className={ROW}>
              <Label title={t("settings.defaultZoom")} />
              <Segmented
                label={t("settings.defaultZoom")}
                value={settings.data.defaultZoom}
                onChange={(defaultZoom) => change({ defaultZoom })}
                options={[
                  { value: "page_width", label: t("settings.zoom.page_width") },
                  { value: "page_fit", label: t("settings.zoom.page_fit") },
                  { value: "auto", label: t("settings.zoom.auto") },
                ]}
              />
            </div>
            <div className="flex flex-col gap-3">
              <b className="text-base font-semibold text-ink">{t("settings.defaultViewMode")}</b>
              <div role="group" aria-label={t("settings.defaultViewMode")} className="grid grid-cols-3 gap-3">
                {PAPERS.map((paper) => {
                  const chosen = settings.data.defaultViewMode === paper.value;
                  return (
                    <button
                      key={paper.value}
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => change({ defaultViewMode: paper.value })}
                      className={`flex flex-col gap-2.5 rounded-tile p-2.5 text-left text-ui font-medium transition-colors duration-fast ease-atril ${
                        chosen
                          ? "bg-surface-2 text-ink ring-2 ring-accent"
                          : "bg-raised text-ink-2 hover:text-ink"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-18 items-center justify-center rounded-tab font-serif text-panel font-semibold ${paper.paper}`}
                      >
                        Aa
                      </span>
                      {t(paper.key)}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function FoldersCard() {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const folders = useFolders();
  const addFolder = useAddFolder();
  const { remove: removeFolder, rescan } = useFolderMutations();
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <section className={CARD} aria-labelledby="folders-title">
      <div className={ROW}>
        <div className="flex min-w-50 flex-1 basis-50 flex-col gap-2">
          <h2 id="folders-title" className={CARD_TITLE}>
            {t("settings.folders")}
          </h2>
          <span className="text-ui text-ink-2">{t("settings.folders.body")}</span>
        </div>
        <button
          type="button"
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          className={secondaryButton}
        >
          {t("settings.folders.rescan")}
        </button>
        <button
          type="button"
          onClick={() => addFolder.mutate()}
          disabled={addFolder.isPending}
          className={primaryButton}
        >
          {t("settings.folders.add")}
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {(folders.data ?? []).map((folder: LibraryFolder) => (
          <li
            key={folder.id}
            className="flex flex-wrap items-center gap-4 rounded-tile bg-raised px-4.5 py-4"
          >
            <span
              data-room={roomColorOf(folder.id)}
              className="flex size-10 shrink-0 items-center justify-center rounded-control bg-room-tint text-room-ink"
            >
              <FolderIcon size={20} />
            </span>
            <div className="flex min-w-0 flex-1 basis-55 flex-col gap-0.5">
              <span className="truncate text-body font-semibold">{folderName(folder.path)}</span>
              <span className="truncate font-mono text-caption text-ink-2">{folder.path}</span>
            </div>
            <span className="text-ui text-ink-2">
              {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(folder.addedAt))}
            </span>
            {confirming === folder.id ? (
              <span className="flex flex-wrap items-center gap-3">
                <span className="max-w-80 text-ui text-ink-2">{t("settings.folders.removeConfirm")}</span>
                <button
                  type="button"
                  className={smallButton}
                  onClick={() => {
                    removeFolder.mutate(folder.id);
                    setConfirming(null);
                  }}
                >
                  {t("collections.confirm")}
                </button>
                <button type="button" className={ghostButton} onClick={() => setConfirming(null)}>
                  {t("collections.cancel")}
                </button>
              </span>
            ) : (
              <button type="button" className={ghostButton} onClick={() => setConfirming(folder.id)}>
                {t("settings.folders.remove")}
              </button>
            )}
          </li>
        ))}
        {folders.data && folders.data.length === 0 ? (
          <li className="flex flex-col gap-1.5 rounded-tile bg-raised px-6 py-5">
            <b className="font-serif text-title-sm leading-[1.15] font-semibold">
              {t("settings.folders.empty")}
            </b>
            <span className="max-w-[560px] text-ui leading-relaxed text-ink-2">
              {t("settings.folders.empty.body")}
            </span>
          </li>
        ) : null}
        {folders.isError ? (
          <li role="alert" className="flex flex-wrap items-center gap-4 rounded-tile bg-raised px-6 py-5">
            <span className="flex-1 text-ui text-ink-2">{t("library.error")}</span>
            <button type="button" className={smallButton} onClick={() => void folders.refetch()}>
              {t("common.retry")}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
