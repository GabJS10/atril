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

  describe("environment variable", () => {
    it("opens native when VITE_ATRIL_VIEWER says so and storage has no choice", () => {
      expect(readViewerKind(storage(null), "native")).toBe("native");
      expect(readViewerKind(null, "native")).toBe("native");
      expect(readViewerKind(storage(null), "pdfjs")).toBe("pdfjs");
      expect(readViewerKind(storage(null), "other")).toBe("pdfjs");
      expect(readViewerKind(storage(null), undefined)).toBe("pdfjs");
    });

    it("localStorage wins over the variable", () => {
      expect(readViewerKind(storage("pdfjs"), "native")).toBe("pdfjs");
      expect(readViewerKind(storage("native"), "pdfjs")).toBe("native");
      // An unknown stored value is no choice: the variable decides.
      expect(readViewerKind(storage("other"), "native")).toBe("native");
    });
  });
});
