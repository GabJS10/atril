import type { PDFDocumentProxy } from "pdfjs-dist";
import "./pdfjsGlobal";
import { EventBus, PDFLinkService, PDFViewer as PdfJsViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Zoom } from "../api/types";
import "./PdfViewer.css";
import { positionAtScroll, type PageGeometry, type ReaderPosition, scrollForPosition } from "./position";
import { nextScale, zoomFromViewer, zoomToScaleValue } from "./zoom";

/** Pixels moved by j/k. */
const LINE_SCROLL_PX = 80;

export type ViewSnapshot = { position: ReaderPosition; zoom: Zoom; scale: number };

export type PdfViewerProps = {
  pdf: PDFDocumentProxy;
  /** Zoom and position to start from. Applied once, before the view is shown. */
  start: { zoom: Zoom; position: ReaderPosition | null };
  /** The view moved (scroll or zoom). Only after the start position is on screen. */
  onChange: (snapshot: ViewSnapshot) => void;
  /** The start position is on screen. Called once. */
  onRestored: (snapshot: ViewSnapshot) => void;
};

/** Commands the reader's keyboard map sends to the viewer. */
export type PdfViewerHandle = {
  goToPage: (page: number) => void;
  /** One page forward or back, from the page pdf.js is on (not from React state, which can lag behind key repeats). */
  turnPage: (direction: 1 | -1) => void;
  scrollLines: (direction: 1 | -1) => void;
  scrollPages: (direction: 1 | -1) => void;
  stepZoom: (direction: 1 | -1) => void;
};

/** Page tops and heights in the scroll content, read from the pdf.js page elements. */
function pageGeometry(container: HTMLElement, instance: PdfJsViewer): PageGeometry {
  const box = container.getBoundingClientRect();
  const rectOf = (index: number): DOMRect => {
    const element = instance.getPageView(index)?.div as HTMLElement | undefined;
    return element?.getBoundingClientRect() ?? new DOMRect();
  };
  return {
    count: instance.pagesCount,
    topOf: (index) => rectOf(index).top - box.top + container.scrollTop,
    heightOf: (index) => rectOf(index).height,
  };
}

/**
 * Continuous-scroll pdf.js viewer (roadmap 1.F2 and 1.F3). pdf.js does the layout and rendering.
 * This component restores the saved position before the view is shown, and reports every move after that.
 */
export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  { pdf, start, onChange, onRestored },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewer = useRef<PdfJsViewer | null>(null);
  const [revealed, setRevealed] = useState(false);

  // Latest props, read by pdf.js and DOM listeners that outlive the render.
  const latest = useRef({ start, onChange, onRestored });
  useEffect(() => {
    latest.current = { start, onChange, onRestored };
  }, [start, onChange, onRestored]);

  useEffect(() => {
    const container = containerRef.current;
    const viewerElement = viewerRef.current;
    if (!container || !viewerElement) return;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const instance = new PdfJsViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      removePageBorders: true,
    });
    linkService.setViewer(instance);
    viewer.current = instance;

    let restored = false;
    let cancelled = false;

    const snapshot = (): ViewSnapshot => ({
      position: positionAtScroll(pageGeometry(container, instance), container.scrollTop),
      zoom: zoomFromViewer(instance.currentScaleValue, instance.currentScale),
      scale: instance.currentScale,
    });

    const emit = () => {
      if (restored) latest.current.onChange(snapshot());
    };

    eventBus.on("pagesinit", () => {
      const begin = latest.current.start;
      instance.currentScaleValue = zoomToScaleValue(begin.zoom);
      if (begin.position) {
        container.scrollTop = scrollForPosition(pageGeometry(container, instance), begin.position);
      }
      // Two frames: the scroll events caused by the restore must not count as the user moving.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled) return;
          restored = true;
          setRevealed(true);
          latest.current.onRestored(snapshot());
        });
      });
    });
    eventBus.on("scalechanging", emit);
    container.addEventListener("scroll", emit);

    instance.setDocument(pdf);
    linkService.setDocument(pdf, null);

    return () => {
      cancelled = true;
      container.removeEventListener("scroll", emit);
      instance.setDocument(null);
      linkService.setDocument(null, null);
      viewer.current = null;
    };
  }, [pdf]);

  useImperativeHandle(
    ref,
    () => ({
      goToPage(page) {
        if (viewer.current) viewer.current.currentPageNumber = page;
      },
      turnPage(direction) {
        const instance = viewer.current;
        if (!instance) return;
        const target = instance.currentPageNumber + direction;
        instance.currentPageNumber = Math.min(Math.max(target, 1), instance.pagesCount);
      },
      scrollLines(direction) {
        containerRef.current?.scrollBy({ top: direction * LINE_SCROLL_PX });
      },
      scrollPages(direction) {
        const container = containerRef.current;
        if (container) container.scrollBy({ top: direction * container.clientHeight * 0.9 });
      },
      stepZoom(direction) {
        const instance = viewer.current;
        if (instance) instance.currentScale = nextScale(instance.currentScale, direction);
      },
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className={`atril-viewer absolute inset-0 overflow-auto transition-opacity duration-base ease-atril ${
        revealed ? "opacity-100" : "opacity-0"
      }`}
    >
      <div ref={viewerRef} className="pdfViewer" />
    </div>
  );
});
