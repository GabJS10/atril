import type { PageGeometry } from "../../api/types";
import type { PageMapping } from "../geometry";

/** CSS pixels per PDF point at pdf.js scale 1 (96 dpi over 72 dpi). The reader's "100 %" is this. */
export const CSS_UNITS = 96 / 72;

/** A page at one scale: its size in CSS pixels and the conversions between PDF user space and the page box. */
export type NativePageMapping = PageMapping & { width: number; height: number };

/**
 * The mapping of a native-engine page at `scale` (CSS pixels per PDF point). `page.transform` is the pdf.js viewport
 * matrix at scale 1, so the viewport at `scale` is that matrix with all six entries multiplied by `scale`; the
 * conversions are the ones of pdf.js's `PageViewport`.
 */
export function pageMapping(page: PageGeometry, scale: number): NativePageMapping {
  const [a, b, c, d, e, f] = page.transform.map((value) => value * scale) as PageGeometry["transform"];
  const determinant = a * d - b * c;
  return {
    width: page.width * scale,
    height: page.height * scale,
    convertToViewportPoint: (x, y) => [a * x + c * y + e, b * x + d * y + f],
    convertToPdfPoint: (x, y) => [
      (x * d - y * c + c * f - e * d) / determinant,
      (-x * b + y * a + e * b - f * a) / determinant,
    ],
  };
}
