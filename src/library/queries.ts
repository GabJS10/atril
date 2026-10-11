import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getHome, getScanStatus, listBooks, listLibraryFolders } from "../api/tauri";
import type { BookQuery } from "../api/types";

/** Every library query starts with "library", so one invalidation refreshes the whole library. */
export const libraryKey = ["library"] as const;
export const homeKey = [...libraryKey, "home"] as const;
export const foldersKey = [...libraryKey, "folders"] as const;
export const scanKey = [...libraryKey, "scan"] as const;
export const booksKey = (query: BookQuery) => [...libraryKey, "books", query] as const;

export function invalidateLibrary(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: libraryKey });
}

export function useHome() {
  return useQuery({ queryKey: homeKey, queryFn: getHome });
}

export function useBooks(query: BookQuery) {
  return useQuery({ queryKey: booksKey(query), queryFn: () => listBooks(query) });
}

export function useFolders() {
  return useQuery({ queryKey: foldersKey, queryFn: listLibraryFolders });
}

/** Scan status: read once, then kept current by the `library://scan` events (see useLibraryEvents). */
export function useScanStatus() {
  return useQuery({ queryKey: scanKey, queryFn: getScanStatus });
}
