import { createFileRoute, Link } from "@tanstack/react-router";
import { useT } from "../i18n";

function ReaderPage() {
  const { bookId } = Route.useParams();
  const t = useT();
  return (
    <main className="flex flex-1 flex-col gap-6 p-8" data-book-id={bookId}>
      <Link to="/" className="self-start text-sm underline underline-offset-4">
        {t("reader.back")}
      </Link>
      <p className="m-auto text-ink-2">{t("reader.placeholder")}</p>
    </main>
  );
}

export const Route = createFileRoute("/read/$bookId")({
  component: ReaderPage,
});
