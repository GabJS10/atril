import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSettings } from "../api/queries";
import { useLocaleStore, useT } from "../i18n";
import { useLibraryEvents } from "../library/useLibraryEvents";
import { applyTheme } from "../theme";

function RootLayout() {
  const { data: settings } = useSettings();
  useLibraryEvents();
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
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl">{t("notFound.title")}</h1>
      <Link to="/" className="underline underline-offset-4">
        {t("notFound.back")}
      </Link>
    </main>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});
