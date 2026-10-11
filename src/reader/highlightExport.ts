import type { HighlightExport } from "../api/types";
import { suggestedExportName } from "./highlightList";

/** What the export needs from the outside world: the save dialog and the backend command. */
export type ExportDeps = {
  pickPath: (suggestedName: string) => Promise<string | null>;
  exportTo: (bookId: string, destPath: string, language: "es" | "en") => Promise<HighlightExport>;
};

/**
 * Asks where to save the book's highlights, then writes them as Markdown in the UI language.
 * Resolves to the number of highlights written, or null when the user cancels.
 */
export async function exportBookHighlights(
  book: { id: string; title: string },
  language: "es" | "en",
  deps: ExportDeps,
): Promise<number | null> {
  const path = await deps.pickPath(suggestedExportName(book.title));
  if (!path) return null;
  const result = await deps.exportTo(book.id, path, language);
  return result.count;
}
