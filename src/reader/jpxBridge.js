// JPEG 2000 decoder for pdf.js, served as /pdfjs/wasm/openjpeg_nowasm_fallback.js (see vite.config.ts).
//
// pdf.js looks for openjpeg.wasm first. That file is not shipped, so the request fails and pdf.js falls back to
// this file: it imports it and calls its default export (WasmImage in pdf.worker.mjs). JpxImage.decode only uses
// _malloc, writeArrayToMemory, _jp2_decode, imageData, errorMessages and _free.
//
// The decoding happens in the backend. _jp2_decode POSTs the codestream to <base>/jpx and copies the pixels back.
// The contract (parameters, statuses and headers) is docs/IPC.md, section JPX. The request is synchronous because
// pdf.js needs the return code at once; it blocks this worker, not the page.
//
// Second level: when the backend refuses an image (422) or the request fails, the same codestream is decoded with
// the same arguments by pdf.js's own JavaScript decoder, served next to this file as openjpeg_js_fallback.js. It is
// imported statically because _jp2_decode is synchronous and cannot wait for a download. Each reason is logged once.
//
// This file is copied as it is and runs inside pdf.js's worker, so its only import is that fallback file. Its types
// are in jpxBridge.d.ts and its contract is tested in jpxBridge.test.ts.

import OpenJPEG from "./openjpeg_js_fallback.js";

/** Base of the atril:// protocol on Linux, as protocol.rs builds it. */
export const LINUX_BASE = "atril://localhost";
/** Base of the protocol on Windows, where WebView2 serves custom schemes over http. */
export const WINDOWS_BASE = "http://atril.localhost";

/** `_jp2_decode` return code: the backend refused the codestream (HTTP 422) and the fallback could not decode it. */
export const DECODE_FAILED = 1;
/** `_jp2_decode` return code: the request failed or did not answer with pixels, and the fallback could not either. */
export const REQUEST_FAILED = 2;

/** Reasons already logged, so each one is warned about once per worker. */
const warned = new Set();

/**
 * Base of the protocol for the platform this worker runs on. A worker cannot take it from its own location, which
 * is a blob URL or the page's origin, so it is chosen from the user agent: WebView2 on Windows says "Windows".
 *
 * @param {string} userAgent
 * @returns {string}
 */
export function protocolBase(userAgent) {
  return /\bWindows\b/.test(userAgent) ? WINDOWS_BASE : LINUX_BASE;
}

/**
 * Message of a 422 answer: the body is plain text, or JSON with a `message` field.
 *
 * @param {ArrayBuffer | null} body
 * @returns {string}
 */
function messageOf(body) {
  const text = body ? new TextDecoder().decode(body) : "";
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === "string") return parsed.message;
  } catch {
    // Not JSON: the body is the message itself.
  }
  return text || "the backend rejected the codestream";
}

/**
 * The pixels are width × height × channels bytes, as the X-Jpx-* headers say. Without the headers (missing, or not
 * exposed) there is nothing to check against, so the answer is taken as it is.
 *
 * @param {XMLHttpRequest} xhr
 * @param {number} bytes
 * @returns {boolean}
 */
function sizeMatchesHeaders(xhr, bytes) {
  const width = Number(xhr.getResponseHeader("X-Jpx-Width"));
  const height = Number(xhr.getResponseHeader("X-Jpx-Height"));
  const channels = Number(xhr.getResponseHeader("X-Jpx-Channels"));
  if (!(width > 0 && height > 0 && channels > 0)) return true;
  return width * height * channels === bytes;
}

/**
 * Asks the backend for the pixels of one codestream. Never throws: a refusal, a failed request and a bad answer all
 * come back as { ok: false, reason, message }, so the caller can decode the image with the fallback instead.
 *
 * @param {Uint8Array} codestream
 * @param {number} components
 * @param {boolean} indexed
 * @param {boolean} smask
 * @param {number} reduce
 * @returns {{ ok: true, pixels: Uint8ClampedArray } | { ok: false, reason: string, message: string }}
 */
function requestBackend(codestream, components, indexed, smask, reduce) {
  // The contract's defaults are 0; pdf.js does not always give a number (no colour space, no reduction).
  const url =
    `${protocolBase(globalThis.navigator?.userAgent ?? "")}/jpx` +
    `?components=${Number(components) || 0}&indexed=${indexed ? 1 : 0}&smask=${smask ? 1 : 0}` +
    `&reduce=${Number(reduce) || 0}`;
  let xhr;
  try {
    xhr = new globalThis.XMLHttpRequest();
    // Synchronous (the third argument is false) and without request headers: a simple request, no preflight.
    xhr.open("POST", url, false);
    xhr.responseType = "arraybuffer";
    xhr.send(codestream);
  } catch (error) {
    return { ok: false, reason: "request", message: `${url} could not be requested: ${error}` };
  }

  const body = xhr.response;
  if (xhr.status === 200 && body && body.byteLength > 0) {
    if (!sizeMatchesHeaders(xhr, body.byteLength)) {
      const message = `${url} answered ${body.byteLength} bytes, not the size its X-Jpx-* headers give`;
      return { ok: false, reason: "size", message };
    }
    return { ok: true, pixels: new Uint8ClampedArray(body) };
  }
  if (xhr.status === 422) return { ok: false, reason: "422", message: messageOf(body) };
  if (xhr.status === 200) return { ok: false, reason: "empty", message: `${url} answered with no pixels` };
  return { ok: false, reason: `status ${xhr.status}`, message: `${url} answered ${xhr.status}` };
}

/**
 * Logs a reason for the second level once per worker, so a document with many refused images does not flood the
 * console.
 *
 * @param {string} reason
 * @param {string} message
 */
function warnOnce(reason, message) {
  // Numbers differ from image to image (sizes, offsets): they are not part of the reason.
  const key = `${reason}: ${message}`.replace(/\d+/g, "#").slice(0, 200);
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`JPEG 2000 image decoded by pdf.js's own decoder, the backend did not: ${key}`);
}

/**
 * Records a failure the way JpxImage.decode reads it: no pixels, and the message in errorMessages.
 *
 * @param {import("./jpxBridge").JpxModule} decoder
 * @param {number} code
 * @param {string} message
 * @returns {number}
 */
function fail(decoder, code, message) {
  decoder.imageData = null;
  decoder.errorMessages = message;
  return code;
}

/**
 * The module pdf.js expects from its default export. Every call returns a new module with its own buffers, and
 * resolves once pdf.js's JavaScript decoder is ready (pdf.js adopts the promise it gets from the default export).
 *
 * @returns {Promise<import("./jpxBridge").JpxModule>}
 */
export default async function openjpeg() {
  const fallback = await OpenJPEG();

  // Codestreams written by pdf.js, by pointer. Pointers start at 1: pdf.js frees a pointer only when it is not 0.
  /** @type {Map<number, Uint8Array>} */
  const buffers = new Map();
  let nextPointer = 1;

  /**
   * Decodes with pdf.js's own decoder, with the arguments pdf.js gave the bridge.
   *
   * @param {Uint8Array} codestream
   * @param {[number, boolean, boolean, number]} flags components, indexed, smask, reduce
   * @param {string} backendMessage why the backend did not decode it
   * @returns {number}
   */
  function decodeWithFallback(codestream, flags, backendMessage) {
    let pointer;
    try {
      pointer = fallback._malloc(codestream.length);
      fallback.writeArrayToMemory(codestream, pointer);
      const [components, indexed, smask, reduce] = flags;
      const ret = fallback._jp2_decode(pointer, codestream.length, components, indexed, smask, reduce);
      if (ret === 0 && fallback.imageData) {
        decoder.imageData = fallback.imageData;
        delete decoder.errorMessages;
        return 0;
      }
      const reason = fallback.errorMessages ?? "no pixels";
      return fail(decoder, ret || DECODE_FAILED, `${backendMessage}; pdf.js's decoder: ${reason}`);
    } catch (error) {
      return fail(decoder, REQUEST_FAILED, `${backendMessage}; pdf.js's decoder threw: ${error}`);
    } finally {
      if (pointer) fallback._free(pointer);
      fallback.imageData = null;
      delete fallback.errorMessages;
    }
  }

  /** @type {import("./jpxBridge").JpxModule} */
  const decoder = {
    imageData: null,

    _malloc(size) {
      const pointer = nextPointer;
      nextPointer += 1;
      buffers.set(pointer, new Uint8Array(size));
      return pointer;
    },

    _free(pointer) {
      buffers.delete(pointer);
    },

    writeArrayToMemory(array, pointer) {
      buffers.get(pointer)?.set(array);
    },

    _jp2_decode(pointer, size, components, indexed, smask, reduce) {
      const codestream = buffers.get(pointer)?.subarray(0, size);
      if (!codestream) return fail(decoder, REQUEST_FAILED, "no codestream was written for this pointer");

      const backend = requestBackend(codestream, components, indexed, smask, reduce);
      if (backend.ok) {
        decoder.imageData = backend.pixels;
        delete decoder.errorMessages;
        return 0;
      }
      warnOnce(backend.reason, backend.message);
      const flags = [Number(components) || 0, !!indexed, !!smask, Number(reduce) || 0];
      return decodeWithFallback(codestream, flags, backend.message);
    },
  };
  return decoder;
}
