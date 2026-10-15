import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSettings } from "../api/queries";
import { useBrowserDefaults } from "../browserDefaults";
import { useLocaleStore, useT } from "../i18n";
import { useFullscreenKey } from "../useFullscreenKey";
import { useFileDrop } from "../library/useFileDrop";
import { useLibraryEvents } from "../library/useLibraryEvents";
import { applyTheme } from "../theme";
import { primaryButton } from "../ui/buttons";
import { StateCard } from "../ui/StateCard";

function RootLayout() {
  const { data: settings } = useSettings();
  useLibraryEvents();
  useFileDrop();
  useFullscreenKey();
  useBrowserDefaults();
  const language = settings?.language;
  const setLanguage = useLocaleStore((state) => state.setLanguage);
  const locale = useLocaleStore((state) => state.locale);
  const theme = settings?.theme;

  useEffect(() => {
    if (language) setLanguage(language);
  }, [language, setLanguage]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  return (
    <div className="flex min-h-screen flex-col">
      <Outlet />
    </div>
  );
}

function NotFound() {
  const t = useT();
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <StateCard
        heading={1}
        className="w-full max-w-[640px]"
        title={t("notFound.title")}
        body={t("notFound.body")}
        actions={
          <Link to="/" className={primaryButton}>
            {t("notFound.back")}
          </Link>
        }
      />
    </main>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});
