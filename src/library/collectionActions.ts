import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addToCollection,
  createCollection,
  deleteCollection,
  removeFromCollection,
  removeLibraryFolder,
  renameCollection,
  rescanLibrary,
} from "../api/tauri";
import { invalidateLibrary } from "./queries";

/** Mutations for Salas and folders. Every one refreshes the whole library. */
export function useCollectionMutations() {
  const queryClient = useQueryClient();
  const done = () => invalidateLibrary(queryClient);
  return {
    create: useMutation({ mutationFn: (name: string) => createCollection(name), onSuccess: done }),
    rename: useMutation({
      mutationFn: ({ collectionId, name }: { collectionId: string; name: string }) =>
        renameCollection(collectionId, name),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (collectionId: string) => deleteCollection(collectionId),
      onSuccess: done,
    }),
    add: useMutation({
      mutationFn: ({ bookIds, collectionId }: { bookIds: string[]; collectionId: string }) =>
        addToCollection(bookIds, collectionId),
      onSuccess: done,
    }),
    removeBooks: useMutation({
      mutationFn: ({ bookIds, collectionId }: { bookIds: string[]; collectionId: string }) =>
        removeFromCollection(bookIds, collectionId),
      onSuccess: done,
    }),
  };
}

export function useFolderMutations() {
  const queryClient = useQueryClient();
  const done = () => invalidateLibrary(queryClient);
  return {
    remove: useMutation({ mutationFn: (folderId: string) => removeLibraryFolder(folderId), onSuccess: done }),
    rescan: useMutation({ mutationFn: () => rescanLibrary(), onSuccess: done }),
  };
}
