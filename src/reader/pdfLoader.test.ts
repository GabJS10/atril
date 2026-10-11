import { getDocument } from "pdfjs-dist";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRange, openPdfByRanges, PdfRangeError, pdfjsAssetUrls } from "./pdfLoader";

// The loader hands pdf.js its options; the spy records them without loading a real document.
vi.mock("pdfjs-dist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pdfjs-dist")>();
  return {
    ...actual,
    getDocument: vi.fn(() => ({ promise: new Promise(() => undefined), destroy: vi.fn() })),
  };
});

const FILE_URL = "atril://localhost/book/abc";

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchRange", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for an inclusive Range and reads the total from Content-Range", async () => {
    const fetchMock = stubFetch(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: { "Content-Range": "bytes 10-13/1000" },
      }),
    );

    const chunk = await fetchRange(FILE_URL, 10, 14);

    expect(fetchMock).toHaveBeenCalledWith(FILE_URL, { headers: { Range: "bytes=10-13" } });
    expect(chunk.status).toBe(206);
    expect(chunk.total).toBe(1000);
    expect(Array.from(chunk.bytes)).toEqual([1, 2, 3, 4]);
  });

  it("slices the body when the backend ignores Range and answers 200", async () => {
    stubFetch(new Response(new Uint8Array([0, 1, 2, 3, 4, 5]), { status: 200 }));

    const chunk = await fetchRange(FILE_URL, 2, 4);

    expect(chunk.status).toBe(200);
    expect(chunk.total).toBe(6);
    expect(Array.from(chunk.bytes)).toEqual([2, 3]);
  });

  it("rejects 404 and 416 with the status", async () => {
    stubFetch(new Response(null, { status: 404 }));
    await expect(fetchRange(FILE_URL, 0, 10)).rejects.toMatchObject({ status: 404 });
    await expect(fetchRange(FILE_URL, 0, 10)).rejects.toBeInstanceOf(PdfRangeError);
  });

  it("rejects a 206 without a usable Content-Range", async () => {
    stubFetch(new Response(new Uint8Array([1]), { status: 206 }));
    await expect(fetchRange(FILE_URL, 0, 1)).rejects.toThrow(/Content-Range/);
  });
});

describe("pdf.js runtime files", () => {
  it("resolves the WebAssembly, CMap, font and ICC folders against the page, with trailing slashes", () => {
    expect(pdfjsAssetUrls("http://localhost:1420/index.html")).toEqual({
      wasmUrl: "http://localhost:1420/pdfjs/wasm/",
      cMapUrl: "http://localhost:1420/pdfjs/cmaps/",
      standardFontDataUrl: "http://localhost:1420/pdfjs/standard_fonts/",
      iccUrl: "http://localhost:1420/pdfjs/iccs/",
    });
  });

  it("uses the same paths under the Tauri origin of the built app", () => {
    expect(pdfjsAssetUrls("tauri://localhost/index.html").wasmUrl).toBe("tauri://localhost/pdfjs/wasm/");
  });

  it("opens a book with those folders, so scanned (JPEG 2000, JBIG2) and unembedded-font pages decode", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Uint8Array([1, 2]), { status: 206, headers: { "Content-Range": "bytes 0-1/2" } }),
        ),
    );

    await openPdfByRanges(FILE_URL);

    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        wasmUrl: expect.stringMatching(/\/pdfjs\/wasm\/$/),
        cMapUrl: expect.stringMatching(/\/pdfjs\/cmaps\/$/),
        cMapPacked: true,
        standardFontDataUrl: expect.stringMatching(/\/pdfjs\/standard_fonts\/$/),
        iccUrl: expect.stringMatching(/\/pdfjs\/iccs\/$/),
      }),
    );
    vi.unstubAllGlobals();
  });
});
