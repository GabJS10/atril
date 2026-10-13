import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../i18n";
import type { Highlight } from "../api/types";
import { HighlightsPanel } from "./HighlightsPanel";

function highlight(id: string, page: number, text: string, note: string | null = null): Highlight {
  return {
    id,
    bookId: "b",
    page,
    rects: [[72, 600, 200, 620]],
    text,
    color: "sage",
    note,
    createdAt: "2026-10-11T12:00:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
  };
}

function renderPanel(
  highlights: Highlight[],
  overrides: Partial<Parameters<typeof HighlightsPanel>[0]> = {},
) {
  const props = {
    highlights,
    exporting: false,
    onJump: vi.fn(),
    onExport: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<HighlightsPanel {...props} />);
  return props;
}

describe("HighlightsPanel", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLanguage("es");
  });

  it("lists the highlights in page order, labelled with pigment and page, with their notes", () => {
    renderPanel([highlight("a", 2, "Segundo texto"), highlight("b", 1, "Primer texto", "una nota")]);

    const cards = screen.getAllByRole("button", { name: /texto/ });
    expect(cards[0]).toHaveTextContent("Salvia · p. 1");
    expect(cards[1]).toHaveTextContent("Salvia · p. 2");
    expect(screen.getByText("Primer texto")).toBeTruthy();
    expect(screen.getByText("una nota")).toBeTruthy();
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

    expect(screen.getByText(/Todavía no hay subrayados/)).toBeTruthy();
  });

  it("closes with Escape", () => {
    const props = renderPanel([]);

    fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" });

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
