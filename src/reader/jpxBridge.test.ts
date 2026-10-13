import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bridgeSource from "./jpxBridge.js?raw";
import openjpeg, { LINUX_BASE, REQUEST_FAILED, WINDOWS_BASE, protocolBase } from "./jpxBridge";

// The second level: pdf.js's JavaScript decoder. The real one is only copied into dist/ by the build; here it is a
// stand-in that records what it was asked to decode and answers with the pixels or the failure set up by the test.
const fallback = vi.hoisted(() => ({
  calls: [] as { bytes: number[]; flags: unknown[] }[],
  ret: 0,
  pixels: new Uint8ClampedArray([7, 7, 7]),
  message: "fallback refused",
  throws: false,
}));

vi.mock("./openjpeg_js_fallback.js", () => ({
  default: async () => {
    const memory = new Map<number, Uint8Array>();
    let next = 1;
    const module = {
      imageData: null as Uint8ClampedArray | null,
      errorMessages: undefined as string | undefined,
      _malloc(size: number) {
        const pointer = next;
        next += 1;
        memory.set(pointer, new Uint8Array(size));
        return pointer;
      },
      _free(pointer: number) {
        memory.delete(pointer);
      },
      writeArrayToMemory(array: Uint8Array, pointer: number) {
        memory.get(pointer)?.set(array);
      },
      _jp2_decode(pointer: number, size: number, ...flags: unknown[]) {
        if (fallback.throws) throw new Error("abort");
        const bytes = Array.from(memory.get(pointer)?.subarray(0, size) ?? []);
        fallback.calls.push({ bytes, flags });
        if (fallback.ret === 0) {
          module.imageData = fallback.pixels;
        } else {
          module.errorMessages = fallback.message;
        }
        return fallback.ret;
      },
    };
    return module;
  },
}));

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
async function decode(
  codestream: Uint8Array,
  flags = { components: 3, indexed: false, smask: false, reduce: 0 },
  module?: Awaited<ReturnType<typeof openjpeg>>,
) {
  const decoder = module ?? (await openjpeg());
  const pointer = decoder._malloc(codestream.length);
  decoder.writeArrayToMemory(codestream, pointer);
  const ret = decoder._jp2_decode(
    pointer,
    codestream.length,
    flags.components,
    flags.indexed,
    flags.smask,
    flags.reduce,
  );
  decoder._free(pointer);
  return { module: decoder, ret };
}

const CODESTREAM = Uint8Array.of(0xff, 0x4f, 0xff, 0x51, 0, 1, 2);

beforeEach(() => {
  fallback.calls.length = 0;
  fallback.ret = 0;
  fallback.pixels = new Uint8ClampedArray([7, 7, 7]);
  fallback.message = "fallback refused";
  fallback.throws = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("jpxBridge: the module pdf.js reads", () => {
  it("exposes the members JpxImage.decode uses, and no pixels before a decode", async () => {
    const module = await openjpeg();
    expect(module.imageData).toBeNull();
    for (const name of ["_malloc", "_free", "writeArrayToMemory", "_jp2_decode"] as const) {
      expect(typeof module[name]).toBe("function");
    }
  });

  it("hands out pointers that are never 0, so pdf.js frees every buffer it allocates", async () => {
    const module = await openjpeg();
    const first = module._malloc(4);
    const second = module._malloc(4);
    expect(first).not.toBe(0);
    expect(second).not.toBe(first);
  });

  it("copies the codestream when pdf.js writes it, not when it is decoded", async () => {
    const sent = stubXhr({ status: 200, body: Uint8Array.of(1) });
    const data = CODESTREAM.slice();
    const module = await openjpeg();
    const pointer = module._malloc(data.length);
    module.writeArrayToMemory(data, pointer);
    data.fill(0);
    module._jp2_decode(pointer, CODESTREAM.length, 3, false, false, 0);
    expect(sent[0]?.body).toEqual(CODESTREAM);
  });
});

describe("jpxBridge: _jp2_decode with the backend", () => {
  it("POSTs the codestream synchronously to the jpx route with the flags pdf.js passes", async () => {
    const sent = stubXhr({ status: 200, body: Uint8Array.of(1, 2, 3) });
    const { ret } = await decode(CODESTREAM, { components: 3, indexed: true, smask: false, reduce: 2 });
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

  it("sends components=0 when the colour space is unknown, as pdf.js does for images without one", async () => {
    const sent = stubXhr({ status: 200, body: Uint8Array.of(1) });
    await decode(CODESTREAM, { components: 0, indexed: false, smask: true, reduce: 0 });
    expect(sent[0]?.url).toBe("atril://localhost/jpx?components=0&indexed=0&smask=1&reduce=0");
  });

  it("returns the pixels of a 200 answer as a Uint8ClampedArray and never touches the fallback", async () => {
    stubXhr({ status: 200, body: Uint8Array.of(9, 8, 7) });
    const { module, ret } = await decode(CODESTREAM);
    expect(ret).toBe(0);
    expect(module.imageData).toBeInstanceOf(Uint8ClampedArray);
    expect(module.imageData).toEqual(new Uint8ClampedArray([9, 8, 7]));
    expect(module.errorMessages).toBeUndefined();
    expect(fallback.calls).toHaveLength(0);
  });

  it("accepts pixels whose size matches the X-Jpx-* headers", async () => {
    stubXhr({
      status: 200,
      body: Uint8Array.of(1, 2),
      headers: { "X-Jpx-Width": "1", "X-Jpx-Height": "2", "X-Jpx-Channels": "1" },
    });
    expect((await decode(CODESTREAM)).ret).toBe(0);
    expect(fallback.calls).toHaveLength(0);
  });

  it("sends the defaults of the contract for options that are not numbers", async () => {
    const sent = stubXhr({ status: 200, body: Uint8Array.of(1) });
    const module = await openjpeg();
    const pointer = module._malloc(CODESTREAM.length);
    module.writeArrayToMemory(CODESTREAM, pointer);
    module._jp2_decode(pointer, CODESTREAM.length, Number.NaN, false, false, Number.NaN);
    expect(sent[0]?.url).toBe("atril://localhost/jpx?components=0&indexed=0&smask=0&reduce=0");
  });
});

describe("jpxBridge: second level, pdf.js's own decoder", () => {
  it("decodes with the fallback when the backend refuses the image (422), with the same arguments", async () => {
    stubXhr({ status: 422, body: "reduction exceeds the resolution levels" });
    const { module, ret } = await decode(CODESTREAM, {
      components: 3,
      indexed: true,
      smask: true,
      reduce: 2,
    });
    expect(ret).toBe(0);
    expect(module.imageData).toEqual(new Uint8ClampedArray([7, 7, 7]));
    expect(module.errorMessages).toBeUndefined();
    expect(fallback.calls).toEqual([{ bytes: [...CODESTREAM], flags: [3, true, true, 2] }]);
  });

  it("decodes with the fallback when the request cannot be sent (network error)", async () => {
    stubXhr({ status: 0, fail: new Error("NetworkError") });
    const { module, ret } = await decode(CODESTREAM);
    expect(ret).toBe(0);
    expect(module.imageData).toEqual(new Uint8ClampedArray([7, 7, 7]));
    expect(fallback.calls).toHaveLength(1);
  });

  it("decodes with the fallback when the route does not answer with pixels (404, empty 200, bad size)", async () => {
    stubXhr({ status: 404, body: "not found" });
    expect((await decode(CODESTREAM)).ret).toBe(0);
    stubXhr({ status: 200, body: new Uint8Array(0) });
    expect((await decode(CODESTREAM)).ret).toBe(0);
    stubXhr({
      status: 200,
      body: Uint8Array.of(1, 2, 3),
      headers: { "X-Jpx-Width": "2", "X-Jpx-Height": "1", "X-Jpx-Channels": "4" },
    });
    expect((await decode(CODESTREAM)).ret).toBe(0);
    expect(fallback.calls).toHaveLength(3);
  });

  it("reports both reasons when the fallback cannot decode the image either", async () => {
    fallback.ret = 3;
    stubXhr({ status: 422, body: JSON.stringify({ code: "panic", message: "decoder panicked" }) });
    const { module, ret } = await decode(CODESTREAM);
    expect(ret).toBe(3);
    expect(module.imageData).toBeNull();
    expect(module.errorMessages).toBe("decoder panicked; pdf.js's decoder: fallback refused");
  });

  it("returns a failure when the fallback throws, instead of breaking the page", async () => {
    fallback.throws = true;
    stubXhr({ status: 422, body: "bad codestream" });
    const { module, ret } = await decode(CODESTREAM);
    expect(ret).toBe(REQUEST_FAILED);
    expect(module.errorMessages).toContain("pdf.js's decoder threw");
  });

  it("warns once per reason, not once per image", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The warned reasons live for the whole worker, so this test uses messages no other test uses.
    stubXhr({ status: 422, body: "warn-once: first reason" });
    await decode(CODESTREAM);
    await decode(CODESTREAM);
    expect(warn).toHaveBeenCalledTimes(1);
    stubXhr({ status: 422, body: "warn-once: second reason" });
    await decode(CODESTREAM);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("clears the error of an earlier failure once a decode succeeds", async () => {
    const module = await openjpeg();
    fallback.ret = 3;
    stubXhr({ status: 422, body: "truncated" });
    expect((await decode(CODESTREAM, undefined, module)).ret).toBe(3);
    expect(module.errorMessages).toContain("truncated");

    fallback.ret = 0;
    stubXhr({ status: 200, body: Uint8Array.of(5, 6) });
    expect((await decode(CODESTREAM, undefined, module)).ret).toBe(0);
    expect(module.errorMessages).toBeUndefined();
    expect(module.imageData).toEqual(new Uint8ClampedArray([5, 6]));
  });

  it("counts one reason once even when only the image sizes in the message differ", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubXhr({ status: 422, body: "normalise: reduce 31 is too high for a 1779x2765 image" });
    await decode(CODESTREAM);
    stubXhr({ status: 422, body: "normalise: reduce 31 is too high for a 1638x2652 image" });
    await decode(CODESTREAM);
    expect(warn).toHaveBeenCalledTimes(1);
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

  it("follows the worker's navigator when it decodes", async () => {
    vi.stubGlobal("navigator", { userAgent: WINDOWS_UA });
    const sent = stubXhr({ status: 200, body: Uint8Array.of(1) });
    await decode(CODESTREAM);
    expect(sent[0]?.url).toBe("http://atril.localhost/jpx?components=3&indexed=0&smask=0&reduce=0");
  });
});

describe("jpxBridge: the file pdf.js imports", () => {
  it("imports nothing but the renamed pdf.js decoder, because pdf.js imports it as a plain file", () => {
    const imports = bridgeSource.match(/^import\s[^;]*;/gm) ?? [];
    expect(imports).toEqual(['import OpenJPEG from "./openjpeg_js_fallback.js";']);
  });
});
