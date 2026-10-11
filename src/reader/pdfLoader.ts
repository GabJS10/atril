import {
  getDocument,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

/** Bytes per request. pdf.js asks for the tail and the xref first, then only the pages it renders. */
export const RANGE_CHUNK_SIZE = 64 * 1024;

export type RangeRequestEvent = {
  begin: number;
  end: number;
  status: number;
  bytes: number;
  durationMs: number;
};

export type OpenPdfOptions = {
  /** Called after every range request (for tests and diagnostics). */
  onRequest?: (event: RangeRequestEvent) => void;
};

type FetchedRange = {
  /** Bytes from `begin` to `end` (exclusive). */
  bytes: Uint8Array;
  /** Total length of the file, from Content-Range (or the full body when the server ignores Range). */
  total: number;
  status: number;
};

export class PdfRangeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PdfRangeError";
  }
}

/**
 * Fetches `[begin, end)` of a book through the `atril://` protocol. The backend answers 206
 * with the exact span; a 200 means it ignored `Range` and sent the whole file, which we slice.
 */
export async function fetchRange(fileUrl: string, begin: number, end: number): Promise<FetchedRange> {
  const response = await fetch(fileUrl, { headers: { Range: `bytes=${begin}-${end - 1}` } });
  if (!response.ok) {
    throw new PdfRangeError(response.status, `range ${begin}-${end} failed with ${response.status}`);
  }
  const body = new Uint8Array(await response.arrayBuffer());

  if (response.status === 206) {
    const match = /bytes (\d+)-(\d+)\/(\d+)/.exec(response.headers.get("Content-Range") ?? "");
    if (!match) {
      throw new PdfRangeError(206, "206 without a valid Content-Range header");
    }
    return { bytes: body, total: Number(match[3]), status: 206 };
  }

  return { bytes: body.slice(begin, end), total: body.byteLength, status: response.status };
}

/**
 * pdf.js only sends `Range` headers for http(s) URLs (its network stream checks the protocol),
 * so `atril://` URLs would download the whole file. This transport asks for the byte ranges
 * itself, through the same protocol, and hands them to pdf.js.
 */
class AtrilRangeTransport extends PDFDataRangeTransport {
  onError: ((error: unknown) => void) | null = null;

  constructor(
    private readonly fileUrl: string,
    length: number,
    initialData: Uint8Array,
    private readonly options: OpenPdfOptions,
  ) {
    super(length, initialData);
  }

  requestDataRange(begin: number, end: number): void {
    const started = performance.now();
    fetchRange(this.fileUrl, begin, end).then(
      ({ bytes, status }) => {
        this.options.onRequest?.({
          begin,
          end,
          status,
          bytes: bytes.byteLength,
          durationMs: performance.now() - started,
        });
        this.onDataRange(begin, bytes);
      },
      (error: unknown) => this.onError?.(error),
    );
  }
}

/**
 * Opens a book by byte ranges. Returns the loading task: `task.promise` resolves to the document,
 * and `task.destroy()` aborts the loading (also done when a range request fails).
 */
export async function openPdfByRanges(
  fileUrl: string,
  options: OpenPdfOptions = {},
): Promise<PDFDocumentLoadingTask> {
  const head = await fetchRange(fileUrl, 0, RANGE_CHUNK_SIZE);
  const transport = new AtrilRangeTransport(fileUrl, head.total, head.bytes, options);
  const task: PDFDocumentLoadingTask = getDocument({
    range: transport,
    rangeChunkSize: RANGE_CHUNK_SIZE,
    disableAutoFetch: true,
    disableStream: true,
  });
  transport.onError = () => void task.destroy();
  return task;
}
