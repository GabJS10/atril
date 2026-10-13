/**
 * Recovery for a page image the `<img>` could not load. An `<img>` only says "error"; the protocol says why with the
 * status (docs/IPC.md, "Errores del protocolo en el visor"). This asks again with `fetch`, which does see the status:
 *   200  the image (it becomes a blob the page shows)
 *   410  the engine dropped the request (the user moved on or zoomed): ask again while the page is still wanted
 *   500  a render failed: once more
 *   404, 422, 400 and anything else: no retry
 */

export type PageFetchOptions = {
  /** False once the page is no longer on screen or its scale is no longer the one wanted: stop asking. */
  isWanted: () => boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Pauses before each new attempt after a 410 (the number of entries is the retry limit). */
  goneDelaysMs?: readonly number[];
  /** Pauses before each new attempt after a 500 or a network error. */
  failureDelaysMs?: readonly number[];
};

export const GONE_DELAYS_MS: readonly number[] = [60, 120, 250, 500, 1000, 2000];
export const FAILURE_DELAYS_MS: readonly number[] = [400];

export type PageFetchFailure = "cancelled" | "gone" | "failed";

/** Why a page image could not be had. `cancelled` is not an error: the page is no longer wanted. */
export class PageFetchError extends Error {
  readonly reason: PageFetchFailure;
  readonly status: number | null;

  constructor(reason: PageFetchFailure, status: number | null) {
    super(`page image not loaded (${reason}${status === null ? "" : `, ${status}`})`);
    this.name = "PageFetchError";
    this.reason = reason;
    this.status = status;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Gets the image at `url`, retrying the cases above. Resolves to the JPEG; rejects with a PageFetchError. */
export async function fetchPageImage(url: string, options: PageFetchOptions): Promise<Blob> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const goneDelays = options.goneDelaysMs ?? GONE_DELAYS_MS;
  const failureDelays = options.failureDelaysMs ?? FAILURE_DELAYS_MS;
  let gone = 0;
  let failures = 0;

  for (;;) {
    if (!options.isWanted()) throw new PageFetchError("cancelled", null);
    let status: number | null = null;
    try {
      const response = await fetchImpl(url);
      status = response.status;
      if (response.ok) {
        const blob = await response.blob();
        if (!options.isWanted()) throw new PageFetchError("cancelled", null);
        return blob;
      }
    } catch (error) {
      if (error instanceof PageFetchError) throw error;
      // A network error: treated like a failed render.
    }

    if (status === 410) {
      const delay = goneDelays[gone];
      if (delay === undefined) throw new PageFetchError("gone", status);
      gone += 1;
      await sleep(delay);
    } else if (status === null || status === 500) {
      const delay = failureDelays[failures];
      if (delay === undefined) throw new PageFetchError("failed", status);
      failures += 1;
      await sleep(delay);
    } else {
      throw new PageFetchError("failed", status);
    }
  }
}
