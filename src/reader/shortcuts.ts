import { useEffect, useRef } from "react";

export type ReaderAction =
  | "previous-page"
  | "next-page"
  | "scroll-up"
  | "scroll-down"
  | "page-up"
  | "page-down"
  | "first-page"
  | "last-page"
  | "zoom-in"
  | "zoom-out";

export type KeyLike = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">;

/** Keyboard map of the reader (roadmap 1.F2): arrows and j/k, space, +/−, Home/End. */
export function readerActionFor(event: KeyLike): ReaderAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case "ArrowLeft":
      return "previous-page";
    case "ArrowRight":
      return "next-page";
    case "k":
      return "scroll-up";
    case "j":
      return "scroll-down";
    case " ":
      return event.shiftKey ? "page-up" : "page-down";
    case "Home":
      return "first-page";
    case "End":
      return "last-page";
    case "+":
    case "=":
      return "zoom-in";
    case "-":
    case "_":
      return "zoom-out";
    default:
      return null;
  }
}

/** Keys typed into a field, or pressed on a control, keep their own behaviour. */
export function isTypingOrControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName);
}

/** Runs `onAction` for every mapped key while the reader is mounted. */
export function useReaderShortcuts(onAction: (action: ReaderAction) => void): void {
  const handler = useRef(onAction);

  useEffect(() => {
    handler.current = onAction;
  }, [onAction]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingOrControl(event.target)) return;
      const action = readerActionFor(event);
      if (!action) return;
      event.preventDefault();
      handler.current(action);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
