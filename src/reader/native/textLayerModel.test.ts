import { describe, expect, it } from "vitest";
import type { TextWord } from "../../api/types";
import {
  copyTextOf,
  foldedTextOf,
  separatorAfter,
  sliceBox,
  spanContent,
  stretchFor,
  wordStyle,
} from "./textLayerModel";

const word = (text: string, x0: number, lineEnd = false, blockEnd = false): TextWord => ({
  text,
  rect: [x0, 100, x0 + text.length * 10, 112],
  lineEnd,
  blockEnd,
});

describe("wordStyle", () => {
  it("places a word at its box, in points, with a font as tall as the box", () => {
    expect(wordStyle([72, 100.5, 120, 112.5])).toEqual({
      left: 72,
      top: 100.5,
      width: 48,
      height: 12,
      fontSize: 12,
    });
  });

  it("never gives a negative size", () => {
    expect(wordStyle([10, 20, 5, 15])).toMatchObject({ width: 0, height: 0 });
  });
});

describe("stretchFor", () => {
  it("stretches the text drawn by the browser to the width of the engine's box", () => {
    expect(stretchFor(50, 40)).toBeCloseTo(1.25, 10);
    expect(stretchFor(30, 40)).toBeCloseTo(0.75, 10);
  });

  it("leaves the text alone when nothing was laid out or the box is empty", () => {
    expect(stretchFor(50, 0)).toBe(1);
    expect(stretchFor(0, 40)).toBe(1);
    expect(stretchFor(50, Number.NaN)).toBe(1);
  });
});

describe("spanContent", () => {
  const at = (text: string, x0: number, x1: number, y0 = 100, lineEnd = false): TextWord => ({
    text,
    rect: [x0, y0, x1, y0 + 12],
    lineEnd,
    blockEnd: false,
  });

  it("reaches the next word of the line with the space between them", () => {
    const words = [at("En", 50, 70), at("un", 76, 90)];
    expect(spanContent(words, 0)).toEqual({ text: "En ", width: 26 });
  });

  it("ends a line, and the last word of the page, at its own box", () => {
    const words = [at("lugar", 50, 100, 100, true), at("de", 50, 70, 115)];
    expect(spanContent(words, 0)).toEqual({ text: "lugar", width: 50 });
    expect(spanContent(words, 1)).toEqual({ text: "de", width: 20 });
  });

  it("does not reach a word that is not next to it on the same line", () => {
    // Another column far to the right, another line, or overlapping.
    expect(spanContent([at("a", 0, 10), at("b", 200, 210)], 0).text).toBe("a");
    expect(spanContent([at("a", 0, 10), at("b", 20, 30, 140)], 0).text).toBe("a");
    expect(spanContent([at("a", 0, 10), at("b", 8, 30)], 0)).toEqual({ text: "a", width: 10 });
  });
});

describe("copying text", () => {
  const words = [
    word("En", 0),
    word("un", 30),
    word("lugar", 60, true),
    word("de", 0),
    word("la", 30, true, true),
    word("Mancha", 0, true),
  ];
  const all = words.map((_, index) => ({ index, from: 0, to: words[index]!.text.length }));

  it("puts a space inside a line, a line break at a line end and a blank line at a block end", () => {
    expect(separatorAfter(words[0]!)).toBe(" ");
    expect(separatorAfter(words[2]!)).toBe("\n");
    expect(separatorAfter(words[4]!)).toBe("\n\n");
    expect(copyTextOf(words, all)).toBe("En un lugar\nde la\n\nMancha");
  });

  it("does not end with the break of the last word it takes", () => {
    expect(copyTextOf(words, all.slice(0, 3))).toBe("En un lugar");
    expect(copyTextOf(words, [all[4]!])).toBe("la");
  });

  it("cuts the first and last word to the characters selected", () => {
    expect(
      copyTextOf(words, [
        { index: 1, from: 1, to: 2 },
        { index: 2, from: 0, to: 3 },
      ]),
    ).toBe("n lug");
  });

  it("ignores a slice of a word that does not exist", () => {
    expect(copyTextOf(words, [{ index: 99, from: 0, to: 1 }])).toBe("");
  });

  it("folds every break into one space for a highlight, and caps its length", () => {
    expect(foldedTextOf("En un lugar\nde la\n\nMancha")).toBe("En un lugar de la Mancha");
    expect(foldedTextOf("  a\n\n b  ")).toBe("a b");
    expect(foldedTextOf("abcdef", 3)).toBe("abc");
  });
});

describe("sliceBox", () => {
  const w = word("abcd", 100); // 100..140

  it("gives the whole box for a whole word", () => {
    expect(sliceBox(w, 0, 4)).toEqual({ x1: 100, y1: 100, x2: 140, y2: 112 });
  });

  it("takes the characters as equally wide for a part of a word", () => {
    expect(sliceBox(w, 1, 3)).toEqual({ x1: 110, y1: 100, x2: 130, y2: 112 });
  });

  it("clamps to the word and gives nothing for an empty range", () => {
    expect(sliceBox(w, -5, 99)).toEqual({ x1: 100, y1: 100, x2: 140, y2: 112 });
    expect(sliceBox(w, 2, 2)).toBeNull();
    expect(sliceBox(w, 3, 1)).toBeNull();
    expect(sliceBox({ ...w, text: "" }, 0, 1)).toBeNull();
  });
});
