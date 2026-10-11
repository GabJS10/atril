import type { Zoom } from "../api/types";

/** Scales for +/−, from 50 % to 400 %. The starting point can be any zoom (e.g. page width). */
export const ZOOM_STEPS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const EPSILON = 0.001;

/** The value pdf.js expects in `PDFViewer.currentScaleValue` for a Zoom. */
export function zoomToScaleValue(zoom: Zoom): string {
  if (typeof zoom === "number") return String(zoom);
  switch (zoom) {
    case "page_width":
      return "page-width";
    case "page_fit":
      return "page-fit";
    case "auto":
      return "auto";
  }
}

/** Maps what pdf.js reports back to a Zoom. Presets keep their name; anything else is a scale. */
export function zoomFromViewer(scaleValue: string, scale: number): Zoom {
  switch (scaleValue) {
    case "page-width":
      return "page_width";
    case "page-fit":
      return "page_fit";
    case "auto":
      return "auto";
    default:
      return Math.round(scale * 1000) / 1000;
  }
}

/** The next step above or below `current`, clamped at the ends of ZOOM_STEPS. */
export function nextScale(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    return ZOOM_STEPS.find((step) => step > current + EPSILON) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  }
  const below = [...ZOOM_STEPS].reverse().find((step) => step < current - EPSILON);
  return below ?? ZOOM_STEPS[0]!;
}

/** Zoom label for the reader bar, formatted for the UI locale ("100 %" in es, "100%" in en). */
export function formatPercent(scale: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(scale);
}
