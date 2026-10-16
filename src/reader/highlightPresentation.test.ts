import { describe, expect, it } from "vitest";
import { displayHighlightText } from "./highlightPresentation";

describe("displayHighlightText", () => {
  it("repairs a hyphenation saved with a space after the hyphen", () => {
    expect(displayHighlightText("hoy nos llena de for- taleza y vida")).toBe(
      "hoy nos llena de fortaleza y vida",
    );
    expect(displayHighlightText("sin vio- lentar su sentido")).toBe("sin violentar su sentido");
    expect(displayHighlightText("ac- ciédn de gracias")).toBe("acciédn de gracias");
  });

  it("repairs a soft hyphen and a Unicode hyphen the same way", () => {
    expect(displayHighlightText("for­ taleza")).toBe("fortaleza");
    expect(displayHighlightText("for‐ taleza")).toBe("fortaleza");
  });

  it("keeps the hyphen of a range between two numbers", () => {
    expect(displayHighlightText("Lucas (22,19- 20)")).toBe("Lucas (22,19-20)");
  });

  it("leaves a hyphen before a capital, and text without hyphens, as it is", () => {
    expect(displayHighlightText("Rosa- María")).toBe("Rosa- María");
    expect(displayHighlightText("En un lugar de la Mancha")).toBe("En un lugar de la Mancha");
    expect(displayHighlightText("cielo-azul sin espacio")).toBe("cielo-azul sin espacio");
    expect(displayHighlightText("")).toBe("");
  });

  it("joins every hyphenation of a text, one after another", () => {
    expect(displayHighlightText("a- b- c")).toBe("abc");
  });
});
