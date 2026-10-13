import { memo } from "react";
import type { PageLink } from "../../api/types";
import { LINK_CLASS, linkAttributes } from "./links";

/**
 * The links of one page, as boxes in the page's own units (inside the scaled overlay). They take no pointer events:
 * the text under them stays selectable, and the viewer resolves a click by position (see `linkAt`).
 */
export const LinkLayer = memo(function LinkLayer({ links }: { links: PageLink[] }) {
  return (
    <div className="atril-link-layer">
      {links.map((link, index) => {
        const [x0, y0, x1, y1] = link.rect;
        return (
          <div
            key={index}
            className={LINK_CLASS}
            style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }}
            {...linkAttributes(link)}
          />
        );
      })}
    </div>
  );
});
