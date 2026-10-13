import { getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import { beforeAll, describe, expect, it } from "vitest";
import { textoPdfBytes } from "../test/fixtures/texto";
import { type Box, boxToPdfRect, mergeLineBoxes, pdfRectToBox, pdfRectToPercent } from "./geometry";

// pdf.js 6 hashes the document with Uint8Array#toHex, which the jsdom realm does not provide.
if (!("toHex" in Uint8Array.prototype)) {
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    value(this: Uint8Array) {
      return Array.from(this, (byte) => byte.toString(16).padStart(2, "0")).join("");
    },
  });
}

const SCALES = [0.5, 1, 1.37, 2, 3];
const ROTATIONS = [0, 90, 180, 270];

let pdf: PDFDocumentProxy;

beforeAll(async () => {
  pdf = await getDocument({ data: textoPdfBytes(), disableWorker: true } as never).promise;
});

async function page(number: number): Promise<PDFPageProxy> {
  return pdf.getPage(number);
}

const close = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
};

describe("viewport conversions", () => {
  it.each(SCALES.flatMap((scale) => ROTATIONS.map((rotation) => [scale, rotation] as const)))(
    "round-trips a box at scale %s and rotation %s",
    async (scale, rotation) => {
      const viewport = (await page(1)).getViewport({ scale, rotation });
      const box: Box = { x1: 40, y1: 60, x2: 210, y2: 95 };

      const rect = boxToPdfRect(box, viewport);
      const back = pdfRectToBox(rect, viewport);

      close([back.x1, back.y1, back.x2, back.y2], [box.x1, box.y1, box.x2, box.y2]);
    },
  );

  it("maps the top-left corner of an unrotated page to the top-left of its PDF box", async () => {
    const viewport = (await page(1)).getViewport({ scale: 1, rotation: 0 });
    const [x0, y0, , y1] = viewport.viewBox as [number, number, number, number];

    const rect = boxToPdfRect({ x1: 0, y1: 0, x2: 0, y2: 0 }, viewport);

    close(rect, [x0, y1, x0, y1]);
    expect(y0).toBeLessThan(y1);
  });

  it("keeps the same place in the page when the zoom changes", async () => {
    const at1 = (await page(1)).getViewport({ scale: 1 });
    const at3 = (await page(1)).getViewport({ scale: 3 });
    const rect = boxToPdfRect({ x1: 50, y1: 80, x2: 150, y2: 100 }, at1);

    const scaled = pdfRectToBox(rect, at3);

    close([scaled.x1, scaled.y1, scaled.x2, scaled.y2], [150, 240, 450, 300]);
  });

  it("swaps the page size for 90 and 270 degree rotations", async () => {
    const upright = (await page(1)).getViewport({ scale: 1, rotation: 0 });
    const turned = (await page(1)).getViewport({ scale: 1, rotation: 90 });

    expect(turned.width).toBeCloseTo(upright.height, 6);
    expect(turned.height).toBeCloseTo(upright.width, 6);
  });
});

describe("percentages of the page box", () => {
  it.each(ROTATIONS)("stays inside the page for rotation %s", async (rotation) => {
    const viewport = (await page(1)).getViewport({ scale: 1, rotation });
    const rect = boxToPdfRect({ x1: 100, y1: 200, x2: 300, y2: 230 }, viewport);

    const percent = pdfRectToPercent(rect, viewport);

    expect(percent.left).toBeGreaterThanOrEqual(0);
    expect(percent.top).toBeGreaterThanOrEqual(0);
    expect(percent.left + percent.width).toBeLessThanOrEqual(100.0001);
    expect(percent.top + percent.height).toBeLessThanOrEqual(100.0001);
    expect(percent.width).toBeGreaterThan(0);
  });
});

describe("mergeLineBoxes", () => {
  it("joins the spans of one line into one box", () => {
    const spans: Box[] = [
      { x1: 10, y1: 100, x2: 60, y2: 114 },
      { x1: 62, y1: 100.5, x2: 120, y2: 114.5 },
      { x1: 122, y1: 99.8, x2: 180, y2: 113.8 },
    ];
    const lines = mergeLineBoxes(spans);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ x1: 10, y1: 99.8, x2: 180, y2: 114.5 });
  });

  it("keeps separate lines apart", () => {
    const lines = mergeLineBoxes([
      { x1: 10, y1: 100, x2: 180, y2: 114 },
      { x1: 10, y1: 120, x2: 180, y2: 134 },
    ]);
    expect(lines).toHaveLength(2);
  });

  it("does not join two columns that share a line band", () => {
    const lines = mergeLineBoxes([
      { x1: 10, y1: 100, x2: 100, y2: 114 },
      { x1: 400, y1: 100, x2: 490, y2: 114 },
    ]);
    expect(lines).toHaveLength(2);
  });

  it("drops zero-area boxes", () => {
    const lines = mergeLineBoxes([
      { x1: 10, y1: 100, x2: 10, y2: 114 },
      { x1: 10, y1: 100, x2: 60, y2: 100 },
      { x1: 70, y1: 100, x2: 120, y2: 114 },
    ]);
    expect(lines).toEqual([{ x1: 70, y1: 100, x2: 120, y2: 114 }]);
  });

  it("normalises reversed corners", () => {
    expect(mergeLineBoxes([{ x1: 60, y1: 114, x2: 10, y2: 100 }])).toEqual([
      { x1: 10, y1: 100, x2: 60, y2: 114 },
    ]);
  });
});
