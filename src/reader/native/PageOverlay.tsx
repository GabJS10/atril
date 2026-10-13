import type { PageDataSource } from "./pageData";
import { usePageData } from "./pageData";
import { LinkLayer } from "./LinkLayer";
import { TextLayer } from "./TextLayer";

export type PageOverlayProps = {
  source: PageDataSource;
  /** 1-based. */
  page: number;
  /** The page's size at scale 1, in points. */
  width: number;
  height: number;
  /** CSS pixels per point: the overlay is drawn in points and scaled to the page box with it. */
  scale: number;
};

/**
 * The text and the links of one page. Mounted only for the pages in view and one on each side, so the engine is asked
 * for a page's text when the page comes near, and the DOM never holds more than a few pages of words.
 */
export function PageOverlay({ source, page, width, height, scale }: PageOverlayProps) {
  const { words, links } = usePageData(source, page);
  return (
    <div className="atril-page-overlay" style={{ width, height, transform: `scale(${scale})` }}>
      {links && links.length > 0 ? <LinkLayer links={links} /> : null}
      {words && words.length > 0 ? <TextLayer words={words} /> : null}
    </div>
  );
}
