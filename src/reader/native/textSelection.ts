import type { PdfRect, TextWord } from "../../api/types";
import {
  boxToPdfRect,
  MAX_RECTS_PER_HIGHLIGHT,
  mergeLineBoxes,
  type Box,
  type PageMapping,
} from "../geometry";
import { copyTextOf, foldedTextOf, sliceBox, type WordSlice } from "./textLayerModel";

/**
 * What a selection covers on one page: PDF rectangles (one per line) and the text. A highlight takes whole words: every
 * word the selection touches is in `text` and `rects` in full, with its breaks folded into spaces. `copyText` is the
 * exact selection, with the line and block breaks, for the clipboard.
 */
export type SelectionPart = { page: number; rects: PdfRect[]; text: string; copyText?: string };

export const TEXT_LAYER_CLASS = "atril-text-layer";
export const TEXT_WORD_CLASS = "atril-text-word";

/** The words of each mounted text layer. The layer's spans are in the same order as its words. */
export const layerWords = new WeakMap<Element, TextWord[]>();

/**
 * Which characters of a word the range covers, or null when none. `textNode` is the text inside the span: a range
 * boundary is either in it, on the span itself (offset 0 is before the text, 1 after it) or outside the span.
 */
export function coveredChars(
  range: Range,
  span: HTMLElement,
  length: number,
): { from: number; to: number } | null {
  if (!range.intersectsNode(span)) return null;
  const textNode = span.firstChild;
  let from = 0;
  let to = length;
  if (range.startContainer === textNode) from = range.startOffset;
  else if (range.startContainer === span) from = range.startOffset > 0 ? length : 0;
  if (range.endContainer === textNode) to = range.endOffset;
  else if (range.endContainer === span) to = range.endOffset > 0 ? length : 0;
  // The span can hold the space after the word; it is not part of the word.
  from = Math.min(from, length);
  to = Math.min(to, length);
  return to > from ? { from, to } : null;
}

/** The selection as highlights, one part per page it touches. Empty when nothing of the text layers is selected. */
export function readNativeSelection(
  selection: Selection,
  container: HTMLElement,
  mappingOf: (page: number) => PageMapping | undefined,
): SelectionPart[] {
  if (selection.isCollapsed || selection.rangeCount === 0) return [];
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return [];

  const parts: SelectionPart[] = [];
  for (const layer of container.querySelectorAll<HTMLElement>(`.${TEXT_LAYER_CLASS}`)) {
    const words = layerWords.get(layer);
    const pageElement = layer.closest<HTMLElement>(".page[data-page-number]");
    if (!words || !pageElement || !range.intersectsNode(layer)) continue;
    const page = Number(pageElement.dataset.pageNumber);
    const mapping = mappingOf(page);
    if (!mapping) continue;

    // The exact characters the selection covers (for the clipboard), and every word it touches in full (for the
    // highlight: a selection that starts or ends mid-word still keeps the whole word).
    const exact: WordSlice[] = [];
    const whole: WordSlice[] = [];
    const boxes: Box[] = [];
    const spans = layer.children;
    for (let index = 0; index < spans.length && index < words.length; index += 1) {
      const word = words[index]!;
      const covered = coveredChars(range, spans[index] as HTMLElement, word.text.length);
      if (!covered) continue;
      const box = sliceBox(word, 0, word.text.length);
      if (!box) continue;
      exact.push({ index, ...covered });
      whole.push({ index, from: 0, to: word.text.length });
      boxes.push(box);
    }
    if (exact.length === 0) continue;

    // The boxes are already in the page's space at scale 1, so the page's mapping at scale 1 gives PDF space.
    const rects = mergeLineBoxes(boxes)
      .slice(0, MAX_RECTS_PER_HIGHLIGHT)
      .map((box) => boxToPdfRect(box, mapping));
    if (rects.length === 0) continue;
    parts.push({
      page,
      rects,
      text: foldedTextOf(copyTextOf(words, whole)),
      copyText: copyTextOf(words, exact),
    });
  }
  return parts;
}

/** What the clipboard gets for the selection: the words with their line and block breaks, pages joined by a line break. */
export function selectionCopyText(parts: SelectionPart[]): string {
  return parts.map((part) => part.copyText ?? part.text).join("\n");
}
