import { memo } from "react";
import { HIGHLIGHT_LAYER_CLASS } from "../highlightLayer";
import { PageImage } from "./PageImage";
import type { PageDataSource } from "./pageData";
import { PageOverlay } from "./PageOverlay";
import { SEARCH_LAYER_CLASS } from "./searchPaint";

export type PageSlotProps = {
  /** 1-based. */
  page: number;
  top: number;
  left: number;
  width: number;
  height: number;
  /** The image to load, or null when the page is only a placeholder. */
  imageUrl: string | null;
  priority: "high" | "low";
  /** Where the page's text and links come from, or null when they are not wanted (the page is far from the view). */
  data: PageDataSource | null;
  /** The page's size at scale 1, in points, and the CSS pixels per point: the text layer is drawn in points. */
  pointsWidth: number;
  pointsHeight: number;
  scale: number;
};

/**
 * One page of the stack: a box of its exact size with the paper colour, so scrolling never moves the layout. The
 * image comes on top when it has loaded. The highlight and search layers are painted by highlightLayer.ts and
 * searchPaint.ts into the empty divs; the text and links go in last, on top, so the text can be selected.
 */
export const PageSlot = memo(function PageSlot({
  page,
  top,
  left,
  width,
  height,
  imageUrl,
  priority,
  data,
  pointsWidth,
  pointsHeight,
  scale,
}: PageSlotProps) {
  return (
    <div className="page atril-native-page" data-page-number={page} style={{ top, left, width, height }}>
      <PageImage url={imageUrl} priority={priority} />
      <div className={HIGHLIGHT_LAYER_CLASS} />
      <div className={SEARCH_LAYER_CLASS} />
      {data ? (
        <PageOverlay source={data} page={page} width={pointsWidth} height={pointsHeight} scale={scale} />
      ) : null}
    </div>
  );
});
