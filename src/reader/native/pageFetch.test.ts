import { describe, expect, it, vi } from "vitest";
import { fetchPageImage, PageFetchError } from "./pageFetch";

const jpeg = () => new Response(new Blob(["jpeg"], { type: "image/jpeg" }), { status: 200 });
const status = (code: number) => new Response(null, { status: code });
const noSleep = () => Promise.resolve();

function run(responses: (Response | Error)[], extra: Partial<Parameters<typeof fetchPageImage>[1]> = {}) {
  const fetchImpl = vi.fn(() => {
    const next = responses.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? status(500));
  });
  const sleep = vi.fn(noSleep);
  const promise = fetchPageImage("atril://localhost/page/abc/3?scale=1.33", {
    isWanted: () => true,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    ...extra,
  });
  return { promise, fetchImpl, sleep };
}

describe("fetchPageImage", () => {
  it("returns the image on a 200", async () => {
    const { promise, fetchImpl } = run([jpeg()]);
    await expect(promise).resolves.toBeInstanceOf(Blob);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks again after a 410 while the page is wanted", async () => {
    const { promise, fetchImpl, sleep } = run([status(410), status(410), jpeg()]);
    await expect(promise).resolves.toBeInstanceOf(Blob);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("stops after the retry limit of 410s", async () => {
    const { promise, fetchImpl } = run(
      Array.from({ length: 20 }, () => status(410)),
      {
        goneDelaysMs: [1, 1, 1],
      },
    );
    await expect(promise).rejects.toMatchObject({ reason: "gone", status: 410 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("stops at once when the page is no longer wanted (the user went elsewhere)", async () => {
    let wanted = true;
    const { promise, fetchImpl } = run([status(410), jpeg()], {
      isWanted: () => wanted,
      sleep: async () => {
        wanted = false;
      },
    });
    await expect(promise).rejects.toMatchObject({ reason: "cancelled" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not use an image that arrives after the page stopped being wanted", async () => {
    let wanted = true;
    const fetchImpl = vi.fn(() => {
      wanted = false;
      return Promise.resolve(jpeg());
    });
    await expect(
      fetchPageImage("u", { isWanted: () => wanted, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ reason: "cancelled" });
  });

  it.each([400, 404, 422])("does not retry a %i", async (code) => {
    const { promise, fetchImpl } = run([status(code), jpeg()]);
    await expect(promise).rejects.toMatchObject({ reason: "failed", status: code });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 500 once", async () => {
    const recovered = run([status(500), jpeg()]);
    await expect(recovered.promise).resolves.toBeInstanceOf(Blob);
    const failed = run([status(500), status(500), jpeg()]);
    await expect(failed.promise).rejects.toMatchObject({ reason: "failed", status: 500 });
    expect(failed.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a network error like a failed render", async () => {
    const { promise, fetchImpl } = run([new TypeError("network"), jpeg()]);
    await expect(promise).resolves.toBeInstanceOf(Blob);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("the error says why", () => {
    const error = new PageFetchError("gone", 410);
    expect(error.message).toContain("410");
    expect(error.name).toBe("PageFetchError");
  });
});
