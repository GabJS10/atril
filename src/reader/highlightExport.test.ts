import { describe, expect, it, vi } from "vitest";
import { exportBookHighlights } from "./highlightExport";

const BOOK = { id: "book-1", title: "Pedro Páramo" };

describe("exportBookHighlights", () => {
  it("asks for the path with the suggested name, then exports in the UI language", async () => {
    const pickPath = vi.fn().mockResolvedValue("/home/u/Documentos/Pedro Páramo - subrayados.md");
    const exportTo = vi.fn().mockResolvedValue({ count: 3 });

    const count = await exportBookHighlights(BOOK, "en", { pickPath, exportTo });

    expect(pickPath).toHaveBeenCalledWith("Pedro Páramo - subrayados.md");
    expect(exportTo).toHaveBeenCalledWith("book-1", "/home/u/Documentos/Pedro Páramo - subrayados.md", "en");
    expect(count).toBe(3);
  });

  it("exports nothing when the user cancels the dialog", async () => {
    const exportTo = vi.fn();

    const count = await exportBookHighlights(BOOK, "es", {
      pickPath: vi.fn().mockResolvedValue(null),
      exportTo,
    });

    expect(count).toBeNull();
    expect(exportTo).not.toHaveBeenCalled();
  });

  it("lets a backend error reach the caller", async () => {
    const error = { code: "io", message: "disco lleno" };

    await expect(
      exportBookHighlights(BOOK, "es", {
        pickPath: vi.fn().mockResolvedValue("/tmp/x.md"),
        exportTo: vi.fn().mockRejectedValue(error),
      }),
    ).rejects.toEqual(error);
  });
});
