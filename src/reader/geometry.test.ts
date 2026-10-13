import { describe, expect, it } from "vitest";
import type { PageGeometry } from "../api/types";
import { type Box, boxToPdfRect, mergeLineBoxes, pdfRectToBox, pdfRectToPercent } from "./geometry";
import { type NativePageMapping, pageMapping } from "./native/mapping";

/**
 * The page the viewport tests use is the first page of the two-page "Texto de prueba" PDF (MediaBox [0 0 612 792]).
 * `UPRIGHT_PAGE` holds its viewport at scale 1 for each rotation, computed once with pdf.js 6.4.299
 * (`page.getViewport({ scale: 1, rotation })`: width, height and transform), the same data `open_document` sends. A
 * viewport at another scale is `pageMapping(geometry, scale)`, which multiplies the matrix by the scale.
 */
// prettier-ignore
const UPRIGHT_PAGE: (PageGeometry & { rotation: number })[] = [{rotation:0,width:612,height:792,transform:[1,0,0,-1,0,792]},{rotation:90,width:792,height:612,transform:[0,1,1,0,0,0]},{rotation:180,width:612,height:792,transform:[-1,0,0,1,612,0]},{rotation:270,width:792,height:612,transform:[0,-1,-1,0,792,612]}];

const SCALES = [0.5, 1, 1.37, 2, 3];
const ROTATIONS = [0, 90, 180, 270];

/** The mapping of the test page at `scale` and `rotation`. */
function viewport(
  scale: number,
  rotation = 0,
): NativePageMapping & { viewBox: [number, number, number, number] } {
  const geometry = UPRIGHT_PAGE.find((entry) => entry.rotation === rotation)!;
  return { ...pageMapping(geometry, scale), viewBox: [0, 0, 612, 792] };
}

const close = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 6));
};

describe("viewport conversions", () => {
  it.each(SCALES.flatMap((scale) => ROTATIONS.map((rotation) => [scale, rotation] as const)))(
    "round-trips a box at scale %s and rotation %s",
    (scale, rotation) => {
      const mapping = viewport(scale, rotation);
      const box: Box = { x1: 40, y1: 60, x2: 210, y2: 95 };

      const rect = boxToPdfRect(box, mapping);
      const back = pdfRectToBox(rect, mapping);

      close([back.x1, back.y1, back.x2, back.y2], [box.x1, box.y1, box.x2, box.y2]);
    },
  );

  it("maps the top-left corner of an unrotated page to the top-left of its PDF box", () => {
    const mapping = viewport(1);
    const [x0, y0, , y1] = mapping.viewBox;

    const rect = boxToPdfRect({ x1: 0, y1: 0, x2: 0, y2: 0 }, mapping);

    close(rect, [x0, y1, x0, y1]);
    expect(y0).toBeLessThan(y1);
  });

  it("keeps the same place in the page when the zoom changes", () => {
    const rect = boxToPdfRect({ x1: 50, y1: 80, x2: 150, y2: 100 }, viewport(1));

    const scaled = pdfRectToBox(rect, viewport(3));

    close([scaled.x1, scaled.y1, scaled.x2, scaled.y2], [150, 240, 450, 300]);
  });

  it("swaps the page size for 90 and 270 degree rotations", () => {
    const upright = viewport(1, 0);
    const turned = viewport(1, 90);

    expect(turned.width).toBeCloseTo(upright.height, 6);
    expect(turned.height).toBeCloseTo(upright.width, 6);
  });
});

describe("percentages of the page box", () => {
  it.each(ROTATIONS)("stays inside the page for rotation %s", (rotation) => {
    const mapping = viewport(1, rotation);
    const rect = boxToPdfRect({ x1: 100, y1: 200, x2: 300, y2: 230 }, mapping);

    const percent = pdfRectToPercent(rect, mapping);

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
