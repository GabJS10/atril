import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { isTypingOrControl, type KeyLike, readerActionFor, useReaderShortcuts } from "./shortcuts";

function key(value: string, modifiers: Partial<KeyLike> = {}): KeyLike {
  return { key: value, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...modifiers };
}

describe("readerActionFor", () => {
  it.each([
    ["ArrowRight", "next-page"],
    ["ArrowLeft", "previous-page"],
    ["j", "scroll-down"],
    ["k", "scroll-up"],
    [" ", "page-down"],
    ["Home", "first-page"],
    ["End", "last-page"],
    ["+", "zoom-in"],
    ["=", "zoom-in"],
    ["-", "zoom-out"],
  ] as const)("maps %s to %s", (value, action) => {
    expect(readerActionFor(key(value))).toBe(action);
  });

  it("maps Shift+space to the previous page of scroll", () => {
    expect(readerActionFor(key(" ", { shiftKey: true }))).toBe("page-up");
  });

  it("leaves browser shortcuts alone (Ctrl, Cmd, Alt)", () => {
    expect(readerActionFor(key("+", { ctrlKey: true }))).toBeNull();
    expect(readerActionFor(key("-", { metaKey: true }))).toBeNull();
    expect(readerActionFor(key("j", { altKey: true }))).toBeNull();
  });

  it("returns null for keys that are not mapped", () => {
    expect(readerActionFor(key("a"))).toBeNull();
    expect(readerActionFor(key("Enter"))).toBeNull();
  });
});

describe("isTypingOrControl", () => {
  it("is true for fields and buttons, false for the page", () => {
    const input = document.createElement("input");
    const button = document.createElement("button");
    const page = document.createElement("div");
    expect(isTypingOrControl(input)).toBe(true);
    expect(isTypingOrControl(button)).toBe(true);
    expect(isTypingOrControl(page)).toBe(false);
    expect(isTypingOrControl(null)).toBe(false);
  });
});

describe("useReaderShortcuts", () => {
  function Probe({ onAction }: { onAction: (action: string) => void }) {
    useReaderShortcuts(onAction);
    return createElement("input", { "aria-label": "field" });
  }

  it("runs the mapped action for keys pressed on the page", () => {
    const onAction = vi.fn();
    render(createElement(Probe, { onAction }));

    fireEvent.keyDown(document.body, { key: "j" });

    expect(onAction).toHaveBeenCalledWith("scroll-down");
  });

  it("ignores keys typed into a field", () => {
    const onAction = vi.fn();
    render(createElement(Probe, { onAction }));

    fireEvent.keyDown(screen.getByLabelText("field"), { key: "j" });

    expect(onAction).not.toHaveBeenCalled();
  });
});
