import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../i18n";
import { OutlinePanel } from "./OutlinePanel";
import type { OutlineItem } from "./outline";

const TREE: OutlineItem[] = [
  { title: "Prólogo", dest: { page: 1, y: null }, page: 1, items: [] },
  {
    title: "Parte 1",
    dest: { page: 3, y: null },
    page: 3,
    items: [
      { title: "Capítulo 1", dest: { page: 3, y: null }, page: 3, items: [] },
      { title: "Capítulo 2", dest: { page: 9, y: null }, page: 9, items: [] },
    ],
  },
];

describe("OutlinePanel", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLanguage("es");
  });

  it("lists the entries and marks the section of the current page", () => {
    render(<OutlinePanel items={TREE} currentPage={5} onGo={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Prólogo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Capítulo 1" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Capítulo 2" }).getAttribute("aria-current")).toBeNull();
  });

  it("goes to the entry that was clicked", () => {
    const onGo = vi.fn();
    render(<OutlinePanel items={TREE} currentPage={1} onGo={onGo} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Capítulo 2" }));

    expect(onGo).toHaveBeenCalledWith(TREE[1]?.items[1]);
  });

  it("folds and unfolds the entries with children", () => {
    render(<OutlinePanel items={TREE} currentPage={1} onGo={vi.fn()} onClose={vi.fn()} />);
    const fold = screen.getByRole("button", { name: "Plegar Parte 1" });

    fireEvent.click(fold);
    expect(screen.queryByRole("button", { name: "Capítulo 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Desplegar Parte 1" }).getAttribute("aria-expanded")).toBe(
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Desplegar Parte 1" }));
    expect(within(screen.getByRole("navigation")).getByRole("button", { name: "Capítulo 1" })).toBeTruthy();
  });

  it("says so when the book has no index", () => {
    render(<OutlinePanel items={[]} currentPage={1} onGo={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Este libro no tiene índice" })).toBeTruthy();
    expect(screen.getByText(/escribe una página en el campo/)).toBeTruthy();
  });

  it("shows a loading message while the index is read", () => {
    render(<OutlinePanel items={null} currentPage={1} onGo={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("Cargando el índice…")).toBeTruthy();
  });

  it("closes with Escape", () => {
    const onClose = vi.fn();
    render(<OutlinePanel items={TREE} currentPage={1} onGo={vi.fn()} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
