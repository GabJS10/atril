import type { PdfRect } from "../api/types";
import {
  boxesByPage,
  boxToPdfRect,
  MAX_RECTS_PER_HIGHLIGHT,
  mergeLineBoxes,
  type Box,
  type PageFrame,
  type PageMapping,
} from "./geometry";

/**
 * What a selection covers on one page: PDF rectangles (one per line) and the text. `text` has its breaks folded into
 * spaces (it is what a highlight stores); `copyText`, when the viewer has it, keeps the line and block breaks.
 */
export type SelectionPart = { page: number; rects: PdfRect[]; text: string; copyText?: string };

/**
 * Reads a text selection of the pdf.js viewer as highlights, one part per page it touches (roadmap 3.F1).
 * `mappingOf` gives the page's viewport at the current zoom. Empty when nothing is selected.
 */
export function readSelection(
  selection: Selection,
  container: HTMLElement,
  mappingOf: (page: number) => PageMapping | undefined,
): SelectionPart[] {
  if (selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return [];

  const clientBoxes: Box[] = Array.from(range.getClientRects()).map((rect) => ({
    x1: rect.left,
    y1: rect.top,
    x2: rect.right,
    y2: rect.bottom,
  }));
  const pageElements = Array.from(container.querySelectorAll<HTMLElement>(".page[data-page-number]"));
  const frames: PageFrame[] = pageElements.map((element) => {
    const box = element.getBoundingClientRect();
    return {
      page: Number(element.dataset.pageNumber),
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    };
  });

  const byPage = boxesByPage(clientBoxes, frames);
  const parts: SelectionPart[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const mapping = mappingOf(page);
    if (!mapping) continue;
    const rects = mergeLineBoxes(byPage.get(page) ?? [])
      .slice(0, MAX_RECTS_PER_HIGHLIGHT)
      .map((box) => boxToPdfRect(box, mapping));
    if (rects.length === 0) continue;
    const pageElement = pageElements.find((element) => Number(element.dataset.pageNumber) === page);
    parts.push({ page, rects, text: pageElement ? textOfPage(range, pageElement) : "" });
  }
  return parts;
}

/** The text of the selection inside one page: the spans of its text layer that the range touches. */
export function textOfPage(range: Range, pageElement: HTMLElement): string {
  const spans = Array.from(pageElement.querySelectorAll<HTMLElement>(".textLayer span"));
  return spans
    .filter((span) => range.intersectsNode(span))
    .map((span) => span.textContent ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10_000);
}
