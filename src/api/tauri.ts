import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow, type CloseRequestedEvent } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  AppError,
  Book,
  BookQuery,
  Collection,
  EngineOutlineItem,
  Highlight,
  HighlightExport,
  HighlightInput,
  HighlightPatch,
  HomeData,
  ImportResult,
  LibraryFolder,
  OpenedBook,
  OpenedDocument,
  PageLink,
  ReadingStateInput,
  ScanMetadata,
  ScanStatus,
  SearchDone,
  SearchProgress,
  SearchStarted,
  Settings,
  SettingsPatch,
  TextWord,
} from "./types";

// The only place that talks to Rust: one wrapper per command in docs/IPC.md.
// Commands reject with an AppError, see isAppError.

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return invoke<Settings>("update_settings", { patch });
}

export function openPath(path: string): Promise<Book> {
  return invoke<Book>("open_path", { path });
}

export function openBook(bookId: string): Promise<OpenedBook> {
  return invoke<OpenedBook>("open_book", { bookId });
}

/** Opens the book in the native engine: page sizes and the base URL of the page images. */
export function openDocument(bookId: string): Promise<OpenedDocument> {
  return invoke<OpenedDocument>("open_document", { bookId });
}

/** The words of one page (1-based) with their boxes, for the text layer. */
export function getPageText(bookId: string, page: number): Promise<TextWord[]> {
  return invoke<TextWord[]>("get_page_text", { bookId, page });
}

/** The usable links of one page (1-based): internal ones and http, https and mailto. */
export function getPageLinks(bookId: string, page: number): Promise<PageLink[]> {
  return invoke<PageLink[]>("get_page_links", { bookId, page });
}

/** The book's index; empty when the PDF has none. */
export function getOutline(bookId: string): Promise<EngineOutlineItem[]> {
  return invoke<EngineOutlineItem[]>("get_outline", { bookId });
}

/** Starts a search and returns at once; the matches arrive as `search://progress` events. */
export function searchDocument(bookId: string, query: string): Promise<SearchStarted> {
  return invoke<SearchStarted>("search_document", { bookId, query });
}

/** Stops a search. Does nothing when it already finished. */
export function cancelSearch(searchId: string): Promise<null> {
  return invoke<null>("cancel_search", { searchId });
}

/** The matches of one page of the running search. Resolves to the function that stops listening. */
export function onSearchProgress(handler: (event: SearchProgress) => void): Promise<UnlistenFn> {
  return listen<SearchProgress>("search://progress", (event) => handler(event.payload));
}

/** The end of a search: finished, cancelled or failed. */
export function onSearchDone(handler: (event: SearchDone) => void): Promise<UnlistenFn> {
  return listen<SearchDone>("search://done", (event) => handler(event.payload));
}

/** Opens an http, https or mailto link outside the app (the system browser or mail client). */
export function openExternalUrl(uri: string): Promise<void> {
  return openUrl(uri);
}

export function getBook(bookId: string): Promise<Book> {
  return invoke<Book>("get_book", { bookId });
}

export function saveReadingState(bookId: string, state: ReadingStateInput): Promise<null> {
  return invoke<null>("save_reading_state", { bookId, state });
}

/** Native "open file" dialog limited to PDF. Resolves to the chosen path, or null if cancelled. */
export async function pickPdfPath(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return typeof selected === "string" ? selected : null;
}

/**
 * Runs `handler` when the user asks to close the window. Calling `event.preventDefault()` keeps it
 * open; `destroyWindow()` closes it without asking again. Resolves to the function that stops listening.
 */
export function onWindowCloseRequested(
  handler: (event: CloseRequestedEvent) => void | Promise<void>,
): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(handler);
}

/** Switches the window between full screen and windowed (F11). */
export async function toggleFullscreen(): Promise<void> {
  const window = getCurrentWindow();
  await window.setFullscreen(!(await window.isFullscreen()));
}

export function destroyWindow(): Promise<void> {
  return getCurrentWindow().destroy();
}

// Library (docs/IPC.md, fase 2)

export function getHome(): Promise<HomeData> {
  return invoke<HomeData>("get_home");
}

export function listBooks(query: BookQuery): Promise<Book[]> {
  return invoke<Book[]>("list_books", { query });
}

export function setFavorite(bookId: string, favorite: boolean): Promise<Book> {
  return invoke<Book>("set_favorite", { bookId, favorite });
}

export function removeBook(bookId: string): Promise<null> {
  return invoke<null>("remove_book", { bookId });
}

export function listLibraryFolders(): Promise<LibraryFolder[]> {
  return invoke<LibraryFolder[]>("list_library_folders");
}

export function addLibraryFolder(path: string): Promise<LibraryFolder> {
  return invoke<LibraryFolder>("add_library_folder", { path });
}

export function getScanStatus(): Promise<ScanStatus> {
  return invoke<ScanStatus>("get_scan_status");
}

export function listPendingScans(): Promise<Book[]> {
  return invoke<Book[]>("list_pending_scans");
}

/** Sends the cover (WebP bytes) as the binary body; the metadata travels in headers (docs/IPC.md). */
export function saveBookScan(bookId: string, metadata: ScanMetadata, cover: Uint8Array): Promise<Book> {
  const headers: Record<string, string> = {
    "X-Book-Id": bookId,
    "X-Page-Count": String(metadata.pageCount),
  };
  if (metadata.title) headers["X-Title"] = encodeURIComponent(metadata.title);
  if (metadata.author) headers["X-Author"] = encodeURIComponent(metadata.author);
  return invoke<Book>("save_book_scan", cover, { headers });
}

export function markScanFailed(bookId: string): Promise<Book> {
  return invoke<Book>("mark_scan_failed", { bookId });
}

export function listCollections(): Promise<Collection[]> {
  return invoke<Collection[]>("list_collections");
}

/** Native "save file" dialog for a Markdown export. Resolves to the chosen path, or null if cancelled. */
export async function pickExportPath(suggestedName: string): Promise<string | null> {
  return save({ defaultPath: suggestedName, filters: [{ name: "Markdown", extensions: ["md"] }] });
}

/** Native folder dialog. Resolves to the chosen path, or null if cancelled. */
export async function pickFolderPath(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: true });
  return typeof selected === "string" ? selected : null;
}

export type ScanEvent = { reason: "scan" | "watch" | "import" };

/** The library changed for a reason the front did not ask for (scan, watcher, import). */
export function onLibraryChanged(handler: (event: ScanEvent) => void): Promise<UnlistenFn> {
  return listen<ScanEvent>("library://changed", (event) => handler(event.payload));
}

/** A scan started, advanced or finished. */
export function onScanStatus(handler: (status: ScanStatus) => void): Promise<UnlistenFn> {
  return listen<ScanStatus>("library://scan", (event) => handler(event.payload));
}

export function createCollection(name: string): Promise<Collection> {
  return invoke<Collection>("create_collection", { name });
}

export function renameCollection(collectionId: string, name: string): Promise<Collection> {
  return invoke<Collection>("rename_collection", { collectionId, name });
}

export function deleteCollection(collectionId: string): Promise<null> {
  return invoke<null>("delete_collection", { collectionId });
}

export function addToCollection(bookIds: string[], collectionId: string): Promise<null> {
  return invoke<null>("add_to_collection", { bookIds, collectionId });
}

export function removeFromCollection(bookIds: string[], collectionId: string): Promise<null> {
  return invoke<null>("remove_from_collection", { bookIds, collectionId });
}

export function removeLibraryFolder(folderId: string): Promise<null> {
  return invoke<null>("remove_library_folder", { folderId });
}

export function rescanLibrary(): Promise<null> {
  return invoke<null>("rescan_library");
}

export function importFiles(paths: string[]): Promise<ImportResult> {
  return invoke<ImportResult>("import_files", { paths });
}

/** PDF files dropped on the window. Resolves to the function that stops listening. */
export function onFilesDropped(handler: (paths: string[]) => void): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop") handler(event.payload.paths);
  });
}

// Highlights (docs/IPC.md, fase 3)

export function listHighlights(bookId: string): Promise<Highlight[]> {
  return invoke<Highlight[]>("list_highlights", { bookId });
}

export function createHighlight(highlight: HighlightInput): Promise<Highlight> {
  return invoke<Highlight>("create_highlight", { highlight });
}

/** `note: null` clears the note; leaving it out keeps it. */
export function updateHighlight(highlightId: string, patch: HighlightPatch): Promise<Highlight> {
  return invoke<Highlight>("update_highlight", { highlightId, ...patch });
}

/** Writes the book's highlights to a Markdown file at `destPath` (absolute). */
export function exportHighlights(
  bookId: string,
  destPath: string,
  language: "es" | "en",
): Promise<HighlightExport> {
  return invoke<HighlightExport>("export_highlights", { bookId, destPath, language });
}

export function deleteHighlight(highlightId: string): Promise<null> {
  return invoke<null>("delete_highlight", { highlightId });
}

export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  );
}
