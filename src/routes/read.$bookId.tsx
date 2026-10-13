import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// The reader is only loaded when a book is opened.
const ReaderScreen = lazy(() =>
  import("../reader/ReaderScreen").then((module) => ({ default: module.ReaderScreen })),
);

function ReaderPage() {
  const { bookId } = Route.useParams();
  return (
    <Suspense fallback={<div className="h-screen bg-canvas" />}>
      <ReaderScreen bookId={bookId} />
    </Suspense>
  );
}

export const Route = createFileRoute("/read/$bookId")({
  component: ReaderPage,
});
