import type { TextWord, ViewRect } from "../../api/types";

/** A box in the viewer space at scale 1 (points, origin top-left). */
export type PointBox = { x1: number; y1: number; x2: number; y2: number };

/** Where a word sits inside the text layer, in points. The layer itself is scaled to the zoom with a CSS transform. */
export type WordStyle = { left: number; top: number; width: number; height: number; fontSize: number };

/** The font size is the box height: the text is transparent, only its extent counts for selecting. */
export function wordStyle(rect: ViewRect): WordStyle {
  const [x0, y0, x1, y1] = rect;
  const height = Math.max(y1 - y0, 0);
  return { left: x0, top: y0, width: Math.max(x1 - x0, 0), height, fontSize: height };
}

/**
 * The horizontal stretch that makes a word, drawn in the layer's font, as wide as its box. `natural` is the width
 * the browser gave the text; 0 (not laid out yet, or no text) leaves it alone.
 */
export function stretchFor(rect: ViewRect, natural: number): number {
  const width = rect[2] - rect[0];
  if (!(natural > 0) || !(width > 0)) return 1;
  return width / natural;
}

/** What follows a word when text is copied: a space inside a line, a line break at a line end, a blank line at a block end. */
export function separatorAfter(word: TextWord): string {
  if (word.blockEnd) return "\n\n";
  if (word.lineEnd) return "\n";
  return " ";
}

/** A word cut to a range of its characters (a selection can start or end in the middle of one). */
export type WordSlice = { index: number; from: number; to: number };

/** The text of a run of words, in reading order, with the line and block breaks the engine marked. */
export function copyTextOf(words: readonly TextWord[], slices: readonly WordSlice[]): string {
  let text = "";
  slices.forEach((slice, position) => {
    const word = words[slice.index];
    if (!word) return;
    text += word.text.slice(slice.from, slice.to);
    // The break after the last word is not part of the text.
    if (position < slices.length - 1) text += separatorAfter(word);
  });
  return text;
}

/** Text for a highlight: the same words with every break folded into one space, as the pdf.js viewer stored it. */
export function foldedTextOf(copyText: string, maxLength = 10_000): string {
  return copyText.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * The box a slice of a word covers. The characters of a word are taken as equally wide, which is as close as the
 * engine's per-word box allows; a whole word gives its own box.
 */
export function sliceBox(word: TextWord, from: number, to: number): PointBox | null {
  const length = word.text.length;
  if (length === 0) return null;
  const start = Math.min(Math.max(from, 0), length);
  const end = Math.min(Math.max(to, 0), length);
  if (end <= start) return null;
  const [x0, y0, x1, y1] = word.rect;
  const width = x1 - x0;
  return { x1: x0 + (width * start) / length, y1: y0, x2: x0 + (width * end) / length, y2: y1 };
}
