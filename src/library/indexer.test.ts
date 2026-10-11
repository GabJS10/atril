import { describe, expect, it, vi } from "vitest";
import type { Book, ScanMetadata } from "../api/types";
import { indexBook, type IndexerDeps, isJpeg, runIndexer, CoverFormatError } from "./indexer";

function book(id: string): Book {
  return {
    id,
    title: `Libro ${id}`,
    author: null,
    fileName: `${id}.pdf`,
    pageCount: null,
    fileUrl: `atril://localhost/book/${id}`,
    coverUrl: null,
    favorite: false,
    missing: false,
    scanState: "pending",
    currentPage: null,
    progress: null,
    addedAt: "2026-10-11T12:00:00Z",
    lastOpenedAt: null,
  };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0]);

/** A fake pdf.js loading task. */
function fakeTask(options: { info?: Record<string, unknown>; numPages?: number; fail?: unknown } = {}) {
  const destroy = vi.fn().mockResolvedValue(undefined);
  const pdf = {
    numPages: options.numPages ?? 300,
    getMetadata: vi.fn().mockResolvedValue({ info: options.info ?? {} }),
  };
  const promise = options.fail ? Promise.reject(options.fail) : Promise.resolve(pdf);
  promise.catch(() => undefined);
  return { task: { promise, destroy } as never, pdf, destroy };
}

function makeDeps(overrides: Partial<IndexerDeps> = {}): IndexerDeps {
  return {
    listPending: vi.fn().mockResolvedValue([]),
    openPdf: vi.fn().mockResolvedValue(fakeTask().task),
    renderCover: vi.fn().mockResolvedValue(JPEG),
    saveScan: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    waitWhileReading: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("indexBook", () => {
  it("saves the page count, the clean metadata and the cover", async () => {
    const { task, destroy } = fakeTask({
      numPages: 176,
      info: { Title: "  Meditaciones ", Author: "Marco Aurelio" },
    });
    const deps = makeDeps({ openPdf: vi.fn().mockResolvedValue(task) });

    await expect(indexBook(book("a"), deps)).resolves.toBe("done");

    expect(deps.saveScan).toHaveBeenCalledWith(
      "a",
      { pageCount: 176, title: "Meditaciones", author: "Marco Aurelio" } satisfies ScanMetadata,
      JPEG,
    );
    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("drops junk metadata instead of sending it", async () => {
    const { task } = fakeTask({ info: { Title: "Microsoft Word - capitulo.doc", Author: "Anonymous" } });
    const deps = makeDeps({ openPdf: vi.fn().mockResolvedValue(task) });

    await indexBook(book("b"), deps);

    expect(deps.saveScan).toHaveBeenCalledWith(
      "b",
      { pageCount: 300, title: undefined, author: undefined },
      JPEG,
    );
  });

  it("leaves the book pending when the backend refuses the save, instead of marking it failed", async () => {
    const { task } = fakeTask();
    const deps = makeDeps({
      openPdf: vi.fn().mockResolvedValue(task),
      saveScan: vi.fn().mockRejectedValue({ code: "io", message: "disk full" }),
    });

    await expect(indexBook(book("f"), deps)).resolves.toBe("error");
    expect(deps.markFailed).not.toHaveBeenCalled();
  });

  it("marks a book pdf.js cannot read as failed", async () => {
    const { task, destroy } = fakeTask({ fail: new Error("Invalid PDF structure") });
    const deps = makeDeps({ openPdf: vi.fn().mockResolvedValue(task) });

    await expect(indexBook(book("c"), deps)).resolves.toBe("failed");

    expect(deps.markFailed).toHaveBeenCalledWith("c");
    expect(deps.saveScan).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1); // released even though it never loaded
  });

  it("leaves a missing file to the backend (404 from the protocol)", async () => {
    const deps = makeDeps({
      openPdf: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("range 0-65536 failed with 404"), { status: 404 })),
    });

    await expect(indexBook(book("d"), deps)).resolves.toBe("missing");

    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(deps.saveScan).not.toHaveBeenCalled();
  });

  it("does not mark books failed when the browser cannot encode WebP", async () => {
    const { task } = fakeTask();
    const deps = makeDeps({
      openPdf: vi.fn().mockResolvedValue(task),
      renderCover: vi.fn().mockRejectedValue(new CoverFormatError("image/png")),
    });

    await expect(indexBook(book("e"), deps)).rejects.toBeInstanceOf(CoverFormatError);
    expect(deps.markFailed).not.toHaveBeenCalled();
  });
});

describe("runIndexer", () => {
  it("indexes the pending books one by one and reports the run", async () => {
    const pending = [book("1"), book("2"), book("3")];
    const deps = makeDeps({
      listPending: vi.fn().mockImplementation(async () => pending.filter((b) => b.scanState === "pending")),
      openPdf: vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/2")) return fakeTask({ fail: new Error("broken") }).task;
        return fakeTask().task;
      }),
      saveScan: vi.fn().mockImplementation(async (id: string) => {
        pending.find((b) => b.id === id)!.scanState = "done";
      }),
    });

    const run = await runIndexer(deps);

    expect(run).toEqual({ indexed: 2, failed: 1, errors: 0 });
    expect(deps.openPdf).toHaveBeenCalledTimes(3);
  });

  it("tries each book once per run, so a book that stays pending cannot loop", async () => {
    const stuck = book("stuck");
    const deps = makeDeps({
      listPending: vi.fn().mockResolvedValue([stuck]),
      openPdf: vi.fn().mockRejectedValue(Object.assign(new Error("404"), { status: 404 })),
    });

    await runIndexer(deps);

    expect(deps.openPdf).toHaveBeenCalledTimes(1);
  });

  it("waits for the reader before each book", async () => {
    const order: string[] = [];
    const deps = makeDeps({
      listPending: vi
        .fn()
        .mockResolvedValueOnce([book("x")])
        .mockResolvedValue([]),
      waitWhileReading: vi.fn().mockImplementation(async () => order.push("wait")),
      openPdf: vi.fn().mockImplementation(async () => {
        order.push("open");
        return fakeTask().task;
      }),
    });

    await runIndexer(deps);

    expect(order).toEqual(["wait", "open", "wait"]); // one wait before each listing, including the last
  });

  it("stops when asked to", async () => {
    const deps = makeDeps({ listPending: vi.fn().mockResolvedValue([book("1"), book("2")]) });

    const run = await runIndexer(deps, () => true);

    expect(run).toEqual({ indexed: 0, failed: 0, errors: 0 });
    expect(deps.openPdf).not.toHaveBeenCalled();
  });
});

describe("isJpeg", () => {
  it("recognises the JPEG signature and rejects PNG and WebP", () => {
    expect(isJpeg(JPEG)).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe(false);
    expect(
      isJpeg(
        new Uint8Array([
          ...new TextEncoder().encode("RIFF"),
          0,
          0,
          0,
          0,
          ...new TextEncoder().encode("WEBP"),
        ]),
      ),
    ).toBe(false);
  });
});
