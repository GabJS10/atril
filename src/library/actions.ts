import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  addLibraryFolder,
  isAppError,
  openPath,
  pickFolderPath,
  pickPdfPath,
  removeBook,
  setFavorite,
} from "../api/tauri";
import type { AppError, Book, ImportResult } from "../api/types";
import { invalidateLibrary } from "./queries";
import { importResultKey } from "./useFileDrop";

/** Query key of the last failed attempt to add a library folder, shown as a notice (not a library query). */
export const folderErrorKey = ["folderError"] as const;

/** A folder Atril refused to watch, with the reason the backend gave. */
export type FolderError = { path: string; error: AppError };

/**
 * Asks for a PDF and registers it. A file Atril refuses (not a PDF, unreadable) is not thrown at the screen: it is
 * left as the notice of the last import, the same one a refused drop leaves. Cancelling the dialog gives null.
 */
async function openPickedPdf(queryClient: QueryClient): Promise<Book | null> {
  const path = await pickPdfPath();
  if (!path) return null;
  try {
    return await openPath(path);
  } catch (error) {
    if (!isAppError(error)) throw error;
    queryClient.setQueryData<ImportResult>(importResultKey, { imported: [], rejected: [{ path, error }] });
    return null;
  }
}

/** Opens a PDF chosen in the dialog and goes to its reader. Cancelling does nothing. */
export function useOpenPdfFile() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => openPickedPdf(queryClient),
    onSuccess: (book) => {
      invalidateLibrary(queryClient);
      if (book) void navigate({ to: "/read/$bookId", params: { bookId: book.id } });
    },
  });
}

/**
 * Points a book whose file moved back to the new file. The backend recognises the book by its
 * content, so progress, highlights and collections come back with it.
 */
export function useRelinkBook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => openPickedPdf(queryClient),
    onSuccess: () => invalidateLibrary(queryClient),
  });
}

export function useRemoveBook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookId: string) => removeBook(bookId),
    onSuccess: () => invalidateLibrary(queryClient),
  });
}

/**
 * Asks for a folder and starts watching it. A folder Atril refuses (not a folder, unreadable) is not thrown at the
 * screen: it is left as the folder notice, so the user sees what happened. Cancelling the dialog does nothing.
 */
export function useAddFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const path = await pickFolderPath();
      if (!path) return null;
      try {
        return await addLibraryFolder(path);
      } catch (error) {
        if (!isAppError(error)) throw error;
        queryClient.setQueryData<FolderError>(folderErrorKey, { path, error });
        return null;
      }
    },
    onSuccess: (folder) => {
      if (folder) queryClient.setQueryData<FolderError | null>(folderErrorKey, null);
      invalidateLibrary(queryClient);
    },
  });
}

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookId, favorite }: { bookId: string; favorite: boolean }) =>
      setFavorite(bookId, favorite),
    onSuccess: () => invalidateLibrary(queryClient),
  });
}
