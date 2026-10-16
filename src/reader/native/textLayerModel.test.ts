import { describe, expect, it } from "vitest";
import type { TextWord } from "../../api/types";
import {
  copyTextOf,
  foldedTextOf,
  hyphenatedJoin,
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

describe("hyphenatedJoin", () => {
  it("joins a word cut by a hyphen after a letter, dropping the hyphen", () => {
    expect(hyphenatedJoin("for-", "taleza")).toBe("for");
    expect(hyphenatedJoin("vio-", "lentar")).toBe("vio");
    expect(hyphenatedJoin("ac\u00ADtual", "")).toBeNull();
    expect(hyphenatedJoin("vio\u00AD", "lentar")).toBe("vio");
    expect(hyphenatedJoin("for\u2010", "taleza")).toBe("for");
  });

  it("keeps the hyphen between two digits, as a range", () => {
    expect(hyphenatedJoin("19-", "20")).toBe("19-");
    expect(hyphenatedJoin("19\u2010", "20")).toBe("19-");
  });

  it("keeps the line break when the next word is not a continuation", () => {
    expect(hyphenatedJoin("for-", "Taleza")).toBeNull();
    expect(hyphenatedJoin("for-", "12")).toBeNull();
    expect(hyphenatedJoin("19-", "Lucas")).toBeNull();
    expect(hyphenatedJoin("Rosa-", "maría")).toBe("Rosa");
    expect(hyphenatedJoin("casa", "de")).toBeNull();
    expect(hyphenatedJoin("-", "de")).toBeNull();
  });
});

describe("copyTextOf with hyphenated line ends", () => {
  it("joins a word split at a line end with the next line, in the text and in the clipboard", () => {
    const hyphen = [
      word("hoy", 0),
      word("nos", 30),
      word("llena", 60),
      word("de", 100),
      word("for-", 130, true),
      word("taleza", 0),
      word("y", 40),
      word("vida", 60, true, true),
    ];
    const all = hyphen.map((_, index) => ({ index, from: 0, to: hyphen[index]!.text.length }));
    expect(copyTextOf(hyphen, all)).toBe("hoy nos llena de fortaleza y vida");
  });

  it("keeps the hyphen of a range that breaks between two numbers", () => {
    const range = [word("Lucas", 0), word("(22,19-", 30, true), word("20)", 0)];
    const all = range.map((_, index) => ({ index, from: 0, to: range[index]!.text.length }));
    expect(copyTextOf(range, all)).toBe("Lucas (22,19-20)");
  });

  it("still breaks a line where the next word starts with a capital", () => {
    const names = [word("Rosa-", 0, true), word("María", 0)];
    const all = names.map((_, index) => ({ index, from: 0, to: names[index]!.text.length }));
    expect(copyTextOf(names, all)).toBe("Rosa-\nMaría");
  });

  it("does not join across a block end", () => {
    const block = [word("for-", 0, true, true), word("taleza", 0)];
    const all = block.map((_, index) => ({ index, from: 0, to: block[index]!.text.length }));
    expect(copyTextOf(block, all)).toBe("for-\n\ntaleza");
  });

  it("joins a slice cut mid-word at the end of the selection", () => {
    const hyphen = [word("for-", 0, true), word("taleza", 0)];
    expect(
      copyTextOf(hyphen, [
        { index: 0, from: 0, to: 4 },
        { index: 1, from: 0, to: 3 },
      ]),
    ).toBe("fortal");
  });
});
