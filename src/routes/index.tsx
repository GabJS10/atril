import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { openPath, pickPdfPath } from "../api/tauri";
import { useT } from "../i18n";

// Provisional until the library (phase 2): the only way in is to open a PDF file.
function LibraryPage() {
  const t = useT();
  const navigate = useNavigate();
  const openPdf = useMutation({
    mutationFn: async () => {
      const path = await pickPdfPath();
      return path ? openPath(path) : null;
    },
    onSuccess: (book) => {
      if (book) void navigate({ to: "/read/$bookId", params: { bookId: book.id } });
    },
  });

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-base font-medium tracking-wordmark uppercase">{t("app.name")}</h1>
      <h2 className="mt-8 text-2xl">{t("library.empty.title")}</h2>
      <p className="text-ink-2">{t("library.empty.body")}</p>
      <button
        type="button"
        onClick={() => openPdf.mutate()}
        disabled={openPdf.isPending}
        className="mt-6 bg-ink px-5 py-3 text-base font-semibold text-ink-inverse disabled:opacity-50"
      >
        {t("library.openPdf")}
      </button>
      {openPdf.isError ? (
        <p role="alert" className="text-ink-2">
          {t("library.openError")}
        </p>
      ) : null}
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: LibraryPage,
});
