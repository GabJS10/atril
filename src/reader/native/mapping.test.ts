import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { beforeAll, describe, expect, it } from "vitest";
import type { PageGeometry } from "../../api/types";
import { type PageBoxes, pageBoxesPdf } from "../../test/fixtures/pageBoxes";
import { boxToPdfRect, pdfRectToBox, pdfRectToPercent } from "../geometry";
import { CSS_UNITS, pageMapping } from "./mapping";

// pdf.js 6 hashes the document with Uint8Array#toHex, which the jsdom realm does not provide.
if (!("toHex" in Uint8Array.prototype)) {
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    value(this: Uint8Array) {
      return Array.from(this, (byte) => byte.toString(16).padStart(2, "0")).join("");
    },
  });
}

const PAGES: Record<string, PageBoxes> = {
  normal: { mediaBox: [0, 0, 612, 792] },
  rotated90: { mediaBox: [0, 0, 612, 792], rotate: 90 },
  rotated270: { mediaBox: [0, 0, 595, 842], rotate: 270 },
  cropped: { mediaBox: [0, 0, 612, 792], cropBox: [50, 30, 400, 500] },
  croppedAndRotated: { mediaBox: [0, 0, 612, 792], cropBox: [50, 30, 400, 500], rotate: 90 },
  userUnit: { mediaBox: [10, 20, 310, 420], userUnit: 2 },
};
const NAMES = Object.keys(PAGES);
const SCALES = [0.5, 1, CSS_UNITS, 2.5, 5.33];
const POINTS: [number, number][] = [
  [0, 0],
  [72, 100],
  [300.5, 410.25],
  [611, 791],
];

let pdf: PDFDocumentProxy;

beforeAll(async () => {
  pdf = await getDocument({ data: pageBoxesPdf(Object.values(PAGES)), disableWorker: true } as never).promise;
});

/** What `open_document` sends for a page: the size and matrix of pdf.js's viewport at scale 1. */
async function geometryOf(name: string): Promise<PageGeometry> {
  const page = await pdf.getPage(NAMES.indexOf(name) + 1);
  const viewport = page.getViewport({ scale: 1 });
  return {
    width: viewport.width,
    height: viewport.height,
    transform: viewport.transform as PageGeometry["transform"],
  };
}

const close = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
};

describe("pageMapping against pdf.js", () => {
  it.each(NAMES)("%s: size and conversions equal pdf.js's viewport at every scale", async (name) => {
    const geometry = await geometryOf(name);
    const page = await pdf.getPage(NAMES.indexOf(name) + 1);
    for (const scale of SCALES) {
      const reference = page.getViewport({ scale });
      const mapping = pageMapping(geometry, scale);
      expect(mapping.width).toBeCloseTo(reference.width, 6);
      expect(mapping.height).toBeCloseTo(reference.height, 6);
      for (const [x, y] of POINTS) {
        close(mapping.convertToViewportPoint(x, y), reference.convertToViewportPoint(x, y));
        close(mapping.convertToPdfPoint(x, y), reference.convertToPdfPoint(x, y));
      }
    }
  });

  it.each(NAMES)("%s: viewport -> PDF -> viewport returns the same point", async (name) => {
    const mapping = pageMapping(await geometryOf(name), 1.7);
    for (const [x, y] of POINTS) {
      const [vx, vy] = mapping.convertToViewportPoint(x, y) as [number, number];
      close(mapping.convertToPdfPoint(vx, vy), [x, y]);
    }
  });

  it.each(NAMES)("%s: a highlight rectangle survives the round trip at several zooms", async (name) => {
    const geometry = await geometryOf(name);
    const rect: [number, number, number, number] = [80, 120, 260, 144];
    for (const scale of [0.75, 1, 2, 4]) {
      const mapping = pageMapping(geometry, scale);
      const box = pdfRectToBox(rect, mapping);
      close(boxToPdfRect(box, mapping), rect);
    }
  });

  it.each(NAMES)("%s: the highlight's percentages do not depend on the zoom", async (name) => {
    const geometry = await geometryOf(name);
    const rect: [number, number, number, number] = [80, 120, 260, 144];
    const expected = pdfRectToPercent(rect, pageMapping(geometry, 1));
    for (const scale of [0.5, CSS_UNITS, 3]) {
      const percent = pdfRectToPercent(rect, pageMapping(geometry, scale));
      expect(percent.left).toBeCloseTo(expected.left, 6);
      expect(percent.top).toBeCloseTo(expected.top, 6);
      expect(percent.width).toBeCloseTo(expected.width, 6);
      expect(percent.height).toBeCloseTo(expected.height, 6);
    }
  });

  it("covers the cases that matter: a rotated page swaps its sides, a cropped one is shifted", async () => {
    const rotated = pageMapping(await geometryOf("rotated90"), 1);
    expect([rotated.width, rotated.height]).toEqual([792, 612]);
    const cropped = pageMapping(await geometryOf("cropped"), 1);
    expect([cropped.width, cropped.height]).toEqual([350, 470]);
    // The CropBox corner (50, 500) is the top left of the page box.
    close(cropped.convertToViewportPoint(50, 500), [0, 0]);
    // The size follows the user unit: 300 x 400 points of 2 units each.
    const unit = pageMapping(await geometryOf("userUnit"), 1);
    expect([unit.width, unit.height]).toEqual([600, 800]);
  });
});
