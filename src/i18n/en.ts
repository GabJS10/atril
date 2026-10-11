import type { TranslationKey } from "./es";

// Typed against the Spanish keys, so a missing or extra key fails typecheck.
export const en: Record<TranslationKey, string> = {
  "app.name": "Atril",
  "library.empty.title": "Your library is empty",
  "library.empty.body": "Add a PDF to start reading.",
  "reader.back": "Library",
  "reader.placeholder": "The reader will go here.",
  "notFound.title": "Page not found",
  "notFound.back": "Back to the library",
};
