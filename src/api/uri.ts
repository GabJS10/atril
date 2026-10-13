/** Schemes the reader opens outside the app. */
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** True for an http, https or mailto address; false for any other scheme and for text that is not an address. */
export function isOpenableUri(uri: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(uri).protocol);
  } catch {
    return false;
  }
}
