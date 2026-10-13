import { describe, expect, it } from "vitest";
import { formatPercent, nextScale, ZOOM_STEPS } from "./zoom";

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
