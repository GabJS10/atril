import type { TranslationKey } from "./es";

// Typed against the Spanish keys, so a missing or extra key fails typecheck.
export const en: Record<TranslationKey, string> = {
  "app.name": "Atril",
  "library.empty.title": "Your library is empty",
  "library.empty.body": "Add a PDF to start reading.",
  "library.openPdf": "Open a PDF…",
  "library.openError": "The file could not be opened.",
  "reader.back": "Library",
  "reader.controls": "Reader controls",
  "reader.loading": "Loading the book…",
  "reader.error": "This book could not be opened.",
  "reader.errorMissing": "The file is no longer at its path.",
  "reader.pageOf": "{page} / {pages}",
  "reader.zoomIn": "Zoom in",
  "reader.zoomOut": "Zoom out",
  "notFound.title": "Page not found",
  "notFound.back": "Back to the library",
};
