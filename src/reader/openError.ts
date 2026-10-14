import { isAppError } from "../api/tauri";

/** What went wrong opening a book, in the terms the reader screen explains it. */
export type OpenFailure = "missing" | "unreadable" | "other";

/** Sorts an error of `open_book` or `open_document` (docs/IPC.md) into what the user can do about it. */
export function classifyOpenError(error: unknown): OpenFailure {
  if (!isAppError(error)) return "other";
  if (error.code === "file_missing") return "missing";
  if (error.code === "invalid_pdf") return "unreadable";
  return "other";
}
