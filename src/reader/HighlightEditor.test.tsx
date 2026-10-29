import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Highlight, HighlightGroup } from "../api/types";
import { useLocaleStore } from "../i18n";
import { HighlightEditor } from "./HighlightEditor";

const ANCHOR = { left: 200, top: 400, right: 300, bottom: 420, width: 100, height: 20 } as DOMRect;

function highlight(groupId: string | null): Highlight {
  return {
    id: "h1",
    bookId: "b",
    page: 2,
    rects: [[72, 600, 200, 620]],
    text: "Un texto",
    color: "ochre",
    note: null,
    groupId,
    createdAt: "2026-10-11T12:00:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
  };
}

const GROUPS: HighlightGroup[] = [
  { id: "c1", bookId: "b", name: "Capítulo 1", position: 0, createdAt: "2026-10-01T10:00:00Z" },
  { id: "c3", bookId: "b", name: "Notas del capítulo 3", position: 1, createdAt: "2026-10-01T10:00:00Z" },
];

function renderEditor(groupId: string | null = null) {
  const props = {
    highlight: highlight(groupId),
    anchor: ANCHOR,
    focusNote: false,
    groups: GROUPS,
    onColor: vi.fn(),
    onGroup: vi.fn(),
    onNewGroup: vi.fn(),
    onNote: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  };
  render(<HighlightEditor {...props} />);
  return props;
}

function groupSelect(): HTMLSelectElement {
  return screen.getByLabelText("Grupo") as HTMLSelectElement;
}

describe("HighlightEditor group selector", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLanguage("es");
  });

  it("offers 'Sin grupo', the groups of the book and 'New group', and shows the current one", () => {
    renderEditor("c3");

    const options = Array.from(groupSelect().options).map((option) => option.textContent);
    expect(options).toEqual(["Sin grupo", "Capítulo 1", "Notas del capítulo 3", "+ Nuevo grupo…"]);
    expect(groupSelect().value).toBe("c3");
  });

  it("shows 'Sin grupo' as the current choice of a highlight without a group", () => {
    renderEditor(null);

    expect(groupSelect().value).toBe("");
  });

  it("moves the highlight to the group chosen", () => {
    const props = renderEditor(null);

    fireEvent.change(groupSelect(), { target: { value: "c1" } });

    expect(props.onGroup).toHaveBeenCalledWith("c1");
  });

  it("takes the highlight back to 'Sin grupo' with null", () => {
    const props = renderEditor("c1");

    fireEvent.change(groupSelect(), { target: { value: "" } });

    expect(props.onGroup).toHaveBeenCalledWith(null);
  });

  it("asks for the name of a new group in place, and creates it with the highlight", () => {
    const props = renderEditor(null);

    fireEvent.change(groupSelect(), { target: { value: "new" } });
    expect(props.onGroup).not.toHaveBeenCalled();

    const field = screen.getByRole("textbox", { name: "Nombre del grupo nuevo" });
    fireEvent.change(field, { target: { value: " Capítulo 4 " } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    expect(props.onNewGroup).toHaveBeenCalledWith("Capítulo 4");
    expect(props.onGroup).not.toHaveBeenCalled();
  });

  it("cancels the new group with Escape, and the editor stays open", () => {
    const props = renderEditor(null);

    fireEvent.change(groupSelect(), { target: { value: "new" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Nombre del grupo nuevo" }), { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "Nombre del grupo nuevo" })).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onNewGroup).not.toHaveBeenCalled();
  });

  it("closes with Escape outside the new-group field", () => {
    const props = renderEditor(null);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
