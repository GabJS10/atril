import type { PdfRect } from "../api/types";

/**
 * Highlight geometry (roadmap 3.F1). Highlights are stored in PDF user space (origin bottom-left, so they
 * hold at any zoom); the viewer draws them in CSS pixels of the page box. This file converts between the two.
 */

/** A rectangle in CSS pixels of a page box (origin top-left), x1 <= x2 and y1 <= y2 after normalising. */
export type Box = { x1: number; y1: number; x2: number; y2: number };

/** The two conversions of a pdf.js PageViewport (the viewport of one page at one scale and rotation). */
export type PageMapping = {
  convertToPdfPoint: (x: number, y: number) => number[];
  convertToViewportPoint: (x: number, y: number) => number[];
};

/** Rectangles narrower or shorter than this (CSS px) are discarded as zero-area noise. */
export const MIN_BOX_SIZE = 1;

/** How far apart (in line heights) two boxes of one line may be and still be joined. */
const MAX_GAP_IN_LINES = 2;

/** The backend accepts at most this many rectangles per highlight. */
export const MAX_RECTS_PER_HIGHLIGHT = 500;

export function normalizeBox(box: Box): Box {
  return {
    x1: Math.min(box.x1, box.x2),
    y1: Math.min(box.y1, box.y2),
    x2: Math.max(box.x1, box.x2),
    y2: Math.max(box.y1, box.y2),
  };
}

/** Viewport box to PDF rectangle. The four corners are converted, so rotated pages work. */
export function boxToPdfRect(box: Box, page: PageMapping): PdfRect {
  const corners = [
    [box.x1, box.y1],
    [box.x2, box.y1],
    [box.x1, box.y2],
    [box.x2, box.y2],
  ].map(([x, y]) => page.convertToPdfPoint(x!, y!));
  const xs = corners.map((point) => point[0]!);
  const ys = corners.map((point) => point[1]!);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** PDF rectangle to viewport box (the inverse of boxToPdfRect). */
export function pdfRectToBox(rect: PdfRect, page: PageMapping): Box {
  const [x1, y1, x2, y2] = rect;
  const corners = [
    [x1, y1],
    [x2, y1],
    [x1, y2],
    [x2, y2],
  ].map(([x, y]) => page.convertToViewportPoint(x!, y!));
  const xs = corners.map((point) => point[0]!);
  const ys = corners.map((point) => point[1]!);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

/** Two boxes are on the same line when they overlap vertically by more than half the shorter one. */
function sameLine(a: Box, b: Box): boolean {
  const overlap = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  const shorter = Math.min(a.y2 - a.y1, b.y2 - b.y1);
  if (overlap <= shorter / 2) return false;
  const gap = Math.max(a.x1, b.x1) - Math.min(a.x2, b.x2);
  return gap <= shorter * MAX_GAP_IN_LINES;
}

function union(a: Box, b: Box): Box {
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

/**
 * Joins the boxes of one line (the text spans of pdf.js come one by one) and drops zero-area ones.
 * The result has one box per line, in the order the boxes were found.
 */
export function mergeLineBoxes(boxes: Box[], minSize: number = MIN_BOX_SIZE): Box[] {
  const lines: Box[] = [];
  for (const raw of boxes) {
    const box = normalizeBox(raw);
    if (box.x2 - box.x1 < minSize || box.y2 - box.y1 < minSize) continue;
    const index = lines.findIndex((line) => sameLine(line, box));
    if (index === -1) lines.push(box);
    else lines[index] = union(lines[index]!, box);
  }
  return lines;
}

/** A page's box in client (viewport) coordinates, as read from the DOM. */
export type PageFrame = { page: number; left: number; top: number; width: number; height: number };

/**
 * Splits client-coordinate boxes between the pages they touch, in page-local CSS pixels. A box that crosses
 * a page edge is clipped to each page it overlaps.
 */
export function boxesByPage(clientBoxes: Box[], frames: PageFrame[]): Map<number, Box[]> {
  const byPage = new Map<number, Box[]>();
  for (const frame of frames) {
    const pageBox: Box = {
      x1: frame.left,
      y1: frame.top,
      x2: frame.left + frame.width,
      y2: frame.top + frame.height,
    };
    for (const raw of clientBoxes) {
      const box = normalizeBox(raw);
      const clipped: Box = {
        x1: Math.max(box.x1, pageBox.x1),
        y1: Math.max(box.y1, pageBox.y1),
        x2: Math.min(box.x2, pageBox.x2),
        y2: Math.min(box.y2, pageBox.y2),
      };
      if (clipped.x2 <= clipped.x1 || clipped.y2 <= clipped.y1) continue;
      const local: Box = {
        x1: clipped.x1 - frame.left,
        y1: clipped.y1 - frame.top,
        x2: clipped.x2 - frame.left,
        y2: clipped.y2 - frame.top,
      };
      byPage.set(frame.page, [...(byPage.get(frame.page) ?? []), local]);
    }
  }
  return byPage;
}

/** Position of a PDF rectangle inside its page, as percentages of the page box (for the layer in the DOM). */
export type PercentBox = { left: number; top: number; width: number; height: number };

/**
 * Percentages of a page box. `pageAtScale1` is the page's viewport at scale 1 with the same rotation; the
 * percentages do not depend on the zoom, so the layer does not need a redraw when the zoom changes.
 */
export function pdfRectToPercent(
  rect: PdfRect,
  pageAtScale1: PageMapping & { width: number; height: number },
): PercentBox {
  const box = pdfRectToBox(rect, pageAtScale1);
  return {
    left: (box.x1 / pageAtScale1.width) * 100,
    top: (box.y1 / pageAtScale1.height) * 100,
    width: ((box.x2 - box.x1) / pageAtScale1.width) * 100,
    height: ((box.y2 - box.y1) / pageAtScale1.height) * 100,
  };
}
