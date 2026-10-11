/** One entry of the book's index (outline), with its page resolved (1-based) when it has one. */
export type OutlineItem = {
  title: string;
  /** The destination pdf.js navigates to: a named destination or an explicit one. */
  dest: string | unknown[];
  page: number | null;
  items: OutlineItem[];
};

/** The part of pdf.js's document API the outline needs. */
export type OutlineSource = {
  getOutline(): Promise<RawOutlineItem[] | null>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: object): Promise<number>;
};

type RawOutlineItem = { title: string; dest: string | unknown[] | null; items: RawOutlineItem[] };

async function pageOf(source: OutlineSource, dest: string | unknown[] | null): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await source.getDestination(dest) : dest;
    const ref = explicit?.[0];
    if (typeof ref === "number") return ref + 1;
    if (ref && typeof ref === "object") return (await source.getPageIndex(ref)) + 1;
    return null;
  } catch {
    // A broken destination leaves the entry without a page; the rest of the index still works.
    return null;
  }
}

async function convert(source: OutlineSource, raw: RawOutlineItem): Promise<OutlineItem | null> {
  if (!raw.dest) return null;
  const items = await convertAll(source, raw.items);
  return { title: raw.title.trim() || "—", dest: raw.dest, page: await pageOf(source, raw.dest), items };
}

async function convertAll(
  source: OutlineSource,
  raws: RawOutlineItem[] | null | undefined,
): Promise<OutlineItem[]> {
  const converted = await Promise.all((raws ?? []).map((raw) => convert(source, raw)));
  return converted.filter((item): item is OutlineItem => item !== null);
}

/** The book's index with pages resolved. Entries without a destination are left out; no index gives []. */
export async function loadOutline(source: OutlineSource): Promise<OutlineItem[]> {
  return convertAll(source, await source.getOutline());
}

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
