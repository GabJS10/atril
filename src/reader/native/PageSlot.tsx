import { memo } from "react";
import { HIGHLIGHT_LAYER_CLASS } from "../highlightLayer";
import { PageImage } from "./PageImage";

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
};

/**
 * One page of the stack: a box of its exact size with the paper colour, so scrolling never moves the layout. The
 * image comes on top when it has loaded. The highlight layer is painted by highlightLayer.ts into the empty div.
 */
export const PageSlot = memo(function PageSlot({
  page,
  top,
  left,
  width,
  height,
  imageUrl,
  priority,
}: PageSlotProps) {
  return (
    <div className="page atril-native-page" data-page-number={page} style={{ top, left, width, height }}>
      <PageImage url={imageUrl} priority={priority} />
      <div className={HIGHLIGHT_LAYER_CLASS} />
    </div>
  );
});
