import type { ReadingState, Settings, Zoom, ViewMode } from "../api/types";

/** Where the reader is: a 1-based page and how far down it the top of the view is (0–1 of its height). */
export type ReaderPosition = { page: number; offsetInPage: number };

/**
 * Geometry of the page stack in the scroll content (pixels). `topOf` and `heightOf` take a 0-based
 * index. They are accessors so the viewer can read the DOM only for the pages it needs.
 */
export type PageGeometry = {
  count: number;
  topOf: (index: number) => number;
  heightOf: (index: number) => number;
};

/** Where the reader starts: the saved position and zoom, or nothing (the first page, the default zoom). */
export type ReadingStart = {
  zoom: Zoom;
  viewMode: ViewMode;
  position: ReaderPosition | null;
};

const OFFSET_DECIMALS = 10_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The position under the top edge of the view (`scrollTop`). Binary search over the page tops. */
export function positionAtScroll(geometry: PageGeometry, scrollTop: number): ReaderPosition {
  if (geometry.count === 0) return { page: 1, offsetInPage: 0 };

  let low = 0;
  let high = geometry.count - 1;
  let index = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (geometry.topOf(middle) <= scrollTop) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const height = geometry.heightOf(index);
  const raw = height > 0 ? (scrollTop - geometry.topOf(index)) / height : 0;
  const offset = clamp(raw, 0, 1);
  return { page: index + 1, offsetInPage: Math.round(offset * OFFSET_DECIMALS) / OFFSET_DECIMALS };
}

/** The `scrollTop` that puts `position` at the top of the view. Inverse of `positionAtScroll`. */
export function scrollForPosition(geometry: PageGeometry, position: ReaderPosition): number {
  if (geometry.count === 0) return 0;
  const index = clamp(position.page - 1, 0, geometry.count - 1);
  return geometry.topOf(index) + clamp(position.offsetInPage, 0, 1) * geometry.heightOf(index);
}

/** Restored from the saved reading state, or the Settings defaults when the book was never read. */
export function initialReadingStart(state: ReadingState | null, settings: Settings): ReadingStart {
  if (!state) {
    return { zoom: settings.defaultZoom, viewMode: settings.defaultViewMode, position: null };
  }
  return {
    zoom: state.zoom,
    viewMode: state.viewMode,
    position: { page: state.page, offsetInPage: state.offsetInPage },
  };
}
