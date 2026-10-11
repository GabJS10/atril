/** Longest title or author kept from PDF metadata. */
export const MAX_METADATA_LENGTH = 200;

/** Titles that say nothing: word-processor exports, file names, placeholders, digits only. */
const JUNK_TITLE: RegExp[] = [
  /^microsoft (word|excel|powerpoint|office)\b/i,
  /\.(docx?|pdf|indd|tex|pages|rtf|odt|pptx?|xlsx?|dvi|ps|txt)\s*$/i,
  /^(untitled|sin t[ií]tulo)(\s*\d*)?$/i,
  /^(null|undefined|none|n\/a)$/i,
  /^[\d\W_]+$/,
];

const JUNK_AUTHOR: RegExp[] = [
  /^(anonymous|anonimo|an[oó]nimo|unknown|desconocido|author|autor|null|undefined|none|n\/a)$/i,
  /^[\d\W_]+$/,
];

/**
 * Keeps a title or author from PDF metadata when it is worth showing; undefined otherwise, so the
 * backend keeps the file name. Collapses whitespace, drops junk and caps the length.
 */
export function cleanMetadataText(value: unknown, kind: "title" | "author"): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 2) return undefined;
  const junk = kind === "title" ? JUNK_TITLE : JUNK_AUTHOR;
  if (junk.some((pattern) => pattern.test(text))) return undefined;
  return text.slice(0, MAX_METADATA_LENGTH);
}

/** Scale that renders a page `widthPt` points wide at `targetPx` pixels. */
export function coverScale(pageWidth: number, targetPx = 400): number {
  return pageWidth > 0 ? targetPx / pageWidth : 1;
}
