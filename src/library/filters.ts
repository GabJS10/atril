import type { BookQuery, BookSort, BookStatus } from "../api/types";

export type BookFilters = {
  status: BookStatus | undefined;
  sort: BookSort;
};

export const DEFAULT_FILTERS: BookFilters = { status: undefined, sort: "title" };

/** The part of a book query that the filters decide. */
export function filtersToQuery(filters: BookFilters): BookQuery {
  return { status: filters.status, sort: filters.sort };
}
