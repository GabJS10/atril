/** Class strings of the gallery buttons (DESIGN.md, botones). One place, so every screen shares the same shapes. */

const BASE =
  "inline-flex items-center justify-center gap-2.5 rounded-control px-5 py-3.5 whitespace-nowrap text-base leading-none font-semibold transition-colors duration-fast ease-atril disabled:opacity-50";

/** The main action of a screen: the accent. */
export const primaryButton = `${BASE} bg-accent text-accent-ink hover:brightness-110`;

/** A quiet action: a tone over its surface. */
export const secondaryButton = `${BASE} bg-wash text-ink hover:bg-surface-3`;

/** An action without a box. */
export const ghostButton = `${BASE} text-ink-2 hover:text-ink`;

/** A smaller secondary button, for rows and cards. */
export const smallButton =
  "inline-flex items-center justify-center rounded-control bg-wash px-3.5 py-2.5 text-base leading-none font-medium text-ink transition-colors duration-fast ease-atril hover:bg-surface-3 disabled:opacity-50";

/** A rounded filter chip; `active` fills it with ink. */
export function chipButton(active: boolean, compact = false): string {
  return `inline-flex items-center gap-2 rounded-pill ${compact ? "px-2.5 py-2" : "px-4 py-2.5"} text-ui font-medium transition-colors duration-fast ease-atril ${
    active ? "bg-ink text-ink-inverse" : "bg-field text-ink-2 hover:text-ink"
  }`;
}

/** The text field on a surface: a tray with rounded corners. */
export const fieldInput =
  "min-w-0 rounded-field bg-field px-4 py-3 text-base text-ink placeholder:text-ink-3";

/** A link with a trailing arrow ("Ver todo →"). */
export const textLink = "text-ui font-semibold text-ink-2 transition-colors duration-fast hover:text-ink";
