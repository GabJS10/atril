import { describe, expect, it, vi } from "vitest";
import type { PageLink } from "../../api/types";
import { followLink, isOpenableUri, linkAt, linkAttributes, targetOfElement } from "./links";

function elementFor(link: PageLink): HTMLElement {
  const element = document.createElement("div");
  for (const [name, value] of Object.entries(linkAttributes(link))) element.setAttribute(name, value);
  return element;
}

describe("link attributes", () => {
  it("round-trips an internal link with and without a height", () => {
    const withY = elementFor({ rect: [0, 0, 1, 1], target: { page: 12, y: 99.5 } });
    expect(targetOfElement(withY)).toEqual({ page: 12, y: 99.5 });
    const withoutY = elementFor({ rect: [0, 0, 1, 1], target: { page: 3, y: null } });
    expect(targetOfElement(withoutY)).toEqual({ page: 3, y: null });
  });

  it("round-trips an external link", () => {
    const element = elementFor({ rect: [0, 0, 1, 1], target: { uri: "https://example.org/a?b=1" } });
    expect(targetOfElement(element)).toEqual({ uri: "https://example.org/a?b=1" });
  });

  it("gives null for an element that holds no usable target", () => {
    expect(targetOfElement(document.createElement("div"))).toBeNull();
    const bad = document.createElement("div");
    bad.dataset.targetPage = "0";
    expect(targetOfElement(bad)).toBeNull();
    bad.dataset.targetPage = "x";
    expect(targetOfElement(bad)).toBeNull();
  });
});

describe("isOpenableUri", () => {
  it("opens http, https and mailto only", () => {
    expect(isOpenableUri("http://example.org")).toBe(true);
    expect(isOpenableUri("https://example.org/x")).toBe(true);
    expect(isOpenableUri("mailto:a@b.org")).toBe(true);
    expect(isOpenableUri("file:///etc/passwd")).toBe(false);
    expect(isOpenableUri("javascript:alert(1)")).toBe(false);
    expect(isOpenableUri("ftp://example.org")).toBe(false);
    expect(isOpenableUri("not a url")).toBe(false);
    expect(isOpenableUri("")).toBe(false);
  });
});

describe("followLink", () => {
  it("scrolls the book for an internal link and opens an allowed external one outside", () => {
    const goTo = vi.fn();
    const openExternal = vi.fn();
    followLink({ page: 4, y: 10 }, { goTo, openExternal });
    followLink({ uri: "https://example.org" }, { goTo, openExternal });
    expect(goTo).toHaveBeenCalledWith({ page: 4, y: 10 });
    expect(openExternal).toHaveBeenCalledWith("https://example.org");
  });

  it("refuses an external scheme the reader does not open", () => {
    const goTo = vi.fn();
    const openExternal = vi.fn();
    followLink({ uri: "file:///etc/passwd" }, { goTo, openExternal });
    followLink({ uri: "javascript:alert(1)" }, { goTo, openExternal });
    expect(goTo).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe("linkAt", () => {
  const box = (left: number, top: number, width: number, height: number) =>
    ({ left, top, right: left + width, bottom: top + height, width, height }) as DOMRect;

  it("finds the link under a point, only on the page the point is over", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div class="page" data-page-number="1"><div class="atril-link" id="a"></div></div>
      <div class="page" data-page-number="2"><div class="atril-link" id="b"></div></div>`;
    const [one, two] = Array.from(container.querySelectorAll<HTMLElement>(".page"));
    one!.getBoundingClientRect = () => box(0, 0, 100, 100);
    two!.getBoundingClientRect = () => box(0, 110, 100, 100);
    container.querySelector<HTMLElement>("#a")!.getBoundingClientRect = () => box(10, 10, 20, 10);
    // Overlaps the box of `a` in client space, but sits on the other page: it must not answer for page 1.
    container.querySelector<HTMLElement>("#b")!.getBoundingClientRect = () => box(10, 120, 20, 10);

    expect(linkAt(container, 15, 15)?.id).toBe("a");
    expect(linkAt(container, 15, 125)?.id).toBe("b");
    expect(linkAt(container, 80, 15)).toBeNull();
    expect(linkAt(container, 15, 105)).toBeNull();
  });
});
