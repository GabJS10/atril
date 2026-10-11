import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { createHighlight, deleteHighlight, listHighlights, updateHighlight } from "../api/tauri";
import type { Highlight, HighlightInput, HighlightPatch } from "../api/types";

export const highlightsKey = (bookId: string) => ["highlights", bookId] as const;

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
