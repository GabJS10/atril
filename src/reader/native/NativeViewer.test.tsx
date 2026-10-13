import { act, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Highlight, OpenedDocument } from "../../api/types";
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
