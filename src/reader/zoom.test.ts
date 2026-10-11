import { describe, expect, it } from "vitest";
import { formatPercent, nextScale, zoomFromViewer, zoomToScaleValue, ZOOM_STEPS } from "./zoom";

describe("zoomToScaleValue", () => {
  it("maps presets to pdf.js scale values and numbers to their string", () => {
    expect(zoomToScaleValue("page_width")).toBe("page-width");
    expect(zoomToScaleValue("page_fit")).toBe("page-fit");
    expect(zoomToScaleValue("auto")).toBe("auto");
    expect(zoomToScaleValue(1.25)).toBe("1.25");
  });
});

describe("zoomFromViewer", () => {
  it("keeps presets by name and turns any other value into a scale", () => {
    expect(zoomFromViewer("page-width", 1.4)).toBe("page_width");
    expect(zoomFromViewer("page-fit", 0.9)).toBe("page_fit");
    expect(zoomFromViewer("auto", 1)).toBe("auto");
    expect(zoomFromViewer("1.25", 1.2500001)).toBe(1.25);
  });
});

describe("nextScale", () => {
  it("steps up and down through ZOOM_STEPS", () => {
    expect(nextScale(1, 1)).toBe(1.25);
    expect(nextScale(1, -1)).toBe(0.75);
  });

  it("starts from a scale that is between two steps", () => {
    expect(nextScale(1.1, 1)).toBe(1.25);
    expect(nextScale(1.1, -1)).toBe(1);
  });

  it("clamps at the first and last step", () => {
    const last = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    expect(nextScale(last!, 1)).toBe(last);
    expect(nextScale(ZOOM_STEPS[0]!, -1)).toBe(ZOOM_STEPS[0]);
  });
});

describe("formatPercent", () => {
  it("formats the scale for the UI locale", () => {
    expect(formatPercent(1.25, "es")).toMatch(/125\s?%/);
    expect(formatPercent(1.25, "en")).toBe("125%");
  });
});
