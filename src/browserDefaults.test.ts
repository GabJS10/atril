import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installBrowserDefaults,
  isBrowserDefaultKey,
  isTextField,
  markPlatform,
  platformOf,
} from "./browserDefaults";

const WEBVIEW2 =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
const WEBKITGTK =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

function keyDown(key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...modifiers });
}

/** Dispatches on `target` and says whether the default was cancelled. */
function defaultCancelled(event: Event, target: EventTarget = window): boolean {
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

let uninstall: (() => void) | undefined;

function install(production: boolean, userAgent = WEBVIEW2): void {
  uninstall?.();
  uninstall = installBrowserDefaults(window, { production, userAgent });
}

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

describe("isBrowserDefaultKey", () => {
  const key = (value: string, modifiers: Partial<KeyboardEventInit> = {}) =>
    isBrowserDefaultKey({ key: value, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers }, false);

  it.each([
    ["print", "p", { ctrlKey: true }],
    ["save page", "s", { ctrlKey: true }],
    ["open file", "o", { ctrlKey: true }],
    ["view source", "u", { ctrlKey: true }],
    ["find next", "g", { ctrlKey: true }],
    ["find", "f", { ctrlKey: true }],
    ["reload", "r", { ctrlKey: true }],
    ["hard reload", "R", { ctrlKey: true, shiftKey: true }],
    ["zoom in", "+", { ctrlKey: true }],
    ["zoom in (=)", "=", { ctrlKey: true }],
    ["zoom out", "-", { ctrlKey: true }],
    ["zoom reset", "0", { ctrlKey: true }],
    ["reload (F5)", "F5", {}],
    ["reload without cache (Ctrl+F5)", "F5", { ctrlKey: true }],
    ["find next (F3)", "F3", {}],
    ["caret browsing (F7)", "F7", {}],
    ["history back", "ArrowLeft", { altKey: true }],
    ["history forward", "ArrowRight", { altKey: true }],
  ])("cancels the default of %s", (_name, value, modifiers) => {
    expect(key(value, modifiers)).toBe(true);
  });

  it.each([
    ["the reader's keys", "j", {}],
    ["the reader's zoom", "+", {}],
    ["space", " ", {}],
    ["arrows", "ArrowRight", {}],
    ["Ctrl+K (library search)", "k", { ctrlKey: true }],
    ["Ctrl+Z", "z", { ctrlKey: true }],
    ["Ctrl+C / Ctrl+V / Ctrl+A", "c", { ctrlKey: true }],
    ["Ctrl+Shift+I in development", "I", { ctrlKey: true, shiftKey: true }],
    ["Ctrl+Alt (AltGr) on the Spanish layout", "\\", { ctrlKey: true, altKey: true }],
    ["Alt+arrow with Ctrl", "ArrowLeft", { altKey: true, ctrlKey: true }],
  ])("leaves %s alone", (_name, value, modifiers) => {
    expect(key(value, modifiers)).toBe(false);
  });

  it("cancels the developer tools only in production", () => {
    const devtools = [
      { key: "I", ctrlKey: true, shiftKey: true, altKey: false },
      { key: "J", ctrlKey: true, shiftKey: true, altKey: false },
      { key: "F12", ctrlKey: false, shiftKey: false, altKey: false },
    ];
    for (const event of devtools) {
      expect(isBrowserDefaultKey(event, true)).toBe(true);
      expect(isBrowserDefaultKey(event, false)).toBe(false);
    }
  });
});

describe("isTextField", () => {
  it("is true for inputs, textareas and editable content, false for the rest", () => {
    expect(isTextField(document.createElement("input"))).toBe(true);
    expect(isTextField(document.createElement("textarea"))).toBe(true);
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true }); // jsdom does not implement it
    expect(isTextField(editable)).toBe(true);
    expect(isTextField(document.createElement("button"))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe("platformOf and markPlatform", () => {
  it("recognises WebView2 on Windows and anything else as the other platform", () => {
    expect(platformOf(WEBVIEW2)).toBe("windows");
    expect(platformOf(WEBKITGTK)).toBe("other");
  });

  it("writes data-platform on the root element", () => {
    const root = document.createElement("html");
    markPlatform(root, WEBVIEW2);
    expect(root.dataset.platform).toBe("windows");
    markPlatform(root, WEBKITGTK);
    expect(root.dataset.platform).toBe("other");
  });
});

describe("installBrowserDefaults on WebView2", () => {
  it("cancels print, reload and zoom while the app keeps running its own handlers", () => {
    install(false);
    const app = vi.fn();
    window.addEventListener("keydown", app);
    try {
      expect(defaultCancelled(keyDown("p", { ctrlKey: true }))).toBe(true);
      expect(defaultCancelled(keyDown("F5"))).toBe(true);
      expect(defaultCancelled(keyDown("=", { ctrlKey: true }))).toBe(true);
      // Ctrl+F is cancelled too, and the reader's own Ctrl+F listener still receives it.
      expect(defaultCancelled(keyDown("f", { ctrlKey: true }))).toBe(true);
      expect(app).toHaveBeenCalledTimes(4);
    } finally {
      window.removeEventListener("keydown", app);
    }
  });

  it("does not cancel the reader's plain keys", () => {
    install(false);
    expect(defaultCancelled(keyDown("ArrowRight"))).toBe(false);
    expect(defaultCancelled(keyDown("j"))).toBe(false);
    expect(defaultCancelled(keyDown(" "))).toBe(false);
    expect(defaultCancelled(keyDown("+"))).toBe(false);
  });

  it("cancels Ctrl + wheel (page zoom) and leaves a plain wheel alone", () => {
    install(false);
    const ctrlWheel = new WheelEvent("wheel", {
      ctrlKey: true,
      deltaY: -40,
      cancelable: true,
      bubbles: true,
    });
    const plainWheel = new WheelEvent("wheel", { deltaY: -40, cancelable: true, bubbles: true });
    expect(defaultCancelled(ctrlWheel)).toBe(true);
    expect(defaultCancelled(plainWheel)).toBe(false);
  });

  it("cancels the context menu outside text fields and keeps it in them", () => {
    install(false);
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);
    try {
      const onButton = new MouseEvent("contextmenu", { cancelable: true, bubbles: true });
      button.dispatchEvent(onButton);
      expect(onButton.defaultPrevented).toBe(true);

      const onInput = new MouseEvent("contextmenu", { cancelable: true, bubbles: true });
      input.dispatchEvent(onInput);
      expect(onInput.defaultPrevented).toBe(false);
    } finally {
      input.remove();
      button.remove();
    }
  });

  it("keeps Ctrl+Shift+I available in development and cancels it in production", () => {
    install(false);
    expect(defaultCancelled(keyDown("I", { ctrlKey: true, shiftKey: true }))).toBe(false);
    install(true);
    expect(defaultCancelled(keyDown("I", { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("removes every listener when uninstalled", () => {
    install(false);
    uninstall?.();
    uninstall = undefined;
    expect(defaultCancelled(keyDown("p", { ctrlKey: true }))).toBe(false);
    expect(
      defaultCancelled(new WheelEvent("wheel", { ctrlKey: true, cancelable: true, bubbles: true })),
    ).toBe(false);
  });
});

describe("installBrowserDefaults on Linux", () => {
  it("installs nothing, so the WebKitGTK behaviour stays as it is", () => {
    install(true, WEBKITGTK);
    expect(defaultCancelled(keyDown("p", { ctrlKey: true }))).toBe(false);
    expect(defaultCancelled(keyDown("F5"))).toBe(false);
    expect(
      defaultCancelled(new WheelEvent("wheel", { ctrlKey: true, cancelable: true, bubbles: true })),
    ).toBe(false);
  });
});
