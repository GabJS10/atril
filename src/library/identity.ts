/** Number of typographic cover tones (`[data-tone]` in src/index.css). */
export const COVER_TONES = 14;
/** Number of Sala colours (`[data-room]` in src/index.css). */
export const ROOM_COLORS = 8;

/** FNV-1a hash of a string, as an unsigned 32-bit number. Stable, so an id always maps to the same slot. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The typographic cover tone of a book: deterministic from its id. */
export function coverToneOf(bookId: string): number {
  return hash(bookId) % COVER_TONES;
}

/** The colour slot of a Sala: deterministic from its id (the backend stores no colour). */
export function roomColorOf(collectionId: string): number {
  return hash(`sala:${collectionId}`) % ROOM_COLORS;
}

/** Below this saturation and above this lightness a cover colour is a near-white grey: it tints nothing. */
const GREY_SATURATION = 0.12;
const GREY_LIGHTNESS = 0.85;

/**
 * The cover colour worth tinting a surface with, or null. `Book.coverColor` of a cover with a blank first page is a
 * light grey such as `#f4f4f4`; it would only wash the card out, so it counts as no colour.
 */
export function tintOf(coverColor: string | null): string | null {
  const match = coverColor ? /^#([0-9a-f]{6})$/i.exec(coverColor) : null;
  if (!match?.[1]) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(match[1]!.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return saturation < GREY_SATURATION && lightness > GREY_LIGHTNESS ? null : coverColor;
}
