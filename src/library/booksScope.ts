export type BooksScope = "all" | "favorites" | "reading";

/** The three lists of the sidebar. */
export function isBooksScope(value: string): value is BooksScope {
  return value === "all" || value === "favorites" || value === "reading";
}
