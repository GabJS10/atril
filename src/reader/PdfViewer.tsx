import type { PDFDocumentProxy } from "pdfjs-dist";
import "./pdfjsGlobal";
import { EventBus, PDFLinkService, PDFViewer as PdfJsViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Zoom } from "../api/types";
import "./PdfViewer.css";
import { nextScale, zoomFromViewer, zoomToScaleValue } from "./zoom";

/** Pixels moved by j/k. */
const LINE_SCROLL_PX = 80;

export type ViewerZoom = { zoom: Zoom; scale: number };

export type PdfViewerProps = {
  pdf: PDFDocumentProxy;
  /** Zoom to apply; changes from the parent are sent to pdf.js. */
  zoom: Zoom;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: ViewerZoom) => void;
};

/** Commands the reader's keyboard map sends to the viewer. */
export type PdfViewerHandle = {
  goToPage: (page: number) => void;
  scrollLines: (direction: 1 | -1) => void;
  scrollPages: (direction: 1 | -1) => void;
  stepZoom: (direction: 1 | -1) => void;
};

/**
 * Continuous-scroll pdf.js viewer (roadmap 1.F2). The pdf.js viewer does the layout and the
 * rendering; this component wires it to React and exposes the reader commands.
 */
export const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  { pdf, zoom, onPageChange, onZoomChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewer = useRef<PdfJsViewer | null>(null);

  // Latest callbacks and zoom, read by pdf.js event handlers that outlive the render.
  const latest = useRef({ onPageChange, onZoomChange, zoom });
  useEffect(() => {
    latest.current = { onPageChange, onZoomChange, zoom };
  }, [onPageChange, onZoomChange, zoom]);

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

    eventBus.on("pagesinit", () => {
      instance.currentScaleValue = zoomToScaleValue(latest.current.zoom);
    });
    eventBus.on("pagechanging", (event: { pageNumber: number }) => {
      latest.current.onPageChange(event.pageNumber);
    });
    eventBus.on("scalechanging", () => {
      latest.current.onZoomChange({
        zoom: zoomFromViewer(instance.currentScaleValue, instance.currentScale),
        scale: instance.currentScale,
      });
    });

    instance.setDocument(pdf);
    linkService.setDocument(pdf, null);

    return () => {
      instance.setDocument(null);
      linkService.setDocument(null, null);
      viewer.current = null;
    };
  }, [pdf]);

  useEffect(() => {
    const instance = viewer.current;
    if (!instance || !instance.pdfDocument) return;
    const target = zoomToScaleValue(zoom);
    if (instance.currentScaleValue !== target) instance.currentScaleValue = target;
  }, [zoom]);

  useImperativeHandle(
    ref,
    () => ({
      goToPage(page) {
        if (viewer.current) viewer.current.currentPageNumber = page;
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
    <div ref={containerRef} className="atril-viewer absolute inset-0 overflow-auto">
      <div ref={viewerRef} className="pdfViewer" />
    </div>
  );
});
