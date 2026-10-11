import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { Book, ScanMetadata } from "../api/types";
import { cleanMetadataText, coverScale } from "./metadata";

/** Pixels per cover (roadmap 2.F1: about 400 px wide). Covers are JPEG: WebKitGTK only encodes JPEG and PNG. */
export const COVER_WIDTH_PX = 400;
export const COVER_QUALITY = 0.82;

/** Everything the indexer touches outside its own logic, so it can be tested without Tauri or pdf.js. */
export type IndexerDeps = {
  listPending: () => Promise<Book[]>;
  openPdf: (fileUrl: string) => Promise<PDFDocumentLoadingTask>;
  renderCover: (pdf: PDFDocumentProxy) => Promise<Uint8Array>;
  saveScan: (bookId: string, metadata: ScanMetadata, cover: Uint8Array) => Promise<unknown>;
  markFailed: (bookId: string) => Promise<unknown>;
  waitWhileReading: () => Promise<void>;
  onIndexed?: (bookId: string) => void;
};

export type IndexOutcome = "done" | "failed" | "missing" | "error";

/** The protocol answers 404 when the file is gone (and marks the book missing). */
export function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

/**
 * Indexes one book: page count, title and author from the metadata, and the first page as the cover.
 * A PDF pdf.js cannot read is marked failed, so it is not retried. A missing file is left to the backend,
 * and a save that the backend refuses is logged and left pending.
 */
export async function indexBook(book: Book, deps: IndexerDeps): Promise<IndexOutcome> {
  let task: PDFDocumentLoadingTask | undefined;
  let scan: { metadata: ScanMetadata; cover: Uint8Array };
  try {
    task = await deps.openPdf(book.fileUrl);
    const pdf = await task.promise;
    const { info } = await pdf.getMetadata();
    const fields = info as { Title?: unknown; Author?: unknown };
    scan = {
      metadata: {
        pageCount: pdf.numPages,
        title: cleanMetadataText(fields.Title, "title"),
        author: cleanMetadataText(fields.Author, "author"),
      },
      cover: await deps.renderCover(pdf),
    };
  } catch (error) {
    if (isMissingFile(error)) return "missing";
    // Not the book's fault: stop the run instead of marking every book as failed.
    if (error instanceof CoverFormatError) throw error;
    console.warn(`could not read "${book.fileName}": ${describe(error)}`);
    await deps.markFailed(book.id).catch(() => undefined);
    deps.onIndexed?.(book.id);
    return "failed";
  } finally {
    await task?.destroy().catch(() => undefined);
  }

  try {
    await deps.saveScan(book.id, scan.metadata, scan.cover);
  } catch (error) {
    console.warn(`could not save the scan of "${book.fileName}": ${describe(error)}`);
    return "error";
  }
  deps.onIndexed?.(book.id);
  return "done";
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message);
  return String(error);
}

export type IndexRun = { indexed: number; failed: number; errors: number };

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

/**
 * Indexes the pending books one at a time. Each book is attempted once per run, so a missing or
 * stuck file cannot loop. Waits while a reader is open.
 */
export async function runIndexer(
  deps: IndexerDeps,
  shouldStop: () => boolean = () => false,
): Promise<IndexRun> {
  const attempted = new Set<string>();
  const run: IndexRun = { indexed: 0, failed: 0, errors: 0 };

  while (!shouldStop()) {
    await deps.waitWhileReading();
    const pending = await deps.listPending();
    const next = pending.find((book) => !attempted.has(book.id));
    if (!next) break;

    attempted.add(next.id);
    const outcome = await indexBook(next, deps);
    if (outcome === "done") run.indexed += 1;
    if (outcome === "failed") run.failed += 1;
    if (outcome === "error") run.errors += 1;
    await yieldToUi();
  }
  return run;
}

/** Page 1 as a JPEG cover, `COVER_WIDTH_PX` wide. Throws if the browser does not encode JPEG. */
export async function renderFirstPageJpeg(pdf: PDFDocumentProxy): Promise<Uint8Array> {
  const page = await pdf.getPage(1);
  const natural = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: coverScale(natural.width, COVER_WIDTH_PX) });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context for the cover");
  try {
    await page.render({ canvasContext: context, viewport, canvas }).promise;
  } finally {
    page.cleanup();
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("the cover could not be encoded"))),
      "image/jpeg",
      COVER_QUALITY,
    ),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isJpeg(bytes)) throw new CoverFormatError(blob.type || "unknown");
  return bytes;
}

/** The browser's canvas gave back another format than the one asked for. */
export class CoverFormatError extends Error {
  constructor(mime: string) {
    super(`the canvas encoded "${mime}" instead of JPEG`);
    this.name = "CoverFormatError";
  }
}

/** JPEG starts with the SOI marker FF D8 FF. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
