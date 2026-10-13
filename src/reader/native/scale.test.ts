import { describe, expect, it } from "vitest";
import { CSS_UNITS } from "./mapping";
import {
  clampScale,
  imageScaleFor,
  isPreset,
  MAX_SCALE,
  MIN_SCALE,
  pageImageUrl,
  scaleForZoom,
  wheelZoomFactor,
  zoomFor,
} from "./scale";

const letter = { width: 612, height: 792 };
const viewport = { width: 1000, height: 700 };

describe("scaleForZoom", () => {
  it("fits the page width (pdf.js units: 1 = 96 dpi)", () => {
    expect(scaleForZoom("page_width", letter, viewport)).toBeCloseTo(1000 / (612 * CSS_UNITS), 9);
  });

  it("fits the whole page", () => {
    expect(scaleForZoom("page_fit", letter, viewport)).toBeCloseTo(700 / (792 * CSS_UNITS), 9);
    expect(scaleForZoom("page_fit", letter, { width: 400, height: 2000 })).toBeCloseTo(
      400 / (612 * CSS_UNITS),
      9,
    );
  });

  it("auto is the page width up to 125 %, and in a landscape page also fits the height", () => {
    expect(scaleForZoom("auto", letter, { width: 1400, height: 700 })).toBe(1.25);
    expect(scaleForZoom("auto", letter, { width: 600, height: 700 })).toBeCloseTo(600 / (612 * CSS_UNITS), 9);
    const landscape = { width: 792, height: 612 };
    expect(scaleForZoom("auto", landscape, { width: 1200, height: 500 })).toBeCloseTo(
      500 / (612 * CSS_UNITS),
      9,
    );
  });

  it("keeps a number, inside the limits", () => {
    expect(scaleForZoom(1.5, letter, viewport)).toBe(1.5);
    expect(scaleForZoom(0.01, letter, viewport)).toBe(MIN_SCALE);
    expect(scaleForZoom(50, letter, viewport)).toBe(MAX_SCALE);
    expect(clampScale(2)).toBe(2);
  });

  it("re-fits to a resized window", () => {
    const small = scaleForZoom("page_width", letter, { width: 500, height: 700 });
    const large = scaleForZoom("page_width", letter, { width: 1500, height: 700 });
    expect(large / small).toBeCloseTo(3, 9);
  });
});

describe("zoomFor", () => {
  it("keeps a preset's name and rounds a number", () => {
    expect(zoomFor("page_width", 1.2345)).toBe("page_width");
    expect(zoomFor(1, 1.23456)).toBe(1.235);
    expect(isPreset("auto")).toBe(true);
    expect(isPreset(1)).toBe(false);
  });
});

describe("imageScaleFor", () => {
  it("is the zoom times the CSS units times the pixel ratio, in hundredths", () => {
    expect(imageScaleFor(1, 1)).toBe(1.33);
    expect(imageScaleFor(1, 2)).toBe(2.67);
    expect(imageScaleFor(1.5, 1.5)).toBe(3);
  });

  it("stays in the range the engine accepts", () => {
    expect(imageScaleFor(0.01, 1)).toBe(0.1);
    expect(imageScaleFor(5, 2)).toBe(8);
  });

  it("never asks for less than one pixel per device pixel", () => {
    expect(imageScaleFor(1, 0)).toBe(1.33);
  });
});

describe("pageImageUrl", () => {
  it("appends the page and the scale to the base the backend gave", () => {
    expect(pageImageUrl("atril://localhost/page/abc", 12, 2.67)).toBe(
      "atril://localhost/page/abc/12?scale=2.67",
    );
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in on a negative delta and out on a positive one, by a bounded step", () => {
    expect(wheelZoomFactor(-10, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10, 0)).toBeLessThan(1);
    expect(wheelZoomFactor(-1000, 0)).toBeCloseTo(wheelZoomFactor(-50, 0), 9);
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(wheelZoomFactor(-48, 0), 9);
  });
});
