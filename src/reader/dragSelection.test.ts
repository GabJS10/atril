import { afterEach, describe, expect, it, vi } from "vitest";
import { attachDragSelection, type CaretAt, nearestTextCaret } from "./dragSelection";

/** A text layer with one span per line, as pdf.js builds it. */
function textLayer(lines: string[]): { root: HTMLElement; texts: Text[] } {
  const root = document.createElement("div");
  root.className = "textLayer";
  const texts = lines.map((line) => {
    const span = document.createElement("span");
    const text = document.createTextNode(line);
    span.append(text);
    root.append(span);
    return text;
  });
  document.body.append(root);
  return { root, texts };
}

/** Fake line boxes: each text node sits in its own band, 100 px wide from x = 10, 40 px apart. */
function bandsOf(texts: Text[]): (text: Text) => DOMRect[] {
  return (text) => {
    const top = texts.indexOf(text) * 40;
    return [{ left: 10, right: 110, top, bottom: top + 20, width: 100, height: 20 } as DOMRect];
  };
}

function fakeSelection() {
  return { setBaseAndExtent: vi.fn(), extend: vi.fn() };
}

function mouse(type: string, target: EventTarget, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    detail: 1,
    clientX: 10,
    clientY: 10,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("nearestTextCaret", () => {
  it("picks the line nearest the point, then the side of the word", () => {
    const { root, texts } = textLayer(["Pagina 6 de 60", "Rayuela"]);
    const rectsOf = bandsOf(texts);

    expect(nearestTextCaret(root, 2, 50, rectsOf)).toEqual({ node: texts[1], offset: 0 });
    expect(nearestTextCaret(root, 200, 50, rectsOf)).toEqual({ node: texts[1], offset: texts[1]?.length });
    expect(nearestTextCaret(root, 30, 5, rectsOf)).toEqual({ node: texts[0], offset: 0 });
  });

  it("returns null when the layer has no text", () => {
    const root = document.createElement("div");
    expect(nearestTextCaret(root, 0, 0, () => [])).toBeNull();
  });
});

describe("attachDragSelection", () => {
  let detach: (() => void) | undefined;

  afterEach(() => {
    detach?.();
    document.body.innerHTML = "";
  });

  it("anchors a press on the text layer itself at the text nearest the press", () => {
    const { root, texts } = textLayer(["Pagina 6 de 60", "Rayuela"]);
    const selection = fakeSelection();
    detach = attachDragSelection(root, {
      caretAt: () => null,
      rectsOf: bandsOf(texts),
      selectionOf: () => selection as unknown as Selection,
    });

    const event = mouse("mousedown", root, { clientX: 2, clientY: 50 });

    expect(event.defaultPrevented).toBe(true);
    expect(selection.setBaseAndExtent).toHaveBeenCalledWith(texts[1], 0, texts[1], 0);
  });

  it("anchors a press on a span at the caret under the pointer", () => {
    const { root, texts } = textLayer(["Pagina 6 de 60", "Rayuela"]);
    const selection = fakeSelection();
    detach = attachDragSelection(root, {
      caretAt: () => ({ node: texts[0] as Text, offset: 3 }),
      rectsOf: bandsOf(texts),
      selectionOf: () => selection as unknown as Selection,
    });

    mouse("mousedown", texts[0]?.parentElement as HTMLElement);

    expect(selection.setBaseAndExtent).toHaveBeenCalledWith(texts[0], 3, texts[0], 3);
  });

  it("leaves double and triple clicks to the browser's word and line selection", () => {
    const { root, texts } = textLayer(["Rayuela"]);
    const selection = fakeSelection();
    detach = attachDragSelection(root, {
      caretAt: () => ({ node: texts[0] as Text, offset: 1 }),
      rectsOf: bandsOf(texts),
      selectionOf: () => selection as unknown as Selection,
    });

    const event = mouse("mousedown", root, { detail: 2 });

    expect(event.defaultPrevented).toBe(false);
    expect(selection.setBaseAndExtent).not.toHaveBeenCalled();
  });

  it("ignores buttons other than the left one", () => {
    const { root, texts } = textLayer(["Rayuela"]);
    const selection = fakeSelection();
    detach = attachDragSelection(root, {
      caretAt: () => ({ node: texts[0] as Text, offset: 1 }),
      rectsOf: bandsOf(texts),
      selectionOf: () => selection as unknown as Selection,
    });

    const event = mouse("mousedown", root, { button: 2 });

    expect(event.defaultPrevented).toBe(false);
    expect(selection.setBaseAndExtent).not.toHaveBeenCalled();
  });

  it("follows the pointer into another text layer while the button is down, then stops at release", () => {
    const first = textLayer(["Pagina 6 de 60"]);
    const second = textLayer(["Pagina 7 de 60"]);
    const selection = fakeSelection();
    let caret: ReturnType<CaretAt> = { node: first.texts[0] as Text, offset: 2 };
    detach = attachDragSelection(first.root, {
      caretAt: () => caret,
      rectsOf: bandsOf(first.texts),
      selectionOf: () => selection as unknown as Selection,
    });
    mouse("mousedown", first.root);

    caret = { node: second.texts[0] as Text, offset: 4 };
    mouse("mousemove", document.body, { buttons: 1 });
    expect(selection.extend).toHaveBeenLastCalledWith(second.texts[0], 4);

    mouse("mouseup", document.body);
    caret = { node: second.texts[0] as Text, offset: 7 };
    mouse("mousemove", document.body, { buttons: 1 });
    expect(selection.extend).toHaveBeenCalledTimes(1);
  });

  it("uses the nearest text in the layer when the browser's caret is not text", () => {
    const { root, texts } = textLayer(["Pagina 6 de 60", "Rayuela"]);
    const selection = fakeSelection();
    detach = attachDragSelection(root, {
      caretAt: () => ({ node: root, offset: 0 }),
      rectsOf: bandsOf(texts),
      selectionOf: () => selection as unknown as Selection,
    });
    mouse("mousedown", root, { clientX: 200, clientY: 50 });
    mouse("mousemove", document.body, { buttons: 1, clientX: 200, clientY: 50 });

    expect(selection.extend).toHaveBeenLastCalledWith(texts[1], texts[1]?.length);
  });

  it("stops extending when a move arrives with no button down", () => {
    const { root, texts } = textLayer(["Rayuela"]);
    const selection = fakeSelection();
    detach = attachDragSelection(root, {
      caretAt: () => ({ node: texts[0] as Text, offset: 1 }),
      rectsOf: bandsOf(texts),
      selectionOf: () => selection as unknown as Selection,
    });
    mouse("mousedown", root);

    mouse("mousemove", document.body, { buttons: 0 });

    expect(selection.extend).not.toHaveBeenCalled();
  });

  it("removes its listeners when detached", () => {
    const { root, texts } = textLayer(["Rayuela"]);
    const selection = fakeSelection();
    const stop = attachDragSelection(root, {
      caretAt: () => ({ node: texts[0] as Text, offset: 1 }),
      rectsOf: bandsOf(texts),
      selectionOf: () => selection as unknown as Selection,
    });
    stop();

    const event = mouse("mousedown", root);

    expect(event.defaultPrevented).toBe(false);
    expect(selection.setBaseAndExtent).not.toHaveBeenCalled();
  });
});
