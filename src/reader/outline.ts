import type { EngineOutlineItem } from "../api/types";
import { isOpenableUri } from "./native/links";
import type { PageDestination } from "./viewerTypes";

/** One entry of the book's index (outline), with its page resolved (1-based) when it has one. */
export type OutlineItem = {
  title: string;
  /** Where the viewer goes: a page and a height on it. Null: nowhere. */
  dest: PageDestination | null;
  page: number | null;
  /** An external link (http, https or mailto) the entry opens instead of a place in the book. */
  uri?: string | null;
  items: OutlineItem[];
};

/**
 * The entry of the section the reader is in: the last entry, in reading order, that starts on or before `page`.
 * Null before the first entry of the index.
 */
export function activeOutlineItem(items: OutlineItem[], page: number): OutlineItem | null {
  let active: OutlineItem | null = null;
  const visit = (list: OutlineItem[]) => {
    for (const item of list) {
      if (item.page !== null && item.page <= page) active = item;
      visit(item.items);
    }
  };
  visit(items);
  return active;
}

/** True when the index has at least one entry. */
export function hasOutline(items: OutlineItem[]): boolean {
  return items.length > 0;
}

function fromEngineEntry(entry: EngineOutlineItem): OutlineItem | null {
  const items = fromEngineOutline(entry.children);
  // A heading with no destination of its own still earns its place when entries below it lead somewhere.
  if (entry.page === null && entry.uri === null && items.length === 0) return null;
  return {
    title: entry.title.trim() || "—",
    dest: entry.page === null ? null : { page: entry.page, y: entry.y },
    page: entry.page,
    uri: entry.uri,
    items,
  };
}

/** The index as the native engine returns it, in the panel's shape. Entries that lead nowhere and hold nothing are left out. */
export function fromEngineOutline(entries: readonly EngineOutlineItem[]): OutlineItem[] {
  return entries.map(fromEngineEntry).filter((item): item is OutlineItem => item !== null);
}

/** What an entry of the index does when it is chosen: go to its place in the book, or open its link outside. */
export function followOutlineItem(
  item: OutlineItem,
  actions: { goTo: (dest: PageDestination) => void; openExternal: (uri: string) => void },
): void {
  if (item.uri) {
    if (isOpenableUri(item.uri)) actions.openExternal(item.uri);
  } else if (item.dest) {
    actions.goTo(item.dest);
  }
}
