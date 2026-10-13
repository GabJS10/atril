import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// The reader is only loaded when a book is opened.
const ReaderScreen = lazy(() =>
  import("../reader/ReaderScreen").then((module) => ({ default: module.ReaderScreen })),
);

function ReaderPage() {
  const { bookId } = Route.useParams();
  const { panel } = Route.useSearch();
  return (
    <Suspense fallback={<div className="h-screen bg-canvas" />}>
      <ReaderScreen bookId={bookId} panel={panel ?? null} />
    </Suspense>
  );
}

export const Route = createFileRoute("/read/$bookId")({
  // `?panel=highlights` opens the book with its highlights panel (the link in "Seguir leyendo").
  validateSearch: (search: Record<string, unknown>): { panel?: "highlights" | "outline" } =>
    search.panel === "highlights" || search.panel === "outline" ? { panel: search.panel } : {},
  component: ReaderPage,
});
