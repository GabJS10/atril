import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, type CloseRequestedEvent } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppError, Book, OpenedBook, ReadingStateInput, Settings, SettingsPatch } from "./types";

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

export function destroyWindow(): Promise<void> {
  return getCurrentWindow().destroy();
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
