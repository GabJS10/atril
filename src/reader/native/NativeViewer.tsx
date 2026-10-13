import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { OpenedDocument, Zoom } from "../../api/types";
import { highlightAt, type PageAtScale1, paintHighlightLayer } from "../highlightLayer";
import { scrollTopToReveal } from "../highlightList";
import { pdfRectToPercent } from "../geometry";
import { positionAtScroll } from "../position";
import type { ViewerHandle, ViewerProps, ViewSnapshot } from "../viewerTypes";
import { nextScale } from "../zoom";
import "../highlightLayer.css";
import "./NativeViewer.css";
import { captureAnchor, scrollForAnchor, type ViewAnchor } from "./anchor";
import {
  createLayoutBase,
  type PageLayout,
  type PageRange,
  rangesTouch,
  sameRange,
  widenRange,
} from "./layout";
import { CSS_UNITS, pageMapping } from "./mapping";
import { PageSlot } from "./PageSlot";
import {
  clampScale,
  imageScaleFor,
  isPreset,
  pageImageUrl,
  scaleForZoom,
  wheelZoomFactor,
  zoomFor,
} from "./scale";
import { useSettledValue } from "./useSettledValue";

/** Pages kept in the DOM (as placeholders) on each side of the ones in view. */
const SLOT_OVERSCAN = 1;
/** Pages beyond the ones in view whose image is loaded; none when a page is so sharp it weighs tens of megabytes. */
const IMAGE_OVERSCAN = 1;
const HEAVY_PAGE_PIXELS = 8_000_000;
/** A move of the view of at most this many pages past the last one is a scroll; more is a jump. */
const JUMP_SLACK = 3;
/** After a jump, the images are requested once the view has stayed put this long (not for every page it flew over). */
const JUMP_SETTLE_MS = 80;
/** The sharp image of a new zoom is requested once the zoom has stayed put this long. */
const ZOOM_SETTLE_MS = 150;
/** Pixels moved by j/k. */
const LINE_SCROLL_PX = 80;
const FALLBACK_PAGE = { width: 612, height: 792 };

export type NativeViewerProps = ViewerProps & { document: OpenedDocument };

type Size = { width: number; height: number };

function contentWidthOf(layout: PageLayout, viewportWidth: number): number {
  return Math.max(viewportWidth, Math.ceil(layout.maxWidth));
}

/**
 * The reader's viewer on the native engine (roadmap R2.1): the pages are JPEG images the backend renders, laid out by
 * this component. The whole height of the book is known from the first instant (from `open_document`), only the
 * pages in view (plus one on each side) are in the DOM, and the zoom has two steps: the pages change size at once,
 * and the sharp image of the new scale replaces the old one when it has loaded.
 *
 * Text selection, search, index and links come with R2.2; until then `find` and `goToDestination` do nothing.
 */
export const NativeViewer = forwardRef<ViewerHandle, NativeViewerProps>(function NativeViewer(
  { document: doc, start, onChange, onRestored, highlights, onSelectionClear, onHighlightPress },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const base = useMemo(() => createLayoutBase(doc.pages), [doc]);
  const [size, setSize] = useState<Size | null>(null);
  /** The zoom in pdf.js units (1 = 100 %). Null until the container has been measured. */
  const [scale, setScale] = useState<number | null>(null);
  const scaleRef = useRef<number | null>(null);
  const zoomRef = useRef<Zoom>(start.zoom);
  const layout = useMemo(() => (scale === null ? null : base.at(scale * CSS_UNITS)), [base, scale]);
  const layoutRef = useRef<PageLayout | null>(null);
  const pendingAnchor = useRef<ViewAnchor | null>(null);
  const [view, setView] = useState<PageRange>({ first: 0, last: -1 });
  /** The pages in view as far as images go: it follows `view` at once on a scroll, and after a pause on a jump. */
  const [imageView, setImageView] = useState<PageRange>({ first: 0, last: -1 });
  const imageViewRef = useRef<PageRange>({ first: 0, last: -1 });
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const restored = useRef(false);
  const restoreScheduled = useRef(false);
  const [revealed, setRevealed] = useState(false);

  // Latest props, read by listeners and timers that outlive the render.
  const latest = useRef({ start, onChange, onRestored, highlights, onSelectionClear, onHighlightPress, doc });
  useEffect(() => {
    latest.current = { start, onChange, onRestored, highlights, onSelectionClear, onHighlightPress, doc };
  }, [start, onChange, onRestored, highlights, onSelectionClear, onHighlightPress, doc]);

  const snapshot = useCallback((): ViewSnapshot | null => {
    const container = containerRef.current;
    const current = layoutRef.current;
    const currentScale = scaleRef.current;
    if (!container || !current || currentScale === null) return null;
    return {
      position: positionAtScroll(current, container.scrollTop),
      zoom: zoomFor(zoomRef.current, currentScale),
      scale: currentScale,
    };
  }, []);

  const emit = useCallback(() => {
    if (!restored.current) return;
    const current = snapshot();
    if (current) latest.current.onChange(current);
  }, [snapshot]);

  const commitImageView = useCallback((range: PageRange) => {
    window.clearTimeout(jumpTimer.current);
    jumpTimer.current = undefined;
    imageViewRef.current = range;
    setImageView((previous) => (sameRange(previous, range) ? previous : range));
  }, []);

  /**
   * Finds the pages in view. The placeholders follow at once; the images follow at once too while the view scrolls,
   * but after a pause when it jumps (scroll bar), so a drag does not ask for every page it passes over. `force` is for
   * jumps the reader itself makes (go to page): the destination is requested first.
   */
  const updateView = useCallback(
    (force = false) => {
      const container = containerRef.current;
      const current = layoutRef.current;
      if (!container || !current) return;
      const visible = current.visibleRange(container.scrollTop, container.clientHeight);
      setView((previous) => (sameRange(previous, visible) ? previous : visible));
      if (force || rangesTouch(imageViewRef.current, visible, JUMP_SLACK)) {
        commitImageView(visible);
      } else {
        window.clearTimeout(jumpTimer.current);
        jumpTimer.current = setTimeout(() => commitImageView(visible), JUMP_SETTLE_MS);
      }
    },
    [commitImageView],
  );

  /** Gives the book a new zoom scale. `anchor` is what must stay put on screen. */
  const applyScale = useCallback((next: number, anchor: ViewAnchor | null) => {
    // The first pending anchor was taken against what is on screen; later ones in the same frame are not.
    pendingAnchor.current ??= anchor;
    scaleRef.current = next;
    setScale(next);
  }, []);

  const zoomTo = useCallback(
    (next: number, point?: { x: number; y: number }) => {
      const container = containerRef.current;
      const current = layoutRef.current;
      if (!container || !current) return;
      const target = clampScale(next);
      if (
        scaleRef.current !== null &&
        Math.abs(target - scaleRef.current) < 1e-6 &&
        !isPreset(zoomRef.current)
      ) {
        return;
      }
      zoomRef.current = target;
      const at = point ?? { x: container.clientWidth / 2, y: container.clientHeight / 2 };
      const anchor = captureAnchor(
        current,
        contentWidthOf(current, container.clientWidth),
        { left: container.scrollLeft, top: container.scrollTop },
        at,
      );
      applyScale(target, anchor);
    },
    [applyScale],
  );

  // Measure the container, and follow its size.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () =>
      setSize((previous) => {
        const next = { width: container.clientWidth, height: container.clientHeight };
        return previous && previous.width === next.width && previous.height === next.height ? previous : next;
      });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // The first scale (from the saved zoom) once the size is known; after that, presets follow the window.
  useLayoutEffect(() => {
    if (!size || size.width === 0) return;
    const { start: begin, doc: book } = latest.current;
    if (scaleRef.current === null) {
      const position = begin.position ?? { page: 1, offsetInPage: 0 };
      const page = book.pages[position.page - 1] ?? book.pages[0] ?? FALLBACK_PAGE;
      zoomRef.current = begin.zoom;
      applyScale(scaleForZoom(begin.zoom, page, size), { kind: "position", position });
      return;
    }
    const current = layoutRef.current;
    const container = containerRef.current;
    if (!isPreset(zoomRef.current) || !current || !container) return;
    const reading = positionAtScroll(current, container.scrollTop);
    const page = book.pages[reading.page - 1] ?? book.pages[0] ?? FALLBACK_PAGE;
    const next = scaleForZoom(zoomRef.current, page, size);
    if (Math.abs(next - (scaleRef.current ?? next)) > 1e-4) {
      applyScale(next, { kind: "position", position: reading });
    }
  }, [size, applyScale]);

  // A new layout: put the anchored place back where it was, before the browser paints.
  useLayoutEffect(() => {
    layoutRef.current = layout;
    const container = containerRef.current;
    if (!layout || !container) return;
    const anchor = pendingAnchor.current;
    if (anchor) {
      pendingAnchor.current = null;
      const target = scrollForAnchor(
        layout,
        contentWidthOf(layout, container.clientWidth),
        { width: container.clientWidth },
        anchor,
      );
      container.scrollTop = target.top;
      container.scrollLeft = target.left;
    }
    updateView(!restoreScheduled.current);
    if (!restoreScheduled.current) {
      restoreScheduled.current = true;
      // Two frames: the scroll events caused by the restore must not count as the user moving.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!containerRef.current) return;
          restored.current = true;
          setRevealed(true);
          const current = snapshot();
          if (current) latest.current.onRestored(current);
        });
      });
    } else if (anchor) {
      emit();
    }
  }, [layout, updateView, snapshot, emit]);

  // The scroll: one update per frame at most. Zoom with Ctrl + wheel, around the pointer.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateView();
        emit();
      });
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const current = scaleRef.current;
      if (current === null) return;
      const box = container.getBoundingClientRect();
      zoomTo(current * wheelZoomFactor(event.deltaY, event.deltaMode), {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
    };
    // A click on a highlight opens its editor; a click elsewhere clears the selection toolbar.
    const onMouseUp = (event: MouseEvent) => {
      const element = highlightAt(container, event.clientX, event.clientY);
      if (element?.dataset.highlightId) {
        latest.current.onHighlightPress(element.dataset.highlightId, element.getBoundingClientRect());
      } else {
        latest.current.onSelectionClear();
      }
    };
    container.addEventListener("scroll", onScroll);
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("mouseup", onMouseUp);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("mouseup", onMouseUp);
    };
  }, [updateView, emit, zoomTo]);

  useEffect(() => () => window.clearTimeout(jumpTimer.current), []);

  // The view grew or shrank (window resize): the pages in view change.
  useEffect(() => {
    if (size) updateView();
  }, [size, updateView]);

  // Highlights are percentages of the page box, so a zoom needs no repaint; a new page or new highlights do.
  const mappings = useRef(new Map<number, PageAtScale1>());
  const pageAtScale1 = useCallback(
    (page: number): PageAtScale1 | undefined => {
      const geometry = doc.pages[page - 1];
      if (!geometry) return undefined;
      let mapping = mappings.current.get(page);
      if (!mapping) {
        mapping = pageMapping(geometry, 1);
        mappings.current.set(page, mapping);
      }
      return mapping;
    },
    [doc],
  );
  const slots = widenRange(view, SLOT_OVERSCAN, base.count);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container) paintHighlightLayer(container, pageAtScale1, highlights);
  }, [slots.first, slots.last, highlights, pageAtScale1]);

  useImperativeHandle(
    ref,
    () => ({
      goToPage(page) {
        const container = containerRef.current;
        const current = layoutRef.current;
        if (!container || !current || current.count === 0) return;
        const index = Math.min(Math.max(page, 1), current.count) - 1;
        // Rounded up: a browser keeps scrollTop whole, and a top rounded down would still read as the page before.
        container.scrollTop = Math.ceil(current.topOf(index));
        updateView(true);
        emit();
      },
      find() {
        // Search comes with R2.2.
      },
      goToDestination() {
        // The index comes with R2.2.
      },
      revealHighlight(highlight) {
        const container = containerRef.current;
        const current = layoutRef.current;
        const geometry = doc.pages[highlight.page - 1];
        if (!container || !current || !geometry || highlight.rects.length === 0) return;
        const mapping = pageMapping(geometry, 1);
        const percentTop = Math.min(...highlight.rects.map((rect) => pdfRectToPercent(rect, mapping).top));
        const index = highlight.page - 1;
        container.scrollTop = scrollTopToReveal(
          current.topOf(index),
          current.heightOf(index),
          percentTop,
          container.clientHeight,
        );
        updateView(true);
        emit();
      },
      turnPage(direction) {
        const container = containerRef.current;
        const current = layoutRef.current;
        if (!container || !current || current.count === 0) return;
        const reading = positionAtScroll(current, container.scrollTop).page;
        const target = Math.min(Math.max(reading + direction, 1), current.count);
        container.scrollTop = Math.ceil(current.topOf(target - 1));
        updateView(true);
        emit();
      },
      scrollLines(direction) {
        containerRef.current?.scrollBy({ top: direction * LINE_SCROLL_PX });
      },
      scrollPages(direction) {
        const container = containerRef.current;
        if (container) container.scrollBy({ top: direction * container.clientHeight * 0.9 });
      },
      stepZoom(direction) {
        if (scaleRef.current !== null) zoomTo(nextScale(scaleRef.current, direction));
      },
    }),
    [doc, updateView, emit, zoomTo],
  );

  // The sharp image of a zoom is asked for once the zoom has stopped changing. Until then the old image is stretched.
  const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const wantedImageScale = scale === null ? null : imageScaleFor(scale, devicePixelRatio);
  const imageScale = useSettledValue(wantedImageScale, ZOOM_SETTLE_MS);

  const content = layout && size ? contentWidthOf(layout, size.width) : 0;
  const pages: React.ReactNode[] = [];
  if (layout && size && imageScale !== null) {
    const heavy =
      view.first <= view.last &&
      layout.widthOf(view.first) * layout.heightOf(view.first) * (imageScale / layout.scale) ** 2 >
        HEAVY_PAGE_PIXELS;
    const imageRange = widenRange(imageView, heavy ? 0 : IMAGE_OVERSCAN, base.count);
    for (let index = slots.first; index <= slots.last; index += 1) {
      const width = Math.round(layout.widthOf(index));
      const wantsImage = index >= imageRange.first && index <= imageRange.last;
      const inView = index >= imageView.first && index <= imageView.last;
      pages.push(
        <PageSlot
          key={index}
          page={index + 1}
          top={Math.round(layout.topOf(index))}
          left={Math.round((content - width) / 2)}
          width={width}
          height={Math.round(layout.heightOf(index))}
          imageUrl={wantsImage ? pageImageUrl(doc.pageBaseUrl, index + 1, imageScale) : null}
          priority={inView ? "high" : "low"}
        />,
      );
    }
  }

  return (
    <div
      ref={containerRef}
      className={`atril-native-viewer absolute inset-0 overflow-auto transition-opacity duration-base ease-atril ${
        revealed ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className="atril-native-sizer"
        style={{ width: content, height: layout ? Math.ceil(layout.totalHeight) : 0 }}
      >
        {pages}
      </div>
    </div>
  );
});
