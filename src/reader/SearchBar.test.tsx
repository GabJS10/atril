import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../i18n";
import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLanguage("es");
  });

  it("searches while typing", () => {
    const onFind = vi.fn();
    render(<SearchBar result={null} onFind={onFind} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar en el libro" }), {
      target: { value: "accion" },
    });

    expect(onFind).toHaveBeenLastCalledWith("accion");
  });

  it("goes to the next match on Enter and to the previous one on Shift+Enter", () => {
    const onFind = vi.fn();
    render(<SearchBar result={null} onFind={onFind} onClose={vi.fn()} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "acción" } });

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onFind).toHaveBeenNthCalledWith(2, "acción", { again: true, findPrevious: false });
    expect(onFind).toHaveBeenNthCalledWith(3, "acción", { again: true, findPrevious: true });
  });

  it("does not search for an empty query", () => {
    const onFind = vi.fn();
    render(<SearchBar result={null} onFind={onFind} onClose={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });

    expect(onFind).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<SearchBar result={null} onFind={vi.fn()} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the match in focus out of all matches", () => {
    render(
      <SearchBar result={{ current: 2, total: 5, notFound: false }} onFind={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "acción" } });

    expect(screen.getByText("2 de 5")).toBeTruthy();
  });

  it("says so when nothing matches", () => {
    render(
      <SearchBar result={{ current: 0, total: 0, notFound: true }} onFind={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

    expect(screen.getByText("Sin resultados")).toBeTruthy();
  });

  it("shows no counter before there is a query", () => {
    render(
      <SearchBar result={{ current: 1, total: 5, notFound: false }} onFind={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.queryByText("1 de 5")).toBeNull();
  });

  it("says so when nothing matches", () => {
    render(
      <SearchBar result={{ current: 0, total: 0, notFound: true }} onFind={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

    expect(screen.getByText("Sin resultados")).toBeTruthy();
  });

  it("says the search failed, which is not the same as no results", () => {
    render(
      <SearchBar
        result={{ current: 0, total: 0, notFound: false, failed: true }}
        onFind={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

    expect(screen.getByText("No se pudo buscar")).toBeTruthy();
    expect(screen.queryByText("Sin resultados")).toBeNull();
  });
});
