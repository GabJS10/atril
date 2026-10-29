import type { Highlight, HighlightGroup } from "../api/types";

/** Where the reader scrolls to show a highlight: a third of the viewport above it. */
export function scrollTopToReveal(
  pageTop: number,
  pageHeight: number,
  percentTop: number,
  viewportHeight: number,
): number {
  const target = pageTop + (percentTop / 100) * pageHeight - viewportHeight / 3;
  return Math.max(0, target);
}

/** Highlights of one page, in reading order (top to bottom, then creation). */
export type PageHighlights = { page: number; items: Highlight[] };

/** Top of a highlight in PDF space: the largest y of its rectangles (PDF y grows upwards). */
function topOf(highlight: Highlight): number {
  return Math.max(...highlight.rects.map((rect) => rect[3]), 0);
}

/** Groups highlights by page, pages in order; inside a page, the highest line comes first. */
export function groupByPage(highlights: Highlight[]): PageHighlights[] {
  const sorted = [...highlights].sort(
    (a, b) => a.page - b.page || topOf(b) - topOf(a) || a.createdAt.localeCompare(b.createdAt),
  );
  const groups: PageHighlights[] = [];
  for (const highlight of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.page === highlight.page) last.items.push(highlight);
    else groups.push({ page: highlight.page, items: [highlight] });
  }
  return groups;
}

/** Recent first ("recent", the default of the panel) or the order of the book ("page", see groupByPage). */
export type HighlightOrder = "recent" | "page";

function createdTime(highlight: Highlight): number {
  return Date.parse(highlight.createdAt) || 0;
}

/**
 * Orders highlights for the panel. "recent": newest first; the highlights saved in one go (a selection over
 * several pages) keep their reading order. "page": the reading order of the book.
 */
export function sortHighlights(highlights: Highlight[], order: HighlightOrder): Highlight[] {
  if (order === "page") return groupByPage(highlights).flatMap((group) => group.items);
  return [...highlights].sort(
    (a, b) =>
      createdTime(b) - createdTime(a) || a.page - b.page || topOf(b) - topOf(a) || a.id.localeCompare(b.id),
  );
}

/** Groups in the order the user gave them; a new group goes last. */
export function byGroupPosition(a: HighlightGroup, b: HighlightGroup): number {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt);
}

/** One section of the panel: the highlights of a group, or of no group (`group` null, "Sin grupo"). */
export type HighlightSection = { group: HighlightGroup | null; items: Highlight[] };

/**
 * Splits highlights (already ordered, see sortHighlights) into the panel's sections: one per group in position
 * order, and "Sin grupo" last. "Sin grupo" appears only when it has highlights. A group with no highlights appears
 * only when `keepEmpty`: the panel keeps it in "Todos", so a highlight can be moved there, and drops it under
 * "Con nota", where it would be an empty section. A highlight whose group is not in `groups` counts as ungrouped.
 */
export function groupHighlights(
  highlights: Highlight[],
  groups: HighlightGroup[],
  keepEmpty: boolean,
): HighlightSection[] {
  const known = new Set(groups.map((group) => group.id));
  const byGroup = new Map<string, Highlight[]>();
  const ungrouped: Highlight[] = [];
  for (const highlight of highlights) {
    if (highlight.groupId && known.has(highlight.groupId)) {
      const items = byGroup.get(highlight.groupId) ?? [];
      items.push(highlight);
      byGroup.set(highlight.groupId, items);
    } else {
      ungrouped.push(highlight);
    }
  }

  const sections: HighlightSection[] = [];
  for (const group of [...groups].sort(byGroupPosition)) {
    const items = byGroup.get(group.id) ?? [];
    if (items.length > 0 || keepEmpty) sections.push({ group, items });
  }
  if (ungrouped.length > 0) sections.push({ group: null, items: ungrouped });
  return sections;
}

/** Characters that cannot be part of a file name on Linux or Windows. */
const UNSAFE_FILE_CHARS = '\\/:*?"<>|';

function isUnsafeFileChar(char: string): boolean {
  return UNSAFE_FILE_CHARS.includes(char) || char.charCodeAt(0) < 32;
}

/** The suggested name of the export: "<title> - subrayados.md". */
export function suggestedExportName(title: string): string {
  const base =
    [...title]
      .map((char) => (isUnsafeFileChar(char) ? " " : char))
      .join("")
      .replace(/\s+/g, " ")
      .trim() || "Atril";
  return `${base} - subrayados.md`;
}
