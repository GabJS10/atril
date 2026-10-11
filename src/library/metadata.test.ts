import { describe, expect, it } from "vitest";
import { cleanMetadataText, coverScale, MAX_METADATA_LENGTH } from "./metadata";

describe("cleanMetadataText", () => {
  it.each([
    ["Meditaciones", "Meditaciones"],
    ["  Cien   años de\n soledad ", "Cien años de soledad"],
  ])("keeps a real title %j", (input, expected) => {
    expect(cleanMetadataText(input, "title")).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "x",
    "Microsoft Word - capitulo1.doc",
    "Microsoft Excel - hojas",
    "informe-final.docx",
    "tesis.pdf",
    "Untitled",
    "Untitled1",
    "Sin título",
    "null",
    "123456",
    "--",
  ])("drops the junk title %j", (input) => {
    expect(cleanMetadataText(input, "title")).toBeUndefined();
  });

  it("drops junk authors but keeps names", () => {
    expect(cleanMetadataText("Marco Aurelio", "author")).toBe("Marco Aurelio");
    expect(cleanMetadataText("Anonymous", "author")).toBeUndefined();
    expect(cleanMetadataText("Autor", "author")).toBeUndefined();
  });

  it("ignores non-string metadata", () => {
    expect(cleanMetadataText(undefined, "title")).toBeUndefined();
    expect(cleanMetadataText(42, "author")).toBeUndefined();
  });

  it("caps the length", () => {
    const long = "a".repeat(MAX_METADATA_LENGTH + 50);
    expect(cleanMetadataText(long, "title")).toHaveLength(MAX_METADATA_LENGTH);
  });
});

describe("coverScale", () => {
  it("renders the page at the target width", () => {
    expect(coverScale(612, 400) * 612).toBeCloseTo(400);
  });

  it("falls back to 1 for an unknown width", () => {
    expect(coverScale(0)).toBe(1);
  });
});
