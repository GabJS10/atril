/** A text position: a text node and an offset inside it. */
export type Caret = { node: Text; offset: number };

/** The browser's caret under a viewport point: a text node, an element position, or null. */
export type CaretAt = (x: number, y: number) => { node: Node; offset: number } | null;

/** The client rectangles of a text node. */
export type RectsOf = (text: Text) => DOMRect[];

export type DragSelectionOptions = {
  caretAt?: CaretAt;
  rectsOf?: RectsOf;
  selectionOf?: () => Selection | null;
  /** The selector of the element that holds the page's text. pdf.js: `.textLayer` (default). */
  layerSelector?: string;
};

/** The browser's own caret lookup (WebKit and Blink; not in the jsdom test environment). */
export function caretAtPoint(x: number, y: number): ReturnType<CaretAt> {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/** The client rectangles of a text node, through a range. */
export function textRects(text: Text): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(text);
  return Array.from(range.getClientRects());
}

/** Vertical distance counts more than horizontal: the nearest line wins before the nearest word on it. */
const LINE_WEIGHT = 10;

/**
 * The text position nearest to a point inside `root`. The nearest line wins; on that line the caret goes before
 * the text when the point is on its left half, and after it otherwise. Empty text yields null.
 */
export function nearestTextCaret(
  root: Node,
  x: number,
  y: number,
  rectsOf: RectsOf = textRects,
): Caret | null {
  let best: { caret: Caret; distance: number } | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
    for (const rect of rectsOf(text)) {
      const dy = Math.max(rect.top - y, 0, y - rect.bottom);
      const dx = Math.max(rect.left - x, 0, x - rect.right);
      const distance = dy * LINE_WEIGHT + dx;
      if (best && best.distance <= distance) continue;
      const offset = x < rect.left + rect.width / 2 ? 0 : text.length;
      best = { caret: { node: text, offset }, distance };
    }
  }
  return best?.caret ?? null;
}

/**
 * Makes a single-press drag over the text layer select text the way the reader expects.
 *
 * WebKit's own drag selection breaks in two places: a press between words or in the margin hits the text layer
 * itself, so the selection keeps an old anchor or jumps to the start of the page; and once pdf.js moves its
 * end-of-content element next to the selection end, the drag can get stuck on the first line. This takes over
 * such drags: the anchor is the text under the press, the focus follows the pointer to the nearest text, and the
 * selection is extended on every move while the button is down. Double and triple clicks keep the browser's
 * word and line selection.
 *
 * Returns the function that removes the listeners.
 */
export function attachDragSelection(root: HTMLElement, options: DragSelectionOptions = {}): () => void {
  const caretAt = options.caretAt ?? caretAtPoint;
  const rectsOf = options.rectsOf ?? textRects;
  const selectionOf = options.selectionOf ?? (() => window.getSelection());
  const layerSelector = options.layerSelector ?? ".textLayer";
  let dragging = false;

  /** A text caret inside any text layer (the pointer may leave `root` into the next page), else the nearest in `root`. */
  const textCaretAt = (x: number, y: number): Caret | null => {
    const caret = caretAt(x, y);
    if (
      caret?.node.nodeType === Node.TEXT_NODE &&
      (caret.node as Text).parentElement?.closest(layerSelector)
    ) {
      return { node: caret.node as Text, offset: caret.offset };
    }
    return nearestTextCaret(root, x, y, rectsOf);
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || event.detail > 1) return;
    const caret = textCaretAt(event.clientX, event.clientY);
    const selection = selectionOf();
    if (!caret || !selection) return;
    event.preventDefault();
    dragging = true;
    selection.setBaseAndExtent(caret.node, caret.offset, caret.node, caret.offset);
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!dragging) return;
    if ((event.buttons & 1) === 0) {
      dragging = false;
      return;
    }
    const caret = textCaretAt(event.clientX, event.clientY);
    if (caret) selectionOf()?.extend(caret.node, caret.offset);
  };

  const stop = () => {
    dragging = false;
  };

  root.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", stop);
  window.addEventListener("blur", stop);
  return () => {
    root.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", stop);
    window.removeEventListener("blur", stop);
  };
}
