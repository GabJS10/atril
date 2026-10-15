import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";
import { addToCollection } from "../api/tauri";
import type { Book } from "../api/types";
import { invalidateLibrary } from "./queries";

// Dragging a book onto a Sala, with pointer events instead of HTML5 drag and drop: on Windows the native file-drop
// handler (`dragDropEnabled`, needed to receive PDF paths) swallows HTML5 drags inside the webview. One implementation
// for every platform. A click without a real move still opens the book; Escape cancels; "Añadir a Sala" stays in the menu.

/** Pixels the pointer must travel before a press becomes a drag: a click with a small shake stays a click. */
export const DRAG_THRESHOLD = 6;

/** What a press needs from the pointer event (React's and the DOM's both have these fields). */
export type PressOrigin = { clientX: number; clientY: number; button: number; pointerType: string };

/** An ongoing drag: the book, where the pointer is, and the Sala under it (its `data-room-id`), if any. */
export type DragState = { book: Book; x: number; y: number; overRoomId: string | null };

/** The drag in progress, read by the ghost that follows the pointer and by the Salas that light up. */
export const useBookDragStore = create<{ drag: DragState | null }>()(() => ({ drag: null }));

/** True once the pointer is at least `threshold` pixels away from where the press began. */
export function hasMovedEnough(
  from: { x: number; y: number },
  to: { x: number; y: number },
  threshold = DRAG_THRESHOLD,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx * dx + dy * dy >= threshold * threshold;
}

/** The id of the Sala under an element (the element itself or an ancestor with `data-room-id`), or null. */
export function roomIdAt(element: Element | null): string | null {
  return element?.closest<HTMLElement>("[data-room-id]")?.dataset.roomId ?? null;
}

export type BookDragOptions = {
  /** The element under a viewport point. The default asks the document. */
  hitTest?: (x: number, y: number) => Element | null;
  /** The window that carries the pointer events (tests pass their own). */
  target?: Window;
};

/** The press in progress, if any: only one at a time. */
let cancelPress: (() => void) | null = null;

function defaultHitTest(x: number, y: number): Element | null {
  return typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
}

/**
 * Starts tracking a press on a book. Below the threshold it does nothing and the click goes on to the book. Past it,
 * the drag follows the pointer until the button is released: over a Sala, `onDrop` gets the book and the Sala's id.
 * Escape, pointercancel or losing the window focus cancel it. After a drag, the click that the release produces is
 * swallowed, so the book does not open. Only the primary button of a mouse or a pen starts a drag (touch scrolls).
 */
export function beginBookPress(
  origin: PressOrigin,
  book: Book,
  onDrop: (book: Book, roomId: string) => void,
  options: BookDragOptions = {},
): void {
  if (origin.button !== 0 || origin.pointerType === "touch" || book.missing) return;
  cancelPress?.();

  const target = options.target ?? window;
  const hitTest = options.hitTest ?? defaultHitTest;
  const from = { x: origin.clientX, y: origin.clientY };
  let dragging = false;

  const detach = () => {
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onCancel);
    target.removeEventListener("blur", onCancel);
    target.removeEventListener("keydown", onKey, true);
    cancelPress = null;
  };

  const stopDrag = () => {
    if (dragging) useBookDragStore.setState({ drag: null });
    dragging = false;
    detach();
  };

  const onCancel = () => stopDrag();

  const onKey = (event: Event) => {
    if ((event as KeyboardEvent).key !== "Escape" || !dragging) return;
    event.preventDefault();
    event.stopPropagation(); // Escape leaves the drag alone: the reader's own Escape does not run too.
    stopDrag();
  };

  function onMove(event: Event) {
    const { clientX: x, clientY: y } = event as MouseEvent;
    if (!dragging) {
      if (!hasMovedEnough(from, { x, y })) return;
      dragging = true;
      window.getSelection()?.removeAllRanges();
    }
    useBookDragStore.setState({ drag: { book, x, y, overRoomId: roomIdAt(hitTest(x, y)) } });
  }

  function onUp() {
    if (!dragging) {
      detach(); // A plain click: nothing to do, the click goes on to the book.
      return;
    }
    const roomId = useBookDragStore.getState().drag?.overRoomId ?? null;
    stopDrag();
    // The release produces one click on the common ancestor of press and release. It must not open the book.
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    target.addEventListener("click", swallow, { capture: true, once: true });
    target.setTimeout(() => target.removeEventListener("click", swallow, { capture: true }), 0);
    if (roomId) onDrop(book, roomId);
  }

  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onCancel);
  target.addEventListener("blur", onCancel);
  target.addEventListener("keydown", onKey, true);
  cancelPress = () => stopDrag();
}

/**
 * The pointer handler of a book's cover or row: a press on it may become a drag onto a Sala. Dropping adds the book to
 * the Sala and refreshes the library, as the menu's "Añadir a Sala" does.
 */
export function useBookDragSource(book: Book): (event: ReactPointerEvent) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (event: ReactPointerEvent) => {
      beginBookPress(event, book, (dropped, roomId) => {
        addToCollection([dropped.id], roomId).then(
          () => invalidateLibrary(queryClient),
          (error: unknown) => console.error("could not add the book to the Sala", error),
        );
      });
    },
    [book, queryClient],
  );
}
