import { afterEach, describe, expect, it, vi } from "vitest";
import bridgeSource from "./jpxBridge.js?raw";
import openjpeg, { DECODE_FAILED, LINUX_BASE, REQUEST_FAILED, WINDOWS_BASE, protocolBase } from "./jpxBridge";

const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0";

type Answer = { status: number; body?: Uint8Array | string; headers?: Record<string, string>; fail?: Error };
type Sent = {
  method: string;
  url: string;
  async: boolean;
  headers: string[];
  body: Uint8Array | null;
  responseType: string;
};

/** Replaces XMLHttpRequest with one that gives `answer` and records every request it is asked to send. */
function stubXhr(answer: Answer): Sent[] {
  const sent: Sent[] = [];
  class FakeXhr {
    status = 0;
    response: ArrayBuffer | null = null;
    responseType = "";
    private method = "";
    private url = "";
    private async = true;
    private readonly headers: string[] = [];

    open(method: string, url: string, async = true) {
      this.method = method;
      this.url = url;
      this.async = async;
    }

    setRequestHeader(name: string) {
      this.headers.push(name);
    }

    getResponseHeader(name: string) {
      return answer.headers?.[name] ?? null;
    }

    send(body?: ArrayBufferView | null) {
      if (answer.fail) throw answer.fail;
      const copy = body ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice() : null;
      sent.push({
        method: this.method,
        url: this.url,
        async: this.async,
        headers: [...this.headers],
        body: copy,
        responseType: this.responseType,
      });
      this.status = answer.status;
      if (answer.body !== undefined) {
        const bytes = typeof answer.body === "string" ? new TextEncoder().encode(answer.body) : answer.body;
        this.response = bytes.slice().buffer;
      }
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return sent;
}

/** Writes `codestream` the way pdf.js does, decodes it and frees the buffer again. */
function decode(
  codestream: Uint8Array,
  flags = { components: 3, indexed: false, smask: false, reduce: 0 },
  module = openjpeg(),
) {
  const pointer = module._malloc(codestream.length);
  module.writeArrayToMemory(codestream, pointer);
  const ret = module._jp2_decode(
    pointer,
    codestream.length,
    flags.components,
    flags.indexed,
    flags.smask,
    flags.reduce,
  );
  module._free(pointer);
  return { module, ret };
}

const CODESTREAM = Uint8Array.of(0xff, 0x4f, 0xff, 0x51, 0, 1, 2);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("jpxBridge: the module pdf.js reads", () => {
  it("exposes the members JpxImage.decode uses, and no pixels before a decode", () => {
    const module = openjpeg();
    expect(module.imageData).toBeNull();
    for (const name of ["_malloc", "_free", "writeArrayToMemory", "_jp2_decode"] as const) {
      expect(typeof module[name]).toBe("function");
    }
  });

  it("hands out pointers that are never 0, so pdf.js frees every buffer it allocates", () => {
    const module = openjpeg();
    const first = module._malloc(4);
    const second = module._malloc(4);
    expect(first).not.toBe(0);
    expect(second).not.toBe(first);
  });

  it("copies the codestream when pdf.js writes it, not when it is decoded", () => {
    const sent = stubXhr({ status: 200, body: Uint8Array.of(1) });
    const data = CODESTREAM.slice();
    const module = openjpeg();
    const pointer = module._malloc(data.length);
    module.writeArrayToMemory(data, pointer);
    data.fill(0);
    module._jp2_decode(pointer, CODESTREAM.length, 3, false, false, 0);
    expect(sent[0]?.body).toEqual(CODESTREAM);
  });
});

describe("jpxBridge: _jp2_decode", () => {
  it("POSTs the codestream synchronously to the jpx route with the flags pdf.js passes", () => {
    const sent = stubXhr({ status: 200, body: Uint8Array.of(1, 2, 3) });
    const { ret } = decode(CODESTREAM, { components: 3, indexed: true, smask: false, reduce: 2 });
    expect(ret).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: "POST",
      url: "atril://localhost/jpx?components=3&indexed=1&smask=0&reduce=2",
      async: false,
      responseType: "arraybuffer",
      headers: [],
    });
    expect(sent[0]?.body).toEqual(CODESTREAM);
  });

  it("sends components=0 when the colour space is unknown, as pdf.js does for images without one", () => {
    const sent = stubXhr({ status: 200, body: Uint8Array.of(1) });
    decode(CODESTREAM, { components: 0, indexed: false, smask: true, reduce: 0 });
    expect(sent[0]?.url).toBe("atril://localhost/jpx?components=0&indexed=0&smask=1&reduce=0");
  });

  it("returns the pixels of a 200 answer as a Uint8ClampedArray", () => {
    stubXhr({ status: 200, body: Uint8Array.of(9, 8, 7) });
    const { module, ret } = decode(CODESTREAM);
    expect(ret).toBe(0);
    expect(module.imageData).toBeInstanceOf(Uint8ClampedArray);
    expect(module.imageData).toEqual(new Uint8ClampedArray([9, 8, 7]));
    expect(module.errorMessages).toBeUndefined();
  });

  it("reports the backend's message when it refuses the codestream (422)", () => {
    stubXhr({ status: 422, body: "codestream truncated" });
    const { module, ret } = decode(CODESTREAM);
    expect(ret).toBe(DECODE_FAILED);
    expect(module.errorMessages).toBe("codestream truncated");
    expect(module.imageData).toBeNull();
  });

  it("reads the message from a JSON body on 422", () => {
    stubXhr({ status: 422, body: JSON.stringify({ code: "bad_codestream", message: "no SIZ marker" }) });
    const { module } = decode(CODESTREAM);
    expect(module.errorMessages).toBe("no SIZ marker");
  });

  it("treats a route that does not exist (404) as a failed request", () => {
    stubXhr({ status: 404, body: "not found" });
    const { module, ret } = decode(CODESTREAM);
    expect(ret).toBe(REQUEST_FAILED);
    expect(module.errorMessages).toContain("answered 404");
    expect(module.imageData).toBeNull();
  });

  it("treats an empty 200 as a failed request, not as an empty image", () => {
    stubXhr({ status: 200, body: new Uint8Array(0) });
    const { module, ret } = decode(CODESTREAM);
    expect(ret).toBe(REQUEST_FAILED);
    expect(module.errorMessages).toContain("answered with no pixels");
  });

  it("accepts pixels whose size matches the X-Jpx-* headers", () => {
    stubXhr({
      status: 200,
      body: Uint8Array.of(1, 2),
      headers: { "X-Jpx-Width": "1", "X-Jpx-Height": "2", "X-Jpx-Channels": "1" },
    });
    expect(decode(CODESTREAM).ret).toBe(0);
  });

  it("rejects pixels shorter than the X-Jpx-* headers say, instead of drawing a truncated image", () => {
    stubXhr({
      status: 200,
      body: Uint8Array.of(1, 2, 3),
      headers: { "X-Jpx-Width": "2", "X-Jpx-Height": "1", "X-Jpx-Channels": "4" },
    });
    const { module, ret } = decode(CODESTREAM);
    expect(ret).toBe(REQUEST_FAILED);
    expect(module.errorMessages).toContain("not the size its X-Jpx-* headers give");
    expect(module.imageData).toBeNull();
  });

  it("sends the defaults of the contract for options that are not numbers", () => {
    const sent = stubXhr({ status: 200, body: Uint8Array.of(1) });
    const module = openjpeg();
    const pointer = module._malloc(CODESTREAM.length);
    module.writeArrayToMemory(CODESTREAM, pointer);
    module._jp2_decode(pointer, CODESTREAM.length, Number.NaN, false, false, Number.NaN);
    expect(sent[0]?.url).toBe("atril://localhost/jpx?components=0&indexed=0&smask=0&reduce=0");
  });

  it("reads 400 and 413 as failed requests, like any other status", () => {
    stubXhr({ status: 413, body: "body larger than 64 MiB" });
    const large = decode(CODESTREAM);
    expect(large.ret).toBe(REQUEST_FAILED);
    expect(large.module.errorMessages).toContain("answered 413");

    stubXhr({ status: 400, body: "reduce out of range" });
    const invalid = decode(CODESTREAM);
    expect(invalid.ret).toBe(REQUEST_FAILED);
    expect(invalid.module.errorMessages).toContain("answered 400");
  });

  it("fails with its own message when the request cannot be sent", () => {
    stubXhr({ status: 0, fail: new Error("NetworkError") });
    const { module, ret } = decode(CODESTREAM);
    expect(ret).toBe(REQUEST_FAILED);
    expect(module.errorMessages).toContain("could not be requested");
  });

  it("clears the error of an earlier failure once a decode succeeds", () => {
    const module = openjpeg();
    stubXhr({ status: 422, body: "truncated" });
    expect(decode(CODESTREAM, undefined, module).ret).toBe(DECODE_FAILED);
    expect(module.errorMessages).toBe("truncated");

    stubXhr({ status: 200, body: Uint8Array.of(5, 6) });
    expect(decode(CODESTREAM, undefined, module).ret).toBe(0);
    expect(module.errorMessages).toBeUndefined();
    expect(module.imageData).toEqual(new Uint8ClampedArray([5, 6]));
  });
});

describe("jpxBridge: protocol base", () => {
  it("is atril://localhost on Linux", () => {
    expect(protocolBase(LINUX_UA)).toBe(LINUX_BASE);
    expect(LINUX_BASE).toBe("atril://localhost");
  });

  it("is http://atril.localhost on Windows (WebView2)", () => {
    expect(protocolBase(WINDOWS_UA)).toBe(WINDOWS_BASE);
    expect(WINDOWS_BASE).toBe("http://atril.localhost");
  });

  it("follows the worker's navigator when it decodes", () => {
    vi.stubGlobal("navigator", { userAgent: WINDOWS_UA });
    const sent = stubXhr({ status: 200, body: Uint8Array.of(1) });
    decode(CODESTREAM);
    expect(sent[0]?.url).toBe("http://atril.localhost/jpx?components=3&indexed=0&smask=0&reduce=0");
  });

  it("has no imports, because pdf.js imports it as a plain file", () => {
    expect(bridgeSource).not.toMatch(/^\s*import\s/m);
  });
});
