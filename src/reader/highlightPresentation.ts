import type { HighlightColor } from "../api/types";

/** The four pigments, in the order of the selection toolbar. */
export const PIGMENTS: HighlightColor[] = ["ochre", "sienna", "sage", "slate"];

/** CSS colour of each pigment (the token names in src/index.css do not all match the colour names). */
export const PIGMENT_COLOR: Record<HighlightColor, string> = {
  ochre: "var(--pigment-ocre)",
  sienna: "var(--pigment-sienna)",
  sage: "var(--pigment-sage)",
  slate: "var(--pigment-slate)",
};

/** Translation key of each pigment's name. */
export const PIGMENT_KEY = {
  ochre: "highlight.pigment.ochre",
  sienna: "highlight.pigment.sienna",
  sage: "highlight.pigment.sage",
  slate: "highlight.pigment.slate",
} as const;

const EDGE = 8;

/** Where a floating panel goes: centred on the anchor, above it when there is room, kept on screen. */
export function floatingPosition(anchor: DOMRect, width: number, height = 56): { left: number; top: number } {
  const centred = anchor.left + anchor.width / 2 - width / 2;
  const left = Math.min(Math.max(centred, EDGE), window.innerWidth - width - EDGE);
  const above = anchor.top - height - EDGE;
  const top = above >= EDGE ? above : anchor.bottom + EDGE;
  return { left, top };
}

/**
 * The text of a highlight as it is shown and exported. Highlights saved before the line breaks of a hyphenated word
 * were joined keep a hyphen and a space there ("for- taleza"); this repairs them without touching the database:
 * a hyphen (or soft hyphen) after a lower-case letter and before a lower-case letter is a hyphenation, and goes;
 * a hyphen between two digits is a range ("19- 20"), and keeps its hyphen. The rule cannot tell "pre- y post-"
 * (it becomes "prey"): that is accepted, it is rare. Mid-word uppercase ("Rosa- María") is left alone.
 */
export function displayHighlightText(text: string): string {
  return text
    .replace(/(?<=\p{Ll})[-\u2010\u00AD] (?=\p{Ll})/gu, "")
    .replace(/(?<=\p{Nd})[-\u2010] (?=\p{Nd})/gu, "-");
}
