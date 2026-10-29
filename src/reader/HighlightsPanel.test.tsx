import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../i18n";
import type { Highlight, HighlightGroup } from "../api/types";
import { HighlightsPanel } from "./HighlightsPanel";

function highlight(
  id: string,
  page: number,
  text: string,
  note: string | null = null,
  createdAt = "2026-10-11T12:00:00Z",
  groupId: string | null = null,
): Highlight {
  return {
    id,
    bookId: "b",
    page,
    rects: [[72, 600, 200, 620]],
    text,
    color: "sage",
    note,
    groupId,
    createdAt,
    updatedAt: createdAt,
  };
}

function group(id: string, position: number, name: string): HighlightGroup {
  return { id, bookId: "b", name, position, createdAt: "2026-10-01T10:00:00Z" };
}

function renderPanel(
  highlights: Highlight[],
  overrides: Partial<Parameters<typeof HighlightsPanel>[0]> = {},
) {
  const props = {
    highlights,
    groups: [] as HighlightGroup[],
    exporting: false,
    onJump: vi.fn(),
    onExport: vi.fn(),
    onClose: vi.fn(),
    onCreateGroup: vi.fn().mockResolvedValue(group("new", 9, "Nuevo")),
    onRenameGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    ...overrides,
  };
  render(<HighlightsPanel {...props} />);
  return props;
}

/** The card buttons in the order they are on screen. */
function cardTexts(): string[] {
  return screen
    .getAllByRole("button")
    .filter((button) => button.textContent?.includes("· p."))
    .map((button) => button.textContent ?? "");
}

describe("HighlightsPanel", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLanguage("es");
  });

  it("lists the newest highlights first by default, labelled with pigment and page, with their notes", () => {
    renderPanel([
      highlight("a", 2, "Segundo texto", null, "2026-10-11T10:00:00Z"),
      highlight("b", 1, "Primer texto", "una nota", "2026-10-11T12:00:00Z"),
    ]);

    const cards = screen.getAllByRole("button", { name: /texto/ });
    expect(cards[0]).toHaveTextContent("Primer texto");
    expect(cards[0]).toHaveTextContent("Salvia · p. 1");
    expect(cards[1]).toHaveTextContent("Segundo texto");
    expect(cards[1]).toHaveTextContent("Salvia · p. 2");
    expect(screen.getByText("una nota")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recientes" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("changes to the reading order of the book with 'Por página'", () => {
    renderPanel([
      highlight("a", 2, "Segundo texto", null, "2026-10-11T10:00:00Z"),
      highlight("b", 1, "Primer texto", null, "2026-10-11T12:00:00Z"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Por página" }));

    expect(screen.getByRole("button", { name: "Por página" }).getAttribute("aria-pressed")).toBe("true");
    expect(cardTexts().map((text) => text.includes("Primer texto"))).toEqual([true, false]);
    expect(cardTexts()[0]).toContain("p. 1");
  });

  it("keeps only the highlights with a note", () => {
    renderPanel([highlight("a", 2, "Segundo texto"), highlight("b", 1, "Primer texto", "una nota")]);

    fireEvent.click(screen.getByRole("button", { name: "Con nota" }));

    expect(screen.queryByText("Segundo texto")).toBeNull();
    expect(screen.getByText("Primer texto")).toBeTruthy();
  });

  it("jumps to the highlight that was clicked", () => {
    const props = renderPanel([highlight("a", 1, "Primer texto")]);

    fireEvent.click(screen.getByRole("button", { name: /Primer texto/ }));

    expect(props.onJump).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("exports from the footer button", () => {
    const props = renderPanel([]);

    fireEvent.click(screen.getByRole("button", { name: "Exportar a Markdown" }));

    expect(props.onExport).toHaveBeenCalledTimes(1);
  });

  it("disables export while it runs", () => {
    renderPanel([], { exporting: true });

    expect(screen.getByRole("button", { name: "Exportando…" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the empty state when there are no highlights", () => {
    renderPanel([]);

    expect(screen.getByRole("heading", { name: "Todavía no hay subrayados" })).toBeTruthy();
    // It says how to make one: select text, or press H.
    expect(screen.getByText(/Selecciona un texto/)).toBeTruthy();
    expect(screen.getByText(/pulsa H/)).toBeTruthy();
  });

  it("says no highlight has a note when the filter leaves nothing", () => {
    renderPanel([highlight("a", 1, "Primer texto")]);

    fireEvent.click(screen.getByRole("button", { name: "Con nota" }));

    expect(screen.getByRole("heading", { name: "Ningún subrayado tiene nota" })).toBeTruthy();
    expect(screen.getByText(/para escribir una/)).toBeTruthy();
  });

  it("closes with Escape", () => {
    const props = renderPanel([]);

    fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" });

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("is a plain list, with no sections, when the book has no groups", () => {
    renderPanel([highlight("a", 1, "Primer texto")]);

    expect(screen.queryByRole("button", { name: /Sin grupo/ })).toBeNull();
    expect(screen.getByText("Primer texto")).toBeTruthy();
  });
});

describe("HighlightsPanel groups", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLanguage("es");
  });

  const chapter1 = group("c1", 0, "Capítulo 1");
  const chapter3 = group("c3", 1, "Notas del capítulo 3");

  it("shows one folding section per group, with its count, and 'Sin grupo' last", () => {
    renderPanel(
      [
        highlight("u", 1, "Sin grupo texto", null, "2026-10-11T12:00:00Z", null),
        highlight("a", 2, "Capítulo tres texto", null, "2026-10-11T11:00:00Z", "c3"),
        highlight("b", 3, "Capítulo uno texto", null, "2026-10-11T10:00:00Z", "c1"),
      ],
      { groups: [chapter3, chapter1] },
    );

    const toggles = screen
      .getAllByRole("button", { expanded: true })
      .filter((button) => button.getAttribute("aria-controls"));
    expect(toggles.map((button) => button.textContent)).toEqual([
      "Capítulo 11",
      "Notas del capítulo 31",
      "Sin grupo1",
    ]);
    expect(screen.getByText("Capítulo uno texto")).toBeTruthy();
  });

  it("shows an empty group, so highlights can be moved there, and hides an empty 'Sin grupo'", () => {
    renderPanel([highlight("a", 2, "Capítulo tres texto", null, "2026-10-11T11:00:00Z", "c3")], {
      groups: [chapter1, chapter3],
    });

    const empty = screen.getByRole("button", { name: /Capítulo 1/ });
    expect(empty.textContent).toContain("0");
    expect(screen.getByText("Vacío: mueve aquí subrayados desde su editor.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Sin grupo/ })).toBeNull();
  });

  it("drops the empty groups under 'Con nota', where they would be empty sections", () => {
    renderPanel([highlight("a", 2, "Capítulo tres texto", "con nota", "2026-10-11T11:00:00Z", "c3")], {
      groups: [chapter1, chapter3],
    });

    fireEvent.click(screen.getByRole("button", { name: "Con nota" }));

    expect(screen.queryByRole("button", { name: /Capítulo 1/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Notas del capítulo 3/ })).toBeTruthy();
  });

  it("folds a section with its toggle, and keeps its cards out of sight", () => {
    renderPanel([highlight("a", 2, "Capítulo tres texto", null, "2026-10-11T11:00:00Z", "c3")], {
      groups: [chapter3],
    });
    const toggle = screen.getByRole("button", { name: /Notas del capítulo 3/ });
    const body = document.getElementById(toggle.getAttribute("aria-controls") ?? "");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(body?.className).toContain("hidden");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(body?.className).not.toContain("hidden");
  });

  it("creates a group with the name typed in the field, trimmed", async () => {
    const props = renderPanel([], { groups: [chapter1] });

    fireEvent.click(screen.getByRole("button", { name: "Nuevo grupo" }));
    const field = screen.getByRole("textbox", { name: "Nombre del grupo" });
    fireEvent.change(field, { target: { value: "  Notas del capítulo 4  " } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    expect(props.onCreateGroup).toHaveBeenCalledWith("Notas del capítulo 4");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Nombre del grupo" })).toBeNull());
  });

  it("does not create a group with an empty name", () => {
    const props = renderPanel([], { groups: [] });

    fireEvent.click(screen.getByRole("button", { name: "Nuevo grupo" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del grupo" }), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: "Crear" }).hasAttribute("disabled")).toBe(true);
    expect(props.onCreateGroup).not.toHaveBeenCalled();
  });

  it("keeps the field open when the backend refuses the group", async () => {
    const props = renderPanel([], { onCreateGroup: vi.fn().mockResolvedValue(null) });

    fireEvent.click(screen.getByRole("button", { name: "Nuevo grupo" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Nombre del grupo" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear" }));

    await waitFor(() => expect(props.onCreateGroup).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox", { name: "Nombre del grupo" })).toBeTruthy();
  });

  it("cancels the new group with Escape, without closing the panel", () => {
    const props = renderPanel([], { groups: [] });

    fireEvent.click(screen.getByRole("button", { name: "Nuevo grupo" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Nombre del grupo" }), { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "Nombre del grupo" })).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("renames a group from its menu, with its name in the field", () => {
    const props = renderPanel([highlight("a", 2, "x", null, "2026-10-11T11:00:00Z", "c3")], {
      groups: [chapter3],
    });

    fireEvent.click(screen.getByRole("button", { name: "Opciones del grupo" }));
    fireEvent.click(screen.getByRole("button", { name: "Renombrar" }));
    const field = screen.getByRole("textbox", { name: "Nombre del grupo" });
    expect((field as HTMLInputElement).value).toBe("Notas del capítulo 3");
    fireEvent.change(field, { target: { value: "Capítulo 3, revisado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(props.onRenameGroup).toHaveBeenCalledWith("c3", "Capítulo 3, revisado");
  });

  it("deletes a group only after confirming", () => {
    const props = renderPanel([highlight("a", 2, "x", null, "2026-10-11T11:00:00Z", "c3")], {
      groups: [chapter3],
    });

    fireEvent.click(screen.getByRole("button", { name: "Opciones del grupo" }));
    fireEvent.click(screen.getByRole("button", { name: "Borrar grupo" }));
    expect(screen.getByText(/Sus subrayados pasan a «Sin grupo»/)).toBeTruthy();
    expect(props.onDeleteGroup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(props.onDeleteGroup).toHaveBeenCalledWith("c3");
  });

  it("does not delete when the confirmation is cancelled", () => {
    const props = renderPanel([highlight("a", 2, "x", null, "2026-10-11T11:00:00Z", "c3")], {
      groups: [chapter3],
    });

    fireEvent.click(screen.getByRole("button", { name: "Opciones del grupo" }));
    fireEvent.click(screen.getByRole("button", { name: "Borrar grupo" }));
    const confirmation = screen.getByText(/Sus subrayados pasan/).parentElement;
    fireEvent.click(within(confirmation as HTMLElement).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(props.onDeleteGroup).not.toHaveBeenCalled();
  });

  it("gives 'Sin grupo' no menu, since it is not a group", () => {
    renderPanel([highlight("u", 1, "x")], { groups: [chapter1] });

    expect(screen.getAllByRole("button", { name: "Opciones del grupo" })).toHaveLength(1);
  });
});
