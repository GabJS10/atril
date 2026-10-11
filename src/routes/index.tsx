import { createFileRoute } from "@tanstack/react-router";
import { useT } from "../i18n";

function LibraryPage() {
  const t = useT();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-sm tracking-[0.3em] uppercase">{t("app.name")}</h1>
      <h2 className="mt-8 text-2xl">{t("library.empty.title")}</h2>
      <p className="text-bone/70">{t("library.empty.body")}</p>
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: LibraryPage,
});
