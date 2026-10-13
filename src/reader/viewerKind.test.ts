import { describe, expect, it } from "vitest";
import { readViewerKind, VIEWER_STORAGE_KEY } from "./viewerKind";

const storage = (value: string | null) => ({
  getItem: (key: string) => (key === VIEWER_STORAGE_KEY ? value : null),
});

describe("readViewerKind", () => {
  it("is pdf.js unless the development switch says native", () => {
    expect(readViewerKind(storage(null))).toBe("pdfjs");
    expect(readViewerKind(storage("pdfjs"))).toBe("pdfjs");
    expect(readViewerKind(storage("other"))).toBe("pdfjs");
    expect(readViewerKind(storage("native"))).toBe("native");
  });

  it("falls back to pdf.js when storage is not available", () => {
    expect(readViewerKind(null)).toBe("pdfjs");
    expect(
      readViewerKind({
        getItem() {
          throw new Error("denied");
        },
      }),
    ).toBe("pdfjs");
  });

  it("reads localStorage by default", () => {
    localStorage.setItem(VIEWER_STORAGE_KEY, "native");
    expect(readViewerKind()).toBe("native");
    localStorage.removeItem(VIEWER_STORAGE_KEY);
    expect(readViewerKind()).toBe("pdfjs");
  });
});
