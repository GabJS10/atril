import type { Highlight } from "../api/types";

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
