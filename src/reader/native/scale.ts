import type { Zoom } from "../../api/types";
import { CSS_UNITS } from "./mapping";

/** Smallest and largest zoom (pdf.js scale units: 1 = 100 %). */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 5;

/** Largest scale `auto` reaches on its own (pdf.js's MAX_AUTO_SCALE). */
const MAX_AUTO_SCALE = 1.25;

/** The images the engine can draw: pixels per PDF point, from 0.1 to 8 (docs/IPC.md). */
export const MIN_IMAGE_SCALE = 0.1;
export const MAX_IMAGE_SCALE = 8;

export type Box = { width: number; height: number };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * The scale (pdf.js units) a Zoom stands for on a given page and viewport. Like pdf.js, `page_width`, `page_fit` and
 * `auto` are measured on one page (the current one) at the moment they are applied.
 */
export function scaleForZoom(zoom: Zoom, page: Box, viewport: Box): number {
  if (typeof zoom === "number") return clampScale(zoom);
  const widthScale = viewport.width / (page.width * CSS_UNITS);
  const heightScale = viewport.height / (page.height * CSS_UNITS);
  switch (zoom) {
    case "page_width":
      return clampScale(widthScale);
    case "page_fit":
      return clampScale(Math.min(widthScale, heightScale));
    case "auto": {
      const landscape = page.width > page.height;
      return clampScale(Math.min(MAX_AUTO_SCALE, landscape ? Math.min(heightScale, widthScale) : widthScale));
    }
  }
}

/** True when the zoom follows the window (a preset) rather than being a fixed scale. */
export function isPreset(zoom: Zoom): boolean {
  return typeof zoom !== "number";
}

/** The zoom to save for `scale`: presets keep their name; a fixed scale is rounded to a thousandth. */
export function zoomFor(preset: Zoom, scale: number): Zoom {
  return isPreset(preset) ? preset : Math.round(scale * 1000) / 1000;
}

/**
 * Pixels per PDF point for the image: the zoom times the device pixel ratio, in hundredths (the engine quantises the
 * same way) and inside the range the engine accepts.
 */
export function imageScaleFor(scale: number, devicePixelRatio: number): number {
  const wanted = scale * CSS_UNITS * Math.max(devicePixelRatio, 1);
  const clamped = Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, wanted));
  return Math.round(clamped * 100) / 100;
}

/** The URL of one page image. `pageBaseUrl` comes from open_document; the front never builds it. */
export function pageImageUrl(pageBaseUrl: string, page: number, imageScale: number): string {
  return `${pageBaseUrl}/${page}?scale=${imageScale}`;
}

/** A zoom factor per wheel notch with Ctrl held, kept small so a trackpad pinch stays smooth. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaY;
  return Math.exp(Math.min(50, Math.max(-50, -pixels)) * 0.004);
}
