import { afterEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../api/types";
import { beginBookPress, DRAG_THRESHOLD, hasMovedEnough, roomIdAt, useBookDragStore } from "./bookDrag";

function book(id: string, overrides: Partial<Book> = {}): Book {
  return {
    id,
    title: `Libro ${id}`,
    author: null,
    fileName: `${id}.pdf`,
    pageCount: 10,
    fileUrl: `atril://localhost/book/${id}`,
    coverUrl: null,
    coverColor: null,
    favorite: false,
    missing: false,
    scanState: "done",
    currentPage: null,
    progress: null,
    addedAt: "2026-10-11T12:00:00Z",
    lastOpenedAt: null,
    ...overrides,
  };
}

/** A Sala element, as the Salas section renders it. */
function room(id: string): Element {
  const element = document.createElement("a");
  element.dataset.roomId = id;
  element.innerHTML = "<span>Filosofía</span>";
  return element;
}

const ORIGIN = { clientX: 100, clientY: 100, button: 0, pointerType: "mouse" };

function dispatch(type: string, x = 0, y = 0, init: MouseEventInit = {}): void {
  window.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init }),
  );
}

function pressKey(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

/** A click as the browser makes it after a release; returns it so the test can see whether it was cancelled. */
function click(): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  // Each test ends its press (a release or a cancel); this only resets the store if one was left behind.
  useBookDragStore.setState({ drag: null });
});

describe("hasMovedEnough", () => {
  it("needs the threshold of pixels to count as a drag, not less", () => {
    const from = { x: 0, y: 0 };
    expect(hasMovedEnough(from, { x: DRAG_THRESHOLD - 1, y: 0 })).toBe(false);
    expect(hasMovedEnough(from, { x: DRAG_THRESHOLD, y: 0 })).toBe(true);
    expect(hasMovedEnough(from, { x: 0, y: -DRAG_THRESHOLD })).toBe(true);
  });

  it("measures the distance, so a diagonal shake of a few pixels is still a click", () => {
    expect(hasMovedEnough({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false); // about 5.7 px
    expect(hasMovedEnough({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(true); // about 7.1 px
  });

  it("takes the threshold as a parameter", () => {
    expect(hasMovedEnough({ x: 0, y: 0 }, { x: 3, y: 0 }, 3)).toBe(true);
  });
});

describe("roomIdAt", () => {
  it("reads the Sala of the element or of an ancestor, and nothing outside a Sala", () => {
    const sala = room("c7");
    const inside = sala.querySelector("span") as Element;
    expect(roomIdAt(sala)).toBe("c7");
    expect(roomIdAt(inside)).toBe("c7");
    expect(roomIdAt(document.createElement("div"))).toBeNull();
    expect(roomIdAt(null)).toBeNull();
  });
});

describe("beginBookPress", () => {
  it("is a click below the threshold: no drag, no drop, and the click goes on to the book", () => {
    const onDrop = vi.fn();
    beginBookPress(ORIGIN, book("m1"), onDrop, { target: window, hitTest: () => room("c1") });

    dispatch("pointermove", 103, 102); // about 3.6 px
    expect(useBookDragStore.getState().drag).toBeNull();
    dispatch("pointerup", 103, 102);

    expect(onDrop).not.toHaveBeenCalled();
    expect(click().defaultPrevented).toBe(false);
  });

  it("past the threshold, shows the book following the pointer and marks the Sala under it", () => {
    const sala = room("c1");
    let under: Element | null = sala;
    beginBookPress(ORIGIN, book("m1"), vi.fn(), { target: window, hitTest: () => under });

    dispatch("pointermove", 140, 120);
    expect(useBookDragStore.getState().drag).toMatchObject({
      book: { id: "m1" },
      x: 140,
      y: 120,
      overRoomId: "c1",
    });

    under = document.createElement("div"); // over no Sala
    dispatch("pointermove", 150, 130);
    expect(useBookDragStore.getState().drag).toMatchObject({ x: 150, y: 130, overRoomId: null });

    dispatch("pointerup", 150, 130); // ends the drag so no listener is left behind
  });

  it("releasing over a Sala adds the book to it once, and the release's click does not open the book", () => {
    const onDrop = vi.fn();
    beginBookPress(ORIGIN, book("m1"), onDrop, { target: window, hitTest: () => room("c1") });

    dispatch("pointermove", 140, 120);
    dispatch("pointerup", 140, 120);

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop.mock.calls[0]?.[0]).toMatchObject({ id: "m1" });
    expect(onDrop.mock.calls[0]?.[1]).toBe("c1");
    expect(useBookDragStore.getState().drag).toBeNull();
    expect(click().defaultPrevented).toBe(true);
  });

  it("the swallowed click is only the release's: a later click opens the book again", async () => {
    beginBookPress(ORIGIN, book("m1"), vi.fn(), { target: window, hitTest: () => room("c1") });
    dispatch("pointermove", 140, 120);
    dispatch("pointerup", 140, 120);
    expect(click().defaultPrevented).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(click().defaultPrevented).toBe(false);
  });

  it("releasing outside every Sala drops nothing", () => {
    const onDrop = vi.fn();
    beginBookPress(ORIGIN, book("m1"), onDrop, { target: window, hitTest: () => null });

    dispatch("pointermove", 140, 120);
    dispatch("pointerup", 140, 120);

    expect(onDrop).not.toHaveBeenCalled();
    expect(useBookDragStore.getState().drag).toBeNull();
  });

  it("Escape cancels the drag: a later release drops nothing, and Escape does not reach the rest of the app", () => {
    const onDrop = vi.fn();
    beginBookPress(ORIGIN, book("m1"), onDrop, { target: window, hitTest: () => room("c1") });
    dispatch("pointermove", 140, 120);

    const escape = pressKey("Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(useBookDragStore.getState().drag).toBeNull();

    dispatch("pointerup", 140, 120);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("other keys do not cancel the drag", () => {
    beginBookPress(ORIGIN, book("m1"), vi.fn(), { target: window, hitTest: () => room("c1") });
    dispatch("pointermove", 140, 120);

    expect(pressKey("Shift").defaultPrevented).toBe(false);
    expect(useBookDragStore.getState().drag).not.toBeNull();
    dispatch("pointerup", 140, 120);
  });

  it("a pointer cancel or the window losing focus cancels the drag", () => {
    const onDrop = vi.fn();
    beginBookPress(ORIGIN, book("m1"), onDrop, { target: window, hitTest: () => room("c1") });
    dispatch("pointermove", 140, 120);
    dispatch("pointercancel");
    expect(useBookDragStore.getState().drag).toBeNull();

    beginBookPress(ORIGIN, book("m2"), onDrop, { target: window, hitTest: () => room("c1") });
    dispatch("pointermove", 140, 120);
    window.dispatchEvent(new Event("blur"));
    expect(useBookDragStore.getState().drag).toBeNull();

    dispatch("pointerup", 140, 120);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("only the primary button of a mouse or a pen starts a drag, never a touch", () => {
    for (const origin of [
      { ...ORIGIN, button: 2 },
      { ...ORIGIN, pointerType: "touch" },
    ]) {
      beginBookPress(origin, book("m1"), vi.fn(), { target: window, hitTest: () => room("c1") });
      dispatch("pointermove", 140, 120);
      expect(useBookDragStore.getState().drag).toBeNull();
      dispatch("pointerup", 140, 120);
    }
  });

  it("a book whose file is missing cannot be dragged", () => {
    beginBookPress(ORIGIN, book("m1", { missing: true }), vi.fn(), {
      target: window,
      hitTest: () => room("c1"),
    });
    dispatch("pointermove", 140, 120);
    expect(useBookDragStore.getState().drag).toBeNull();
  });

  it("a new press replaces the one in progress: the old drag ends and only the new one moves", () => {
    const onDrop = vi.fn();
    beginBookPress(ORIGIN, book("m1"), onDrop, { target: window, hitTest: () => room("c1") });
    dispatch("pointermove", 140, 120);
    expect(useBookDragStore.getState().drag?.book.id).toBe("m1");

    beginBookPress(ORIGIN, book("m2"), onDrop, { target: window, hitTest: () => room("c1") });
    expect(useBookDragStore.getState().drag).toBeNull();
    dispatch("pointermove", 150, 130);
    expect(useBookDragStore.getState().drag?.book.id).toBe("m2");
    dispatch("pointerup", 150, 130);
    expect(onDrop.mock.calls.map((call) => call[0].id)).toEqual(["m2"]);
  });
});
