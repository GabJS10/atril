import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  createHighlight,
  createHighlightGroup,
  deleteHighlight,
  deleteHighlightGroup,
  listHighlightGroups,
  listHighlights,
  renameHighlightGroup,
  updateHighlight,
} from "../api/tauri";
import type { Highlight, HighlightGroup, HighlightInput, HighlightPatch } from "../api/types";
import { byGroupPosition } from "./highlightList";

export const highlightsKey = (bookId: string) => ["highlights", bookId] as const;
export const highlightGroupsKey = (bookId: string) => ["highlightGroups", bookId] as const;

/** Temporary ids of highlights still being saved, and the real id each one got. */
const realIdOf = new Map<string, string>();
const savedIdOf = new Map<string, Promise<string>>();
let temporaryCount = 0;

/** The id a highlight has now: a temporary one resolves to the saved one once the backend answers. */
export function currentHighlightId(id: string): string {
  return realIdOf.get(id) ?? id;
}

/** The real id of a highlight, waiting for its save if it is still pending. */
function savedId(id: string): Promise<string> {
  return savedIdOf.get(id) ?? Promise.resolve(currentHighlightId(id));
}

export function useHighlights(bookId: string) {
  return useQuery({
    queryKey: highlightsKey(bookId),
    queryFn: () => listHighlights(bookId),
    staleTime: Infinity,
  });
}

/** The groups of a book, by position. */
export function useHighlightGroups(bookId: string) {
  return useQuery({
    queryKey: highlightGroupsKey(bookId),
    queryFn: () => listHighlightGroups(bookId),
    staleTime: Infinity,
  });
}

/**
 * Highlight changes with optimistic updates: the cache changes at once, the backend confirms or refuses.
 * A refused create removes the highlight; a refused change or delete reloads the list. `onError` tells the
 * reader so it can show a discreet notice.
 */
export function useHighlightActions(bookId: string, onError: (error: unknown) => void) {
  const queryClient = useQueryClient();
  const key = highlightsKey(bookId);

  const edit = useCallback(
    (update: (list: Highlight[]) => Highlight[]) => {
      queryClient.setQueryData<Highlight[]>(key, (list = []) => update(list));
    },
    [queryClient, key],
  );

  /** Creates the highlight on screen at once. Resolves to its saved id. */
  const create = useCallback(
    (input: Omit<HighlightInput, "bookId">): Promise<string> => {
      const temporary = `pending-${++temporaryCount}`;
      const now = new Date().toISOString();
      edit((list) => [
        ...list,
        {
          id: temporary,
          bookId,
          page: input.page,
          rects: input.rects,
          text: input.text,
          color: input.color,
          note: input.note ?? null,
          groupId: input.groupId ?? null,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      const request = createHighlight({ bookId, ...input }).then(
        (saved) => {
          realIdOf.set(temporary, saved.id);
          edit((list) => list.map((item) => (item.id === temporary ? saved : item)));
          return saved.id;
        },
        (error: unknown) => {
          edit((list) => list.filter((item) => item.id !== temporary));
          onError(error);
          throw error;
        },
      );
      savedIdOf.set(temporary, request);
      request.catch(() => undefined);
      return request;
    },
    [bookId, edit, onError],
  );

  const update = useCallback(
    async (id: string, patch: HighlightPatch): Promise<void> => {
      edit((list) =>
        list.map((item) =>
          item.id === id
            ? {
                ...item,
                color: patch.color ?? item.color,
                note: patch.note === undefined ? item.note : patch.note,
                groupId: patch.groupId === undefined ? item.groupId : patch.groupId,
              }
            : item,
        ),
      );
      try {
        const real = await savedId(id);
        const saved = await updateHighlight(real, patch);
        edit((list) => list.map((item) => (item.id === id || item.id === real ? saved : item)));
      } catch (error) {
        void queryClient.invalidateQueries({ queryKey: key });
        onError(error);
      }
    },
    [edit, key, onError, queryClient],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      edit((list) => list.filter((item) => item.id !== id));
      try {
        await deleteHighlight(await savedId(id));
      } catch (error) {
        void queryClient.invalidateQueries({ queryKey: key });
        onError(error);
      }
    },
    [edit, key, onError, queryClient],
  );

  return { create, update, remove };
}

/**
 * Group changes. Rename and delete change the cache at once; a refused change reloads the groups and the
 * highlights and tells the reader through `onError`. Create needs the id the backend gives, so it waits for it.
 * None of them throws: a refused create resolves to null, so the caller can keep its form open.
 */
export function useHighlightGroupActions(bookId: string, onError: (error: unknown) => void) {
  const queryClient = useQueryClient();
  const groupsKey = highlightGroupsKey(bookId);
  const highlightsCacheKey = highlightsKey(bookId);

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: groupsKey });
    void queryClient.invalidateQueries({ queryKey: highlightsCacheKey });
  }, [queryClient, groupsKey, highlightsCacheKey]);

  const create = useCallback(
    async (name: string): Promise<HighlightGroup | null> => {
      try {
        const group = await createHighlightGroup(bookId, name);
        // Only a loaded list is changed; an unloaded one will come from the backend with the new group in it.
        queryClient.setQueryData<HighlightGroup[]>(
          groupsKey,
          (list) => list && [...list.filter((item) => item.id !== group.id), group].sort(byGroupPosition),
        );
        return group;
      } catch (error) {
        onError(error);
        return null;
      }
    },
    [bookId, groupsKey, onError, queryClient],
  );

  const rename = useCallback(
    async (groupId: string, name: string): Promise<void> => {
      queryClient.setQueryData<HighlightGroup[]>(groupsKey, (list) =>
        list?.map((item) => (item.id === groupId ? { ...item, name } : item)),
      );
      try {
        const saved = await renameHighlightGroup(groupId, name);
        queryClient.setQueryData<HighlightGroup[]>(groupsKey, (list) =>
          list?.map((item) => (item.id === groupId ? saved : item)),
        );
      } catch (error) {
        reload();
        onError(error);
      }
    },
    [groupsKey, onError, queryClient, reload],
  );

  /** Deletes the group; its highlights stay and show as "Sin grupo" (groupId null), as the backend does. */
  const remove = useCallback(
    async (groupId: string): Promise<void> => {
      queryClient.setQueryData<HighlightGroup[]>(groupsKey, (list) =>
        list?.filter((item) => item.id !== groupId),
      );
      queryClient.setQueryData<Highlight[]>(highlightsCacheKey, (list) =>
        list?.map((item) => (item.groupId === groupId ? { ...item, groupId: null } : item)),
      );
      try {
        await deleteHighlightGroup(groupId);
      } catch (error) {
        reload();
        onError(error);
      }
    },
    [groupsKey, highlightsCacheKey, onError, queryClient, reload],
  );

  return { create, rename, remove };
}
