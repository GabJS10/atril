import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Highlight, OpenedDocument, TextWord } from "../../api/types";
import type { ViewerHandle, ViewSnapshot } from "../viewerTypes";
import { NativeViewer, type NativeViewerProps } from "./NativeViewer";

const VIEWPORT = { width: 800, height: 600 };
const BASE = "atril://localhost/page/abc";

/** `count` pages of 400 x 600 points (about 533 x 800 CSS px at 100 %). */
function makeDocument(count: number): OpenedDocument {
  return {
    pageCount: count,
    pageBaseUrl: BASE,
    pages: Array.from({ length: count }, () => ({
      width: 400,
      height: 600,
      transform: [1, 0, 0, -1, 0, 600] as [number, number, number, number, number, number],
    })),
  };
}

let scrollTops = new WeakMap<Element, number>();

beforeEach(() => {
  vi.useFakeTimers();
  scrollTops = new WeakMap();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return this.classList.contains("atril-native-viewer") ? VIEWPORT.width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return this.classList.contains("atril-native-viewer") ? VIEWPORT.height : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get() {
      return scrollTops.get(this) ?? 0;
    },
    set(value: number) {
      scrollTops.set(this, Math.max(0, value));
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollBy", {
    configurable: true,
    value(this: HTMLElement, options: { top: number }) {
      this.scrollTop += options.top;
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // @ts-expect-error restoring the jsdom defaults
  delete HTMLElement.prototype.clientWidth;
  // @ts-expect-error restoring the jsdom defaults
  delete HTMLElement.prototype.clientHeight;
  // @ts-expect-error restoring the jsdom defaults
  delete HTMLElement.prototype.scrollTop;
});

type Setup = {
  unmount: () => void;
  handle: React.RefObject<ViewerHandle | null>;
  container: HTMLElement;
  onChange: ReturnType<typeof vi.fn>;
  onRestored: ReturnType<typeof vi.fn>;
  pages: () => number[];
  images: (page: number) => HTMLImageElement[];
  rerender: (props: Partial<NativeViewerProps>) => void;
};

function setup(count: number, props: Partial<NativeViewerProps> = {}): Setup {
  const handle = createRef<ViewerHandle>();
  const onChange = vi.fn();
  const onRestored = vi.fn();
  const doc = makeDocument(count);
  const full = (extra: Partial<NativeViewerProps>): NativeViewerProps => ({
    bookId: "abc",
    document: doc,
    start: { zoom: 1, position: null },
    onChange,
    onRestored,
    highlights: [],
    onSelectionEnd: vi.fn(),
    onSelectionClear: vi.fn(),
    onHighlightPress: vi.fn(),
    onFindResult: vi.fn(),
    ...extra,
  });
  const view = render(<NativeViewer ref={handle} {...full(props)} />);
  // Layout effects, then the two frames before the restore is reported.
  act(() => {
    vi.advanceTimersByTime(100);
  });
  const container = view.container.querySelector<HTMLElement>(".atril-native-viewer")!;
  return {
    unmount: view.unmount,
    handle,
    container,
    onChange,
    onRestored,
    pages: () =>
      Array.from(container.querySelectorAll<HTMLElement>(".atril-native-page")).map((element) =>
        Number(element.dataset.pageNumber),
      ),
    images: (page) =>
      Array.from(
        container.querySelectorAll<HTMLImageElement>(`[data-page-number="${page}"] .atril-page-image`),
      ),
    rerender: (extra) => view.rerender(<NativeViewer ref={handle} {...full({ ...props, ...extra })} />),
  };
}

const scrollTo = (container: HTMLElement, top: number) => {
  act(() => {
    container.scrollTop = top;
    fireEvent.scroll(container);
    vi.advanceTimersByTime(20);
  });
};

const frontUrl = (images: HTMLImageElement[]) =>
  images.find((image) => image.dataset.front === "true")?.getAttribute("src") ?? null;

describe("NativeViewer virtualization", () => {
  it("knows the height of the whole book from the first frame and mounts only the pages in view", () => {
    const { container, pages } = setup(4000);
    const sizer = container.querySelector<HTMLElement>(".atril-native-sizer")!;
    // Zoom 1 = 4/3 CSS px per point: 800 px per page plus the 10 px gap.
    expect(Number.parseFloat(sizer.style.height)).toBeCloseTo(4000 * 800 + 3999 * 10, 0);
    expect(pages().length).toBeLessThanOrEqual(4);
    expect(pages()[0]).toBe(1);
  });

  it("gives the placeholders their exact size and position", () => {
    const { container } = setup(10, { start: { zoom: 1, position: null } });
    const second = container.querySelector<HTMLElement>('[data-page-number="2"]')!;
    expect(second.style.top).toBe("810px");
    expect(second.style.width).toBe("533px");
    expect(second.style.height).toBe("800px");
  });

  it("requests the page images at zoom x device pixel ratio, in hundredths", () => {
    const { images } = setup(10, { start: { zoom: 1.5, position: null } });
    expect(images(1)[0]?.getAttribute("src")).toBe(`${BASE}/1?scale=2`);
  });

  it("restores the saved position before showing the view", () => {
    const { container, onRestored, pages } = setup(4000, {
      start: { zoom: 1, position: { page: 2500, offsetInPage: 0.5 } },
    });
    expect(container.scrollTop).toBeCloseTo(2499 * 810 + 400, 0);
    expect(pages()).toContain(2500);
    expect(pages()).not.toContain(1);
    expect(onRestored).toHaveBeenCalledTimes(1);
    const snapshot = onRestored.mock.calls[0]![0] as ViewSnapshot;
    expect(snapshot.position.page).toBe(2500);
    expect(snapshot.position.offsetInPage).toBeCloseTo(0.5, 2);
    expect(snapshot.zoom).toBe(1);
  });

  it("drops the pages (and their images) that leave the view, and mounts the new ones", () => {
    const { container, pages, images } = setup(100);
    expect(images(1)).toHaveLength(2);
    scrollTo(container, 50 * 810);
    expect(pages()).not.toContain(1);
    expect(pages()).toContain(51);
    expect(pages().length).toBeLessThanOrEqual(4);
    expect(images(1)).toHaveLength(0);
  });

  it("reports the position while scrolling, and only after the restore", () => {
    const { container, onChange } = setup(100);
    onChange.mockClear();
    scrollTo(container, 10 * 810 + 400);
    const snapshot = onChange.mock.calls.at(-1)![0] as ViewSnapshot;
    expect(snapshot.position.page).toBe(11);
    expect(snapshot.position.offsetInPage).toBeCloseTo(0.5, 2);
  });

  it("asks for the destination first on a jump (go to page), without waiting", () => {
    const { handle, pages, images, container } = setup(4000);
    act(() => handle.current!.goToPage(3000));
    expect(container.scrollTop).toBeCloseTo(2999 * 810, 0);
    expect(pages()).toContain(3000);
    expect(images(3000)[0]?.getAttribute("src")).toBe(`${BASE}/3000?scale=1.33`);
    expect(images(3000)[0]?.getAttribute("fetchpriority")).toBe("high");
  });

  it("waits for the view to stop before loading images after a drag of the scroll bar", () => {
    const { container, images } = setup(4000);
    act(() => {
      container.scrollTop = 2000 * 810;
      fireEvent.scroll(container);
      vi.advanceTimersByTime(20);
    });
    expect(images(2001).filter((image) => image.hasAttribute("src"))).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(images(2001)[0]?.getAttribute("src")).toContain("/2001?scale=");
  });

  it("scrolls to a whole pixel at or below the top of the page, so the bar does not say the page before", () => {
    // 1.1234 makes the page tops fractional; browsers keep scrollTop whole and a rounded-down top reads as page n-1.
    const { handle, container, onChange } = setup(100, { start: { zoom: 1.1234, position: null } });
    onChange.mockClear();
    act(() => handle.current!.goToPage(5));
    expect(Number.isInteger(container.scrollTop)).toBe(true);
    expect((onChange.mock.calls.at(-1)![0] as ViewSnapshot).position.page).toBe(5);
    act(() => handle.current!.turnPage(1));
    expect(Number.isInteger(container.scrollTop)).toBe(true);
    expect((onChange.mock.calls.at(-1)![0] as ViewSnapshot).position.page).toBe(6);
  });

  it("turns pages and scrolls from the DOM position", () => {
    const { handle, container } = setup(100);
    act(() => handle.current!.turnPage(1));
    expect(container.scrollTop).toBeCloseTo(810, 0);
    act(() => handle.current!.turnPage(1));
    act(() => handle.current!.turnPage(-1));
    expect(container.scrollTop).toBeCloseTo(810, 0);
    act(() => handle.current!.scrollLines(1));
    expect(container.scrollTop).toBeCloseTo(890, 0);
    act(() => handle.current!.scrollPages(-1));
    expect(container.scrollTop).toBeCloseTo(350, 0);
    act(() => handle.current!.turnPage(-1));
    act(() => handle.current!.turnPage(-1));
    expect(container.scrollTop).toBe(0);
  });
});

describe("NativeViewer zoom", () => {
  it("resizes the pages at once and loads the sharp image only when the zoom settles", () => {
    const { handle, images, container } = setup(10);
    act(() => {
      images(1)[0]!.dispatchEvent(new Event("load"));
    });
    const before = frontUrl(images(1));
    expect(before).toBe(`${BASE}/1?scale=1.33`);

    act(() => handle.current!.stepZoom(1)); // 100 % -> 125 %
    const page = container.querySelector<HTMLElement>('[data-page-number="1"]')!;
    expect(page.style.width).toBe("667px"); // 400 x 1.25 x 4/3, at once
    expect(frontUrl(images(1))).toBe(before);
    expect(images(1).filter((image) => image.getAttribute("src")?.includes("scale=1.67"))).toHaveLength(0);

    // Another step before the pause: still no request for the intermediate scale.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => handle.current!.stepZoom(1)); // 125 % -> 150 %
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(images(1).filter((image) => image.getAttribute("src")?.includes("scale=1.67"))).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(60);
    });
    const loading = images(1).find((image) => image.dataset.front === "false")!;
    expect(loading.getAttribute("src")).toBe(`${BASE}/1?scale=2`);
    // The old image stays on screen until the new one has loaded: no blank page in between.
    expect(frontUrl(images(1))).toBe(`${BASE}/1?scale=1.33`);

    act(() => {
      loading.dispatchEvent(new Event("load"));
    });
    expect(frontUrl(images(1))).toBe(`${BASE}/1?scale=2`);
    // The image that was on screen is released.
    expect(images(1).filter((image) => image.hasAttribute("src"))).toHaveLength(1);
  });

  it("keeps the point at the centre of the view while zooming with the buttons", () => {
    const { handle, container } = setup(100, {
      start: { zoom: 1, position: { page: 20, offsetInPage: 0.3 } },
    });
    // Pages are 800 x zoom CSS px high plus a 10 px gap.
    const centre = (zoom: number) => {
      const y = container.scrollTop + VIEWPORT.height / 2;
      const index = Math.floor(y / (800 * zoom + 10));
      return { index, fraction: (y - index * (800 * zoom + 10)) / (800 * zoom) };
    };
    const before = centre(1);
    act(() => handle.current!.stepZoom(1));
    const after = centre(1.25);
    expect(after.index).toBe(before.index);
    expect(after.fraction).toBeCloseTo(before.fraction, 1);
  });

  it("zooms around the pointer with Ctrl + wheel and leaves a plain wheel alone", () => {
    const { container, onChange } = setup(100, {
      start: { zoom: 1, position: { page: 10, offsetInPage: 0 } },
    });
    container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const plain = new WheelEvent("wheel", { deltaY: -50, bubbles: true, cancelable: true });
    container.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);

    onChange.mockClear();
    const before = container.scrollTop;
    const zoom = new WheelEvent("wheel", {
      deltaY: -50,
      ctrlKey: true,
      clientX: 400,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      container.dispatchEvent(zoom);
    });
    expect(zoom.defaultPrevented).toBe(true);
    const snapshot = onChange.mock.calls.at(-1)![0] as ViewSnapshot;
    expect(snapshot.scale).toBeGreaterThan(1);
    expect(snapshot.zoom as number).toBeCloseTo(snapshot.scale, 3);
    // Zooming in at 100 px from the top moves the content down: the top of the view stays near page 10.
    expect(container.scrollTop).toBeGreaterThan(before);
  });

  it("applies the preset zoom to the window width and follows it saving the preset's name", () => {
    const { onRestored, container } = setup(10, { start: { zoom: "page_width", position: null } });
    const snapshot = onRestored.mock.calls[0]![0] as ViewSnapshot;
    expect(snapshot.zoom).toBe("page_width");
    const page = container.querySelector<HTMLElement>('[data-page-number="1"]')!;
    expect(page.style.width).toBe("800px");
  });

  it("fits the whole page", () => {
    const { container } = setup(10, { start: { zoom: "page_fit", position: null } });
    const page = container.querySelector<HTMLElement>('[data-page-number="1"]')!;
    expect(page.style.height).toBe("600px");
  });
});

describe("NativeViewer images", () => {
  it("asks again when a page image fails with 410 and the page is still in view", async () => {
    const created = vi.fn(() => "blob:page-1");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const responses = [
      new Response(null, { status: 410 }),
      new Response(new Blob(["jpeg"]), { status: 200 }),
    ];
    const fetchMock = vi.fn(() => Promise.resolve(responses.shift()!));
    vi.stubGlobal("fetch", fetchMock);
    const { images } = setup(5);
    // setup() runs the component under fake timers; this test needs real ones for the retry pause.
    vi.useRealTimers();
    act(() => {
      images(1)[0]!.dispatchEvent(new Event("error"));
    });
    await vi.waitFor(() => expect(created).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(images(1)[0]?.getAttribute("src")).toBe("blob:page-1");
  });

  it("paints the saved highlights over the pages with the transform of the engine", () => {
    const highlight: Highlight = {
      id: "h1",
      bookId: "abc",
      page: 1,
      rects: [[40, 540, 240, 560]], // PDF space, origin bottom-left, on a 400 x 600 page
      text: "x",
      color: "ochre",
      note: null,
      createdAt: "",
      updatedAt: "",
    };
    const { container } = setup(5, { highlights: [highlight] });
    const element = container.querySelector<HTMLElement>('[data-page-number="1"] .atril-highlight')!;
    expect(element.dataset.highlightId).toBe("h1");
    expect(Number.parseFloat(element.style.left)).toBeCloseTo(10, 6);
    expect(Number.parseFloat(element.style.top)).toBeCloseTo((40 / 600) * 100, 6);
    expect(Number.parseFloat(element.style.width)).toBeCloseTo(50, 6);
  });
});

// R2.2: text, selection, links, search and index of the native engine, through the mocked IPC of docs/IPC.md.
describe("NativeViewer text, links and search", () => {
  const WORDS: TextWord[] = [
    { text: "Hola", rect: [50, 100, 90, 112], lineEnd: false, blockEnd: false },
    { text: "mundo", rect: [95, 100, 140, 112], lineEnd: true, blockEnd: false },
    { text: "Adiós", rect: [50, 115, 90, 127], lineEnd: true, blockEnd: true },
  ];
  type Call = { cmd: string; args: Record<string, unknown> };
  let calls: Call[];

  function install(handlers: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
    calls = [];
    mockIPC(
      (cmd, payload) => {
        const args = (payload ?? {}) as Record<string, unknown>;
        calls.push({ cmd, args });
        if (handlers[cmd]) return handlers[cmd](args);
        if (cmd === "get_page_text") return WORDS;
        if (cmd === "get_page_links") return [];
        return null;
      },
      { shouldMockEvents: true },
    );
  }
  const called = (cmd: string) => calls.filter((call) => call.cmd === cmd);
  /** Lets the IPC answers (promises) land, with the fake timers on. */
  const settle = async (ms = 0) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const wordsOf = (container: HTMLElement, page: number) =>
    Array.from(container.querySelectorAll<HTMLElement>(`[data-page-number="${page}"] .atril-text-word`));

  beforeEach(() => {
    // jsdom has no layout for ranges; the viewer only needs a box to anchor the toolbar.
    Range.prototype.getBoundingClientRect = () => new DOMRect(10, 10, 100, 12);
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  });

  it("asks for the text of the pages in view and one on each side, and for no other", async () => {
    install();
    const { container } = setup(100);
    await settle();
    const first = called("get_page_text").map((call) => call.args.page);
    expect(first).toEqual(expect.arrayContaining([1, 2]));
    expect(first.every((page) => (page as number) <= 3)).toBe(true);
    expect(called("get_page_text").every((call) => call.args.bookId === "abc")).toBe(true);
    expect(wordsOf(container, 1)).toHaveLength(3);

    scrollTo(container, 50 * 810);
    await settle(200);
    const later = called("get_page_text")
      .map((call) => call.args.page as number)
      .filter((page) => page > 3);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((page) => page >= 50 && page <= 53)).toBe(true);
    expect(called("get_page_text").some((call) => call.args.page === 30)).toBe(false);
    // The page that left the view lost its words with its slot.
    expect(wordsOf(container, 1)).toHaveLength(0);
  });

  it("asks once for a page even when it is mounted again, and keeps going when a request fails", async () => {
    install({
      get_page_text: (args) => {
        if (args.page === 2) throw { code: "internal", message: "boom" };
        return WORDS;
      },
    });
    const { container } = setup(100);
    await settle();
    expect(wordsOf(container, 1)).toHaveLength(3);
    expect(wordsOf(container, 2)).toHaveLength(0);
    scrollTo(container, 10 * 810);
    await settle(200);
    scrollTo(container, 0);
    await settle(200);
    expect(called("get_page_text").filter((call) => call.args.page === 1)).toHaveLength(1);
    expect(wordsOf(container, 1)).toHaveLength(3);
  });

  it("draws the words in points under a transform that follows the zoom without asking again", async () => {
    install();
    const { container, handle } = setup(10);
    await settle();
    const overlay = container.querySelector<HTMLElement>('[data-page-number="1"] .atril-page-overlay')!;
    expect(overlay.style.width).toBe("400px");
    expect(overlay.style.height).toBe("600px");
    expect(overlay.style.transform).toBe(`scale(${4 / 3})`);
    const word = wordsOf(container, 1)[0]!;
    expect(word.style.left).toBe("50px");
    expect(word.style.top).toBe("100px");
    expect(word.style.height).toBe("12px");
    const requests = called("get_page_text").length;

    act(() => handle.current!.stepZoom(1)); // 100 % -> 125 %
    expect(overlay.style.transform).toBe(`scale(${(4 / 3) * 1.25})`);
    await settle(400);
    expect(called("get_page_text")).toHaveLength(requests);
  });

  it("turns a selection into highlight parts when the mouse is released", async () => {
    install();
    const onSelectionEnd = vi.fn();
    const onSelectionClear = vi.fn();
    const { container } = setup(10, { onSelectionEnd, onSelectionClear });
    await settle();
    const spans = wordsOf(container, 1);
    window.getSelection()!.setBaseAndExtent(spans[0]!.firstChild!, 0, spans[2]!.firstChild!, 5);

    fireEvent.mouseUp(container, { clientX: 20, clientY: 20 });
    await settle();

    expect(onSelectionClear).not.toHaveBeenCalled();
    expect(onSelectionEnd).toHaveBeenCalledTimes(1);
    const [parts, anchor] = onSelectionEnd.mock.calls[0]!;
    expect(anchor).toBeInstanceOf(DOMRect);
    expect(parts).toHaveLength(1);
    expect(parts[0].page).toBe(1);
    expect(parts[0].text).toBe("Hola mundo Adiós");
    expect(parts[0].copyText).toBe("Hola mundo\nAdiós");
    // View space (y down) to PDF space (origin bottom-left) on a 600 pt page.
    expect(parts[0].rects).toEqual([
      [50, 488, 140, 500],
      [50, 473, 90, 485],
    ]);
  });

  it("clears the selection toolbar on a plain click", async () => {
    install();
    const onSelectionEnd = vi.fn();
    const onSelectionClear = vi.fn();
    const { container } = setup(10, { onSelectionEnd, onSelectionClear });
    await settle();
    window.getSelection()!.removeAllRanges();
    fireEvent.mouseUp(container, { clientX: 5, clientY: 5 });
    await settle();
    expect(onSelectionEnd).not.toHaveBeenCalled();
    expect(onSelectionClear).toHaveBeenCalledTimes(1);
  });

  it("copies the words with the line and block breaks of the page", async () => {
    install();
    const { container } = setup(10);
    await settle();
    const spans = wordsOf(container, 1);
    window.getSelection()!.setBaseAndExtent(spans[0]!.firstChild!, 0, spans[2]!.firstChild!, 5);
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });

    spans[0]!.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith("text/plain", "Hola mundo\nAdiós");
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a copy alone when nothing of the text layer is selected", async () => {
    install();
    const { container } = setup(10);
    await settle();
    window.getSelection()!.removeAllRanges();
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    container.dispatchEvent(event);
    expect(setData).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  const boxOf = (left: number, top: number, width: number, height: number) =>
    ({ left, top, right: left + width, bottom: top + height, width, height }) as DOMRect;

  /** Gives the first page and its link a place on screen (jsdom has no layout) and clicks in the middle of the link. */
  function clickLink(container: HTMLElement) {
    const page = container.querySelector<HTMLElement>('[data-page-number="1"]')!;
    page.getBoundingClientRect = () => boxOf(0, 0, 533, 800);
    const link = page.querySelector<HTMLElement>(".atril-link")!;
    link.getBoundingClientRect = () => boxOf(100, 100, 50, 20);
    fireEvent.mouseDown(container, { clientX: 120, clientY: 110 });
    fireEvent.mouseUp(container, { clientX: 120, clientY: 110 });
  }

  it("follows an internal link to its page and height", async () => {
    install({
      get_page_links: (args) =>
        args.page === 1 ? [{ rect: [75, 75, 112, 90], target: { page: 5, y: 150 } }] : [],
    });
    const onSelectionClear = vi.fn();
    const { container } = setup(10, { onSelectionClear });
    await settle();
    expect(container.querySelectorAll('[data-page-number="1"] .atril-link')).toHaveLength(1);

    clickLink(container);
    await settle();

    // Page 5 starts at 4 x 810; y = 150 pt = 200 px, less the margin of 24 px.
    expect(container.scrollTop).toBe(4 * 810 + 200 - 24);
    expect(called("plugin:opener|open_url")).toHaveLength(0);
  });

  it("opens an external link outside the app", async () => {
    install({
      get_page_links: (args) =>
        args.page === 1 ? [{ rect: [75, 75, 112, 90], target: { uri: "https://example.org/libro" } }] : [],
    });
    const first = setup(10);
    await settle();
    clickLink(first.container);
    await settle();
    expect(called("plugin:opener|open_url").map((call) => call.args.url)).toEqual([
      "https://example.org/libro",
    ]);
    expect(first.container.scrollTop).toBe(0);
  });

  it("does not follow a link when the press and the release are far apart (a drag)", async () => {
    install({
      get_page_links: (args) =>
        args.page === 1 ? [{ rect: [75, 75, 112, 90], target: { page: 5, y: null } }] : [],
    });
    const { container } = setup(10);
    await settle();
    const page = container.querySelector<HTMLElement>('[data-page-number="1"]')!;
    page.getBoundingClientRect = () => boxOf(0, 0, 533, 800);
    page.querySelector<HTMLElement>(".atril-link")!.getBoundingClientRect = () => boxOf(100, 100, 50, 20);
    fireEvent.mouseDown(container, { clientX: 20, clientY: 20 });
    fireEvent.mouseUp(container, { clientX: 120, clientY: 110 });
    await settle();
    expect(container.scrollTop).toBe(0);
  });

  it("goes to a page and height of the index", async () => {
    install();
    const { container, handle } = setup(10);
    await settle();
    act(() => handle.current!.goToDestination({ page: 3, y: 300 }));
    expect(container.scrollTop).toBe(2 * 810 + 400 - 24);
    // Destinations of pdf.js mean nothing here.
    act(() => handle.current!.goToDestination("cap2"));
    act(() => handle.current!.goToDestination([0, { name: "XYZ" }]));
    expect(container.scrollTop).toBe(2 * 810 + 400 - 24);
  });

  describe("search", () => {
    const hitsOf = (container: HTMLElement, page: number) =>
      Array.from(container.querySelectorAll<HTMLElement>(`[data-page-number="${page}"] .atril-search-hit`));

    it("marks every match as a share of the page, tells the active one apart and follows the zoom", async () => {
      install({ search_document: () => ({ searchId: "s1" }) });
      const onFindResult = vi.fn();
      const { container, handle } = setup(10, { onFindResult });
      await settle();

      act(() => handle.current!.find("hola"));
      await settle(150);
      expect(called("search_document")).toEqual([
        { cmd: "search_document", args: { bookId: "abc", query: "hola" } },
      ]);

      await act(async () => {
        await emit("search://progress", {
          searchId: "s1",
          page: 1,
          matches: [{ rects: [[40, 60, 240, 120]] }, { rects: [[40, 300, 140, 330]] }],
        });
        await emit("search://progress", {
          searchId: "ignored",
          page: 1,
          matches: [{ rects: [[0, 0, 1, 1]] }],
        });
      });
      await settle(200);

      const hits = hitsOf(container, 1);
      expect(hits).toHaveLength(2);
      expect(Number.parseFloat(hits[0]!.style.left)).toBeCloseTo(10, 6);
      expect(Number.parseFloat(hits[0]!.style.top)).toBeCloseTo(10, 6);
      expect(Number.parseFloat(hits[0]!.style.width)).toBeCloseTo(50, 6);
      expect(hits[0]!.dataset.active).toBe("true");
      expect(hits[1]!.dataset.active).toBeUndefined();
      expect(onFindResult).toHaveBeenLastCalledWith({ current: 1, total: 2, notFound: false });

      act(() => handle.current!.stepZoom(1));
      expect(hitsOf(container, 1)).toHaveLength(2);
      expect(hitsOf(container, 1)[0]!.style.left).toBe(hits[0]!.style.left);

      await act(async () => {
        await emit("search://done", {
          searchId: "s1",
          total: 2,
          pagesSearched: 10,
          cancelled: false,
          error: null,
        });
      });
      act(() => handle.current!.find("hola", { again: true }));
      expect(hitsOf(container, 1)[1]!.dataset.active).toBe("true");
      expect(onFindResult).toHaveBeenLastCalledWith({ current: 2, total: 2, notFound: false });
    });

    it("jumps to the page of the active match", async () => {
      install({ search_document: () => ({ searchId: "s1" }) });
      const { container, handle } = setup(30);
      await settle();
      act(() => handle.current!.find("hola"));
      await settle(150);

      await act(async () => {
        await emit("search://progress", {
          searchId: "s1",
          page: 20,
          matches: [{ rects: [[40, 60, 240, 120]] }],
        });
      });
      await settle(200);

      // The match is 60 pt (80 px) down page 20, which starts at 19 x 810: it is put a third of the view from the top.
      expect(container.scrollTop).toBe(Math.ceil(19 * 810 + 80 - VIEWPORT.height / 3));
      expect(hitsOf(container, 20)).toHaveLength(1);
    });

    it("cancels the search and clears the marks when the query is emptied, and when the viewer closes", async () => {
      install({ search_document: () => ({ searchId: "s1" }) });
      const onFindResult = vi.fn();
      const { container, handle, unmount } = setup(10, { onFindResult });
      await settle();
      act(() => handle.current!.find("hola"));
      await settle(150);
      await act(async () => {
        await emit("search://progress", {
          searchId: "s1",
          page: 1,
          matches: [{ rects: [[40, 60, 240, 120]] }],
        });
      });
      await settle(200);
      expect(hitsOf(container, 1)).toHaveLength(1);

      act(() => handle.current!.find(""));
      await settle();
      expect(called("cancel_search")).toEqual([{ cmd: "cancel_search", args: { searchId: "s1" } }]);
      expect(hitsOf(container, 1)).toHaveLength(0);
      expect(onFindResult).toHaveBeenLastCalledWith({ current: 0, total: 0, notFound: false });

      act(() => handle.current!.find("mundo"));
      await settle(150);
      unmount();
      await settle();
      expect(called("cancel_search")).toHaveLength(2);
    });

    it("does not touch the backend when an empty query is sent and no search ever ran", async () => {
      install();
      const { handle } = setup(10);
      await settle();
      act(() => handle.current!.find(""));
      await settle();
      expect(called("search_document")).toHaveLength(0);
      expect(called("cancel_search")).toHaveLength(0);
    });
  });
});
