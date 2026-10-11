import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRange, PdfRangeError } from "./pdfLoader";

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
