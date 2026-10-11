import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  addLibraryFolder,
  openPath,
  pickFolderPath,
  pickPdfPath,
  removeBook,
  setFavorite,
} from "../api/tauri";
import { invalidateLibrary } from "./queries";

/** Opens a PDF chosen in the dialog and goes to its reader. Cancelling does nothing. */
export function useOpenPdfFile() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      const path = await pickPdfPath();
      return path ? openPath(path) : null;
    },
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
    mutationFn: async () => {
      const path = await pickPdfPath();
      return path ? openPath(path) : null;
    },
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

export function useAddFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const path = await pickFolderPath();
      return path ? addLibraryFolder(path) : null;
    },
    onSuccess: () => invalidateLibrary(queryClient),
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
