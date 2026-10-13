import { afterEach, describe, expect, it } from "vitest";
import type { TextWord } from "../../api/types";
import type { PageMapping } from "../geometry";
import { coveredChars, layerWords, readNativeSelection, selectionCopyText } from "./textSelection";

// A 400 x 600 page whose view space is the PDF space flipped: the matrix of the tests of the viewer.
const mapping: PageMapping = {
  convertToViewportPoint: (x, y) => [x, 600 - y],
  convertToPdfPoint: (x, y) => [x, 600 - y],
};

const WORDS: TextWord[] = [
  { text: "En", rect: [50, 100, 70, 112], lineEnd: false, blockEnd: false },
  { text: "un", rect: [75, 100, 95, 112], lineEnd: false, blockEnd: false },
  { text: "lugar", rect: [100, 100, 150, 112], lineEnd: true, blockEnd: false },
  { text: "de", rect: [50, 115, 70, 127], lineEnd: false, blockEnd: false },
  { text: "la", rect: [75, 115, 95, 127], lineEnd: true, blockEnd: true },
];

function mountPage(page: number, words: TextWord[], parent: HTMLElement): HTMLElement {
  const pageElement = document.createElement("div");
  pageElement.className = "page";
  pageElement.dataset.pageNumber = String(page);
  const layer = document.createElement("div");
  layer.className = "atril-text-layer";
  for (const word of words) {
    const span = document.createElement("span");
    span.className = "atril-text-word";
    span.textContent = word.text;
    layer.append(span);
  }
  layerWords.set(layer, words);
  pageElement.append(layer);
  parent.append(pageElement);
  return pageElement;
}

function selectBetween(start: [Node, number], end: [Node, number]): Selection {
  const selection = window.getSelection()!;
  selection.setBaseAndExtent(start[0], start[1], end[0], end[1]);
  return selection;
}

const spanText = (page: HTMLElement, index: number) =>
  page.querySelectorAll(".atril-text-word")[index]!.firstChild!;

let container: HTMLElement;
afterEach(() => {
  container.remove();
  window.getSelection()?.removeAllRanges();
});
function setup() {
  container = document.createElement("div");
  document.body.append(container);
  return mountPage(1, WORDS, container);
}

describe("readNativeSelection", () => {
  it("reads a whole run of words as one rectangle per line, in PDF space, with the breaks kept for copying", () => {
    const page = setup();
    const selection = selectBetween([spanText(page, 0), 0], [spanText(page, 4), 2]);

    const parts = readNativeSelection(selection, container, () => mapping);

    expect(parts).toHaveLength(1);
    const [part] = parts;
    expect(part!.page).toBe(1);
    // Two lines: y 100-112 and 115-127 in view space become 488-500 and 473-485 in PDF space.
    expect(part!.rects).toEqual([
      [50, 488, 150, 500],
      [50, 473, 95, 485],
    ]);
    expect(part!.copyText).toBe("En un lugar\nde la");
    expect(part!.text).toBe("En un lugar de la");
    expect(selectionCopyText(parts)).toBe("En un lugar\nde la");
  });

  it("cuts the first and last word at the characters the selection starts and ends on", () => {
    const page = setup();
    // "lugar" from its 2nd letter to "de" up to its 1st: "ugar", "d".
    const selection = selectBetween([spanText(page, 2), 1], [spanText(page, 3), 1]);

    const [part] = readNativeSelection(selection, container, () => mapping);

    expect(part!.copyText).toBe("ugar\nd");
    // "lugar" is 100..150: from 1/5 of it, so 110..150; "de" is 50..70: up to 1/2, so 50..60.
    expect(part!.rects).toEqual([
      [110, 488, 150, 500],
      [50, 473, 60, 485],
    ]);
  });

  it("does not count a word the selection only touches", () => {
    const page = setup();
    // From the end of "En" to the start of "lugar": only "un".
    const selection = selectBetween([spanText(page, 0), 2], [spanText(page, 2), 0]);

    const [part] = readNativeSelection(selection, container, () => mapping);

    expect(part!.copyText).toBe("un");
  });

  it("gives one part per page and sorts them in page order", () => {
    const first = setup();
    const second = mountPage(2, WORDS.slice(0, 2), container);
    const selection = selectBetween([spanText(first, 3), 0], [spanText(second, 1), 2]);

    const parts = readNativeSelection(selection, container, () => mapping);

    expect(parts.map((part) => [part.page, part.copyText])).toEqual([
      [1, "de la"],
      [2, "En un"],
    ]);
    expect(selectionCopyText(parts)).toBe("de la\nEn un");
  });

  it("skips a page whose mapping is unknown, and a selection outside the container", () => {
    const page = setup();
    const selection = selectBetween([spanText(page, 0), 0], [spanText(page, 1), 2]);
    expect(readNativeSelection(selection, container, () => undefined)).toEqual([]);

    const outside = document.createElement("p");
    outside.textContent = "fuera";
    document.body.append(outside);
    const elsewhere = selectBetween([outside.firstChild!, 0], [outside.firstChild!, 3]);
    expect(readNativeSelection(elsewhere, container, () => mapping)).toEqual([]);
    outside.remove();
  });

  it("is empty for a collapsed selection", () => {
    const page = setup();
    const selection = selectBetween([spanText(page, 0), 1], [spanText(page, 0), 1]);
    expect(readNativeSelection(selection, container, () => mapping)).toEqual([]);
  });
});

describe("coveredChars", () => {
  it("understands a boundary on the span itself: offset 0 is before its text, 1 after it", () => {
    const page = setup();
    const span = page.querySelectorAll<HTMLElement>(".atril-text-word")[1]!;
    const range = document.createRange();
    range.setStart(span, 0);
    range.setEnd(span, 1);
    expect(coveredChars(range, span, 2)).toEqual({ from: 0, to: 2 });
  });

  it("is null for a span the range does not reach", () => {
    const page = setup();
    const spans = page.querySelectorAll<HTMLElement>(".atril-text-word");
    const range = document.createRange();
    range.selectNodeContents(spans[0]!);
    expect(coveredChars(range, spans[3]!, 2)).toBeNull();
  });
});
