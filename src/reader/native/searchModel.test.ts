import { describe, expect, it } from "vitest";
import type { ViewRect } from "../../api/types";
import { rectToPercent, SearchResults, stepMatch } from "./searchModel";

const rect = (n: number): ViewRect => [n, n, n + 1, n + 1];
const match = (n: number) => [rect(n)];

function results() {
  const found = new SearchResults();
  found.add(3, [match(1), match(2)]);
  found.add(7, [match(3)]);
  found.add(9, [match(4), match(5), match(6)]);
  return found;
}

describe("SearchResults", () => {
  it("numbers the matches across pages in the order they came", () => {
    const found = results();
    expect(found.total).toBe(6);
    expect(found.at(0)).toEqual({ page: 3, ordinal: 0, rects: match(1) });
    expect(found.at(2)).toEqual({ page: 7, ordinal: 0, rects: match(3) });
    expect(found.at(5)).toEqual({ page: 9, ordinal: 2, rects: match(6) });
    expect(found.at(6)).toBeNull();
    expect(found.at(-1)).toBeNull();
  });

  it("gives the matches of a page, or none", () => {
    const found = results();
    expect(found.onPage(9)).toHaveLength(3);
    expect(found.onPage(8)).toEqual([]);
  });

  it("finds the first match on or after a page", () => {
    const found = results();
    expect(found.firstFrom(1)).toBe(0);
    expect(found.firstFrom(3)).toBe(0);
    expect(found.firstFrom(4)).toBe(2);
    expect(found.firstFrom(8)).toBe(3);
    expect(found.firstFrom(10)).toBeNull();
    expect(new SearchResults().firstFrom(1)).toBeNull();
  });

  it("ignores a page that is not after the last one and a page without matches", () => {
    const found = results();
    found.add(9, [match(9)]);
    found.add(2, [match(9)]);
    found.add(11, []);
    expect(found.total).toBe(6);
  });

  it("keeps the number of a match when later pages arrive", () => {
    const found = new SearchResults();
    found.add(2, [match(1)]);
    const before = found.at(0);
    found.add(5, [match(2), match(3)]);
    expect(found.at(0)).toEqual(before);
  });

  it("handles many pages", () => {
    const found = new SearchResults();
    for (let page = 1; page <= 4000; page += 2) found.add(page, [match(page), match(page)]);
    expect(found.total).toBe(4000);
    expect(found.at(3999)?.page).toBe(3999);
    expect(found.at(1234)).toMatchObject({ page: 1235, ordinal: 0 });
    expect(found.firstFrom(2000)).toBe(2000);
  });
});

describe("stepMatch", () => {
  it("goes forward and back, wrapping around the ends", () => {
    expect(stepMatch(0, 1, 3)).toBe(1);
    expect(stepMatch(2, 1, 3)).toBe(0);
    expect(stepMatch(0, -1, 3)).toBe(2);
    expect(stepMatch(1, -1, 3)).toBe(0);
  });

  it("starts at the first or the last match when none is in focus", () => {
    expect(stepMatch(null, 1, 4)).toBe(0);
    expect(stepMatch(null, -1, 4)).toBe(3);
  });

  it("is null when there is nothing to step to", () => {
    expect(stepMatch(null, 1, 0)).toBeNull();
    expect(stepMatch(0, 1, 0)).toBeNull();
  });
});

describe("rectToPercent", () => {
  it("expresses a box as percentages of the page, which hold at any zoom", () => {
    expect(rectToPercent([40, 60, 240, 120], 400, 600)).toEqual({ left: 10, top: 10, width: 50, height: 10 });
  });
});
